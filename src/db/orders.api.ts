// Orders & sales core: create/complete/cancel orders, order queries, payment numbers, supplier reports.
// Split out of `api.ts`; shared infra/storage from `./internal`.

import { requireElectron } from '@/utils/electron';
import { enqueueOfflineOrder } from '@/offline/db';
import { productUpdateEmitter } from './products.api';
import {
  ALLOW_MOCK_API,
  delay,
  generateId,
  generateUUID,
  getDeviceId,
  getProfiles,
  getStoredCustomers,
  getStoredOrderItems,
  getStoredOrders,
  getStoredPayments,
  hasPosApi,
  ipc,
  mockDB,
  saveCustomers,
  saveOrderItems,
  saveOrders,
  savePayments,
} from './internal';
import type {
  Product,
  Order,
  OrderItem,
  Payment,
  InventoryMovement,
  OrderWithDetails,
} from '@/types/database';

// ============================================================================
// ORDER FUNCTIONS (Mock)
// ============================================================================

export const getOrders = async (limit = 100) => {
  // Use Electron IPC if available
  if (hasPosApi()) {
    const api = requireElectron();
    // Ask backend for orders WITH details (items/payments) for Orders page
    return ipc<OrderWithDetails[]>(api.orders.list({ limit, with_details: true }));
  }
  await delay();
  const orders = getStoredOrders();
  const orderItems = getStoredOrderItems();
  const payments = getStoredPayments();
  const customers = getStoredCustomers();
  
  // Sort by created_at descending and limit
  const sortedOrders = orders
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, limit);
  
  // Build OrderWithDetails
  return sortedOrders.map(order => ({
    ...order,
    items: orderItems.filter(item => item.order_id === order.id),
    payments: payments.filter(payment => payment.order_id === order.id),
    customer: order.customer_id ? customers.find(c => c.id === order.customer_id) : undefined,
  })) as OrderWithDetails[];
};

export const getOrdersPage = async (opts?: {
  limit?: number;
  offset?: number;
  with_details?: boolean;
  // filters
  date_from?: string;
  date_to?: string;
  customer_id?: string | null;
  cashier_id?: string | null;
  status?: string | null;
  payment_status?: string | null;
  payment_method?: string | null;
  warehouse_id?: string | null;
  sales_channel?: string | null;
  search?: string | null;
  sort_by?: 'created_at' | 'total_amount' | 'order_number' | null;
  sort_order?: 'ASC' | 'DESC' | null;
}) => {
  const limit = Number.isFinite(Number(opts?.limit)) ? Number(opts?.limit) : 50;
  const offset = Number.isFinite(Number(opts?.offset)) ? Number(opts?.offset) : 0;
  const withDetails = opts?.with_details === true;

  if (hasPosApi()) {
    const api = requireElectron();
    const payload: any = {
      limit,
      offset,
      with_details: withDetails,
      include_web_orders: true,
    };
    if (opts?.date_from) payload.date_from = opts.date_from;
    if (opts?.date_to) payload.date_to = opts.date_to;
    if (opts?.customer_id) payload.customer_id = opts.customer_id;
    if (opts?.cashier_id) payload.cashier_id = opts.cashier_id;
    if (opts?.status) payload.status = opts.status;
    if (opts?.payment_status) payload.payment_status = opts.payment_status;
    if (opts?.payment_method) payload.payment_method = opts.payment_method;
    if (opts?.warehouse_id) payload.warehouse_id = opts.warehouse_id;
    if (opts?.sales_channel) payload.sales_channel = opts.sales_channel;
    if (opts?.search) payload.search = opts.search;
    if (opts?.sort_by) payload.sort_by = opts.sort_by;
    if (opts?.sort_order) payload.sort_order = opts.sort_order;

    return ipc<any[]>(api.orders.list(payload));
  }

  // Browser/mock fallback: reuse existing getOrders (details) and slice
  const all = await getOrders(Math.max(1000, limit + offset));
  return all.slice(offset, offset + limit);
};


// ============================================================================
// REPORTS (Desktop/Electron)
// ============================================================================

export const getSupplierActSverka = async (filters: {
  supplier_id: string;
  date_from?: string;
  date_to?: string;
}) => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<any>(api.reports.supplierActSverka(filters || {}));
  }
  await delay();
  throw new Error('Bu hisobot faqat desktop ilovada mavjud.');
};

export const getSupplierProductSales = async (filters: {
  date_from: string;
  date_to: string;
  supplier_id?: string;
  warehouse_id?: string;
}) => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<any[]>(api.reports.supplierProductSales(filters || {}));
  }
  await delay();
  throw new Error('Bu hisobot faqat desktop ilovada mavjud.');
};

export const getLatestPurchaseCosts = async (): Promise<Record<string, number>> => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<Record<string, number>>(api.reports.latestPurchaseCosts());
  }
  await delay();
  return {};
};

export const getOrderById = async (id: string) => {
  // Use Electron IPC if available
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<OrderWithDetails | null>(api.orders.get(id));
  }
  await delay();
  const orders = getStoredOrders();
  const order = orders.find(o => o.id === id);
  if (!order) return null;
  
  const orderItems = getStoredOrderItems();
  const payments = getStoredPayments();
  const customers = getStoredCustomers();
  const profiles = await getProfiles();
  
  return {
    ...order,
    items: orderItems.filter(item => item.order_id === order.id),
    payments: payments.filter(payment => payment.order_id === order.id),
    customer: order.customer_id ? customers.find(c => c.id === order.customer_id) : undefined,
    cashier: order.cashier_id ? profiles.find(p => p.id === order.cashier_id) : undefined,
  } as OrderWithDetails;
};

export const getOrderByNumber = async (orderNumber: string) => {
  // Use Electron IPC if available (if handler exists in backend)
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<OrderWithDetails | null>(api.orders.getByNumber(orderNumber));
  }
  await delay();
  const orders = getStoredOrders();
  const order = orders.find(o => o.order_number === orderNumber);
  if (!order) return null;
  
  const orderItems = getStoredOrderItems();
  const payments = getStoredPayments();
  const customers = getStoredCustomers();
  
  return {
    ...order,
    items: orderItems.filter(item => item.order_id === order.id),
    payments: payments.filter(payment => payment.order_id === order.id),
    customer: order.customer_id ? customers.find(c => c.id === order.customer_id) : undefined,
  } as OrderWithDetails;
};

export const getOrdersByCustomer = async (customerId: string) => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<OrderWithDetails[]>(api.orders.getByCustomer(customerId));
  }
  await delay();
  const orders = getStoredOrders();
  const customerOrders = orders.filter(o => o.customer_id === customerId);
  const orderItems = getStoredOrderItems();
  const payments = getStoredPayments();
  const customers = getStoredCustomers();
  
  return customerOrders.map(order => ({
    ...order,
    items: orderItems.filter(item => item.order_id === order.id),
    payments: payments.filter(payment => payment.order_id === order.id),
    customer: customers.find(c => c.id === order.customer_id),
  })) as OrderWithDetails[];
};

export const generateOrderNumber = async () => {
  await delay();
  const today = new Date().toISOString().split('T')[0].replace(/-/g, '');
  const timestamp = Date.now().toString().slice(-6);
  return `ORD-${today}-${timestamp}`;
};

export const completePOSOrder = async (
  order: Omit<Order, 'id' | 'created_at'>,
  items: Omit<OrderItem, 'id' | 'order_id'>[],
  payments: Omit<Payment, 'id' | 'order_id' | 'created_at'>[]
) => {
  // Use Electron IPC if available
  if (hasPosApi()) {
    const api = requireElectron();
    const order_uuid = (order as any).order_uuid || generateUUID();
    const device_id = (order as any).device_id || (await getDeviceId());
    const orderWithMeta = {
      ...order,
      order_uuid,
      ...(device_id ? { device_id } : {}),
    } as any;
    try {
      return await ipc<{ order_id: string; order_number: string; new_balance?: number; offline_queued?: boolean }>(
        api.sales.completePOSOrder(orderWithMeta, items, payments)
      );
    } catch (err) {
      const { isRpcUnreachableError } = await import('@/lib/isRpcUnreachable');
      const { isClientMode } = await import('@/lib/offlineSalesSync');
      const { enqueueOfflinePosSale } = await import('@/lib/offlineSalesQueue');
      if ((await isClientMode()) && isRpcUnreachableError(err)) {
        await enqueueOfflinePosSale(orderWithMeta, items, payments);
        const shortId = order_uuid.slice(0, 8).toUpperCase();
        return {
          order_id: order_uuid,
          order_number: `OFF-${shortId}`,
          offline_queued: true,
        };
      }
      throw err;
    }
  }

  // SECURITY/DATA-INTEGRITY: never silently fabricate a successful sale in a
  // misconfigured web deploy. Without window.posApi (no Electron / no remote
  // RPC bootstrap) the localStorage path below would record phantom sales that
  // never reach the real backend. Only allow it when mock mode is explicitly
  // enabled (VITE_ALLOW_MOCK_API=true) for UI development.
  if (!ALLOW_MOCK_API) {
    throw new Error(
      'Savdoni yakunlab bo‘lmadi: backend (POS API) ulanmagan. Desktop (Electron) ilovada ishlating yoki dev uchun VITE_ALLOW_MOCK_API=true qiling.'
    );
  }

  // Fallback to mock/localStorage for dev/testing
  await delay();
  
  const orderId = generateId();
  const orderNumber = await generateOrderNumber();
  const createdAt = new Date().toISOString();
  const isOnline = navigator.onLine;
  
  // Create full order object
  const fullOrder: Order = {
    ...order,
    order_uuid: (order as any).order_uuid || generateUUID(),
    id: orderId,
    order_number: orderNumber,
    created_at: createdAt,
  };
  
  // Create order items with order_id
  const orderItems: OrderItem[] = items.map(item => ({
    ...item,
    id: generateId(),
    order_id: orderId,
  }));
  
  // Create payments with order_id
  const orderPayments: Payment[] = payments.map(payment => ({
    ...payment,
    id: generateId(),
    order_id: orderId,
    created_at: createdAt,
  }));
  
  // If offline, persist locally and queue for sync (single helper).
  if (!isOnline) {
    await enqueueOfflineOrder(orderId, fullOrder, orderItems, orderPayments, generateUUID());

    // Also save to localStorage for immediate UI update
    const orders = getStoredOrders();
    orders.push(fullOrder);
    saveOrders(orders);
    
    const existingItems = getStoredOrderItems();
    existingItems.push(...orderItems);
    saveOrderItems(existingItems);
    
    const existingPayments = getStoredPayments();
    existingPayments.push(...orderPayments);
    savePayments(existingPayments);
    
    // Return success (optimistic)
    return {
      order_id: orderId,
      order_number: orderNumber,
    };
  }
  
  // Online: save to localStorage (existing behavior)
  const orders = getStoredOrders();
  orders.push(fullOrder);
  saveOrders(orders);
  
  const existingItems = getStoredOrderItems();
  existingItems.push(...orderItems);
  saveOrderItems(existingItems);
  
  const existingPayments = getStoredPayments();
  existingPayments.push(...orderPayments);
  savePayments(existingPayments);
  
  // Update product stock: decrease stock for each sold item
  orderItems.forEach((item) => {
    const product = mockDB.products.find(p => p.id === item.product_id);
    if (product) {
      // Decrease stock by sold quantity (atomic-like operation in mock)
      const qtyBase = (item as any).qty_base ?? item.quantity;
      product.current_stock = Math.max(0, product.current_stock - qtyBase);
      product.updated_at = createdAt;
      
      // Create inventory movement record
      const movement: InventoryMovement = {
        id: generateId(),
        product_id: item.product_id,
        movement_number: `MOV-${Date.now()}-${generateId().slice(0, 8)}`,
        movement_type: 'sale',
        quantity: -qtyBase, // Negative for sales (stock decrease)
        before_quantity: product.current_stock + qtyBase,
        after_quantity: product.current_stock,
        reference_type: 'order',
        reference_id: orderId,
        reason: `POS sale - Order ${orderNumber}`,
        notes: null,
        created_by: order.cashier_id,
        created_at: createdAt,
      };
      mockDB.inventoryMovements.push(movement);
    } else {
      console.warn(`Product ${item.product_id} not found when updating stock for order ${orderNumber}`);
    }
  });
  
  // Emit product update event for real-time stock updates
  productUpdateEmitter.emit();
  
  // Update customer balance if credit sale
  if (order.customer_id) {
    // Calculate credit amount (total - non-credit payments)
    const nonCreditPayments = orderPayments
      .filter(p => p.payment_method !== 'credit')
      .reduce((sum, p) => sum + p.amount, 0);
    
    const creditAmount = fullOrder.total_amount - nonCreditPayments;
    
    // Only update if there's credit (unpaid portion)
    if (creditAmount > 0) {
      const customers = getStoredCustomers();
      const customerIndex = customers.findIndex(c => c.id === order.customer_id);
      
      if (customerIndex >= 0) {
        const customer = customers[customerIndex];
        const currentBalance = customer.balance || 0;
        const currentTotalSales = customer.total_sales || 0;
        const currentTotalOrders = customer.total_orders || 0;
        
        customers[customerIndex] = {
          ...customer,
          balance: currentBalance + creditAmount,
          total_sales: currentTotalSales + fullOrder.total_amount,
          total_orders: currentTotalOrders + 1,
          last_order_date: createdAt,
          updated_at: createdAt,
        };
        saveCustomers(customers);
      }
    } else {
      // Full payment - still update total_sales and last_order_date
      const customers = getStoredCustomers();
      const customerIndex = customers.findIndex(c => c.id === order.customer_id);
      
      if (customerIndex >= 0) {
        const customer = customers[customerIndex];
        customers[customerIndex] = {
          ...customer,
          total_sales: (customer.total_sales || 0) + fullOrder.total_amount,
          total_orders: (customer.total_orders || 0) + 1,
          last_order_date: createdAt,
          updated_at: createdAt,
        };
        saveCustomers(customers);
      }
    }
  }
  
  return {
    id: orderId,
    order_number: orderNumber,
    message: 'Order completed successfully',
  };
};

export const createOrder = async (
  order: Omit<Order, 'id' | 'created_at'>,
  items: Omit<OrderItem, 'id' | 'order_id'>[],
  payments: Omit<Payment, 'id' | 'order_id' | 'created_at'>[]
) => {
  return completePOSOrder(order, items, payments);
};

export const updateOrderStatus = async (id: string, status: string): Promise<Order> => {
  await delay();
  const orders = getStoredOrders();
  const index = orders.findIndex(o => o.id === id);
  
  if (index === -1) {
    throw new Error('Buyurtma topilmadi');
  }
  
  const updatedOrder: Order = {
    ...orders[index],
    status: status as Order['status'],
    updated_at: new Date().toISOString(),
  };
  
  orders[index] = updatedOrder;
  saveOrders(orders);
  
  return updatedOrder;
};

/**
 * Cancel an order (sets status to 'voided' or 'cancelled')
 */
export const cancelOrder = async (id: string): Promise<Order> => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<Order>(api.orders.cancel(id));
  }
  // SECURITY/DATA-INTEGRITY: don't fake a successful cancel/void against
  // localStorage when the real backend is absent — that desyncs UI from the
  // source of truth. Mock path is dev-only (VITE_ALLOW_MOCK_API=true).
  if (!ALLOW_MOCK_API) {
    throw new Error(
      'Buyurtmani bekor qilib bo‘lmadi: backend (POS API) ulanmagan. Desktop ilovada ishlating yoki dev uchun VITE_ALLOW_MOCK_API=true qiling.'
    );
  }
  await delay();
  const orders = getStoredOrders();
  const index = orders.findIndex(o => o.id === id);
  
  if (index === -1) {
    throw new Error('Buyurtma topilmadi');
  }
  
  const order = orders[index];
  
  // Check if order can be cancelled
  if (order.status === 'voided' || order.status === 'cancelled') {
    throw new Error('Buyurtma allaqachon bekor qilingan');
  }
  
  // Only allow cancelling completed orders (or pending if business rules allow)
  if (order.status !== 'completed' && order.status !== 'pending') {
    throw new Error(`'${order.status}' holatidagi buyurtmani bekor qilib bo'lmaydi`);
  }
  
  const updatedOrder: Order = {
    ...order,
    status: 'voided',
    updated_at: new Date().toISOString(),
  };
  
  orders[index] = updatedOrder;
  saveOrders(orders);
  
  return updatedOrder;
};

// ============================================================================
// PAYMENT FUNCTIONS (Mock)
// ============================================================================

export const generatePaymentNumber = async () => {
  await delay();
  return `PAY-${Date.now()}`;
};

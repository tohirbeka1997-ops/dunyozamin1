// Sales returns domain: create/update/cancel/complete returns, lookups.
// Split out of `api.ts`; shared infra/storage from `./internal`.

import { requireElectron } from '@/utils/electron';
import { productUpdateEmitter } from './products.api';
import {
  MAIN_WAREHOUSE_ID,
  delay,
  generateId,
  getStoredCustomers,
  getStoredOrderItems,
  getStoredOrders,
  getStoredPayments,
  getStoredSalesReturnItems,
  getStoredSalesReturns,
  hasPosApi,
  ipc,
  mockDB,
  saveCustomers,
  saveSalesReturnItems,
  saveSalesReturns,
} from './internal';
import type {
  Product,
  Customer,
  Order,
  SalesReturn,
  SalesReturnItem,
  InventoryMovement,
  OrderWithDetails,
  SalesReturnWithDetails,
} from '@/types/database';

export const getSalesReturnById = async (id: string) => {
  // Use Electron IPC if available (real DB)
  if (hasPosApi()) {
    const api = requireElectron();
    const r = await ipc<any>(api.returns.get(id));
    const normalizeStatus = (s: any) => {
      const v = String(s || '').toLowerCase();
      if (v === 'completed') return 'Completed';
      if (v === 'pending') return 'Pending';
      if (v === 'cancelled') return 'Cancelled';
      if (v === 'draft') return 'Draft';
      return s;
    };
    return {
      ...r,
      status: normalizeStatus(r?.status),
      reason: r?.reason ?? r?.return_reason ?? null,
      return_reason: r?.return_reason ?? r?.reason ?? null,
    } as any;
  }

  await delay();
  const returns = getStoredSalesReturns();
  const returnItems = getStoredSalesReturnItems();
  const orders = getStoredOrders();
  const customers = getStoredCustomers();
  
  const salesReturn = returns.find(r => r.id === id);
  if (!salesReturn) {
    throw new Error('Sales return not found');
  }
  
  return {
    ...salesReturn,
    items: returnItems.filter(item => item.return_id === id),
    order: orders.find(o => o.id === salesReturn.order_id),
    customer: salesReturn.customer_id ? customers.find(c => c.id === salesReturn.customer_id) : undefined,
  } as SalesReturnWithDetails;
};

export const getSalesReturns = async (filters?: {
  status?: string;
  startDate?: string;
  endDate?: string;
  customerId?: string;
}): Promise<SalesReturnWithDetails[]> => {
  // Use Electron IPC if available (real DB)
  if (hasPosApi()) {
    const api = requireElectron();
    const statusMap: Record<string, string> = {
      Completed: 'completed',
      Pending: 'pending',
      Cancelled: 'cancelled',
      Draft: 'draft',
      completed: 'completed',
      pending: 'pending',
      cancelled: 'cancelled',
      draft: 'draft',
    };
    const payload: any = {};
    if (filters?.status) payload.status = statusMap[String(filters.status)] || String(filters.status).toLowerCase();
    if (filters?.customerId) payload.customer_id = filters.customerId;
    if (filters?.startDate) payload.date_from = filters.startDate;
    if (filters?.endDate) payload.date_to = filters.endDate;

    const rows = await ipc<any[]>(api.returns.list(payload));
    const normalizeStatus = (s: any) => {
      const v = String(s || '').toLowerCase();
      if (v === 'completed') return 'Completed';
      if (v === 'pending') return 'Pending';
      if (v === 'cancelled') return 'Cancelled';
      if (v === 'draft') return 'Draft';
      return s;
    };
    return (rows || []).map((r: any) => {
      const orderId = r?.order_id;
      const orderNum = r?.original_order_number ?? r?.order_number;
      const cashierName =
        String(r?.cashier_username || r?.cashier_full_name || '').trim() || null;
      return {
        ...r,
        status: normalizeStatus(r?.status),
        reason: r?.reason ?? r?.return_reason ?? null,
        return_reason: r?.return_reason ?? r?.reason ?? null,
        /** Ro‘yxat UI: SalesReturnWithDetails order / customer / cashier */
        order:
          orderId && orderNum
            ? { id: orderId, order_number: orderNum }
            : orderId
              ? { id: orderId, order_number: orderNum || '—' }
              : undefined,
        customer:
          r?.customer_id && r?.customer_name
            ? { id: r.customer_id, name: r.customer_name }
            : r?.customer_name
              ? { name: r.customer_name }
              : undefined,
        cashier: cashierName
          ? {
              username: r.cashier_username || cashierName,
              full_name: r.cashier_full_name ?? null,
            }
          : undefined,
      };
    }) as any;
  }

  await delay();
  let returns = getStoredSalesReturns();
  const returnItems = getStoredSalesReturnItems();
  const orders = getStoredOrders();
  const customers = getStoredCustomers();
  
  // Apply filters
  if (filters) {
    if (filters.status) {
      returns = returns.filter(r => r.status === filters.status);
    }
    if (filters.startDate) {
      const start = new Date(filters.startDate);
      returns = returns.filter(r => new Date(r.created_at) >= start);
    }
    if (filters.endDate) {
      const end = new Date(filters.endDate);
      end.setHours(23, 59, 59, 999);
      returns = returns.filter(r => new Date(r.created_at) <= end);
    }
    if (filters.customerId) {
      returns = returns.filter(r => r.customer_id === filters.customerId);
    }
  }
  
  // Build SalesReturnWithDetails
  return returns.map(ret => ({
    ...ret,
    items: returnItems.filter(item => item.return_id === ret.id),
    order: orders.find(o => o.id === ret.order_id),
    customer: ret.customer_id ? customers.find(c => c.id === ret.customer_id) : undefined,
  })) as SalesReturnWithDetails[];
};

export const updateSalesReturn = async (
  id: string,
  updates: {
    reason?: string;
    notes?: string | null;
    status?: string;
    items?: Array<{
      return_item_id: string;
      order_item_id?: string;
      quantity: number;
    }>;
  }
) => {
  if (hasPosApi()) {
    const api = requireElectron();
    if (updates.status !== undefined) {
      throw new Error("Desktop rejimda qaytarish statusini alohida o'zgartirish qo'llab-quvvatlanmaydi.");
    }
    const payload: any = {};
    if (updates.reason !== undefined) payload.return_reason = updates.reason;
    if (updates.notes !== undefined) payload.notes = updates.notes;
    if (Array.isArray(updates.items)) payload.items = updates.items;
    return ipc<any>(api.returns.update(id, payload));
  }
  await delay();
  const returns = getStoredSalesReturns();
  const index = returns.findIndex(r => r.id === id);
  
  if (index === -1) {
    throw new Error('Sales return not found');
  }
  
  const updatedReturn: SalesReturn = {
    ...returns[index],
    ...updates,
    updated_at: new Date().toISOString(),
  };
  
  returns[index] = updatedReturn;
  saveSalesReturns(returns);
  
  return updatedReturn;
};

export const deleteSalesReturn = async (id: string) => {
  if (hasPosApi()) {
    const api = requireElectron();
    await ipc<any>(api.returns.delete(id));
    return;
  }
  await delay();
  const returns = getStoredSalesReturns();
  const filtered = returns.filter(r => r.id !== id);
  
  if (filtered.length === returns.length) {
    throw new Error('Sales return not found');
  }
  
  saveSalesReturns(filtered);
  
  // Also delete related items
  const items = getStoredSalesReturnItems();
  const filteredItems = items.filter(item => item.return_id !== id);
  saveSalesReturnItems(filteredItems);
};

export const getOrderForReturn = async (orderId: string) => {
  // Use Electron IPC if available (real DB)
  if (hasPosApi()) {
    const api = requireElectron();
    // NOTE: preload expects a single arg, but IPC handler expects { orderId }.
    // Passing an object keeps both sides compatible.
    const details = await ipc<any>(api.returns.getOrderDetails({ orderId }));
    const order = details?.order;
    const items = Array.isArray(details?.items) ? details.items : [];
    const customer = details?.customer ?? null;

    if (!order?.id) return null as any;

    // Normalize to OrderWithDetails shape expected by UI
    return {
      id: order.id,
      order_number: order.order_number ?? order.orderNumber ?? null,
      customer_id: order.customer_id ?? null,
      cashier_id: order.cashier_id ?? null,
      user_id: order.user_id ?? null,
      warehouse_id: order.warehouse_id ?? MAIN_WAREHOUSE_ID,
      shift_id: order.shift_id ?? null,
      subtotal: order.subtotal ?? 0,
      discount_amount: order.discount_amount ?? 0,
      discount_percent: order.discount_percent ?? 0,
      tax_amount: order.tax_amount ?? 0,
      total_amount: order.total_amount ?? order.total ?? 0,
      paid_amount: order.paid_amount ?? 0,
      credit_amount: order.credit_amount ?? 0,
      change_amount: order.change_amount ?? 0,
      status: order.status ?? 'completed',
      payment_status: order.payment_status ?? 'paid',
      notes: order.notes ?? null,
      created_at: order.created_at ?? order.createdAt ?? new Date().toISOString(),
      updated_at: order.updated_at ?? order.updatedAt ?? null,
      // Details:
      items: items.map((it: any) => ({
        // keep both id and orderItemId for compatibility with existing UI mapping
        id: it.order_item_id ?? it.orderItemId ?? it.id,
        order_id: order.id,
        product_id: it.product_id ?? it.productId,
        product_name: it.product_name ?? it.name,
        product_sku: it.product_sku ?? it.productSku ?? it.sku ?? null,
        unit_price: Number(it.unit_price ?? it.price ?? 0),
        base_price: Number(it.base_price ?? it.basePrice ?? it.unit_price ?? it.price ?? 0),
        usta_price: it.usta_price ?? it.ustaPrice ?? null,
        discount_type: it.discount_type ?? it.discountType ?? 'none',
        discount_value: Number(it.discount_value ?? it.discountValue ?? 0),
        final_unit_price: Number(it.final_unit_price ?? it.finalUnitPrice ?? 0),
        final_total: Number(it.final_total ?? it.finalTotal ?? it.line_total ?? it.lineTotal ?? 0),
        price_source: it.price_source ?? it.priceSource ?? null,
        quantity: Number(it.quantity ?? it.qty ?? it.sold_quantity ?? 0),
        discount_amount: Number(it.discount_amount ?? 0),
        line_total: Number(it.line_total ?? it.lineTotal ?? 0),
        created_at: it.created_at ?? order.created_at ?? new Date().toISOString(),
        // return-aware fields used by CreateReturn.tsx:
        sold_quantity: it.sold_quantity ?? it.qty ?? it.quantity,
        returned_quantity: it.returned_quantity ?? 0,
        remaining_quantity: it.remaining_quantity ?? it.refundableQty ?? it.qty ?? it.quantity,
        orderItemId: it.orderItemId ?? it.order_item_id ?? it.id,
      })) as any,
      payments: [],
      customer: customer || undefined,
    } as any;
  }

  await delay();
  const orders = getStoredOrders();
  const order = orders.find(o => o.id === orderId);
  
  if (!order) {
    throw new Error('Order not found');
  }
  
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

export const generateReturnNumber = async (): Promise<string> => {
  await delay();
  const today = new Date().toISOString().split('T')[0].replace(/-/g, '');
  const timestamp = Date.now().toString().slice(-6);
  return `RET-${today}-${timestamp}`;
};

export const createSalesReturn = async (returnData: {
  mode?: 'order' | 'manual';
  order_id?: string | null;
  customer_id: string | null;
  cashier_id: string;
  total_amount: number;
  refund_method: 'cash' | 'card' | 'credit' | 'customer_account';
  reason: string;
  notes: string | null;
  save_as_draft?: boolean;
  items: Array<{
    product_id: string;
    quantity: number;
    unit_price: number;
    line_total: number;
    order_item_id?: string | null;
    product_name?: string;
    sale_unit?: string;
    qty_sale?: number;
    qty_base?: number;
    base_price?: number | null;
    usta_price?: number | null;
    discount_type?: 'none' | 'percent' | 'fixed' | 'mixed' | null;
    discount_value?: number;
    final_unit_price?: number;
    final_total?: number;
    price_source?: 'base' | 'usta' | 'promo' | 'manual' | 'tier' | null;
  }>;
}) => {
  // Use Electron IPC if available (real DB)
  if (hasPosApi()) {
    const api = requireElectron();
    const payload = {
      mode: returnData.mode || (returnData.order_id ? 'order' : 'manual'),
      order_id: returnData.order_id ?? null,
      customer_id: returnData.customer_id ?? null,
      // ReturnsService expects return_reason, not "reason"
      return_reason: returnData.reason,
      refund_method: returnData.refund_method,
      notes: returnData.notes,
      total_amount: returnData.total_amount,
      items: (returnData.items || []).map((it) => ({
        order_item_id: (it as any).order_item_id,
        product_id: it.product_id,
        product_name: (it as any).product_name,
        quantity: it.quantity,
        unit_price: it.unit_price,
        line_total: it.line_total,
        sale_unit: (it as any).sale_unit ?? null,
        qty_sale: (it as any).qty_sale ?? it.quantity,
        qty_base: (it as any).qty_base ?? it.quantity,
        base_price: (it as any).base_price ?? null,
        usta_price: (it as any).usta_price ?? null,
        discount_type: (it as any).discount_type ?? null,
        discount_value: (it as any).discount_value ?? 0,
        final_unit_price: (it as any).final_unit_price ?? it.unit_price,
        final_total: (it as any).final_total ?? it.line_total,
        price_source: (it as any).price_source ?? null,
      })),
      // Optional fields; ReturnsService will resolve safe IDs anyway
      cashier_id: returnData.cashier_id,
      user_id: returnData.cashier_id,
      save_as_draft: returnData.save_as_draft === true,
    };

    return ipc<any>(api.returns.create(payload));
  }

  await delay();
  
  const returnId = generateId();
  const returnNumber = await generateReturnNumber();
  const createdAt = new Date().toISOString();
  
  // Create sales return
  // Status is 'Completed' immediately since all inventory/financial adjustments are done at creation time
  const salesReturn: SalesReturn = {
    id: returnId,
    return_number: returnNumber,
    order_id: returnData.order_id ?? null,
    customer_id: returnData.customer_id,
    cashier_id: returnData.cashier_id,
    total_amount: returnData.total_amount,
    refund_method: returnData.refund_method,
    return_mode: returnData.mode || (returnData.order_id ? 'order' : 'manual'),
    status: 'Completed',
    reason: returnData.reason,
    notes: returnData.notes,
    created_at: createdAt,
    updated_at: createdAt,
  };
  
  // Create return items
  const returnItems: SalesReturnItem[] = returnData.items.map(item => ({
    id: generateId(),
    return_id: returnId,
    order_item_id: item.order_item_id ?? null,
    product_id: item.product_id,
    product_name: item.product_name,
    quantity: item.quantity,
    unit_price: item.unit_price,
    line_total: item.line_total,
    sale_unit: item.sale_unit,
    qty_sale: item.qty_sale,
    qty_base: item.qty_base,
    base_price: item.base_price ?? undefined,
    usta_price: item.usta_price ?? undefined,
    discount_type: item.discount_type ?? undefined,
    discount_value: item.discount_value,
    final_unit_price: item.final_unit_price,
    final_total: item.final_total,
    price_source: item.price_source ?? undefined,
    created_at: createdAt,
  }));
  
  // Save to localStorage
  const returns = getStoredSalesReturns();
  returns.push(salesReturn);
  saveSalesReturns(returns);
  
  const existingItems = getStoredSalesReturnItems();
  existingItems.push(...returnItems);
  saveSalesReturnItems(existingItems);
  
  // Update product stock: increase stock for each returned item (reverse of sale)
  returnItems.forEach((item) => {
    const product = mockDB.products.find(p => p.id === item.product_id);
    if (product) {
      // Increase stock by returned quantity (atomic-like operation in mock)
      product.current_stock = product.current_stock + item.quantity;
      product.updated_at = createdAt;
      
      // Create inventory movement record
      const movement: InventoryMovement = {
        id: generateId(),
        product_id: item.product_id,
        movement_number: `MOV-${Date.now()}-${generateId().slice(0, 8)}`,
        movement_type: 'return',
        quantity: item.quantity, // Positive for returns (stock increase)
        before_quantity: product.current_stock - item.quantity,
        after_quantity: product.current_stock,
        reference_type: 'sales_return',
        reference_id: returnId,
        reason: `Sales return - ${returnData.reason}`,
        notes: returnData.notes,
        created_by: returnData.cashier_id,
        created_at: createdAt,
      };
      mockDB.inventoryMovements.push(movement);
    } else {
      console.warn(`Product ${item.product_id} not found when updating stock for return ${returnNumber}`);
    }
  });
  
  // Emit product update event for real-time stock updates
  productUpdateEmitter.emit();
  
  // Web / localStorage: align with electron/services/returnsService.cjs
  // - Mijoz hisobiga (credit / customer_account) doim to'liq qaytim balansga qo'shiladi
  // - Naqd/karta: buyurtmada nasiya yoki to'lanmagan qism bo'lsa ham (total - paid), kreditor
  //   (ortiqcha qaytim) to'g'ri hisoblansin — avvalgi bug: faqat "hisobga" uslubda balans o'zgardi
  {
    const refundMethod = String(returnData.refund_method || '').toLowerCase();
    const isAccountRefund = refundMethod === 'credit' || refundMethod === 'customer_account';
    const refundTotal = Number(returnData.total_amount || 0) || 0;
    const orderId = returnData.order_id;
    const fromOrder = Boolean(orderId);
    const orders = fromOrder ? getStoredOrders() : [];
    const order = fromOrder ? orders.find((o) => o.id === orderId) : null;
    const customerId =
      returnData.customer_id || (order ? (order as any).customer_id : null) || null;

    let orderHadUnpaidCredit = false;
    if (order) {
      const creditOnOrder = Number((order as any).credit_amount || 0);
      const paidOnOrder = Number((order as any).paid_amount || 0);
      const totalOnOrder = Number((order as any).total_amount || 0);
      const ps = String((order as any).payment_status || '').toLowerCase();
      const outstandingOnOrder = Math.max(0, totalOnOrder - paidOnOrder);
      orderHadUnpaidCredit =
        creditOnOrder > 0.009 || ps === 'on_credit' || outstandingOnOrder > 0.02;
    }

    const isManual = (returnData.mode || (orderId ? 'order' : 'manual')) === 'manual';
    const shouldAdjustBalance =
      Boolean(customerId) &&
      refundTotal > 0 &&
      (isAccountRefund ||
        orderHadUnpaidCredit ||
        (isManual && Boolean(returnData.customer_id)));

    if (shouldAdjustBalance && customerId) {
      const customers = getStoredCustomers();
      const customerIndex = customers.findIndex((c) => c.id === customerId);

      if (customerIndex >= 0) {
        const customer = customers[customerIndex];
        const currentBalance = Number(customer.balance || 0) || 0;
        const newBalance = currentBalance + refundTotal;

        customers[customerIndex] = {
          ...customer,
          balance: newBalance,
          updated_at: createdAt,
        };
        saveCustomers(customers);
      } else {
        console.warn(`Customer ${customerId} not found when updating balance after sales return (mock)`);
      }
    }
  }

  return salesReturn;
};

export const updateSalesReturnStatus = async (id: string, status: string) => {
  await delay();
  const returns = getStoredSalesReturns();
  const index = returns.findIndex(r => r.id === id);
  
  if (index === -1) {
    throw new Error('Sales return not found');
  }
  
  returns[index] = {
    ...returns[index],
    status,
    updated_at: new Date().toISOString(),
  };
  
  saveSalesReturns(returns);
};

export const cancelSalesReturn = async (id: string) => {
  await delay();
  await updateSalesReturnStatus(id, 'Cancelled');
};

export const completeSalesReturn = async (id: string) => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<any>(api.returns.complete(id));
  }
  await delay();
  await updateSalesReturnStatus(id, 'Completed');
};

export const getSalesReturnsByOrderId = async (orderId: string) => {
  await delay();
  const returns = getStoredSalesReturns();
  return returns.filter(r => r.order_id === orderId);
};

/**
 * Get a single sales return by order ID (returns the first one if multiple exist)
 * Returns null if no return exists for this order
 */
export const getSalesReturnByOrderId = async (orderId: string): Promise<SalesReturnWithDetails | null> => {
  // Use Electron IPC if available (real DB)
  if (hasPosApi()) {
    const api = requireElectron();
    const list = await ipc<any[]>(api.returns.list({ order_id: orderId, limit: 1 }));
    const first = Array.isArray(list) ? list[0] : null;
    if (!first?.id) return null;
    // We only need id + return_number for routing; details can be loaded on view page.
    return first as any;
  }
  await delay();
  const returns = getStoredSalesReturns();
  const returnItems = getStoredSalesReturnItems();
  const orders = getStoredOrders();
  const customers = getStoredCustomers();
  
  const salesReturn = returns.find(r => r.order_id === orderId);
  if (!salesReturn) {
    return null; // No return exists for this order
  }
  
  return {
    ...salesReturn,
    items: returnItems.filter(item => item.return_id === salesReturn.id),
    order: orders.find(o => o.id === salesReturn.order_id),
    customer: salesReturn.customer_id ? customers.find(c => c.id === salesReturn.customer_id) : undefined,
  } as SalesReturnWithDetails;
};

// NOTE: Employee + settings moved to ./employees.api and ./settings.api (re-exported at top).

// NOTE: Held orders API moved to ./heldOrders.api (re-exported below).


// Customer credit/debt: credit orders, payments, ledger, bonus/loyalty, debt summaries.
// Split out of `api.ts`; shared infra/storage from `./internal`.

import { requireElectron } from '@/utils/electron';
import { getOrderById, generateOrderNumber, completePOSOrder, generatePaymentNumber } from './orders.api';
import {
  ALLOW_MOCK_API,
  MAIN_WAREHOUSE_ID,
  delay,
  generateId,
  getStoredCustomers,
  getStoredOrderItems,
  getStoredOrders,
  getStoredPayments,
  hasPosApi,
  ipc,
  saveCustomers,
  saveOrderItems,
  saveOrders,
  savePayments,
} from './internal';
import type {
  Customer,
  Order,
  OrderItem,
  Payment,
  CustomerPayment,
  CustomerLedgerEntry,
  CustomerBonusLedgerEntry,
  CustomerLoyaltyCard,
} from '@/types/database';

// ============================================================================
// CUSTOMER CREDIT/DEBT FUNCTIONS (Mock)
// ============================================================================

export const createCreditOrder = async (orderData: {
  customer_id: string;
  cashier_id: string;
  shift_id: string | null;
  price_tier_code?: string | null;
  items: Array<{
    product_id: string;
    product_name: string;
    quantity: number;
    unit_price: number;
    subtotal: number;
    discount_amount: number;
    total: number;
    price_tier?: string;
    price_source?: string;
    sale_unit?: string;
    qty_sale?: number;
    qty_base?: number;
    base_price?: number;
    usta_price?: number | null;
    discount_type?: string;
    discount_value?: number;
    final_unit_price?: number;
    final_total?: number;
  }>;
  subtotal: number;
  discount_amount: number;
  discount_percent: number;
  tax_amount: number;
  total_amount: number;
  notes?: string;
  loyalty_redeem_points?: number;
  currency?: 'UZS' | 'USD';
  fx_rate?: number | null;
  replaces_order_id?: string | null;
}): Promise<{ success: boolean; order_id?: string; order_number?: string; new_balance?: number; error?: string }> => {
  // Use Electron IPC if available: route through completePOSOrder so SQLite + ledger + balance are updated.
  if (hasPosApi()) {
    try {
      const order: Omit<Order, 'id' | 'created_at'> = {
        order_number: '',
        customer_id: orderData.customer_id,
        cashier_id: orderData.cashier_id,
        shift_id: orderData.shift_id,
        price_tier_code: orderData.price_tier_code,
        warehouse_id: MAIN_WAREHOUSE_ID,
        subtotal: orderData.subtotal,
        discount_amount: orderData.discount_amount,
        discount_percent: orderData.discount_percent,
        tax_amount: orderData.tax_amount,
        total_amount: orderData.total_amount,
        paid_amount: 0,
        credit_amount: orderData.total_amount,
        change_amount: 0,
        status: 'completed',
        payment_status: 'on_credit' as any,
        notes: orderData.notes || null,
        ...(Number(orderData.loyalty_redeem_points) > 0
          ? { loyalty_redeem_points: Math.floor(Number(orderData.loyalty_redeem_points)) }
          : {}),
        ...(orderData.currency
          ? {
              currency: orderData.currency,
              fx_rate:
                orderData.currency === 'USD' &&
                orderData.fx_rate != null &&
                Number.isFinite(Number(orderData.fx_rate)) &&
                Number(orderData.fx_rate) > 0
                  ? Number(orderData.fx_rate)
                  : null,
            }
          : {}),
        ...(orderData.replaces_order_id ? { replaces_order_id: orderData.replaces_order_id } : {}),
      } as any;

      const items = orderData.items.map((it) => ({
        product_id: it.product_id,
        product_name: it.product_name,
        quantity: it.quantity,
        unit_price: it.unit_price,
        subtotal: it.subtotal,
        discount_amount: it.discount_amount,
        total: it.total,
      })) as any;

      // IMPORTANT: Do NOT add a "credit" payment row; credit is derived as (total - paid).
      const res = await completePOSOrder(order, items, []) as { order_id?: string; id?: string; order_number?: string; new_balance?: number };
      const orderId = res.order_id ?? (res as any).id;
      let orderNumber = res.order_number;
      // CRITICAL: If backend didn't return order_number (IPC/response bug or duplicate-order early return), fetch by order_id
      if ((!orderNumber || orderNumber === '') && orderId) {
        try {
          const full = await getOrderById(orderId);
          orderNumber = full?.order_number ?? `ORD-${Date.now()}`;
        } catch {
          orderNumber = `ORD-${Date.now()}`;
        }
      }
      return {
        success: true,
        order_id: orderId ?? '',
        order_number: orderNumber ?? res.order_number ?? `ORD-${Date.now()}`,
        new_balance: res.new_balance,
      };
    } catch (e: any) {
      return { success: false, error: e?.message || String(e) };
    }
  }

  await delay();
  
  const orderId = generateId();
  const orderNumber = await generateOrderNumber();
  const createdAt = new Date().toISOString();
  
  // Create order
  const fullOrder: Order = {
    id: orderId,
    order_number: orderNumber,
    customer_id: orderData.customer_id,
    cashier_id: orderData.cashier_id,
    shift_id: orderData.shift_id,
    subtotal: orderData.subtotal,
    discount_amount: orderData.discount_amount,
    discount_percent: orderData.discount_percent,
    tax_amount: orderData.tax_amount,
    total_amount: orderData.total_amount,
    paid_amount: 0,
    credit_amount: orderData.total_amount,
    change_amount: 0,
    status: 'completed',
    payment_status: 'unpaid',
    notes: orderData.notes || null,
    created_at: createdAt,
  };
  
  // Create order items
  const orderItems: OrderItem[] = orderData.items.map(item => ({
    id: generateId(),
    order_id: orderId,
    product_id: item.product_id,
    product_name: item.product_name,
    quantity: item.quantity,
    unit_price: item.unit_price,
    subtotal: item.subtotal,
    discount_amount: item.discount_amount,
    total: item.total,
  }));
  
  // Create credit payment
  const creditPayment: Payment = {
    id: generateId(),
    order_id: orderId,
    payment_number: await generatePaymentNumber(),
    payment_method: 'credit',
    amount: orderData.total_amount,
    reference_number: null,
    notes: orderData.notes || null,
    created_at: createdAt,
  };
  
  // Save to localStorage
  const orders = getStoredOrders();
  orders.push(fullOrder);
  saveOrders(orders);
  
  const existingItems = getStoredOrderItems();
  existingItems.push(...orderItems);
  saveOrderItems(existingItems);
  
  const existingPayments = getStoredPayments();
  existingPayments.push(creditPayment);
  savePayments(existingPayments);
  
  // Update customer balance
  const customers = getStoredCustomers();
  const customerIndex = customers.findIndex(c => c.id === orderData.customer_id);
  
  if (customerIndex >= 0) {
    const customer = customers[customerIndex];
    const currentBalance = customer.balance || 0;
    const currentTotalSales = customer.total_sales || 0;
    const currentTotalOrders = customer.total_orders || 0;
    const newBalance = currentBalance + orderData.total_amount;
    
    customers[customerIndex] = {
      ...customer,
      balance: newBalance,
      total_sales: currentTotalSales + orderData.total_amount,
      total_orders: currentTotalOrders + 1,
      last_order_date: createdAt,
      updated_at: createdAt,
    };
    saveCustomers(customers);
    
    return {
      success: true,
      order_id: orderId,
      order_number: orderNumber,
      new_balance: newBalance,
    };
  }
  
  return {
    success: true,
    order_id: orderId,
    order_number: orderNumber,
    new_balance: orderData.total_amount,
  };
};

export const receiveCustomerPayment = async (_paymentData: {
  customer_id: string;
  amount: number;
  currency?: 'UZS' | 'USD';
  fx_rate?: number | null;
  // Backward/forward compatible:
  // - UI may send `payment_method`
  // - IPC historically expected `method`
  payment_method?: 'cash' | 'card' | 'click' | 'payme' | 'transfer' | 'other' | 'qr';
  method?: 'cash' | 'card' | 'click' | 'payme' | 'transfer' | 'other' | 'qr';
  operation?: 'payment_in' | 'payment_out';
  notes?: string | null;
  note?: string | null;
  received_by?: string | null;
  order_id?: string | null;
  source?: 'pos' | 'customers' | string;
  /** Ochiq smena — smena/kassa hisobiga bogʻlash */
  shift_id?: string | null;
  shiftId?: string | null;
}): Promise<{
  success: boolean;
  payment_number?: string;
  currency?: 'UZS' | 'USD';
  old_balance?: number;
  new_balance?: number;
  old_balance_uzs?: number;
  new_balance_uzs?: number;
  old_balance_usd?: number;
  new_balance_usd?: number;
  requested_amount?: number;
  applied_amount?: number;
  error?: string;
}> => {
  if (hasPosApi()) {
    const api = requireElectron();
    const method = (_paymentData.method || _paymentData.payment_method || 'cash') as string;
    const normalizedMethod = method === 'qr' ? 'other' : method; // backend supports 'other' instead of legacy 'qr'
    const operation = _paymentData.operation || 'payment_in';
    const notes = (_paymentData.notes ?? _paymentData.note ?? null) as any;

    // Send canonical payload expected by IPC (and it also accepts payment_method for compatibility)
    return ipc<any>(
      api.customers.receivePayment({
        customer_id: _paymentData.customer_id,
        amount: _paymentData.amount,
        currency: _paymentData.currency ?? 'UZS',
        fx_rate: _paymentData.fx_rate ?? null,
        operation,
        method: normalizedMethod,
        payment_method: normalizedMethod,
        notes,
        received_by: _paymentData.received_by ?? null,
        order_id: _paymentData.order_id ?? null,
        source: _paymentData.source ?? null,
        shift_id: _paymentData.shift_id ?? _paymentData.shiftId ?? null,
      })
    );
  }

  if (!ALLOW_MOCK_API) {
    return {
      success: false,
      error: 'Mock API o‘chirilgan. Iltimos desktop (Electron) ilovada ishlating yoki VITE_ALLOW_MOCK_API=true qiling.',
    };
  }
  await delay();
  return { success: true, payment_number: await generatePaymentNumber() };
};

export const getCustomerPayments = async (_customerId: string): Promise<CustomerPayment[]> => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<CustomerPayment[]>(api.customers.getPayments(_customerId, { limit: 200, offset: 0 }));
  }
  await delay();
  return [];
};

export const getCustomerLedger = async (
  _customerId: string,
  _opts?: { limit?: number; offset?: number }
): Promise<CustomerLedgerEntry[]> => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<CustomerLedgerEntry[]>(api.customers.getLedger(_customerId, { limit: _opts?.limit ?? 100, offset: _opts?.offset ?? 0 }));
  }
  await delay();
  return [];
};

export const getCustomerBonusLedger = async (
  customerId: string,
  _opts?: { limit?: number; offset?: number; type?: string }
): Promise<CustomerBonusLedgerEntry[]> => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<CustomerBonusLedgerEntry[]>(
      api.customers.getBonusLedger(customerId, {
        limit: _opts?.limit ?? 100,
        offset: _opts?.offset ?? 0,
        type: _opts?.type,
      })
    );
  }
  await delay();
  return [];
};

export const adjustCustomerBonusPoints = async (payload: {
  actorUserId: string;
  customerId: string;
  deltaPoints: number;
  note?: string;
}): Promise<Customer> => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<Customer>(api.customers.adjustBonusPoints(payload));
  }
  await delay();
  throw new Error('Bonus korreksiyasi faqat desktop ilovada mavjud');
};

export const getCustomerLoyaltyCard = async (customerId: string): Promise<CustomerLoyaltyCard | null> => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<CustomerLoyaltyCard | null>(api.customers.getLoyaltyCard(customerId));
  }
  await delay();
  return null;
};

export const getCustomersWithDebt = async (): Promise<Customer[]> => {
  await delay();
  return [];
};

export const getTotalCustomerDebt = async (): Promise<number> => {
  if (hasPosApi()) {
    const api = requireElectron();
    const customers = await ipc<Customer[]>(api.customers.list({ status: 'all' }));
    return (Array.isArray(customers) ? customers : []).reduce(
      (sum, customer) => sum + Math.max(0, -(Number(customer?.balance || 0))),
      0
    );
  }

  await delay();
  const customers = getStoredCustomers();
  // Debt convention: negative balance = debt
  return customers.reduce((sum, customer) => sum + Math.max(0, -(customer.balance || 0)), 0);
};

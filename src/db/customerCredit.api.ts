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
  hasPosApi,
  ipc,
  saveCustomers,
  saveOrderItems,
  saveOrders,
} from './internal';
import type {
  Customer,
  Order,
  OrderItem,
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
    /** POS erkin narx — checkout payload flags (not DB columns). */
    is_price_overridden?: boolean;
    manual_price?: boolean;
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
  /** Checkout idempotency key (reused across retries) → backend `order_uuid`. */
  order_uuid?: string | null;
  /** Nasiya qarz qaytarish sanasi (YYYY-MM-DD). */
  due_date?: string | null;
  /** Ichki eslatma izohi (kassir/admin uchun). */
  credit_reminder_note?: string | null;
  /** Usta/referrer — bonus accrual destination only */
  bonus_referrer_customer_id?: string | null;
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
        ...(orderData.order_uuid ? { order_uuid: orderData.order_uuid } : {}),
        ...(orderData.due_date ? { due_date: orderData.due_date } : {}),
        ...(orderData.credit_reminder_note
          ? { credit_reminder_note: orderData.credit_reminder_note }
          : {}),
        ...(orderData.bonus_referrer_customer_id
          ? { bonus_referrer_customer_id: orderData.bonus_referrer_customer_id }
          : {}),
      } as any;

      // Pass full line snapshot (erkin narx / final_total) — stripping flags caused
      // completePOSOrder to re-resolve catalog price and inflate credit + balance.
      const items = orderData.items.map((it) => {
        const lineNet = Number(it.final_total ?? it.total ?? 0);
        const isManual =
          it.is_price_overridden === true ||
          it.manual_price === true ||
          it.price_source === 'manual';
        return {
          product_id: it.product_id,
          product_name: it.product_name,
          quantity: it.quantity,
          qty_sale: it.qty_sale ?? it.quantity,
          qty_base: it.qty_base ?? it.quantity,
          sale_unit: it.sale_unit,
          unit_price: it.unit_price,
          subtotal: it.subtotal,
          discount_amount: it.discount_amount,
          total: it.total,
          line_total: lineNet,
          final_total: lineNet,
          final_unit_price: it.final_unit_price,
          base_price: it.base_price,
          usta_price: it.usta_price,
          price_tier: it.price_tier,
          price_source: isManual ? 'manual' : it.price_source,
          is_price_overridden: isManual,
          manual_price: isManual,
          discount_type: it.discount_type,
          discount_value: it.discount_value,
        };
      }) as any;

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
    payment_status: 'on_credit' as any,
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

  // IMPORTANT: Do NOT add a "credit" payment row; credit is derived as (total - paid).
  
  // Save to localStorage
  const orders = getStoredOrders();
  orders.push(fullOrder);
  saveOrders(orders);
  
  const existingItems = getStoredOrderItems();
  existingItems.push(...orderItems);
  saveOrderItems(existingItems);
  
  // Update customer balance (NEGATIVE = debt)
  const customers = getStoredCustomers();
  const customerIndex = customers.findIndex(c => c.id === orderData.customer_id);
  
  if (customerIndex >= 0) {
    const customer = customers[customerIndex];
    const currentBalance = customer.balance || 0;
    const currentTotalSales = customer.total_sales || 0;
    const currentTotalOrders = customer.total_orders || 0;
    const newBalance = currentBalance - orderData.total_amount;
    
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
    new_balance: -orderData.total_amount,
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
  /** Client idempotency key — reused across UI retries of the same submit */
  payment_uuid?: string | null;
  paymentUuid?: string | null;
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
    const paymentUuid =
      _paymentData.payment_uuid ??
      _paymentData.paymentUuid ??
      (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

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
        payment_uuid: paymentUuid,
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

export const getCustomerPayments = async (
  _customerId: string,
  _opts?: { limit?: number; offset?: number }
): Promise<CustomerPayment[]> => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<CustomerPayment[]>(
      api.customers.getPayments(_customerId, {
        limit: _opts?.limit ?? 200,
        offset: _opts?.offset ?? 0,
      })
    );
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

export type OpenCreditOrderRow = {
  id: string;
  order_number: string;
  customer_id: string | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  credit_amount: number;
  due_date?: string | null;
  credit_reminder_note?: string | null;
  payment_status?: string | null;
  created_at?: string | null;
};

export type StaffCreditAlertRow = {
  id: number;
  order_id: string;
  alert_type: string;
  title: string;
  body: string;
  created_at?: string | null;
  read_at?: string | null;
  order_number?: string | null;
  credit_amount?: number | null;
  due_date?: string | null;
  credit_reminder_note?: string | null;
  customer_name?: string | null;
};

export const listOpenCreditOrders = async (filters?: {
  customerId?: string;
  missingDueDateOnly?: boolean;
  limit?: number;
  offset?: number;
}): Promise<OpenCreditOrderRow[]> => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<OpenCreditOrderRow[]>(api.creditReminders.listOpenOrders(filters || {}));
  }
  await delay();
  return [];
};

export const updateOrderDueDate = async (payload: {
  orderId: string;
  dueDate: string;
}): Promise<{ ok: boolean; due_date?: string; error?: string }> => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc(api.creditReminders.updateDueDate(payload));
  }
  await delay();
  return { ok: false, error: 'Faqat desktop ilovada mavjud' };
};

export const listUnreadStaffCreditAlerts = async (filters?: {
  limit?: number;
}): Promise<StaffCreditAlertRow[]> => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<StaffCreditAlertRow[]>(api.creditReminders.listStaffAlerts(filters || {}));
  }
  await delay();
  return [];
};

export const markStaffCreditAlertRead = async (
  alertId: number,
): Promise<{ ok: boolean; error?: string }> => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc(api.creditReminders.ackStaffAlert({ alertId }));
  }
  await delay();
  return { ok: false, error: 'Faqat desktop ilovada mavjud' };
};

export const getCustomersWithDebt = async (): Promise<Customer[]> => {
  await delay();
  return [];
};

export const listCreditReminders = async (filters?: {
  customerId?: string;
  orderId?: string;
  limit?: number;
  offset?: number;
}): Promise<
  Array<{
    id: number;
    order_id: string;
    reminder_type: string;
    channel: string | null;
    status: string;
    provider_id: string | null;
    sent_at: string;
    order_number?: string;
    due_date?: string | null;
    credit_amount?: number;
    customer_name?: string | null;
    customer_phone?: string | null;
  }>
> => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc(api.creditReminders.list(filters || {}));
  }
  await delay();
  return [];
};

export const sendCreditReminder = async (payload: {
  customerId?: string;
  orderId?: string;
  reminderType?: string;
}): Promise<{
  ok: boolean;
  channel?: string | null;
  status?: string;
  error?: string | null;
  errorCode?: string | null;
  reason?: string | null;
}> => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc(api.creditReminders.send(payload));
  }
  await delay();
  return { ok: false, error: 'Faqat desktop ilovada mavjud', errorCode: 'desktop_only' };
};

export const getTotalCustomerDebt = async (): Promise<{ debt_uzs: number; debt_usd: number }> => {
  if (hasPosApi()) {
    const api = requireElectron();
    const row = await ipc<{ debt_uzs?: number; debt_usd?: number }>(api.customers.getTotalDebt());
    return {
      debt_uzs: Number(row?.debt_uzs || 0),
      debt_usd: Number(row?.debt_usd || 0),
    };
  }

  await delay();
  const customers = getStoredCustomers();
  // Debt convention: negative balance = debt
  let debt_uzs = 0;
  let debt_usd = 0;
  for (const customer of customers) {
    debt_uzs += Math.max(0, -(Number(customer.balance || 0)));
    debt_usd += Math.max(0, -(Number((customer as any).balance_usd || 0)));
  }
  return { debt_uzs, debt_usd };
};

// Held orders (parked carts) domain API, split out of `api.ts`.
//
// LocalStorage holds POS-terminal parked carts; when Electron is available we also
// merge DB draft orders (orders.status = 'hold'), e.g. from staff_mobile.

import {
  delay,
  generateId,
  hasPosApi,
  ipc,
  loadHeldOrdersFromStorage,
  mockDB,
  saveHeldOrdersToStorage,
} from './internal';
import { requireElectron } from '@/utils/electron';
import type { CartItem, HeldOrder, Product } from '@/types/database';

const LOCAL_HOLD_NUMBER_RE = /^HOLD-\d+$/;

/** POS-terminal park (localStorage HOLD-… entries). */
export function isLocalPosHeldOrder(
  order: Pick<HeldOrder, 'held_number' | 'order_number' | 'source'>,
): boolean {
  if (order.source === 'local') return true;
  const num = String(order.order_number || order.held_number || '');
  return LOCAL_HOLD_NUMBER_RE.test(num);
}

/** Mobile/web/DB hold — import via sales API, do not deleteHeldOrder. */
export function isRemoteImportHeldOrder(
  order: Pick<
    HeldOrder,
    'held_number' | 'order_number' | 'source' | 'sales_channel' | 'web_order_id'
  >,
): boolean {
  if (isLocalPosHeldOrder(order)) return false;
  if (order.web_order_id != null && Number.isFinite(Number(order.web_order_id))) return true;
  const num = String(order.order_number || order.held_number || '');
  if (/^ORD-/i.test(num)) return true;
  const src = String(order.source || '').toLowerCase();
  if (src === 'mobile' || src === 'web' || src === 'db') return true;
  const ch = String(order.sales_channel || '').toLowerCase();
  if (ch === 'staff_mobile' || ch === 'mobile') return true;
  return Boolean(num && !LOCAL_HOLD_NUMBER_RE.test(num));
}

function stubProductFromLine(it: Record<string, unknown>): Product {
  const unitPrice = Number(it.unit_price ?? it.final_unit_price ?? 0) || 0;
  const qty = Number(it.quantity ?? it.qty_sale ?? 1) || 1;
  return {
    id: String(it.product_id || ''),
    sku: String(it.product_sku || ''),
    barcode: null,
    name: String(it.product_name || 'Mahsulot'),
    description: null,
    category_id: null,
    unit: String(it.sale_unit || 'pcs'),
    purchase_price: 0,
    sale_price: unitPrice,
    current_stock: 0,
    min_stock_level: 0,
    image_url: null,
    is_active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function mapDbHoldToHeldOrder(order: Record<string, unknown>): HeldOrder {
  const items = Array.isArray(order.items) ? order.items : [];
  const cartItems: CartItem[] = items.map((raw) => {
    const it = raw as Record<string, unknown>;
    const qty = Number(it.quantity ?? it.qty_sale ?? 0) || 0;
    const unitPrice = Number(it.unit_price ?? it.final_unit_price ?? 0) || 0;
    const lineTotal = Number(it.line_total ?? it.final_total ?? unitPrice * qty) || unitPrice * qty;
    const discount = Number(it.discount_amount ?? 0) || 0;
    const priceSource = (it.price_source as CartItem['price_source']) || undefined;
    const isManual =
      priceSource === 'manual' ||
      it.is_price_overridden === true ||
      it.is_price_overridden === 1 ||
      it.is_price_overridden === '1';
    return {
      product: stubProductFromLine(it),
      quantity: qty,
      qty_sale: qty,
      unit_price: unitPrice,
      price_tier: (it.price_tier as CartItem['price_tier']) || 'retail',
      price_source: isManual ? 'manual' : priceSource,
      is_price_overridden: Boolean(isManual),
      discount_amount: discount,
      subtotal: lineTotal + discount,
      total: lineTotal,
    };
  });

  const customer = order.customer as Record<string, unknown> | null | undefined;
  const orderNumber = String(order.order_number || order.id || '');
  const salesChannel =
    order.sales_channel != null ? String(order.sales_channel) : null;
  const channelLower = String(salesChannel || '').toLowerCase();
  const source: HeldOrder['source'] =
    channelLower === 'staff_mobile' || channelLower === 'mobile'
      ? 'mobile'
      : 'db';
  return {
    id: String(order.id || ''),
    held_number: orderNumber,
    order_number: orderNumber,
    source,
    sales_channel: salesChannel,
    cashier_id: String(order.cashier_id || order.user_id || ''),
    shift_id: order.shift_id != null ? String(order.shift_id) : null,
    customer_id: order.customer_id != null ? String(order.customer_id) : null,
    customer_name: customer?.name != null ? String(customer.name) : null,
    items: cartItems,
    discount: null,
    total_amount: Number(order.total_amount ?? 0) || null,
    note: order.notes != null ? String(order.notes) : null,
    status: 'HELD',
    created_at: String(order.created_at || new Date().toISOString()),
    updated_at: order.updated_at != null ? String(order.updated_at) : null,
  };
}

async function fetchDbHeldOrders(): Promise<HeldOrder[]> {
  if (!hasPosApi()) return [];
  try {
    const api = requireElectron();
    const rows = await ipc<Array<Record<string, unknown>>>(
      api.sales.list({
        status: 'hold',
        limit: 100,
        sort_by: 'created_at',
        sort_order: 'DESC',
      }),
    );
    if (!Array.isArray(rows) || rows.length === 0) return [];

    const detailed: HeldOrder[] = [];
    for (const row of rows) {
      const id = String(row.id || '').trim();
      if (!id) continue;
      const order = await ipc<Record<string, unknown>>(api.sales.getOrder(id));
      if (!order || String(order.status || '').toLowerCase() !== 'hold') continue;
      detailed.push(mapDbHoldToHeldOrder(order));
    }
    return detailed;
  } catch (error) {
    console.warn('Failed to load DB held orders:', error);
    return [];
  }
}

async function cancelDbHeldOrder(id: string): Promise<boolean> {
  if (!hasPosApi()) return false;
  try {
    const api = requireElectron();
    await ipc(api.orders.cancel(id));
    return true;
  } catch (error) {
    console.warn('Failed to cancel DB held order:', error);
    return false;
  }
}

export const generateHeldNumber = async (): Promise<string> => {
  await delay();
  
  // Reload from storage to ensure we have latest data
  mockDB.heldOrders = loadHeldOrdersFromStorage();
  
  // Find the highest number in existing held orders
  const existingNumbers = mockDB.heldOrders
    .filter(order => order.held_number.match(/^HOLD-\d+$/))
    .map(order => {
      const match = order.held_number.match(/^HOLD-(\d+)$/);
      return match ? parseInt(match[1], 10) : 0;
    });
  
  const nextNumber = existingNumbers.length > 0 
    ? Math.max(...existingNumbers) + 1 
    : 1;
  
  return `HOLD-${String(nextNumber).padStart(3, '0')}`;
};

export const saveHeldOrder = async (heldOrderData: {
  held_number: string;
  cashier_id: string;
  shift_id: string | null;
  customer_id: string | null;
  customer_name: string | null;
  bonus_referrer_customer_id?: string | null;
  items: CartItem[];
  discount: { type: 'amount' | 'percent'; value: number } | null;
  total_amount?: number | null;
  note: string | null;
}): Promise<HeldOrder> => {
  await delay();
  
  const newHeldOrder: HeldOrder = {
    id: generateId(),
    held_number: heldOrderData.held_number,
    source: 'local',
    cashier_id: heldOrderData.cashier_id,
    shift_id: heldOrderData.shift_id,
    customer_id: heldOrderData.customer_id,
    customer_name: heldOrderData.customer_name,
    bonus_referrer_customer_id: heldOrderData.bonus_referrer_customer_id ?? null,
    items: heldOrderData.items,
    discount: heldOrderData.discount,
    total_amount: heldOrderData.total_amount ?? null,
    note: heldOrderData.note,
    status: 'HELD',
    created_at: new Date().toISOString(),
    updated_at: null,
  };
  
  // Reload from storage before push - ensures we never overwrite existing held orders
  mockDB.heldOrders = loadHeldOrdersFromStorage();
  mockDB.heldOrders.push(newHeldOrder);
  saveHeldOrdersToStorage(mockDB.heldOrders);
  
  return newHeldOrder;
};

export const getHeldOrders = async (): Promise<HeldOrder[]> => {
  await delay();
  
  // Reload from storage to ensure we have latest data
  mockDB.heldOrders = loadHeldOrdersFromStorage();
  
  const localHeld = mockDB.heldOrders
    .filter(order => order.status === 'HELD')
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const dbHeld = await fetchDbHeldOrders();
  const seen = new Set(localHeld.map((o) => o.id));
  const merged = [...dbHeld.filter((o) => !seen.has(o.id)), ...localHeld];
  return merged.sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
};

export const getHeldOrderById = async (id: string): Promise<HeldOrder | null> => {
  await delay();
  
  // Reload from storage
  mockDB.heldOrders = loadHeldOrdersFromStorage();
  
  const order = mockDB.heldOrders.find(order => order.id === id);
  if (order) return order;

  const dbHeld = await fetchDbHeldOrders();
  return dbHeld.find((o) => o.id === id) || null;
};

export const updateHeldOrderStatus = async (
  id: string, 
  status: 'RESTORED' | 'CANCELLED'
): Promise<HeldOrder> => {
  await delay();
  
  // Reload from storage
  mockDB.heldOrders = loadHeldOrdersFromStorage();
  
  const index = mockDB.heldOrders.findIndex(order => order.id === id);
  if (index === -1) {
    throw new Error('Held order not found');
  }
  
  mockDB.heldOrders[index] = {
    ...mockDB.heldOrders[index],
    status,
    updated_at: new Date().toISOString(),
  };
  
  saveHeldOrdersToStorage(mockDB.heldOrders);
  
  return mockDB.heldOrders[index];
};

export const updateHeldOrderName = async (
  id: string, 
  customerName: string
): Promise<HeldOrder> => {
  await delay();
  
  // Reload from storage
  mockDB.heldOrders = loadHeldOrdersFromStorage();
  
  const index = mockDB.heldOrders.findIndex(order => order.id === id);
  if (index === -1) {
    throw new Error('Held order not found');
  }
  
  mockDB.heldOrders[index] = {
    ...mockDB.heldOrders[index],
    customer_name: customerName || null,
    updated_at: new Date().toISOString(),
  };
  
  saveHeldOrdersToStorage(mockDB.heldOrders);
  
  return mockDB.heldOrders[index];
};

export const deleteHeldOrder = async (id: string): Promise<void> => {
  await delay();
  
  // Reload from storage
  mockDB.heldOrders = loadHeldOrdersFromStorage();
  
  const index = mockDB.heldOrders.findIndex(order => order.id === id);
  if (index >= 0) {
    mockDB.heldOrders.splice(index, 1);
    saveHeldOrdersToStorage(mockDB.heldOrders);
    return;
  }

  const cancelled = await cancelDbHeldOrder(id);
  if (!cancelled) {
    throw new Error('Held order not found');
  }
};

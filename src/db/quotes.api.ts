// Quotes/estimates (smeta): CRUD and convert-to-sale.
// Split out of `api.ts`; shared infra/storage from `./internal`.

import { requireElectron } from '@/utils/electron';
import { completePOSOrder } from './orders.api';
import {
  delay,
  generateId,
  hasPosApi,
  ipc,
} from './internal';
import type {
  Order,
  OrderItem,
  Payment,
} from '@/types/database';

// ============================================================================
// QUOTES (Smeta / Estimate) FUNCTIONS
// ============================================================================

const QUOTES_STORAGE_KEY = 'pos_quotes';

const loadQuotesFromStorage = (): any[] => {
  try {
    const stored = localStorage.getItem(QUOTES_STORAGE_KEY);
    if (stored) return JSON.parse(stored);
  } catch (e) {
    console.error('Error loading quotes:', e);
  }
  return [];
};

const saveQuotesToStorage = (quotes: any[]) => {
  try {
    localStorage.setItem(QUOTES_STORAGE_KEY, JSON.stringify(quotes));
  } catch (e) {
    console.error('Error saving quotes:', e);
  }
};

export const getQuotes = async (filters?: { status?: string; limit?: number }) => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<any[]>(api.quotes.list(filters || {}));
  }
  await delay();
  let list = loadQuotesFromStorage();
  if (filters?.status) {
    list = list.filter((q: any) => q.status === filters.status);
  }
  list.sort((a: any, b: any) => (new Date(b.created_at).getTime() - new Date(a.created_at).getTime()));
  if (filters?.limit) list = list.slice(0, filters.limit);
  return list;
};

export const getQuoteById = async (id: string) => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<any | null>(api.quotes.get(id));
  }
  await delay();
  const list = loadQuotesFromStorage();
  return list.find((q: any) => q.id === id) || null;
};

export const generateQuoteNumber = async () => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<string>(api.quotes.generateNumber());
  }
  await delay();
  const list = loadQuotesFromStorage();
  const nums = list
    .filter((q: any) => /^QUOTE-\d+$/.test(q.quote_number || ''))
    .map((q: any) => parseInt(String(q.quote_number).replace(/^QUOTE-/, ''), 10) || 0);
  const next = nums.length > 0 ? Math.max(...nums) + 1 : 1;
  return `QUOTE-${String(next).padStart(6, '0')}`;
};

export const createQuote = async (data: {
  quote_number?: string;
  customer_id?: string | null;
  customer_name: string;
  phone?: string | null;
  price_type: 'retail' | 'usta';
  status?: string;
  subtotal: number;
  discount_amount: number;
  discount_percent: number;
  total: number;
  total_profit?: number | null;
  valid_until?: string | null;
  notes?: string | null;
  created_by: string;
  items: any[];
}) => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<any>(api.quotes.create(data));
  }
  await delay();
  const id = generateId();
  const quoteNumber = data.quote_number || (await generateQuoteNumber());
  const quote = {
    id,
    quote_number: quoteNumber,
    customer_id: data.customer_id || null,
    customer_name: data.customer_name || '',
    phone: data.phone || null,
    price_type: data.price_type || 'retail',
    status: data.status || 'draft',
    subtotal: data.subtotal || 0,
    discount_amount: data.discount_amount || 0,
    discount_percent: data.discount_percent || 0,
    total: data.total || 0,
    total_profit: data.total_profit ?? null,
    valid_until: data.valid_until || null,
    notes: data.notes || null,
    created_at: new Date().toISOString(),
    updated_at: null,
    created_by: data.created_by || '',
    items: (data.items || []).map((it: any, i: number) => ({
      ...it,
      id: it.id || generateId(),
      quote_id: id,
      sort_order: i,
    })),
  };
  const list = loadQuotesFromStorage();
  list.unshift(quote);
  saveQuotesToStorage(list);
  return quote;
};

export const updateQuote = async (id: string, data: Partial<any>) => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<any>(api.quotes.update(id, data));
  }
  await delay();
  const list = loadQuotesFromStorage();
  const i = list.findIndex((q: any) => q.id === id);
  if (i === -1) return null;
  const updated = { ...list[i], ...data, updated_at: new Date().toISOString() };
  if (data.items) updated.items = data.items;
  list[i] = updated;
  saveQuotesToStorage(list);
  return updated;
};

export const deleteQuote = async (id: string) => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<void>(api.quotes.delete(id));
  }
  await delay();
  const list = loadQuotesFromStorage().filter((q: any) => q.id !== id);
  saveQuotesToStorage(list);
};

export const convertQuoteToSale = async (
  quoteId: string,
  orderData: { cashier_id: string; shift_id?: string | null; warehouse_id?: string }
): Promise<{ order_id: string; order_number: string }> => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<{ order_id: string; order_number: string }>(
      api.quotes.convertToSale(quoteId, orderData)
    );
  }

  await delay();
  const list = loadQuotesFromStorage();
  const quote = list.find((q: any) => q.id === quoteId);
  if (!quote) {
    throw new Error('Smeta topilmadi');
  }
  if (String(quote.status) === 'converted') {
    throw new Error('Smeta allaqachon sotuvga aylantirilgan');
  }
  const rawItems = Array.isArray(quote.items) ? quote.items : [];
  if (rawItems.length === 0) {
    throw new Error('Smetada mahsulot yo‘q');
  }

  const notePrefix = quote.quote_number ? `Smeta ${quote.quote_number}` : 'Smeta';

  const lineItems: Omit<OrderItem, 'id' | 'order_id'>[] = rawItems.map((it: any) => {
    const qty = Number(it.quantity) || 0;
    const unitPrice = Number(it.unit_price) || 0;
    const discAmt = Number(it.discount_amount) || 0;
    const pct = Number(it.discount_percent) || 0;
    const gross = qty * unitPrice;
    const discFromPct = pct > 0 ? (gross * pct) / 100 : 0;
    const lineDisc = discAmt > 0 ? discAmt : discFromPct;
    const total = Number.isFinite(Number(it.line_total))
      ? Number(it.line_total)
      : Math.max(0, gross - lineDisc);
    const productName =
      String(it.name_snapshot || it.product_name || '').trim() || 'Mahsulot';
    const tier = it.price_type_used === 'usta' ? 'master' : 'retail';
    return {
      product_id: it.product_id,
      product_name: productName,
      quantity: qty,
      sale_unit: it.unit || 'pcs',
      qty_sale: qty,
      qty_base: qty,
      unit_price: unitPrice,
      price_tier: tier as OrderItem['price_tier'],
      subtotal: gross,
      discount_amount: lineDisc,
      total,
    };
  });

  const totalAmount = Number(quote.total) || 0;
  const payAmount = Math.max(0, totalAmount);

  const order: Omit<Order, 'id' | 'created_at'> = {
    order_number: '',
    customer_id: quote.customer_id ?? null,
    cashier_id: orderData.cashier_id,
    shift_id: orderData.shift_id ?? null,
    subtotal: Number(quote.subtotal) || 0,
    discount_amount: Number(quote.discount_amount) || 0,
    discount_percent: Number(quote.discount_percent) || 0,
    tax_amount: 0,
    total_amount: totalAmount,
    paid_amount: payAmount,
    credit_amount: 0,
    change_amount: 0,
    status: 'completed',
    payment_status: 'paid',
    notes: `${notePrefix}${quote.notes ? ` · ${quote.notes}` : ''}`,
  };

  const payments: Omit<Payment, 'id' | 'order_id' | 'created_at'>[] =
    payAmount <= 0
      ? []
      : [
          {
            payment_number: `PAY-${Date.now()}`,
            payment_method: 'cash',
            amount: payAmount,
            reference_number: null,
            notes: notePrefix,
          },
        ];

  const res = (await completePOSOrder(order, lineItems as any, payments)) as {
    id?: string;
    order_id?: string;
    order_number?: string;
  };
  const orderId = res.order_id ?? res.id ?? '';
  const orderNumber = res.order_number ?? '';
  if (!orderId) {
    throw new Error('Buyurtma yaratilmadi (mock)');
  }

  const next = list.map((q: any) =>
    q.id === quoteId
      ? {
          ...q,
          status: 'converted',
          converted_order_id: orderId,
          updated_at: new Date().toISOString(),
        }
      : q
  );
  saveQuotesToStorage(next);

  return { order_id: orderId, order_number: orderNumber };
};

/**
 * Staff REST API client with access-token refresh retry.
 */

import {
  clearSession,
  loadAccessToken,
  loadRefreshToken,
  updateTokens,
} from '@/auth/session';
import { router } from 'expo-router';
import { t } from '@/i18n';
import type {
  QueueCounts,
  StaffTokens,
  StaffUser,
  WebOrderDetail,
  WebOrderQueueId,
  WebOrderSummary,
} from '@/types/orders';
import type {
  CreateCustomerPayload,
  CustomerLedgerEntry,
  CustomerSummary,
  CreatePurchaseOrderPayload,
  UpdateCustomerPayload,
  PurchaseOrder,
  ReceivePaymentResult,
  ReceivePurchaseOrderPayload,
  SupplierPaymentResult,
  SupplierSummary,
  SupplierLedgerEntry,
  ExpenseCategory,
  Expense,
  CreateExpensePayload,
} from '@/types/customers';
import type {
  CloseShiftResult,
  CompleteSalePayload,
  CompleteSaleResponse,
  CurrentShiftResponse,
  DailyReport,
  PosProduct,
  PosSaleSummary,
  ProductBatchesResponse,
  ProductDetail,
  Receipt,
  SaleOrder,
  Shift,
  ReturnableOrder,
  CreateReturnPayload,
  SalesReturnResult,
} from '@/types/sales';

/**
 * API base resolution:
 * - EXPO_PUBLIC_STAFF_API_URL wins when provided (any platform).
 * - Web dev (Expo dev-server on :8081/:19006/...): public-api is a SEPARATE
 *   process on :3334, so point there on the same host. Aks holda so'rov dev
 *   serverga borib HTML (index.html) qaytaradi → "Unexpected token '<'" xatosi.
 * - Web prod (public-api tomonidan xizmat qilinadi, masalan Telegram WebApp):
 *   sahifa origini ishlatiladi (same-origin), domen/tunnel o'zgarsa ham ishlaydi.
 * - Native dev: lokal public-api.
 */
const PUBLIC_API_PORT = '3334';
const EXPO_DEV_PORTS = new Set(['8081', '19000', '19006', '19002']);

function defaultApiBase(): string {
  if (typeof window !== 'undefined' && window.location && window.location.origin) {
    const { protocol, hostname, port, origin } = window.location;
    // Expo web dev-server porti — public-api alohida :3334 da
    if (EXPO_DEV_PORTS.has(port)) {
      return `${protocol}//${hostname}:${PUBLIC_API_PORT}`;
    }
    return origin;
  }
  return `http://localhost:${PUBLIC_API_PORT}`;
}

const API_BASE = process.env.EXPO_PUBLIC_STAFF_API_URL || defaultApiBase();

export function staffApiUrl(path: string): string {
  const base = API_BASE.replace(/\/+$/, '');
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${base}${p}`;
}

export interface LoginPayload {
  tenant: string;
  username: string;
  password: string;
  device_id?: string;
  platform?: string;
}

export interface LoginResponse extends StaffTokens {
  user: StaffUser;
}

export async function staffLogin(payload: LoginPayload): Promise<LoginResponse> {
  const res = await fetch(staffApiUrl('/v1/staff/auth/login'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || err.error || `HTTP ${res.status}`);
  }
  return res.json() as Promise<LoginResponse>;
}

async function refreshAccessToken(): Promise<string | null> {
  const refresh = await loadRefreshToken();
  if (!refresh) return null;

  const res = await fetch(staffApiUrl('/v1/staff/auth/refresh'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refresh }),
  });

  if (!res.ok) {
    await clearSession();
    return null;
  }

  const body = (await res.json()) as StaffTokens;
  await updateTokens(body);
  return body.access_token;
}

/** Clear session and send the user back to the login screen. */
async function redirectToLogin(): Promise<void> {
  await clearSession();
  try {
    router.replace('/(auth)/login');
  } catch {
    // Router may not be mounted yet (e.g. during boot).
  }
}

export async function staffFetch(path: string, init: RequestInit = {}): Promise<Response> {
  // Access token may be missing while refresh is still valid — try refresh first
  // so we never hit protected routes without an Authorization header.
  let token = await loadAccessToken();
  if (!token) {
    token = await refreshAccessToken();
  }

  const headers = new Headers(init.headers || {});
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  let res = await fetch(staffApiUrl(path), { ...init, headers });

  if (res.status === 401) {
    const next = await refreshAccessToken();
    if (next) {
      headers.set('Authorization', `Bearer ${next}`);
      res = await fetch(staffApiUrl(path), { ...init, headers });
    }
  }

  return res;
}

function staffApiErrorMessage(res: Response, err: Record<string, unknown>): string {
  const code = String(err.error || '');
  const serverMsg = typeof err.message === 'string' ? err.message.trim() : '';
  if (serverMsg && serverMsg !== 'Internal error' && serverMsg !== 'Request failed') {
    return serverMsg;
  }
  if (res.status === 409 && code === 'shift_closed') return t('openShiftFirst');
  if (res.status === 409 && code === 'insufficient_stock') {
    return t('stockLimitReached');
  }
  if (res.status === 403) return serverMsg || 'Ruxsat yo‘q';
  if (res.status === 404 && code === 'not_found') return serverMsg || 'Maʼlumot topilmadi';
  if (res.status === 400 && code === 'validation_error') return serverMsg || t('saleFailed');
  if (res.status === 500 && code === 'database_error') {
    return serverMsg || 'Maʼlumotlar bazasi xatosi';
  }
  return serverMsg || (code ? String(code) : '') || `HTTP ${res.status}`;
}

async function parseJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.status === 401) {
      await redirectToLogin();
      throw new Error(t('sessionExpired'));
    }
    if (res.status === 404 && res.url.includes('/v1/staff/') && !err.message) {
      throw new Error(
        'Staff API eski — public-api ni qayta ishga tushiring (npm run public-api)',
      );
    }
    throw new Error(staffApiErrorMessage(res, err));
  }
  return res.json() as Promise<T>;
}

export async function fetchQueueCounts(): Promise<QueueCounts> {
  const res = await staffFetch('/v1/staff/orders/queues');
  const body = await parseJson<{ data: QueueCounts }>(res);
  return body.data;
}

export async function fetchOrders(queue: WebOrderQueueId, page = 1): Promise<{
  data: WebOrderSummary[];
  meta: { page: number; total: number; total_pages: number };
}> {
  const qs = new URLSearchParams({ queue, page: String(page) });
  const res = await staffFetch(`/v1/staff/orders?${qs}`);
  return parseJson(res);
}

export async function fetchOrder(id: number | string): Promise<WebOrderDetail> {
  const res = await staffFetch(`/v1/staff/orders/${id}`);
  const body = await parseJson<{ data: WebOrderDetail }>(res);
  return body.data;
}

export async function updateOrderStatus(id: number | string, status: string): Promise<WebOrderDetail> {
  const res = await staffFetch(`/v1/staff/orders/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
  const body = await parseJson<{ data: WebOrderDetail }>(res);
  return body.data;
}

export async function dispatchCourier(id: number | string): Promise<WebOrderDetail> {
  const res = await staffFetch(`/v1/staff/orders/${id}/dispatch-courier`, { method: 'POST', body: '{}' });
  const body = await parseJson<{ data: WebOrderDetail }>(res);
  return body.data;
}

// ----- POS selling (v2 "Tez savdo / quick sale") -----

export async function searchProducts(q: string, limit = 20): Promise<PosProduct[]> {
  const qs = new URLSearchParams({ limit: String(limit) });
  if (q.trim()) qs.set('q', q.trim());
  const res = await staffFetch(`/v1/staff/products/search?${qs}`);
  const body = await parseJson<{ data: PosProduct[] }>(res);
  return body.data;
}

export async function fetchProduct(id: string): Promise<ProductDetail> {
  const res = await staffFetch(`/v1/staff/products/${id}`);
  const body = await parseJson<{ data: ProductDetail }>(res);
  return body.data;
}

export async function fetchProductBatches(id: string): Promise<ProductBatchesResponse> {
  const res = await staffFetch(`/v1/staff/products/${id}/batches`);
  return parseJson<ProductBatchesResponse>(res);
}

export async function fetchCurrentShift(): Promise<CurrentShiftResponse | null> {
  const res = await staffFetch('/v1/staff/shifts/current');
  const body = await parseJson<{ data: CurrentShiftResponse | null }>(res);
  return body.data;
}

export async function openShift(openingCash: number): Promise<Shift> {
  const res = await staffFetch('/v1/staff/shifts/open', {
    method: 'POST',
    body: JSON.stringify({ opening_cash: openingCash }),
  });
  const body = await parseJson<{ data: Shift }>(res);
  return body.data;
}

export async function closeShift(closingCash: number, notes?: string): Promise<CloseShiftResult> {
  const res = await staffFetch('/v1/staff/shifts/close', {
    method: 'POST',
    body: JSON.stringify({ closing_cash: closingCash, notes }),
  });
  const body = await parseJson<{ data: CloseShiftResult }>(res);
  return body.data;
}

export async function completeSale(payload: CompleteSalePayload): Promise<CompleteSaleResponse> {
  const res = await staffFetch('/v1/staff/sales', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return parseJson<CompleteSaleResponse>(res);
}

export async function fetchPosSales(
  page = 1,
  opts?: { q?: string; sales_channel?: string },
): Promise<{
  data: PosSaleSummary[];
  meta: { page: number; limit: number; count: number; has_more?: boolean };
}> {
  const qs = new URLSearchParams({ page: String(page), limit: '50' });
  if (opts?.q?.trim()) qs.set('q', opts.q.trim());
  if (opts?.sales_channel) qs.set('sales_channel', opts.sales_channel);
  const res = await staffFetch(`/v1/staff/sales?${qs}`);
  return parseJson(res);
}

export async function fetchSale(id: string): Promise<SaleOrder> {
  const res = await staffFetch(`/v1/staff/sales/${id}`);
  const body = await parseJson<{ data: SaleOrder }>(res);
  return body.data;
}

export async function fetchSaleReceipt(id: string): Promise<{ order: SaleOrder; receipt: Receipt }> {
  const res = await staffFetch(`/v1/staff/sales/${id}/receipt`);
  const body = await parseJson<{ data: { order: SaleOrder; receipt: Receipt } }>(res);
  return body.data;
}

export async function fetchReturnableSale(id: string): Promise<ReturnableOrder> {
  const res = await staffFetch(`/v1/staff/sales/${id}/returnable`);
  const body = await parseJson<{ data: ReturnableOrder }>(res);
  return body.data;
}

export async function createSaleReturn(payload: CreateReturnPayload): Promise<SalesReturnResult> {
  const res = await staffFetch('/v1/staff/returns', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  const body = await parseJson<{ data: SalesReturnResult }>(res);
  return body.data;
}

// ----- Customers (Mijozlar) -----

export async function searchCustomers(q: string, limit = 30): Promise<CustomerSummary[]> {
  const qs = new URLSearchParams({ limit: String(limit) });
  if (q.trim()) qs.set('q', q.trim());
  const res = await staffFetch(`/v1/staff/customers/search?${qs}`);
  const body = await parseJson<{ data?: CustomerSummary[] }>(res);
  return Array.isArray(body.data) ? body.data : [];
}

export async function fetchCustomer(id: string): Promise<CustomerSummary> {
  const res = await staffFetch(`/v1/staff/customers/${id}`);
  const body = await parseJson<{ data: CustomerSummary }>(res);
  return body.data;
}

export async function fetchCustomerLedger(id: string, limit = 50): Promise<CustomerLedgerEntry[]> {
  const qs = new URLSearchParams({ limit: String(limit) });
  const res = await staffFetch(`/v1/staff/customers/${id}/ledger?${qs}`);
  const body = await parseJson<{ data: CustomerLedgerEntry[] }>(res);
  return body.data;
}

export async function createCustomer(payload: CreateCustomerPayload): Promise<CustomerSummary> {
  const res = await staffFetch('/v1/staff/customers', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  const body = await parseJson<{ data: CustomerSummary }>(res);
  return body.data;
}

export async function updateCustomer(
  id: string,
  payload: UpdateCustomerPayload,
): Promise<CustomerSummary> {
  const res = await staffFetch(`/v1/staff/customers/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
  const body = await parseJson<{ data: CustomerSummary }>(res);
  return body.data;
}

export async function receiveCustomerPayment(
  id: string,
  amount: number,
  paymentMethod: 'cash' | 'card' = 'cash',
  notes?: string,
): Promise<ReceivePaymentResult> {
  const res = await staffFetch(`/v1/staff/customers/${id}/receive-payment`, {
    method: 'POST',
    body: JSON.stringify({ amount, payment_method: paymentMethod, notes }),
  });
  const body = await parseJson<{ data: ReceivePaymentResult }>(res);
  return body.data;
}

// ----- Suppliers (Yetkazib beruvchilar) -----

export async function searchSuppliers(q: string, limit = 30): Promise<SupplierSummary[]> {
  const qs = new URLSearchParams({ limit: String(limit) });
  if (q.trim()) qs.set('q', q.trim());
  const res = await staffFetch(`/v1/staff/suppliers/search?${qs}`);
  const body = await parseJson<{ data: SupplierSummary[] }>(res);
  return body.data;
}

export async function fetchSupplier(id: string): Promise<SupplierSummary> {
  const res = await staffFetch(`/v1/staff/suppliers/${id}`);
  const body = await parseJson<{ data: SupplierSummary }>(res);
  return body.data;
}

export async function paySupplier(
  id: string,
  amount: number,
  method: 'cash' | 'card' | 'transfer' = 'cash',
  notes?: string,
): Promise<SupplierPaymentResult> {
  const res = await staffFetch(`/v1/staff/suppliers/${id}/pay`, {
    method: 'POST',
    body: JSON.stringify({ amount, method, notes }),
  });
  const body = await parseJson<{ data: SupplierPaymentResult }>(res);
  return body.data;
}

export async function fetchSupplierLedger(id: string, limit = 50): Promise<SupplierLedgerEntry[]> {
  const qs = new URLSearchParams({ limit: String(limit) });
  const res = await staffFetch(`/v1/staff/suppliers/${id}/ledger?${qs}`);
  const body = await parseJson<{ data: SupplierLedgerEntry[] }>(res);
  return body.data;
}

// ----- Expenses (Xarajatlar) -----

export async function fetchExpenseCategories(): Promise<ExpenseCategory[]> {
  const res = await staffFetch('/v1/staff/expenses/categories');
  const body = await parseJson<{ data: ExpenseCategory[] }>(res);
  return body.data;
}

export async function fetchExpenses(date?: string): Promise<Expense[]> {
  const qs = date ? `?date=${encodeURIComponent(date)}` : '';
  const res = await staffFetch(`/v1/staff/expenses${qs}`);
  const body = await parseJson<{ data: Expense[] }>(res);
  return body.data;
}

export async function createExpense(payload: CreateExpensePayload): Promise<Expense> {
  const res = await staffFetch('/v1/staff/expenses', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  const body = await parseJson<{ data: Expense }>(res);
  return body.data;
}

/** Register FCM device token (foundation — requires expo-notifications + Firebase). */
export async function registerStaffDevice(
  fcmToken: string,
  platform?: string,
  deviceId?: string,
): Promise<void> {
  const res = await staffFetch('/v1/staff/devices/register', {
    method: 'POST',
    body: JSON.stringify({
      fcm_token: fcmToken,
      platform,
      device_id: deviceId,
    }),
  });
  await parseJson(res);
}

// ----- Purchase orders (Xarid) -----

export async function fetchPurchaseOrders(status?: string): Promise<PurchaseOrder[]> {
  const qs = new URLSearchParams({ limit: '50' });
  if (status) qs.set('status', status);
  const res = await staffFetch(`/v1/staff/purchase-orders?${qs}`);
  const body = await parseJson<{ data: PurchaseOrder[] }>(res);
  return body.data;
}

export async function fetchPurchaseOrder(id: string): Promise<PurchaseOrder> {
  const res = await staffFetch(`/v1/staff/purchase-orders/${id}`);
  const body = await parseJson<{ data: PurchaseOrder }>(res);
  return body.data;
}

export async function fetchLatestExchangeRate(
  base = 'USD',
  quote = 'UZS',
): Promise<{ rate: number; effective_date?: string | null } | null> {
  const qs = new URLSearchParams({ base_currency: base, quote_currency: quote });
  const res = await staffFetch(`/v1/staff/exchange-rates/latest?${qs}`);
  const body = await parseJson<{ data: { rate: number; effective_date?: string | null } | null }>(res);
  return body.data;
}

export async function createPurchaseOrder(payload: CreatePurchaseOrderPayload): Promise<PurchaseOrder> {
  const res = await staffFetch('/v1/staff/purchase-orders', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  const body = await parseJson<{ data: PurchaseOrder }>(res);
  return body.data;
}

export async function receivePurchaseOrder(
  id: string,
  payload: ReceivePurchaseOrderPayload,
): Promise<PurchaseOrder> {
  const res = await staffFetch(`/v1/staff/purchase-orders/${id}/receive`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  const body = await parseJson<{ data: PurchaseOrder }>(res);
  return body.data;
}

export async function fetchDailyReport(date?: string): Promise<DailyReport> {
  const qs = date ? `?date=${encodeURIComponent(date)}` : '';
  const res = await staffFetch(`/v1/staff/reports/daily${qs}`);
  const body = await parseJson<{ data: DailyReport }>(res);
  return body.data;
}

export async function staffLogout(): Promise<void> {
  const token = await loadAccessToken();
  const refresh = await loadRefreshToken();
  if (token) {
    await fetch(staffApiUrl('/v1/staff/auth/logout'), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(refresh ? { refresh_token: refresh } : {}),
    }).catch(() => {});
  }
  await clearSession();
}

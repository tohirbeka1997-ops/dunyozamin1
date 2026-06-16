/**
 * Multi-currency display & ledger helpers (UZS + USD).
 * Ledger rules match supplier MVP: inventory/costing in UZS; supplier AP in settlement_currency.
 */

import { formatMoneyUZS as formatUzsInner } from './money';

export type AppCurrency = 'UZS' | 'USD';

export const DEFAULT_SETTLEMENT_CURRENCY: AppCurrency = 'UZS';
export const DEFAULT_PO_CURRENCY: AppCurrency = 'UZS';

export function normalizeCurrency(
  value: string | null | undefined,
  fallback: AppCurrency = 'UZS'
): AppCurrency {
  const c = String(value || fallback).trim().toUpperCase();
  return c === 'USD' ? 'USD' : 'UZS';
}

export function formatMoneyUSD(amount: number | string | null | undefined): string {
  const n = typeof amount === 'string' ? parseFloat(amount) : Number(amount ?? 0);
  if (!Number.isFinite(n)) return '0.00 USD';
  const sign = n < 0 ? '-' : '';
  return `${sign}${Math.abs(n).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} USD`;
}

/** Format amount in the given currency (display layer). */
export function formatMoney(
  amount: number | string | null | undefined,
  currency: AppCurrency = 'UZS'
): string {
  return currency === 'USD' ? formatMoneyUSD(amount) : formatUzsInner(amount);
}

/** Supplier / ledger balance by settlement currency. */
export function formatLedgerMoney(
  amount: number | string | null | undefined,
  settlementCurrency: string | null | undefined
): string {
  return formatMoney(amount, normalizeCurrency(settlementCurrency, DEFAULT_SETTLEMENT_CURRENCY));
}

/** PO document total in its invoice currency. */
export function getPoLedgerAmount(po: {
  currency?: string | null;
  total_amount?: number | null;
  total_usd?: number | null;
}): number {
  const cur = normalizeCurrency(po?.currency, DEFAULT_PO_CURRENCY);
  if (cur === 'USD') return Number(po?.total_usd ?? po?.total_amount ?? 0) || 0;
  return Number(po?.total_amount ?? 0) || 0;
}

/**
 * PO total in supplier settlement currency (matches backend debtExpr).
 * USD settlement uses total_usd; legacy UZS rows convert via fx_rate when needed.
 */
export function getSupplierPoSettlementAmount(
  po: {
    currency?: string | null;
    total_amount?: number | null;
    total_usd?: number | null;
    fx_rate?: number | null;
  },
  settlementCurrency: string | null | undefined
): number {
  const settlement = normalizeCurrency(settlementCurrency, DEFAULT_SETTLEMENT_CURRENCY);
  if (settlement === 'USD') {
    const usd = Number(po?.total_usd ?? NaN);
    if (Number.isFinite(usd) && usd > 0) return usd;
    const uzs = Number(po?.total_amount ?? 0) || 0;
    const fx = Number(po?.fx_rate ?? 0);
    if (uzs > 0 && fx > 0) return uzs / fx;
    if (normalizeCurrency(po?.currency, DEFAULT_PO_CURRENCY) === 'USD') {
      return getPoLedgerAmount(po);
    }
    return 0;
  }
  return Number(po?.total_amount ?? 0) || 0;
}

/** Payment amount in supplier settlement currency (matches backend paidExpr). */
export function getSupplierPaymentSettlementAmount(
  payment: {
    amount?: number | null;
    amount_usd?: number | null;
    currency?: string | null;
    fx_rate?: number | null;
  },
  settlementCurrency: string | null | undefined
): number {
  const settlement = normalizeCurrency(settlementCurrency, DEFAULT_SETTLEMENT_CURRENCY);
  const rawAmount = Number(payment?.amount ?? 0) || 0;
  const rawUsd = Number(payment?.amount_usd ?? NaN);
  if (settlement === 'USD') {
    if (Number.isFinite(rawUsd) && rawUsd !== 0) return rawUsd;
    const fx = Number(payment?.fx_rate ?? 0);
    if (rawAmount !== 0 && fx > 0 && normalizeCurrency(payment?.currency, 'UZS') === 'UZS') {
      return rawAmount / fx;
    }
    return rawAmount;
  }
  if (Number.isFinite(rawUsd) && rawUsd !== 0) {
    const fx = Number(payment?.fx_rate ?? 0);
    if (fx > 0) return rawUsd * fx;
  }
  return rawAmount;
}

export function getPoLedgerCurrency(po: { currency?: string | null }): AppCurrency {
  return normalizeCurrency(po?.currency, DEFAULT_PO_CURRENCY);
}

/** Paid on PO (from list/get computed fields or raw payment sums). */
export function getPoPaidAmount(po: {
  currency?: string | null;
  paid_amount?: number | null;
  paid_amount_usd?: number | null;
}): number {
  const cur = getPoLedgerCurrency(po);
  if (cur === 'USD') return Number(po?.paid_amount_usd ?? po?.paid_amount ?? 0) || 0;
  return Number(po?.paid_amount ?? 0) || 0;
}

export function getPoRemainingAmount(po: {
  currency?: string | null;
  total_amount?: number | null;
  total_usd?: number | null;
  paid_amount?: number | null;
  paid_amount_usd?: number | null;
  remaining_amount?: number | null;
  remaining_amount_usd?: number | null;
}): number {
  const cur = getPoLedgerCurrency(po);
  if (cur === 'USD') {
    const rem = po?.remaining_amount_usd ?? po?.remaining_amount;
    if (rem != null && Number.isFinite(Number(rem))) return Number(rem);
    return Math.max(0, getPoLedgerAmount(po) - getPoPaidAmount(po));
  }
  const rem = po?.remaining_amount;
  if (rem != null && Number.isFinite(Number(rem))) return Number(rem);
  return Math.max(0, getPoLedgerAmount(po) - getPoPaidAmount(po));
}

export function formatPoMoney(
  po: Parameters<typeof getPoLedgerAmount>[0],
  amount?: number
): string {
  return formatMoney(amount ?? getPoLedgerAmount(po), getPoLedgerCurrency(po));
}

/** POS / sales order document currency (default UZS). */
export function getOrderSaleCurrency(order: { currency?: string | null }): AppCurrency {
  return normalizeCurrency(order?.currency, 'UZS');
}

/** Format a sales order monetary field in its document currency. */
export function formatOrderMoney(
  order: { currency?: string | null },
  amount?: number | string | null
): string {
  return formatMoney(amount, getOrderSaleCurrency(order));
}

/** Format return/refund amount in the original order's sale currency. */
export type CustomerBalances = { uzs: number; usd: number };

export function getCustomerBalances(customer: {
  balance?: number | null;
  balance_usd?: number | null;
}): CustomerBalances {
  return {
    uzs: Number(customer?.balance ?? 0) || 0,
    usd: Number(customer?.balance_usd ?? 0) || 0,
  };
}

export function formatCustomerBalanceLine(
  amount: number,
  currency: AppCurrency = 'UZS'
): string {
  const n = Number(amount) || 0;
  const abs = Math.abs(n);
  const formatted = formatMoney(abs, currency);
  if (n < -0.0001) return `Qarz: ${formatted}`;
  if (n > 0.0001) return `Haq: ${formatted}`;
  return currency === 'USD' ? '0.00 USD' : "0 so'm";
}

export function formatReturnMoney(
  ret: { total_amount?: number | null; refund_amount?: number | null },
  order?: { currency?: string | null } | null
): string {
  const amount = Number(ret?.refund_amount ?? ret?.total_amount ?? 0);
  return formatOrderMoney(order ?? {}, amount);
}

export function aggregateReturnAmounts(
  returns: Array<{
    total_amount?: number | null;
    refund_amount?: number | null;
    order_currency?: string | null;
    order?: { currency?: string | null } | null;
  }> | null | undefined
): { totalUzs: number; totalUsd: number } {
  let totalUzs = 0;
  let totalUsd = 0;
  for (const r of returns || []) {
    const amt = Number(r?.refund_amount ?? r?.total_amount ?? 0) || 0;
    const cur = normalizeCurrency(r?.order_currency ?? r?.order?.currency, 'UZS');
    if (cur === 'USD') totalUsd += amt;
    else totalUzs += amt;
  }
  return { totalUzs, totalUsd };
}

export function getExpenseCurrency(expense: { currency?: string | null }): AppCurrency {
  return normalizeCurrency(expense?.currency, 'UZS');
}

export function formatExpenseMoney(
  expense: { currency?: string | null },
  amount?: number | string | null
): string {
  return formatMoney(amount, getExpenseCurrency(expense));
}

/** Convert expense document amount to UZS for P&L / shift totals. */
export function expenseToUzsAmount(expense: {
  currency?: string | null;
  amount?: number | null;
  fx_rate?: number | null;
}): number {
  const amount = Number(expense?.amount ?? 0) || 0;
  if (getExpenseCurrency(expense) !== 'USD') return amount;
  const fx = Number(expense?.fx_rate ?? 0);
  if (!Number.isFinite(fx) || fx <= 0) return amount;
  return amount * fx;
}

export type ExpenseAggregateTotals = {
  count: number;
  totalUzs: number;
  totalUsd: number;
};

export type SalesAggregateTotals = {
  count: number;
  totalUzs: number;
  totalUsd: number;
  countUzs: number;
  countUsd: number;
};

/** Sum completed sales revenue split by order currency (do not mix UZS + USD). */
export function aggregateSalesOrders(
  orders:
    | Array<{
        currency?: string | null;
        total_amount?: number | null;
        revenue?: number | null;
        status?: string | null;
      }>
    | null
    | undefined,
  opts?: { status?: string | null }
): SalesAggregateTotals {
  let totalUzs = 0;
  let totalUsd = 0;
  let countUzs = 0;
  let countUsd = 0;
  const statusFilter = opts?.status ?? 'completed';
  for (const o of orders || []) {
    if (statusFilter && String(o?.status || '') !== statusFilter) continue;
    const rev = Number((o as { revenue?: number }).revenue ?? o?.total_amount ?? 0) || 0;
    if (getOrderSaleCurrency(o) === 'USD') {
      totalUsd += rev;
      countUsd += 1;
    } else {
      totalUzs += rev;
      countUzs += 1;
    }
  }
  return { count: countUzs + countUsd, totalUzs, totalUsd, countUzs, countUsd };
}

export function aggregateExpenses(
  expenses: Array<{ currency?: string | null; amount?: number | null }> | null | undefined
): ExpenseAggregateTotals {
  let totalUzs = 0;
  let totalUsd = 0;
  for (const e of expenses || []) {
    const amt = Number(e?.amount ?? 0) || 0;
    if (getExpenseCurrency(e) === 'USD') totalUsd += amt;
    else totalUzs += amt;
  }
  return { count: (expenses || []).length, totalUzs, totalUsd };
}

export function convertAtRate(
  amount: number,
  from: AppCurrency,
  to: AppCurrency,
  fxRate: number | null | undefined
): number {
  const value = Number(amount || 0);
  if (!value || from === to) return value;
  const fx = Number(fxRate || 0);
  if (!Number.isFinite(fx) || fx <= 0) return value;
  if (from === 'UZS' && to === 'USD') return value / fx;
  if (from === 'USD' && to === 'UZS') return value * fx;
  return value;
}

/** Sum supplier balances split by settlement currency (do not add across currencies). */
/** Inventory received value (always stored in UZS on PO line items). */
export function calculatePoReceivedAmountUzs(
  items: Array<{ received_qty?: number | null; unit_cost?: number | null }> | null | undefined
): number {
  if (!items?.length) return 0;
  return items.reduce((sum, item) => {
    const rq = Number(item.received_qty) || 0;
    const uc = Number(item.unit_cost) || 0;
    return sum + rq * uc;
  }, 0);
}

export type PoAggregateTotals = {
  count: number;
  orderedUzs: number;
  orderedUsd: number;
  paidUzs: number;
  paidUsd: number;
  receivedUzs: number;
  debtUzs: number;
  debtUsd: number;
};

/** Sum PO metrics split by invoice currency (do not mix UZS + USD). */
export function aggregatePurchaseOrders(
  orders: Array<
    Parameters<typeof getPoLedgerAmount>[0] & {
      status?: string | null;
      items?: Array<{ received_qty?: number | null; unit_cost?: number | null }> | null;
    }
  >
): PoAggregateTotals {
  const active = (orders || []).filter(
    (po) => String(po?.status || '').toLowerCase() !== 'cancelled'
  );
  let orderedUzs = 0;
  let orderedUsd = 0;
  let paidUzs = 0;
  let paidUsd = 0;
  let receivedUzs = 0;
  let debtUzs = 0;
  let debtUsd = 0;

  for (const po of active) {
    const cur = getPoLedgerCurrency(po);
    const ordered = getPoLedgerAmount(po);
    const paid = getPoPaidAmount(po);
    const received = calculatePoReceivedAmountUzs(po.items);

    if (cur === 'USD') {
      orderedUsd += ordered;
      paidUsd += paid;
      debtUsd += Math.max(0, getPoRemainingAmount(po));
    } else {
      orderedUzs += ordered;
      paidUzs += paid;
      debtUzs += Math.max(0, received - paid);
    }
    receivedUzs += received;
  }

  return {
    count: active.length,
    orderedUzs,
    orderedUsd,
    paidUzs,
    paidUsd,
    receivedUzs,
    debtUzs,
    debtUsd,
  };
}

export function splitSupplierBalances(
  suppliers: Array<{ balance?: number | null; settlement_currency?: string | null }>
): { payablesUzs: number; payablesUsd: number; creditsUzs: number; creditsUsd: number } {
  let payablesUzs = 0;
  let payablesUsd = 0;
  let creditsUzs = 0;
  let creditsUsd = 0;
  for (const s of suppliers || []) {
    const bal = Number(s?.balance ?? 0) || 0;
    const cur = normalizeCurrency(s?.settlement_currency, DEFAULT_SETTLEMENT_CURRENCY);
    if (cur === 'USD') {
      if (bal > 0) payablesUsd += bal;
      else if (bal < 0) creditsUsd += Math.abs(bal);
    } else {
      if (bal > 0) payablesUzs += bal;
      else if (bal < 0) creditsUzs += Math.abs(bal);
    }
  }
  return { payablesUzs, payablesUsd, creditsUzs, creditsUsd };
}

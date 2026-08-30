/**
 * Purchase Orders / Goods Receipt / Supplier Payment hardening helpers.
 * Keep in sync with electron/lib/purchaseHardening.cjs
 */

export const ZERO_COST_RECEIVE_TYPES = ['free_sample', 'bonus_goods', 'gratis'] as const;
export type ZeroCostReceiveType = (typeof ZERO_COST_RECEIVE_TYPES)[number];

export const PURCHASE_ROLE_RANK: Record<string, number> = {
  purchaser: 1,
  receiver: 1,
  cashier: 1,
  senior_cashier: 2,
  accountant: 3,
  manager: 4,
  admin: 5,
};

const MONEY_EPS_UZS = 1;
const MONEY_EPS_USD = 0.02;

export function moneyTolerance(currency?: string | null): number {
  return String(currency || 'UZS').toUpperCase() === 'USD' ? MONEY_EPS_USD : MONEY_EPS_UZS;
}

export function normalizePurchaseRole(raw: unknown): string {
  const c = String(raw || '')
    .trim()
    .toLowerCase();
  if (c === 'admin') return 'admin';
  if (c === 'manager') return 'manager';
  if (c === 'accountant' || c === 'buxgalter') return 'accountant';
  if (c === 'receiver' || c === 'ombor' || c === 'warehouse') return 'receiver';
  if (c === 'purchaser' || c === 'buyer' || c === 'xarid') return 'purchaser';
  if (c === 'senior_cashier') return 'senior_cashier';
  if (c === 'cashier') return 'cashier';
  return 'purchaser';
}

export function pickPrimaryPurchaseRole(roleCodes: unknown[]): string {
  const codes = Array.isArray(roleCodes) ? roleCodes : [];
  let best = 'purchaser';
  let bestRank = 0;
  for (const raw of codes) {
    const code = normalizePurchaseRole(raw);
    const rank = PURCHASE_ROLE_RANK[code] || 0;
    if (rank > bestRank) {
      bestRank = rank;
      best = code;
    }
  }
  return best;
}

export function roleRank(roleCode: unknown): number {
  return PURCHASE_ROLE_RANK[normalizePurchaseRole(roleCode)] || 0;
}

export function hasMinPurchaseRole(roleCode: unknown, minRole: string): boolean {
  return roleRank(roleCode) >= roleRank(minRole);
}

export function canAcceptSupplierOverpayAsAdvance(roleCode: unknown): boolean {
  return hasMinPurchaseRole(roleCode, 'accountant');
}

export function canCancelSupplierPayment(roleCode: unknown): boolean {
  return hasMinPurchaseRole(roleCode, 'accountant');
}

export function canApproveZeroCostReceive(roleCode: unknown): boolean {
  return hasMinPurchaseRole(roleCode, 'manager');
}

export function canCreateCostCorrection(roleCode: unknown): boolean {
  return hasMinPurchaseRole(roleCode, 'accountant');
}

export function canExportPurchaseOrders(roleCode: unknown): boolean {
  return hasMinPurchaseRole(roleCode, 'accountant');
}

export function isZeroCostReceiveType(raw: unknown): boolean {
  const t = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  return (ZERO_COST_RECEIVE_TYPES as readonly string[]).includes(t);
}

export function normalizeZeroCostReceiveType(raw: unknown): ZeroCostReceiveType | null {
  const t = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  if (t === 'free_sample' || t === 'bonus_goods' || t === 'gratis') return t;
  return null;
}

export type PurchasePaymentStatus = 'UNPAID' | 'PARTIALLY_PAID' | 'PAID' | 'OVERPAID';

/** Negative remainder must NEVER be labeled PAID. */
export function computePurchasePaymentStatus(
  paidAmount: number,
  totalAmount: number,
  currency: string = 'UZS',
): PurchasePaymentStatus {
  const paid = Number(paidAmount) || 0;
  const total = Number(totalAmount) || 0;
  const tol = moneyTolerance(currency);
  if (paid <= 0) return 'UNPAID';
  const rem = total - paid;
  if (rem > tol) return 'PARTIALLY_PAID';
  if (Math.abs(rem) <= tol) return 'PAID';
  return 'OVERPAID';
}

export function computePurchaseRemainder(paidAmount: number, totalAmount: number) {
  const paid = Number(paidAmount) || 0;
  const total = Number(totalAmount) || 0;
  return {
    remainder: total - paid,
    debt: Math.max(0, total - paid),
    excess: Math.max(0, paid - total),
  };
}

export function splitPaymentAgainstRemainder(
  payAmount: number,
  remaining: number,
  currency: string = 'UZS',
): { settleAmount: number; advanceAmount: number; requiresAdvanceAck: boolean } {
  const pay = Number(payAmount) || 0;
  const rem = Math.max(0, Number(remaining) || 0);
  const tol = moneyTolerance(currency);
  if (!(pay > 0)) {
    return { settleAmount: 0, advanceAmount: 0, requiresAdvanceAck: false };
  }
  if (pay <= rem + tol) {
    return { settleAmount: pay, advanceAmount: 0, requiresAdvanceAck: false };
  }
  const settleAmount = rem;
  const advanceAmount = Math.round((pay - rem) * 100) / 100;
  return {
    settleAmount,
    advanceAmount: advanceAmount > 0 ? advanceAmount : 0,
    requiresAdvanceAck: advanceAmount > tol,
  };
}

export type ConfirmReceiveValidation = {
  ok: boolean;
  errors: string[];
  receiveType: string;
  allowZeroCost: boolean;
};

/** Confirm-receive validation (not draft). Draft may be empty. */
export function validateConfirmReceiveInput(input: {
  supplier_id?: string | null;
  items?: Array<{
    product_id?: string | null;
    received_qty?: number | null;
    quantity?: number | null;
    unit_cost?: number | null;
    unit_cost_usd?: number | null;
  }> | null;
  received_at?: string | null;
  doc_date?: string | null;
  currency?: string | null;
  receive_type?: string | null;
  zero_cost_reason?: string | null;
  zero_cost_approved_by?: string | null;
}): ConfirmReceiveValidation {
  const errors: string[] = [];
  if (!input?.supplier_id) errors.push('supplier_id is required');

  const items = Array.isArray(input?.items) ? input.items : [];
  if (items.length === 0) errors.push('at least one product is required');

  const docDate = String(input?.received_at || input?.doc_date || '').trim();
  if (!docDate) errors.push('document date is required');

  const currency = String(input?.currency || '')
    .trim()
    .toUpperCase();
  if (currency !== 'UZS' && currency !== 'USD') {
    errors.push('currency is required (UZS or USD)');
  }

  const receiveType = normalizeZeroCostReceiveType(input?.receive_type);
  const allowZeroCost = !!receiveType;
  if (allowZeroCost) {
    if (!String(input?.zero_cost_reason || '').trim()) {
      errors.push('zero-cost receive requires a reason');
    }
    if (!input?.zero_cost_approved_by) {
      errors.push('zero-cost receive requires manager approval');
    }
  }

  for (let i = 0; i < items.length; i += 1) {
    const it = items[i] || {};
    if (!it.product_id) errors.push(`line ${i + 1}: product_id is required`);
    const qty = Number(it.received_qty ?? it.quantity ?? 0);
    if (!Number.isFinite(qty) || qty <= 0) {
      errors.push(`line ${i + 1}: quantity must be > 0`);
    }
    const costRaw =
      currency === 'USD' ? (it.unit_cost_usd ?? it.unit_cost) : (it.unit_cost ?? it.unit_cost_usd);
    const cost = Number(costRaw ?? 0);
    if (!allowZeroCost) {
      if (!Number.isFinite(cost) || cost <= 0) {
        errors.push(`line ${i + 1}: cost must be > 0 (or use free sample / bonus / gratis)`);
      }
    } else if (!Number.isFinite(cost) || cost < 0) {
      errors.push(`line ${i + 1}: cost must be >= 0`);
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    receiveType: receiveType || 'standard',
    allowZeroCost,
  };
}

export function computeReceivableQty(
  ordered: number,
  alreadyReceived: number,
  inFlight: number = 0,
): number {
  const o = Number(ordered) || 0;
  const a = Number(alreadyReceived) || 0;
  const f = Number(inFlight) || 0;
  return Math.max(0, o - a - f);
}

/**
 * Cross-currency / FX revaluation delta in UZS for a settle amount booked on a PO.
 * Positive = payment FX higher than PO FX (extra UZS outflow / FX loss).
 */
export function computeFxDiffAmount(input: {
  settleAmountInPoCurrency: number;
  poCurrency?: string | null;
  poFxRate?: number | null;
  paymentFxRate?: number | null;
}): number | null {
  const settle = Number(input.settleAmountInPoCurrency);
  const poFx = Number(input.poFxRate);
  const payFx = Number(input.paymentFxRate);
  const cur = String(input.poCurrency || 'UZS').toUpperCase();
  if (!(settle > 0) || !(poFx > 0) || !(payFx > 0)) return null;
  if (cur !== 'USD') return null;
  const diff = Math.round(settle * (payFx - poFx) * 100) / 100;
  if (Math.abs(diff) < 0.5) return null;
  return diff;
}

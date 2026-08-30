'use strict';

/** Default UZS threshold for large-return manager approval (overridable via settings). */
const DEFAULT_LARGE_RETURN_THRESHOLD = 500000;

/**
 * Normalize payment / refund method slugs used across POS.
 * @param {unknown} raw
 * @returns {'cash'|'card'|'customer_account'|'other'}
 */
function normalizePayMethod(raw) {
  const m = String(raw || '')
    .trim()
    .toLowerCase();
  if (!m) return 'other';
  if (m === 'cash' || m === 'naqd' || m === 'наличные') return 'cash';
  if (
    m === 'card' ||
    m === 'karta' ||
    m === 'terminal' ||
    m === 'uzcard' ||
    m === 'humo' ||
    m === 'visa' ||
    m === 'mastercard' ||
    m === 'qr' ||
    m === 'click' ||
    m === 'payme'
  ) {
    return 'card';
  }
  if (
    m === 'credit' ||
    m === 'customer_account' ||
    m === 'store_credit' ||
    m === 'balance' ||
    m === 'nasiya' ||
    m === 'debt'
  ) {
    return 'customer_account';
  }
  if (m === 'refund_cash' || m === 'refund_balance') return 'other';
  return 'other';
}

/**
 * Summarize order payments for refund-method matching / UI allocation.
 * @param {Array<{ payment_method?: string, amount?: number }>} paymentRows
 * @param {{ credit_amount?: number, paid_amount?: number, total_amount?: number, payment_status?: string }|null} order
 */
function summarizeOrderPayments(paymentRows = [], order = null) {
  const byMethod = { cash: 0, card: 0, customer_account: 0, other: 0 };
  for (const p of paymentRows || []) {
    const amt = Number(p?.amount || 0) || 0;
    if (amt <= 0) continue;
    const key = normalizePayMethod(p.payment_method);
    byMethod[key] = (byMethod[key] || 0) + amt;
  }

  const creditOnOrder = Number(order?.credit_amount || 0) || 0;
  const paid = Number(order?.paid_amount || 0) || 0;
  const total = Number(order?.total_amount || 0) || 0;
  const outstanding = Math.max(0, total - paid);
  const ps = String(order?.payment_status || '').toLowerCase();
  if (creditOnOrder > 0.009 || outstanding > 0.02 || ps === 'on_credit') {
    byMethod.customer_account += Math.max(creditOnOrder, outstanding);
  }

  const entries = Object.entries(byMethod)
    .filter(([, v]) => Number(v) > 0.009)
    .sort((a, b) => Number(b[1]) - Number(a[1]));

  const methods = entries.map(([k]) => k);
  const primary = methods[0] || null;
  const second = Number(entries[1]?.[1] || 0);
  const top = Number(entries[0]?.[1] || 0);
  const isMixed = methods.length > 1 && second / Math.max(top, 1) > 0.05;

  return {
    byMethod,
    methods,
    primary,
    isMixed,
    allocation: entries.map(([method, amount]) => ({ method, amount: Number(amount) })),
  };
}

/**
 * Whether chosen refund method needs manager override vs original sale mix.
 * Customer-account refund is always allowed (no cash out).
 */
function requiresMethodMismatchApproval(refundMethod, paymentSummary) {
  const refund = normalizePayMethod(refundMethod);
  if (refund === 'customer_account') return false;
  if (!paymentSummary || !paymentSummary.methods || paymentSummary.methods.length === 0) {
    // Unknown original — allow without mismatch gate (cannot prove mismatch).
    return false;
  }
  if (paymentSummary.methods.includes(refund)) return false;
  // Card↔card variants already normalized; cash-only sale → card is mismatch.
  return true;
}

function getLargeReturnThreshold(rawSettingValue) {
  const n = Number(rawSettingValue);
  if (Number.isFinite(n) && n > 0) return n;
  return DEFAULT_LARGE_RETURN_THRESHOLD;
}

/** Canonical role codes used by returns money-safe gates. */
const RETURNS_ROLE_RANK = {
  cashier: 1,
  senior_cashier: 2,
  manager: 3,
  admin: 4,
};

/**
 * Role → capability matrix for sales returns.
 * Enforcement: ReturnsService; this helper is shared for FE/docs consistency.
 */
const RETURNS_PERMISSION_MATRIX = {
  cashier: {
    create: true,
    draft: true,
    submit_pending: true,
    orderless_complete: false,
    orderless_pending: true,
    approve: false,
    reject: false,
    cancel_completed: false,
    method_mismatch_complete: false,
    large_complete: false,
  },
  senior_cashier: {
    create: true,
    draft: true,
    submit_pending: true,
    orderless_complete: false,
    orderless_pending: true,
    approve: 'under_threshold',
    reject: 'under_threshold',
    cancel_completed: false,
    method_mismatch_complete: true,
    large_complete: false,
  },
  manager: {
    create: true,
    draft: true,
    submit_pending: true,
    orderless_complete: true,
    orderless_pending: true,
    approve: true,
    reject: true,
    cancel_completed: true,
    method_mismatch_complete: true,
    large_complete: true,
  },
  admin: {
    create: true,
    draft: true,
    submit_pending: true,
    orderless_complete: true,
    orderless_pending: true,
    approve: true,
    reject: true,
    cancel_completed: true,
    method_mismatch_complete: true,
    large_complete: true,
  },
};

function normalizeReturnsRole(raw) {
  const c = String(raw || '')
    .trim()
    .toLowerCase();
  if (c === 'admin' || c === 'manager' || c === 'senior_cashier' || c === 'cashier') return c;
  return 'cashier';
}

/** Highest returns-relevant role from a list of role codes. */
function pickPrimaryReturnsRole(roleCodes = []) {
  let best = 'cashier';
  let bestRank = 0;
  for (const raw of roleCodes || []) {
    const code = normalizeReturnsRole(raw);
    const rank = RETURNS_ROLE_RANK[code] || 0;
    if (rank > bestRank) {
      bestRank = rank;
      best = code;
    }
  }
  return best;
}

function getReturnsPermissions(roleCode) {
  const role = normalizeReturnsRole(roleCode);
  return RETURNS_PERMISSION_MATRIX[role] || RETURNS_PERMISSION_MATRIX.cashier;
}

function isManagerOrAdminRole(roleCode) {
  const r = normalizeReturnsRole(roleCode);
  return r === 'admin' || r === 'manager';
}

function isSeniorCashierOrAbove(roleCode) {
  return (RETURNS_ROLE_RANK[normalizeReturnsRole(roleCode)] || 0) >= RETURNS_ROLE_RANK.senior_cashier;
}

/**
 * Whether actor may approve/reject a return of the given refund amount.
 * @param {string} roleCode
 * @param {number} refundAmount
 * @param {number} threshold
 */
function canApproveOrRejectReturn(roleCode, refundAmount, threshold) {
  const perms = getReturnsPermissions(roleCode);
  if (perms.approve === true) return true;
  if (perms.approve === 'under_threshold') {
    return Number(refundAmount || 0) < Number(threshold || DEFAULT_LARGE_RETURN_THRESHOLD);
  }
  return false;
}

module.exports = {
  DEFAULT_LARGE_RETURN_THRESHOLD,
  RETURNS_PERMISSION_MATRIX,
  RETURNS_ROLE_RANK,
  normalizePayMethod,
  summarizeOrderPayments,
  requiresMethodMismatchApproval,
  getLargeReturnThreshold,
  normalizeReturnsRole,
  pickPrimaryReturnsRole,
  getReturnsPermissions,
  isManagerOrAdminRole,
  isSeniorCashierOrAbove,
  canApproveOrRejectReturn,
};

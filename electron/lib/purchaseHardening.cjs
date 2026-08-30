'use strict';

/**
 * Purchase Orders / Goods Receipt / Supplier Payment hardening helpers.
 * Keep in sync with src/lib/purchase/purchaseHardening.ts
 */

const ZERO_COST_RECEIVE_TYPES = new Set([
  'free_sample',
  'bonus_goods',
  'gratis',
]);

const PURCHASE_ROLE_RANK = {
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

function moneyTolerance(currency) {
  return String(currency || 'UZS').toUpperCase() === 'USD' ? MONEY_EPS_USD : MONEY_EPS_UZS;
}

function normalizePurchaseRole(raw) {
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

function pickPrimaryPurchaseRole(roleCodes) {
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

function roleRank(roleCode) {
  return PURCHASE_ROLE_RANK[normalizePurchaseRole(roleCode)] || 0;
}

function hasMinPurchaseRole(roleCode, minRole) {
  return roleRank(roleCode) >= roleRank(minRole);
}

function canAcceptSupplierOverpayAsAdvance(roleCode) {
  return hasMinPurchaseRole(roleCode, 'accountant');
}

function canCancelSupplierPayment(roleCode) {
  return hasMinPurchaseRole(roleCode, 'accountant');
}

function canApproveZeroCostReceive(roleCode) {
  return hasMinPurchaseRole(roleCode, 'manager');
}

function canCreateCostCorrection(roleCode) {
  return hasMinPurchaseRole(roleCode, 'accountant');
}

function canApproveCostCorrection(roleCode) {
  return hasMinPurchaseRole(roleCode, 'accountant');
}

function canExportPurchaseOrders(roleCode) {
  return hasMinPurchaseRole(roleCode, 'accountant');
}

function isZeroCostReceiveType(raw) {
  const t = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  return ZERO_COST_RECEIVE_TYPES.has(t);
}

function normalizeZeroCostReceiveType(raw) {
  const t = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  if (t === 'free_sample' || t === 'bonus_goods' || t === 'gratis') return t;
  return null;
}

/**
 * Payment status from paid vs total.
 * Negative remainder must NEVER be labeled PAID.
 */
function computePurchasePaymentStatus(paidAmount, totalAmount, currency = 'UZS') {
  const paid = Number(paidAmount) || 0;
  const total = Number(totalAmount) || 0;
  const tol = moneyTolerance(currency);
  if (paid <= 0) return 'UNPAID';
  const rem = total - paid;
  if (rem > tol) return 'PARTIALLY_PAID';
  if (Math.abs(rem) <= tol) return 'PAID';
  // paid > total without split — legacy / bug state
  return 'OVERPAID';
}

function computePurchaseRemainder(paidAmount, totalAmount) {
  const paid = Number(paidAmount) || 0;
  const total = Number(totalAmount) || 0;
  return {
    remainder: total - paid,
    debt: Math.max(0, total - paid),
    excess: Math.max(0, paid - total),
  };
}

/**
 * Split a payment into PO settlement + supplier advance excess.
 * @returns {{ settleAmount: number, advanceAmount: number, requiresAdvanceAck: boolean }}
 */
function splitPaymentAgainstRemainder(payAmount, remaining, currency = 'UZS') {
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

function parsePositiveQty(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    return { ok: false, error: 'quantity must be greater than 0' };
  }
  return { ok: true, qty: n };
}

function parsePositiveCost(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    return { ok: false, error: 'cost must be greater than 0' };
  }
  return { ok: true, cost: n };
}

/**
 * Confirm-receive validation (not draft).
 * Draft may be empty and must not affect stock/finance.
 */
function validateConfirmReceiveInput(input) {
  const errors = [];
  const supplierId = input?.supplier_id;
  if (!supplierId) errors.push('supplier_id is required');

  const items = Array.isArray(input?.items) ? input.items : [];
  if (items.length === 0) errors.push('at least one product is required');

  const docDate = String(input?.received_at || input?.doc_date || '').trim();
  if (!docDate) errors.push('document date is required');

  const currency = String(input?.currency || '').trim().toUpperCase();
  if (currency !== 'UZS' && currency !== 'USD') {
    errors.push('currency is required (UZS or USD)');
  }

  const receiveType = normalizeZeroCostReceiveType(input?.receive_type);
  const allowZeroCost = !!receiveType;
  if (allowZeroCost) {
    const reason = String(input?.zero_cost_reason || '').trim();
    if (!reason) errors.push('zero-cost receive requires a reason');
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
      currency === 'USD'
        ? it.unit_cost_usd ?? it.unit_cost
        : it.unit_cost ?? it.unit_cost_usd;
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

/**
 * receivable = ordered − alreadyReceived − inFlight
 */
function computeReceivableQty(ordered, alreadyReceived, inFlight = 0) {
  const o = Number(ordered) || 0;
  const a = Number(alreadyReceived) || 0;
  const f = Number(inFlight) || 0;
  return Math.max(0, o - a - f);
}

function assertReceivableAllows(qty, receivable, { code = 'CONFLICT' } = {}) {
  const q = Number(qty) || 0;
  const r = Number(receivable) || 0;
  if (q > r + 1e-9) {
    return {
      ok: false,
      code,
      error: `Receive qty (${q}) exceeds remaining (${r})`,
      available: r,
    };
  }
  return { ok: true, available: r };
}

/**
 * Cross-currency / FX revaluation delta in UZS for a settle amount booked on a PO.
 * Positive = payment FX higher than PO FX (extra UZS outflow / FX loss).
 * Returns null when no meaningful FX difference applies.
 */
function computeFxDiffAmount({
  settleAmountInPoCurrency,
  poCurrency,
  poFxRate,
  paymentFxRate,
}) {
  const settle = Number(settleAmountInPoCurrency);
  const poFx = Number(poFxRate);
  const payFx = Number(paymentFxRate);
  const cur = String(poCurrency || 'UZS').toUpperCase();
  if (!(settle > 0) || !(poFx > 0) || !(payFx > 0)) return null;
  if (cur !== 'USD') return null;
  const diff = Math.round(settle * (payFx - poFx) * 100) / 100;
  if (Math.abs(diff) < 0.5) return null;
  return diff;
}

module.exports = {
  ZERO_COST_RECEIVE_TYPES,
  PURCHASE_ROLE_RANK,
  MONEY_EPS_UZS,
  MONEY_EPS_USD,
  moneyTolerance,
  normalizePurchaseRole,
  pickPrimaryPurchaseRole,
  roleRank,
  hasMinPurchaseRole,
  canAcceptSupplierOverpayAsAdvance,
  canCancelSupplierPayment,
  canApproveZeroCostReceive,
  canCreateCostCorrection,
  canApproveCostCorrection,
  canExportPurchaseOrders,
  isZeroCostReceiveType,
  normalizeZeroCostReceiveType,
  computePurchasePaymentStatus,
  computePurchaseRemainder,
  splitPaymentAgainstRemainder,
  parsePositiveQty,
  parsePositiveCost,
  validateConfirmReceiveInput,
  computeReceivableQty,
  assertReceivableAllows,
  computeFxDiffAmount,
};

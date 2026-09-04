'use strict';

/**
 * Dual-bucket supplier settlement (debt vs advance), UZS/USD isolated.
 * Keep in sync with how SupplierService.getSettlement reads/writes remainders.
 */

const { moneyTolerance } = require('./purchaseHardening.cjs');

function normalizeSettlementCurrency(raw) {
  return String(raw || 'UZS').toUpperCase() === 'USD' ? 'USD' : 'UZS';
}

function cashSourceFromMethod(method) {
  const m = String(method || 'cash').trim().toLowerCase();
  if (m === 'cash' || m === 'naqd') return 'cash';
  if (m === 'transfer' || m === 'card' || m === 'click' || m === 'payme' || m === 'uzum' || m === 'bank') {
    return 'bank';
  }
  return m || 'cash';
}

function emptyBuckets() {
  return {
    debt_uzs: 0,
    debt_usd: 0,
    advance_uzs: 0,
    advance_usd: 0,
    pending_refund_uzs: 0,
    pending_refund_usd: 0,
    unallocated_uzs: 0,
    unallocated_usd: 0,
  };
}

function pickBucket(row, currency, field) {
  const cur = normalizeSettlementCurrency(currency);
  const key = `${field}_${cur.toLowerCase()}`;
  return Number(row?.[key] || 0) || 0;
}

function applyDelta(row, currency, field, delta) {
  const cur = normalizeSettlementCurrency(currency);
  const key = `${field}_${cur.toLowerCase()}`;
  const next = { ...row };
  next[key] = Math.max(0, (Number(next[key] || 0) || 0) + Number(delta || 0));
  return next;
}

/**
 * Preview a settlement mutation against already-computed buckets.
 * Does not touch the database.
 */
function previewSettlementMutation(settlement, { op_kind, amount, currency, accept_as_advance }) {
  const cur = normalizeSettlementCurrency(currency);
  const amt = Number(amount);
  const tol = moneyTolerance(cur);
  const beforeDebt = pickBucket(settlement, cur, 'debt');
  const beforeAdvance = pickBucket(settlement, cur, 'advance');
  const beforePending = pickBucket(settlement, cur, 'pending_refund');
  const usableAdvance = beforeAdvance + beforePending;

  const kind = String(op_kind || 'pay').trim().toLowerCase();
  let after = {
    debt: beforeDebt,
    advance: beforeAdvance,
    pending_refund: beforePending,
  };
  let advanceAmount = 0;
  let settleAmount = amt;
  let blocked = null;

  if (!(amt > 0)) {
    return {
      currency: cur,
      amount: amt,
      op_kind: kind,
      debt_before: beforeDebt,
      debt_after: beforeDebt,
      advance_before: beforeAdvance,
      advance_after: beforeAdvance,
      pending_refund_before: beforePending,
      pending_refund_after: beforePending,
      settle_amount: 0,
      advance_amount: 0,
      blocked: 'Summa 0 dan katta bo‘lishi kerak',
    };
  }

  if (kind === 'pay') {
    const cover = Math.min(amt, beforeDebt);
    settleAmount = cover;
    advanceAmount = Math.max(0, amt - cover);
    after.debt = Math.max(0, beforeDebt - cover);
    if (advanceAmount > tol) {
      if (!accept_as_advance) {
        blocked =
          'To‘lov qarzdan oshadi. Ortiqcha summani avans sifatida qabul qilish uchun tasdiqlang.';
      } else {
        after.advance = beforeAdvance + advanceAmount;
      }
    }
  } else if (kind === 'advance_out') {
    settleAmount = 0;
    advanceAmount = amt;
    after.advance = beforeAdvance + amt;
  } else if (kind === 'receive') {
    if (amt > usableAdvance + 1e-9) {
      blocked = `Refund avansdan oshadi (mavjud: ${usableAdvance}, so‘ralgan: ${amt})`;
    } else {
      let left = amt;
      const fromPending = Math.min(left, beforePending);
      after.pending_refund = Math.max(0, beforePending - fromPending);
      left -= fromPending;
      after.advance = Math.max(0, beforeAdvance - left);
    }
  } else if (kind === 'debit_note_reduce_debt') {
    if (amt > beforeDebt + tol) {
      blocked = `Qarz yetarli emas (qarz: ${beforeDebt}, qaytarish: ${amt}). Avans yoki refund tanlang.`;
    } else {
      after.debt = Math.max(0, beforeDebt - amt);
    }
  } else if (kind === 'debit_note_create_advance') {
    after.advance = beforeAdvance + amt;
  } else if (kind === 'debit_note_demand_refund') {
    after.pending_refund = beforePending + amt;
  }

  return {
    currency: cur,
    amount: amt,
    op_kind: kind,
    debt_before: beforeDebt,
    debt_after: after.debt,
    advance_before: beforeAdvance,
    advance_after: after.advance,
    pending_refund_before: beforePending,
    pending_refund_after: after.pending_refund,
    settle_amount: settleAmount,
    advance_amount: advanceAmount,
    blocked,
  };
}

module.exports = {
  normalizeSettlementCurrency,
  cashSourceFromMethod,
  emptyBuckets,
  pickBucket,
  applyDelta,
  previewSettlementMutation,
  moneyTolerance,
};

'use strict';

const DEFAULT_WALK_IN_CUSTOMER = 'default-customer-001';

/**
 * Aging bucket boundaries (calendar days, inclusive lower bound):
 * 0-7, 8-30, 31-60, 61+
 */
function bucketAgeDays(ageDays) {
  const d = Number(ageDays);
  if (!Number.isFinite(d) || d < 0) return '0_7';
  if (d <= 7) return '0_7';
  if (d <= 30) return '8_30';
  if (d <= 60) return '31_60';
  return '60_plus';
}

function initBuckets() {
  return { _0_7: 0, _8_30: 0, _31_60: 0, _60_plus: 0, total: 0 };
}

function addToBuckets(buckets, ageKey, amount) {
  const a = Number(amount) || 0;
  if (a <= 0) return buckets;
  buckets.total += a;
  if (ageKey === '0_7') buckets._0_7 += a;
  else if (ageKey === '8_30') buckets._8_30 += a;
  else if (ageKey === '31_60') buckets._31_60 += a;
  else buckets._60_plus += a;
  return buckets;
}

function bucketSum(buckets) {
  return (
    Number(buckets._0_7 || 0) +
    Number(buckets._8_30 || 0) +
    Number(buckets._31_60 || 0) +
    Number(buckets._60_plus || 0)
  );
}

/**
 * Apply a positive pool FIFO against open invoices (oldest first).
 * Mutates invoice.outstanding in place.
 * @returns {number} remaining unallocated pool
 */
function allocateFifoPool(invoices, poolAmount) {
  let available = Math.max(0, Number(poolAmount) || 0);
  if (available <= 0) return 0;
  for (const inv of invoices) {
    if (available <= 0) break;
    const outstanding = Number(inv.outstanding || 0) || 0;
    if (outstanding <= 0) continue;
    const apply = Math.min(outstanding, available);
    inv.outstanding = outstanding - apply;
    available -= apply;
  }
  return available;
}

/**
 * Build bucket totals from invoices with precomputed age_days.
 */
function bucketsFromInvoices(invoices, getAgeDays) {
  const buckets = initBuckets();
  for (const inv of invoices) {
    const amt = Number(inv.outstanding || 0) || 0;
    if (amt <= 0) continue;
    const ageDays = typeof getAgeDays === 'function' ? getAgeDays(inv) : Number(inv.age_days || 0);
    addToBuckets(buckets, bucketAgeDays(ageDays), amt);
  }
  return buckets;
}

function isOpenCreditPaymentStatus(status) {
  const ps = String(status || '').toLowerCase();
  return ps === 'on_credit' || ps === 'partial' || ps === 'partially_paid';
}

module.exports = {
  DEFAULT_WALK_IN_CUSTOMER,
  bucketAgeDays,
  initBuckets,
  addToBuckets,
  bucketSum,
  allocateFifoPool,
  bucketsFromInvoices,
  isOpenCreditPaymentStatus,
};

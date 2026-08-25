/**
 * Customer balance helpers (UZS + USD buckets).
 * Sign: negative = debt, positive = prepaid (same as legacy customers.balance).
 */

const { paymentAmountUzsSql } = require('./orderAmount.cjs');

function _cols(db, table) {
  try {
    return new Set((db.prepare(`PRAGMA table_info(${table})`).all() || []).map((c) => c.name));
  } catch {
    return new Set();
  }
}

function hasCustomerBalanceUsd(db) {
  return _cols(db, 'customers').has('balance_usd');
}

function hasCustomerPaymentCurrency(db) {
  return _cols(db, 'customer_payments').has('currency');
}

function hasCustomerLedgerCurrency(db) {
  return _cols(db, 'customer_ledger').has('currency');
}

function normalizeCustomerCurrency(value, fallback = 'UZS') {
  return String(value || fallback).trim().toUpperCase() === 'USD' ? 'USD' : 'UZS';
}

function balanceColumn(currency) {
  return normalizeCustomerCurrency(currency) === 'USD' ? 'balance_usd' : 'balance';
}

function readCustomerBalances(db, customerId) {
  const hasUsd = hasCustomerBalanceUsd(db);
  const row = db
    .prepare(
      `SELECT balance${hasUsd ? ', balance_usd' : ''} FROM customers WHERE id = ?`
    )
    .get(customerId);
  return {
    uzs: Number(row?.balance || 0) || 0,
    usd: hasUsd ? Number(row?.balance_usd || 0) || 0 : 0,
  };
}

function readBalanceInCurrency(db, customerId, currency) {
  const b = readCustomerBalances(db, customerId);
  return normalizeCustomerCurrency(currency) === 'USD' ? b.usd : b.uzs;
}

function _hasCustomerLedgerTable(db) {
  try {
    return !!db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='customer_ledger'`)
      .get();
  } catch {
    return false;
  }
}

/** True when a ledger row already recorded this ref_id (replay guard). */
function hasCustomerLedgerRef(db, refId) {
  if (!refId || !_hasCustomerLedgerTable(db)) return false;
  const row = db
    .prepare(`SELECT 1 AS ok FROM customer_ledger WHERE ref_id = ? LIMIT 1`)
    .get(String(refId));
  return !!row;
}

function applyCustomerBalanceDelta(db, customerId, signedDelta, currency, updatedAt) {
  const cur = normalizeCustomerCurrency(currency);
  const col = balanceColumn(cur);
  if (cur === 'USD' && !hasCustomerBalanceUsd(db)) {
    throw new Error('customers.balance_usd is required for USD customer balance updates');
  }
  db.prepare(`UPDATE customers SET ${col} = ${col} + ?, updated_at = ? WHERE id = ?`).run(
    Number(signedDelta) || 0,
    updatedAt,
    customerId
  );
  return readCustomerBalances(db, customerId);
}

/**
 * Apply a signed balance delta once per ref_id. Skips when customer_ledger
 * already contains the ref_id (idempotent replay protection).
 * @returns {{ applied: boolean, balances: { uzs: number, usd: number } }}
 */
function applyCustomerBalanceDeltaOnce(db, customerId, signedDelta, currency, refId, updatedAt) {
  if (refId && hasCustomerLedgerRef(db, refId)) {
    return { applied: false, balances: readCustomerBalances(db, customerId) };
  }
  const balances = applyCustomerBalanceDelta(
    db,
    customerId,
    signedDelta,
    currency,
    updatedAt || new Date().toISOString()
  );
  return { applied: true, balances };
}

/** UZS equivalent for customer.total_sales stat increment. */
function orderSalesStatUzs(order) {
  const cur = normalizeCustomerCurrency(order?.currency);
  const total = Number(order?.total_amount || 0) || 0;
  if (cur === 'USD') {
    const fx = Number(order?.fx_rate || 0) || 0;
    return fx > 0 ? total * fx : 0;
  }
  return total;
}

function orderIsUsdExpr(alias = 'o') {
  return `UPPER(TRIM(COALESCE(${alias}.currency, 'UZS'))) = 'USD'`;
}

function orderOutstandingExpr(db, orderAlias = 'o', paymentAlias = 'p') {
  const isUsd = orderIsUsdExpr(orderAlias);
  const payUzs = paymentAmountUzsSql(db, paymentAlias, orderAlias);
  return {
    totalExpr: `COALESCE(${orderAlias}.total_amount, 0)`,
    paidExpr: `CASE WHEN ${isUsd} THEN COALESCE(${paymentAlias}.amount, 0) ELSE ${payUzs} END`,
  };
}

/**
 * Outstanding credit for a sale after authoritative order total is known.
 * Uses recalculated orders.total_amount (not POS-declared total) so ledger
 * and credit_amount stay aligned with order detail.
 */
/**
 * Convert a checkout payment into the sale currency.
 * Mixed USD sale + UZS tender (or the reverse) requires a positive fx_rate (UZS per 1 USD).
 * Payments without currency stay in the sale currency (legacy POS clients).
 */
function paymentAmountInSaleCurrency(payment, saleCurrency, fxRate) {
  const saleCur = normalizeCustomerCurrency(saleCurrency);
  const rawCur = payment && payment.currency != null ? String(payment.currency).trim() : '';
  const payCur = rawCur ? normalizeCustomerCurrency(rawCur) : saleCur;
  const amt = Number(payment?.amount || 0) || 0;
  if (payCur === saleCur) return amt;
  const fx = Number(fxRate || 0);
  if (!(Number.isFinite(fx) && fx > 0)) {
    const err = new Error('fx_rate is required to convert mixed USD/UZS payment');
    err.code = 'VALIDATION_ERROR';
    throw err;
  }
  if (saleCur === 'USD' && payCur === 'UZS') return amt / fx;
  if (saleCur === 'UZS' && payCur === 'USD') return amt * fx;
  return amt;
}

function computeSaleCreditAmount(orderTotal, paidIntake, prepaidApplied = 0, eps = 0.02) {
  const total = Number(orderTotal || 0);
  const paid = Math.max(0, Number(paidIntake || 0));
  const prepaid = Math.max(0, Number(prepaidApplied || 0));
  if (total <= eps) return 0;
  return Math.max(0, total - paid - prepaid);
}

/**
 * Checkout / receive-payment: credit_amount must match total − paid (− prepaid).
 * @returns {number} expected credit
 */
function assertCreditAmountAligned(
  orderTotal,
  paidIntake,
  creditAmount,
  prepaidApplied = 0,
  eps = 0.02
) {
  const expected = computeSaleCreditAmount(orderTotal, paidIntake, prepaidApplied, eps);
  const credit = Math.max(0, Number(creditAmount || 0));
  if (Math.abs(credit - expected) > eps) {
    const err = new Error(
      `credit_amount (${credit}) must equal total_amount − paid_amount (${expected})`
    );
    err.code = 'VALIDATION_ERROR';
    throw err;
  }
  return expected;
}

function _ledgerHasCurrency(db) {
  return hasCustomerLedgerCurrency(db);
}

/**
 * Compare SUM(customer_ledger.amount) vs customers.balance / balance_usd.
 */
function reconcileCustomerLedgerVsBalance(db, options = {}) {
  const eps = Number(options.eps) > 0 ? Number(options.eps) : 0.02;
  const diffs = [];
  if (!_hasCustomerLedgerTable(db)) {
    return { diffs, checked: 0 };
  }
  const hasUsd = hasCustomerBalanceUsd(db);
  const hasLedCur = _ledgerHasCurrency(db);
  const customers = db
    .prepare(
      `SELECT id, name, phone, balance${hasUsd ? ', balance_usd' : ''} FROM customers`
    )
    .all();
  const ledgerSql = hasLedCur
    ? `
      SELECT
        customer_id,
        COALESCE(SUM(CASE WHEN UPPER(TRIM(COALESCE(currency, 'UZS'))) = 'USD' THEN 0 ELSE amount END), 0) AS ledger_uzs,
        COALESCE(SUM(CASE WHEN UPPER(TRIM(COALESCE(currency, 'UZS'))) = 'USD' THEN amount ELSE 0 END), 0) AS ledger_usd
      FROM customer_ledger
      GROUP BY customer_id
    `
    : `
      SELECT
        customer_id,
        COALESCE(SUM(amount), 0) AS ledger_uzs,
        0 AS ledger_usd
      FROM customer_ledger
      GROUP BY customer_id
    `;
  const ledgerByCustomer = new Map();
  for (const row of db.prepare(ledgerSql).all() || []) {
    ledgerByCustomer.set(row.customer_id, row);
  }
  for (const c of customers || []) {
    const led = ledgerByCustomer.get(c.id) || { ledger_uzs: 0, ledger_usd: 0 };
    const storedUzs = Number(c.balance || 0) || 0;
    const storedUsd = hasUsd ? Number(c.balance_usd || 0) || 0 : 0;
    const ledgerUzs = Number(led.ledger_uzs || 0) || 0;
    const ledgerUsd = Number(led.ledger_usd || 0) || 0;
    if (Math.abs(storedUzs - ledgerUzs) > eps || (hasUsd && Math.abs(storedUsd - ledgerUsd) > eps)) {
      diffs.push({
        customer_id: c.id,
        customer_name: c.name || c.id,
        phone: c.phone || '',
        stored_uzs: storedUzs,
        ledger_uzs: ledgerUzs,
        diff_uzs: ledgerUzs - storedUzs,
        stored_usd: storedUsd,
        ledger_usd: ledgerUsd,
        diff_usd: ledgerUsd - storedUsd,
      });
    }
  }
  return { diffs, checked: (customers || []).length };
}

module.exports = {
  hasCustomerBalanceUsd,
  hasCustomerPaymentCurrency,
  hasCustomerLedgerCurrency,
  normalizeCustomerCurrency,
  balanceColumn,
  readCustomerBalances,
  readBalanceInCurrency,
  hasCustomerLedgerRef,
  applyCustomerBalanceDelta,
  applyCustomerBalanceDeltaOnce,
  orderSalesStatUzs,
  orderIsUsdExpr,
  orderOutstandingExpr,
  computeSaleCreditAmount,
  assertCreditAmountAligned,
  reconcileCustomerLedgerVsBalance,
  paymentAmountInSaleCurrency,
};

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

module.exports = {
  hasCustomerBalanceUsd,
  hasCustomerPaymentCurrency,
  hasCustomerLedgerCurrency,
  normalizeCustomerCurrency,
  balanceColumn,
  readCustomerBalances,
  readBalanceInCurrency,
  applyCustomerBalanceDelta,
  orderSalesStatUzs,
  orderIsUsdExpr,
  orderOutstandingExpr,
};

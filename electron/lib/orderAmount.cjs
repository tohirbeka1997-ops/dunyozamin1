/**
 * Order / payment amount helpers for SQL aggregates (UZS equivalent vs split buckets).
 * Semantics: fx_rate on orders = UZS per 1 USD; inventory COGS stays UZS.
 */

function hasOrderCol(db, name) {
  if (!db) return false;
  try {
    return !!db
      .prepare(`SELECT 1 AS ok FROM pragma_table_info('orders') WHERE name = ? LIMIT 1`)
      .get(name)?.ok;
  } catch {
    return false;
  }
}

/** Single-row expression: numeric order field in UZS (USD rows × fx_rate). */
function orderFieldUzsSql(db, alias, fieldName) {
  const a = alias || 'o';
  const f = fieldName || 'total_amount';
  if (!hasOrderCol(db, 'currency')) {
    return `COALESCE(${a}.${f}, 0)`;
  }
  return `CASE
    WHEN UPPER(TRIM(COALESCE(${a}.currency, 'UZS'))) = 'USD'
      THEN COALESCE(${a}.${f}, 0) * COALESCE(${a}.fx_rate, 0)
    ELSE COALESCE(${a}.${f}, 0)
  END`;
}

/** Single-row expression: order total in UZS (USD rows × fx_rate). */
function orderAmountUzsSql(db, alias = 'o') {
  return orderFieldUzsSql(db, alias, 'total_amount');
}

/** SUM(...) fragments for split sales buckets (document currency, not converted). */
function orderSalesSplitExpressions(db, alias = 'o') {
  const a = alias || 'o';
  if (!hasOrderCol(db, 'currency')) {
    return {
      uzsSum: `COALESCE(SUM(COALESCE(${a}.total_amount, 0)), 0)`,
      usdSum: `0`,
    };
  }
  return {
    uzsSum: `COALESCE(SUM(CASE
      WHEN UPPER(TRIM(COALESCE(${a}.currency, 'UZS'))) = 'USD' THEN 0
      ELSE COALESCE(${a}.total_amount, 0)
    END), 0)`,
    usdSum: `COALESCE(SUM(CASE
      WHEN UPPER(TRIM(COALESCE(${a}.currency, 'UZS'))) = 'USD'
      THEN COALESCE(${a}.total_amount, 0)
      ELSE 0
    END), 0)`,
  };
}

/**
 * Refund / return amount in UZS (uses linked order currency when available).
 * @param amountExpr SQL fragment for refund amount, e.g. COALESCE(r.refund_amount, r.total_amount, 0)
 */
function returnRefundUzsSql(db, returnAlias = 'r', orderAlias = 'o', amountExpr) {
  const r = returnAlias || 'r';
  const o = orderAlias || 'o';
  const amt =
    amountExpr || `COALESCE(${r}.refund_amount, ${r}.total_amount, 0)`;
  if (!hasOrderCol(db, 'currency')) {
    return amt;
  }
  return `CASE
    WHEN ${o}.id IS NOT NULL AND UPPER(TRIM(COALESCE(${o}.currency, 'UZS'))) = 'USD'
      THEN (${amt}) * COALESCE(${o}.fx_rate, 0)
    ELSE (${amt})
  END`;
}

/**
 * Amount expression tied to order currency (e.g. oi.line_total on orders o).
 * @param {string} amountExpr SQL fragment, e.g. oi.line_total
 */
function orderLinkedFieldUzsSql(db, orderAlias = 'o', amountExpr = '0') {
  const o = orderAlias || 'o';
  const expr = amountExpr || '0';
  if (!hasOrderCol(db, 'currency')) {
    return `COALESCE(${expr}, 0)`;
  }
  return `CASE
    WHEN UPPER(TRIM(COALESCE(${o}.currency, 'UZS'))) = 'USD'
      THEN COALESCE(${expr}, 0) * COALESCE(${o}.fx_rate, 0)
    ELSE COALESCE(${expr}, 0)
  END`;
}

/** Customer payment (AR) in UZS — USD rows × fx_rate on customer_payments. */
function customerPaymentAmountUzsSql(db, cpAlias = 'cp') {
  const cp = cpAlias || 'cp';
  let hasCur = false;
  try {
    hasCur = !!db
      .prepare(`SELECT 1 AS ok FROM pragma_table_info('customer_payments') WHERE name = 'currency' LIMIT 1`)
      .get()?.ok;
  } catch {
    hasCur = false;
  }
  if (!hasCur) {
    return `COALESCE(${cp}.amount, 0)`;
  }
  return `CASE
    WHEN UPPER(TRIM(COALESCE(${cp}.currency, 'UZS'))) = 'USD'
      THEN COALESCE(${cp}.amount, 0) * COALESCE(${cp}.fx_rate, 0)
    ELSE COALESCE(${cp}.amount, 0)
  END`;
}

/** SUM(...) fragments for payment buckets split by parent order currency. */
function paymentSalesSplitExpressions(db, paymentAlias = 'p', orderAlias = 'o') {
  const p = paymentAlias || 'p';
  const o = orderAlias || 'o';
  const skipRefund = `LOWER(TRIM(COALESCE(${p}.payment_method, ''))) IN ('refund_cash', 'refund_balance')`;
  if (!hasOrderCol(db, 'currency')) {
    return {
      uzsSum: `COALESCE(SUM(CASE WHEN ${skipRefund} THEN 0 ELSE COALESCE(${p}.amount, 0) END), 0)`,
      usdSum: `0`,
    };
  }
  return {
    uzsSum: `COALESCE(SUM(CASE
      WHEN ${skipRefund} THEN 0
      WHEN UPPER(TRIM(COALESCE(${o}.currency, 'UZS'))) = 'USD' THEN 0
      ELSE COALESCE(${p}.amount, 0)
    END), 0)`,
    usdSum: `COALESCE(SUM(CASE
      WHEN ${skipRefund} THEN 0
      WHEN UPPER(TRIM(COALESCE(${o}.currency, 'UZS'))) = 'USD' THEN COALESCE(${p}.amount, 0)
      ELSE 0
    END), 0)`,
  };
}

/** Payment line in UZS (uses parent order currency + fx_rate). */
function paymentAmountUzsSql(db, paymentAlias = 'p', orderAlias = 'o') {
  const p = paymentAlias || 'p';
  const o = orderAlias || 'o';
  if (!hasOrderCol(db, 'currency')) {
    return `COALESCE(${p}.amount, 0)`;
  }
  return `CASE
    WHEN UPPER(TRIM(COALESCE(${o}.currency, 'UZS'))) = 'USD'
      THEN COALESCE(${p}.amount, 0) * COALESCE(${o}.fx_rate, 0)
    ELSE COALESCE(${p}.amount, 0)
  END`;
}

module.exports = {
  hasOrderCol,
  orderFieldUzsSql,
  orderLinkedFieldUzsSql,
  orderAmountUzsSql,
  orderSalesSplitExpressions,
  returnRefundUzsSql,
  customerPaymentAmountUzsSql,
  paymentAmountUzsSql,
  paymentSalesSplitExpressions,
};

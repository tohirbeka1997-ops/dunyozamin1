/**
 * Expense amount helpers for SQL aggregates (UZS equivalent vs split buckets).
 */

function hasExpenseCol(db, name) {
  if (!db) return false;
  try {
    return !!db
      .prepare(`SELECT 1 AS ok FROM pragma_table_info('expenses') WHERE name = ? LIMIT 1`)
      .get(name)?.ok;
  } catch {
    return false;
  }
}

/** Single expression: expense amount in UZS (USD rows × fx_rate). */
function expenseAmountUzsSql(db, alias = 'e') {
  const a = alias || 'e';
  if (!hasExpenseCol(db, 'currency')) {
    return `COALESCE(${a}.amount, 0)`;
  }
  return `CASE
    WHEN UPPER(TRIM(COALESCE(${a}.currency, 'UZS'))) = 'USD'
      THEN COALESCE(${a}.amount, 0) * COALESCE(${a}.fx_rate, 0)
    ELSE COALESCE(${a}.amount, 0)
  END`;
}

module.exports = { hasExpenseCol, expenseAmountUzsSql };

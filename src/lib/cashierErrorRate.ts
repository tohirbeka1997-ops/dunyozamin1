/**
 * Cashier error-rate formulas used by reports (TZ: weighted vs simple average).
 */

export type CashierErrorInput = {
  total_sales: number;
  cancelled_count: number;
  returns_count: number;
};

/** (cancels + returns) / completed orders × 100 */
export function cashierWeightedErrorRate(row: CashierErrorInput): number {
  const completed = Number(row.total_sales) || 0;
  const errors = (Number(row.cancelled_count) || 0) + (Number(row.returns_count) || 0);
  if (completed <= 0) return 0;
  return (errors / completed) * 100;
}

/** Simple mean of per-cashier weighted rates (for comparison KPI). */
export function cashierAverageErrorRate(rows: CashierErrorInput[]): number {
  if (!rows.length) return 0;
  const sum = rows.reduce((acc, r) => acc + cashierWeightedErrorRate(r), 0);
  return sum / rows.length;
}

/** Portfolio-level weighted rate across all cashiers. */
export function cashierPortfolioErrorRate(rows: CashierErrorInput[]): number {
  const completed = rows.reduce((s, r) => s + (Number(r.total_sales) || 0), 0);
  const errors = rows.reduce(
    (s, r) => s + (Number(r.cancelled_count) || 0) + (Number(r.returns_count) || 0),
    0,
  );
  if (completed <= 0) return 0;
  return (errors / completed) * 100;
}

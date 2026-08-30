import test from 'node:test';
import assert from 'node:assert/strict';

function cashierWeightedErrorRate(row) {
  const completed = Number(row.total_sales) || 0;
  const errors = (Number(row.cancelled_count) || 0) + (Number(row.returns_count) || 0);
  if (completed <= 0) return 0;
  return (errors / completed) * 100;
}

function cashierAverageErrorRate(rows) {
  if (!rows.length) return 0;
  return rows.reduce((acc, r) => acc + cashierWeightedErrorRate(r), 0) / rows.length;
}

function cashierPortfolioErrorRate(rows) {
  const completed = rows.reduce((s, r) => s + (Number(r.total_sales) || 0), 0);
  const errors = rows.reduce(
    (s, r) => s + (Number(r.cancelled_count) || 0) + (Number(r.returns_count) || 0),
    0,
  );
  if (completed <= 0) return 0;
  return (errors / completed) * 100;
}

test('cashierWeightedErrorRate uses completed orders as denominator', () => {
  assert.equal(cashierWeightedErrorRate({ total_sales: 100, cancelled_count: 5, returns_count: 3 }), 8);
});

test('portfolio vs average differ when volumes differ', () => {
  const rows = [
    { total_sales: 100, cancelled_count: 5, returns_count: 0 },
    { total_sales: 10, cancelled_count: 0, returns_count: 2 },
  ];
  const portfolio = cashierPortfolioErrorRate(rows);
  const average = cashierAverageErrorRate(rows);
  assert.ok(Math.abs(portfolio - 6.363636) < 0.01);
  assert.ok(Math.abs(average - 12.5) < 0.01);
});

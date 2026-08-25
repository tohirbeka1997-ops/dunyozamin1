'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyAbcRows } = require('./abcAnalysis.cjs');

test('ABC: bitta mahsulot 100% → A', () => {
  const { rows, summary } = classifyAbcRows([{ product_id: '1', product_name: 'X', sales_amount: 1000 }]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].abc_class, 'A');
  assert.equal(rows[0].share_pct, 100);
  assert.equal(rows[0].cumulative_pct, 100);
  assert.equal(summary.a.count, 1);
  assert.equal(summary.b.count, 0);
  assert.equal(summary.c.count, 0);
});

test('ABC: kumulativ 80/95 chegaralari', () => {
  // 70 + 15 + 10 + 5 = 100
  const { rows, summary } = classifyAbcRows([
    { product_id: 'a', product_name: 'A1', sales_amount: 70 },
    { product_id: 'b', product_name: 'B1', sales_amount: 15 },
    { product_id: 'c', product_name: 'C1', sales_amount: 10 },
    { product_id: 'd', product_name: 'D1', sales_amount: 5 },
  ]);

  assert.deepEqual(
    rows.map((r) => [r.product_id, r.abc_class, r.cumulative_pct]),
    [
      ['a', 'A', 70],
      ['b', 'A', 85], // prevCum 70 < 80 → A (chegarani kesib o‘tadi)
      ['c', 'B', 95], // prevCum 85 < 95 → B
      ['d', 'C', 100],
    ]
  );
  assert.equal(summary.a.count, 2);
  assert.equal(summary.b.count, 1);
  assert.equal(summary.c.count, 1);
  assert.equal(summary.a.revenue_share_pct, 85);
  assert.equal(summary.b.revenue_share_pct, 10);
  assert.equal(summary.c.revenue_share_pct, 5);
});

test('ABC: nol yoki manfiy summa filtrlanadi', () => {
  const { rows } = classifyAbcRows([
    { product_id: '1', sales_amount: 0 },
    { product_id: '2', sales_amount: -10 },
    { product_id: '3', sales_amount: 50 },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].product_id, '3');
  assert.equal(rows[0].abc_class, 'A');
});

test('ABC: bo‘sh ro‘yxat', () => {
  const { rows, summary } = classifyAbcRows([]);
  assert.equal(rows.length, 0);
  assert.equal(summary.total_revenue, 0);
  assert.equal(summary.a.count, 0);
});

test('ABC: teng summalar — barqaror tartib (nom)', () => {
  const { rows } = classifyAbcRows([
    { product_id: '2', product_name: 'Beta', sales_amount: 50 },
    { product_id: '1', product_name: 'Alpha', sales_amount: 50 },
  ]);
  assert.deepEqual(
    rows.map((r) => [r.product_id, r.abc_class, r.rank]),
    [
      ['1', 'A', 1],
      ['2', 'A', 2],
    ]
  );
});

test('ABC getAbcAnalysis: POS savat qaytarishlari chiqariladi (regressiya)', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '../services/reportsService.cjs'), 'utf8');
  const start = src.indexOf('getAbcAnalysis(filters');
  assert.ok(start >= 0, 'getAbcAnalysis topilmadi');
  const end = src.indexOf('getLatestPurchaseCosts', start);
  assert.ok(end > start, 'getAbcAnalysis tugashi topilmadi');
  const body = src.slice(start, end);
  assert.match(body, /posCartReturnExcludeWhere/);
  assert.match(body, /GROUP BY oi\.product_id/);
  assert.match(body, /product_id IN \(\$\{placeholders\}\)/);
});

test('getProductSalesReport: POS savat qaytarishlari chiqariladi (regressiya)', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '../services/reportsService.cjs'), 'utf8');
  const start = src.indexOf('getProductSalesReport(filters');
  assert.ok(start >= 0, 'getProductSalesReport topilmadi');
  const end = src.indexOf('getAbcAnalysis(filters', start);
  assert.ok(end > start, 'getProductSalesReport tugashi topilmadi');
  const body = src.slice(start, end);
  assert.match(body, /posCartReturnExcludeWhere/);
  assert.match(body, /GROUP BY oi\.product_id/);
});

test('getCustomerSalesReport: POS savat qaytarishlari + customers.balance (regressiya)', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '../services/reportsService.cjs'), 'utf8');
  const start = src.indexOf('getCustomerSalesReport(filters');
  assert.ok(start >= 0, 'getCustomerSalesReport topilmadi');
  const end = src.indexOf('getBatchReconciliation(filters', start);
  assert.ok(end > start, 'getCustomerSalesReport tugashi topilmadi');
  const body = src.slice(start, end);
  assert.match(body, /posCartReturnExcludeWhere/);
  assert.match(body, /unifiedAmountUzsSql|salesFrom|_salesTable/);
  assert.match(body, /c\.balance/);
  assert.doesNotMatch(body, /SUM\(\s*COALESCE\(o\.credit_amount/);
});

test('getPromotionUsageReport: completed orders + POS qaytarishlari (regressiya)', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '../services/reportsService.cjs'), 'utf8');
  const start = src.indexOf('getPromotionUsageReport(filters');
  assert.ok(start >= 0, 'getPromotionUsageReport topilmadi');
  const end = src.indexOf('getProductSalesReport(filters', start);
  assert.ok(end > start, 'getPromotionUsageReport tugashi topilmadi');
  const body = src.slice(start, end);
  assert.match(body, /posCartReturnExcludeWhere/);
  assert.match(body, /promotion_usage/);
  assert.match(body, /o\.status = 'completed'/);
});

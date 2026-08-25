const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * Mirrors src/lib/currency.ts PO received helpers (CJS smoke without TS compile).
 */
function normalizeCurrency(value, fallback = 'UZS') {
  return String(value || fallback).trim().toUpperCase() === 'USD' ? 'USD' : 'UZS';
}

function calculatePoReceivedAmountUzs(items) {
  if (!items?.length) return 0;
  return items.reduce((sum, item) => {
    const rq = Number(item.received_qty) || 0;
    const uc = Number(item.landed_unit_cost ?? item.unit_cost) || 0;
    return sum + rq * uc;
  }, 0);
}

function calculatePoReceivedDocAmount(po, items) {
  if (!items?.length) return 0;
  const cur = normalizeCurrency(po?.currency, 'UZS');
  return items.reduce((sum, item) => {
    const rq = Number(item.received_qty) || 0;
    if (rq <= 0) return sum;
    const oq = Number(item.ordered_qty) || 0;
    if (cur === 'USD') {
      const unitUsd = Number(item.unit_cost_usd);
      if (Number.isFinite(unitUsd) && Math.abs(unitUsd) > 0) return sum + rq * unitUsd;
      const ltUsd = Number(item.line_total_usd ?? NaN);
      if (Number.isFinite(ltUsd) && oq > 0) return sum + ltUsd * (rq / oq);
      return sum;
    }
    const lt = Number(item.line_total) || 0;
    if (oq > 0 && Math.abs(lt) > 0) return sum + lt * (rq / oq);
    return sum + rq * (Number(item.unit_cost) || 0);
  }, 0);
}

test('USD PO: ombor UZS ≠ hujjat USD (apples ≠ oranges)', () => {
  const po = { currency: 'USD', total_usd: 24.89 };
  const items = [
    {
      ordered_qty: 1,
      received_qty: 1,
      unit_cost: 312216,
      unit_cost_usd: 24.89,
      line_total_usd: 24.89,
    },
  ];
  const wh = calculatePoReceivedAmountUzs(items);
  const doc = calculatePoReceivedDocAmount(po, items);
  assert.ok(wh > 300000);
  assert.ok(Math.abs(doc - 24.89) < 0.01);
  assert.notEqual(wh, doc);
});

test('UZS PO: qabul hujjat = prorate line_total', () => {
  const po = { currency: 'UZS', total_amount: 100000 };
  const items = [
    { ordered_qty: 10, received_qty: 6, unit_cost: 10000, line_total: 100000 },
  ];
  assert.strictEqual(calculatePoReceivedDocAmount(po, items), 60000);
  assert.strictEqual(calculatePoReceivedAmountUzs(items), 60000);
});

test('landed cost oshiradi ombor UZS, hujjat o‘zgarmaydi', () => {
  const po = { currency: 'UZS', total_amount: 50000 };
  const items = [
    {
      ordered_qty: 10,
      received_qty: 10,
      unit_cost: 5000,
      landed_unit_cost: 5560,
      line_total: 50000,
    },
  ];
  assert.strictEqual(calculatePoReceivedDocAmount(po, items), 50000);
  assert.strictEqual(calculatePoReceivedAmountUzs(items), 55600);
});

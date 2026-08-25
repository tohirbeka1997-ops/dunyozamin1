/**
 * reportProfit: line_profit NaN must not collapse accumulated profit.
 * Run: node --test src/lib/__tests__/reportProfit.node.test.mjs
 */
import assert from 'node:assert/strict';
import test from 'node:test';

// Mirrors src/lib/reportProfit.ts (plain JS for node:test without TS loader)
function finiteOrZero(n) {
  return Number.isFinite(n) ? n : 0;
}

function addLineProfit(sum, lineProfit) {
  return sum + finiteOrZero(Number(lineProfit));
}

function calculateOrderProfit(order, opts = {}) {
  if (opts.useExplicitProfit !== false) {
    const explicit = order.profit;
    if (explicit != null) return finiteOrZero(Number(explicit));
  }

  const items = order.items || [];
  const resolveUnitCost =
    opts.resolveUnitCost ?? ((item) => Number(item.cost_price ?? 0) || 0);

  if (items.length > 0) {
    return items.reduce((sum, item) => {
      const qty = Number(item.quantity || 0);
      const qtyBase = Number(item.qty_base ?? qty) || qty;
      const soldLine =
        Number(item.final_total ?? 0) ||
        Number(item.line_total ?? 0) ||
        Number(item.unit_price || 0) * qty - Number(item.discount_amount || 0);
      const unitCost = resolveUnitCost(item);
      const signedProfit = soldLine - unitCost * qtyBase;
      if (item.line_profit != null && qty >= 0 && qtyBase >= 0) {
        return addLineProfit(sum, item.line_profit);
      }
      return sum + signedProfit;
    }, 0);
  }

  const totalCost = items.reduce((sum, item) => {
    const qty = Number(item.quantity || 0);
    const unitCost = resolveUnitCost(item);
    const qtyBase = Number(item.qty_base ?? qty) || qty;
    return sum + unitCost * qtyBase;
  }, 0);
  return Number(order.total_amount) - totalCost;
}

test('addLineProfit: NaN line_profit does not collapse prior sum', () => {
  assert.equal(addLineProfit(100, 'not-a-number'), 100);
  assert.equal(addLineProfit(50, NaN), 50);
  assert.equal(addLineProfit(10, undefined), 10);
});

test('addLineProfit: finite values accumulate', () => {
  assert.equal(addLineProfit(100, 25), 125);
  assert.equal(addLineProfit(0, '12.5'), 12.5);
});

test('calculateOrderProfit: NaN line_profit mid-order keeps prior line profits', () => {
  const order = {
    items: [
      { quantity: 1, line_profit: 100 },
      { quantity: 1, line_profit: 'bad' },
      { quantity: 1, line_profit: 50 },
    ],
  };
  // Old buggy form: (sum + Number(lp)) || 0 → would return 0 after the bad line
  assert.equal(calculateOrderProfit(order, { useExplicitProfit: false }), 150);
});

test('calculateOrderProfit: prefers explicit order.profit when finite', () => {
  assert.equal(
    calculateOrderProfit({ profit: 999, items: [{ quantity: 1, line_profit: 1 }] }),
    999
  );
});

test('calculateOrderProfit: falls back to soldLine - cost when no line_profit', () => {
  const order = {
    items: [
      {
        quantity: 2,
        unit_price: 100,
        discount_amount: 0,
        cost_price: 40,
        qty_base: 2,
      },
    ],
  };
  // soldLine = 100*2 = 200, cost = 40*2 = 80 → 120
  assert.equal(calculateOrderProfit(order, { useExplicitProfit: false }), 120);
});

test('calculateOrderProfit: negative qty ignores stored line_profit (legacy Math.abs bug)', () => {
  const order = {
    items: [
      {
        quantity: -1,
        qty_base: -1,
        line_total: -10000,
        final_total: -10000,
        cost_price: 4000,
        line_profit: -14000, // buggy: revenue - cost * abs(qty)
      },
    ],
  };
  assert.equal(calculateOrderProfit(order, { useExplicitProfit: false }), -6000);
});

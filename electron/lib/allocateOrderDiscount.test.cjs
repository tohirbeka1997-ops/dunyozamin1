'use strict';

const assert = require('assert');
const { allocateOrderDiscountOntoItems } = require('./allocateOrderDiscount.cjs');

const two = allocateOrderDiscountOntoItems(
  [
    { unit_price: 10000, quantity: 1, discount_amount: 0, line_total: 10000 },
    { unit_price: 10000, quantity: 1, discount_amount: 0, line_total: 10000 },
  ],
  3000,
);
assert.strictEqual(two[0].final_total + two[1].final_total, 17000);
assert.ok(Math.abs(two[0].discount_amount + two[1].discount_amount - 3000) < 0.02);

const alreadyNet = allocateOrderDiscountOntoItems(
  [{ unit_price: 10000, quantity: 1, discount_amount: 2000, line_total: 8000, final_total: 8000 }],
  2000,
);
assert.strictEqual(alreadyNet[0].final_total, 8000);

const qtyOnlyInput = allocateOrderDiscountOntoItems(
  [{ product_id: 'p1', quantity: 2, discount_amount: 0 }],
  0,
);
assert.strictEqual(qtyOnlyInput[0].final_total, undefined);

console.log('allocateOrderDiscount.test.cjs: all passed');

'use strict';

const assert = require('assert');
const {
  computePaymentFee,
  classifyPaymentMethodGroup,
  skipFeeForMethod,
} = require('./paymentFee.cjs');
const { calculateNetProfit } = require('./unifiedSalesSql.cjs');

assert.strictEqual(computePaymentFee(10000, 2, 0), 200);
assert.strictEqual(computePaymentFee(10000, 0, 150), 150);
assert.strictEqual(computePaymentFee(10000, 1.5, 50), 200);
assert.strictEqual(computePaymentFee(0, 2, 10), 0);

assert.strictEqual(classifyPaymentMethodGroup('cash'), 'cash');
assert.strictEqual(classifyPaymentMethodGroup('card'), 'bank');
assert.strictEqual(classifyPaymentMethodGroup('payme'), 'bank');
assert.strictEqual(classifyPaymentMethodGroup('click'), 'bank');
assert.strictEqual(classifyPaymentMethodGroup('transfer'), 'bank');
assert.strictEqual(classifyPaymentMethodGroup('credit'), 'credit');

assert.strictEqual(skipFeeForMethod('cash'), true);
assert.strictEqual(skipFeeForMethod('credit'), true);
assert.strictEqual(skipFeeForMethod('card'), false);

assert.strictEqual(
  calculateNetProfit({
    grossProfit: 100,
    returnsRevenue: 20,
    returnsCogs: 8,
    expenses: 5,
    commission: 3,
  }),
  80,
  'Net Profit = Gross − Returns Revenue + Returns COGS − Expenses − Commission',
);

console.log('paymentFee.test.cjs: all passed');

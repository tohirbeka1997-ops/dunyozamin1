'use strict';

/**
 * Till expected-cash formula (screenshot regression).
 * Run: node --test electron/lib/expectedClosingCash.test.cjs
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { expectedClosingCash } = require('./financialCalc.cjs');

const SCREENSHOT = {
  openingCash: 91_000,
  cashSales: 3_876_615,
  customerPaymentsCash: 184_000,
  cashRefunds: 576_250,
};

const SANE_TILL = 3_575_365;
const BUGGY_NEGATIVE = -4_967_635;
const LEAKED_SUPPLIER_CASH = 8_543_000;

test('screenshot shift: opening + cash sales + debt cash − refunds', () => {
  assert.equal(expectedClosingCash(SCREENSHOT), SANE_TILL);
});

test('store-wide supplier cash must not drag till to −4.9M', () => {
  const got = expectedClosingCash({
    ...SCREENSHOT,
    supplierPaymentsCash: LEAKED_SUPPLIER_CASH,
    otherCashIn: 0,
  });
  assert.equal(got, SANE_TILL);
  assert.notEqual(got, BUGGY_NEGATIVE);
  assert.equal(SANE_TILL - LEAKED_SUPPLIER_CASH, BUGGY_NEGATIVE);
});

test('turnover / card / credit are not till terms', () => {
  assert.equal(
    expectedClosingCash({
      ...SCREENSHOT,
      salesGross: 5_092_615,
      totalSales: 3_908_615,
      creditDebtIssued: 1_184_000,
    }),
    SANE_TILL
  );
});

test('debt cash is added once (not added and subtracted)', () => {
  const once = expectedClosingCash(SCREENSHOT);
  const doubled = expectedClosingCash({
    ...SCREENSHOT,
    customerPaymentsCash: 184_000,
    customerLoanIssuedCash: 184_000,
  });
  assert.equal(once, SANE_TILL);
  assert.equal(doubled, SANE_TILL - 184_000);
});

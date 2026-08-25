'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  bucketAgeDays,
  initBuckets,
  addToBuckets,
  bucketSum,
  allocateFifoPool,
  bucketsFromInvoices,
} = require('./agingCalc.cjs');

test('bucketAgeDays boundary: 7 → 0_7, 8 → 8_30', () => {
  assert.equal(bucketAgeDays(7), '0_7');
  assert.equal(bucketAgeDays(8), '8_30');
});

test('bucketAgeDays boundary: 30 → 8_30, 31 → 31_60', () => {
  assert.equal(bucketAgeDays(30), '8_30');
  assert.equal(bucketAgeDays(31), '31_60');
});

test('bucketAgeDays boundary: 60 → 31_60, 61 → 60_plus', () => {
  assert.equal(bucketAgeDays(60), '31_60');
  assert.equal(bucketAgeDays(61), '60_plus');
});

test('bucket row parts sum to total', () => {
  const b = initBuckets();
  addToBuckets(b, '0_7', 100);
  addToBuckets(b, '8_30', 200);
  addToBuckets(b, '31_60', 50);
  addToBuckets(b, '60_plus', 25);
  assert.equal(bucketSum(b), b.total);
  assert.equal(b.total, 375);
});

test('allocateFifoPool closes oldest invoice first', () => {
  const invoices = [
    { id: 'a', outstanding: 5000 },
    { id: 'b', outstanding: 8000 },
  ];
  const remaining = allocateFifoPool(invoices, 6000);
  assert.equal(remaining, 0);
  assert.equal(invoices[0].outstanding, 0);
  assert.equal(invoices[1].outstanding, 7000);
});

test('bucketsFromInvoices assigns by age_days', () => {
  const invoices = [
    { outstanding: 1000, age_days: 3 },
    { outstanding: 2000, age_days: 15 },
    { outstanding: 500, age_days: 45 },
    { outstanding: 250, age_days: 90 },
  ];
  const buckets = bucketsFromInvoices(invoices, (inv) => inv.age_days);
  assert.equal(buckets._0_7, 1000);
  assert.equal(buckets._8_30, 2000);
  assert.equal(buckets._31_60, 500);
  assert.equal(buckets._60_plus, 250);
  assert.equal(bucketSum(buckets), buckets.total);
});

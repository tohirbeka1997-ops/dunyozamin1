'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  qtyToScaled,
  scaledToString,
  scaledToNumber,
  mulDivScaled,
  ceilScaledToDecimals,
  ceilScaledToMultiple,
  mulQtyPriceInteger,
} = require('./qty.cjs');
const { computePurchasePlanningRow } = require('./purchasePlanningCalc.cjs');

test('qtyToScaled parses decimal strings without float', () => {
  assert.equal(qtyToScaled('26.5'), 26_500_000);
  assert.equal(qtyToScaled('26.500'), 26_500_000);
  assert.equal(qtyToScaled(26.5), 26_500_000);
});

test('ceil meter precision 0.001 keeps 26.500', () => {
  const need = qtyToScaled('26.5');
  const rec = ceilScaledToDecimals(need, 3);
  assert.equal(scaledToString(rec, 3), '26.500');
});

test('order step 1 m rounds 26.500 up to 27', () => {
  const rec = ceilScaledToMultiple(qtyToScaled('26.5'), qtyToScaled('1'));
  assert.equal(scaledToNumber(rec, 3), 27);
});

test('piece product rounds recommendation up', () => {
  const row = computePurchasePlanningRow({
    analysisDays: 7,
    planningDays: 7,
    safetyDays: 2,
    soldQty: 10,
    onHandQty: 0,
    reservedQty: 0,
    blockedQty: 0,
    confirmedInboundQty: 0,
    inTransferQty: 0,
    revisionQty: 0,
    unit: 'pcs',
    lastPurchasePrice: 1000,
    currency: 'UZS',
    hasSupplier: true,
    hasUnit: true,
  });
  assert.equal(row.status, 'SHORTAGE');
  assert.ok(row.recommended_qty >= 13);
  assert.match(row.rounding_rule, /dona|ceil/i);
});

test('inbound PO reduces recommendation', () => {
  const base = computePurchasePlanningRow({
    analysisDays: 1,
    planningDays: 1,
    safetyDays: 0,
    soldQty: 10,
    onHandQty: 0,
    confirmedInboundQty: 0,
    reservedQty: 0,
    blockedQty: 0,
    inTransferQty: 0,
    revisionQty: 0,
    unit: 'pcs',
    lastPurchasePrice: 1000,
    hasSupplier: true,
    hasUnit: true,
  });
  const inbound = computePurchasePlanningRow({
    analysisDays: 1,
    planningDays: 1,
    safetyDays: 0,
    soldQty: 10,
    onHandQty: 0,
    confirmedInboundQty: 4,
    reservedQty: 0,
    blockedQty: 0,
    inTransferQty: 0,
    revisionQty: 0,
    unit: 'pcs',
    lastPurchasePrice: 1000,
    hasSupplier: true,
    hasUnit: true,
  });
  assert.equal(base.recommended_qty, 10);
  assert.equal(inbound.recommended_qty, 6);
});

test('reserved qty increases recommendation', () => {
  const base = computePurchasePlanningRow({
    analysisDays: 1,
    planningDays: 1,
    safetyDays: 0,
    soldQty: 5,
    onHandQty: 5,
    reservedQty: 0,
    confirmedInboundQty: 0,
    blockedQty: 0,
    inTransferQty: 0,
    revisionQty: 0,
    unit: 'pcs',
    lastPurchasePrice: 1000,
    hasSupplier: true,
    hasUnit: true,
  });
  const reserved = computePurchasePlanningRow({
    analysisDays: 1,
    planningDays: 1,
    safetyDays: 0,
    soldQty: 5,
    onHandQty: 5,
    reservedQty: 2,
    confirmedInboundQty: 0,
    blockedQty: 0,
    inTransferQty: 0,
    revisionQty: 0,
    unit: 'pcs',
    lastPurchasePrice: 1000,
    hasSupplier: true,
    hasUnit: true,
  });
  assert.equal(base.recommended_qty, 0);
  assert.equal(reserved.recommended_qty, 2);
});

test('no-sales product gets distinct status', () => {
  const row = computePurchasePlanningRow({
    analysisDays: 7,
    planningDays: 7,
    safetyDays: 2,
    soldQty: 0,
    onHandQty: 10,
    unit: 'pcs',
    lastPurchasePrice: 1000,
    hasSupplier: true,
    hasUnit: true,
  });
  assert.equal(row.status, 'NO_SALES');
  assert.equal(row.recommended_qty, 0);
});

test('meter fractional precision and value', () => {
  const row = computePurchasePlanningRow({
    analysisDays: 1,
    planningDays: 1,
    safetyDays: 0,
    soldQty: '26.5',
    onHandQty: 0,
    unit: 'm',
    qtyPrecision: 3,
    lastPurchasePrice: 10000,
    currency: 'UZS',
    hasSupplier: true,
    hasUnit: true,
  });
  assert.ok(row.recommended_qty >= 26.5);
  assert.equal(scaledToString(qtyToScaled(row.recommended_qty), 3), '26.500');
  assert.equal(row.recommended_value, 265000);
});

test('meter with 1m step rounds to 27', () => {
  const row = computePurchasePlanningRow({
    analysisDays: 1,
    planningDays: 1,
    safetyDays: 0,
    soldQty: '26.5',
    onHandQty: 0,
    unit: 'm',
    qtyPrecision: 3,
    orderStep: 1,
    lastPurchasePrice: 1000,
    hasSupplier: true,
    hasUnit: true,
  });
  assert.equal(row.recommended_qty, 27);
});

test('7 vs 14 vs 30 analysis days change recommendation', () => {
  const mk = (days) =>
    computePurchasePlanningRow({
      analysisDays: days,
      planningDays: 7,
      safetyDays: 2,
      soldQty: 30,
      onHandQty: 0,
      unit: 'pcs',
      lastPurchasePrice: 100,
      hasSupplier: true,
      hasUnit: true,
    });
  const r7 = mk(7);
  const r14 = mk(14);
  const r30 = mk(30);
  assert.ok(r7.recommended_qty > r14.recommended_qty);
  assert.ok(r14.recommended_qty > r30.recommended_qty);
});

test('money multiply uses integer scaled qty', () => {
  assert.equal(mulQtyPriceInteger(qtyToScaled('2.5'), 1000), 2500);
  assert.equal(mulDivScaled(qtyToScaled(10), 7, 7), qtyToScaled(10));
});

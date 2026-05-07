'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  statusLabel,
  normalizeDeliveryMethod,
  allowedNextStatuses,
  isValidTransition,
} = require('./lib/webOrderStatusFlow.cjs');

test('statusLabel returns localized labels', () => {
  assert.equal(statusLabel('new'), 'Yangi');
  assert.equal(statusLabel('processing'), "Qabul qilindi");
  assert.equal(statusLabel('READY'), 'Buyurtma tayyor');
  assert.equal(statusLabel('out_for_delivery'), "Kuryer yo'lda");
  assert.equal(statusLabel('delivered'), 'Yetkazildi');
});

test('allowedNextStatuses follows workflow', () => {
  assert.deepEqual(allowedNextStatuses('new'), ['processing', 'cancelled']);
  assert.deepEqual(allowedNextStatuses('paid'), ['processing', 'cancelled']);
  assert.deepEqual(allowedNextStatuses('processing'), ['ready', 'cancelled']);
  assert.deepEqual(allowedNextStatuses('ready'), ['out_for_delivery', 'cancelled']);
  assert.deepEqual(allowedNextStatuses('ready', { deliveryMethod: 'pickup' }), ['delivered', 'cancelled']);
  assert.deepEqual(allowedNextStatuses('out_for_delivery'), ['delivered', 'cancelled']);
  assert.deepEqual(allowedNextStatuses('delivered'), []);
  assert.deepEqual(allowedNextStatuses('cancelled'), []);
});

test('isValidTransition validates transitions and idempotency', () => {
  assert.equal(isValidTransition('new', 'processing'), true);
  assert.equal(isValidTransition('processing', 'ready'), true);
  assert.equal(isValidTransition('ready', 'out_for_delivery'), true);
  assert.equal(isValidTransition('out_for_delivery', 'delivered'), true);
  assert.equal(isValidTransition('ready', 'delivered'), false);
  assert.equal(isValidTransition('ready', 'delivered', { deliveryMethod: 'pickup' }), true);
  assert.equal(isValidTransition('ready', 'out_for_delivery', { deliveryMethod: 'pickup' }), false);
  assert.equal(isValidTransition('cancelled', 'processing'), false);
  assert.equal(isValidTransition('delivered', 'cancelled'), false);
  assert.equal(isValidTransition('ready', 'ready'), true);
});

test('normalizeDeliveryMethod defaults safely', () => {
  assert.equal(normalizeDeliveryMethod('pickup'), 'pickup');
  assert.equal(normalizeDeliveryMethod('courier'), 'courier');
  assert.equal(normalizeDeliveryMethod(''), 'courier');
  assert.equal(normalizeDeliveryMethod('anything'), 'courier');
});

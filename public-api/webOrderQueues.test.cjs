'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveQueueStatuses, normalizeQueueId } = require('./lib/webOrderQueues.cjs');

test('resolveQueueStatuses uses queue preset', () => {
  assert.deepEqual(resolveQueueStatuses({ queue: 'preparing' }), ['processing']);
  assert.deepEqual(resolveQueueStatuses({ queue: 'ready' }), ['ready']);
  assert.deepEqual(resolveQueueStatuses({ queue: 'delivering' }), ['out_for_delivery']);
});

test('resolveQueueStatuses supports csv and single status', () => {
  assert.deepEqual(resolveQueueStatuses({ statuses_csv: 'new,paid' }), ['new', 'paid']);
  assert.deepEqual(resolveQueueStatuses({ status: 'delivered' }), ['delivered']);
});

test('normalizeQueueId rejects unknown', () => {
  assert.equal(normalizeQueueId('preparing'), 'preparing');
  assert.equal(normalizeQueueId('unknown'), null);
});

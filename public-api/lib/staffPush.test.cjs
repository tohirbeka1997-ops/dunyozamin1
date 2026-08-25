'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isExpoPushToken, pushEnabled } = require('./staffPush.cjs');

test('isExpoPushToken accepts Expo formats', () => {
  assert.equal(isExpoPushToken('ExponentPushToken[abc]'), true);
  assert.equal(isExpoPushToken('ExpoPushToken[xyz]'), true);
  assert.equal(isExpoPushToken('fcm-raw-token'), false);
  assert.equal(isExpoPushToken(''), false);
});

test('pushEnabled defaults on', () => {
  const prev = process.env.EXPO_PUSH_ENABLED;
  delete process.env.EXPO_PUSH_ENABLED;
  assert.equal(pushEnabled(), true);
  process.env.EXPO_PUSH_ENABLED = '0';
  assert.equal(pushEnabled(), false);
  if (prev === undefined) delete process.env.EXPO_PUSH_ENABLED;
  else process.env.EXPO_PUSH_ENABLED = prev;
});

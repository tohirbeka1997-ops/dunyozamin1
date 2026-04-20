'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { verifyTelegramInitData, assertInitDataFresh } = require('./lib/telegramAuth.cjs');

test('verifyTelegramInitData rejects invalid hash', () => {
  const bad = 'user=%7B%22id%22%3A123%7D&auth_date=1&hash=deadbeef';
  assert.strictEqual(verifyTelegramInitData(bad, 'test-token'), false);
});

test('assertInitDataFresh throws on invalid token', () => {
  const bad = 'user=%7B%22id%22%3A123%7D&auth_date=1&hash=deadbeef';
  assert.throws(() => assertInitDataFresh(bad, 'real-bot-token-from-botfather'), /INVALID_INIT_DATA/);
});

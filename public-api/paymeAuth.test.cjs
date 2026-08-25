'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { verifyPaycomBasicAuth } = require('./lib/payme.cjs');

function makeReq(authHeader) {
  return { headers: { authorization: authHeader || '' } };
}

test('verifyPaycomBasicAuth accepts valid Basic credentials', () => {
  const merchantId = 'Paycom';
  const apiKey = 'test-api-key-12345';
  const encoded = Buffer.from(`${merchantId}:${apiKey}`, 'utf8').toString('base64');
  assert.equal(verifyPaycomBasicAuth(makeReq(`Basic ${encoded}`), merchantId, apiKey), true);
});

test('verifyPaycomBasicAuth rejects wrong api key', () => {
  const merchantId = 'Paycom';
  const encoded = Buffer.from(`${merchantId}:wrong-key`, 'utf8').toString('base64');
  assert.equal(verifyPaycomBasicAuth(makeReq(`Basic ${encoded}`), merchantId, 'correct-key'), false);
});

test('verifyPaycomBasicAuth rejects wrong merchant id', () => {
  const apiKey = 'secret';
  const encoded = Buffer.from(`OtherMerchant:${apiKey}`, 'utf8').toString('base64');
  assert.equal(verifyPaycomBasicAuth(makeReq(`Basic ${encoded}`), 'Paycom', apiKey), false);
});

test('verifyPaycomBasicAuth rejects missing or malformed auth header', () => {
  assert.equal(verifyPaycomBasicAuth(makeReq(''), 'Paycom', 'key'), false);
  assert.equal(verifyPaycomBasicAuth(makeReq('Bearer token'), 'Paycom', 'key'), false);
  assert.equal(verifyPaycomBasicAuth(makeReq('Basic not-valid-base64!!!'), 'Paycom', 'key'), false);
});

test('verifyPaycomBasicAuth uses constant-time compare (no early exit on length)', () => {
  const merchantId = 'Paycom';
  const apiKey = 'abcdefghijklmnop';
  const encoded = Buffer.from(`${merchantId}:${apiKey}`, 'utf8').toString('base64');
  // Same length wrong key — must still return false without throwing.
  const wrong = Buffer.from(`${merchantId}:abcdefghijklmnoq`, 'utf8').toString('base64');
  assert.equal(verifyPaycomBasicAuth(makeReq(`Basic ${encoded}`), merchantId, apiKey), true);
  assert.equal(verifyPaycomBasicAuth(makeReq(`Basic ${wrong}`), merchantId, apiKey), false);
});

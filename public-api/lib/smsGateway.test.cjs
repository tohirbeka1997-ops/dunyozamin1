'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getSmsProvider, sendSms, resetEskizTokenCache } = require('./smsGateway.cjs');

const originalFetch = global.fetch;

function withEnv(overrides, fn) {
  const prev = {};
  for (const [k, v] of Object.entries(overrides)) {
    prev[k] = process.env[k];
    if (v == null) delete process.env[k];
    else process.env[k] = v;
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      global.fetch = originalFetch;
      resetEskizTokenCache();
      for (const [k, v] of Object.entries(prev)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    });
}

test('sendSms provider off skips with sms_provider_off', () =>
  withEnv({ SMS_PROVIDER: 'off' }, async () => {
    assert.equal(getSmsProvider(), 'off');
    const out = await sendSms('998901112233', 'Salom');
    assert.equal(out.ok, false);
    assert.equal(out.skipped, true);
    assert.equal(out.error, 'sms_provider_off');
  }));

test('sendSms eskiz uses token and returns provider id', () =>
  withEnv(
    {
      SMS_PROVIDER: 'eskiz',
      ESKIZ_EMAIL: 'test@example.com',
      ESKIZ_PASSWORD: 'secret',
      SMS_SENDER: '4546',
    },
    async () => {
      const calls = [];
      global.fetch = async (url, opts = {}) => {
        calls.push({ url: String(url), opts });
        if (String(url).includes('/auth/login')) {
          return {
            ok: true,
            text: async () => JSON.stringify({ data: { token: 'mock-token' } }),
          };
        }
        if (String(url).includes('/message/sms/send')) {
          return {
            ok: true,
            text: async () => JSON.stringify({ id: 'eskiz-msg-99' }),
          };
        }
        return { ok: false, text: async () => '{}' };
      };

      const out = await sendSms('+998 90 111 22 33', 'Test SMS');
      assert.equal(out.ok, true);
      assert.equal(out.id, 'eskiz-msg-99');
      assert.equal(calls.length, 2);
      assert.match(calls[1].opts.headers.Authorization, /Bearer mock-token/);
    },
  ));

test('sendSms playmobile basic auth payload', () =>
  withEnv(
    {
      SMS_PROVIDER: 'playmobile',
      PLAYMOBILE_LOGIN: 'user',
      PLAYMOBILE_PASSWORD: 'pass',
      SMS_SENDER: '3700',
    },
    async () => {
      let captured = null;
      global.fetch = async (url, opts = {}) => {
        captured = { url: String(url), opts };
        return { ok: true, text: async () => 'Request is received' };
      };
      const out = await sendSms('901112233', 'Play test');
      assert.equal(out.ok, true);
      assert.ok(out.id);
      const body = JSON.parse(captured.opts.body);
      assert.equal(body.messages[0].recipient, '998901112233');
      assert.equal(body.messages[0].sms.originator, '3700');
      assert.match(captured.opts.headers.Authorization, /^Basic /);
    },
  ));

test('sendSms invalid phone returns error', () =>
  withEnv({ SMS_PROVIDER: 'eskiz', ESKIZ_EMAIL: 'a@b.c', ESKIZ_PASSWORD: 'x' }, async () => {
    const out = await sendSms('invalid', 'hi');
    assert.equal(out.ok, false);
    assert.equal(out.error, 'invalid_phone');
  }));

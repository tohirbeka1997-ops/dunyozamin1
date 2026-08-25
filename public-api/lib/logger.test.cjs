'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PassThrough } = require('stream');
const pino = require('pino');

test('logger redacts sensitive fields', () => {
  const stream = new PassThrough();
  const chunks = [];
  stream.on('data', (c) => chunks.push(String(c)));

  const log = pino(
    {
      redact: {
        paths: ['phone', 'password', 'token', 'access_token', 'refresh_token'],
        censor: '[REDACTED]',
      },
    },
    stream,
  );

  log.info({ phone: '+998901234567', password: 'secret', token: 'abc123' }, 'login attempt');

  return new Promise((resolve) => {
    stream.end(() => {
      const line = chunks.join('');
      assert.match(line, /\[REDACTED\]/);
      assert.doesNotMatch(line, /secret/);
      assert.doesNotMatch(line, /abc123/);
      assert.doesNotMatch(line, /998901234567/);
      resolve();
    });
  });
});

test('logger module exports configured instance', () => {
  const { logger } = require('./logger.cjs');
  assert.equal(typeof logger.info, 'function');
  assert.equal(typeof logger.warn, 'function');
  assert.equal(typeof logger.error, 'function');
});

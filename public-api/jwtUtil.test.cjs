'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  newJti,
} = require('./lib/jwtUtil.cjs');
const {
  signStaffAccessToken,
  signStaffRefreshToken,
  verifyStaffAccessToken,
  verifyStaffRefreshToken,
} = require('./lib/staffJwt.cjs');

const TEST_SECRET = 'test-customer-jwt-secret-16';
const STAFF_SECRET = 'test-staff-jwt-secret-min-16-chars';

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
      for (const [k, v] of Object.entries(prev)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    });
}

test('customer JWT: access token verifies with typ=access', () =>
  withEnv({ JWT_SECRET: TEST_SECRET, JWT_REFRESH_SECRET: TEST_SECRET + '-r' }, () => {
    const access = signAccessToken('cust-1');
    const payload = verifyAccessToken(access);
    assert.equal(payload.sub, 'cust-1');
    assert.equal(payload.typ, 'access');
  }));

test('customer JWT: refresh token rejected as access (typ discrimination)', () =>
  withEnv({ JWT_SECRET: TEST_SECRET }, () => {
    const refresh = signRefreshToken('cust-1', newJti());
    assert.throws(() => verifyAccessToken(refresh), (err) => err.code === 'INVALID_TOKEN_TYPE');
  }));

test('customer JWT: access token rejected as refresh', () =>
  withEnv({ JWT_SECRET: TEST_SECRET }, () => {
    const access = signAccessToken('cust-1');
    assert.throws(() => verifyRefreshToken(access), (err) => err.code === 'INVALID_REFRESH');
  }));

test('staff JWT: access vs refresh typ discrimination', () =>
  withEnv({ STAFF_JWT_SECRET: STAFF_SECRET }, () => {
    const access = signStaffAccessToken('u1', 'sales', 'default');
    const refresh = signStaffRefreshToken('u1', newJti(), 'default');
    assert.throws(() => verifyStaffAccessToken(refresh), (err) => err.code === 'INVALID_TOKEN_TYPE');
    assert.throws(() => verifyStaffRefreshToken(access), (err) => err.code === 'INVALID_REFRESH');
  }));

test('customer JWT: cross-type signed with wrong typ is rejected', () =>
  withEnv({ JWT_SECRET: TEST_SECRET }, () => {
    const forged = jwt.sign({ sub: 'cust-1', typ: 'refresh' }, TEST_SECRET, { expiresIn: '1h' });
    assert.throws(() => verifyAccessToken(forged), (err) => err.code === 'INVALID_TOKEN_TYPE');
  }));

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const AuthService = require('./authService.cjs');
const { hashPassword } = require('../lib/password.cjs');

function legacySha256(plain) {
  return crypto.createHash('sha256').update(String(plain)).digest('hex');
}

function makeDb(userRow) {
  return {
    prepare(sql) {
      return {
        get(...args) {
          if (/FROM users WHERE/i.test(sql)) return userRow;
          if (/FROM password_reset_tokens/i.test(sql)) return null;
          return undefined;
        },
        run() {
          return { changes: 1 };
        },
        all() {
          if (/PRAGMA table_info\(users\)/.test(sql)) {
            return [{ name: 'password_expired' }, { name: 'password_hash' }];
          }
          if (/FROM user_roles/.test(sql)) return [{ code: 'admin' }];
          return [];
        },
      };
    },
  };
}

test('legacy SHA-256 password is upgraded and login succeeds', () => {
  const svc = new AuthService(
    makeDb({
      id: 'u1',
      username: 'admin@pos.com',
      email: 'admin@pos.com',
      is_active: 1,
      password_hash: legacySha256('12345'),
      password_expired: 0,
    }),
  );

  const result = svc.login('admin@pos.com', '12345');
  assert.equal(result.success, true);
  assert.ok(result.user);
});

test('admin alias resolves to admin@pos.com', () => {
  const plain = 'SecurePass1!';
  const svc = new AuthService(
    makeDb({
      id: 'u1',
      username: 'admin@pos.com',
      email: 'admin@pos.com',
      is_active: 1,
      password_hash: hashPassword(plain),
      password_expired: 0,
    }),
  );

  const result = svc.login('admin', plain);
  assert.equal(result.success, true);
  assert.equal(result.user.username, 'admin@pos.com');
});

test('admin alias supports legacy admin usernames/emails', () => {
  const plain = 'SecurePass1!';
  const svc = new AuthService(
    makeDb({
      id: 'u1',
      username: 'admin',
      email: 'admin@postizimi.local',
      is_active: 1,
      password_hash: hashPassword(plain),
      password_expired: 0,
    }),
  );

  const result = svc.login('admin', plain);
  assert.equal(result.success, true);
  assert.equal(result.user.username, 'admin');
});

test('scrypt password login succeeds', () => {
  const plain = 'SecurePass1!';
  const svc = new AuthService(
    makeDb({
      id: 'u1',
      username: 'cashier',
      email: 'cash@pos.com',
      is_active: 1,
      password_hash: hashPassword(plain),
      password_expired: 0,
    }),
  );

  const result = svc.login('cashier', plain);
  assert.equal(result.success, true);
  assert.ok(result.user);
});

test('password_expired flag blocks scrypt login', () => {
  const plain = 'SecurePass1!';
  const svc = new AuthService(
    makeDb({
      id: 'u1',
      username: 'cashier',
      email: 'cash@pos.com',
      is_active: 1,
      password_hash: hashPassword(plain),
      password_expired: 1,
    }),
  );

  const result = svc.login('cashier', plain);
  assert.equal(result.success, false);
  assert.equal(result.password_expired, true);
});

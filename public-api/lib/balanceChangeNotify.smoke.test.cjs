'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { runMigrations } = require('../../electron/db/migrate.cjs');
const {
  buildCustomerBalanceChangeText,
  buildStaffBalanceChangeText,
  claimBalanceChangeDedup,
  getBalanceChangeSettings,
  makeDedupRef,
  notifyCustomerBalanceChange,
} = require('./balanceChangeNotify.cjs');

function withTempDb(fn) {
  const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'balance-change-'));
  const dbPath = path.join(tmpDir, 'pos.db');
  const db = new Database(dbPath);
  runMigrations(db);
  return Promise.resolve()
    .then(() => fn(db))
    .finally(() => {
      db.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });
}

test('balance change settings default on after migration', () =>
  withTempDb((db) => {
    const s = getBalanceChangeSettings(db);
    assert.equal(s.enabled, true);
    assert.equal(s.staffChannelEnabled, true);
  }));

test('Uzbek customer and staff balance change texts', () => {
  const customer = buildCustomerBalanceChangeText({
    customerName: 'Ali',
    delta: 30000,
    balanceAfter: -20000,
    currency: 'UZS',
    reason: 'payment_in',
    storeName: "Do'kon",
  });
  assert.match(customer, /Hurmatli Ali!/);
  assert.match(customer, /To'lov/);
  assert.match(customer, /Qarz/);

  const staff = buildStaffBalanceChangeText({
    customerName: 'Ali',
    customerId: 'c1',
    delta: -50000,
    balanceAfter: -50000,
    currency: 'UZS',
    reason: 'credit_sale',
    refId: 'ord-1',
    storeName: "Do'kon",
  });
  assert.match(staff, /Hisob/);
  assert.match(staff, /Nasiya/);
  assert.match(staff, /Ali/);
});

test('dedup blocks same customer+amount within window', () =>
  withTempDb((db) => {
    assert.equal(makeDedupRef('c1', 1000.4), 'c1:1000');
    assert.equal(claimBalanceChangeDedup(db, 'c1', 1000), true);
    assert.equal(claimBalanceChangeDedup(db, 'c1', 1000), false);
    assert.equal(claimBalanceChangeDedup(db, 'c1', 2000), true);
  }));

test('notifyCustomerBalanceChange skips zero delta and respects disabled', () =>
  withTempDb(async (db) => {
    const zero = await notifyCustomerBalanceChange(db, {
      customerId: 'c1',
      delta: 0,
      balanceAfter: 0,
    });
    assert.equal(zero.skipped, true);
    assert.equal(zero.reason, 'no_change');

    const SettingsService = require('../../electron/services/settingsService.cjs');
    new SettingsService(db).set('credit.reminder.balance_change_notify', false, 'boolean');
    const off = await notifyCustomerBalanceChange(db, {
      customerId: 'c1',
      delta: -1000,
      balanceAfter: -1000,
      reason: 'credit_sale',
    });
    assert.equal(off.skipped, true);
    assert.equal(off.reason, 'disabled');
  }));

test('notifyCustomerBalanceChange dedupes rapid double-writes', () =>
  withEnv({ TELEGRAM_BOT_TOKEN: '', SMS_PROVIDER: 'off', TELEGRAM_REPORTS_CHAT_ID: '' }, () =>
    withTempDb(async (db) => {
      db.prepare(
        `INSERT INTO customers (id, name, phone, type, status, balance, created_at, updated_at)
         VALUES ('cust-bc-1', 'Test', '+998901112233', 'individual', 'active', -5000, datetime('now'), datetime('now'))`,
      ).run();

      const first = await notifyCustomerBalanceChange(db, {
        customerId: 'cust-bc-1',
        delta: 2000,
        balanceAfter: -3000,
        reason: 'payment_in',
        refId: 'pay-1',
      });
      // No channels configured → no_delivery, but dedup claimed
      assert.equal(first.reason === 'no_delivery' || first.skipped === true, true);

      const second = await notifyCustomerBalanceChange(db, {
        customerId: 'cust-bc-1',
        delta: 2000,
        balanceAfter: -3000,
        reason: 'payment_in',
        refId: 'pay-2',
      });
      assert.equal(second.skipped, true);
      assert.equal(second.reason, 'dedup');
    }),
  ));

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

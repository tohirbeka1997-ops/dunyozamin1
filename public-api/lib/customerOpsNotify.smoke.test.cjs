'use strict';

/**
 * Smoke tests for customer Telegram ops reports — no real Telegram calls.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { runMigrations } = require('../../electron/db/migrate.cjs');
const {
  buildCustomerOpsReportText,
  claimCustomerOpsDedup,
  getCustomerOpsSettings,
  makeDedupRef,
  notifyCustomerOps,
} = require('./customerOpsNotify.cjs');

function withTempDb(fn) {
  const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'customer-ops-'));
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

test('customer ops settings default on', () =>
  withTempDb((db) => {
    const s = getCustomerOpsSettings(db);
    assert.equal(s.enabled, true);
    assert.equal(s.telegramEnabled, true);
  }));

test('Uzbek report cards for sale / payment / credit', () => {
  const sale = buildCustomerOpsReportText({
    customerName: 'Ali',
    reason: 'sale',
    totalAmount: 150000,
    paidAmount: 150000,
    balanceAfter: 0,
    orderNumber: 'ORD-1',
    storeName: "Do'kon",
  });
  assert.match(sale, /Xarid/);
  assert.match(sale, /150/);
  assert.match(sale, /ORD-1/);
  assert.match(sale, /Hisob: 0/);

  const credit = buildCustomerOpsReportText({
    customerName: 'Ali',
    reason: 'credit_sale',
    totalAmount: 100000,
    creditAmount: 40000,
    paidAmount: 60000,
    balanceAfter: -40000,
    orderNumber: 'ORD-2',
  });
  assert.match(credit, /Nasiya/);
  assert.match(credit, /Qarz/);

  const pay = buildCustomerOpsReportText({
    customerName: 'Ali',
    reason: 'payment_in',
    delta: 20000,
    totalAmount: 20000,
    balanceAfter: -20000,
    paymentNumber: 'PAY-9',
  });
  assert.match(pay, /To'lov/);
  assert.match(pay, /PAY-9/);
});

test('dedup by customer+reason+ref', () =>
  withTempDb((db) => {
    assert.equal(makeDedupRef({ customerId: 'c1', reason: 'sale', refId: 'o1' }), 'c1:sale:o1');
    assert.equal(claimCustomerOpsDedup(db, { customerId: 'c1', reason: 'sale', refId: 'o1' }), true);
    assert.equal(claimCustomerOpsDedup(db, { customerId: 'c1', reason: 'sale', refId: 'o1' }), false);
    assert.equal(claimCustomerOpsDedup(db, { customerId: 'c1', reason: 'sale', refId: 'o2' }), true);
  }));

test('resolveCustomerBotToken prefers dedicated token', () => {
  const { resolveCustomerBotToken } = require('./customerOpsNotify.cjs');
  return withEnv(
    {
      TELEGRAM_CUSTOMER_BOT_TOKEN: 'cust-token-abc',
      TELEGRAM_BOT_TOKEN: 'mini-token-xyz',
      TELEGRAM_CUSTOMER_BOT_FALLBACK: '',
    },
    () => {
      assert.equal(resolveCustomerBotToken(), 'cust-token-abc');
    },
  );
});

test('resolveCustomerBotToken no fallback without flag', () => {
  const { resolveCustomerBotToken } = require('./customerOpsNotify.cjs');
  return withEnv(
    {
      TELEGRAM_CUSTOMER_BOT_TOKEN: '',
      TELEGRAM_BOT_TOKEN: 'mini-token-xyz',
      TELEGRAM_CUSTOMER_BOT_FALLBACK: '',
    },
    () => {
      assert.equal(resolveCustomerBotToken(), '');
    },
  );
});

test('notifyCustomerOps skips without telegram / allows zero-delta sale', () =>
  withEnv({ TELEGRAM_CUSTOMER_BOT_TOKEN: 'x'.repeat(40), TELEGRAM_BOT_TOKEN: '' }, () =>
    withTempDb(async (db) => {
      db.prepare(
        `INSERT INTO customers (id, name, phone, type, status, balance, created_at, updated_at)
         VALUES ('cust-ops-1', 'Test', '+998901112233', 'individual', 'active', 0, datetime('now'), datetime('now'))`,
      ).run();

      const noTg = await notifyCustomerOps(db, {
        customerId: 'cust-ops-1',
        reason: 'sale',
        orderNumber: 'ORD-A',
        totalAmount: 5000,
        balanceAfter: 0,
        refId: 'ord-a',
      });
      assert.equal(noTg.skipped, true);
      assert.equal(noTg.reason, 'no_telegram');

      const cols = db.prepare(`PRAGMA table_info(customers)`).all().map((c) => c.name);
      if (cols.includes('telegram_id')) {
        db.prepare(`UPDATE customers SET telegram_id = ? WHERE id = ?`).run(424242, 'cust-ops-1');
      }

      // With telegram_id but fake token — send may fail; at least not skipped for no_telegram
      const withTg = await notifyCustomerOps(db, {
        customerId: 'cust-ops-1',
        reason: 'sale',
        orderNumber: 'ORD-B',
        totalAmount: 5000,
        balanceAfter: 0,
        delta: 0,
        refId: 'ord-b',
      });
      assert.notEqual(withTg.reason, 'no_telegram');
      assert.notEqual(withTg.reason, 'no_sale_context');
      assert.notEqual(withTg.reason, 'no_customer_bot_token');
    }),
  ));

test('payment zero delta skipped', () =>
  withTempDb(async (db) => {
    const zero = await notifyCustomerOps(db, {
      customerId: 'c1',
      reason: 'payment_in',
      delta: 0,
    });
    assert.equal(zero.skipped, true);
    assert.equal(zero.reason, 'no_change');
  }));

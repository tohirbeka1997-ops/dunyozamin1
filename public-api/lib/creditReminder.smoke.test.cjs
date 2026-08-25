'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { runMigrations } = require('../../electron/db/migrate.cjs');
const {
  buildReminderMessage,
  creditReminderSchemaReady,
  findOrdersForReminder,
  getCreditReminderSettings,
  runCreditReminderTick,
  truncateSms,
} = require('./creditReminder.cjs');
const { getSmsProvider, resetEskizTokenCache } = require('./smsGateway.cjs');

function withTempDb(fn) {
  const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'credit-reminder-'));
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

function seedCreditOrder(db, { orderId, customerId, dueDate, creditAmount = 50000 }) {
  db.prepare(
    `INSERT OR IGNORE INTO users (id, username, full_name, email, password_hash, is_active, created_at, updated_at)
     VALUES ('test-user-cr', 'testcr', 'Test User', 'testcr@example.com', 'x', 1, datetime('now'), datetime('now'))`,
  ).run();

  db.prepare(
    `INSERT INTO customers (id, name, phone, type, status, balance, created_at, updated_at)
     VALUES (?, 'Test Debtor', '+998901112233', 'individual', 'active', ?, datetime('now'), datetime('now'))`,
  ).run(customerId, -creditAmount);

  db.prepare(
    `INSERT INTO orders (
      id, order_number, customer_id, user_id, cashier_id, warehouse_id, subtotal, total_amount,
      paid_amount, credit_amount, status, payment_status, due_date, created_at, updated_at
    ) VALUES (?, ?, ?, 'test-user-cr', 'test-user-cr', 'main-warehouse-001', ?, ?, 0, ?, 'completed', 'on_credit', ?, datetime('now'), datetime('now'))`,
  ).run(orderId, `ORD-${orderId}`, customerId, creditAmount, creditAmount, creditAmount, dueDate);
}

test('credit reminder schema is ready after migration', () =>
  withTempDb((db) => {
    assert.equal(creditReminderSchemaReady(db), true);
    const settings = getCreditReminderSettings(db);
    assert.equal(settings.channel, 'telegram_first');
    assert.equal(settings.enabled, true);
    assert.equal(settings.scheduleTime, '09:00');
    assert.equal(settings.minAmount, 0);
  }));

test('buildReminderMessage uses compact Uzbek template', () => {
  const msg = buildReminderMessage({
    reminderType: 'due_today',
    customerName: 'Ali',
    amount: 120000,
    dueDate: '2026-06-27',
    storeName: 'POS Do\'kon',
  });
  assert.match(msg, /Hurmatli Ali!/);
  assert.match(msg, /120/);
  assert.ok(msg.length <= 160);
});

test('truncateSms keeps latin messages within 160 chars', () => {
  const long = 'a'.repeat(200);
  assert.equal(truncateSms(long).length, 160);
});

test('findOrdersForReminder is idempotent via credit_reminders', () =>
  withTempDb((db) => {
    const today = db.prepare(`SELECT date('now', 'localtime') AS d`).get().d;
    seedCreditOrder(db, { orderId: 'ord-cr-1', customerId: 'cust-cr-1', dueDate: today });

    const first = findOrdersForReminder(db, 'due_today', today);
    assert.equal(first.length, 1);

    db.prepare(
      `INSERT INTO credit_reminders (order_id, reminder_type, channel, status, sent_at)
       VALUES (?, 'due_today', 'sms', 'sent', datetime('now'))`,
    ).run('ord-cr-1');

    const second = findOrdersForReminder(db, 'due_today', today);
    assert.equal(second.length, 0);
  }));

test('updateOrderDueDate sets due_date on open credit order', () =>
  withTempDb((db) => {
    const today = db.prepare(`SELECT date('now', 'localtime') AS d`).get().d;
    seedCreditOrder(db, { orderId: 'ord-cr-upd', customerId: 'cust-cr-upd', dueDate: null });
    db.prepare(`UPDATE orders SET due_date = NULL WHERE id = 'ord-cr-upd'`).run();
    const { updateOrderDueDate, listOpenCreditOrders } = require('./creditReminder.cjs');
    const out = updateOrderDueDate(db, 'ord-cr-upd', today);
    assert.equal(out.ok, true);
    assert.equal(out.due_date, today);
    const rows = listOpenCreditOrders(db, { customerId: 'cust-cr-upd' });
    assert.equal(rows.length, 1);
    assert.equal(String(rows[0].due_date).slice(0, 10), today);
  }));

test('runCreditReminderTick skips when SMS provider off and no telegram', () =>
  withEnv({ SMS_PROVIDER: 'off', TELEGRAM_BOT_TOKEN: '' }, () =>
    withTempDb(async (db) => {
      const today = db.prepare(`SELECT date('now', 'localtime') AS d`).get().d;
      seedCreditOrder(db, { orderId: 'ord-cr-2', customerId: 'cust-cr-2', dueDate: today });
      const out = await runCreditReminderTick(db, { force: true });
      assert.equal(out.processed, 1);
      assert.equal(out.sent, 0);
      assert.equal(out.staffAlertsCreated, 1);
      const row = db
        .prepare(`SELECT COUNT(*) AS c FROM credit_reminders WHERE order_id = ?`)
        .get('ord-cr-2');
      assert.equal(Number(row.c), 0);
      const { listUnreadStaffCreditAlerts } = require('./creditReminder.cjs');
      const alerts = listUnreadStaffCreditAlerts(db);
      assert.equal(alerts.length, 1);
      assert.equal(alerts[0].order_id, 'ord-cr-2');
    }),
  ));

test('schedule gate skips before schedule_time and marks once per day', () =>
  withTempDb(async (db) => {
    const {
      getCreditReminderSettings,
      shouldRunScheduledTick,
      normalizeScheduleTime,
    } = require('./creditReminder.cjs');
    assert.equal(normalizeScheduleTime('9:5'), '09:05');
    const settings = getCreditReminderSettings(db);
    assert.equal(settings.scheduleTime, '09:00');
    assert.equal(settings.minAmount, 0);

    // Force future schedule so gate returns before_schedule when local time is earlier
    const SettingsService = require('../../electron/services/settingsService.cjs');
    const svc = new SettingsService(db);
    svc.set('credit.reminder.schedule_time', '23:59', 'string');
    const gated = shouldRunScheduledTick(db, getCreditReminderSettings(db), {});
    const parts = db
      .prepare(
        `SELECT cast(strftime('%H', 'now', 'localtime') AS INTEGER) AS h,
                cast(strftime('%M', 'now', 'localtime') AS INTEGER) AS m`,
      )
      .get();
    const nowMin = Number(parts.h) * 60 + Number(parts.m);
    if (nowMin < 23 * 60 + 59) {
      assert.equal(gated.ok, false);
      assert.equal(gated.reason, 'before_schedule');
    }

    svc.set('credit.reminder.schedule_time', '00:00', 'string');
    const due = shouldRunScheduledTick(db, getCreditReminderSettings(db), {});
    assert.equal(due.ok, true);

    const out1 = await runCreditReminderTick(db);
    assert.equal(out1.skipped, false);
    const out2 = await runCreditReminderTick(db);
    assert.equal(out2.skipped, true);
    assert.equal(out2.reason, 'already_ran_today');
  }));

test('min_amount filters findOrdersForReminder', () =>
  withTempDb((db) => {
    const today = db.prepare(`SELECT date('now', 'localtime') AS d`).get().d;
    seedCreditOrder(db, {
      orderId: 'ord-cr-min',
      customerId: 'cust-cr-min',
      dueDate: today,
      creditAmount: 10000,
    });
    const none = findOrdersForReminder(db, 'due_today', today, { minAmount: 50000 });
    assert.equal(none.length, 0);
    const some = findOrdersForReminder(db, 'due_today', today, { minAmount: 5000 });
    assert.equal(some.length, 1);
  }));

test('sendSms returns skipped when provider off', async () => {
  const prev = process.env.SMS_PROVIDER;
  process.env.SMS_PROVIDER = 'off';
  try {
    const { sendSms } = require('./smsGateway.cjs');
    const out = await sendSms('+998901112233', 'test');
    assert.equal(out.skipped, true);
    assert.equal(out.ok, false);
    assert.equal(out.error, 'sms_provider_off');
    assert.equal(getSmsProvider(), 'off');
  } finally {
    if (prev === undefined) delete process.env.SMS_PROVIDER;
    else process.env.SMS_PROVIDER = prev;
    resetEskizTokenCache();
  }
});

test('manual reminder returns clear Uzbek error when SMS off and no telegram', () =>
  withEnv({ SMS_PROVIDER: 'off', TELEGRAM_BOT_TOKEN: '' }, () =>
    withTempDb(async (db) => {
      const {
        sendManualCreditReminderForCustomer,
        humanizeCreditReminderError,
      } = require('./creditReminder.cjs');
      const today = db.prepare(`SELECT date('now', 'localtime') AS d`).get().d;
      seedCreditOrder(db, { orderId: 'ord-cr-manual', customerId: 'cust-cr-manual', dueDate: today });
      const out = await sendManualCreditReminderForCustomer(db, 'cust-cr-manual', {});
      assert.equal(out.ok, false);
      assert.equal(out.errorCode, 'sms_provider_off');
      assert.match(String(out.error), /SMS/);
      assert.equal(out.error, humanizeCreditReminderError('sms_provider_off'));
    }),
  ));

test('manual reminder no_channel when customer has no phone or telegram', () =>
  withEnv({ SMS_PROVIDER: 'off', TELEGRAM_BOT_TOKEN: '' }, () =>
    withTempDb(async (db) => {
      const { sendManualCreditReminderForCustomer } = require('./creditReminder.cjs');
      const today = db.prepare(`SELECT date('now', 'localtime') AS d`).get().d;
      seedCreditOrder(db, { orderId: 'ord-cr-noch', customerId: 'cust-cr-noch', dueDate: today });
      db.prepare(`UPDATE customers SET phone = NULL, phone_normalized = NULL WHERE id = ?`).run(
        'cust-cr-noch',
      );
      const out = await sendManualCreditReminderForCustomer(db, 'cust-cr-noch', {});
      assert.equal(out.ok, false);
      assert.equal(out.errorCode, 'no_channel');
      assert.match(String(out.error), /telefon/i);
    }),
  ));

test('manual reminder no_open_credit_order when only balance debt', () =>
  withTempDb(async (db) => {
    const { sendManualCreditReminderForCustomer } = require('./creditReminder.cjs');
    db.prepare(
      `INSERT OR IGNORE INTO users (id, username, full_name, email, password_hash, is_active, created_at, updated_at)
       VALUES ('test-user-cr', 'testcr', 'Test User', 'testcr@example.com', 'x', 1, datetime('now'), datetime('now'))`,
    ).run();
    db.prepare(
      `INSERT INTO customers (id, name, phone, type, status, balance, created_at, updated_at)
       VALUES ('cust-bal-only', 'Bal Only', '+998901112233', 'individual', 'active', -10000, datetime('now'), datetime('now'))`,
    ).run();
    const out = await sendManualCreditReminderForCustomer(db, 'cust-bal-only', {});
    assert.equal(out.ok, false);
    assert.equal(out.errorCode, 'no_open_credit_order');
    assert.match(String(out.error), /nasiya/i);
  }));

test('getCustomerPhone works after migrations', () =>
  withTempDb((db) => {
    const { getCustomerPhone } = require('./creditReminder.cjs');
    const today = db.prepare(`SELECT date('now', 'localtime') AS d`).get().d;
    seedCreditOrder(db, { orderId: 'ord-cr-phone', customerId: 'cust-cr-phone', dueDate: today });
    const phone = getCustomerPhone(db, 'cust-cr-phone');
    assert.ok(phone);
    assert.match(String(phone), /^998/);
  }));

test('customers.telegram_id / username used when Mini App binding missing', () =>
  withTempDb((db) => {
    const { getTelegramIdForCustomer } = require('./creditReminder.cjs');
    const cols = db.prepare(`PRAGMA table_info(customers)`).all().map((c) => c.name);
    assert.ok(cols.includes('telegram_id'));
    assert.ok(cols.includes('telegram_username'));

    const today = db.prepare(`SELECT date('now', 'localtime') AS d`).get().d;
    seedCreditOrder(db, { orderId: 'ord-cr-tg', customerId: 'cust-cr-tg', dueDate: today });

    assert.equal(getTelegramIdForCustomer(db, 'cust-cr-tg'), null);

    db.prepare(`UPDATE customers SET telegram_id = ? WHERE id = ?`).run(777888999, 'cust-cr-tg');
    assert.equal(getTelegramIdForCustomer(db, 'cust-cr-tg'), 777888999);

    db.prepare(`UPDATE customers SET telegram_id = NULL, telegram_username = ? WHERE id = ?`).run(
      'debtor_ali',
      'cust-cr-tg',
    );
    assert.equal(getTelegramIdForCustomer(db, 'cust-cr-tg'), '@debtor_ali');
  }));

test('Mini App telegram binding preferred over customers.telegram_id', () =>
  withTempDb((db) => {
    const { getTelegramIdForCustomer } = require('./creditReminder.cjs');
    const today = db.prepare(`SELECT date('now', 'localtime') AS d`).get().d;
    seedCreditOrder(db, { orderId: 'ord-cr-bind', customerId: 'cust-cr-bind', dueDate: today });
    db.prepare(`UPDATE customers SET telegram_id = ? WHERE id = ?`).run(111, 'cust-cr-bind');

    db.exec(`
      CREATE TABLE IF NOT EXISTS marketplace_customers (
        id INTEGER PRIMARY KEY,
        telegram_id INTEGER NOT NULL UNIQUE
      );
      CREATE TABLE IF NOT EXISTS marketplace_customer_bindings (
        marketplace_customer_id INTEGER PRIMARY KEY,
        pos_customer_id TEXT NOT NULL
      );
    `);
    db.prepare(`INSERT INTO marketplace_customers (id, telegram_id) VALUES (1, 999001)`).run();
    db.prepare(
      `INSERT INTO marketplace_customer_bindings (marketplace_customer_id, pos_customer_id) VALUES (1, ?)`,
    ).run('cust-cr-bind');

    assert.equal(getTelegramIdForCustomer(db, 'cust-cr-bind'), 999001);
  }));

test('findDailyDebtCustomers returns open debtors regardless of due_date', () =>
  withTempDb((db) => {
    const { findDailyDebtCustomers, getCreditReminderSettings } = require('./creditReminder.cjs');
    const settings = getCreditReminderSettings(db);
    assert.equal(settings.dailyEnabled, true);
    assert.equal(settings.balanceChangeNotify, true);

    // Far future due — still daily debt
    seedCreditOrder(db, {
      orderId: 'ord-daily-1',
      customerId: 'cust-daily-1',
      dueDate: '2099-01-01',
      creditAmount: 75000,
    });
    const rows = findDailyDebtCustomers(db, { minAmount: 0 });
    assert.ok(rows.some((r) => r.customer_id === 'cust-daily-1'));
    const row = rows.find((r) => r.customer_id === 'cust-daily-1');
    assert.equal(Number(row.debt_amount), 75000);
  }));

test('daily_debt message template is clear Uzbek', () => {
  const { buildReminderMessage } = require('./creditReminder.cjs');
  const msg = buildReminderMessage({
    reminderType: 'daily_debt',
    customerName: 'Ali',
    amount: 50000,
    dueDate: '2026-08-21',
    storeName: "Do'kon",
  });
  assert.match(msg, /Hurmatli Ali!/);
  assert.match(msg, /qarz/);
  assert.match(msg, /50/);
});

test('runCreditReminderTick with daily_enabled processes debtors without due window', () =>
  withEnv({ SMS_PROVIDER: 'off', TELEGRAM_BOT_TOKEN: '' }, () =>
    withTempDb(async (db) => {
      seedCreditOrder(db, {
        orderId: 'ord-daily-tick',
        customerId: 'cust-daily-tick',
        dueDate: '2099-06-01',
        creditAmount: 40000,
      });
      const out = await runCreditReminderTick(db, { force: true });
      assert.equal(out.dailyEnabled, true);
      assert.ok(out.processed >= 1);
      assert.equal(out.sent, 0);
      assert.ok(out.dailySent === 0);
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

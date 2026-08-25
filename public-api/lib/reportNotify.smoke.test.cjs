'use strict';

/**
 * Smoke tests for Telegram business reports (Phase 1) — no real Telegram calls.
 */

const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const Database = require('better-sqlite3');

const {
  getReportTelegramSettings,
  resolveReportChatIds,
  resolveReportDestination,
  buildCreditSaleText,
  buildShiftClosedText,
  buildDailyDigestText,
  notifyCreditSale,
  notifyShiftClosed,
  runDailyDigestTick,
  sendTestReport,
  normalizeScheduleTime,
  toBool,
} = require('./reportNotify.cjs');

function withEnv(overrides, fn) {
  const prev = {};
  for (const [k, v] of Object.entries(overrides)) {
    prev[k] = process.env[k];
    if (v === undefined || v === null) delete process.env[k];
    else process.env[k] = String(v);
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

function openTempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'report-notify-'));
  const dbPath = path.join(dir, 't.db');
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE settings (
      id TEXT PRIMARY KEY,
      key TEXT UNIQUE NOT NULL,
      value TEXT,
      type TEXT,
      description TEXT,
      category TEXT,
      is_public INTEGER DEFAULT 1,
      updated_by TEXT,
      created_at TEXT,
      updated_at TEXT
    );
    CREATE TABLE scheduler_locks (
      name TEXT PRIMARY KEY,
      locked_until TEXT,
      locked_by TEXT
    );
    CREATE TABLE report_notify_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_key TEXT NOT NULL,
      ref_id TEXT NOT NULL,
      sent_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(event_key, ref_id)
    );
    CREATE TABLE customers (
      id TEXT PRIMARY KEY,
      name TEXT,
      balance REAL DEFAULT 0
    );
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      username TEXT,
      full_name TEXT
    );
    CREATE TABLE orders (
      id TEXT PRIMARY KEY,
      order_number TEXT,
      customer_id TEXT,
      credit_amount REAL DEFAULT 0,
      due_date TEXT,
      cashier_id TEXT,
      user_id TEXT,
      status TEXT DEFAULT 'completed',
      shift_id TEXT
    );
    CREATE TABLE shifts (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      cashier_id TEXT,
      closed_by TEXT,
      status TEXT
    );
    CREATE TABLE expenses (
      id TEXT PRIMARY KEY,
      amount REAL,
      expense_date TEXT
    );
    INSERT INTO settings (id, key, value, type, category, is_public) VALUES
      ('1', 'reports.telegram.enabled', '1', 'boolean', 'reports', 1),
      ('2', 'reports.telegram.chat_id', '', 'string', 'reports', 1),
      ('3', 'reports.telegram.credit_sale', '1', 'boolean', 'reports', 1),
      ('4', 'reports.telegram.shift_closed', '1', 'boolean', 'reports', 1),
      ('5', 'reports.telegram.daily_digest', '1', 'boolean', 'reports', 1),
      ('6', 'reports.telegram.schedule_time', '00:00', 'string', 'reports', 1),
      ('7', 'company.name', 'Test Do''kon', 'string', 'company', 1);
  `);
  return { db, dbPath, dir };
}

async function main() {
  assert.equal(normalizeScheduleTime('9:5'), '09:05');
  assert.equal(toBool('1', false), true);
  assert.equal(toBool('false', true), false);

  const textCredit = buildCreditSaleText(
    { orderNumber: 'A-1', customerName: 'Ali', creditAmount: 150000, dueDate: '2026-08-21' },
    'Shop',
  );
  assert.match(textCredit, /Nasiya sotuv/);
  assert.match(textCredit, /150/);

  const textShift = buildShiftClosedText(
    { cashierName: 'Vali', totalPayments: 1e6, cashPayments: 4e5, expectedCash: 5e5, closingCash: 5e5, cashDifference: 0 },
    'Shop',
  );
  assert.match(textShift, /Smena yopildi/);

  const textDigest = buildDailyDigestText(
    { date: '2026-08-20', totalSales: 2e6, orderCount: 3, cashTotal: 1e6, cardTotal: 5e5, creditTotal: 5e5, expensesTotal: 1e5, customerDebtTotal: 9e5 },
    'Shop',
  );
  assert.match(textDigest, /Kunlik hisobot/);

  const { db, dir } = openTempDb();
  try {
    const settings = getReportTelegramSettings(db);
    assert.equal(settings.enabled, true);
    assert.equal(settings.scheduleTime, '00:00');

    withEnv({ TELEGRAM_REPORTS_CHAT_ID: '', TELEGRAM_ADMIN_IDS: '111,222' }, () => {
      const ids = resolveReportChatIds(db);
      assert.deepEqual(ids, [111, 222]);
    });

    withEnv({ TELEGRAM_REPORTS_CHAT_ID: '-100123', TELEGRAM_ADMIN_IDS: '111' }, () => {
      const ids = resolveReportChatIds(db);
      assert.deepEqual(ids, [-100123]);
    });

    withEnv(
      { TELEGRAM_REPORTS_CHAT_ID: '', TELEGRAM_ADMIN_IDS: '', TELEGRAM_MARKETING_CHANNEL_ID: '-100555' },
      () => {
        db.prepare(`UPDATE settings SET value = '' WHERE key = 'reports.telegram.chat_id'`).run();
        const ids = resolveReportChatIds(db);
        assert.deepEqual(ids, []);
        const dest = resolveReportDestination(db);
        assert.equal(dest.source, null);
        assert.equal(dest.chatIds.length, 0);
      },
    );

    withEnv(
      {
        TELEGRAM_REPORTS_CHAT_ID: '',
        TELEGRAM_ADMIN_IDS: '',
        TELEGRAM_MARKETING_CHANNEL_ID: '-100555',
        TELEGRAM_BOT_TOKEN: 'reports:TOKEN',
        TELEGRAM_MARKETING_BOT_TOKEN: 'marketing:TOKEN',
      },
      () => {
        db.prepare(`UPDATE settings SET value = '' WHERE key = 'reports.telegram.chat_id'`).run();
        const dest = resolveReportDestination(db);
        assert.notEqual(dest.source, 'marketing_channel');
        assert.equal(dest.chatIds.length, 0);
        assert.equal(dest.botToken, 'reports:TOKEN');
      },
    );

    withEnv(
      {
        TELEGRAM_REPORTS_CHAT_ID: '-100123',
        TELEGRAM_ADMIN_IDS: '',
        TELEGRAM_MARKETING_CHANNEL_ID: '-100123',
      },
      () => {
        db.prepare(`UPDATE settings SET value = '' WHERE key = 'reports.telegram.chat_id'`).run();
        const dest = resolveReportDestination(db);
        assert.equal(dest.chatIds.length, 0);
        assert.equal(dest.source, null);
      },
    );

    db.prepare(`UPDATE settings SET value = ? WHERE key = 'reports.telegram.chat_id'`).run('-100999');
    withEnv({ TELEGRAM_REPORTS_CHAT_ID: '-100123', TELEGRAM_ADMIN_IDS: '111' }, () => {
      const ids = resolveReportChatIds(db);
      assert.deepEqual(ids, [-100999]);
    });

    // No network: missing token → structured failure (not throw)
    const testOut = await withEnv({ TELEGRAM_BOT_TOKEN: '', TELEGRAM_ADMIN_IDS: '111' }, () =>
      sendTestReport(db),
    );
    assert.equal(testOut.ok, false);
    assert.equal(testOut.reason, 'no_bot_token');

    const noChat = await withEnv({ TELEGRAM_BOT_TOKEN: 'x'.repeat(40), TELEGRAM_ADMIN_IDS: '', TELEGRAM_REPORTS_CHAT_ID: '' }, () => {
      db.prepare(`UPDATE settings SET value = '' WHERE key = 'reports.telegram.chat_id'`).run();
      return sendTestReport(db);
    });
    assert.equal(noChat.ok, false);
    assert.equal(noChat.reason, 'no_chat_id');

    db.prepare(
      `INSERT INTO orders (id, order_number, customer_id, credit_amount, due_date)
       VALUES ('o1', 'ORD-1', NULL, 50000, '2026-08-25')`,
    ).run();

    // Disabled master switch
    db.prepare(`UPDATE settings SET value = '0' WHERE key = 'reports.telegram.enabled'`).run();
    const skipped = await notifyCreditSale(db, 'o1');
    assert.equal(skipped.skipped, true);
    assert.equal(skipped.reason, 'disabled');

    db.prepare(`UPDATE settings SET value = '1' WHERE key = 'reports.telegram.enabled'`).run();
    const noTokenSale = await withEnv({ TELEGRAM_BOT_TOKEN: '', TELEGRAM_ADMIN_IDS: '42' }, () =>
      notifyCreditSale(db, 'o1'),
    );
    assert.equal(noTokenSale.ok, false);
    assert.equal(noTokenSale.reason, 'no_bot_token');

    // Dedup: second claim after first insert should skip (simulate successful claim then skip)
    db.prepare(`INSERT INTO report_notify_log (event_key, ref_id) VALUES ('credit_sale', 'o1')`).run();
    const dedup = await withEnv({ TELEGRAM_BOT_TOKEN: 'x'.repeat(40), TELEGRAM_ADMIN_IDS: '42' }, () =>
      notifyCreditSale(db, 'o1'),
    );
    assert.equal(dedup.skipped, true);
    assert.equal(dedup.reason, 'already_sent');

    const shiftSkipDisabled = await (async () => {
      db.prepare(`UPDATE settings SET value = '0' WHERE key = 'reports.telegram.shift_closed'`).run();
      return notifyShiftClosed(db, { shiftId: 's1', totalPayments: 1 });
    })();
    assert.equal(shiftSkipDisabled.skipped, true);

    // Digest before schedule when schedule_time is far future
    db.prepare(`UPDATE settings SET value = '1' WHERE key = 'reports.telegram.shift_closed'`).run();
    db.prepare(`UPDATE settings SET value = '23:59' WHERE key = 'reports.telegram.schedule_time'`).run();
    // Only assert skip if currently before 23:59 (almost always true except last minute)
    const parts = db
      .prepare(
        `SELECT cast(strftime('%H','now','localtime') AS INTEGER) AS h,
                cast(strftime('%M','now','localtime') AS INTEGER) AS m`,
      )
      .get();
    if (parts.h * 60 + parts.m < 23 * 60 + 59) {
      const dig = await runDailyDigestTick(db, { skipLock: true });
      assert.equal(dig.skipped, true);
      assert.equal(dig.reason, 'before_schedule');
    }

    console.log('reportNotify.smoke.test.cjs: OK');
  } finally {
    db.close();
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

'use strict';

/**
 * Unit tests for bot store-report keyboard helpers (no Telegram network).
 */

const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const Database = require('better-sqlite3');

const {
  REPORT_KINDS,
  REPORT_MENU,
  REPORT_CALLBACK_PREFIX,
  CREDIT_REMIND_CALLBACK_PREFIX,
  matchReportKindFromText,
  matchReportKindFromCallback,
  matchCreditRemindCustomerId,
  buildReportReplyKeyboardRows,
  buildReportInlineKeyboardRows,
  buildDebtorReminderInlineKeyboard,
  listTopDebtorsForReminders,
  isAuthorizedReportAdmin,
  isBotButtonsEnabled,
  buildStoreReport,
  buildDebtText,
  buildProfitText,
} = require('./botStoreReports.cjs');
const { buildStoreSnapshot } = require('./storeAiAnalysis.cjs');

function openTempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-store-rep-'));
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
    INSERT INTO settings (id, key, value, type, category, is_public) VALUES
      ('1', 'reports.telegram.enabled', '1', 'boolean', 'reports', 1),
      ('2', 'reports.telegram.bot_buttons', '1', 'boolean', 'reports', 1),
      ('3', 'company.name', 'Bot Report Shop', 'string', 'company', 1);
  `);
  return { db, dir };
}

async function main() {
  assert.deepEqual(
    REPORT_KINDS.slice().sort(),
    ['ai', 'daily', 'dead_stock', 'debt', 'marketing', 'profit', 'weekly'].sort(),
  );
  assert.equal(matchReportKindFromText(REPORT_MENU.daily), 'daily');
  assert.equal(matchReportKindFromText(REPORT_MENU.ai), 'ai');
  assert.equal(matchReportKindFromText(REPORT_MENU.weekly), 'weekly');
  assert.equal(matchReportKindFromText(REPORT_MENU.dead_stock), 'dead_stock');
  assert.equal(matchReportKindFromText(REPORT_MENU.debt), 'debt');
  assert.equal(matchReportKindFromText(REPORT_MENU.profit), 'profit');
  assert.equal(matchReportKindFromText(REPORT_MENU.marketing), 'marketing');
  assert.equal(matchReportKindFromText('random'), null);

  assert.equal(matchReportKindFromCallback(`${REPORT_CALLBACK_PREFIX}ai`), 'ai');
  assert.equal(matchReportKindFromCallback(`${REPORT_CALLBACK_PREFIX}weekly`), 'weekly');
  assert.equal(matchReportKindFromCallback(`${REPORT_CALLBACK_PREFIX}haftalik`), 'weekly');
  assert.equal(matchReportKindFromCallback(`${REPORT_CALLBACK_PREFIX}marketing`), 'marketing');
  assert.equal(matchReportKindFromCallback(`${REPORT_CALLBACK_PREFIX}assortiment`), 'marketing');
  assert.equal(matchReportKindFromCallback(`${REPORT_CALLBACK_PREFIX}assortment`), 'marketing');
  assert.equal(matchReportKindFromCallback('admin_report:today_sales'), null);

  const { normalizeReportKind } = require('./botStoreReports.cjs');
  assert.equal(normalizeReportKind('marketing'), 'marketing');
  assert.equal(normalizeReportKind('assortiment'), 'marketing');
  assert.equal(normalizeReportKind('Assortment'), 'marketing');
  assert.equal(normalizeReportKind('weekly_ai'), 'weekly');
  assert.equal(normalizeReportKind('nope'), null);

  const rows = buildReportReplyKeyboardRows();
  assert.ok(rows.length >= 2);
  assert.ok(rows.flat().includes(REPORT_MENU.ai));
  assert.ok(rows.flat().includes(REPORT_MENU.weekly));
  assert.ok(rows.flat().includes(REPORT_MENU.marketing));

  const inline = buildReportInlineKeyboardRows();
  assert.ok(inline.some((r) => r.some((b) => b.callback_data === `${REPORT_CALLBACK_PREFIX}debt`)));
  assert.ok(
    inline.some((r) => r.some((b) => b.callback_data === `${REPORT_CALLBACK_PREFIX}weekly`)),
  );
  assert.ok(
    inline.some((r) => r.some((b) => b.callback_data === `${REPORT_CALLBACK_PREFIX}marketing`)),
  );

  assert.equal(isAuthorizedReportAdmin(42, '42,99'), true);
  assert.equal(isAuthorizedReportAdmin(7, '42,99'), false);
  assert.equal(isAuthorizedReportAdmin('x', '42'), false);

  const { db, dir } = openTempDb();
  try {
    assert.equal(isBotButtonsEnabled(db), true);
    db.prepare(`UPDATE settings SET value = '0' WHERE key = 'reports.telegram.bot_buttons'`).run();
    assert.equal(isBotButtonsEnabled(db), false);
    db.prepare(`UPDATE settings SET value = '1' WHERE key = 'reports.telegram.bot_buttons'`).run();

    const snap = buildStoreSnapshot(db, { storeName: 'Bot Report Shop' });
    const debt = buildDebtText(snap);
    assert.match(debt, /Qarzdorlik/);
    assert.match(debt, /Joriy|31–60|61\+/);
    const profit = buildProfitText(snap);
    assert.match(profit, /Foyda/);

    const daily = await buildStoreReport(db, 'daily');
    assert.equal(daily.ok, true);
    assert.match(daily.text, /Kunlik hisobot|Savdo/);
    assert.ok(Array.isArray(daily.texts) && daily.texts.length >= 1);

    const dead = await buildStoreReport(db, 'dead_stock');
    assert.equal(dead.ok, true);
    assert.match(dead.text, /Muzlab/);

    const ai = await buildStoreReport(db, 'ai', { apiKey: '', skipEnvLoad: true });
    assert.equal(ai.ok, true);
    assert.equal(ai.mode, 'fallback');
    assert.match(ai.text, /OPENAI_API_KEY|raqamlari|Do'kon|AI tahlil/);
    assert.match(ai.text, /<pre>/);
    assert.match(ai.text, /Marketing tavsiyalari/);

    const mkt = await buildStoreReport(db, 'marketing', { apiKey: '', skipEnvLoad: true });
    assert.equal(mkt.ok, true);
    assert.match(mkt.text, /Marketing tavsiyalari/);
    assert.match(mkt.text, /Top 3 amal/);
    assert.match(mkt.text, /assortiment|Yangi mahsulot/i);
    assert.match(mkt.text, /ichki ma[’']lumot asosida taxmin/i);

    const mktAlias = await buildStoreReport(db, 'assortiment', { apiKey: '', skipEnvLoad: true });
    assert.equal(mktAlias.ok, true);
    assert.equal(mktAlias.kind, 'marketing');

    const weekly = await buildStoreReport(db, 'weekly', { skipEnvLoad: true });
    assert.equal(weekly.ok, true);
    assert.equal(weekly.kind, 'weekly');
    assert.match(weekly.text, /Haftalik AI/);
    assert.match(weekly.text, /Taqqoslash|Savdo/);

    assert.equal(matchCreditRemindCustomerId(`${CREDIT_REMIND_CALLBACK_PREFIX}abc-123`), 'abc-123');
    assert.equal(matchCreditRemindCustomerId('store_report:debt'), null);

    const fakeSnap = {
      marketing: {
        collection_targets: [
          { id: 'cust-1', name: 'Ali', total: 100000, campaign: 'yumshoq_eslatma' },
          { id: 'cust-2', name: 'Vali', total: 50000, campaign: '61+_undirish' },
        ],
      },
      aging: { customers: { top: [] } },
    };
    assert.equal(listTopDebtorsForReminders(fakeSnap, 5).length, 2);
    // Without telegram_id binding, keyboard is null (no buttons)
    const kbNone = buildDebtorReminderInlineKeyboard(db, fakeSnap);
    assert.equal(kbNone, null);

    const bad = await buildStoreReport(db, 'nope');
    assert.equal(bad.ok, false);
    assert.equal(bad.reason, 'invalid_kind');

    console.log('botStoreReports.smoke.test.cjs: OK');
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

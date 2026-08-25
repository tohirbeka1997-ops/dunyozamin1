'use strict';

/**
 * Smoke tests for daily store poster — mocked LLM/Gemini/Telegram, no real spend.
 */

const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const Database = require('better-sqlite3');

const poster = require('./dailyStorePoster.cjs');

const pickRubric = poster.pickRubric || poster.pickRubric;
const getDailyPosterSettings = poster.getDailyPosterSettings || poster.getDailyPosterSettings;
const shouldRunDailyPoster = poster.shouldRunDailyPoster || poster.shouldRunDailyPoster;
const composePoster = poster.composePoster || poster.composePoster;
const runDailyPosterTick = poster.runDailyPosterTick || poster.runDailyPosterTick;
const sendDailyPosterNow = poster.sendDailyPosterNow || poster.sendDailyPosterNow;
const isPublishableProductName = poster.isPublishableProductName || poster.isPublishableProductName;
const buildTemplateCaption = poster.buildTemplateCaption || poster.buildTemplateCaption;
const qualityCheckCaption = poster.qualityCheckCaption || poster.qualityCheckCaption;
const { RUBRICS } = poster;

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'daily-poster-'));
  const db = new Database(path.join(dir, 't.db'));
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
    CREATE TABLE categories (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE products (
      id TEXT PRIMARY KEY,
      name TEXT,
      sale_price REAL,
      current_stock REAL,
      image_url TEXT,
      category_id TEXT,
      is_active INTEGER DEFAULT 1
    );
  `);
  db.prepare(`INSERT INTO categories (id, name) VALUES ('c1', 'Ichimliklar')`).run();
  db.prepare(
    `INSERT INTO products (id, name, sale_price, current_stock, image_url, category_id, is_active)
     VALUES ('p1', 'Cola 1.5L', 15000, 12, 'https://example.com/cola.jpg', 'c1', 1)`,
  ).run();
  db.prepare(
    `INSERT INTO products (id, name, sale_price, current_stock, image_url, category_id, is_active)
     VALUES ('p2', 'Non', 3000, 40, NULL, 'c1', 1)`,
  ).run();
  db.prepare(
    `INSERT INTO products (id, name, sale_price, current_stock, image_url, category_id, is_active)
     VALUES ('p3', '4780123456789', 9000, 99, 'https://example.com/x.jpg', 'c1', 1)`,
  ).run();
  return { db, dir };
}

function seedSetting(db, key, value, type = 'string') {
  db.prepare(
    `INSERT INTO settings (id, key, value, type, category, is_public)
     VALUES (?, ?, ?, ?, 'reports', 1)`,
  ).run(`id-${key}`, key, String(value), type);
}

async function main() {
  assert.ok(typeof pickRubric === 'function', 'pickRubric missing');
  assert.ok(typeof sendDailyPosterNow === 'function', 'sendDailyPosterNow missing');
  assert.equal(RUBRICS.length, 12);
  assert.equal(pickRubric(1).id, RUBRICS[1 % 12].id);
  assert.equal(pickRubric(12).id, RUBRICS[0].id);
  assert.equal(isPublishableProductName('Cola 1.5L'), true);
  assert.equal(isPublishableProductName('1234567890123'), false);
  assert.equal(isPublishableProductName('SKU-991'), false);
  assert.equal(isPublishableProductName('test'), false);

  const rubric = RUBRICS[0];
  const product = { name: 'Cola 1.5L', sale_price: 15000, current_stock: 5, category_name: 'Ichimliklar' };
  const caption = buildTemplateCaption({ storeName: 'Test Market', product, rubric });
  assert.ok(caption.includes('Cola'));
  assert.ok(caption.includes('15'));
  assert.ok(/News/i.test(caption));
  const qc = qualityCheckCaption(caption, product);
  assert.equal(qc.ok, true);

  assert.equal(qualityCheckCaption('', product).ok, false);
  assert.equal(
    qualityCheckCaption(
      'Buy Cola 1.5L today for amazing casino bonuses and guaranteed profit everywhere online now',
      product,
    ).reason,
    'forbidden_content',
  );
  assert.equal(
    qualityCheckCaption(
      'Cola 1.5L — bugungi qarz va nasiya hisobotiga qarang, narx 15000',
      product,
    ).reason,
    'forbidden_content',
  );

  const { db } = openTempDb();
  seedSetting(db, 'reports.telegram.daily_poster', '1', 'boolean');
  seedSetting(db, 'reports.telegram.daily_poster_time', '00:00', 'string');
  seedSetting(db, 'company_name', 'Test Market', 'string');

  await withEnv(
    {
      TELEGRAM_MARKETING_BOT_TOKEN: '123:ABC',
      TELEGRAM_MARKETING_CHANNEL_ID: '-100111',
      TELEGRAM_REPORTS_CHAT_ID: '-100222',
      OPENAI_API_KEY: '',
      GEMINI_API_KEY: '',
    },
    async () => {
      const settings = getDailyPosterSettings(db);
      assert.equal(settings.enabled, true);
      assert.equal(settings.scheduleTime, '00:00');

      const gate = shouldRunDailyPoster(db, settings, { force: true });
      assert.equal(gate.ok, true);

      const composed = await composePoster(db, {
        skipEnvLoad: true,
        skipImage: true,
        fetchFn: async () => ({ ok: false, status: 500, text: async () => '' }),
      });
      assert.equal(composed.ok, true);
      assert.ok(composed.caption);
      assert.ok(composed.product?.name);
      assert.notEqual(composed.product.name, '4780123456789');

      let posted = false;
      const origFetch = globalThis.fetch;
      globalThis.fetch = async (url) => {
        const u = String(url);
        if (u.includes('sendMessage') || u.includes('sendPhoto')) {
          posted = true;
          return { ok: true, text: async () => '{}' };
        }
        return { ok: false, status: 404, text: async () => 'no' };
      };
      try {
        const sent = await sendDailyPosterNow(db, {
          skipEnvLoad: true,
          skipImage: true,
          botToken: '123:ABC',
          channelId: '-100111',
        });
        assert.equal(sent.ok, true);
        assert.equal(sent.sent, 1);
        assert.equal(posted, true);

        const again = await runDailyPosterTick(db, {
          skipEnvLoad: true,
          skipImage: true,
          botToken: '123:ABC',
          channelId: '-100111',
        });
        assert.equal(again.skipped, true);
        assert.equal(again.reason, 'already_ran_today');
      } finally {
        globalThis.fetch = origFetch;
      }
    },
  );

  console.log('dailyStorePoster.smoke.test.cjs: OK');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

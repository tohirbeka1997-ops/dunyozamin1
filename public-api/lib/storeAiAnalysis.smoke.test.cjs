'use strict';

/**
 * Smoke tests for AI store analysis (Phase 1) — mocked LLM, no real OpenAI spend.
 * Optional live call: set STORE_AI_LIVE=1 and OPENAI_API_KEY (skipped otherwise).
 */

const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const Database = require('better-sqlite3');

const {
  buildStoreSnapshot,
  buildNumericAnalysisText,
  formatNumericFallback,
  formatSumma,
  formatDaysCell,
  truncName,
  buildMonoTable,
  formatAiFallbackNotice,
  classifyOpenAiHttpError,
  callOpenAiAnalysis,
  composeAiAnalysisMessage,
  runAiAnalysisTick,
  sendAiAnalysisNow,
  getAiSettings,
  assertNoSecrets,
  resolveOpenAiConfig,
  looksLikeLegacyNumberedReport,
  sanitizeAiCommentary,
} = require('./storeAiAnalysis.cjs');

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'store-ai-'));
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
      balance REAL DEFAULT 0,
      phone TEXT
    );
    CREATE TABLE expenses (
      id TEXT PRIMARY KEY,
      amount REAL,
      expense_date TEXT
    );
    INSERT INTO settings (id, key, value, type, category, is_public) VALUES
      ('1', 'reports.telegram.enabled', '1', 'boolean', 'reports', 1),
      ('2', 'reports.telegram.chat_id', '-100111', 'string', 'reports', 1),
      ('3', 'reports.telegram.daily_digest', '1', 'boolean', 'reports', 1),
      ('4', 'reports.telegram.ai_enabled', '1', 'boolean', 'reports', 1),
      ('5', 'reports.telegram.schedule_time', '00:00', 'string', 'reports', 1),
      ('6', 'reports.telegram.ai_last_run_date', '', 'string', 'reports', 0),
      ('7', 'company.name', 'AI Test Shop', 'string', 'company', 1);
    INSERT INTO customers (id, name, balance, phone) VALUES
      ('c1', 'Ali', -150000, '+998901112233');
    INSERT INTO expenses (id, amount, expense_date) VALUES
      ('e1', 25000, date('now', 'localtime'));
  `);
  return { db, dir };
}

async function main() {
  const cfg = resolveOpenAiConfig({ apiKey: '', model: '' });
  assert.equal(cfg.model, 'gpt-4o-mini');
  assert.ok(cfg.baseUrl.includes('api.openai.com'));

  const { db, dir } = openTempDb();
  try {
    const settings = getAiSettings(db);
    assert.equal(settings.aiEnabled, true);
    assert.equal(settings.enabled, true);

    const snapshot = buildStoreSnapshot(db);
    assert.equal(snapshot.store_name, 'AI Test Shop');
    assert.ok(snapshot.daily);
    assert.ok('cash' in snapshot.daily && 'card' in snapshot.daily && 'credit' in snapshot.daily);
    assert.ok('returns_total' in snapshot.daily);
    assert.ok(snapshot.profit);
    assert.ok(Array.isArray(snapshot.dead_stock_top));
    assert.ok(Array.isArray(snapshot.fast_movers_top));
    assert.ok(Array.isArray(snapshot.slow_movers_top));
    assert.ok(snapshot.aging?.customers?.aging_simple);
    assert.ok('current' in snapshot.aging.customers.aging_simple);
    assert.ok('31_60' in snapshot.aging.customers.aging_simple);
    assert.ok('61_plus' in snapshot.aging.customers.aging_simple);
    assert.ok(snapshot.aging?.suppliers);
    assert.ok(snapshot.price_guidance);
    assert.ok(Array.isArray(snapshot.price_guidance.discount_candidates));
    assert.ok(snapshot.marketing);
    assert.ok(Array.isArray(snapshot.marketing.marketing_actions));
    assert.ok(Array.isArray(snapshot.marketing.assortment_suggestions));
    assert.ok(snapshot.marketing.assortment_suggestions.length >= 1);
    assert.ok(
      snapshot.marketing.assortment_suggestions.every(
        (s) => /ichki/i.test(String(s.label || '')) || /ichki/i.test(String(s.text || '')),
      ),
    );
    assertNoSecrets(snapshot);
    // phones must never appear as keys; values should not include the test phone either
    const json = JSON.stringify(snapshot);
    assert.equal(json.includes('+998901112233'), false);
    assert.equal(json.includes('901112233'), false);

    const { splitTelegramText, buildSystemPrompt } = require('./storeAiAnalysis.cjs');
    const long = `${'A'.repeat(2000)}\n\n${'B'.repeat(2000)}\n\n${'C'.repeat(2000)}`;
    const tgParts = splitTelegramText(long, 3900);
    assert.ok(tgParts.length >= 1 && tgParts.length <= 2);
    assert.ok(tgParts.every((p) => p.length <= 3900));
    assert.match(buildSystemPrompt(), /Xulosa|Jadval|Sarlavha/i);
    assert.match(buildSystemPrompt(), /TAQIQLANGAN|YOZMA|YUQMA/i);
    assert.match(buildSystemPrompt(), /marketing|assortiment|Marketing/i);

    assert.equal(formatSumma(1200000), '1 200 000');
    assert.equal(formatDaysCell(null), '—');
    assert.equal(formatDaysCell(0), '—');
    assert.equal(formatDaysCell(45), '45');
    assert.equal(truncName('Juda uzun mahsulot nomi test', 10).endsWith('…'), true);
    assert.equal(formatNumericFallback, buildNumericAnalysisText);

    assert.equal(
      looksLikeLegacyNumberedReport(
        '1) Sarlavha: Test\n2) Bugungi savdo: 1 mln\n3) Foyda\n4) Qarz',
      ),
      true,
    );
    assert.equal(sanitizeAiCommentary('1) Sarlavha: Test\n2) Bugungi savdo'), null);
    assert.match(
      sanitizeAiCommentary("Xulosa: Savdo yaxshi. 61+ qarzni tekshiring.") || '',
      /Savdo yaxshi/,
    );

    const mono = buildMonoTable(
      ['#', 'Mahsulot', 'Qiymat', 'Kun'],
      [
        ['1', 'Test', '1 200 000', '—'],
        ['2', truncName('ABC', 14), formatSumma(500), '12'],
      ],
      [2, 14, 12, 4],
    );
    assert.match(mono, /Mahsulot/);
    assert.match(mono, /1 200 000/);
    assert.match(mono, /—/);

    const numeric = buildNumericAnalysisText(snapshot, { reason: 'no_api_key', aiTitle: true });
    assert.match(numeric, /<b>.*AI tahlil|raqamlari/i);
    assert.match(numeric, /<pre>/);
    assert.match(numeric, /Naqd/);
    assert.match(numeric, /Karta/);
    assert.match(numeric, /Nasiya/);
    assert.match(numeric, /Jami/);
    assert.match(numeric, /Sog'lik|Sog‘lik/);
    assert.match(numeric, /Muzlab/);
    assert.match(numeric, /Top 3 amal/);
    // Top 3 must appear before Savdo section
    {
      const iTop = numeric.indexOf('Top 3 amal');
      const iSavdo = numeric.indexOf('Savdo');
      assert.ok(iTop >= 0 && iSavdo >= 0 && iTop < iSavdo, 'Top 3 amal should precede Savdo');
    }
    assert.match(numeric, /Marketing tavsiyalari/);
    assert.match(numeric, /Yangi mahsulot|assortiment/i);
    assert.match(numeric, /ichki ma[’']lumot asosida taxmin/i);
    assert.match(numeric, /OPENAI_API_KEY/);
    assert.match(numeric, /61\+/);
    // dead-stock days: fixture has no inventory — still must not hardcode bogus " / 0"
    assert.equal(numeric.includes(' / 0'), false);

    const numericNoNotice = buildNumericAnalysisText(snapshot, {
      aiTitle: true,
      includeNotice: false,
    });
    assert.match(numericNoNotice, /<pre>/);
    assert.equal(numericNoNotice.includes('OPENAI_API_KEY'), false);

    assert.match(formatAiFallbackNotice('billing'), /kvota|to‘lov|tolov/i);
    assert.match(formatAiFallbackNotice('http_401'), /401/);
    assert.match(formatAiFallbackNotice('rate_limit'), /429/);
    assert.match(formatAiFallbackNotice('network_error'), /tarmoq/i);
    assert.equal(classifyOpenAiHttpError(401, '{}').reason, 'http_401');
    assert.equal(
      classifyOpenAiHttpError(429, JSON.stringify({ error: { code: 'insufficient_quota' } })).reason,
      'billing',
    );
    assert.equal(
      classifyOpenAiHttpError(429, JSON.stringify({ error: { code: 'rate_limit_exceeded' } })).reason,
      'rate_limit',
    );

    const noKey = await withEnv({ OPENAI_API_KEY: '', GEMINI_API_KEY: '' }, () =>
      callOpenAiAnalysis(snapshot, { skipEnvLoad: true }),
    );
    assert.equal(noKey.ok, false);
    assert.equal(noKey.reason, 'no_api_key');

    let fetchCalls = 0;
    const mockFetch = async (url, init) => {
      fetchCalls += 1;
      assert.match(String(url), /chat\/completions/);
      const body = JSON.parse(init.body);
      assert.equal(body.model, 'gpt-4o-mini');
      assert.ok(body.messages?.length >= 2);
      // ensure phone not in prompt payload
      assert.equal(JSON.stringify(body).includes('+998901112233'), false);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: {
                content:
                  "Xulosa: Savdo barqaror, O‘RTACHA. 61+ qarz va muzlab tovarlarni nazorat qiling.",
              },
            },
          ],
        }),
      };
    };

    const llmOk = await callOpenAiAnalysis(snapshot, {
      apiKey: 'sk-test-mock',
      fetchFn: mockFetch,
    });
    assert.equal(llmOk.ok, true);
    assert.match(llmOk.text, /Xulosa|Savdo/);
    assert.equal(fetchCalls, 1);

    const composed = await composeAiAnalysisMessage(db, {
      apiKey: 'sk-test-mock',
      fetchFn: mockFetch,
    });
    assert.equal(composed.mode, 'ai');
    assert.match(composed.text, /AI tahlil/);
    assert.match(composed.text, /<pre>/);
    assert.match(composed.text, /Naqd/);
    assert.match(composed.text, /Xulosa/);
    assert.equal(composed.text.includes('1) Sarlavha'), false);

    const legacyFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: {
              content:
                '1) Sarlavha: Kunlik\n2) Bugungi savdo: 1 mln\n3) Foyda\n4) Qarz\n5) Amallar',
            },
          },
        ],
      }),
    });
    const composedLegacy = await composeAiAnalysisMessage(db, {
      apiKey: 'sk-test-mock',
      fetchFn: legacyFetch,
    });
    assert.equal(composedLegacy.mode, 'fallback');
    assert.equal(composedLegacy.fallbackReason, 'bad_format');
    assert.match(composedLegacy.text, /<pre>/);
    assert.match(composedLegacy.text, /Naqd/);
    assert.equal(composedLegacy.text.includes('1) Sarlavha'), false);

    const composedFallback = await withEnv({ OPENAI_API_KEY: '', GEMINI_API_KEY: '' }, () =>
      composeAiAnalysisMessage(db, {
        apiKey: '',
        fetchFn: mockFetch,
        skipEnvLoad: true,
      }),
    );
    assert.equal(composedFallback.mode, 'fallback');
    assert.equal(composedFallback.fallbackReason, 'no_api_key');
    assert.equal(composedFallback.parseMode, 'HTML');
    assert.match(composedFallback.text, /OPENAI_API_KEY|GEMINI_API_KEY/);
    assert.match(composedFallback.text, /<pre>/);
    assert.match(composedFallback.text, /Top 3 amal/);
    assert.match(composedFallback.text, /Marketing tavsiyalari/);
    assert.match(composedFallback.text, /assortiment/i);

    const { buildMarketingAnalysisText, buildMorningBriefText, shouldRunMorningBrief, getAiSettings: getAi, buildWeeklyComparison, buildWeeklyAnalysisText, shouldRunWeeklyAi, suggestDiscountPct, buildMarketingPostDrafts, runWeeklyAiTick } = require('./storeAiAnalysis.cjs');
    const mktOnly = buildMarketingAnalysisText(snapshot, { aiTitle: true });
    assert.match(mktOnly, /Marketing/);
    assert.match(mktOnly, /Top 3 amal/);
    {
      const iTop = mktOnly.indexOf('Top 3 amal');
      const iMkt = mktOnly.indexOf('Marketing tavsiyalari');
      assert.ok(iTop >= 0 && iMkt >= 0 && iTop < iMkt, 'Top 3 should precede marketing body');
    }
    assert.match(mktOnly, /Yangi mahsulot|assortiment/i);
    assert.match(mktOnly, /ichki ma[’']lumot asosida taxmin/i);
    assert.match(mktOnly, /TG post shablonlari|post shablon/i);

    assert.equal(suggestDiscountPct(90, 100000), 25);
    assert.equal(suggestDiscountPct(60, 100000), 20);
    assert.equal(suggestDiscountPct(45, 100000), 15);
    assert.equal(suggestDiscountPct(10, 100000), 10);
    assert.equal(suggestDiscountPct(10, 6_000_000), 25);

    const drafts = buildMarketingPostDrafts(snapshot, 5);
    assert.ok(Array.isArray(drafts) && drafts.length >= 1);

    const morning = buildMorningBriefText(snapshot, { eveningTime: '21:00' });
    assert.match(morning, /Bugungi diqqat/);
    assert.match(morning, /Top 3 amal/);
    assert.match(morning, /21:00/);

    const weeklyCmp = buildWeeklyComparison(db, { storeName: 'AI Test Shop' });
    assert.ok(weeklyCmp.this_week?.start);
    assert.ok(weeklyCmp.last_week?.end);
    assert.ok('total_sales' in weeklyCmp.this_week);
    assert.ok('debt_total' in weeklyCmp.this_week);
    assert.ok('dead_stock_value' in weeklyCmp.this_week);
    const weeklyText = buildWeeklyAnalysisText(weeklyCmp);
    assert.match(weeklyText, /Haftalik AI/);
    assert.match(weeklyText, /Taqqoslash/);
    assert.match(weeklyText, /<pre>/);

    db.prepare(
      `INSERT OR IGNORE INTO settings (id, key, value, type, category, is_public) VALUES
        ('mb1', 'reports.telegram.morning_brief', '1', 'boolean', 'reports', 1),
        ('mb2', 'reports.telegram.morning_brief_time', '00:00', 'string', 'reports', 1),
        ('mb3', 'reports.telegram.morning_brief_last_run_date', '', 'string', 'reports', 0),
        ('w1', 'reports.telegram.weekly_ai', '1', 'boolean', 'reports', 1),
        ('w2', 'reports.telegram.weekly_ai_time', '00:00', 'string', 'reports', 1),
        ('w3', 'reports.telegram.weekly_ai_weekday', '0', 'string', 'reports', 1),
        ('w4', 'reports.telegram.weekly_ai_last_run_week', '', 'string', 'reports', 0),
        ('ep1', 'reports.telegram.evening_package', '0', 'boolean', 'reports', 1)`,
    ).run();
    const aiSet = getAi(db);
    assert.equal(aiSet.morningBrief, true);
    assert.equal(aiSet.morningBriefTime, '00:00');
    assert.equal(aiSet.weeklyAi, true);
    assert.equal(aiSet.eveningPackage, false);
    const morningGate = shouldRunMorningBrief(db, aiSet, {});
    // With 00:00 schedule and empty last_run — due unless already past evening window
    assert.ok(
      morningGate.ok ||
        morningGate.reason === 'after_evening_window' ||
        morningGate.reason === 'already_ran_today',
      `unexpected morning gate: ${morningGate.reason}`,
    );

    const weeklyGate = shouldRunWeeklyAi(db, aiSet, {});
    assert.ok(
      weeklyGate.ok ||
        weeklyGate.reason === 'wrong_weekday' ||
        weeklyGate.reason === 'before_schedule' ||
        weeklyGate.reason === 'already_ran_this_week',
      `unexpected weekly gate: ${weeklyGate.reason}`,
    );
    const weeklyForced = await runWeeklyAiTick(db, {
      force: true,
      skipLock: true,
      botToken: '',
    });
    // no bot token → send fails but gate passed
    assert.ok(weeklyForced.skipped !== true || weeklyForced.reason);
    if (!weeklyForced.skipped) {
      assert.ok(weeklyForced.reason === 'no_bot_token' || weeklyForced.sent === 0 || weeklyForced.ok === false);
    }

    const composedEvening = await withEnv({ OPENAI_API_KEY: '', GEMINI_API_KEY: '' }, () =>
      composeAiAnalysisMessage(db, {
        apiKey: '',
        eveningPackage: true,
        skipEnvLoad: true,
      }),
    );
    assert.match(composedEvening.text, /Kechki paket/);
    assert.match(composedEvening.text, /Kunlik hisobot|Savdo/);

    const composedMkt = await withEnv({ OPENAI_API_KEY: '', GEMINI_API_KEY: '' }, () =>
      composeAiAnalysisMessage(db, {
        apiKey: '',
        marketingOnly: true,
        skipEnvLoad: true,
      }),
    );
    assert.equal(composedMkt.mode, 'fallback');
    assert.match(composedMkt.text, /Marketing tavsiyalari/);
    assert.match(composedMkt.text, /assortiment/i);

    // Dead-stock days: null/0 → "—", never raw trailing "0" as days
    const withDead = {
      ...snapshot,
      dead_stock_top: [
        { name: 'Never Sold Product', frozen_value: 250000, days_since_last_sale: null, suggested_discount_pct: 15 },
        { name: 'Zero Days Bug', frozen_value: 100000, days_since_last_sale: 0, suggested_discount_pct: 10 },
        { name: 'Old Stock', frozen_value: 500000, days_since_last_sale: 90, suggested_discount_pct: 25 },
      ],
      price_guidance: {
        discount_candidates: [
          { name: 'Old Stock', frozen_value: 500000, days_since_last_sale: 90, suggested_discount_pct: 25 },
        ],
        low_margin: [],
      },
    };
    const deadText = buildNumericAnalysisText(withDead, { reason: 'no_api_key' });
    assert.match(deadText, /Muzlab/);
    assert.match(deadText, /90/);
    assert.match(deadText, /25%/);
    // two em-dashes for null and 0 days
    assert.ok((deadText.match(/—/g) || []).length >= 2);
    assert.equal(deadText.includes('Zero Days Bug') || deadText.includes('Zero Days'), true);

    const mock429 = async () => ({
      ok: false,
      status: 429,
      text: async () => JSON.stringify({ error: { code: 'insufficient_quota', type: 'insufficient_quota' } }),
    });
    const llm429 = await callOpenAiAnalysis(snapshot, { apiKey: 'sk-test', fetchFn: mock429 });
    assert.equal(llm429.reason, 'billing');
    const composedBilling = await composeAiAnalysisMessage(db, {
      apiKey: 'sk-test',
      fetchFn: mock429,
    });
    assert.equal(composedBilling.fallbackReason, 'billing');
    assert.match(composedBilling.text, /kvota|to‘lov/i);
    assert.match(composedBilling.text, /<pre>/);

    // Schedule gate: far-future schedule → skip
    db.prepare(`UPDATE settings SET value = '23:59' WHERE key = 'reports.telegram.schedule_time'`).run();
    const parts = db
      .prepare(
        `SELECT cast(strftime('%H','now','localtime') AS INTEGER) AS h,
                cast(strftime('%M','now','localtime') AS INTEGER) AS m`,
      )
      .get();
    if (parts.h * 60 + parts.m < 23 * 60 + 59) {
      const skipped = await runAiAnalysisTick(db, { skipLock: true, apiKey: 'sk-x', fetchFn: mockFetch });
      assert.equal(skipped.skipped, true);
      assert.equal(skipped.reason, 'before_schedule');
    }

    db.prepare(`UPDATE settings SET value = '00:00' WHERE key = 'reports.telegram.schedule_time'`).run();
    db.prepare(`UPDATE settings SET value = '0' WHERE key = 'reports.telegram.ai_enabled'`).run();
    const aiOff = await runAiAnalysisTick(db, { skipLock: true });
    assert.equal(aiOff.skipped, true);
    assert.equal(aiOff.reason, 'ai_disabled');

    // On-demand without bot token
    db.prepare(`UPDATE settings SET value = '1' WHERE key = 'reports.telegram.ai_enabled'`).run();
    const noBot = await withEnv({ TELEGRAM_BOT_TOKEN: '', TELEGRAM_MARKETING_BOT_TOKEN: '' }, () =>
      sendAiAnalysisNow(db, { apiKey: '', fetchFn: mockFetch, skipEnvLoad: true }),
    );
    assert.equal(noBot.ok, false);
    assert.equal(noBot.reason, 'no_bot_token');

    // Optional live (never fails CI when key missing)
    if (String(process.env.STORE_AI_LIVE || '') === '1' && String(process.env.OPENAI_API_KEY || '').trim()) {
      const live = await callOpenAiAnalysis(snapshot, { timeoutMs: 60_000 });
      assert.equal(live.ok, true, live.reason || 'live openai failed');
      assert.ok(live.text && live.text.length > 20);
      console.log('storeAiAnalysis.smoke.test.cjs: live OpenAI OK (text length', live.text.length + ')');
    } else {
      console.log('storeAiAnalysis.smoke.test.cjs: live OpenAI skipped (set STORE_AI_LIVE=1 with key)');
    }

    console.log('storeAiAnalysis.smoke.test.cjs: OK');
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

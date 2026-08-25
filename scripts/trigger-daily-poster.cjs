'use strict';

/**
 * One-shot: force send daily marketing poster. Logs status only (no secrets).
 * Usage: node scripts/trigger-daily-poster.cjs
 */
try {
  require('../electron/config/loadRootEnv.cjs').loadRootEnv();
} catch {
  // ignore
}

const path = require('path');
const Database = require('better-sqlite3');

function resolveDbPath() {
  try {
    const { resolvePublicApiDbPath } = require('../public-api/lib/dbPathSync.cjs');
    return resolvePublicApiDbPath();
  } catch {
    const dir = process.env.POS_DATA_DIR || path.join(__dirname, '..', 'data');
    return path.join(dir, 'pos.db');
  }
}

async function main() {
  const dbPath = resolveDbPath();
  const db = new Database(dbPath, { readonly: false, fileMustExist: true });
  try {
    // ensure settings rows exist (migration may not have run yet)
    try {
      const sql = require('fs').readFileSync(
        path.join(__dirname, '..', 'electron/db/migrations/123_telegram_daily_poster_settings.sql'),
        'utf8',
      );
      db.exec(sql);
    } catch {
      // ignore
    }

    const { sendDailyPosterNow, resolveMarketingCredentials, resolveGeminiConfig } = require('../public-api/lib/dailyStorePoster.cjs');
    const creds = resolveMarketingCredentials({ skipEnvLoad: true });
    const gemini = resolveGeminiConfig({ skipEnvLoad: true });
    console.log(
      JSON.stringify({
        db_ok: true,
        has_marketing_token: Boolean(creds.botToken),
        has_channel: Boolean(creds.channelId),
        has_gemini: Boolean(gemini.hasApiKey),
      }),
    );

    const out = await sendDailyPosterNow(db, {});
    console.log(
      JSON.stringify({
        ok: Boolean(out?.ok),
        sent: out?.sent || 0,
        failed: out?.failed || 0,
        skipped: Boolean(out?.skipped),
        reason: out?.reason || null,
        rubric: out?.rubric || null,
        method: out?.method || null,
        imageSource: out?.imageSource || null,
        captionSource: out?.captionSource || null,
        today: out?.today || null,
      }),
    );
  } finally {
    db.close();
  }
}

main().catch((e) => {
  console.error(JSON.stringify({ ok: false, error: String(e?.message || e).slice(0, 200) }));
  process.exit(1);
});

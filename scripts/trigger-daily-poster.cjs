'use strict';

/**
 * One-shot: force send daily marketing poster. Logs status only (no secrets).
 * Usage:
 *   node scripts/trigger-daily-poster.cjs
 *   node scripts/trigger-daily-poster.cjs --type=useful_tip
 *   node scripts/trigger-daily-poster.cjs --type=life_hack --sample
 */
try {
  require('../electron/config/loadRootEnv.cjs').loadRootEnv();
} catch {
  // ignore
}

const path = require('path');
const Database = require('better-sqlite3');

function parseArgs(argv) {
  const out = { contentTypeId: null, sampleOnly: false, skipImage: false };
  for (const raw of argv.slice(2)) {
    const a = String(raw || '').trim();
    if (a === '--sample' || a === '--sample-only') out.sampleOnly = true;
    else if (a === '--skip-image') out.skipImage = true;
    else if (a.startsWith('--type=')) out.contentTypeId = a.slice('--type='.length).trim() || null;
    else if (a === '--type' || a === '-t') {
      /* next handled below via index — keep simple: only --type= */
    }
  }
  return out;
}

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
  const args = parseArgs(process.argv);
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

    const {
      sendDailyPosterNow,
      resolveMarketingCredentials,
      resolveGeminiConfig,
      CONTENT_TYPES,
    } = require('../public-api/lib/dailyStorePoster.cjs');
    const creds = resolveMarketingCredentials({ skipEnvLoad: true });
    const gemini = resolveGeminiConfig({ skipEnvLoad: true });
    console.log(
      JSON.stringify({
        db_ok: true,
        has_marketing_token: Boolean(creds.botToken),
        has_channel: Boolean(creds.channelId),
        has_gemini: Boolean(gemini.hasApiKey),
        content_types: CONTENT_TYPES.map((c) => c.id),
        requested_type: args.contentTypeId || null,
        sample_only: args.sampleOnly,
      }),
    );

    const out = await sendDailyPosterNow(db, {
      contentTypeId: args.contentTypeId || undefined,
      sampleOnly: args.sampleOnly,
      skipImage: args.skipImage,
    });
    console.log(
      JSON.stringify({
        ok: Boolean(out?.ok),
        sent: out?.sent || 0,
        failed: out?.failed || 0,
        skipped: Boolean(out?.skipped),
        reason: out?.reason || null,
        rubric: out?.rubric || null,
        rubricTitle: out?.rubricTitle || null,
        contentType: out?.contentType || null,
        contentTypeTitle: out?.contentTypeTitle || null,
        contentKind: out?.contentKind || null,
        topic: out?.topic || null,
        productName: out?.productName || null,
        method: out?.method || null,
        imageSource: out?.imageSource || null,
        captionSource: out?.captionSource || null,
        captionLen: out?.captionLen || 0,
        today: out?.today || null,
        sampleOnly: Boolean(out?.sampleOnly),
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

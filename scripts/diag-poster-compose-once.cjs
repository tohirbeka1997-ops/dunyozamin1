'use strict';

/**
 * One-shot compose probe for daily poster (no Telegram send, no secrets).
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
    const { resolvePosDbPath } = require('../electron/lib/resolvePosDbPath.cjs');
    return resolvePosDbPath();
  } catch {
    const dir = process.env.POS_DATA_DIR || path.join(__dirname, '..', 'data');
    return path.join(dir, 'pos.db');
  }
}

async function main() {
  const dbPath = resolveDbPath();
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const poster = require('../public-api/lib/dailyStorePoster.cjs');
    const gemini = poster.resolveGeminiConfig({ skipEnvLoad: true });
    const creds = poster.resolveMarketingCredentials({ skipEnvLoad: true });
    console.log(
      JSON.stringify({
        db_ok: true,
        has_gemini: Boolean(gemini.hasApiKey),
        gemini_model: gemini.model || null,
        has_marketing: Boolean(creds.hasCredentials),
      }),
    );

    const type = String(process.argv[2] || 'useful_tip').trim() || 'useful_tip';
    const composed = await poster.composePoster(db, {
      contentTypeId: type,
      skipEnvLoad: true,
    });
    console.log(
      JSON.stringify({
        ok: Boolean(composed?.ok),
        reason: composed?.reason || null,
        contentType: composed?.contentType?.id || null,
        topic: composed?.topic || null,
        captionSource: composed?.captionSource || null,
        captionLen: composed?.caption ? String(composed.caption).length : 0,
        captionPreview: composed?.caption
          ? String(composed.caption).replace(/\s+/g, ' ').slice(0, 220)
          : null,
        imageOk: Boolean(composed?.image?.ok),
        imageSource: composed?.image?.source || null,
        imageReason: composed?.image?.reason || composed?.image?.fallbackFrom || null,
        imageBytes: composed?.image?.photoBuffer ? composed.image.photoBuffer.length : 0,
        productName: composed?.product?.name || null,
      }),
    );
  } finally {
    db.close();
  }
}

main().catch((e) => {
  console.error(JSON.stringify({ ok: false, error: String(e?.message || e).slice(0, 240) }));
  process.exit(1);
});

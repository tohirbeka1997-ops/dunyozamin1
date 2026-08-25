'use strict';

/**
 * Daily public store marketing poster → TELEGRAM_MARKETING_CHANNEL_ID only.
 * Creative Uzbek captions, rotating rubrics, Gemini/Nano Banana image (fallback: product photo).
 * Never posts to TELEGRAM_REPORTS_CHAT_ID.
 */

const fs = require('fs');
const path = require('path');
const SettingsService = require('../../electron/services/settingsService.cjs');
const { tryAcquireSchedulerLock } = require('./schedulerLock.cjs');
const { sendTelegramText, sendTelegramPhoto } = require('./telegramNotify.cjs');
const {
  extractProductImageFileName,
  getProductImageDir,
  resolveCatalogImageUrl,
} = require('./productImageUrl.cjs');
const {
  toBool,
  normalizeScheduleTime,
  getReportTelegramSettings,
} = require('./reportNotify.cjs');
const {
  resolveOpenAiConfig,
  resolveGeminiTextConfig,
  ensureOpenAiEnvLoaded,
  buildStoreSnapshot,
} = require('./storeAiAnalysis.cjs');

const LOCK_NAME = 'telegram_daily_poster';
const EVENT_DAILY_POSTER = 'daily_poster';
const DEFAULT_POSTER_TIME = '10:00';
const CAPTION_MAX = 1020;
const CAPTION_MIN = 40;
const DEFAULT_GEMINI_IMAGE_MODEL = 'gemini-2.5-flash-image';

const RUBRICS = Object.freeze([
  {
    id: 'hit_of_day',
    title: 'Kunning yulduzi',
    emoji: '🔥',
    vibe: 'Jurnal muqovasi: ishonchli, qisqa, ishtiyoqli. Mahsulotni “bugungi tanlov” qilib ko‘rsat.',
    prefer: 'fast',
  },
  {
    id: 'new_stock',
    title: 'Vitrina yangiligi',
    emoji: '✨',
    vibe: 'Yangi kelgan hissi, toza vitrina, yumshoq hayajon. Ombor yoki kod gapirma.',
    prefer: 'stock_image',
  },
  {
    id: 'lifestyle',
    title: 'Uyingiz uslubi',
    emoji: '🏡',
    vibe: 'Hayot tarzi: oila, qulaylik, chiroy. Mahsulotni kundalik sahna ichida tasvirla.',
    prefer: 'category',
  },
  {
    id: 'gift_idea',
    title: 'Sovg‘a g‘oyasi',
    emoji: '🎁',
    vibe: 'Marhamat va e’tibor: kimgadir tanlash oson bo‘lsin. Narxni aniq, ammo yumshoq yoz.',
    prefer: 'mid_price',
  },
  {
    id: 'weekend_vibe',
    title: 'Dam olish ta’mi',
    emoji: '🌞',
    vibe: 'Hafta oxiri, yengil kayfiyat, ishtaha va dam. Ichki hisobot ohangi yo‘q.',
    prefer: 'fast',
  },
  {
    id: 'family_pick',
    title: 'Oila tanlovi',
    emoji: '💚',
    vibe: 'Ishonch, oila byudjeti. Sifat va qulay narx muvozanati.',
    prefer: 'mid_price',
  },
  {
    id: 'kitchen_love',
    title: 'Oshxona sevimlisi',
    emoji: '🍽',
    vibe: 'Taom, mehmon, dasturxon. Mahsulotni lazzat va qulaylik bilan bog‘la.',
    prefer: 'category',
  },
  {
    id: 'morning_pick',
    title: 'Ertalabki tanlov',
    emoji: '☕️',
    vibe: 'Erta kun, yangi boshlanish, energiya. Qisqa, iliq, professional.',
    prefer: 'fast',
  },
  {
    id: 'limited_stock',
    title: 'Oxirgi donalar',
    emoji: '⏳',
    vibe: 'Kam qolgan, lekin panic-sotuv emas. Nafis shoshilinchlik. Yolg‘on chegirma yo‘q.',
    prefer: 'low_stock',
  },
  {
    id: 'premium_feel',
    title: 'Sifat hissi',
    emoji: '✨',
    vibe: 'Premium, toza, ishonchli brend ohangi. Ortiqcha sleng yo‘q.',
    prefer: 'stock_image',
  },
  {
    id: 'seasonal',
    title: 'Mavsum nafasi',
    emoji: '🌿',
    vibe: 'Hozirgi fasl, ob-havo, kun tartibi. Mahsulotni mavsumga moslab yoz.',
    prefer: 'category',
  },
  {
    id: 'value_pick',
    title: 'Aql bilan xarid',
    emoji: '💫',
    vibe: 'Aqlli tanlov: narx aniq, qiymati tushunarli, reklama shovqinisiz.',
    prefer: 'mid_price',
  },
]);

const FORBIDDEN_RE =
  /\b(viagra|casino|porn|xxx|onlyfans|crypto\s*pump|guaranteed\s*profit)\b|https?:\/\/t\.me\/\+|bit\.ly\//i;
const INTERNAL_CAPTION_RE =
  /\b(sku|артикул|qarz|nasiya|hisobot|ombor|foyda|zarar|smena|kassir|dead\s*stock|debit)\b/i;
const GARBAGE_NAME_RE =
  /^(test|asdf|qwe+|xxx+|noma.?lum|unknown|product|item|товар|товар\d+|sku|artikul|артикул)[\s\-_]*\d*$/i;

function readSetting(db, key, fallback = null) {
  try {
    const settings = new SettingsService(db);
    const val = settings.get(key);
    return val == null ? fallback : val;
  } catch {
    return fallback;
  }
}

function writeSetting(db, key, value, type = 'string') {
  try {
    const settings = new SettingsService(db);
    settings.set(key, value, type);
  } catch {
    // best-effort
  }
}

function hasTable(db, name) {
  try {
    return !!db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(name);
  } catch {
    return false;
  }
}

function hasColumn(db, table, column) {
  try {
    const rows = db.prepare(`PRAGMA table_info(${table})`).all();
    return rows.some((r) => String(r.name) === column);
  } catch {
    return false;
  }
}

function stripEnvQuotes(raw) {
  const t = String(raw || '').trim();
  if (
    (t.startsWith('"') && t.endsWith('"') && t.length >= 2) ||
    (t.startsWith("'") && t.endsWith("'") && t.length >= 2)
  ) {
    return t.slice(1, -1).trim();
  }
  return t;
}

function ensureEnvLoaded(options = {}) {
  if (options.skipEnvLoad) return;
  try {
    require('../../electron/config/loadRootEnv.cjs').loadRootEnv();
  } catch {
    // ignore
  }
}

function localTimeParts(db) {
  try {
    const row = db
      .prepare(
        `SELECT date('now', 'localtime') AS d,
                cast(strftime('%H', 'now', 'localtime') AS INTEGER) AS h,
                cast(strftime('%M', 'now', 'localtime') AS INTEGER) AS m,
                cast(strftime('%j', 'now', 'localtime') AS INTEGER) AS doy,
                cast(strftime('%w', 'now', 'localtime') AS INTEGER) AS dow`,
      )
      .get();
    return {
      date: row?.d || new Date().toISOString().slice(0, 10),
      hour: Number(row?.h) || 0,
      minute: Number(row?.m) || 0,
      dayOfYear: Number(row?.doy) || 1,
      weekday: Number(row?.dow) || 0,
    };
  } catch {
    const now = new Date();
    const start = new Date(now.getFullYear(), 0, 0);
    const doy = Math.floor((now - start) / 86400000);
    return {
      date: now.toISOString().slice(0, 10),
      hour: now.getHours(),
      minute: now.getMinutes(),
      dayOfYear: doy || 1,
      weekday: now.getDay(),
    };
  }
}

function formatSumma(amount) {
  return Math.round(Number(amount) || 0).toLocaleString('uz-UZ');
}

function isPublishableProductName(name) {
  const n = String(name || '').trim().replace(/\s+/g, ' ');
  if (n.length < 4) return false;
  if (n.length > 80) return false;
  if (GARBAGE_NAME_RE.test(n)) return false;
  if (/^[\d\s\-_.\/#]+$/.test(n)) return false;
  if (/^\d{8,}$/.test(n.replace(/\s/g, ''))) return false;
  if (/\b(sku|артикул|barcode|штрих)\b/i.test(n)) return false;
  const letters = (n.match(/[A-Za-zА-Яа-яЁёЎўҚқҒғҲҳ\u0400-\u04FF]/g) || []).length;
  if (letters < 3) return false;
  const digits = (n.match(/\d/g) || []).length;
  if (digits > letters * 2 && digits >= 6) return false;
  return true;
}

function sameTelegramChat(a, b) {
  const sa = stripEnvQuotes(a);
  const sb = stripEnvQuotes(b);
  if (!sa || !sb) return false;
  if (sa === sb) return true;
  const na = Number.parseInt(sa, 10);
  const nb = Number.parseInt(sb, 10);
  return Number.isFinite(na) && Number.isFinite(nb) && na === nb;
}

function resolveMarketingCredentials(options = {}) {
  ensureEnvLoaded(options);
  const botToken = stripEnvQuotes(
    options.botToken ||
      process.env.TELEGRAM_MARKETING_BOT_TOKEN ||
      process.env.TELEGRAM_BOT_TOKEN ||
      '',
  );
  const channelId = stripEnvQuotes(
    options.channelId || process.env.TELEGRAM_MARKETING_CHANNEL_ID || '',
  );
  const reportsChat = stripEnvQuotes(process.env.TELEGRAM_REPORTS_CHAT_ID || '');
  const blocked = Boolean(channelId && reportsChat && sameTelegramChat(channelId, reportsChat));
  return {
    botToken,
    channelId,
    blockedReportsChannel: blocked,
    hasCredentials: Boolean(botToken && channelId && !blocked),
  };
}

function resolveGeminiConfig(options = {}) {
  ensureEnvLoaded(options);
  const apiKey = stripEnvQuotes(options.geminiApiKey || process.env.GEMINI_API_KEY || '');
  const model =
    stripEnvQuotes(options.geminiImageModel || process.env.GEMINI_IMAGE_MODEL || '') ||
    DEFAULT_GEMINI_IMAGE_MODEL;
  return { apiKey, model, hasApiKey: apiKey.length > 0 };
}

function getDailyPosterSettings(db) {
  const base = getReportTelegramSettings(db);
  const creds = resolveMarketingCredentials({ skipEnvLoad: true });
  const raw = readSetting(db, 'reports.telegram.daily_poster', null);
  let enabled;
  if (raw == null || raw === '') {
    enabled = creds.hasCredentials;
  } else {
    enabled = toBool(raw, creds.hasCredentials);
  }
  const envTime = stripEnvQuotes(process.env.DAILY_POSTER_TIME || '');
  return {
    storeName: base.storeName || "Do'kon",
    enabled: Boolean(enabled),
    scheduleTime: normalizeScheduleTime(
      readSetting(db, 'reports.telegram.daily_poster_time', envTime || DEFAULT_POSTER_TIME) ||
        envTime ||
        DEFAULT_POSTER_TIME,
    ),
    lastRunDate: String(readSetting(db, 'reports.telegram.daily_poster_last_run_date', '') || '').slice(
      0,
      10,
    ),
  };
}

function pickRubric(dayOfYear, options = {}) {
  if (options.rubricId) {
    const found = RUBRICS.find((r) => r.id === options.rubricId);
    if (found) return found;
  }
  const idx = Math.abs(Number(dayOfYear) || 1) % RUBRICS.length;
  return RUBRICS[idx];
}

function shouldRunDailyPoster(db, settings, options = {}) {
  if (options.force) return { ok: true, reason: 'forced', today: localTimeParts(db).date };
  const parts = localTimeParts(db);
  if (settings.lastRunDate && settings.lastRunDate === parts.date) {
    return { ok: false, reason: 'already_ran_today', today: parts.date };
  }
  const [sh, sm] = String(settings.scheduleTime || DEFAULT_POSTER_TIME)
    .split(':')
    .map((x) => Number.parseInt(x, 10));
  const scheduleMinutes = (Number.isFinite(sh) ? sh : 10) * 60 + (Number.isFinite(sm) ? sm : 0);
  const nowMinutes = parts.hour * 60 + parts.minute;
  if (nowMinutes < scheduleMinutes) {
    return { ok: false, reason: 'before_schedule', today: parts.date };
  }
  return { ok: true, reason: 'due', today: parts.date };
}

function claimNotifyDedup(db, eventKey, refId) {
  if (!hasTable(db, 'report_notify_log')) return true;
  const key = String(eventKey || '').trim();
  const ref = String(refId || '').trim();
  if (!key || !ref) return true;
  try {
    const r = db
      .prepare(
        `INSERT OR IGNORE INTO report_notify_log (event_key, ref_id, sent_at)
         VALUES (?, ?, datetime('now'))`,
      )
      .run(key, ref);
    return Number(r?.changes || 0) > 0;
  } catch {
    return true;
  }
}

function listCandidateProducts(db, limit = 40) {
  if (!hasTable(db, 'products')) return [];
  const hasActive = hasColumn(db, 'products', 'is_active');
  const hasCat = hasTable(db, 'categories');
  const catJoin = hasCat ? 'LEFT JOIN categories c ON c.id = p.category_id' : '';
  const catSelect = hasCat ? ', c.name AS category_name' : ', NULL AS category_name';
  const activeClause = hasActive ? 'AND COALESCE(p.is_active, 1) = 1' : '';
  try {
    const rows = db
      .prepare(
        `SELECT p.id, p.name, p.sale_price, p.current_stock, p.image_url, p.category_id
                ${catSelect}
         FROM products p
         ${catJoin}
         WHERE COALESCE(p.current_stock, 0) > 0
           ${activeClause}
           AND COALESCE(p.sale_price, 0) > 0
         ORDER BY
           CASE WHEN p.image_url IS NOT NULL AND TRIM(p.image_url) != '' THEN 0 ELSE 1 END,
           p.current_stock DESC
         LIMIT ?`,
      )
      .all(Math.max(limit * 3, 80));
    return rows.filter((p) => isPublishableProductName(p.name)).slice(0, limit);
  } catch {
    return [];
  }
}

function scoreProduct(p, rubric, snapshot) {
  let score = 0;
  const stock = Number(p.current_stock) || 0;
  const price = Number(p.sale_price) || 0;
  const hasImg = Boolean(String(p.image_url || '').trim());
  if (hasImg) score += 5;
  if (stock > 0) score += 2;

  const fastIds = new Set(
    (snapshot?.fast_movers_top || []).map((x) => String(x.id || x.product_id || '')),
  );
  const id = String(p.id || '');

  switch (rubric.prefer) {
    case 'fast':
      if (fastIds.has(id)) score += 12;
      score += Math.min(8, stock / 10);
      break;
    case 'low_stock':
      if (stock > 0 && stock <= 5) score += 14;
      else if (stock <= 15) score += 6;
      break;
    case 'mid_price':
      if (price >= 20_000 && price <= 500_000) score += 8;
      break;
    case 'category':
      if (p.category_name) score += 6;
      break;
    case 'stock_image':
    default:
      if (hasImg) score += 8;
      score += Math.min(6, stock / 5);
      break;
  }
  score += (id.charCodeAt(0) || 0) % 3;
  return score;
}

function selectProductForRubric(db, rubric, options = {}) {
  const snapshot =
    options.snapshot ||
    buildStoreSnapshot(db, {
      date: options.date,
      storeName: options.storeName,
      topN: 10,
    });
  const candidates = listCandidateProducts(db, options.candidateLimit || 50);
  if (!candidates.length) return { product: null, snapshot };

  const skipIds = new Set((options.skipProductIds || []).map((id) => String(id)));
  const ranked = candidates
    .map((p) => ({ p, score: scoreProduct(p, rubric, snapshot) }))
    .filter((x) => !skipIds.has(String(x.p.id)))
    .sort((a, b) => b.score - a.score);

  if (!ranked.length) return { product: null, snapshot, rankedCount: 0 };

  const top = ranked.slice(0, Math.min(5, ranked.length));
  const pickIdx = Math.abs(Number(options.dayOfYear) || 1) % top.length;
  return { product: top[pickIdx].p, snapshot, rankedCount: ranked.length };
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function buildTemplateCaption({ storeName, product, rubric }) {
  const name = String(product?.name || '').trim();
  const price = formatSumma(product?.sale_price);
  const cat = String(product?.category_name || '').trim();
  const stock = Number(product?.current_stock) || 0;
  const brand = String(storeName || "Do'kon").trim();
  const mood =
    rubric.id === 'limited_stock' && stock > 0 && stock <= 8
      ? 'Bugun vitrinada — kechikmasdan tanlang.'
      : rubric.id === 'gift_idea'
        ? 'Yaqiningizga e’tibor — tanlov allaqachon tayyor.'
        : rubric.id === 'weekend_vibe'
          ? 'Dam olish kayfiyatini stolga olib keling.'
          : 'Sifatli tanlov — kunni chiroyliroq qiladi.';
  const lines = [
    `${rubric.emoji} <b>${escapeHtml(rubric.title)}</b>`,
    '',
    `<b>${escapeHtml(name)}</b>`,
    cat ? `${escapeHtml(cat)} — vitrinamizdagi tanlov.` : null,
    '',
    escapeHtml(mood),
    `💰 <b>${escapeHtml(price)} so'm</b>`,
    '',
    `📍 ${escapeHtml(brand)}`,
    '#Dunyozamin #News #tavsiya',
  ].filter((x) => x != null);
  return lines.join('\n').slice(0, CAPTION_MAX);
}

function captionSystemPrompt() {
  return (
    "Sen professional O‘zbekiston chakana brendi uchun Telegram News kanali copywriterisan. " +
    "Maqsad: mijozlarga chiroyli, ijodiy, ishonchli post — ICHKI hisobot EMAS. " +
    "Taqiqlangan: qarz, nasiya, SKU, ombor qoldig‘i, foyda, kassir, smena, dead stock, chegirma foizini uydirish. " +
    "Faqat o‘zbek tili. HTML: faqat <b>. Emoji 1–4 ta. Narxni aniq yoz (so‘m). " +
    "3–7 qator: sarlavha, mahsulot nomi, 1–2 nafis jumla, narx, yumshoq chaqiriq. " +
    `Uzunlik ${CAPTION_MIN}-${CAPTION_MAX} belgi. Faqat caption matnini qaytar.`
  );
}

function captionUserPayload({ storeName, product, rubric }) {
  return {
    store_name: storeName,
    audience: 'mijozlar (public News)',
    rubric: {
      id: rubric.id,
      title: rubric.title,
      emoji: rubric.emoji,
      vibe: rubric.vibe || '',
    },
    product: {
      name: product.name,
      price_formatted: `${formatSumma(product.sale_price)} so'm`,
      category: product.category_name || null,
    },
  };
}

function qualityCheckCaption(caption, product) {
  const text = String(caption || '').trim();
  if (!text) return { ok: false, reason: 'empty_caption' };
  if (text.length < CAPTION_MIN) return { ok: false, reason: 'too_short' };
  if (text.length > CAPTION_MAX) return { ok: false, reason: 'too_long' };
  if (!/\d/.test(text)) return { ok: false, reason: 'no_price_digits' };
  if (FORBIDDEN_RE.test(text) || INTERNAL_CAPTION_RE.test(text)) {
    return { ok: false, reason: 'forbidden_content' };
  }
  const name = String(product?.name || '').trim();
  if (!isPublishableProductName(name)) return { ok: false, reason: 'junk_product_name' };
  if (name.length >= 4) {
    const needle = name.slice(0, Math.min(12, name.length)).toLowerCase();
    if (!text.toLowerCase().includes(needle.slice(0, 6))) {
      return { ok: false, reason: 'product_name_missing' };
    }
  }
  return { ok: true };
}

function fetchImpl(options) {
  return options.fetchFn || options.fetchFn || globalThis.fetch;
}

async function generateCaptionWithOpenAi({ storeName, product, rubric }, options = {}) {
  ensureOpenAiEnvLoaded(options);
  const cfg = resolveOpenAiConfig(options);
  if (!cfg.apiKey) return { ok: false, reason: 'no_api_key' };
  const fetchFn = fetchImpl(options);
  if (typeof fetchFn !== 'function') return { ok: false, reason: 'no_fetch' };

  try {
    const res = await fetchFn(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: cfg.model,
        temperature: 0.75,
        max_tokens: 350,
        messages: [
          { role: 'system', content: captionSystemPrompt() },
          { role: 'user', content: JSON.stringify(captionUserPayload({ storeName, product, rubric })) },
        ],
      }),
      signal: AbortSignal.timeout(options.timeoutMs || 40_000),
    });
    if (!res.ok) return { ok: false, reason: `openai_http_${res.status}` };
    const data = await res.json();
    const text = String(data?.choices?.[0]?.message?.content || '').trim();
    if (!text) return { ok: false, reason: 'empty_response' };
    return { ok: true, text: text.slice(0, CAPTION_MAX), provider: 'openai' };
  } catch (e) {
    return { ok: false, reason: 'openai_error', detail: String(e?.message || e).slice(0, 80) };
  }
}

async function generateCaptionWithGemini({ storeName, product, rubric }, options = {}) {
  const cfg = resolveGeminiTextConfig(options);
  if (!cfg.apiKey) return { ok: false, reason: 'no_gemini_key' };
  const fetchFn = fetchImpl(options);
  if (typeof fetchFn !== 'function') return { ok: false, reason: 'no_fetch' };

  const prompt = [captionSystemPrompt(), '', JSON.stringify(captionUserPayload({ storeName, product, rubric }))].join(
    '\n',
  );
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg.model)}:generateContent`;
  try {
    const res = await fetchFn(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': cfg.apiKey,
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.75, maxOutputTokens: 400 },
      }),
      signal: AbortSignal.timeout(options.timeoutMs || 40_000),
    });
    if (!res.ok) return { ok: false, reason: `gemini_http_${res.status}` };
    const data = await res.json();
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const text = parts
      .map((p) => String(p?.text || ''))
      .join('\n')
      .trim();
    if (!text) return { ok: false, reason: 'empty_response' };
    return { ok: true, text: text.slice(0, CAPTION_MAX), provider: 'gemini' };
  } catch (e) {
    return { ok: false, reason: 'gemini_error', detail: String(e?.message || e).slice(0, 80) };
  }
}

async function generateCaption(ctx, options = {}) {
  const geminiText = await generateCaptionWithGemini(ctx, options);
  if (geminiText.ok) return geminiText;
  const openai = resolveOpenAiConfig(options);
  if (openai.hasApiKey) {
    const out = await generateCaptionWithOpenAi(ctx, options);
    if (out.ok) return out;
  }
  return { ok: false, reason: geminiText.reason || 'no_caption_llm' };
}

async function generatePosterImageGemini({ storeName, product, rubric }, options = {}) {
  const cfg = resolveGeminiConfig(options);
  if (!cfg.apiKey) return { ok: false, reason: 'no_gemini_key' };
  const fetchFn = fetchImpl(options);
  if (typeof fetchFn !== 'function') return { ok: false, reason: 'no_fetch' };

  const prompt =
    `Professional commercial product photograph for a premium grocery/retail Telegram News channel. ` +
    `No text, no watermarks, no logos, no price tags, no collages. ` +
    `Subject: ${product.name}. Category mood: ${product.category_name || 'everyday retail'}. ` +
    `Story: ${rubric.title} — ${rubric.vibe || 'clean lifestyle showcase'}. ` +
    `Store aesthetic: ${storeName}. ` +
    `Photoreal, soft studio light, shallow depth of field, square 1:1, magazine quality.`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg.model)}:generateContent`;
  try {
    const res = await fetchFn(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': cfg.apiKey,
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
      }),
      signal: AbortSignal.timeout(options.timeoutMs || 90_000),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      return { ok: false, reason: `gemini_http_${res.status}`, detail: t.slice(0, 120) };
    }
    const data = await res.json();
    const parts = data?.candidates?.[0]?.content?.parts || [];
    for (const part of parts) {
      const inline = part.inlineData || part.inline_data;
      if (inline?.data) {
        const buf = Buffer.from(String(inline.data), 'base64');
        if (buf.length > 500) {
          const mime = String(inline.mimeType || inline.mime_type || 'image/jpeg');
          const ext = mime.includes('png') ? 'png' : 'jpg';
          return { ok: true, buffer: buf, filename: `poster.${ext}`, mime };
        }
      }
    }
    return { ok: false, reason: 'gemini_no_image' };
  } catch (e) {
    return { ok: false, reason: 'gemini_error', detail: String(e?.message || e).slice(0, 80) };
  }
}

function resolveProductPhoto(product) {
  const raw = String(product?.image_url || '').trim();
  if (!raw) return { ok: false, reason: 'no_image_url' };
  if (/^https?:\/\//i.test(raw)) return { ok: true, photoUrl: raw };

  const fileName = extractProductImageFileName(raw);
  if (fileName) {
    const filePath = path.join(getProductImageDir(), fileName);
    try {
      if (fs.existsSync(filePath)) {
        const buffer = fs.readFileSync(filePath);
        if (buffer.length > 100) return { ok: true, photoBuffer: buffer, filename: fileName };
      }
    } catch {
      // fall through
    }
  }

  const base =
    stripEnvQuotes(process.env.VITE_APP_PUBLIC_URL || '') ||
    stripEnvQuotes(process.env.PUBLIC_API_PUBLIC_URL || '') ||
    stripEnvQuotes(process.env.TELEGRAM_WEB_APP_URL || '');
  if (base) {
    const host = base.replace(/^https?:\/\//i, '').replace(/\/$/, '');
    const fakeReq = {
      headers: {
        host,
        'x-forwarded-proto': base.startsWith('https') ? 'https' : 'http',
      },
    };
    const resolved = resolveCatalogImageUrl(raw, fakeReq);
    if (resolved && /^https?:\/\//i.test(resolved)) return { ok: true, photoUrl: resolved };
  }
  return { ok: false, reason: 'image_unresolved' };
}

async function composePoster(db, options = {}) {
  const settings = getDailyPosterSettings(db);
  const parts = localTimeParts(db);
  const today = String(options.date || parts.date).slice(0, 10);
  const rubric = pickRubric(parts.dayOfYear, options);
  const { product, snapshot } = selectProductForRubric(db, rubric, {
    date: today,
    storeName: settings.storeName,
    dayOfYear: parts.dayOfYear,
    snapshot: options.snapshot,
  });

  if (!product || !isPublishableProductName(product.name)) {
    return { ok: false, reason: 'no_products', rubric, today };
  }

  let caption = null;
  let captionSource = 'template';
  const llm = await generateCaption(
    { storeName: settings.storeName, product, rubric, snapshot },
    options,
  );
  if (llm.ok) {
    caption = llm.text;
    captionSource = llm.provider || 'llm';
  } else {
    caption = buildTemplateCaption({ storeName: settings.storeName, product, rubric });
  }

  let qc = qualityCheckCaption(caption, product);
  if (!qc.ok) {
    if (captionSource !== 'template') {
      const again = await generateCaption(
        { storeName: settings.storeName, product, rubric, snapshot },
        options,
      );
      if (again.ok) {
        caption = again.text;
        captionSource = again.provider || 'llm';
        qc = qualityCheckCaption(caption, product);
      }
    }
    if (!qc.ok) {
      caption = buildTemplateCaption({ storeName: settings.storeName, product, rubric });
      captionSource = 'template';
      qc = qualityCheckCaption(caption, product);
    }
  }

  if (!qc.ok) {
    return {
      ok: false,
      reason: 'quality_failed',
      qualityReason: qc.reason,
      rubric,
      product,
      today,
    };
  }

  const skipImage = options.skipImage === true;
  let image = { ok: false, reason: 'skipped' };
  if (!skipImage) {
    const gemini = await generatePosterImageGemini(
      { storeName: settings.storeName, product, rubric },
      options,
    );
    if (gemini.ok && gemini.buffer) {
      image = {
        ok: true,
        photoBuffer: gemini.buffer,
        filename: gemini.filename || 'poster.jpg',
        source: 'gemini',
      };
    } else {
      const fallback = resolveProductPhoto(product);
      image = { ...fallback, fallbackFrom: gemini.reason, source: fallback.ok ? 'product' : 'none' };
    }
  }

  return {
    ok: true,
    today,
    rubric,
    product: {
      id: product.id,
      name: product.name,
      sale_price: product.sale_price,
      current_stock: product.current_stock,
      category_name: product.category_name || null,
      image_url: product.image_url || null,
    },
    caption,
    captionSource,
    image,
    storeName: settings.storeName,
  };
}

async function postComposedPoster(composed, options = {}) {
  const creds = resolveMarketingCredentials(options);
  if (!creds.botToken) return { ok: false, sent: 0, failed: 0, reason: 'no_bot_token' };
  if (!creds.channelId) return { ok: false, sent: 0, failed: 0, reason: 'no_channel_id' };
  if (creds.blockedReportsChannel) {
    return { ok: false, sent: 0, failed: 0, reason: 'blocked_reports_channel' };
  }

  const caption = String(composed.caption || '').slice(0, CAPTION_MAX);
  const img = composed.image || {};

  if (img.ok && (img.photoBuffer || img.photoUrl)) {
    const out = await sendTelegramPhoto({
      botToken: creds.botToken,
      telegramId: creds.channelId,
      photoBuffer: img.photoBuffer || null,
      photoUrl: img.photoUrl || null,
      filename: img.filename || 'poster.jpg',
      caption,
      parseMode: 'HTML',
    });
    if (out.ok) return { ok: true, sent: 1, failed: 0, method: 'sendPhoto' };
  }

  const outText = await sendTelegramText({
    botToken: creds.botToken,
    telegramId: creds.channelId,
    text: caption,
    parseMode: 'HTML',
  });
  if (outText.ok) return { ok: true, sent: 1, failed: 0, method: 'sendMessage' };
  return { ok: false, sent: 0, failed: 1, reason: outText.reason || 'send_failed' };
}

async function runDailyPosterTick(db, options = {}) {
  ensureEnvLoaded(options);
  const settings = getDailyPosterSettings(db);
  const creds = resolveMarketingCredentials(options);

  if (creds.blockedReportsChannel) {
    return { ok: false, skipped: true, reason: 'blocked_reports_channel' };
  }
  if (!settings.enabled && !options.force) {
    return { ok: false, skipped: true, reason: 'disabled' };
  }
  if (!creds.hasCredentials && !options.force) {
    return { ok: false, skipped: true, reason: 'no_credentials' };
  }

  const gate = shouldRunDailyPoster(db, settings, options);
  if (!gate.ok) {
    return { ok: false, skipped: true, reason: gate.reason, today: gate.today };
  }

  if (!options.skipLock) {
    const owner = tryAcquireSchedulerLock(db, {
      name: LOCK_NAME,
      ttlMs: options.lockTtlMs || 180_000,
    });
    if (!owner) {
      return { ok: false, skipped: true, reason: 'lock_held', today: gate.today };
    }
  }

  let composed = await composePoster(db, { ...options, date: gate.today });
  if (!composed.ok && composed.reason === 'quality_failed') {
    const nextIdx =
      (RUBRICS.findIndex((r) => r.id === composed.rubric?.id) + 1 + RUBRICS.length) % RUBRICS.length;
    composed = await composePoster(db, {
      ...options,
      date: gate.today,
      rubricId: RUBRICS[nextIdx].id,
    });
  }

  if (!composed.ok) {
    return {
      ok: false,
      skipped: false,
      reason: composed.reason || 'compose_failed',
      qualityReason: composed.qualityReason || null,
      today: gate.today,
      rubric: composed.rubric?.id || null,
    };
  }

  const out = await postComposedPoster(composed, options);
  if (out.ok || out.sent > 0) {
    writeSetting(db, 'reports.telegram.daily_poster_last_run_date', gate.today, 'string');
    claimNotifyDedup(db, EVENT_DAILY_POSTER, gate.today);
  }

  return {
    ...out,
    today: gate.today,
    rubric: composed.rubric?.id,
    productId: composed.product?.id,
    captionSource: composed.captionSource,
    imageSource: composed.image?.source || 'none',
    kind: 'daily_poster',
  };
}

async function sendDailyPosterNow(db, options = {}) {
  return runDailyPosterTick(db, { ...options, force: true, skipLock: options.skipLock !== false });
}

module.exports = {
  LOCK_NAME,
  EVENT_DAILY_POSTER,
  DEFAULT_POSTER_TIME,
  DEFAULT_GEMINI_IMAGE_MODEL,
  RUBRICS,
  formatSumma,
  isPublishableProductName,
  resolveMarketingCredentials,
  resolveGeminiConfig,
  getDailyPosterSettings,
  pickRubric,
  shouldRunDailyPoster,
  listCandidateProducts,
  selectProductForRubric,
  buildTemplateCaption,
  qualityCheckCaption,
  generateCaptionWithOpenAi,
  generateCaptionWithGemini,
  generateCaption,
  generatePosterImageGemini,
  resolveProductPhoto,
  composePoster,
  postComposedPoster,
  runDailyPosterTick,
  sendDailyPosterNow,
};

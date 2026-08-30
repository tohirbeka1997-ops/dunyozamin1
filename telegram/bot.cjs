/**
 * Telegram bot: /start → Mini App tugmasi.
 * Run: npm run telegram:bot
 * Serverda doimiy ishlatish: telegram/SERVER-UZ.md va telegram/telegram-bot.service.example
 */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const root = path.resolve(__dirname, '..');
const envPath = path.join(root, '.env');
const localPath = path.join(root, '.env.local');

function loadBotEnv() {
  try {
    const dotenv = require('dotenv');
    if (fs.existsSync(envPath)) {
      const r = dotenv.config({ path: envPath, override: true });
      if (r.error) console.error('[telegram:bot] .env xato:', r.error.message);
    }
    if (fs.existsSync(localPath)) {
      dotenv.config({ path: localPath, override: true });
    }
  } catch (e) {
    console.error('[telegram:bot] dotenv:', e.message);
  }
}

loadBotEnv();

// .env da "= https://" kabi bo'sh joy qolsa ham ishlasin
for (const k of [
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_WEB_APP_URL',
  'VITE_APP_PUBLIC_URL',
  'VITE_POS_RPC_URL',
]) {
  if (process.env[k]) process.env[k] = String(process.env[k]).trim();
}

const { Telegraf, Markup } = require('telegraf');
const QRCode = require('qrcode');

const token = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
const webAppUrl = String(
  process.env.TELEGRAM_WEB_APP_URL || process.env.VITE_APP_PUBLIC_URL || '',
).trim();
const publicApiUrl = String(process.env.TELEGRAM_PUBLIC_API_URL || 'http://127.0.0.1:3334').trim();
const botInternalSecret = String(process.env.TELEGRAM_BOT_INTERNAL_SECRET || '').trim();
const botMode = String(process.env.TELEGRAM_BOT_MODE || 'polling').trim().toLowerCase();
const webhookBase = String(process.env.TELEGRAM_WEBHOOK_BASE_URL || '').trim();
const webhookPath = String(process.env.TELEGRAM_WEBHOOK_PATH || '/telegram/webhook').trim();
const webhookSecret = String(process.env.TELEGRAM_WEBHOOK_SECRET || '').trim();
const webhookPort = Math.max(1, Number.parseInt(String(process.env.TELEGRAM_WEBHOOK_PORT || '8081'), 10) || 8081);
const BOT_RUNTIME_VERSION = String(process.env.TELEGRAM_BOT_RUNTIME_VERSION || '2026-04-23-r2').trim();
const contactText = String(
  process.env.TELEGRAM_CONTACT_TEXT ||
    "Savollar uchun do'kon administratoriga yozing.",
).trim();
const courierUsernames = new Set(
  String(process.env.TELEGRAM_COURIER_USERNAMES || 'TOHIR3')
    .split(',')
    .map((s) => s.trim().replace(/^@/, '').toLowerCase())
    .filter(Boolean),
);
const courierIds = new Set(
  String(process.env.TELEGRAM_COURIER_IDS || '')
    .split(',')
    .map((s) => Number.parseInt(String(s).trim(), 10))
    .filter((n) => Number.isFinite(n)),
);

if (!token || !webAppUrl || !botInternalSecret) {
  console.error(
    '[telegram:bot] .env da TELEGRAM_BOT_TOKEN, TELEGRAM_WEB_APP_URL (yoki VITE_APP_PUBLIC_URL) va TELEGRAM_BOT_INTERNAL_SECRET kerak.',
  );
  console.error('  Kutilyotgan .env:', envPath);
  console.error('  Fayl bor:', fs.existsSync(envPath));
  console.error('  token uzunligi:', token.length, '| webAppUrl uzunligi:', webAppUrl.length);
  process.exit(1);
}

if (!String(webAppUrl).startsWith('https://')) {
  console.error('[telegram:bot] Web App URL https:// bilan boshlanishi kerak');
  process.exit(1);
}

const bot = new Telegraf(token);
const API_TIMEOUT_MS = Math.max(1000, Number.parseInt(String(process.env.TELEGRAM_BOT_API_TIMEOUT_MS || '7000'), 10) || 7000);
const MIN_ACTION_GAP_MS = Math.max(300, Number.parseInt(String(process.env.TELEGRAM_BOT_MIN_ACTION_GAP_MS || '700'), 10) || 700);
const lastActionAt = new Map();
const pendingOrderAddressEdit = new Map();
const registrationState = new Map();
const searchState = new Map();
const adminState = new Map();

const MENU = {
  shop: "🛍 Do'kon",
  search: '🔎 Qidiruv',
  orders: '📦 Buyurtmalarim',
  card: '🎁 Kartam',
  contact: "📞 Bog'lanish",
  courier: '🚚 Kuryer panel',
  admin: '🛠 Admin panel',
  help: 'ℹ️ Yordam',
  hisobot: '📊 Hisobotlar',
};

const {
  REPORT_MENU,
  REPORT_CALLBACK_PREFIX,
  CREDIT_REMIND_CALLBACK_PREFIX,
  matchReportKindFromText,
  matchReportKindFromCallback,
  matchCreditRemindCustomerId,
  buildReportReplyKeyboardRows,
  buildReportInlineKeyboardRows,
  isBotButtonsEnabled,
  isAuthorizedReportAdmin,
  normalizeReportKind,
} = require('../public-api/lib/botStoreReports.cjs');

// ─────────────────────────────────────────────────────────────
// Brend: ranglar #0A3625 (to'q yashil) + #CCDA47 (sariq-yashil)
// ─────────────────────────────────────────────────────────────
const BRAND = {
  name: 'DunyoZamin',
  tagline: 'Onlayn doʻkoningiz',
  primary: '#0A3625',
  accent: '#CCDA47',
  qr: { dark: '#0A3625', light: '#FFFFFF' },
  divider:     '━━━━━━━━━━━━━━━━━━━━━',
  softDivider: '┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄',
  dotDivider:  '· · · · · · · · · · · · · · · · ·',
  bullet: '🌿',
  spark: '✨',
  leaf: '🍃',
  star: '⭐',
};

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function brandHeader(title, subtitle) {
  const head = `${BRAND.bullet} <b>${esc(title)}</b>`;
  const sub = subtitle ? `\n<i>${esc(subtitle)}</i>` : '';
  return `${head}${sub}\n${BRAND.divider}`;
}

function brandFooter() {
  return `${BRAND.softDivider}\n${BRAND.spark} <i>${esc(BRAND.name)}</i>`;
}

async function safeReplyHTML(ctx, text, extra) {
  try {
    await ctx.reply(text, { parse_mode: 'HTML', disable_web_page_preview: true, ...(extra || {}) });
  } catch (e) {
    console.error('[telegram:bot] reply(html) failed:', e?.message || String(e));
    try {
      await ctx.reply(String(text || '').replace(/<[^>]+>/g, ''), extra);
    } catch {}
  }
}

function fmtMoney(value) {
  const n = Number(value || 0);
  return `${n.toLocaleString('uz-UZ')} soʻm`;
}

function fmtDate(value) {
  if (!value) return '';
  return String(value).replace('T', ' ').slice(0, 16);
}

const STATUS_BADGE = {
  new: '🆕 Yangi',
  paid: '💳 Toʻlangan',
  processing: '🧺 Yigʻilmoqda',
  ready: '✅ Tayyor',
  out_for_delivery: '🚚 Yoʻlda',
  delivered: '📬 Yetkazildi',
  cancelled: '❌ Bekor qilingan',
  open: '📂 Ochiq',
};
function statusBadge(s) {
  const key = String(s || '').toLowerCase();
  return STATUS_BADGE[key] || `• ${s || '—'}`;
}

function adminIds() {
  return new Set(
    String(process.env.TELEGRAM_ADMIN_IDS || '')
      .split(',')
      .map((s) => Number.parseInt(String(s).trim(), 10))
      .filter((n) => Number.isFinite(n)),
  );
}

function isAdminUser(ctx) {
  const id = Number(ctx?.from?.id);
  return Number.isFinite(id) && adminIds().has(id);
}

function botButtonsOnForAdmin(ctx) {
  if (!isAdminUser(ctx)) return false;
  try {
    const db = require('../public-api/lib/db.cjs').getDb();
    return isBotButtonsEnabled(db);
  } catch {
    // If DB unavailable, still allow admins in TELEGRAM_ADMIN_IDS
    return isAuthorizedReportAdmin(ctx?.from?.id);
  }
}

function adminHisobotKeyboard() {
  // Always include 📣 Marketing tavsiya on the admin hisobot reply keyboard.
  const rows = [
    ...buildReportReplyKeyboardRows(null),
    [MENU.shop, MENU.admin],
    [MENU.help],
  ];
  return Markup.keyboard(rows).resize();
}

function adminHisobotInlineKeyboard() {
  // Always include 📣 Marketing tavsiya on the admin hisobot inline keyboard.
  return Markup.inlineKeyboard(buildReportInlineKeyboardRows(null));
}

function isCourierUser(ctx) {
  const from = ctx?.from || {};
  const username = String(from.username || '').trim().toLowerCase();
  const id = Number(from.id);
  return isAdminUser(ctx) || (username && courierUsernames.has(username)) || courierIds.has(id);
}

async function isCourierUserAsync(ctx) {
  if (isCourierUser(ctx)) return true;
  const tgId = ctx?.from?.id;
  if (tgId == null) return false;
  const username = String(ctx.from?.username || '').trim();
  try {
    await callBotApi(
      `/courier/me?actor_telegram_id=${tgId}&actor_username=${encodeURIComponent(username)}`,
    );
    return true;
  } catch {
    return false;
  }
}

function mainMenuKeyboard(ctx = null) {
  const rows = [
    [MENU.shop, MENU.search],
    [MENU.orders, MENU.card],
    [MENU.contact],
  ];
  // Sync path: env allowlist only. Prefer mainMenuKeyboardAsync when possible
  // so DB-registered couriers also get the courier button.
  if (isCourierUser(ctx)) rows.push([MENU.courier]);
  if (isAdminUser(ctx)) {
    rows.push([MENU.admin]);
    if (botButtonsOnForAdmin(ctx)) rows.push([MENU.hisobot]);
  }
  rows.push([MENU.help]);
  return Markup.keyboard(rows).resize();
}

async function mainMenuKeyboardAsync(ctx = null) {
  const rows = [
    [MENU.shop, MENU.search],
    [MENU.orders, MENU.card],
    [MENU.contact],
  ];
  if (ctx && (await isCourierUserAsync(ctx))) rows.push([MENU.courier]);
  if (isAdminUser(ctx)) {
    rows.push([MENU.admin]);
    if (botButtonsOnForAdmin(ctx)) rows.push([MENU.hisobot]);
  }
  rows.push([MENU.help]);
  return Markup.keyboard(rows).resize();
}

async function callBotApi(pathname, opts = {}) {
  const url = `${publicApiUrl.replace(/\/$/, '')}/v1/bot${pathname}`;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
    try {
      const r = await fetch(url, {
        ...opts,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'x-telegram-bot-secret': botInternalSecret,
          ...(opts.headers || {}),
        },
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        throw new Error(data?.error || `HTTP_${r.status}`);
      }
      clearTimeout(timer);
      return data;
    } catch (e) {
      clearTimeout(timer);
      if (attempt >= 2) {
        throw e;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error('bot_api_failed');
}

async function callPublicApi(pathname, opts = {}) {
  const url = `${publicApiUrl.replace(/\/$/, '')}${pathname}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      ...opts,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(opts.headers || {}),
      },
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data?.error || `HTTP_${r.status}`);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

function buildCatalogUrlWithQuery(queryText) {
  try {
    const u = new URL(webAppUrl);
    const basePath = (u.pathname || '/').replace(/\/+$/, '');
    u.pathname = `${basePath}/catalog`.replace(/\/{2,}/g, '/');
    u.searchParams.set('q', queryText);
    return u.toString();
  } catch {
    return webAppUrl;
  }
}

function formatSearchResultsMessage(queryText, rows) {
  if (!rows.length) {
    return (
      `🔎 <b>Qidiruv:</b> <i>"${esc(queryText)}"</i>\n` +
      `${BRAND.divider}\n` +
      `❌ <b>Mahsulot topilmadi.</b>\n` +
      `<i>Boshqa kalit soʻz bilan urinib koʻring.</i>`
    );
  }
  const lines = rows.map((r, i) => {
    const price = fmtMoney(r.price_uzs);
    const stock = r.is_available ? '🟢 <b>mavjud</b>' : '🔴 <b>yoʻq</b>';
    const sku = r.sku ? `   🏷 SKU: <code>${esc(r.sku)}</code>\n` : '';
    return `<b>${i + 1}.</b> ${esc(r.name)}\n` +
      `   💰 <b>${esc(price)}</b>  ·  ${stock}\n` +
      sku;
  });
  return (
    `🔎 <b>Qidiruv:</b> <i>"${esc(queryText)}"</i>\n` +
    `${BRAND.divider}\n` +
    `${BRAND.spark} Topildi: <b>${rows.length}</b> ta\n` +
    `${BRAND.softDivider}\n` +
    lines.join(`${BRAND.softDivider}\n`).trimEnd()
  );
}

async function runCatalogSearch(ctx, queryText) {
  const q = String(queryText || '').trim();
  if (q.length < 2) {
    await safeReply(ctx, "Qidiruv soʻzi kamida 2 ta belgi boʻlsin.");
    return;
  }
  const payload = await callPublicApi(`/v1/products?limit=8&sort=name&q=${encodeURIComponent(q)}`);
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  await safeReplyHTML(
    ctx,
    formatSearchResultsMessage(q, rows),
    Markup.inlineKeyboard([
      [Markup.button.webApp("🛍 Katalogda ochish", buildCatalogUrlWithQuery(q))],
      [Markup.button.callback('🔎 Yana qidirish', 'search_start')],
    ]),
  );
}

async function callBotAdminOrderStatus({ actorTelegramId, orderId, status }) {
  const ts = String(Math.floor(Date.now() / 1000));
  const payload = `${actorTelegramId}:${orderId}:${status}:${ts}`;
  const sign = crypto.createHmac('sha256', botInternalSecret).update(payload).digest('hex');
  return callBotApi(`/admin/orders/${orderId}/status`, {
    method: 'POST',
    headers: {
      'x-bot-admin-ts': ts,
      'x-bot-admin-sign': sign,
    },
    body: JSON.stringify({ actor_telegram_id: actorTelegramId, status }),
  });
}

function adminPayloadSignature({ actorTelegramId, action, payload }) {
  const ts = String(Math.floor(Date.now() / 1000));
  const payloadHash = crypto.createHash('sha256').update(JSON.stringify(payload || {})).digest('hex');
  const signPayload = `${actorTelegramId}:${action}:${payloadHash}:${ts}`;
  const sign = crypto.createHmac('sha256', botInternalSecret).update(signPayload).digest('hex');
  return {
    'x-bot-admin-ts': ts,
    'x-bot-admin-sign': sign,
  };
}

async function callBotAdminCourierUpsert({ actorTelegramId, payload }) {
  const signPayload = {
    telegram_id: payload.telegram_id ?? null,
    username: payload.username ?? null,
    display_name: payload.display_name ?? payload.displayName ?? null,
    phone: payload.phone ?? null,
    active: payload.active == null ? 1 : payload.active ? 1 : 0,
  };
  return callBotApi('/admin/couriers', {
    method: 'POST',
    headers: adminPayloadSignature({ actorTelegramId, action: 'courier_upsert', payload: signPayload }),
    body: JSON.stringify({ ...payload, actor_telegram_id: actorTelegramId }),
  });
}

async function callBotAdminCourierActive({ actorTelegramId, courierId, active }) {
  const payload = { courier_id: courierId, active: active ? 1 : 0 };
  return callBotApi(`/admin/couriers/${courierId}/active`, {
    method: 'POST',
    headers: adminPayloadSignature({ actorTelegramId, action: 'courier_active', payload }),
    body: JSON.stringify({ actor_telegram_id: actorTelegramId, active: !!active }),
  });
}

async function callBotAdminCouriersList(actorTelegramId) {
  return callBotApi(`/admin/couriers?actor_telegram_id=${actorTelegramId}`, {
    headers: adminPayloadSignature({ actorTelegramId, action: 'courier_list', payload: {} }),
  });
}

async function callBotAdminSummary(actorTelegramId) {
  return callBotApi(`/admin/summary?actor_telegram_id=${actorTelegramId}`, {
    headers: adminPayloadSignature({ actorTelegramId, action: 'admin_summary', payload: {} }),
  });
}

async function callBotAdminOrders({ actorTelegramId, status }) {
  const safeStatus = String(status || 'new').toLowerCase();
  return callBotApi(`/admin/orders?actor_telegram_id=${actorTelegramId}&status=${encodeURIComponent(safeStatus)}`, {
    headers: adminPayloadSignature({ actorTelegramId, action: 'admin_orders', payload: { status: safeStatus } }),
  });
}

async function callBotAdminReport({ actorTelegramId, reportType }) {
  const safeType = String(reportType || '').toLowerCase();
  return callBotApi(`/admin/reports/${encodeURIComponent(safeType)}?actor_telegram_id=${actorTelegramId}`, {
    headers: adminPayloadSignature({ actorTelegramId, action: 'admin_report', payload: { report_type: safeType } }),
  });
}

async function callBotAdminStoreReport({ actorTelegramId, kind }) {
  // Always request canonical kind (marketing), never alias strings.
  const safeKind = normalizeReportKind(kind) || String(kind || '').toLowerCase();
  return callBotApi(
    `/admin/store-reports/${encodeURIComponent(safeKind)}?actor_telegram_id=${actorTelegramId}`,
    {
      headers: adminPayloadSignature({
        actorTelegramId,
        action: 'admin_store_report',
        payload: { kind: safeKind },
      }),
    },
  );
}

async function callBotAdminCreditRemind({ actorTelegramId, customerId }) {
  const safeId = String(customerId || '').trim();
  return callBotApi(`/admin/customers/${encodeURIComponent(safeId)}/credit-reminder`, {
    method: 'POST',
    headers: adminPayloadSignature({
      actorTelegramId,
      action: 'admin_credit_remind',
      payload: { customer_id: safeId },
    }),
    body: JSON.stringify({ actor_telegram_id: actorTelegramId }),
  });
}

function formatOrdersMessage(rows) {
  if (!rows.length) {
    return `📦 <b>Soʻnggi buyurtmalar</b>\n${BRAND.divider}\n<i>Hozircha onlayn buyurtmalar yoʻq.</i>`;
  }
  const lines = rows.map((r, i) => {
    const sum = fmtMoney(r.total_amount);
    const d = fmtDate(r.created_at);
    const pay = r.payment_status || 'pending';
    return `<b>${i + 1}.</b> <code>${esc(r.order_number)}</code>\n` +
      `   ${esc(statusBadge(r.status))} · 💳 ${esc(pay)}\n` +
      `   💰 <b>${esc(sum)}</b>${d ? `\n   🕘 ${esc(d)}` : ''}`;
  });
  return `📦 <b>Soʻnggi buyurtmalar</b>\n${BRAND.divider}\n` + lines.join(`\n${BRAND.softDivider}\n`);
}

function buildOrdersActionsKeyboard(rows) {
  const actionRows = [];
  for (const row of rows || []) {
    const orderId = Number.parseInt(String(row?.id), 10);
    if (!Number.isFinite(orderId)) continue;
    if (String(row?.status) !== 'new') continue;
    actionRows.push([
      Markup.button.callback(`✏️ #${orderId} manzil`, `oe:${orderId}`),
      Markup.button.callback(`❌ #${orderId} bekor`, `oc:${orderId}`),
    ]);
    if (actionRows.length >= 5) break;
  }
  if (!actionRows.length) return null;
  return Markup.inlineKeyboard(actionRows);
}

function buildPagedOrdersKeyboard(source, page, totalPages) {
  const s = source === 'pos' ? 'pos' : 'web';
  const p = Math.max(1, Number(page || 1));
  const t = Math.max(1, Number(totalPages || 1));
  const nav = [];
  if (p > 1) nav.push(Markup.button.callback('⬅️ Oldingi', `ol:${s}:${p - 1}`));
  if (p < t) nav.push(Markup.button.callback('Keyingi ➡️', `ol:${s}:${p + 1}`));
  const rows = [
    [
      Markup.button.callback('📦 Onlayn (to‘liq)', 'ol:web:1'),
      Markup.button.callback('🧾 POS (to‘liq)', 'ol:pos:1'),
    ],
  ];
  if (nav.length) rows.push(nav);
  return Markup.inlineKeyboard(rows);
}

function formatPagedOrdersMessage(source, pagePayload) {
  const src = source === 'pos' ? '🧾 POS' : '🛒 Onlayn';
  const meta = pagePayload?.meta || {};
  const rows = Array.isArray(pagePayload?.rows) ? pagePayload.rows : [];
  const page = Number(meta.page || 1);
  const totalPages = Number(meta.total_pages || 1);
  const total = Number(meta.total || rows.length || 0);
  const head =
    `📄 <b>${esc(src)} buyurtmalar</b>\n` +
    `${BRAND.divider}\n` +
    `📑 Sahifa: <b>${page}/${totalPages}</b>  ·  📊 Jami: <b>${total}</b>`;
  if (!rows.length) {
    return `${head}\n${BRAND.softDivider}\n<i>Buyurtmalar topilmadi.</i>`;
  }
  const lines = rows.map((r, i) => {
    const sum = fmtMoney(r.total_amount);
    const d = fmtDate(r.created_at);
    const pay = r.payment_status || 'pending';
    return `<b>${i + 1}.</b> <code>${esc(r.order_number)}</code>\n` +
      `   ${esc(statusBadge(r.status))} · 💳 ${esc(pay)}\n` +
      `   💰 <b>${esc(sum)}</b>${d ? `\n   🕘 ${esc(d)}` : ''}`;
  });
  return `${head}\n${BRAND.softDivider}\n${lines.join(`\n${BRAND.softDivider}\n`)}`;
}

function noteValue(note, label) {
  const re = new RegExp(`^${label}:\\s*(.+)$`, 'im');
  return String(note || '').match(re)?.[1]?.trim() || null;
}

function mapUrlFromText(...parts) {
  for (const part of parts) {
    const text = String(part || '');
    const direct = text.match(/https?:\/\/(?:www\.)?(?:google\.[^\s]+\/maps|maps\.google\.[^\s]+|yandex\.[^\s]+\/maps|2gis\.[^\s]+)[^\s)]+/i);
    if (direct) return direct[0];
    const coords = text.match(/(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)/);
    if (coords) {
      const lat = Number(coords[1]);
      const lng = Number(coords[2]);
      if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
        return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
      }
    }
  }
  return null;
}

function formatCourierOrderBrief(order) {
  const sum = fmtMoney(order.total_amount);
  const customer = [order.first_name, order.last_name].filter(Boolean).join(' ') || 'Mijoz';
  const extraPhone = noteValue(order.note, "Qo'shimcha telefon");
  const mapUrl = mapUrlFromText(noteValue(order.note, 'Xarita'), noteValue(order.note, 'Lokatsiya'), order.delivery_address, order.note);
  const payInfo = [order.payment_method, order.payment_status].filter(Boolean).join(' / ') || '—';
  const lines = [
    `📦 <b>#${esc(order.id)}</b>  <code>${esc(order.order_number || '')}</code>`,
    `   ${esc(statusBadge(order.status))}`,
    `${BRAND.softDivider}`,
    `👤 Mijoz: <b>${esc(customer)}</b>`,
  ];
  if (order.phone) lines.push(`📱 Tel: <code>${esc(order.phone)}</code>`);
  if (extraPhone) lines.push(`📞 Qoʻshimcha: <code>${esc(extraPhone)}</code>`);
  if (order.delivery_address) lines.push(`📍 Manzil: <i>${esc(order.delivery_address)}</i>`);
  if (mapUrl) lines.push(`🗺 <a href="${esc(mapUrl)}">Xaritada ochish</a>`);
  lines.push(`💳 Toʻlov: ${esc(payInfo)}`);
  lines.push(`💰 Summa: <b>${esc(sum)}</b>`);
  return lines.join('\n');
}

function formatCourierOrderDetail(payload) {
  const order = payload?.order || {};
  const items = Array.isArray(payload?.items) ? payload.items : [];
  const lines = [
    `🚚 <b>Kuryer buyurtmasi</b>`,
    `${BRAND.divider}`,
    formatCourierOrderBrief(order),
    `${BRAND.softDivider}`,
    `🛒 <b>Mahsulotlar:</b>`,
  ];
  if (items.length) {
    for (const item of items) {
      const qty = Number(item.quantity || 0) || 0;
      const price = Number(item.price_at_order || 0) || 0;
      lines.push(`  • ${esc(item.product_name || item.product_id)} <code>x${qty}</code> = <b>${esc(fmtMoney(qty * price))}</b>`);
    }
  } else {
    lines.push(`  <i>Mahsulotlar topilmadi</i>`);
  }
  return lines.join('\n');
}

function courierOrderKeyboard(order) {
  const id = Number(order?.id);
  const status = String(order?.status || '').toLowerCase();
  const mapUrl = mapUrlFromText(noteValue(order?.note, 'Xarita'), noteValue(order?.note, 'Lokatsiya'), order?.delivery_address, order?.note);
  const rows = [];
  if (mapUrl) rows.push([Markup.button.url('🗺 Xaritada ochish', mapUrl)]);
  if (status === 'ready') rows.push([Markup.button.callback('✅ Qabul qildim', `co_accept:${id}`)]);
  if (status === 'out_for_delivery') rows.push([Markup.button.callback('📦 Yetkazildi', `co_done:${id}`)]);
  rows.push([Markup.button.callback('🔄 Ro‘yxat', 'courier_ready')]);
  return Markup.inlineKeyboard(rows);
}

function formatCouriersMessage(rows) {
  if (!rows.length) {
    return `🚚 <b>Kuryerlar</b>\n${BRAND.divider}\n<i>Roʻyxat boʻsh.</i>`;
  }
  const lines = rows.map((c, i) => {
    const name = c.display_name || c.username || c.telegram_id || `#${c.id}`;
    const username = c.username ? `@${c.username}` : '—';
    const tg = c.telegram_id || '—';
    const active = Number(c.active) ? '🟢 <b>aktiv</b>' : '⚪ <i>noaktiv</i>';
    return `<b>${i + 1}.</b> ${esc(name)}\n` +
      `   👤 ${esc(username)}  ·  🆔 <code>${esc(tg)}</code>\n` +
      `   ${active}`;
  });
  return `🚚 <b>Kuryerlar</b>\n${BRAND.divider}\n${lines.join(`\n${BRAND.softDivider}\n`)}`;
}

function couriersKeyboard(rows) {
  const buttons = [
    [Markup.button.callback("➕ Kuryer qo'shish", 'admin_courier_add')],
  ];
  for (const c of rows.slice(0, 8)) {
    buttons.push([
      Markup.button.callback(
        Number(c.active) ? `⛔ ${c.username || c.telegram_id}` : `✅ ${c.username || c.telegram_id}`,
        `admin_courier_active:${c.id}:${Number(c.active) ? 0 : 1}`,
      ),
    ]);
  }
  buttons.push([Markup.button.callback('🔄 Yangilash', 'admin_couriers')]);
  return Markup.inlineKeyboard(buttons);
}

async function sendAdminPanel(ctx) {
  if (!isAdminUser(ctx)) {
    await safeReply(ctx, 'Bu boʻlim faqat admin uchun.');
    return;
  }
  await safeReplyHTML(
    ctx,
    `🛠 <b>Admin panel</b>\n${BRAND.divider}\n` +
      `${BRAND.bullet} Buyurtmalar, kuryerlar va bugungi holatni boshqaring.\n` +
      `${BRAND.spark} <i>Quyidagi tugmalardan tanlang:</i>`,
    adminPanelKeyboard(),
  );
}

async function sendAdminSummary(ctx) {
  if (!isAdminUser(ctx)) {
    await safeReply(ctx, 'Bu boʻlim faqat admin uchun.');
    return;
  }
  const actorTelegramId = ctx.from?.id;
  const out = await callBotAdminSummary(actorTelegramId);
  await safeReplyHTML(ctx, formatAdminSummary(out), adminPanelKeyboard());
}

async function sendAdminOrders(ctx, status = 'new') {
  if (!isAdminUser(ctx)) {
    await safeReply(ctx, 'Bu boʻlim faqat admin uchun.');
    return;
  }
  const safeStatus = String(status || 'new').toLowerCase();
  const actorTelegramId = ctx.from?.id;
  const out = await callBotAdminOrders({ actorTelegramId, status: safeStatus });
  const rows = Array.isArray(out?.rows) ? out.rows : [];
  await safeReplyHTML(ctx, formatAdminOrders(out?.status || safeStatus, rows), adminOrdersKeyboard(rows, out?.status || safeStatus));
}

async function sendAdminReport(ctx, reportType) {
  if (!isAdminUser(ctx)) {
    await safeReply(ctx, 'Bu boʻlim faqat admin uchun.');
    return;
  }
  const actorTelegramId = ctx.from?.id;
  const out = await callBotAdminReport({ actorTelegramId, reportType });
  await safeReplyHTML(ctx, formatAdminReport(out), adminReportsKeyboard());
}

async function sendAdminHisobotMenu(ctx, { greetName = '' } = {}) {
  if (!isAdminUser(ctx)) {
    await safeReply(ctx, 'Hisobotlar faqat admin uchun (TELEGRAM_ADMIN_IDS).');
    return;
  }
  const hello = greetName
    ? `Assalomu alaykum, <b>${esc(greetName)}</b>!\n`
    : '';
  await safeReplyHTML(
    ctx,
    `📊 <b>Admin hisobot menyusi</b>\n${BRAND.divider}\n` +
      hello +
      `${BRAND.bullet} Kunlik, AI, muzlab, qarz, foyda, marketing — tugmani bosing.\n` +
      `${BRAND.spark} Yoki buyruq: <code>/hisobot</code> · <code>/tahlil</code> · <code>/marketing</code>\n` +
      `${BRAND.softDivider}\n` +
      `Doʻkon uchun: <code>/shop</code> yoki <b>${esc(MENU.shop)}</b> tugmasi`,
    adminHisobotKeyboard(),
  );
  await safeReplyHTML(
    ctx,
    `${BRAND.spark} <b>Tezkor hisobot</b>`,
    adminHisobotInlineKeyboard(),
  );
}

async function sendShopOpen(ctx) {
  if (!(await ensureRegisteredOrStart(ctx, { forceStart: true }))) return;
  await safeReplyHTML(
    ctx,
    `${BRAND.bullet} <b>Doʻkonni ochish</b>\n${BRAND.softDivider}\n` +
      `<i>Mini App tugmasini bosing va xaridingizni boshlang:</i>`,
    Markup.inlineKeyboard([[Markup.button.webApp(MENU.shop, webAppUrl)]]),
  );
}

async function sendHelp(ctx) {
  if (isAdminUser(ctx)) {
    await safeReplyHTML(
      ctx,
      `ℹ️ <b>Admin yordam</b>\n${BRAND.divider}\n` +
        `${BRAND.bullet} <b>📊 Kunlik / AI / Haftalik / Muzlab / Qarz / Foyda / Marketing</b> — doʻkon hisobotlari\n` +
        `${BRAND.bullet} <b>${esc(MENU.admin)}</b> — buyurtmalar va kuryerlar paneli\n` +
        `${BRAND.bullet} <b>${esc(MENU.shop)}</b> — onlayn doʻkon (Mini App)\n` +
        `${BRAND.softDivider}\n` +
        `${BRAND.spark} <b>Buyruqlar:</b>\n` +
        `<code>/start</code> — hisobot menyusi\n` +
        `<code>/hisobot</code> — hisobot tugmalari\n` +
        `<code>/tahlil</code> · <code>/ai</code> — AI tahlil\n` +
        `<code>/marketing</code> — marketing / assortiment\n` +
        `<code>/admin</code> — admin panel\n` +
        `<code>/shop</code> — doʻkon\n` +
        `<code>/help</code>`,
      adminHisobotKeyboard(),
    );
    return;
  }
  await safeReplyHTML(
    ctx,
    `ℹ️ <b>Yordam</b>\n${BRAND.divider}\n` +
      `${BRAND.bullet} <b>${esc(MENU.shop)}</b> — onlayn doʻkonni ochadi\n` +
      `${BRAND.bullet} <b>${esc(MENU.search)}</b> — mahsulot qidiradi\n` +
      `${BRAND.bullet} <b>${esc(MENU.orders)}</b> — soʻnggi buyurtmalaringiz\n` +
      `${BRAND.bullet} <b>${esc(MENU.card)}</b> — nakopitel karta va ball\n` +
      `${BRAND.bullet} <b>${esc(MENU.contact)}</b> — aloqa maʼlumotlari\n` +
      `${BRAND.bullet} <b>${esc(MENU.courier)}</b> — kuryer panel (faqat kuryer)\n` +
      `${BRAND.softDivider}\n` +
      `${BRAND.spark} <b>Buyruqlar:</b>\n` +
      `<code>/start  /shop  /search  /orders  /card  /help</code>`,
    await mainMenuKeyboardAsync(ctx),
  );
}

async function sendAdminStoreReport(ctx, kind) {
  if (!isAdminUser(ctx)) {
    await safeReply(ctx, 'Hisobotlar faqat admin uchun (TELEGRAM_ADMIN_IDS).');
    return;
  }
  const actorTelegramId = ctx.from?.id;
  if (tooFrequent(ctx)) return;
  try {
    await safeReply(ctx, '⏳ Hisobot tayyorlanmoqda…');
    const out = await callBotAdminStoreReport({ actorTelegramId, kind });
    const parts = Array.isArray(out?.texts) && out.texts.length
      ? out.texts
      : [String(out?.text || 'Hisobot boʻsh.')];
    const useHtml =
      String(out?.parseMode || '').toUpperCase() === 'HTML' ||
      kind === 'ai' ||
      kind === 'marketing' ||
      parts.some((p) => /<\/?[a-z][\s\S]*>/i.test(String(p || '')));
    const replyMarkup = out?.replyMarkup || null;
    for (let i = 0; i < parts.length; i += 1) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      const extra = isLast && replyMarkup?.inline_keyboard?.length ? { reply_markup: replyMarkup } : undefined;
      // eslint-disable-next-line no-await-in-loop
      if (useHtml) await safeReplyHTML(ctx, part, extra);
      else await safeReply(ctx, part, extra);
    }
  } catch (e) {
    await safeReply(ctx, `Hisobot olinmadi.\n(${e.message})`);
  }
}

async function sendAdminCouriers(ctx) {
  if (!isAdminUser(ctx)) {
    await safeReply(ctx, 'Bu boʻlim faqat admin uchun.');
    return;
  }
  const actorTelegramId = ctx.from?.id;
  const out = await callBotAdminCouriersList(actorTelegramId);
  const rows = Array.isArray(out?.rows) ? out.rows : [];
  await safeReplyHTML(ctx, formatCouriersMessage(rows), couriersKeyboard(rows));
}

function parseCourierInput(text) {
  const parts = String(text || '').trim().split(/\s+/).filter(Boolean);
  const payload = {};
  const first = parts.shift() || '';
  if (/^-?\d+$/.test(first)) payload.telegram_id = Number.parseInt(first, 10);
  else payload.username = first.replace(/^@/, '');
  const displayName = parts.join(' ').trim();
  if (displayName) payload.display_name = displayName;
  payload.active = 1;
  return payload;
}

async function sendCourierPanel(ctx) {
  if (!(await isCourierUserAsync(ctx))) {
    await safeReply(ctx, "Bu boʻlim faqat kuryerlar uchun.");
    return;
  }
  await safeReplyHTML(
    ctx,
    `🚚 <b>Kuryer panel</b>\n${BRAND.divider}\n` +
      `${BRAND.bullet} Tayyor buyurtmalarni oling yoki yoʻldagi buyurtmalarni koʻring.\n` +
      `${BRAND.spark} <i>Tugmani tanlang:</i>`,
    Markup.inlineKeyboard([
      [Markup.button.callback('📦 Tayyor buyurtmalar', 'courier_ready')],
      [Markup.button.callback("🚚 Yoʻldagi buyurtmalar", 'courier_active')],
    ]),
  );
}

async function sendCourierOrders(ctx, status = 'ready') {
  if (!(await isCourierUserAsync(ctx))) {
    await safeReply(ctx, "Bu bo'lim faqat kuryerlar uchun.");
    return;
  }
  const tgId = ctx.from?.id;
  const username = String(ctx.from?.username || '').trim();
  const out = await callBotApi(
    `/courier/orders?status=${encodeURIComponent(status)}&actor_telegram_id=${tgId}&actor_username=${encodeURIComponent(username)}`,
  );
  const rows = Array.isArray(out?.rows) ? out.rows : [];
  if (!rows.length) {
    await safeReply(ctx, status === 'ready' ? "Tayyor buyurtmalar yoʻq." : "Yoʻldagi buyurtmalar yoʻq.");
    return;
  }
  for (const order of rows.slice(0, 10)) {
    await safeReplyHTML(ctx, formatCourierOrderBrief(order), courierOrderKeyboard(order));
  }
}

async function updateCourierOrderStatus(ctx, orderId, status) {
  if (!(await isCourierUserAsync(ctx))) {
    await ctx.answerCbQuery("Bu bo'lim faqat kuryerlar uchun.", { show_alert: true });
    return;
  }
  const tgId = ctx.from?.id;
  if (!Number.isFinite(orderId) || tgId == null) {
    await ctx.answerCbQuery("Buyurtma ID xato", { show_alert: true });
    return;
  }
  const out = await callBotApi(`/courier/orders/${orderId}/status`, {
    method: 'POST',
    body: JSON.stringify({ actor_telegram_id: tgId, actor_username: ctx.from?.username || '', status }),
  });
  const detail = await callBotApi(
    `/courier/orders/${orderId}?actor_telegram_id=${tgId}&actor_username=${encodeURIComponent(ctx.from?.username || '')}`,
  );
  await ctx.answerCbQuery(status === 'delivered' ? 'Yetkazildi' : 'Qabul qilindi');
  await safeReplyHTML(ctx, formatCourierOrderDetail(detail), courierOrderKeyboard(detail?.order || { id: orderId, status: out.status }));
}

function buildAdminStatusKeyboard(orderId, currentStatus, allowedNext) {
  const options = Array.isArray(allowedNext) ? allowedNext : [];
  const labels = {
    processing: "Yig'ilmoqda",
    ready: 'Tayyor',
    out_for_delivery: "Yo'lda",
    delivered: 'Yetkazildi',
    cancelled: 'Bekor',
  };
  const row1 = options.slice(0, 2).map((st) => Markup.button.callback(labels[st] || st, `oas:${orderId}:${st}`));
  const row2 = options.slice(2, 4).map((st) => Markup.button.callback(labels[st] || st, `oas:${orderId}:${st}`));
  const rows = [row1, row2].filter((r) => r.length > 0);
  if (!rows.length) return undefined;
  return Markup.inlineKeyboard(rows);
}

function adminPanelKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('📊 Bugungi holat', 'admin_summary')],
    [Markup.button.callback('📈 Hisobotlar', 'admin_reports')],
    [Markup.button.callback('📊 Doʻkon hisobot / AI', 'admin_hisobot')],
    [Markup.button.callback('🆕 Yangi', 'admin_orders:new'), Markup.button.callback('💳 Toʻlangan', 'admin_orders:paid')],
    [Markup.button.callback("🧺 Yigʻilmoqda", 'admin_orders:processing'), Markup.button.callback('✅ Tayyor', 'admin_orders:ready')],
    [Markup.button.callback("🚚 Yoʻldagi", 'admin_orders:out_for_delivery'), Markup.button.callback('📂 Ochiq hammasi', 'admin_orders:open')],
    [Markup.button.callback('🚚 Kuryerlar', 'admin_couriers')],
  ]);
}

function adminReportsKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('💰 Bugungi sotuv', 'admin_report:today_sales')],
    [Markup.button.callback('⛔ Tugagan mahsulotlar', 'admin_report:out_stock')],
    [Markup.button.callback('⚠️ Kam qolgan mahsulotlar', 'admin_report:low_stock')],
    [Markup.button.callback('🔥 Eng ko‘p sotilganlar', 'admin_report:top_products')],
    [Markup.button.callback('💳 Nasiya / qarz sotuvlar', 'admin_report:credit_sales')],
    [Markup.button.callback('⬅️ Admin panel', 'admin_panel')],
  ]);
}

function adminOrdersKeyboard(rows, status) {
  const buttons = [];
  for (const order of rows.slice(0, 10)) {
    const sum = Number(order.total_amount || 0).toLocaleString('uz-UZ');
    buttons.push([
      Markup.button.callback(
        `#${order.id} ${order.order_number || ''} — ${sum} so'm`,
        `admin_order:${order.id}`,
      ),
    ]);
  }
  buttons.push([Markup.button.callback('🔄 Yangilash', `admin_orders:${status}`)]);
  buttons.push([Markup.button.callback('⬅️ Admin panel', 'admin_panel')]);
  return Markup.inlineKeyboard(buttons);
}

function formatAdminSummary(data) {
  const today = data?.today || {};
  const open = data?.open || {};
  const customers = data?.customers || {};
  const rows = Array.isArray(today.by_status) ? today.by_status : [];
  const statusText = rows.length
    ? rows
        .map((r) => `   ${esc(statusBadge(r.status))} — <b>${Number(r.count || 0)}</b> ta · <b>${esc(fmtMoney(r.amount))}</b>`)
        .join('\n')
    : `   <i>Bugun buyurtma yoʻq</i>`;
  return (
    `📊 <b>Admin panel — bugungi holat</b>\n` +
    `${BRAND.divider}\n` +
    `📅 Sana: <b>${esc(data?.date || '—')}</b>\n` +
    `${BRAND.softDivider}\n` +
    `📈 Bugun: <b>${Number(today.count || 0)}</b> ta · <b>${esc(fmtMoney(today.amount))}</b>\n` +
    `📂 Ochiq buyurtmalar: <b>${Number(open.count || 0)}</b> ta · <b>${esc(fmtMoney(open.amount))}</b>\n` +
    `👥 Telegram mijozlar: <b>${Number(customers.telegram_count || 0)}</b> ta\n` +
    `${BRAND.softDivider}\n` +
    `${BRAND.spark} <b>Holatlar:</b>\n${statusText}`
  );
}

function formatAdminReport(data) {
  const type = String(data?.report_type || '');
  const date = data?.date || '—';
  if (type === 'today_sales') {
    const pos = data?.pos || {};
    const web = data?.web || {};
    const payments = Array.isArray(data?.payments) ? data.payments : [];
    const paymentLines = payments.length
      ? payments
          .map((p) => `   • <b>${esc(p.payment_status || '—')}</b>: ${Number(p.count || 0)} ta · <b>${esc(fmtMoney(p.amount))}</b>`)
          .join('\n')
      : `   <i>Toʻlov holatlari yoʻq</i>`;
    return (
      `💰 <b>Bugungi sotuv</b>\n` +
      `${BRAND.divider}\n` +
      `📅 Sana: <b>${esc(date)}</b>\n` +
      `${BRAND.softDivider}\n` +
      `🧾 <b>POS:</b> ${Number(pos.count || 0)} ta · <b>${esc(fmtMoney(pos.amount))}</b>\n` +
      `   🟢 Tushum: <b>${esc(fmtMoney(pos.paid_amount))}</b>\n` +
      `   🔴 Qarzga: <b>${esc(fmtMoney(pos.credit_amount))}</b>\n` +
      `${BRAND.softDivider}\n` +
      `🛒 <b>Onlayn (toʻlangan / yakunlangan):</b>\n   ${Number(web.count || 0)} ta · <b>${esc(fmtMoney(web.amount))}</b>\n` +
      `<i>(Onlayn POS tushumiga qoʻshilmagan, alohida koʻrsatildi.)</i>\n` +
      `${BRAND.softDivider}\n` +
      `${BRAND.spark} <b>Toʻlovlar:</b>\n${paymentLines}`
    );
  }

  if (type === 'out_stock' || type === 'low_stock') {
    const rows = Array.isArray(data?.rows) ? data.rows : [];
    const title = type === 'out_stock' ? '⛔ Tugagan mahsulotlar' : '⚠️ Kam qolgan mahsulotlar';
    if (!rows.length) {
      return `<b>${esc(title)}</b>\n${BRAND.divider}\n<i>Mahsulot topilmadi.</i>`;
    }
    return (
      `<b>${esc(title)}</b>\n${BRAND.divider}\n📅 Sana: <b>${esc(date)}</b>\n${BRAND.softDivider}\n` +
      rows
        .slice(0, 20)
        .map((r, i) => {
          const stock = Number(r.current_stock || 0).toLocaleString('uz-UZ');
          const min = Number(r.min_stock_level || 0).toLocaleString('uz-UZ');
          return `<b>${i + 1}.</b> ${esc(r.name || r.id)}\n` +
            `   🏷 SKU: <code>${esc(r.sku || '—')}</code>\n` +
            `   📦 Qoldiq: <b>${stock}</b>  ·  Min: <b>${min}</b>`;
        })
        .join(`\n${BRAND.softDivider}\n`)
    );
  }

  if (type === 'top_products') {
    const rows = Array.isArray(data?.rows) ? data.rows : [];
    if (!rows.length) {
      return `🔥 <b>Eng koʻp sotilganlar</b>\n${BRAND.divider}\n<i>Bugun sotuv topilmadi.</i>`;
    }
    return (
      `🔥 <b>Eng koʻp sotilganlar</b>\n${BRAND.divider}\n` +
      `📅 Sana: <b>${esc(date)}</b>\n` +
      `<i>POS sotuvlari + hali POSga oʻtmagan toʻlangan onlayn buyurtmalar</i>\n` +
      `${BRAND.softDivider}\n` +
      rows
        .map((r, i) => {
          const qty = Number(r.sold_qty || 0).toLocaleString('uz-UZ');
          return `<b>${i + 1}.</b> ${esc(r.product_name || r.product_id)}\n` +
            `   📊 Miqdor: <b>${qty}</b>  ·  💰 <b>${esc(fmtMoney(r.amount))}</b>`;
        })
        .join(`\n${BRAND.softDivider}\n`)
    );
  }

  const rows = Array.isArray(data?.rows) ? data.rows : [];
  if (!rows.length) {
    return `💳 <b>Nasiya / qarz sotuvlar</b>\n${BRAND.divider}\n<i>Bugun qarzga sotuv topilmadi.</i>`;
  }
  return (
    `💳 <b>Nasiya / qarz sotuvlar</b>\n${BRAND.divider}\n` +
    `📅 Sana: <b>${esc(date)}</b>  ·  🔴 Jami qarz: <b>${esc(fmtMoney(data?.total_credit))}</b>\n` +
    `${BRAND.softDivider}\n` +
    rows
      .map((r, i) => {
        return `<b>${i + 1}.</b> <code>${esc(r.order_number || r.id)}</code>\n` +
          `   👤 ${esc(r.customer_name || 'Mijoz')}\n` +
          `   💰 <b>${esc(fmtMoney(r.credit_amount))}</b>  ·  🕘 ${esc(fmtDate(r.created_at))}`;
      })
      .join(`\n${BRAND.softDivider}\n`)
  );
}

function formatAdminOrders(status, rows) {
  const label = {
    new: 'Yangi',
    paid: 'Toʻlangan',
    processing: "Yigʻilmoqda",
    ready: 'Tayyor',
    out_for_delivery: "Yoʻldagi",
    delivered: 'Yetkazilgan',
    cancelled: 'Bekor qilingan',
    open: 'Ochiq buyurtmalar',
  }[status] || status;
  if (!rows.length) {
    return `📦 <b>${esc(label)}</b>\n${BRAND.divider}\n<i>Buyurtma topilmadi.</i>`;
  }
  return (
    `📦 <b>${esc(label)}</b>  ·  <i>${rows.length} ta</i>\n${BRAND.divider}\n` +
    rows.map((o, i) => `<b>${i + 1}.</b>\n${formatCourierOrderBrief(o)}`).join(`\n${BRAND.softDivider}\n`)
  );
}

function formatCardMessage(profile) {
  const c = profile?.customer || {};
  const binding = profile?.binding || {};
  const pos = profile?.pos_account || {};
  const loyalty = profile?.loyalty || {};
  const orders = profile?.orders || {};
  const webOrders = Array.isArray(orders?.web?.rows) ? orders.web.rows : [];
  const posOrders = Array.isArray(orders?.pos?.rows) ? orders.pos.rows : [];
  const webOrdersTotal = Number(orders?.web?.total || webOrders.length || 0);
  const posOrdersTotal = Number(orders?.pos?.total || posOrders.length || 0);
  const points = Number(loyalty.points_balance || 0);
  const nextGoal = Number(loyalty.next_goal_points || 0);
  const toNext = Number(loyalty.points_to_next_goal || 0);
  const fullName = [c.first_name, c.last_name].filter(Boolean).join(' ') || 'Mijoz';
  const phone = c.phone || "qoʻshilmagan";
  const addr = c.address || "qoʻshilmagan";
  const posBalance = Number(pos.balance || 0);
  const accountStatus =
    posBalance < 0
      ? `🔴 Qarz: <b>${fmtMoney(Math.abs(posBalance))}</b>`
      : posBalance > 0
        ? `🟢 Haq: <b>${fmtMoney(posBalance)}</b>`
        : `⚪ Hisob: <b>${fmtMoney(0)}</b>`;
  const loyaltyCardCode = String(binding.loyalty_card_code || '').trim();
  const ledgerRows = Array.isArray(loyalty.ledger) ? loyalty.ledger.slice(0, 5) : [];

  const formatOrderLine = (r, i) => {
    const sum = fmtMoney(r.total_amount);
    const d = fmtDate(r.created_at);
    const pay = r.payment_status || 'pending';
    return `  ${i + 1}. <code>${esc(r.order_number)}</code> · ${esc(statusBadge(r.status))} · 💳 ${esc(pay)}\n` +
      `      💰 <b>${esc(sum)}</b>${d ? ` · 🕘 ${esc(d)}` : ''}`;
  };

  const webOrdersText = webOrders.length
    ? `\n\n🛒 <b>Onlayn buyurtmalar</b> <i>(${webOrdersTotal})</i>\n${BRAND.softDivider}\n` +
      webOrders.slice(0, 12).map((r, i) => formatOrderLine(r, i)).join('\n\n')
    : `\n\n🛒 <b>Onlayn buyurtmalar:</b> <i>yoʻq</i>`;
  const posOrdersText = posOrders.length
    ? `\n\n🧾 <b>POS buyurtmalar</b> <i>(${posOrdersTotal})</i>\n${BRAND.softDivider}\n` +
      posOrders.slice(0, 12).map((r, i) => formatOrderLine(r, i)).join('\n\n')
    : `\n\n🧾 <b>POS buyurtmalar:</b> <i>yoʻq</i>`;
  const ledgerText = ledgerRows.length
    ? `\n\n${BRAND.spark} <b>Oxirgi bonus harakatlar</b>\n${BRAND.softDivider}\n` +
      ledgerRows
        .map((r) => {
          const v = Number(r.points_delta);
          const sign = v > 0 ? `🟢 +${v}` : `🔴 ${v}`;
          const dt = fmtDate(r.created_at);
          return `  ${sign}  · <i>${esc(r.type)}</i>${dt ? ` · ${esc(dt)}` : ''}`;
        })
        .join('\n')
    : '';

  return (
    `🎁 <b>Nakopitel karta</b>\n` +
    `${BRAND.divider}\n` +
    `👤 Ism: <b>${esc(fullName)}</b>\n` +
    `📱 Telefon: <code>${esc(phone)}</code>\n` +
    `📍 Manzil: <i>${esc(addr)}</i>\n` +
    `🪪 Karta kodi: <code>${esc(loyaltyCardCode || 'yoʻq')}</code>\n` +
    `${BRAND.softDivider}\n` +
    `${accountStatus}\n` +
    `🛒 Onlayn buyurtmalar: <b>${webOrdersTotal}</b>\n` +
    `🧾 POS buyurtmalar:    <b>${posOrdersTotal}</b>\n` +
    `${BRAND.softDivider}\n` +
    `${BRAND.star} Ball balans: <b>${points}</b>\n` +
    `🎯 Keyingi maqsad: <b>${nextGoal}</b> <i>(yana ${toNext} ball)</i>` +
    webOrdersText +
    posOrdersText +
    ledgerText
  );
}

async function getRegistrationStatus(telegramId) {
  return callBotApi(`/registration/${telegramId}`);
}

function registrationContactKeyboard() {
  return Markup.keyboard([
    [Markup.button.contactRequest('📱 Telefonni yuborish')],
    ['/cancel_register'],
  ]).resize();
}

function resetRegistrationState(telegramId) {
  if (telegramId == null) return;
  registrationState.delete(telegramId);
}

function normalizedTelegramName(from, field) {
  const raw = String(from?.[field] || '').trim();
  const cleaned = toLatinName(raw);
  if (cleaned.length >= 2 && cleaned.length <= 80) return cleaned;
  return field === 'first_name' ? 'Mijoz' : '';
}

function toLatinName(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^(nomalum|noma'lum|unknown|неизвестно|номаълум)$/i.test(raw)) return '';
  const map = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'j', з: 'z', и: 'i', й: 'y',
    к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u',
    ф: 'f', х: 'x', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sh', ъ: '', ы: 'i', ь: '', э: 'e',
    ю: 'yu', я: 'ya', ў: "o'", қ: 'q', ғ: "g'", ҳ: 'h',
  };
  return raw
    .split('')
    .map((ch) => {
      const lower = ch.toLowerCase();
      const out = map[lower];
      if (out == null) return ch;
      return ch === lower ? out : out.charAt(0).toUpperCase() + out.slice(1);
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

async function startRegistrationFlow(ctx) {
  const tgId = ctx.from?.id;
  if (tgId == null) return;
  registrationState.set(tgId, { step: 'phone' });
  await safeReplyHTML(
    ctx,
    `${BRAND.bullet} <b>Roʻyxatdan oʻtish</b>\n${BRAND.softDivider}\n` +
      `Telefon raqamingizni yuboring (pastdagi <b>📱 Telefonni yuborish</b> tugmasi orqali):`,
    registrationContactKeyboard(),
  );
}

async function sendLoyaltyQrCard(ctx, payload) {
  try {
    const text = String(payload?.qr_payload || '').trim();
    if (!text) return;
    const customerName = [payload.first_name, payload.last_name].filter(Boolean).join(' ') || 'Mijoz';
    const qrBuffer = await QRCode.toBuffer(text, {
      width: 720,
      margin: 2,
      color: { dark: BRAND.qr.dark, light: BRAND.qr.light },
      errorCorrectionLevel: 'H',
    });
    const caption =
      `${BRAND.bullet} <b>Nakopitel karta ochildi</b>\n` +
      `${BRAND.divider}\n` +
      `🪪 Karta kodi: <code>${esc(payload.loyalty_card_code)}</code>\n` +
      `👤 Mijoz: <b>${esc(customerName)}</b>\n` +
      `📱 Telefon: <code>${esc(payload.phone)}</code>\n` +
      `${BRAND.softDivider}\n` +
      `${BRAND.spark} <i>QRni kassada koʻrsating — ball yigʻiladi</i>`;
    await ctx.replyWithPhoto(
      { source: qrBuffer },
      { caption, parse_mode: 'HTML' },
    );
  } catch (e) {
    await safeReply(ctx, `Karta QR yuborib bo'lmadi (${e.message})`);
  }
}

async function ensureRegisteredOrStart(ctx, { forceStart = false } = {}) {
  const tgId = ctx.from?.id;
  if (tgId == null) return false;
  try {
    const out = await getRegistrationStatus(tgId);
    if (out?.registered) return true;
  } catch {
    // fallthrough to registration
  }
  if (forceStart) {
    await startRegistrationFlow(ctx);
  }
  return false;
}

function tooFrequent(ctx) {
  const uid = ctx.from?.id;
  if (uid == null) return false;
  const now = Date.now();
  const prev = lastActionAt.get(uid) || 0;
  lastActionAt.set(uid, now);
  return now - prev < MIN_ACTION_GAP_MS;
}

async function safeReply(ctx, text, extra) {
  try {
    await ctx.reply(text, extra);
  } catch (e) {
    console.error('[telegram:bot] reply failed:', e?.message || String(e));
  }
}

async function sendRecentOrders(ctx, limit = 10) {
  const tgId = ctx.from?.id;
  if (tgId == null) return;
  if (tooFrequent(ctx)) return;
  try {
    const out = await callBotApi(`/orders/recent/${tgId}?limit=${limit}`);
    await safeReplyHTML(ctx, formatOrdersMessage(out.rows || []), buildOrdersActionsKeyboard(out.rows || []) || undefined);
  } catch (e) {
    await safeReply(ctx, `Buyurtmalarni olib boʻlmadi. Keyinroq urinib koʻring.\n(${e.message})`);
  }
}

async function sendCard(ctx) {
  const tgId = ctx.from?.id;
  if (tgId == null) return;
  if (tooFrequent(ctx)) return;
  try {
    const out = await callBotApi(`/profile/${tgId}`);
    await safeReplyHTML(ctx, formatCardMessage(out), Markup.keyboard([
      [Markup.button.contactRequest('📱 Telefonni ulashish')],
      [Markup.button.locationRequest('📍 Lokatsiyani yuborish')],
      [MENU.shop, MENU.orders],
      [MENU.help],
    ]).resize());
    const binding = out?.binding || {};
    if (binding?.qr_payload && binding?.loyalty_card_code) {
      await sendLoyaltyQrCard(ctx, {
        ...binding,
        first_name: out?.customer?.first_name || '',
        last_name: out?.customer?.last_name || '',
        phone: out?.customer?.phone || '',
      });
    }
  } catch (e) {
    await safeReply(ctx, `Karta ma'lumotlarini olib bo'lmadi.\n(${e.message})`);
  }
}

async function sendOrdersPage(ctx, source = 'web', page = 1) {
  const tgId = ctx.from?.id;
  if (tgId == null) return;
  try {
    const out = await callBotApi(`/orders/list/${tgId}?source=${source === 'pos' ? 'pos' : 'web'}&page=${page}&limit=8`);
    const text = formatPagedOrdersMessage(source, out);
    const keyboard = buildPagedOrdersKeyboard(source, out?.meta?.page || page, out?.meta?.total_pages || 1);
    await safeReplyHTML(ctx, text, keyboard);
  } catch (e) {
    await safeReply(ctx, `Buyurtmalarni olib boʻlmadi.\n(${e.message})`);
  }
}

bot.start(async (ctx) => {
  const name = ctx.from?.first_name || '';
  const registered = await ensureRegisteredOrStart(ctx);
  if (!registered) {
    await safeReplyHTML(
      ctx,
      `${BRAND.bullet} <b>Assalomu alaykum${name ? ', ' + esc(name) : ''}!</b>\n` +
        `${BRAND.divider}\n` +
        `${BRAND.leaf} <b>${esc(BRAND.name)}</b> — ${esc(BRAND.tagline)}\n\n` +
        `Davom etish uchun roʻyxatdan oʻting:`,
      Markup.inlineKeyboard([[Markup.button.callback("🌿 Roʻyxatdan oʻtish", 'register_start')]]),
    );
    return;
  }
  resetRegistrationState(ctx.from?.id);

  // Admins: reports-first — no long marketplace customer welcome.
  if (isAdminUser(ctx)) {
    await sendAdminHisobotMenu(ctx, { greetName: name });
    return;
  }

  // Customers: marketplace shop /start + ops reports notice.
  const greetingText =
    `${BRAND.bullet} <b>Assalomu alaykum${name ? ', ' + esc(name) : ''}!</b>\n` +
    `${BRAND.divider}\n` +
    `${BRAND.leaf} <b>${esc(BRAND.name)}</b> onlayn doʻkoniga xush kelibsiz!\n` +
    `${BRAND.spark} <i>Yangi mahsulotlar, qulay yetkazib berish va bonus ball.</i>\n\n` +
    `📋 <b>Hisobotlar</b>\n` +
    `Doʻkonda xarid, toʻlov, nasiya yoki qaytarish boʻlsa — shu yerga qisqa hisobot keladi (summa va qarz qoldigʻi).\n\n` +
    `<code>v${esc(BOT_RUNTIME_VERSION)}</code>`;
  await safeReplyHTML(ctx, greetingText, await mainMenuKeyboardAsync(ctx));
  await safeReplyHTML(
    ctx,
    `${BRAND.spark} <b>Tezkor amallar</b>\n${BRAND.softDivider}\nKerakli boʻlimni tanlang:`,
    Markup.inlineKeyboard([
      [Markup.button.webApp("🛍  Doʻkonni ochish", webAppUrl)],
      [
        Markup.button.callback('📦 Buyurtmalarim', 'orders_recent'),
        Markup.button.callback('🎁 Kartam', 'my_card'),
      ],
      [
        Markup.button.callback('🔎 Qidiruv', 'search_start'),
        Markup.button.callback('📞 Bogʻlanish', 'contact_info'),
      ],
    ]),
  );
});

bot.action('register_start', async (ctx) => {
  await ctx.answerCbQuery();
  await startRegistrationFlow(ctx);
});

bot.action('orders_recent', async (ctx) => {
  await ctx.answerCbQuery();
  await sendRecentOrders(ctx, 5);
});

bot.action('search_start', async (ctx) => {
  await ctx.answerCbQuery();
  if (!(await ensureRegisteredOrStart(ctx, { forceStart: true }))) return;
  const tgId = ctx.from?.id;
  if (tgId != null) searchState.set(tgId, { step: 'query' });
  await safeReplyHTML(
    ctx,
    `🔎 <b>Mahsulot qidiruv</b>\n${BRAND.softDivider}\n` +
      `Qidiruv soʻzini yuboring (masalan: <i>kabel, avtod, sku123</i>).\n` +
      `${BRAND.spark} Bekor qilish: <code>/cancel_search</code>`,
    Markup.removeKeyboard(),
  );
});

bot.action(/^oc:(\d+)$/, async (ctx) => {
  const orderId = Number.parseInt(String(ctx.match?.[1] || ''), 10);
  const tgId = ctx.from?.id;
  if (!Number.isFinite(orderId) || tgId == null) {
    await ctx.answerCbQuery("Buyurtma ID xato", { show_alert: true });
    return;
  }
  try {
    await callBotApi(`/orders/${tgId}/${orderId}/cancel`, { method: 'POST', body: JSON.stringify({}) });
    await ctx.answerCbQuery('Bekor qilindi');
    await safeReply(ctx, `✅ Buyurtma #${orderId} bekor qilindi.`);
    await sendRecentOrders(ctx, 5);
  } catch (e) {
    await ctx.answerCbQuery("Bekor qilib bo'lmadi", { show_alert: true });
    await safeReply(ctx, `❌ Buyurtma bekor qilinmadi (#${orderId}).\n(${e.message})`);
  }
});

bot.action(/^oe:(\d+)$/, async (ctx) => {
  const orderId = Number.parseInt(String(ctx.match?.[1] || ''), 10);
  const tgId = ctx.from?.id;
  if (!Number.isFinite(orderId) || tgId == null) {
    await ctx.answerCbQuery("Buyurtma ID xato", { show_alert: true });
    return;
  }
  pendingOrderAddressEdit.set(tgId, orderId);
  await ctx.answerCbQuery('Yangi manzil yuboring');
  await safeReply(
    ctx,
    `Buyurtma #${orderId} uchun yangi manzilni yuboring.\n\nBekor qilish uchun: /cancel_edit`,
  );
});

bot.action('my_card', async (ctx) => {
  await ctx.answerCbQuery();
  await sendCard(ctx);
});

bot.action('courier_ready', async (ctx) => {
  await ctx.answerCbQuery();
  await sendCourierOrders(ctx, 'ready');
});

bot.action('courier_active', async (ctx) => {
  await ctx.answerCbQuery();
  await sendCourierOrders(ctx, 'out_for_delivery');
});

bot.action('admin_panel', async (ctx) => {
  await ctx.answerCbQuery();
  await sendAdminPanel(ctx);
});

bot.action('admin_summary', async (ctx) => {
  await ctx.answerCbQuery();
  try {
    await sendAdminSummary(ctx);
  } catch (e) {
    await safeReply(ctx, `Admin statistika olinmadi.\n(${e.message})`);
  }
});

bot.action('admin_reports', async (ctx) => {
  await ctx.answerCbQuery();
  await safeReplyHTML(
    ctx,
    `📈 <b>Hisobotlar</b>\n${BRAND.divider}\n${BRAND.bullet} Kerakli hisobotni tanlang:`,
    adminReportsKeyboard(),
  );
});

bot.action('admin_hisobot', async (ctx) => {
  await ctx.answerCbQuery();
  await sendAdminHisobotMenu(ctx);
});

bot.action(
  new RegExp(
    `^${REPORT_CALLBACK_PREFIX}(daily|ai|dead_stock|debt|profit|marketing|assortiment|assortment)$`,
  ),
  async (ctx) => {
    const kind = matchReportKindFromCallback(ctx.callbackQuery?.data);
    await ctx.answerCbQuery();
    if (!kind) {
      await safeReply(ctx, 'Nomaʼlum hisobot.');
      return;
    }
    await sendAdminStoreReport(ctx, kind);
  },
);

bot.action(new RegExp(`^${CREDIT_REMIND_CALLBACK_PREFIX}`), async (ctx) => {
  const customerId = matchCreditRemindCustomerId(ctx.callbackQuery?.data);
  if (!isAdminUser(ctx)) {
    await ctx.answerCbQuery('Faqat admin', { show_alert: true });
    return;
  }
  if (!customerId) {
    await ctx.answerCbQuery('Mijoz ID xato', { show_alert: true });
    return;
  }
  if (tooFrequent(ctx)) {
    await ctx.answerCbQuery('Biroz kuting…');
    return;
  }
  try {
    await ctx.answerCbQuery('Eslatma yuborilmoqda…');
    const out = await callBotAdminCreditRemind({
      actorTelegramId: ctx.from?.id,
      customerId,
    });
    if (out?.ok) {
      await safeReply(
        ctx,
        `✅ Eslatma yuborildi${out.channel ? ` (${out.channel})` : ''}.`,
      );
    } else {
      await safeReply(ctx, `❌ Eslatma yuborilmadi.\n(${out?.message || out?.error || 'xato'})`);
    }
  } catch (e) {
    try {
      await ctx.answerCbQuery('Xato', { show_alert: true });
    } catch {
      // ignore
    }
    await safeReply(ctx, `❌ Eslatma yuborilmadi.\n(${e.message})`);
  }
});

bot.action(/^admin_report:(today_sales|out_stock|low_stock|top_products|credit_sales)$/, async (ctx) => {
  const reportType = String(ctx.match?.[1] || '');
  await ctx.answerCbQuery();
  try {
    await sendAdminReport(ctx, reportType);
  } catch (e) {
    await safeReply(ctx, `Hisobot olinmadi.\n(${e.message})`);
  }
});

bot.action(/^admin_orders:(new|paid|processing|ready|out_for_delivery|delivered|cancelled|open)$/, async (ctx) => {
  const status = String(ctx.match?.[1] || 'new');
  await ctx.answerCbQuery();
  try {
    await sendAdminOrders(ctx, status);
  } catch (e) {
    await safeReply(ctx, `Admin buyurtmalar olinmadi.\n(${e.message})`);
  }
});

bot.action(/^admin_order:(\d+)$/, async (ctx) => {
  const orderId = Number.parseInt(String(ctx.match?.[1] || ''), 10);
  const tgId = ctx.from?.id;
  if (!Number.isFinite(orderId) || tgId == null || !isAdminUser(ctx)) {
    await ctx.answerCbQuery('Faqat admin uchun', { show_alert: true });
    return;
  }
  try {
    const detail = await callBotApi(`/admin/orders/${orderId}?actor_telegram_id=${tgId}`);
    const order = detail?.order || {};
    await ctx.answerCbQuery(`#${orderId}`);
    await safeReplyHTML(
      ctx,
      `🛠 <b>Admin boshqaruv</b>\n${BRAND.divider}\n${formatCourierOrderBrief(order)}`,
      buildAdminStatusKeyboard(orderId, order.status, detail?.allowed_next),
    );
  } catch (e) {
    await ctx.answerCbQuery("Buyurtma ochilmadi", { show_alert: true });
    await safeReply(ctx, `❌ #${orderId} buyurtma ochilmadi.\n(${e.message})`);
  }
});

bot.action('admin_couriers', async (ctx) => {
  await ctx.answerCbQuery();
  try {
    await sendAdminCouriers(ctx);
  } catch (e) {
    await safeReply(ctx, `Kuryerlar ro'yxatini olib bo'lmadi.\n(${e.message})`);
  }
});

bot.action('admin_courier_add', async (ctx) => {
  await ctx.answerCbQuery();
  if (!isAdminUser(ctx)) {
    await safeReply(ctx, 'Bu bo‘lim faqat admin uchun.');
    return;
  }
  adminState.set(ctx.from.id, { step: 'courier_add' });
  await safeReply(
    ctx,
    "Kuryerni yuboring:\n\n@TOHIR3 Ism Familiya\nyoki\n123456789 Ism Familiya\n\nBekor qilish: /cancel_admin",
    Markup.removeKeyboard(),
  );
});

bot.action(/^admin_courier_active:(\d+):(0|1)$/, async (ctx) => {
  const courierId = Number.parseInt(String(ctx.match?.[1] || ''), 10);
  const active = String(ctx.match?.[2]) === '1';
  try {
    const actorTelegramId = ctx.from?.id;
    if (!isAdminUser(ctx) || actorTelegramId == null) {
      await ctx.answerCbQuery('Faqat admin uchun', { show_alert: true });
      return;
    }
    await callBotAdminCourierActive({ actorTelegramId, courierId, active });
    await ctx.answerCbQuery(active ? 'Aktiv qilindi' : 'Noaktiv qilindi');
    await sendAdminCouriers(ctx);
  } catch (e) {
    await ctx.answerCbQuery('Kuryer holatini o‘zgartirib bo‘lmadi', { show_alert: true });
    await safeReply(ctx, `❌ Kuryer yangilanmadi.\n(${e.message})`);
  }
});

bot.action(/^co_accept:(\d+)$/, async (ctx) => {
  const orderId = Number.parseInt(String(ctx.match?.[1] || ''), 10);
  try {
    await updateCourierOrderStatus(ctx, orderId, 'out_for_delivery');
  } catch (e) {
    await ctx.answerCbQuery("Buyurtmani qabul qilib bo'lmadi", { show_alert: true });
    await safeReply(ctx, `❌ #${orderId} qabul qilinmadi.\n(${e.message})`);
  }
});

bot.action(/^co_done:(\d+)$/, async (ctx) => {
  const orderId = Number.parseInt(String(ctx.match?.[1] || ''), 10);
  try {
    await updateCourierOrderStatus(ctx, orderId, 'delivered');
  } catch (e) {
    await ctx.answerCbQuery("Yetkazildi qilishda xatolik", { show_alert: true });
    await safeReply(ctx, `❌ #${orderId} yetkazildi qilinmadi.\n(${e.message})`);
  }
});

bot.action(/^ol:(web|pos):(\d+)$/, async (ctx) => {
  const source = String(ctx.match?.[1] || 'web');
  const page = Number.parseInt(String(ctx.match?.[2] || '1'), 10) || 1;
  await ctx.answerCbQuery();
  await sendOrdersPage(ctx, source, page);
});

bot.action(/^oas:(\d+):(new|paid|processing|ready|out_for_delivery|delivered|cancelled)$/, async (ctx) => {
  const orderId = Number.parseInt(String(ctx.match?.[1] || ''), 10);
  const status = String(ctx.match?.[2] || '').toLowerCase();
  const tgId = ctx.from?.id;
  if (!Number.isFinite(orderId) || !status || tgId == null) {
    await ctx.answerCbQuery("Noto'g'ri so'rov", { show_alert: true });
    return;
  }
  try {
    await callBotAdminOrderStatus({ actorTelegramId: tgId, orderId, status });
    const refreshed = await callBotApi(`/admin/orders/${orderId}?actor_telegram_id=${tgId}`);
    const order = refreshed?.order || {};
    const keyboard = buildAdminStatusKeyboard(orderId, order.status, refreshed?.allowed_next);
    const statusLabel = {
      new: 'Yangi',
      paid: 'Kassaga tushdi',
      processing: "Yig'ilmoqda",
      ready: 'Tayyor',
      out_for_delivery: "Yo'lda",
      delivered: 'Yetkazildi',
      cancelled: 'Bekor',
    }[String(order.status || status).toLowerCase()] || String(order.status || status);
    const editedText =
      `🛠 <b>Admin boshqaruv</b>\n` +
      `${BRAND.divider}\n` +
      `🆔 ID: <code>#${orderId}</code>\n` +
      `📦 Buyurtma: <code>${esc(order.order_number || '—')}</code>\n` +
      `${BRAND.softDivider}\n` +
      `Holat: <b>${esc(statusLabel)}</b>`;
    await ctx.answerCbQuery(`Status: ${status}`);
    try {
      const replyMarkup =
        keyboard && keyboard.reply_markup ? keyboard.reply_markup : undefined;
      await ctx.editMessageText(editedText, {
        parse_mode: 'HTML',
        reply_markup: replyMarkup,
      });
    } catch {
      await safeReplyHTML(
        ctx,
        `✅ <b>#${orderId}</b> holati: <b>${esc(order.status || status)}</b>\n` +
          `📦 Buyurtma: <code>${esc(order.order_number || '—')}</code>`,
        keyboard,
      );
    }
  } catch (e) {
    await ctx.answerCbQuery("Holatni yangilab bo'lmadi", { show_alert: true });
    await safeReply(ctx, `❌ #${orderId} holati yangilanmadi.\n(${e.message})`);
  }
});

bot.action('contact_info', async (ctx) => {
  await ctx.answerCbQuery();
  await safeReplyHTML(
    ctx,
    `📞 <b>Bogʻlanish</b>\n${BRAND.softDivider}\n${esc(contactText)}`,
  );
});

bot.hears(MENU.shop, async (ctx) => {
  await sendShopOpen(ctx);
});

bot.command('shop', async (ctx) => {
  await sendShopOpen(ctx);
});

bot.hears(MENU.search, async (ctx) => {
  if (!(await ensureRegisteredOrStart(ctx, { forceStart: true }))) return;
  const tgId = ctx.from?.id;
  if (tgId != null) searchState.set(tgId, { step: 'query' });
  await safeReplyHTML(
    ctx,
    `🔎 <b>Mahsulot qidiruv</b>\n${BRAND.softDivider}\n` +
      `Qidiruv soʻzini yuboring (masalan: <i>kabel, avtod, sku123</i>).\n` +
      `${BRAND.spark} Bekor qilish: <code>/cancel_search</code>`,
    Markup.removeKeyboard(),
  );
});

bot.hears(MENU.orders, async (ctx) => {
  if (!(await ensureRegisteredOrStart(ctx, { forceStart: true }))) return;
  await sendRecentOrders(ctx, 10);
  await sendOrdersPage(ctx, 'web', 1);
});

bot.hears(MENU.card, async (ctx) => {
  if (!(await ensureRegisteredOrStart(ctx, { forceStart: true }))) return;
  await sendCard(ctx);
});

bot.hears(MENU.contact, async (ctx) => {
  await safeReplyHTML(
    ctx,
    `📞 <b>Bogʻlanish</b>\n${BRAND.softDivider}\n${esc(contactText)}`,
  );
});

bot.hears(MENU.courier, async (ctx) => {
  await sendCourierPanel(ctx);
});

bot.hears(MENU.admin, async (ctx) => {
  await sendAdminPanel(ctx);
});

bot.hears(MENU.hisobot, async (ctx) => {
  await sendAdminHisobotMenu(ctx);
});

bot.hears(
  new RegExp(
    `^(${Object.values(REPORT_MENU)
      .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('|')})$`,
  ),
  async (ctx) => {
    const kind = matchReportKindFromText(ctx.message?.text);
    if (!kind) return;
    await sendAdminStoreReport(ctx, kind);
  },
);

bot.command('courier', async (ctx) => {
  await sendCourierPanel(ctx);
});

bot.command('admin', async (ctx) => {
  await sendAdminPanel(ctx);
});

bot.command('hisobot', async (ctx) => {
  await sendAdminHisobotMenu(ctx);
});

bot.command(['tahlil', 'ai'], async (ctx) => {
  await sendAdminStoreReport(ctx, 'ai');
});

bot.command(['marketing', 'assortiment'], async (ctx) => {
  await sendAdminStoreReport(ctx, 'marketing');
});

bot.hears(MENU.help, async (ctx) => {
  await sendHelp(ctx);
});

bot.command('orders', async (ctx) => {
  if (!(await ensureRegisteredOrStart(ctx, { forceStart: true }))) return;
  await sendRecentOrders(ctx, 10);
  await sendOrdersPage(ctx, 'web', 1);
});

bot.command('card', async (ctx) => {
  if (!(await ensureRegisteredOrStart(ctx, { forceStart: true }))) return;
  await sendCard(ctx);
});

bot.command('help', async (ctx) => {
  await sendHelp(ctx);
});

bot.command('search', async (ctx) => {
  if (!(await ensureRegisteredOrStart(ctx, { forceStart: true }))) return;
  const raw = String(ctx.message?.text || '');
  const q = raw.replace(/^\/search(@\w+)?/i, '').trim();
  if (!q) {
    const tgId = ctx.from?.id;
    if (tgId != null) searchState.set(tgId, { step: 'query' });
    await safeReply(ctx, "Qidiruv so‘zini yuboring:", Markup.removeKeyboard());
    return;
  }
  await runCatalogSearch(ctx, q);
});

bot.command('cancel_edit', async (ctx) => {
  const tgId = ctx.from?.id;
  if (tgId == null) return;
  pendingOrderAddressEdit.delete(tgId);
  await safeReply(ctx, "Tahrirlash holati bekor qilindi.");
});

bot.command('cancel_register', async (ctx) => {
  const tgId = ctx.from?.id;
  if (tgId == null) return;
  resetRegistrationState(tgId);
  await safeReply(ctx, "Ro'yxatdan o'tish bekor qilindi.", await mainMenuKeyboardAsync(ctx));
});

bot.command('cancel_search', async (ctx) => {
  const tgId = ctx.from?.id;
  if (tgId == null) return;
  searchState.delete(tgId);
  await safeReply(ctx, 'Qidiruv bekor qilindi.', await mainMenuKeyboardAsync(ctx));
});

bot.command('cancel_admin', async (ctx) => {
  const tgId = ctx.from?.id;
  if (tgId == null) return;
  adminState.delete(tgId);
  await safeReply(ctx, 'Admin amal bekor qilindi.', await mainMenuKeyboardAsync(ctx));
});

bot.on('contact', async (ctx) => {
  try {
    const tgId = ctx.from?.id;
    if (tgId == null) return;
    const reg = registrationState.get(tgId);
    if (reg?.step === 'phone') {
      const phone = ctx.message?.contact?.phone_number || null;
      const contactUserId = ctx.message?.contact?.user_id;
      if (contactUserId != null && contactUserId !== tgId) {
        await safeReply(ctx, 'Faqat o‘z telefoningizni yuboring.');
        return;
      }
      const firstName = normalizedTelegramName(ctx.from, 'first_name');
      const lastName = normalizedTelegramName(ctx.from, 'last_name');
      const out = await callBotApi(`/registration/${tgId}/complete`, {
        method: 'POST',
        body: JSON.stringify({
          first_name: firstName,
          last_name: lastName,
          phone,
        }),
      });
      resetRegistrationState(tgId);
      await safeReplyHTML(
        ctx,
        `✅ <b>Roʻyxatdan oʻtdingiz!</b>\n${BRAND.softDivider}\n` +
          `${BRAND.bullet} Xush kelibsiz, <b>${esc(out?.data?.first_name || '')}</b>.\n` +
          `${BRAND.spark} <i>Endi xaridlardan bonus ball yigʻa olasiz.</i>\n\n` +
          `📋 <b>Hisobotlar ulandi</b>\n` +
          `Doʻkonda sotib olsangiz, pul bersangiz yoki nasiya olsangiz — shu botga qisqa hisobot keladi.`,
        await mainMenuKeyboardAsync(ctx),
      );
      await sendLoyaltyQrCard(ctx, out?.data || {});
      return;
    }
    const phone = ctx.message?.contact?.phone_number || null;
    const contactUserId = ctx.message?.contact?.user_id;
    if (contactUserId != null && contactUserId !== tgId) {
      await safeReply(ctx, 'Faqat o‘z telefoningizni yuboring.');
      return;
    }
    await callBotApi(`/profile/${tgId}`, {
      method: 'POST',
      body: JSON.stringify({ phone }),
    });
    await safeReply(ctx, "Telefoningiz saqlandi. Rahmat!");
  } catch (e) {
    await safeReply(ctx, `Telefonni saqlab bo'lmadi (${e.message})`);
  }
});

bot.on('location', async (ctx) => {
  try {
    const tgId = ctx.from?.id;
    if (tgId == null) return;
    const lat = ctx.message?.location?.latitude;
    const lng = ctx.message?.location?.longitude;
    if (lat == null || lng == null) return;
    const address = `Lokatsiya: ${lat}, ${lng}`;
    await callBotApi(`/profile/${tgId}`, {
      method: 'POST',
      body: JSON.stringify({ address }),
    });
    await safeReply(ctx, "Lokatsiya saqlandi. Yetkazib berishni tezlashtiramiz.");
  } catch (e) {
    await safeReply(ctx, `Lokatsiyani saqlab bo'lmadi (${e.message})`);
  }
});

bot.on('text', async (ctx, next) => {
  const t = String(ctx.message?.text || '');
  const tgId = ctx.from?.id;
  const reg = tgId != null ? registrationState.get(tgId) : null;
  const search = tgId != null ? searchState.get(tgId) : null;
  const admin = tgId != null ? adminState.get(tgId) : null;
  if (admin && !t.startsWith('/')) {
    if (admin.step === 'courier_add') {
      try {
        const payload = parseCourierInput(t);
        const out = await callBotAdminCourierUpsert({ actorTelegramId: tgId, payload });
        adminState.delete(tgId);
        const c = out?.courier || {};
        await safeReply(
          ctx,
          `✅ Kuryer saqlandi\nUsername: ${c.username ? '@' + c.username : '-'}\nTelegram ID: ${c.telegram_id || '-'}\nIsm: ${c.display_name || '-'}`,
          await mainMenuKeyboardAsync(ctx),
        );
        await sendAdminCouriers(ctx);
      } catch (e) {
        await safeReply(ctx, `❌ Kuryer qo'shilmadi.\n(${e.message})`);
      }
      return;
    }
  }
  if (reg && !t.startsWith('/')) {
    if (reg.step === 'phone') {
      await safeReply(ctx, "Telefonni tugma orqali yuboring: 📱 Telefonni yuborish");
      return;
    }
  }
  if (search?.step === 'query' && !t.startsWith('/')) {
    await runCatalogSearch(ctx, t);
    return;
  }
  if (tgId != null && pendingOrderAddressEdit.has(tgId) && !t.startsWith('/')) {
    const orderId = pendingOrderAddressEdit.get(tgId);
    try {
      await callBotApi(`/orders/${tgId}/${orderId}/update`, {
        method: 'POST',
        body: JSON.stringify({ delivery_address: t }),
      });
      pendingOrderAddressEdit.delete(tgId);
      await safeReply(ctx, `✅ Buyurtma #${orderId} manzili yangilandi.`);
      await sendRecentOrders(ctx, 5);
    } catch (e) {
      await safeReply(ctx, `❌ Manzilni yangilab bo'lmadi (#${orderId}).\n(${e.message})`);
    }
    return;
  }
  if (t.startsWith('/')) {
    // Strip @BotUsername so /marketing@MyBot still matches known commands.
    const cmd = t.slice(1).split(/[\s@]/)[0].toLowerCase();
    if (
      ![
        'start',
        'search',
        'orders',
        'card',
        'courier',
        'admin',
        'hisobot',
        'tahlil',
        'ai',
        'marketing',
        'assortiment',
        'help',
        'cancel_edit',
        'cancel_register',
        'cancel_search',
        'cancel_admin',
      ].includes(cmd)
    ) {
      await safeReply(ctx, "Buyruq topilmadi. /help ni bosing.");
      return;
    }
  }
  return next();
});

bot.catch((err, ctx) => {
  console.error('[telegram:bot] error', err, ctx?.update);
});

function logNetworkError(prefix, err) {
  console.error(prefix);
  console.error('  xabar:', err?.message || String(err));
  let c = err?.cause;
  let n = 0;
  while (c && n < 4) {
    console.error('  sabab:', c?.message || String(c), c?.code ? `(code: ${c.code})` : '');
    c = c.cause;
    n += 1;
  }
  if (err?.code) console.error('  errno/code:', err.code);
  console.error(
    '  Tekshiring: internet, DNS, antivirus/firewall (api.telegram.org), provayder Telegram ni bloklamayaptimi — kerak bo‘lsa VPN.',
  );
  console.error('  Qo‘lda: curl https://api.telegram.org yoki brauzerda shu manzil.');
}

async function startWebhookMode() {
  if (!webhookBase || !webhookBase.startsWith('https://')) {
    throw new Error('webhook_base_url_invalid');
  }
  let express;
  try {
    express = require('express');
  } catch {
    throw new Error('express_missing_for_webhook_mode');
  }
  const app = express();
  app.use(express.json({ limit: '512kb' }));
  app.use(webhookPath, bot.webhookCallback(webhookPath));
  app.get('/health', (_req, res) => res.json({ ok: true, service: 'telegram-bot-webhook' }));
  await new Promise((resolve, reject) => {
    const srv = app.listen(webhookPort, () => resolve(srv));
    srv.on('error', reject);
  });
  const webhookUrl = `${webhookBase.replace(/\/$/, '')}${webhookPath.startsWith('/') ? webhookPath : `/${webhookPath}`}`;
  await bot.telegram.setWebhook(webhookUrl, webhookSecret ? { secret_token: webhookSecret } : undefined);
}

bot.use(async (ctx, next) => {
  try {
    const db = require('../public-api/lib/db.cjs').getDb();
    db.exec(`
      CREATE TABLE IF NOT EXISTS marketplace_bot_audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_type TEXT NOT NULL,
        actor_telegram_id INTEGER NULL,
        target_telegram_id INTEGER NULL,
        payload_json TEXT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    const text = ctx.message?.text ? String(ctx.message.text).slice(0, 160) : null;
    db.prepare(
      `INSERT INTO marketplace_bot_audit (event_type, actor_telegram_id, target_telegram_id, payload_json) VALUES (?, ?, ?, ?)`,
    ).run('incoming_update', ctx.from?.id ?? null, ctx.from?.id ?? null, JSON.stringify({ text }));
  } catch {
    // audit failures should never break bot flow
  }
  return next();
});

async function configureBotMenu() {
  await bot.telegram
    .setMyCommands([
      { command: 'start', description: "Bot menyusini ochish" },
      { command: 'search', description: "Mahsulot qidirish" },
      { command: 'orders', description: "So'nggi buyurtmalar" },
      { command: 'card', description: 'Nakopitel karta va ball' },
      { command: 'courier', description: 'Kuryer panel' },
      { command: 'admin', description: 'Admin panel' },
      { command: 'hisobot', description: 'Admin: kunlik / AI / haftalik / qarz / marketing' },
      { command: 'tahlil', description: 'Admin: AI tahlil' },
      { command: 'marketing', description: 'Admin: Marketing tavsiya' },
      { command: 'help', description: "Yordam va ko'rsatma" },
      { command: 'cancel_edit', description: 'Buyurtma tahririni bekor qilish' },
      { command: 'cancel_register', description: "Ro'yxatdan o'tishni bekor qilish" },
      { command: 'cancel_search', description: 'Qidiruv bekor qilish' },
      { command: 'cancel_admin', description: 'Admin amalni bekor qilish' },
    ])
    .catch(() => {});
  await bot.telegram
    .setChatMenuButton({
      menu_button: {
        type: 'web_app',
        text: "🛍 Do'kon",
        web_app: { url: webAppUrl },
      },
    })
    .catch(() => {});
}

function handleBootError(err) {
  const code = err?.response?.error_code;
  if (code === 409) {
    console.error(
      '[telegram:bot] 409 Conflict: shu bot boshqa joyda ham ishlayapti (yana bir terminal, Cursor fon, yoki boshqa PC).',
    );
    console.error('  Hammasini to‘xtating: boshqa terminalda Ctrl+C, Task Manager → node.exe, keyin qayta: npm run telegram:bot');
  } else if (err?.response?.description) {
    console.error('[telegram:bot] API:', err.response.description);
  } else {
    logNetworkError('[telegram:bot] Telegram serveriga ulanib bo‘lmadi (getMe):', err);
  }
  process.exit(1);
}

async function boot() {
  // Prove token works before launch; helps diagnose silent /start failures.
  try {
    const me = await bot.telegram.getMe();
    console.log(
      `[telegram:bot] getMe OK @${me.username || '?'} id=${me.id} admins=${adminIds().size} api=${publicApiUrl}`,
    );
  } catch (e) {
    handleBootError(e);
    return;
  }

  await configureBotMenu();
  if (botMode === 'webhook') {
    try {
      await startWebhookMode();
      console.log(`[telegram:bot] webhook mode active on :${webhookPort} ${webhookPath}`);
      return;
    } catch (e) {
      console.warn(`[telegram:bot] webhook start failed (${e.message}), polling fallback...`);
    }
  }

  // Clear any stale webhook so polling is the only consumer (avoids 409 / silent /start).
  try {
    await bot.telegram.deleteWebhook({ drop_pending_updates: true });
  } catch (e) {
    console.warn('[telegram:bot] deleteWebhook:', e?.message || e);
  }

  // launch() resolves only on stop — do not await (see telegram/staffBot.cjs).
  void bot
    .launch({ dropPendingUpdates: true })
    .then(() => {
      console.log('[telegram:bot] polling stopped');
    })
    .catch(handleBootError);
  console.log(
    `[telegram:bot] running (polling) — /start javob berishi kerak. Ctrl+C bilan to‘xtating`,
  );
}

boot().catch(handleBootError);

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

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
};

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
  if (isCourierUser(ctx)) rows.push([MENU.courier]);
  if (isAdminUser(ctx)) rows.push([MENU.admin]);
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
    return `🔎 "${queryText}" bo‘yicha mahsulot topilmadi.\nBoshqa kalit so‘z bilan urinib ko‘ring.`;
  }
  const lines = rows.map((r, i) => {
    const price = Number(r.price_uzs || 0).toLocaleString('uz-UZ');
    const stock = r.is_available ? '✅ mavjud' : '⛔ yo‘q';
    const sku = r.sku ? ` | SKU: ${r.sku}` : '';
    return `${i + 1}. ${r.name}\n   ${price} so'm | ${stock}${sku}`;
  });
  return `🔎 "${queryText}" bo‘yicha topildi (${rows.length}):\n\n${lines.join('\n\n')}`;
}

async function runCatalogSearch(ctx, queryText) {
  const q = String(queryText || '').trim();
  if (q.length < 2) {
    await safeReply(ctx, "Qidiruv so‘zi kamida 2 ta belgi bo‘lsin.");
    return;
  }
  const payload = await callPublicApi(`/v1/products?limit=8&sort=name&q=${encodeURIComponent(q)}`);
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  await safeReply(
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

function formatOrdersMessage(rows) {
  if (!rows.length) {
    return "Hozircha onlayn buyurtmalar yo'q.";
  }
  const lines = rows.map((r, i) => {
    const sum = Number(r.total_amount) || 0;
    const d = r.created_at ? String(r.created_at).replace('T', ' ').slice(0, 16) : '';
    return `${i + 1}. ${r.order_number} — ${r.status} (${r.payment_status || 'pending'}) — ${sum.toLocaleString('uz-UZ')} so'm\n   ${d}`;
  });
  return "So'nggi buyurtmalar:\n\n" + lines.join('\n\n');
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
  const src = source === 'pos' ? 'POS' : 'Onlayn';
  const meta = pagePayload?.meta || {};
  const rows = Array.isArray(pagePayload?.rows) ? pagePayload.rows : [];
  const page = Number(meta.page || 1);
  const totalPages = Number(meta.total_pages || 1);
  const total = Number(meta.total || rows.length || 0);
  if (!rows.length) {
    return `📄 ${src} buyurtmalar\nSahifa: ${page}/${totalPages}\nJami: ${total}\n\nBuyurtmalar topilmadi.`;
  }
  const lines = rows.map((r, i) => {
    const sum = Number(r.total_amount) || 0;
    const d = r.created_at ? String(r.created_at).replace('T', ' ').slice(0, 16) : '';
    return `${i + 1}. ${r.order_number} — ${r.status} (${r.payment_status || 'pending'}) — ${sum.toLocaleString('uz-UZ')} so'm\n   ${d}`;
  });
  return `📄 ${src} buyurtmalar\nSahifa: ${page}/${totalPages}\nJami: ${total}\n\n${lines.join('\n\n')}`;
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
  const sum = Number(order.total_amount || 0).toLocaleString('uz-UZ');
  const customer = [order.first_name, order.last_name].filter(Boolean).join(' ') || 'Mijoz';
  const extraPhone = noteValue(order.note, "Qo'shimcha telefon");
  const mapUrl = mapUrlFromText(noteValue(order.note, 'Xarita'), noteValue(order.note, 'Lokatsiya'), order.delivery_address, order.note);
  const lines = [
    `#${order.id} ${order.order_number}`,
    `Mijoz: ${customer}`,
  ];
  if (order.phone) lines.push(`Tel: ${order.phone}`);
  if (extraPhone) lines.push(`Qo'shimcha: ${extraPhone}`);
  if (order.delivery_address) lines.push(`Manzil: ${order.delivery_address}`);
  if (mapUrl) lines.push(`Xarita: ${mapUrl}`);
  lines.push(`To'lov: ${[order.payment_method, order.payment_status].filter(Boolean).join(' / ') || '-'}`);
  lines.push(`Summa: ${sum} so'm`);
  return lines.join('\n');
}

function formatCourierOrderDetail(payload) {
  const order = payload?.order || {};
  const items = Array.isArray(payload?.items) ? payload.items : [];
  const lines = ['🚚 Kuryer buyurtmasi', '', formatCourierOrderBrief(order), '', 'Mahsulotlar:'];
  if (items.length) {
    for (const item of items) {
      const qty = Number(item.quantity || 0) || 0;
      const price = Number(item.price_at_order || 0) || 0;
      lines.push(`- ${item.product_name || item.product_id} x${qty} = ${(qty * price).toLocaleString('uz-UZ')} so'm`);
    }
  } else {
    lines.push('- Mahsulotlar topilmadi');
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
  if (!rows.length) return "Kuryerlar ro'yxati bo'sh.";
  const lines = rows.map((c, i) => {
    const name = c.display_name || c.username || c.telegram_id || `#${c.id}`;
    const username = c.username ? `@${c.username}` : '-';
    const tg = c.telegram_id || '-';
    const active = Number(c.active) ? 'aktiv' : 'noaktiv';
    return `${i + 1}. ${name}\n   Username: ${username} | ID: ${tg} | ${active}`;
  });
  return `Kuryerlar:\n\n${lines.join('\n\n')}`;
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
    await safeReply(ctx, 'Bu bo‘lim faqat admin uchun.');
    return;
  }
  await safeReply(
    ctx,
    '🛠 Admin panel\nBuyurtmalar, kuryerlar va bugungi holatni boshqaring.',
    adminPanelKeyboard(),
  );
}

async function sendAdminSummary(ctx) {
  if (!isAdminUser(ctx)) {
    await safeReply(ctx, 'Bu bo‘lim faqat admin uchun.');
    return;
  }
  const actorTelegramId = ctx.from?.id;
  const out = await callBotAdminSummary(actorTelegramId);
  await safeReply(ctx, formatAdminSummary(out), adminPanelKeyboard());
}

async function sendAdminOrders(ctx, status = 'new') {
  if (!isAdminUser(ctx)) {
    await safeReply(ctx, 'Bu bo‘lim faqat admin uchun.');
    return;
  }
  const safeStatus = String(status || 'new').toLowerCase();
  const actorTelegramId = ctx.from?.id;
  const out = await callBotAdminOrders({ actorTelegramId, status: safeStatus });
  const rows = Array.isArray(out?.rows) ? out.rows : [];
  await safeReply(ctx, formatAdminOrders(out?.status || safeStatus, rows), adminOrdersKeyboard(rows, out?.status || safeStatus));
}

async function sendAdminReport(ctx, reportType) {
  if (!isAdminUser(ctx)) {
    await safeReply(ctx, 'Bu bo‘lim faqat admin uchun.');
    return;
  }
  const actorTelegramId = ctx.from?.id;
  const out = await callBotAdminReport({ actorTelegramId, reportType });
  await safeReply(ctx, formatAdminReport(out), adminReportsKeyboard());
}

async function sendAdminCouriers(ctx) {
  if (!isAdminUser(ctx)) {
    await safeReply(ctx, 'Bu bo‘lim faqat admin uchun.');
    return;
  }
  const actorTelegramId = ctx.from?.id;
  const out = await callBotAdminCouriersList(actorTelegramId);
  const rows = Array.isArray(out?.rows) ? out.rows : [];
  await safeReply(ctx, formatCouriersMessage(rows), couriersKeyboard(rows));
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
    await safeReply(ctx, "Bu bo'lim faqat kuryerlar uchun.");
    return;
  }
  await safeReply(
    ctx,
    '🚚 Kuryer panel\nTayyor buyurtmalarni oling yoki yo‘ldagi buyurtmalarni ko‘ring.',
    Markup.inlineKeyboard([
      [Markup.button.callback('📦 Tayyor buyurtmalar', 'courier_ready')],
      [Markup.button.callback("🚚 Yo'ldagi buyurtmalar", 'courier_active')],
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
    await safeReply(ctx, status === 'ready' ? "Tayyor buyurtmalar yo'q." : "Yo'ldagi buyurtmalar yo'q.");
    return;
  }
  for (const order of rows.slice(0, 10)) {
    await safeReply(ctx, formatCourierOrderBrief(order), courierOrderKeyboard(order));
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
  await safeReply(ctx, formatCourierOrderDetail(detail), courierOrderKeyboard(detail?.order || { id: orderId, status: out.status }));
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
    [Markup.button.callback('🆕 Yangi', 'admin_orders:new'), Markup.button.callback('💳 To‘langan', 'admin_orders:paid')],
    [Markup.button.callback("🧺 Yig'ilmoqda", 'admin_orders:processing'), Markup.button.callback('✅ Tayyor', 'admin_orders:ready')],
    [Markup.button.callback("🚚 Yo'ldagi", 'admin_orders:out_for_delivery'), Markup.button.callback('📂 Ochiq hammasi', 'admin_orders:open')],
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
        .map((r) => `• ${r.status}: ${Number(r.count || 0)} ta — ${Number(r.amount || 0).toLocaleString('uz-UZ')} so'm`)
        .join('\n')
    : '• Bugun buyurtma yo‘q';
  return (
    `📊 Admin panel — bugungi holat\n\n` +
    `Sana: ${data?.date || '-'}\n` +
    `Bugun: ${Number(today.count || 0)} ta — ${Number(today.amount || 0).toLocaleString('uz-UZ')} so'm\n` +
    `Ochiq buyurtmalar: ${Number(open.count || 0)} ta — ${Number(open.amount || 0).toLocaleString('uz-UZ')} so'm\n` +
    `Telegram mijozlar: ${Number(customers.telegram_count || 0)} ta\n\n` +
    `Holatlar:\n${statusText}`
  );
}

function formatAdminReport(data) {
  const type = String(data?.report_type || '');
  const date = data?.date || '-';
  if (type === 'today_sales') {
    const pos = data?.pos || {};
    const web = data?.web || {};
    const payments = Array.isArray(data?.payments) ? data.payments : [];
    const paymentLines = payments.length
      ? payments
          .map((p) => `• ${p.payment_status || '-'}: ${Number(p.count || 0)} ta — ${Number(p.amount || 0).toLocaleString('uz-UZ')} so'm`)
          .join('\n')
      : '• To‘lov holatlari yo‘q';
    return (
      `💰 Bugungi sotuv\nSana: ${date}\n\n` +
      `POS: ${Number(pos.count || 0)} ta — ${Number(pos.amount || 0).toLocaleString('uz-UZ')} so'm\n` +
      `Tushum: ${Number(pos.paid_amount || 0).toLocaleString('uz-UZ')} so'm\n` +
      `Qarzga: ${Number(pos.credit_amount || 0).toLocaleString('uz-UZ')} so'm\n` +
      `Onlayn to‘langan/yakunlangan: ${Number(web.count || 0)} ta — ${Number(web.amount || 0).toLocaleString('uz-UZ')} so'm\n` +
      `(Onlayn qator POS tushumiga qo‘shilmagan, alohida ko‘rsatildi.)\n\n` +
      `To‘lovlar:\n${paymentLines}`
    );
  }

  if (type === 'out_stock' || type === 'low_stock') {
    const rows = Array.isArray(data?.rows) ? data.rows : [];
    const title = type === 'out_stock' ? '⛔ Tugagan mahsulotlar' : '⚠️ Kam qolgan mahsulotlar';
    if (!rows.length) return `${title}\n\nMahsulot topilmadi.`;
    return (
      `${title}\nSana: ${date}\n\n` +
      rows
        .slice(0, 20)
        .map((r, i) => {
          const stock = Number(r.current_stock || 0).toLocaleString('uz-UZ');
          const min = Number(r.min_stock_level || 0).toLocaleString('uz-UZ');
          return `${i + 1}. ${r.name || r.id}\n   SKU: ${r.sku || '-'} | Qoldiq: ${stock} | Min: ${min}`;
        })
        .join('\n\n')
    );
  }

  if (type === 'top_products') {
    const rows = Array.isArray(data?.rows) ? data.rows : [];
    if (!rows.length) return `🔥 Eng ko‘p sotilganlar\n\nBugun sotuv topilmadi.`;
    return (
      `🔥 Eng ko‘p sotilganlar\nSana: ${date}\nPOS sotuvlari + hali POSga o‘tmagan to‘langan onlayn buyurtmalar\n\n` +
      rows
        .map((r, i) => `${i + 1}. ${r.product_name || r.product_id}\n   Miqdor: ${Number(r.sold_qty || 0).toLocaleString('uz-UZ')} | Summa: ${Number(r.amount || 0).toLocaleString('uz-UZ')} so'm`)
        .join('\n\n')
    );
  }

  const rows = Array.isArray(data?.rows) ? data.rows : [];
  if (!rows.length) return `💳 Nasiya / qarz sotuvlar\n\nBugun qarzga sotuv topilmadi.`;
  return (
    `💳 Nasiya / qarz sotuvlar\nSana: ${date}\nJami qarz: ${Number(data?.total_credit || 0).toLocaleString('uz-UZ')} so'm\n\n` +
    rows
      .map((r, i) => `${i + 1}. ${r.order_number || r.id}\n   ${r.customer_name || 'Mijoz'} | ${Number(r.credit_amount || 0).toLocaleString('uz-UZ')} so'm | ${String(r.created_at || '').slice(0, 16)}`)
      .join('\n\n')
  );
}

function formatAdminOrders(status, rows) {
  const label = {
    new: 'Yangi',
    paid: 'To‘langan',
    processing: "Yig'ilmoqda",
    ready: 'Tayyor',
    out_for_delivery: "Yo'ldagi",
    delivered: 'Yetkazilgan',
    cancelled: 'Bekor qilingan',
    open: 'Ochiq buyurtmalar',
  }[status] || status;
  if (!rows.length) return `📦 ${label}\n\nBuyurtma topilmadi.`;
  return `📦 ${label}\n\n${rows.map((o, i) => `${i + 1}. ${formatCourierOrderBrief(o)}`).join('\n\n')}`;
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
  const phone = c.phone || "Telefon qo'shilmagan";
  const addr = c.address || "Manzil qo'shilmagan";
  const posBalance = Number(pos.balance || 0);
  const accountStatus =
    posBalance < 0
      ? `Qarz: ${Math.abs(posBalance).toLocaleString('uz-UZ')} so'm`
      : posBalance > 0
        ? `Haq: ${posBalance.toLocaleString('uz-UZ')} so'm`
        : "Hisob: 0 so'm";
  const loyaltyCardCode = String(binding.loyalty_card_code || '').trim();
  const ledgerRows = Array.isArray(loyalty.ledger) ? loyalty.ledger.slice(0, 5) : [];
  const formatOrderLine = (r, i) => {
    const sum = Number(r.total_amount) || 0;
    const d = r.created_at ? String(r.created_at).replace('T', ' ').slice(0, 16) : '';
    return `${i + 1}. ${r.order_number} — ${r.status} (${r.payment_status || 'pending'}) — ${sum.toLocaleString('uz-UZ')} so'm ${d}`;
  };
  const webOrdersText = webOrders.length
    ? '\n\nOnlayn buyurtmalar:\n' + webOrders.slice(0, 12).map((r, i) => formatOrderLine(r, i)).join('\n')
    : '\n\nOnlayn buyurtmalar: yo‘q';
  const posOrdersText = posOrders.length
    ? '\n\nPOS buyurtmalar:\n' + posOrders.slice(0, 12).map((r, i) => formatOrderLine(r, i)).join('\n')
    : '\n\nPOS buyurtmalar: yo‘q';
  const ledgerText = ledgerRows.length
    ? '\n\nOxirgi bonus harakatlar:\n' +
      ledgerRows
        .map((r) => {
          const sign = Number(r.points_delta) > 0 ? '+' : '';
          const dt = r.created_at ? String(r.created_at).replace('T', ' ').slice(0, 16) : '';
          return `• ${sign}${Number(r.points_delta)} (${r.type}) ${dt}`;
        })
        .join('\n')
    : '';
  return (
    `🎁 Nakopitel karta\n\n` +
    `Ism: ${fullName}\n` +
    `Telefon: ${phone}\n` +
    `Manzil: ${addr}\n` +
    `Karta kodi: ${loyaltyCardCode || "yo'q"}\n` +
    `${accountStatus}\n` +
    `Onlayn buyurtmalar soni: ${webOrdersTotal}\n` +
    `POS buyurtmalar soni: ${posOrdersTotal}\n` +
    `Ball balans: ${points}\n` +
    `Keyingi maqsad: ${nextGoal} (yana ${toNext} ball)` +
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
  await safeReply(
    ctx,
    "Ro'yxatdan o'tish uchun telefon raqamingizni yuboring:",
    registrationContactKeyboard(),
  );
}

async function sendLoyaltyQrCard(ctx, payload) {
  try {
    const text = String(payload?.qr_payload || '').trim();
    if (!text) return;
    const customerName = [payload.first_name, payload.last_name].filter(Boolean).join(' ') || 'Mijoz';
    const qrBuffer = await QRCode.toBuffer(text, { width: 700, margin: 2 });
    await ctx.replyWithPhoto(
      { source: qrBuffer },
      {
        caption:
          `🎁 Nakopitel karta ochildi\n` +
          `Karta kodi: ${payload.loyalty_card_code}\n` +
          `Mijoz: ${customerName}\n` +
          `Telefon: ${payload.phone}`,
      },
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
    await safeReply(ctx, formatOrdersMessage(out.rows || []), buildOrdersActionsKeyboard(out.rows || []) || undefined);
  } catch (e) {
    await safeReply(ctx, `Buyurtmalarni olib bo'lmadi. Keyinroq urinib ko'ring.\n(${e.message})`);
  }
}

async function sendCard(ctx) {
  const tgId = ctx.from?.id;
  if (tgId == null) return;
  if (tooFrequent(ctx)) return;
  try {
    const out = await callBotApi(`/profile/${tgId}`);
    await safeReply(ctx, formatCardMessage(out), Markup.keyboard([
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
    await safeReply(ctx, text, keyboard);
  } catch (e) {
    await safeReply(ctx, `Buyurtmalarni olib bo'lmadi.\n(${e.message})`);
  }
}

bot.start(async (ctx) => {
  const name = ctx.from?.first_name || '';
  const registered = await ensureRegisteredOrStart(ctx);
  if (!registered) {
    await ctx.reply(
      `Assalomu alaykum${name ? ', ' + name : ''}!\n\nDavom etish uchun ro'yxatdan o'ting.`,
      Markup.inlineKeyboard([[Markup.button.callback("✅ Ro'yxatdan o'tish", 'register_start')]]),
    );
    return;
  }
  resetRegistrationState(ctx.from?.id);
  const showCourier = await isCourierUserAsync(ctx);
  await ctx.reply(
    `Assalomu alaykum${name ? ', ' + name : ''}!\n\nDunyoZamin onlayn do'koniga xush kelibsiz.\n\nBot versiya: ${BOT_RUNTIME_VERSION}`,
    showCourier || isAdminUser(ctx) ? Markup.keyboard([
      [MENU.shop, MENU.search],
      [MENU.orders, MENU.card],
      [MENU.contact],
      ...(showCourier ? [[MENU.courier]] : []),
      ...(isAdminUser(ctx) ? [[MENU.admin]] : []),
      [MENU.help],
    ]).resize() : mainMenuKeyboard(ctx),
  );
  await ctx.reply(
    "Quyidagi tugmalardan foydalaning:",
    Markup.inlineKeyboard([
      [Markup.button.webApp("🛍 Do'kon", webAppUrl)],
      [Markup.button.callback('📦 Buyurtmalarim', 'orders_recent')],
      [Markup.button.callback('🎁 Kartam', 'my_card')],
      [Markup.button.callback('📞 Bog\'lanish', 'contact_info')],
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
  await safeReply(
    ctx,
    "Qidiruv so‘zini yuboring (masalan: kabel, avtod, sku123).\nBekor qilish: /cancel_search",
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
  await safeReply(ctx, '📈 Hisobotlar\nKerakli hisobotni tanlang:', adminReportsKeyboard());
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
    await safeReply(
      ctx,
      `🛠 Admin boshqaruv\n\n${formatCourierOrderBrief(order)}`,
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
      `🛠 Admin boshqaruv\n` +
      `ID: #${orderId}\n` +
      `Buyurtma: ${order.order_number || '-'}\n` +
      `Holat: ${statusLabel}`;
    await ctx.answerCbQuery(`Status: ${status}`);
    try {
      const replyMarkup =
        keyboard && keyboard.reply_markup ? keyboard.reply_markup : undefined;
      await ctx.editMessageText(editedText, {
        reply_markup: replyMarkup,
      });
    } catch {
      await safeReply(
        ctx,
        `✅ #${orderId} holati: ${order.status || status}\nBuyurtma: ${order.order_number || '-'}`,
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
  await ctx.reply(contactText);
});

bot.hears(MENU.shop, async (ctx) => {
  if (!(await ensureRegisteredOrStart(ctx, { forceStart: true }))) return;
  await ctx.reply(
    "Mini App'ni ochish uchun tugmani bosing:",
    Markup.inlineKeyboard([[Markup.button.webApp(MENU.shop, webAppUrl)]]),
  );
});

bot.hears(MENU.search, async (ctx) => {
  if (!(await ensureRegisteredOrStart(ctx, { forceStart: true }))) return;
  const tgId = ctx.from?.id;
  if (tgId != null) searchState.set(tgId, { step: 'query' });
  await safeReply(
    ctx,
    "Qidiruv so‘zini yuboring (masalan: kabel, avtod, sku123).\nBekor qilish: /cancel_search",
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
  await safeReply(ctx, contactText);
});

bot.hears(MENU.courier, async (ctx) => {
  await sendCourierPanel(ctx);
});

bot.hears(MENU.admin, async (ctx) => {
  await sendAdminPanel(ctx);
});

bot.command('courier', async (ctx) => {
  await sendCourierPanel(ctx);
});

bot.command('admin', async (ctx) => {
  await sendAdminPanel(ctx);
});

bot.hears(MENU.help, async (ctx) => {
  await ctx.reply(
    "Yordam:\n" +
      `- ${MENU.shop}: onlayn do'konni ochadi\n` +
      `- ${MENU.search}: mahsulot qidiradi\n` +
      `- ${MENU.orders}: so'nggi buyurtmalaringiz\n` +
      `- ${MENU.card}: nakopitel karta va ball\n` +
      `- ${MENU.contact}: aloqa ma'lumotlari\n\n` +
      `- ${MENU.courier}: kuryer panel\n\n` +
      `- ${MENU.admin}: admin panel\n\n` +
      "Qo'shimcha: /start, /search, /orders, /card, /courier, /admin",
  );
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
  await safeReply(
    ctx,
    `Buyruqlar:\n/start\n/search <matn>\n/orders\n/card\n/courier\n/admin\n/help\n/cancel_edit\n/cancel_register\n/cancel_search\n/cancel_admin\n\nWeb App: ${webAppUrl}`,
    mainMenuKeyboard(ctx),
  );
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
  await safeReply(ctx, "Ro'yxatdan o'tish bekor qilindi.", mainMenuKeyboard(ctx));
});

bot.command('cancel_search', async (ctx) => {
  const tgId = ctx.from?.id;
  if (tgId == null) return;
  searchState.delete(tgId);
  await safeReply(ctx, 'Qidiruv bekor qilindi.', mainMenuKeyboard(ctx));
});

bot.command('cancel_admin', async (ctx) => {
  const tgId = ctx.from?.id;
  if (tgId == null) return;
  adminState.delete(tgId);
  await safeReply(ctx, 'Admin amal bekor qilindi.', mainMenuKeyboard(ctx));
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
      await safeReply(
        ctx,
        `✅ Ro'yxatdan o'tdingiz!\nXush kelibsiz, ${out?.data?.first_name || ''}.`,
        mainMenuKeyboard(ctx),
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
          mainMenuKeyboard(ctx),
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
    const cmd = t.slice(1).split(' ')[0].toLowerCase();
    if (!['start', 'search', 'orders', 'card', 'courier', 'admin', 'help', 'cancel_edit', 'cancel_register', 'cancel_search', 'cancel_admin'].includes(cmd)) {
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

async function startPollingMode() {
  await bot.launch({ dropPendingUpdates: true });
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

async function boot() {
  if (botMode === 'webhook') {
    try {
      await startWebhookMode();
      console.log(`[telegram:bot] webhook mode active on :${webhookPort} ${webhookPath}`);
      return;
    } catch (e) {
      console.warn(`[telegram:bot] webhook start failed (${e.message}), polling fallback...`);
      await startPollingMode();
      return;
    }
  }
  await startPollingMode();
}

boot()
  .then(async () => {
    await bot.telegram.setMyCommands([
      { command: 'start', description: "Bot menyusini ochish" },
      { command: 'search', description: "Mahsulot qidirish" },
      { command: 'orders', description: "So'nggi buyurtmalar" },
      { command: 'card', description: 'Nakopitel karta va ball' },
      { command: 'courier', description: 'Kuryer panel' },
      { command: 'admin', description: 'Admin panel' },
      { command: 'help', description: "Yordam va ko'rsatma" },
      { command: 'cancel_edit', description: 'Buyurtma tahririni bekor qilish' },
      { command: 'cancel_register', description: "Ro'yxatdan o'tishni bekor qilish" },
      { command: 'cancel_search', description: 'Qidiruvni bekor qilish' },
      { command: 'cancel_admin', description: 'Admin amalni bekor qilish' },
    ]).catch(() => {});
    await bot.telegram.setChatMenuButton({
      menu_button: {
        type: 'web_app',
        text: "🛍 Do'kon",
        web_app: { url: webAppUrl },
      },
    }).catch(() => {});
    console.log(`[telegram:bot] running (${botMode}) — Ctrl+C bilan to‘xtating`);
  })
  .catch((err) => {
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
  });

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

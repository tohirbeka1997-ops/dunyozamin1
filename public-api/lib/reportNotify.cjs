'use strict';

/**
 * Telegram business reports (internal only).
 * Channel: settings reports.telegram.chat_id → TELEGRAM_REPORTS_CHAT_ID → TELEGRAM_ADMIN_IDS.
 * Never falls back to TELEGRAM_MARKETING_CHANNEL_ID (customer News channel).
 */

const SettingsService = require('../../electron/services/settingsService.cjs');
const { sendTelegramText } = require('./telegramNotify.cjs');
const { tryAcquireSchedulerLock } = require('./schedulerLock.cjs');

const LOCK_NAME = 'telegram_reports_digest';
const EVENT_CREDIT_SALE = 'credit_sale';
const EVENT_SHIFT_CLOSED = 'shift_closed';
const EVENT_DAILY_DIGEST = 'daily_digest';
const EVENT_BALANCE_CHANGE = 'balance_change';
const EVENT_TEST = 'test';

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
    // ignore — digest still best-effort
  }
}

function toBool(v, fallback = false) {
  if (v === undefined || v === null || v === '') return fallback;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  const s = String(v).toLowerCase().trim();
  if (s === '1' || s === 'true' || s === 'yes' || s === 'on') return true;
  if (s === '0' || s === 'false' || s === 'no' || s === 'off') return false;
  return fallback;
}

function normalizeScheduleTime(raw) {
  const s = String(raw || '').trim();
  const m = /^(\d{1,2}):(\d{1,2})$/.exec(s);
  if (!m) return '21:00';
  const hh = Math.min(23, Math.max(0, Number(m[1])));
  const mm = Math.min(59, Math.max(0, Number(m[2])));
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function formatSumma(amount) {
  return Math.round(Number(amount) || 0).toLocaleString('uz-UZ');
}

function hasTable(db, name) {
  try {
    return !!db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(name);
  } catch {
    return false;
  }
}

function getReportTelegramSettings(db) {
  return {
    enabled: toBool(readSetting(db, 'reports.telegram.enabled', false), false),
    chatId: String(readSetting(db, 'reports.telegram.chat_id', '') || '').trim(),
    creditSale: toBool(readSetting(db, 'reports.telegram.credit_sale', true), true),
    shiftClosed: toBool(readSetting(db, 'reports.telegram.shift_closed', true), true),
    dailyDigest: toBool(readSetting(db, 'reports.telegram.daily_digest', true), true),
    balanceChange: toBool(readSetting(db, 'reports.telegram.balance_change', true), true),
    scheduleTime: normalizeScheduleTime(readSetting(db, 'reports.telegram.schedule_time', '21:00')),
    lastRunDate: String(readSetting(db, 'reports.telegram.last_run_date', '') || '').slice(0, 10),
    storeName: String(
      readSetting(db, 'company_name', '') || readSetting(db, 'company.name', '') || "Do'kon",
    ).trim(),
  };
}

function parseChatIdList(raw) {
  return String(raw || '')
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      if (/^-?\d+$/.test(s)) return Number.parseInt(s, 10);
      return s;
    })
    .filter((id) => id !== '' && id != null && !(typeof id === 'number' && !Number.isFinite(id)));
}

/** @typedef {'settings'|'reports_env'|'admin_ids'|null} ReportChatSource */

function marketingChatIdSet() {
  return new Set(
    parseChatIdList(process.env.TELEGRAM_MARKETING_CHANNEL_ID || '').map((id) => String(id)),
  );
}

function excludeMarketingChats(chatIds) {
  const blocked = marketingChatIdSet();
  if (!blocked.size) return chatIds;
  return (chatIds || []).filter((id) => !blocked.has(String(id)));
}

/**
 * Resolve report destination (chat IDs + bot token + source).
 * Never uses TELEGRAM_MARKETING_CHANNEL_ID.
 * @returns {{ chatIds: Array<string|number>, botToken: string, source: ReportChatSource }}
 */
function resolveReportDestination(db, options = {}) {
  const settings = getReportTelegramSettings(db);
  /** @type {ReportChatSource} */
  let source = null;
  let chatIds = [];

  if (settings.chatId) {
    chatIds = parseChatIdList(settings.chatId);
    source = 'settings';
  } else {
    const envChat = String(process.env.TELEGRAM_REPORTS_CHAT_ID || '').trim();
    if (envChat) {
      chatIds = parseChatIdList(envChat);
      source = 'reports_env';
    } else {
      chatIds = parseChatIdList(process.env.TELEGRAM_ADMIN_IDS || '');
      if (chatIds.length) source = 'admin_ids';
    }
  }

  chatIds = excludeMarketingChats(chatIds);
  if (!chatIds.length) source = null;

  let botToken = String(options.botToken || '').trim();
  if (!botToken) {
    const reportsBot = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
    botToken = reportsBot;
  }

  return { chatIds, botToken, source };
}

/**
 * Resolve destination chat IDs for business reports.
 * Priority: DB setting → TELEGRAM_REPORTS_CHAT_ID → TELEGRAM_ADMIN_IDS
 */
function resolveReportChatIds(db) {
  return resolveReportDestination(db).chatIds;
}

function resolveBotToken(options = {}, db = null) {
  if (options.botToken) {
    return String(options.botToken).trim();
  }
  if (db) {
    return resolveReportDestination(db, options).botToken;
  }
  return String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
}

function isEventEnabled(settings, eventKey) {
  if (!settings.enabled && eventKey !== EVENT_TEST) return false;
  if (eventKey === EVENT_CREDIT_SALE) return settings.creditSale;
  if (eventKey === EVENT_SHIFT_CLOSED) return settings.shiftClosed;
  if (eventKey === EVENT_DAILY_DIGEST) return settings.dailyDigest;
  if (eventKey === EVENT_BALANCE_CHANGE) return settings.balanceChange;
  if (eventKey === EVENT_TEST) return true;
  return false;
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

async function sendToReportChats(db, text, options = {}) {
  const dest = resolveReportDestination(db, options);
  const botToken = options.botToken ? String(options.botToken).trim() : dest.botToken;
  const chatIds = Array.isArray(options.chatIds) ? options.chatIds : dest.chatIds;
  if (!botToken) return { ok: false, sent: 0, failed: 0, reason: 'no_bot_token' };
  if (!chatIds.length) return { ok: false, sent: 0, failed: 0, reason: 'no_chat_id' };

  const parseMode = options.parseMode || options.parse_mode || null;
  const replyMarkup = options.replyMarkup || options.reply_markup || null;
  let sent = 0;
  let failed = 0;
  let lastReason = null;
  for (const chatId of chatIds) {
    // eslint-disable-next-line no-await-in-loop
    let out = await sendTelegramText({
      botToken,
      telegramId: chatId,
      text,
      parseMode,
      replyMarkup,
    });
    // If HTML/Markdown is rejected, retry once as plain text so reports still land.
    if (!out?.ok && parseMode) {
      // eslint-disable-next-line no-await-in-loop
      out = await sendTelegramText({ botToken, telegramId: chatId, text, replyMarkup });
    }
    if (out?.ok) sent += 1;
    else {
      failed += 1;
      lastReason = out?.reason || 'send_failed';
    }
  }
  return {
    ok: failed === 0 && sent > 0,
    sent,
    failed,
    // Keep reason when any send failed (partial success) so UI is not "unknown"
    reason: failed === 0 ? null : lastReason || 'send_failed',
  };
}

function buildCreditSaleText(payload = {}, storeName = "Do'kon") {
  const lines = [
    '💳 Nasiya sotuv',
    storeName ? `Do'kon: ${storeName}` : null,
    payload.orderNumber ? `Buyurtma: ${payload.orderNumber}` : null,
    payload.customerName ? `Mijoz: ${payload.customerName}` : null,
    `Summa: ${formatSumma(payload.creditAmount)} so'm`,
    payload.dueDate ? `Muddat: ${String(payload.dueDate).slice(0, 10)}` : null,
    payload.cashierName ? `Kassir: ${payload.cashierName}` : null,
  ].filter(Boolean);
  return lines.join('\n');
}

function buildShiftClosedText(payload = {}, storeName = "Do'kon") {
  const diff = Number(payload.cashDifference || 0) || 0;
  const diffLabel = diff === 0 ? '0' : `${diff > 0 ? '+' : ''}${formatSumma(diff)}`;
  const lines = [
    '🧾 Smena yopildi',
    storeName ? `Do'kon: ${storeName}` : null,
    payload.cashierName ? `Kassir: ${payload.cashierName}` : null,
    `Tushum: ${formatSumma(payload.totalPayments)} so'm`,
    `Naqd (sotuv): ${formatSumma(payload.cashPayments)} so'm`,
    `Kutilgan naqd: ${formatSumma(payload.expectedCash)} so'm`,
    `Yopilish naqdi: ${formatSumma(payload.closingCash)} so'm`,
    `Farq: ${diffLabel} so'm`,
    payload.creditDebtIssued != null
      ? `Nasiya berildi: ${formatSumma(payload.creditDebtIssued)} so'm`
      : null,
    payload.orderCount != null ? `Buyurtmalar: ${payload.orderCount}` : null,
  ].filter(Boolean);
  return lines.join('\n');
}

function buildDailyDigestText(summary = {}, storeName = "Do'kon") {
  const date = summary.date || new Date().toISOString().slice(0, 10);
  const lines = [
    `📊 Kunlik hisobot — ${date}`,
    storeName ? `Do'kon: ${storeName}` : null,
    `Savdo: ${formatSumma(summary.totalSales)} so'm (${summary.orderCount || 0} ta)`,
    `Naqd: ${formatSumma(summary.cashTotal)} | Karta: ${formatSumma(summary.cardTotal)} | Nasiya: ${formatSumma(summary.creditTotal)}`,
    summary.netProfit != null ? `Foyda (taxmin): ${formatSumma(summary.netProfit)} so'm` : null,
    `Xarajat: ${formatSumma(summary.expensesTotal)} so'm`,
    `Mijoz qarzi (jami): ${formatSumma(summary.customerDebtTotal)} so'm`,
  ].filter(Boolean);
  return lines.join('\n');
}

function loadCreditSalePayload(db, orderId) {
  const id = String(orderId || '').trim();
  if (!id) return null;
  try {
    const row = db
      .prepare(
        `
        SELECT o.id, o.order_number, o.credit_amount, o.due_date, o.cashier_id, o.user_id,
               c.name AS customer_name,
               u.full_name AS cashier_name, u.username AS cashier_username
        FROM orders o
        LEFT JOIN customers c ON c.id = o.customer_id
        LEFT JOIN users u ON u.id = COALESCE(o.cashier_id, o.user_id)
        WHERE o.id = ?
      `,
      )
      .get(id);
    if (!row) return null;
    const credit = Number(row.credit_amount || 0) || 0;
    if (credit <= 0) return null;
    return {
      orderId: row.id,
      orderNumber: row.order_number,
      creditAmount: credit,
      dueDate: row.due_date || null,
      customerName: row.customer_name || null,
      cashierName: row.cashier_name || row.cashier_username || null,
    };
  } catch {
    return null;
  }
}

async function notifyCreditSale(db, payloadOrOrderId, options = {}) {
  const settings = getReportTelegramSettings(db);
  if (!isEventEnabled(settings, EVENT_CREDIT_SALE)) {
    return { ok: false, skipped: true, reason: 'disabled' };
  }
  const payload =
    typeof payloadOrOrderId === 'string' || typeof payloadOrOrderId === 'number'
      ? loadCreditSalePayload(db, payloadOrOrderId)
      : payloadOrOrderId;
  if (!payload || !(Number(payload.creditAmount || 0) > 0)) {
    return { ok: false, skipped: true, reason: 'not_credit_sale' };
  }
  const refId = String(payload.orderId || payload.order_id || payload.orderNumber || '').trim();
  if (refId && !options.force && hasTable(db, 'report_notify_log')) {
    try {
      const existing = db
        .prepare(`SELECT 1 AS x FROM report_notify_log WHERE event_key = ? AND ref_id = ?`)
        .get(EVENT_CREDIT_SALE, refId);
      if (existing) return { ok: false, skipped: true, reason: 'already_sent' };
    } catch {
      // ignore
    }
  }
  const text = buildCreditSaleText(payload, settings.storeName);
  const out = await sendToReportChats(db, text, options);
  if ((out.ok || out.sent > 0) && refId) {
    claimNotifyDedup(db, EVENT_CREDIT_SALE, refId);
  }
  return out;
}

async function notifyShiftClosed(db, payload = {}, options = {}) {
  const settings = getReportTelegramSettings(db);
  if (!isEventEnabled(settings, EVENT_SHIFT_CLOSED)) {
    return { ok: false, skipped: true, reason: 'disabled' };
  }
  const shiftId = String(payload.shiftId || payload.shift_id || '').trim();
  if (shiftId && !options.force && hasTable(db, 'report_notify_log')) {
    try {
      const existing = db
        .prepare(`SELECT 1 AS x FROM report_notify_log WHERE event_key = ? AND ref_id = ?`)
        .get(EVENT_SHIFT_CLOSED, shiftId);
      if (existing) return { ok: false, skipped: true, reason: 'already_sent' };
    } catch {
      // ignore
    }
  }

  let enriched = { ...payload };
  if (shiftId && !enriched.cashierName) {
    try {
      const row = db
        .prepare(
          `
          SELECT s.id, u.full_name, u.username,
                 (SELECT COUNT(*) FROM orders o
                  WHERE o.shift_id = s.id
                    AND LOWER(TRIM(COALESCE(o.status,''))) IN ('completed','paid','done')) AS order_count
          FROM shifts s
          LEFT JOIN users u ON u.id = COALESCE(s.closed_by, s.user_id, s.cashier_id)
          WHERE s.id = ?
        `,
        )
        .get(shiftId);
      if (row) {
        enriched = {
          ...enriched,
          cashierName: row.full_name || row.username || enriched.cashierName,
          orderCount: enriched.orderCount != null ? enriched.orderCount : row.order_count,
        };
      }
    } catch {
      // ignore enrichment failures
    }
  }

  const text = buildShiftClosedText(enriched, settings.storeName);
  const out = await sendToReportChats(db, text, options);
  if ((out.ok || out.sent > 0) && shiftId) {
    claimNotifyDedup(db, EVENT_SHIFT_CLOSED, shiftId);
  }
  return out;
}

function localTimeParts(db) {
  const row = db
    .prepare(
      `SELECT date('now', 'localtime') AS d,
              cast(strftime('%H', 'now', 'localtime') AS INTEGER) AS h,
              cast(strftime('%M', 'now', 'localtime') AS INTEGER) AS m`,
    )
    .get();
  return {
    date: row?.d || new Date().toISOString().slice(0, 10),
    hour: Number(row?.h) || 0,
    minute: Number(row?.m) || 0,
  };
}

function shouldRunDailyDigest(db, settings, options = {}) {
  if (options.force) return { ok: true, reason: 'forced', today: localTimeParts(db).date };
  const parts = localTimeParts(db);
  const [sh, sm] = String(settings.scheduleTime || '21:00')
    .split(':')
    .map((x) => Number(x));
  const scheduleMinutes = (Number.isFinite(sh) ? sh : 21) * 60 + (Number.isFinite(sm) ? sm : 0);
  const nowMinutes = parts.hour * 60 + parts.minute;
  if (nowMinutes < scheduleMinutes) {
    return { ok: false, reason: 'before_schedule', today: parts.date };
  }
  if (String(settings.lastRunDate || '').slice(0, 10) === parts.date) {
    return { ok: false, reason: 'already_ran_today', today: parts.date };
  }
  return { ok: true, reason: 'due', today: parts.date };
}

function sumTodayExpenses(db, ymd) {
  if (!hasTable(db, 'expenses')) return 0;
  try {
    const row = db
      .prepare(
        `SELECT COALESCE(SUM(amount), 0) AS s FROM expenses
         WHERE date(expense_date) = date(?)`,
      )
      .get(ymd);
    return Number(row?.s || 0) || 0;
  } catch {
    return 0;
  }
}

function sumCustomerDebt(db) {
  if (!hasTable(db, 'customers')) return 0;
  try {
    const row = db
      .prepare(
        `SELECT COALESCE(SUM(CASE WHEN balance < 0 THEN -balance ELSE 0 END), 0) AS s
         FROM customers`,
      )
      .get();
    return Number(row?.s || 0) || 0;
  } catch {
    return 0;
  }
}

function buildDailyDigestSummary(db, ymd) {
  let daily = {
    total_sales: 0,
    order_count: 0,
    cash_total: 0,
    card_total: 0,
    credit_total: 0,
    net_profit: null,
  };
  try {
    const ReportsService = require('../../electron/services/reportsService.cjs');
    const reports = new ReportsService(db);
    daily = reports.getDailySales(ymd) || daily;
  } catch {
    // reportsService may fail in minimal test DBs
  }
  return {
    date: ymd,
    totalSales: Number(daily.total_sales || 0) || 0,
    orderCount: Number(daily.order_count || 0) || 0,
    cashTotal: Number(daily.cash_total || 0) || 0,
    cardTotal: Number(daily.card_total || 0) || 0,
    creditTotal: Number(daily.credit_total || 0) || 0,
    netProfit: daily.net_profit != null ? Number(daily.net_profit) || 0 : null,
    expensesTotal: sumTodayExpenses(db, ymd),
    customerDebtTotal: sumCustomerDebt(db),
  };
}

async function runDailyDigestTick(db, options = {}) {
  const settings = getReportTelegramSettings(db);
  if (!isEventEnabled(settings, EVENT_DAILY_DIGEST)) {
    return { ok: false, skipped: true, reason: 'disabled' };
  }

  // Kechki paket: daily is merged into AI tick — skip separate digest when AI is on.
  try {
    const eveningPackage = toBool(readSetting(db, 'reports.telegram.evening_package', false), false);
    const aiEnabled = toBool(readSetting(db, 'reports.telegram.ai_enabled', false), false);
    if (eveningPackage && aiEnabled && !options.force && !options.allowWhenEveningPackage) {
      return { ok: false, skipped: true, reason: 'merged_into_evening_package' };
    }
  } catch {
    // continue with separate digest
  }

  const gate = shouldRunDailyDigest(db, settings, options);
  if (!gate.ok) {
    return { ok: false, skipped: true, reason: gate.reason, today: gate.today };
  }

  if (!options.skipLock) {
    const owner = tryAcquireSchedulerLock(db, {
      name: LOCK_NAME,
      ttlMs: options.lockTtlMs || 120_000,
    });
    if (!owner) {
      return { ok: false, skipped: true, reason: 'lock_held', today: gate.today };
    }
  }

  const summary = buildDailyDigestSummary(db, gate.today);
  const text = buildDailyDigestText(summary, settings.storeName);
  const out = await sendToReportChats(db, text, options);
  if (out.ok || out.sent > 0) {
    writeSetting(db, 'reports.telegram.last_run_date', gate.today, 'string');
    if (hasTable(db, 'report_notify_log')) {
      claimNotifyDedup(db, EVENT_DAILY_DIGEST, gate.today);
    }
  }
  return { ...out, today: gate.today, summary };
}

const NO_CHAT_ID_HINT =
  'Set reports.telegram.chat_id, TELEGRAM_REPORTS_CHAT_ID, or TELEGRAM_ADMIN_IDS (not the News/marketing channel)';

async function sendTestReport(db, options = {}) {
  const settings = getReportTelegramSettings(db);
  const dest = resolveReportDestination(db, options);
  const { chatIds, botToken } = dest;
  if (!botToken) return { ok: false, reason: 'no_bot_token' };
  if (!chatIds.length) {
    return {
      ok: false,
      reason: 'no_chat_id',
      hint: NO_CHAT_ID_HINT,
    };
  }
  const text = [
    '✅ Test: Telegram hisobotlar ulanishi',
    settings.storeName ? `Do'kon: ${settings.storeName}` : null,
    `Vaqt: ${new Date().toISOString().replace('T', ' ').slice(0, 19)} UTC`,
    'Agar bu xabarni ko‘rsangiz, bot va chat ID to‘g‘ri.',
  ]
    .filter(Boolean)
    .join('\n');
  return sendToReportChats(db, text, { ...options, chatIds, botToken });
}

module.exports = {
  EVENT_CREDIT_SALE,
  EVENT_SHIFT_CLOSED,
  EVENT_DAILY_DIGEST,
  EVENT_BALANCE_CHANGE,
  EVENT_TEST,
  LOCK_NAME,
  getReportTelegramSettings,
  resolveReportDestination,
  resolveReportChatIds,
  resolveBotToken,
  NO_CHAT_ID_HINT,
  isEventEnabled,
  buildCreditSaleText,
  buildShiftClosedText,
  buildDailyDigestText,
  buildDailyDigestSummary,
  notifyCreditSale,
  notifyShiftClosed,
  runDailyDigestTick,
  sendTestReport,
  sendToReportChats,
  normalizeScheduleTime,
  toBool,
};

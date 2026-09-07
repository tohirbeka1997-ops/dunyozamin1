'use strict';

/**
 * Telegram business reports (internal only).
 * Channel: settings reports.telegram.chat_id → TELEGRAM_REPORTS_CHAT_ID → TELEGRAM_ADMIN_IDS.
 * Bot: TELEGRAM_REPORTS_BOT_TOKEN → TELEGRAM_BOT_TOKEN (never marketing/staff).
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
const EVENT_DEBT_PAYMENT = 'debt_payment';
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

function paymentMethodLabelUz(raw) {
  const t = String(raw || '')
    .toLowerCase()
    .trim();
  if (!t) return '';
  if (t === 'cash' || t === 'naqd' || t === 'наличные') return 'naqd';
  if (
    t === 'card' ||
    t === 'karta' ||
    t === 'terminal' ||
    t === 'uzcard' ||
    t === 'humo'
  ) {
    return 'karta';
  }
  if (t === 'qr' || t === 'click' || t === 'payme' || t === 'paynet') return 'QR';
  if (t === 'transfer' || t === 'bank' || t === 'p2p') return 'o‘tkazma';
  return t;
}

function formatLocalDateTime(input) {
  if (!input) return '';
  try {
    const {
      UZBEKISTAN_TIMEZONE,
      parseDbTimestamp,
    } = require('../../electron/lib/timezone.cjs');
    const ms = parseDbTimestamp(input) || Date.parse(String(input));
    if (!Number.isFinite(ms) || ms <= 0) return String(input).slice(0, 16);
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: UZBEKISTAN_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(new Date(ms));
    const map = {};
    for (const p of parts) {
      if (p.type !== 'literal') map[p.type] = p.value;
    }
    if (!map.year || !map.month || !map.day) return String(input).slice(0, 16);
    return `${map.year}-${map.month}-${map.day} ${map.hour || '00'}:${map.minute || '00'}`;
  } catch {
    return String(input).replace('T', ' ').slice(0, 16);
  }
}

const DIGEST_LIST_CAP = 5;

function hasTable(db, name) {
  try {
    return !!db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(name);
  } catch {
    return false;
  }
}

function hasColumn(db, table, column) {
  const t = String(table || '').replace(/[^a-zA-Z0-9_]/g, '');
  const c = String(column || '');
  if (!t || !c) return false;
  try {
    const cols = db.prepare(`PRAGMA table_info(${t})`).all() || [];
    return cols.some((row) => row.name === c);
  } catch {
    return false;
  }
}

/** Calendar day in Asia/Tashkent for UTC-stored timestamps (same as reportsService). */
function tzDateExpr(columnExpr) {
  return `date(datetime(replace(replace(${columnExpr}, 'T', ' '), 'Z', ''), '+5 hours'))`;
}

function clipLabel(s, max = 42) {
  const t = String(s || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return '—';
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function movementTypeLabel(raw) {
  const t = String(raw || '')
    .toLowerCase()
    .trim();
  if (t === 'purchase' || t === 'receipt') return 'xarid';
  if (t === 'return' || t === 'sales_return' || t === 'sale_return') return 'qaytarish';
  if (t === 'adjustment' || t === 'adjust') return 'tuzatish';
  if (t === 'transfer' || t === 'move') return 'ko‘chirish';
  if (t === 'audit' || t === 'revision') return 'reviziya';
  if (t === 'sale') return 'sotuv';
  return t || 'boshqa';
}

function getReportTelegramSettings(db) {
  return {
    enabled: toBool(readSetting(db, 'reports.telegram.enabled', false), false),
    chatId: String(readSetting(db, 'reports.telegram.chat_id', '') || '').trim(),
    creditSale: toBool(readSetting(db, 'reports.telegram.credit_sale', true), true),
    shiftClosed: toBool(readSetting(db, 'reports.telegram.shift_closed', true), true),
    dailyDigest: toBool(readSetting(db, 'reports.telegram.daily_digest', true), true),
    balanceChange: toBool(readSetting(db, 'reports.telegram.balance_change', true), true),
    debtPayment: toBool(readSetting(db, 'reports.telegram.debt_payment', true), true),
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
    // Prefer dedicated reports bot (channel admin). Fall back to TELEGRAM_BOT_TOKEN
    // so single-bot installs still work; never use marketing/staff tokens here.
    botToken =
      String(process.env.TELEGRAM_REPORTS_BOT_TOKEN || '').trim() ||
      String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
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
  return (
    String(process.env.TELEGRAM_REPORTS_BOT_TOKEN || '').trim() ||
    String(process.env.TELEGRAM_BOT_TOKEN || '').trim()
  );
}

function isEventEnabled(settings, eventKey) {
  if (!settings.enabled && eventKey !== EVENT_TEST) return false;
  if (eventKey === EVENT_CREDIT_SALE) return settings.creditSale;
  if (eventKey === EVENT_SHIFT_CLOSED) return settings.shiftClosed;
  if (eventKey === EVENT_DAILY_DIGEST) return settings.dailyDigest;
  if (eventKey === EVENT_BALANCE_CHANGE) return settings.balanceChange;
  if (eventKey === EVENT_DEBT_PAYMENT) return settings.debtPayment;
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

function buildDebtPaymentText(payload = {}, storeName = "Do'kon") {
  const amount = payload.amount != null ? payload.amount : payload.appliedAmount;
  const method = paymentMethodLabelUz(payload.paymentMethod || payload.payment_method);
  const remaining =
    payload.remainingDebt != null
      ? payload.remainingDebt
      : payload.new_debt != null
        ? payload.new_debt
        : null;
  const paidAt = payload.paidAt || payload.paid_at || payload.created_at || null;
  const lines = [
    '💵 Qarz to‘lovi',
    storeName ? `Do'kon: ${storeName}` : null,
    payload.customerName || payload.customer_name
      ? `Mijoz: ${payload.customerName || payload.customer_name}`
      : null,
    `Summa: ${formatSumma(amount)} so'm`,
    method ? `To‘lov: ${method}` : null,
    remaining != null ? `Qolgan qarz: ${formatSumma(remaining)} so'm` : null,
    payload.paymentNumber || payload.payment_number
      ? `Hujjat: ${payload.paymentNumber || payload.payment_number}`
      : null,
    payload.cashierName || payload.cashier_name
      ? `Kassir: ${payload.cashierName || payload.cashier_name}`
      : null,
    paidAt ? `Vaqt: ${formatLocalDateTime(paidAt)}` : null,
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

function pushSection(lines, title, totalLine, items, emptyHint, moreCount = 0) {
  lines.push('');
  lines.push(title);
  if (totalLine) lines.push(totalLine);
  const list = Array.isArray(items) ? items : [];
  if (!list.length) {
    if (emptyHint) lines.push(emptyHint);
    return;
  }
  for (const row of list) {
    lines.push(`• ${row}`);
  }
  const more = Number(moreCount) || 0;
  if (more > 0) lines.push(`… va yana ${more} ta`);
}

function buildDailyDigestText(summary = {}, storeName = "Do'kon") {
  const date = summary.date || new Date().toISOString().slice(0, 10);
  const ops = summary.operations || {};
  const lines = [
    `📊 Kunlik hisobot — ${date}`,
    storeName ? `Do'kon: ${storeName}` : null,
    `Savdo: ${formatSumma(summary.totalSales)} so'm (${summary.orderCount || 0} ta)`,
    `Naqd: ${formatSumma(summary.cashTotal)} | Karta: ${formatSumma(summary.cardTotal)} | Nasiya: ${formatSumma(summary.creditTotal)}`,
    summary.netProfit != null ? `Foyda (taxmin): ${formatSumma(summary.netProfit)} so'm` : null,
    `Xarajat: ${formatSumma(summary.expensesTotal)} so'm`,
    `Mijoz qarzi (jami): ${formatSumma(summary.customerDebtTotal)} so'm`,
    `Qarz yig‘ildi: ${formatSumma(
      summary.debtCollected != null
        ? summary.debtCollected
        : (summary.operations && summary.operations.debtPayments
            ? summary.operations.debtPayments.total
            : 0),
    )} so'm`,
  ].filter(Boolean);

  lines.push('');
  lines.push('📋 Bugungi operatsiyalar');

  const exp = ops.expenses || {};
  pushSection(
    lines,
    '💸 Xarajatlar',
    `Jami: ${formatSumma(exp.total != null ? exp.total : summary.expensesTotal)} so'm (${exp.count || 0} ta)`,
    exp.lines || [],
    (exp.count || 0) === 0 ? '• Yo‘q' : null,
    exp.more,
  );

  const credit = ops.creditSales || {};
  pushSection(
    lines,
    '💳 Nasiya sotuvlar',
    `Jami: ${formatSumma(credit.total)} so'm (${credit.count || 0} ta)`,
    credit.lines || [],
    (credit.count || 0) === 0 ? '• Yo‘q' : null,
    credit.more,
  );

  const debtPay = ops.debtPayments || {};
  pushSection(
    lines,
    '💵 Qarz to‘lovlari',
    `Jami: ${formatSumma(debtPay.total)} so'm (${debtPay.count || 0} ta)`,
    debtPay.lines || [],
    (debtPay.count || 0) === 0 ? '• Yo‘q' : null,
    debtPay.more,
  );

  const purchases = ops.purchases || {};
  pushSection(
    lines,
    '📦 Xaridlar / qabul',
    `Jami: ${formatSumma(purchases.total)} so'm (${purchases.count || 0} ta)`,
    purchases.lines || [],
    (purchases.count || 0) === 0 ? '• Yo‘q' : null,
    purchases.more,
  );

  const stock = ops.stockChanges || {};
  pushSection(
    lines,
    '🏭 Ombor o‘zgarishi',
    `${stock.count || 0} ta harakat (sotuvdan tashqari)`,
    stock.lines || [],
    (stock.count || 0) === 0 ? '• Yo‘q' : null,
    stock.more,
  );

  const returns = ops.returns || {};
  pushSection(
    lines,
    '↩️ Sotuv qaytarishlari',
    `Jami: ${formatSumma(returns.total)} so'm (${returns.count || 0} ta)`,
    returns.lines || [],
    (returns.count || 0) === 0 ? '• Yo‘q' : null,
    returns.more,
  );

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

function loadDebtPaymentPayload(db, paymentId) {
  const id = String(paymentId || '').trim();
  if (!id || !hasTable(db, 'customer_payments')) return null;
  try {
    const row = db
      .prepare(
        `
        SELECT cp.id, cp.payment_number, cp.amount, cp.payment_method,
               cp.paid_at, cp.created_at, cp.customer_id,
               c.name AS customer_name,
               u.full_name AS cashier_name, u.username AS cashier_username
        FROM customer_payments cp
        LEFT JOIN customers c ON c.id = cp.customer_id
        LEFT JOIN users u ON u.id = cp.received_by
        WHERE cp.id = ?
      `,
      )
      .get(id);
    if (!row) return null;
    const amount = Number(row.amount || 0) || 0;
    if (amount <= 0) return null;
    let remainingDebt = null;
    if (row.customer_id && hasTable(db, 'customers')) {
      try {
        const bal = db
          .prepare(`SELECT balance FROM customers WHERE id = ?`)
          .get(row.customer_id);
        const b = Number(bal?.balance || 0) || 0;
        remainingDebt = b < 0 ? -b : 0;
      } catch {
        remainingDebt = null;
      }
    }
    return {
      paymentId: row.id,
      paymentNumber: row.payment_number,
      amount,
      paymentMethod: row.payment_method,
      paidAt: row.paid_at || row.created_at,
      customerId: row.customer_id,
      customerName: row.customer_name || null,
      cashierName: row.cashier_name || row.cashier_username || null,
      remainingDebt,
    };
  } catch {
    return null;
  }
}

async function notifyDebtPayment(db, payloadOrPaymentId, options = {}) {
  const settings = getReportTelegramSettings(db);
  if (!isEventEnabled(settings, EVENT_DEBT_PAYMENT)) {
    return { ok: false, skipped: true, reason: 'disabled' };
  }
  const payload =
    typeof payloadOrPaymentId === 'string' || typeof payloadOrPaymentId === 'number'
      ? loadDebtPaymentPayload(db, payloadOrPaymentId)
      : payloadOrPaymentId;
  if (!payload || !(Number(payload.amount || payload.appliedAmount || 0) > 0)) {
    return { ok: false, skipped: true, reason: 'not_debt_payment' };
  }
  const refId = String(
    payload.paymentId || payload.payment_id || payload.paymentNumber || payload.payment_number || '',
  ).trim();
  if (refId && !options.force && hasTable(db, 'report_notify_log')) {
    try {
      const existing = db
        .prepare(`SELECT 1 AS x FROM report_notify_log WHERE event_key = ? AND ref_id = ?`)
        .get(EVENT_DEBT_PAYMENT, refId);
      if (existing) return { ok: false, skipped: true, reason: 'already_sent' };
    } catch {
      // ignore
    }
  }

  let enriched = { ...payload };
  if (!enriched.customerName && enriched.customerId && hasTable(db, 'customers')) {
    try {
      const row = db
        .prepare(`SELECT name FROM customers WHERE id = ?`)
        .get(enriched.customerId);
      if (row?.name) enriched.customerName = row.name;
    } catch {
      // ignore
    }
  }
  if (!enriched.cashierName && (enriched.cashierId || enriched.received_by) && hasTable(db, 'users')) {
    try {
      const row = db
        .prepare(`SELECT full_name, username FROM users WHERE id = ?`)
        .get(enriched.cashierId || enriched.received_by);
      if (row) enriched.cashierName = row.full_name || row.username || null;
    } catch {
      // ignore
    }
  }

  const text = buildDebtPaymentText(enriched, settings.storeName);
  const out = await sendToReportChats(db, text, options);
  if ((out.ok || out.sent > 0) && refId) {
    claimNotifyDedup(db, EVENT_DEBT_PAYMENT, refId);
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

function localTimeParts(_db) {
  try {
    const {
      formatYmdInTimeZone,
      UZBEKISTAN_TIMEZONE,
    } = require('../../electron/lib/timezone.cjs');
    const d = new Date();
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: UZBEKISTAN_TIMEZONE,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(d);
    const map = {};
    for (const p of parts) {
      if (p.type !== 'literal') map[p.type] = p.value;
    }
    return {
      date: formatYmdInTimeZone(d) || new Date().toISOString().slice(0, 10),
      hour: Number(map.hour) || 0,
      minute: Number(map.minute) || 0,
    };
  } catch {
    const row = _db
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

function emptyOpSection() {
  return { count: 0, total: 0, lines: [], more: 0 };
}

function capLines(rows, formatFn, cap = DIGEST_LIST_CAP) {
  const list = Array.isArray(rows) ? rows : [];
  const lines = list.slice(0, cap).map(formatFn).filter(Boolean);
  return {
    lines,
    more: Math.max(0, list.length - lines.length),
  };
}

function sumTodayExpenses(db, ymd) {
  return loadTodayExpenses(db, ymd).total;
}

function loadTodayExpenses(db, ymd) {
  if (!hasTable(db, 'expenses')) return emptyOpSection();
  try {
    const dateExpr = tzDateExpr('COALESCE(e.expense_date, e.created_at)');
    const statusFilter = hasColumn(db, 'expenses', 'status')
      ? `AND LOWER(COALESCE(e.status,'')) NOT IN ('rejected','cancelled','draft')`
      : '';
    const catJoin =
      hasTable(db, 'expense_categories') && hasColumn(db, 'expenses', 'category_id')
        ? 'LEFT JOIN expense_categories ec ON ec.id = e.category_id'
        : '';
    const labelParts = [];
    if (catJoin) labelParts.push(`NULLIF(TRIM(ec.name), '')`);
    if (hasColumn(db, 'expenses', 'category')) labelParts.push(`NULLIF(TRIM(e.category), '')`);
    if (hasColumn(db, 'expenses', 'description')) labelParts.push(`NULLIF(TRIM(e.description), '')`);
    if (hasColumn(db, 'expenses', 'vendor')) labelParts.push(`NULLIF(TRIM(e.vendor), '')`);
    const catSelect =
      labelParts.length > 0
        ? `COALESCE(${labelParts.join(', ')}, 'Xarajat')`
        : `'Xarajat'`;
    const vendorSelect = hasColumn(db, 'expenses', 'vendor')
      ? `NULLIF(TRIM(e.vendor), '')`
      : `NULL`;
    const descSelect = hasColumn(db, 'expenses', 'description')
      ? `NULLIF(TRIM(e.description), '')`
      : `NULL`;
    const agg = db
      .prepare(
        `SELECT COUNT(*) AS cnt, COALESCE(SUM(e.amount), 0) AS total
         FROM expenses e
         WHERE ${dateExpr} = date(?)
           ${statusFilter}`,
      )
      .get(ymd);
    const rows = db
      .prepare(
        `SELECT e.amount, ${catSelect} AS label,
                ${vendorSelect} AS vendor,
                ${descSelect} AS description
         FROM expenses e
         ${catJoin}
         WHERE ${dateExpr} = date(?)
           ${statusFilter}
         ORDER BY e.amount DESC
         LIMIT 20`,
      )
      .all(ymd);
    const capped = capLines(rows, (r) => {
      const label = clipLabel(r.label || r.description || 'Xarajat');
      const vendor = r.vendor ? ` (${clipLabel(r.vendor, 20)})` : '';
      return `${label}${vendor}: ${formatSumma(r.amount)}`;
    });
    return {
      count: Number(agg?.cnt || 0) || 0,
      total: Number(agg?.total || 0) || 0,
      lines: capped.lines,
      more: Math.max(0, (Number(agg?.cnt || 0) || 0) - capped.lines.length),
    };
  } catch {
    return emptyOpSection();
  }
}

function loadTodayCreditSales(db, ymd) {
  if (!hasTable(db, 'orders')) return emptyOpSection();
  try {
    const dateExpr = tzDateExpr('o.created_at');
    const statusFilter = hasColumn(db, 'orders', 'status')
      ? `AND LOWER(TRIM(COALESCE(o.status,''))) IN ('completed','paid','done')`
      : '';
    const agg = db
      .prepare(
        `SELECT COUNT(*) AS cnt, COALESCE(SUM(o.credit_amount), 0) AS total
         FROM orders o
         WHERE ${dateExpr} = date(?)
           AND COALESCE(o.credit_amount, 0) > 0
           ${statusFilter}`,
      )
      .get(ymd);
    const rows = db
      .prepare(
        `SELECT o.order_number, o.credit_amount, c.name AS customer_name
         FROM orders o
         LEFT JOIN customers c ON c.id = o.customer_id
         WHERE ${dateExpr} = date(?)
           AND COALESCE(o.credit_amount, 0) > 0
           ${statusFilter}
         ORDER BY o.credit_amount DESC
         LIMIT 20`,
      )
      .all(ymd);
    const capped = capLines(rows, (r) => {
      const who = clipLabel(r.customer_name || r.order_number || 'Mijoz');
      const num = r.order_number ? ` #${clipLabel(r.order_number, 16)}` : '';
      return `${who}${num}: ${formatSumma(r.credit_amount)}`;
    });
    return {
      count: Number(agg?.cnt || 0) || 0,
      total: Number(agg?.total || 0) || 0,
      lines: capped.lines,
      more: Math.max(0, (Number(agg?.cnt || 0) || 0) - capped.lines.length),
    };
  } catch {
    return emptyOpSection();
  }
}

function loadTodayPurchases(db, ymd) {
  // Prefer goods receipts; fall back to purchase_orders received/created today.
  if (hasTable(db, 'purchase_receipts')) {
    try {
      const dateExpr = tzDateExpr('COALESCE(pr.received_at, pr.created_at)');
      const amountCol = hasColumn(db, 'purchase_receipts', 'total_uzs')
        ? 'COALESCE(pr.total_uzs, pr.total_usd, 0)'
        : hasColumn(db, 'purchase_receipts', 'total_usd')
          ? 'COALESCE(pr.total_usd, 0)'
          : '0';
      const agg = db
        .prepare(
          `SELECT COUNT(*) AS cnt, COALESCE(SUM(${amountCol}), 0) AS total
           FROM purchase_receipts pr
           WHERE ${dateExpr} = date(?)
             AND LOWER(COALESCE(pr.status,'')) NOT IN ('cancelled','void','draft')`,
        )
        .get(ymd);
      const rows = db
        .prepare(
          `SELECT pr.receipt_number, ${amountCol} AS amount,
                  COALESCE(s.name, pr.invoice_number, pr.receipt_number) AS label
           FROM purchase_receipts pr
           LEFT JOIN suppliers s ON s.id = pr.supplier_id
           WHERE ${dateExpr} = date(?)
             AND LOWER(COALESCE(pr.status,'')) NOT IN ('cancelled','void','draft')
           ORDER BY amount DESC
           LIMIT 20`,
        )
        .all(ymd);
      const capped = capLines(rows, (r) => {
        const label = clipLabel(r.label || r.receipt_number || 'Qabul');
        const num = r.receipt_number ? ` #${clipLabel(r.receipt_number, 14)}` : '';
        return `${label}${num}: ${formatSumma(r.amount)}`;
      });
      return {
        count: Number(agg?.cnt || 0) || 0,
        total: Number(agg?.total || 0) || 0,
        lines: capped.lines,
        more: Math.max(0, (Number(agg?.cnt || 0) || 0) - capped.lines.length),
      };
    } catch {
      // fall through to PO
    }
  }

  if (!hasTable(db, 'purchase_orders')) return emptyOpSection();
  try {
    const dateExpr = tzDateExpr('COALESCE(po.order_date, po.created_at)');
    const agg = db
      .prepare(
        `SELECT COUNT(*) AS cnt, COALESCE(SUM(po.total_amount), 0) AS total
         FROM purchase_orders po
         WHERE ${dateExpr} = date(?)
           AND LOWER(COALESCE(po.status,'')) NOT IN ('cancelled','void','draft')`,
      )
      .get(ymd);
    const rows = db
      .prepare(
        `SELECT po.po_number, po.total_amount AS amount,
                COALESCE(s.name, po.supplier_name, po.po_number) AS label
         FROM purchase_orders po
         LEFT JOIN suppliers s ON s.id = po.supplier_id
         WHERE ${dateExpr} = date(?)
           AND LOWER(COALESCE(po.status,'')) NOT IN ('cancelled','void','draft')
         ORDER BY po.total_amount DESC
         LIMIT 20`,
      )
      .all(ymd);
    const capped = capLines(rows, (r) => {
      const label = clipLabel(r.label || r.po_number || 'Xarid');
      const num = r.po_number ? ` #${clipLabel(r.po_number, 14)}` : '';
      return `${label}${num}: ${formatSumma(r.amount)}`;
    });
    return {
      count: Number(agg?.cnt || 0) || 0,
      total: Number(agg?.total || 0) || 0,
      lines: capped.lines,
      more: Math.max(0, (Number(agg?.cnt || 0) || 0) - capped.lines.length),
    };
  } catch {
    return emptyOpSection();
  }
}

function loadTodayStockChanges(db, ymd) {
  if (!hasTable(db, 'inventory_movements')) return emptyOpSection();
  try {
    const dateExpr = tzDateExpr('im.created_at');
    // Exclude routine sale lines — focus on ops managers care about.
    const typeFilter = `AND LOWER(COALESCE(im.movement_type,'')) NOT IN ('sale','sales')`;
    const agg = db
      .prepare(
        `SELECT COUNT(*) AS cnt
         FROM inventory_movements im
         WHERE ${dateExpr} = date(?)
           ${typeFilter}`,
      )
      .get(ymd);
    const rows = db
      .prepare(
        `SELECT im.movement_type, im.quantity,
                COALESCE(NULLIF(TRIM(p.name), ''), im.product_id) AS product_name,
                NULLIF(TRIM(im.reason), '') AS reason
         FROM inventory_movements im
         LEFT JOIN products p ON p.id = im.product_id
         WHERE ${dateExpr} = date(?)
           ${typeFilter}
         ORDER BY ABS(im.quantity) DESC
         LIMIT 20`,
      )
      .all(ymd);
    const capped = capLines(rows, (r) => {
      const qty = Number(r.quantity) || 0;
      const sign = qty > 0 ? '+' : '';
      const why = r.reason ? ` — ${clipLabel(r.reason, 24)}` : '';
      return `${clipLabel(r.product_name)} (${movementTypeLabel(r.movement_type)}) ${sign}${qty}${why}`;
    });
    return {
      count: Number(agg?.cnt || 0) || 0,
      total: 0,
      lines: capped.lines,
      more: Math.max(0, (Number(agg?.cnt || 0) || 0) - capped.lines.length),
    };
  } catch {
    return emptyOpSection();
  }
}

function formatDebtPaymentLine(r) {
  const who = clipLabel(r.customer_name || 'Mijoz');
  const methodRaw = paymentMethodLabelUz(r.payment_method);
  const method = methodRaw ? ` (${clipLabel(methodRaw, 12)})` : '';
  const num = r.payment_number ? ` #${clipLabel(r.payment_number, 16)}` : '';
  return `${who}${method}${num}: ${formatSumma(r.amount)}`;
}

function loadTodayDebtPaymentsFromLedger(db, ymd) {
  if (!hasTable(db, 'customer_ledger')) return emptyOpSection();
  try {
    const dateExpr = tzDateExpr('cl.created_at');
    const opFilter = hasColumn(db, 'customer_ledger', 'op_code')
      ? `AND UPPER(TRIM(COALESCE(cl.op_code, ''))) IN ('DEBT_PAYMENT_RECEIVED', 'CUSTOMER_LOAN_REPAID', 'CUSTOMER_PAYMENT')`
      : `AND LOWER(TRIM(COALESCE(cl.type, ''))) = 'payment_in'`;
    const methodSelect = hasColumn(db, 'customer_ledger', 'method')
      ? `cl.method`
      : `NULL`;
    const refSelect = hasColumn(db, 'customer_ledger', 'ref_no')
      ? `cl.ref_no`
      : `NULL`;
    const agg = db
      .prepare(
        `SELECT COUNT(*) AS cnt, COALESCE(SUM(ABS(cl.amount)), 0) AS total
         FROM customer_ledger cl
         WHERE ${dateExpr} = date(?)
           AND ABS(COALESCE(cl.amount, 0)) > 0
           ${opFilter}`,
      )
      .get(ymd);
    const rows = db
      .prepare(
        `SELECT ABS(cl.amount) AS amount, ${methodSelect} AS payment_method,
                ${refSelect} AS payment_number, c.name AS customer_name
         FROM customer_ledger cl
         LEFT JOIN customers c ON c.id = cl.customer_id
         WHERE ${dateExpr} = date(?)
           AND ABS(COALESCE(cl.amount, 0)) > 0
           ${opFilter}
         ORDER BY ABS(cl.amount) DESC
         LIMIT 20`,
      )
      .all(ymd);
    const capped = capLines(rows, formatDebtPaymentLine);
    return {
      count: Number(agg?.cnt || 0) || 0,
      total: Number(agg?.total || 0) || 0,
      lines: capped.lines,
      more: Math.max(0, (Number(agg?.cnt || 0) || 0) - capped.lines.length),
    };
  } catch {
    return emptyOpSection();
  }
}

function loadTodayDebtPayments(db, ymd) {
  if (hasTable(db, 'customer_payments')) {
    try {
      const paidCol = hasColumn(db, 'customer_payments', 'paid_at') ? 'cp.paid_at' : null;
      const createdCol = hasColumn(db, 'customer_payments', 'created_at')
        ? 'cp.created_at'
        : null;
      const dateSource = paidCol && createdCol
        ? `COALESCE(${paidCol}, ${createdCol})`
        : paidCol || createdCol || 'cp.paid_at';
      const dateExpr = tzDateExpr(dateSource);
      let opFilter = '';
      if (hasColumn(db, 'customer_payments', 'operation')) {
        opFilter = `AND COALESCE(LOWER(cp.operation), 'payment_in') = 'payment_in'`;
      }
      const methodFilter = `AND COALESCE(LOWER(cp.payment_method), '') NOT IN ('refund_cash','refund_balance')`;
      const numSelect = hasColumn(db, 'customer_payments', 'payment_number')
        ? 'cp.payment_number'
        : 'NULL';
      const agg = db
        .prepare(
          `SELECT COUNT(*) AS cnt, COALESCE(SUM(cp.amount), 0) AS total
           FROM customer_payments cp
           WHERE ${dateExpr} = date(?)
             AND COALESCE(cp.amount, 0) > 0
             ${opFilter}
             ${methodFilter}`,
        )
        .get(ymd);
      const rows = db
        .prepare(
          `SELECT cp.amount, cp.payment_method, ${numSelect} AS payment_number,
                  c.name AS customer_name
           FROM customer_payments cp
           LEFT JOIN customers c ON c.id = cp.customer_id
           WHERE ${dateExpr} = date(?)
             AND COALESCE(cp.amount, 0) > 0
             ${opFilter}
             ${methodFilter}
           ORDER BY cp.amount DESC
           LIMIT 20`,
        )
        .all(ymd);
      const count = Number(agg?.cnt || 0) || 0;
      if (count > 0) {
        const capped = capLines(rows, formatDebtPaymentLine);
        return {
          count,
          total: Number(agg?.total || 0) || 0,
          lines: capped.lines,
          more: Math.max(0, count - capped.lines.length),
        };
      }
    } catch {
      // fall through to ledger
    }
  }
  return loadTodayDebtPaymentsFromLedger(db, ymd);
}

function loadTodayReturns(db, ymd) {
  const tables = ['sales_returns', 'sale_returns'];
  for (const table of tables) {
    if (!hasTable(db, table)) continue;
    try {
      const amountCol = hasColumn(db, table, 'total_amount')
        ? 'total_amount'
        : hasColumn(db, table, 'refund_amount')
          ? 'refund_amount'
          : hasColumn(db, table, 'amount')
            ? 'amount'
            : null;
      const dateCol = hasColumn(db, table, 'return_date')
        ? 'return_date'
        : hasColumn(db, table, 'created_at')
          ? 'created_at'
          : null;
      if (!amountCol || !dateCol) continue;
      const dateExpr = tzDateExpr(`r.${dateCol}`);
      const statusFilter = hasColumn(db, table, 'status')
        ? `AND LOWER(COALESCE(r.status,'')) IN ('completed','done','paid')`
        : '';
      const numCol = hasColumn(db, table, 'return_number') ? 'r.return_number' : 'r.id';
      const agg = db
        .prepare(
          `SELECT COUNT(*) AS cnt, COALESCE(SUM(r.${amountCol}), 0) AS total
           FROM ${table} r
           WHERE ${dateExpr} = date(?)
             ${statusFilter}`,
        )
        .get(ymd);
      const rows = db
        .prepare(
          `SELECT r.${amountCol} AS amount, ${numCol} AS return_number,
                  c.name AS customer_name
           FROM ${table} r
           LEFT JOIN customers c ON c.id = r.customer_id
           WHERE ${dateExpr} = date(?)
             ${statusFilter}
           ORDER BY amount DESC
           LIMIT 20`,
        )
        .all(ymd);
      const capped = capLines(rows, (r) => {
        const who = clipLabel(r.customer_name || r.return_number || 'Qaytarish');
        const num = r.return_number ? ` #${clipLabel(r.return_number, 14)}` : '';
        return `${who}${num}: ${formatSumma(r.amount)}`;
      });
      return {
        count: Number(agg?.cnt || 0) || 0,
        total: Number(agg?.total || 0) || 0,
        lines: capped.lines,
        more: Math.max(0, (Number(agg?.cnt || 0) || 0) - capped.lines.length),
      };
    } catch {
      // try next table
    }
  }
  return emptyOpSection();
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

  const expenses = loadTodayExpenses(db, ymd);
  const creditSales = loadTodayCreditSales(db, ymd);
  const purchases = loadTodayPurchases(db, ymd);
  const stockChanges = loadTodayStockChanges(db, ymd);
  const debtPayments = loadTodayDebtPayments(db, ymd);
  const returns = loadTodayReturns(db, ymd);

  return {
    date: ymd,
    totalSales: Number(daily.total_sales || 0) || 0,
    orderCount: Number(daily.order_count || 0) || 0,
    cashTotal: Number(daily.cash_total || 0) || 0,
    cardTotal: Number(daily.card_total || 0) || 0,
    creditTotal: Number(daily.credit_total || 0) || 0,
    netProfit: daily.net_profit != null ? Number(daily.net_profit) || 0 : null,
    expensesTotal: expenses.total,
    customerDebtTotal: sumCustomerDebt(db),
    debtCollected: debtPayments.total,
    operations: {
      expenses,
      creditSales,
      purchases,
      stockChanges,
      debtPayments,
      returns,
    },
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
  // Soft-split long digests so Telegram 4096 limit does not drop the whole message.
  const chunks = [];
  const hard = 3900;
  if (text.length <= hard) {
    chunks.push(text);
  } else {
    const parts = text.split('\n\n');
    let buf = '';
    for (const part of parts) {
      const next = buf ? `${buf}\n\n${part}` : part;
      if (next.length > hard && buf) {
        chunks.push(buf);
        buf = part;
      } else {
        buf = next;
      }
    }
    if (buf) chunks.push(buf);
  }
  let sent = 0;
  let failed = 0;
  let lastReason = null;
  for (const chunk of chunks) {
    // eslint-disable-next-line no-await-in-loop
    const out = await sendToReportChats(db, chunk, options);
    sent += Number(out.sent || 0) || 0;
    failed += Number(out.failed || 0) || 0;
    if (out.reason) lastReason = out.reason;
  }
  const out = {
    ok: failed === 0 && sent > 0,
    sent,
    failed,
    reason: sent > 0 ? null : lastReason || 'send_failed',
    parts: chunks.length,
  };
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
  EVENT_DEBT_PAYMENT,
  EVENT_TEST,
  LOCK_NAME,
  getReportTelegramSettings,
  resolveReportDestination,
  resolveReportChatIds,
  resolveBotToken,
  NO_CHAT_ID_HINT,
  isEventEnabled,
  buildCreditSaleText,
  buildDebtPaymentText,
  buildShiftClosedText,
  buildDailyDigestText,
  buildDailyDigestSummary,
  notifyCreditSale,
  notifyDebtPayment,
  notifyShiftClosed,
  runDailyDigestTick,
  sendTestReport,
  sendToReportChats,
  normalizeScheduleTime,
  toBool,
};

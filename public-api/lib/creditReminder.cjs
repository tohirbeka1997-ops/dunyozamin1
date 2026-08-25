'use strict';

const { randomUUID } = require('crypto');
const SettingsService = require('../../electron/services/settingsService.cjs');
const { normalizePhoneUz } = require('../../electron/lib/phoneNormalize.cjs');
const { sendSms, getSmsProvider } = require('./smsGateway.cjs');
const { notifyCreditDueReminder, sendTelegramText } = require('./telegramNotify.cjs');
const { logger } = require('./logger.cjs');

const VALID_CHANNELS = new Set(['telegram_first', 'sms_first', 'both', 'sms_only', 'telegram_only']);

/** Machine codes → clear Uzbek messages for Cashiers UI toasts. */
const ERROR_MESSAGES_UZ = {
  schema_not_ready: "Eslatma tizimi tayyor emas (migratsiyani ishga tushiring)",
  order_not_found: 'Buyurtma topilmadi',
  not_credit_order: 'Bu nasiya (qarz) buyurtma emas',
  no_credit_balance: "Qarz qoldig'i yo'q",
  no_open_credit_order: "Ochiq nasiya buyurtma topilmadi — avval nasiya sotuv yarating",
  no_channel: "Mijozda telefon raqami ham, Telegram ham yo'q",
  no_phone: "Mijozda telefon raqami yo'q (SMS uchun kerak)",
  no_telegram: "Mijoz Telegramga ulanmagan — Mini App orqali kirishi kerak",
  telegram_bot_missing: "TELEGRAM_BOT_TOKEN sozlanmagan (.env)",
  sms_provider_off:
    "SMS o'chirilgan (SMS_PROVIDER=off). Eskiz/Playmobile yoqing yoki mijozni Telegramga ulang",
  sms_daily_limit: 'Kunlik SMS limiti tugagan',
  channels_disabled: "Sozlamalarda SMS va Telegram eslatmalari o'chirilgan",
  telegram_failed: "Telegramga yuborib bo'lmadi (chat topilmadi yoki bot bloklangan)",
  sms_failed: "SMS yuborib bo'lmadi",
  no_token_or_chat: "Telegram bot token yoki mijoz chat ID yo'q",
  invalid_phone: "Telefon raqami noto'g'ri",
  send_failed: 'Eslatma yuborib bo\'lmadi',
};

function humanizeCreditReminderError(code) {
  if (code == null || code === '') return ERROR_MESSAGES_UZ.send_failed;
  const key = String(code).trim();
  if (ERROR_MESSAGES_UZ[key]) return ERROR_MESSAGES_UZ[key];
  const lower = key.toLowerCase();
  if (lower.includes('chat not found') || lower.includes('bot was blocked') || lower.includes('forbidden')) {
    return `Telegram: ${key.slice(0, 140)}`;
  }
  if (key.length > 180) return ERROR_MESSAGES_UZ.send_failed;
  return key;
}

function reminderFail(code, extra = {}) {
  return {
    ok: false,
    skipped: true,
    reason: code,
    errorCode: code,
    error: humanizeCreditReminderError(code),
    ...extra,
  };
}

const REMINDER_SPECS = [
  { type: 'due_minus_1', dueOffsetDays: 1 },
  { type: 'due_today', dueOffsetDays: 0 },
  { type: 'overdue_3', dueOffsetDays: -3 },
];

const DEFAULT_TEMPLATES = {
  due_minus_1:
    "Hurmatli {ism}! Ertaga ({sana}) {summa} so'm qarz qaytarish kuni. {dokon_nomi}",
  due_today:
    "Hurmatli {ism}! {summa} so'm qarzingiz muddati bugun ({sana}). Iltimos to'lovni amalga oshiring. {dokon_nomi}",
  overdue_3:
    "Hurmatli {ism}! {summa} so'm qarzingiz muddati {sana} da edi. Iltimos to'lovni amalga oshiring. {dokon_nomi}",
  daily_debt:
    "Hurmatli {ism}! Sizda {summa} so'm qarz bor. Iltimos to'lovni amalga oshiring. {dokon_nomi}",
};

function hasTable(db, name) {
  try {
    return !!db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(name);
  } catch {
    return false;
  }
}

function hasColumn(db, table, column) {
  try {
    return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
  } catch {
    return false;
  }
}

function creditReminderSchemaReady(db) {
  return hasTable(db, 'credit_reminders') && hasColumn(db, 'orders', 'due_date');
}

function creditStaffAlertSchemaReady(db) {
  return hasTable(db, 'credit_staff_alerts');
}

function staffInAppAlertsEnabled(db) {
  return readSetting(db, 'credit.reminder.staff_in_app_enabled', true) !== false;
}

function readSetting(db, key, fallback = null) {
  try {
    const settings = new SettingsService(db);
    const val = settings.get(key);
    return val == null ? fallback : val;
  } catch {
    return fallback;
  }
}

function normalizeScheduleTime(raw) {
  const s = String(raw || '').trim();
  const m = /^(\d{1,2}):(\d{1,2})$/.exec(s);
  if (!m) return '09:00';
  const hh = Math.min(23, Math.max(0, Number(m[1])));
  const mm = Math.min(59, Math.max(0, Number(m[2])));
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function writeSetting(db, key, value, type = 'string') {
  try {
    const settings = new SettingsService(db);
    settings.set(key, value, type);
  } catch (e) {
    logger.warn({ err: e?.message || e, key }, '[credit-reminder] setting write failed');
  }
}

function getCreditReminderSettings(db) {
  const envDaily = Number.parseInt(String(process.env.SMS_DAILY_LIMIT || '0'), 10) || 0;
  const settingDaily = Number(readSetting(db, 'credit.reminder.daily_sms_limit', 0)) || 0;
  const dailySmsLimit = settingDaily > 0 ? settingDaily : envDaily;
  const channelRaw = String(readSetting(db, 'credit.reminder.channel', 'telegram_first') || 'telegram_first')
    .trim()
    .toLowerCase();
  const minAmount = Number(readSetting(db, 'credit.reminder.min_amount', 0));
  return {
    enabled: readSetting(db, 'credit.reminder.enabled', true) !== false,
    dailyEnabled: readSetting(db, 'credit.reminder.daily_enabled', true) !== false,
    balanceChangeNotify: readSetting(db, 'credit.reminder.balance_change_notify', true) !== false,
    smsEnabled: readSetting(db, 'credit.reminder.sms_enabled', true) !== false,
    telegramEnabled: readSetting(db, 'credit.reminder.telegram_enabled', true) !== false,
    channel: VALID_CHANNELS.has(channelRaw) ? channelRaw : 'telegram_first',
    template: String(readSetting(db, 'credit.reminder.template', '') || '').trim(),
    scheduleTime: normalizeScheduleTime(readSetting(db, 'credit.reminder.schedule_time', '09:00')),
    minAmount: Number.isFinite(minAmount) && minAmount > 0 ? minAmount : 0,
    dailySmsLimit: Math.max(0, dailySmsLimit),
    storeName: String(readSetting(db, 'company_name', '') || readSetting(db, 'company.name', '') || 'Do\'kon').trim(),
  };
}

function localTimeParts(db) {
  const row = db
    .prepare(
      `SELECT date('now', 'localtime') AS d, cast(strftime('%H', 'now', 'localtime') AS INTEGER) AS h,
              cast(strftime('%M', 'now', 'localtime') AS INTEGER) AS m`,
    )
    .get();
  return {
    date: row?.d || new Date().toISOString().slice(0, 10),
    hour: Number(row?.h) || 0,
    minute: Number(row?.m) || 0,
  };
}

function shouldRunScheduledTick(db, settings, options = {}) {
  if (options.force) return { ok: true, reason: 'forced' };
  const parts = localTimeParts(db);
  const [sh, sm] = String(settings.scheduleTime || '09:00')
    .split(':')
    .map((x) => Number(x));
  const scheduleMinutes = (Number.isFinite(sh) ? sh : 9) * 60 + (Number.isFinite(sm) ? sm : 0);
  const nowMinutes = parts.hour * 60 + parts.minute;
  if (nowMinutes < scheduleMinutes) {
    return { ok: false, reason: 'before_schedule', today: parts.date };
  }
  const lastRun = String(readSetting(db, 'credit.reminder.last_run_date', '') || '').slice(0, 10);
  if (lastRun === parts.date) {
    return { ok: false, reason: 'already_ran_today', today: parts.date };
  }
  return { ok: true, reason: 'due', today: parts.date };
}

function markCreditReminderTickRan(db, isoDate) {
  const d = String(isoDate || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return;
  writeSetting(db, 'credit.reminder.last_run_date', d, 'string');
}

function formatUzDate(isoDate) {
  const d = String(isoDate || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  const [y, m, day] = d.split('-');
  return `${day}.${m}.${y}`;
}

function formatSumma(amount) {
  return Math.round(Number(amount) || 0).toLocaleString('uz-UZ');
}

function truncateSms(text, maxLen = 160) {
  const s = String(text || '');
  if (s.length <= maxLen) return s;
  return `${s.slice(0, maxLen - 1)}…`;
}

function normalizeReminderTemplateKey(reminderType) {
  const t = String(reminderType || '');
  if (t === 'daily_debt' || t.startsWith('daily_')) return 'daily_debt';
  if (DEFAULT_TEMPLATES[t]) return t;
  return 'due_today';
}

function buildReminderMessage({ reminderType, customerName, amount, dueDate, storeName, customTemplate }) {
  const key = normalizeReminderTemplateKey(reminderType);
  const template =
    customTemplate ||
    DEFAULT_TEMPLATES[key] ||
    DEFAULT_TEMPLATES.due_today;
  const msg = template
    .replace(/\{ism\}/g, customerName || 'mijoz')
    .replace(/\{summa\}/g, formatSumma(amount))
    .replace(/\{sana\}/g, formatUzDate(dueDate))
    .replace(/\{dokon_nomi\}/g, storeName || 'Do\'kon');
  return truncateSms(msg);
}

function todayLocalDate(db) {
  const row = db.prepare(`SELECT date('now', 'localtime') AS d`).get();
  return row?.d || new Date().toISOString().slice(0, 10);
}

function dbDateOffset(baseDate, offsetDays) {
  // pure helper without db for tests
  const d = new Date(`${baseDate}T12:00:00`);
  d.setDate(d.getDate() - offsetDays);
  return d.toISOString().slice(0, 10);
}

function countSmsSentToday(db) {
  if (!hasTable(db, 'credit_reminders')) return 0;
  const today = todayLocalDate(db);
  const accurate = db
    .prepare(
      `
    SELECT COUNT(*) AS c FROM credit_reminders
    WHERE date(sent_at) = ?
      AND status = 'sent'
      AND channel IN ('sms', 'both')
  `,
    )
    .get(today);
  return Number(accurate?.c || 0) || 0;
}

function normalizeTelegramUsername(raw) {
  const s = String(raw || '')
    .trim()
    .replace(/^@+/, '');
  if (!s) return null;
  // Telegram usernames: 5–32 chars, letters/digits/underscore
  if (!/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(s)) return null;
  return s;
}

/**
 * Resolve Telegram chat target for a POS customer.
 * Priority: Mini App binding → customers.telegram_id / chat_id → @telegram_username
 * @returns {number|string|null} numeric chat id or "@username"
 */
function getTelegramIdForCustomer(db, customerId) {
  if (!customerId) return null;

  // 1) Mini App / marketplace binding (preferred when present)
  if (hasTable(db, 'marketplace_customer_bindings') && hasTable(db, 'marketplace_customers')) {
    try {
      const row = db
        .prepare(
          `
        SELECT mc.telegram_id
        FROM marketplace_customer_bindings b
        INNER JOIN marketplace_customers mc ON mc.id = b.marketplace_customer_id
        WHERE b.pos_customer_id = ?
        LIMIT 1
      `,
        )
        .get(customerId);
      const tg = row?.telegram_id;
      if (tg != null && Number.isFinite(Number(tg))) return Number(tg);
    } catch {
      // ignore join failures
    }
  }

  // 2) Manual columns on customers (edit form / staff attach)
  if (hasTable(db, 'customers')) {
    try {
      const cols = db.prepare(`PRAGMA table_info(customers)`).all().map((c) => c.name);
      for (const col of ['telegram_id', 'telegram_chat_id', 'chat_id']) {
        if (!cols.includes(col)) continue;
        const row = db.prepare(`SELECT ${col} AS tg FROM customers WHERE id = ?`).get(customerId);
        const tg = row?.tg;
        if (tg != null && String(tg).trim() !== '' && Number.isFinite(Number(tg))) {
          return Number(tg);
        }
      }
      if (cols.includes('telegram_username')) {
        const row = db
          .prepare(`SELECT telegram_username AS u FROM customers WHERE id = ?`)
          .get(customerId);
        const username = normalizeTelegramUsername(row?.u);
        if (username) return `@${username}`;
      }
    } catch {
      // ignore pragma/select failures
    }
  }

  return null;
}

function getCustomerPhone(db, customerId) {
  if (!customerId) return null;
  const cols = db.prepare(`PRAGMA table_info(customers)`).all().map((c) => c.name);
  if (!cols.includes('phone')) return null;
  const hasNormalized = cols.includes('phone_normalized');
  const row = hasNormalized
    ? db.prepare(`SELECT phone, phone_normalized FROM customers WHERE id = ?`).get(customerId)
    : db.prepare(`SELECT phone FROM customers WHERE id = ?`).get(customerId);
  if (!row) return null;
  const raw = hasNormalized ? row.phone_normalized || row.phone : row.phone;
  return normalizePhoneUz(raw);
}

function resolveChannels(settings, hasTelegram, hasPhone) {
  const mode = settings.channel;
  const tg = settings.telegramEnabled && hasTelegram;
  const sms = settings.smsEnabled && hasPhone;

  if (mode === 'telegram_only') return { sendTelegram: tg, sendSms: false };
  if (mode === 'sms_only') return { sendTelegram: false, sendSms: sms };
  if (mode === 'both') return { sendTelegram: tg, sendSms: sms };
  if (mode === 'sms_first') return { sendTelegram: false, sendSms: sms, fallbackTelegram: tg };
  // telegram_first (default)
  if (tg) return { sendTelegram: true, sendSms: false };
  return { sendTelegram: false, sendSms: sms };
}

function recordChannelUsed(parts, ch) {
  if (!parts.includes(ch)) parts.push(ch);
}

function channelLabel(parts) {
  if (!parts.length) return null;
  if (parts.includes('sms') && parts.includes('telegram')) return 'both';
  return parts[0];
}

function diagnoseUnsentReminder({
  hasPhone,
  hasTelegram,
  settings,
  botToken,
  channels,
  lastError,
}) {
  if (lastError) return lastError;
  if (!settings.smsEnabled && !settings.telegramEnabled) return 'channels_disabled';
  if (!hasPhone && !hasTelegram) return 'no_channel';

  const smsProvider = getSmsProvider();
  const wantsTelegram = !!(channels.sendTelegram || channels.fallbackTelegram);
  const wantsSms = !!channels.sendSms || (!channels.sendTelegram && hasPhone && settings.smsEnabled);

  if (wantsTelegram && hasTelegram && !botToken) return 'telegram_bot_missing';
  if (wantsSms && hasPhone && smsProvider === 'off') {
    if (hasTelegram && !botToken) return 'telegram_bot_missing';
    if (!hasTelegram) return 'sms_provider_off';
    return 'sms_provider_off';
  }
  if (settings.channel === 'telegram_only' && !hasTelegram) return 'no_telegram';
  if (settings.channel === 'sms_only' && !hasPhone) return 'no_phone';
  if (!hasTelegram && hasPhone && !settings.smsEnabled) return 'no_telegram';
  if (hasTelegram && !hasPhone && !settings.telegramEnabled) return 'no_phone';
  if (!hasTelegram && !hasPhone) return 'no_channel';
  if (hasPhone && !hasTelegram && smsProvider === 'off') return 'sms_provider_off';
  if (hasTelegram && !botToken) return 'telegram_bot_missing';
  return 'send_failed';
}

async function deliverReminder({
  db,
  order,
  reminderType,
  settings,
  botToken,
  manual = false,
}) {
  const phone = getCustomerPhone(db, order.customer_id);
  const telegramId = getTelegramIdForCustomer(db, order.customer_id);
  const hasPhone = !!phone;
  const hasTelegram = telegramId != null;

  // Customer DMs only — never reports.telegram.chat_id / TELEGRAM_REPORTS_CHAT_ID.
  if (!hasPhone && !hasTelegram) {
    logger.info(
      { orderId: order.id, reminderType, customerId: order.customer_id },
      '[credit-reminder] kanal yo\'q',
    );
    return reminderFail('no_channel');
  }

  if (!settings.smsEnabled && !settings.telegramEnabled) {
    return reminderFail('channels_disabled');
  }

  const channels = resolveChannels(settings, hasTelegram, hasPhone);
  const text = buildReminderMessage({
    reminderType,
    customerName: order.customer_name,
    amount: order.credit_amount,
    dueDate: order.due_date,
    storeName: settings.storeName,
    customTemplate: settings.template || null,
  });

  const usedChannels = [];
  let providerId = null;
  let anySent = false;
  let lastError = null;

  const smsLimit = settings.dailySmsLimit;
  const smsCountToday = countSmsSentToday(db);
  const smsBudgetLeft = smsLimit > 0 ? Math.max(0, smsLimit - smsCountToday) : Infinity;

  async function sendTelegramMessage() {
    if (settings.template) {
      return sendTelegramText({ botToken, telegramId, text });
    }
    return notifyCreditDueReminder({
      botToken,
      telegramId,
      customerName: order.customer_name,
      amount: order.credit_amount,
      dueDate: order.due_date,
      orderNumber: order.order_number,
      storeName: settings.storeName,
      reminderType,
    });
  }

  async function tryTelegramFallback() {
    if (!channels.fallbackTelegram || !telegramId) return false;
    if (!botToken) {
      lastError = 'telegram_bot_missing';
      return false;
    }
    const tgOut = await sendTelegramMessage();
    if (tgOut?.ok) {
      recordChannelUsed(usedChannels, 'telegram');
      anySent = true;
      return true;
    }
    lastError = tgOut?.reason || 'telegram_failed';
    return false;
  }

  async function trySmsFallback() {
    if (!hasPhone || !settings.smsEnabled || smsBudgetLeft <= 0) return false;
    const smsOut = await sendSms(phone, text);
    if (smsOut.skipped) {
      lastError = smsOut.error || 'sms_provider_off';
      return false;
    }
    if (smsOut.ok) {
      recordChannelUsed(usedChannels, 'sms');
      providerId = smsOut.id || providerId;
      anySent = true;
      return true;
    }
    lastError = smsOut.error || 'sms_failed';
    return false;
  }

  async function trySms() {
    if (!channels.sendSms) {
      await tryTelegramFallback();
      return;
    }
    if (smsBudgetLeft <= 0) {
      lastError = 'sms_daily_limit';
      logger.warn({ orderId: order.id }, '[credit-reminder] SMS kunlik limit tugadi');
      await tryTelegramFallback();
      return;
    }
    const smsOut = await sendSms(phone, text);
    if (smsOut.skipped) {
      lastError = smsOut.error || 'sms_provider_off';
      await tryTelegramFallback();
      return;
    }
    if (smsOut.ok) {
      recordChannelUsed(usedChannels, 'sms');
      providerId = smsOut.id || providerId;
      anySent = true;
    } else {
      lastError = smsOut.error || 'sms_failed';
      await tryTelegramFallback();
    }
  }

  async function tryTelegram() {
    if (!channels.sendTelegram) return;
    if (!telegramId) {
      lastError = 'no_telegram';
      await trySmsFallback();
      return;
    }
    if (!botToken) {
      lastError = 'telegram_bot_missing';
      await trySmsFallback();
      return;
    }
    const tgOut = await sendTelegramMessage();
    if (tgOut?.ok) {
      recordChannelUsed(usedChannels, 'telegram');
      anySent = true;
    } else {
      lastError = tgOut?.reason || 'telegram_failed';
      if (!channels.sendSms) {
        await trySmsFallback();
      }
    }
  }

  if (settings.channel === 'both') {
    await Promise.all([tryTelegram(), trySms()]);
  } else if (channels.sendTelegram) {
    await tryTelegram();
  } else {
    await trySms();
  }

  const channel = channelLabel(usedChannels);
  const status = anySent ? 'sent' : 'failed';

  if (!manual && anySent) {
    const sentAt = new Date().toISOString();
    try {
      db.prepare(
        `INSERT OR IGNORE INTO credit_reminders
         (order_id, reminder_type, channel, status, provider_id, sent_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(order.id, reminderType, channel, status, providerId, sentAt);
    } catch (e) {
      logger.warn({ err: e?.message || e, orderId: order.id }, '[credit-reminder] dedup write failed');
    }
  }

  if (anySent) {
    return { ok: true, channel, status, providerId, error: null, errorCode: null };
  }

  const errorCode = diagnoseUnsentReminder({
    hasPhone,
    hasTelegram,
    settings,
    botToken,
    channels,
    lastError,
  });
  return {
    ok: false,
    channel,
    status,
    providerId,
    skipped: true,
    reason: errorCode,
    errorCode,
    error: humanizeCreditReminderError(errorCode),
  };
}

function normalizeDueDate(value) {
  if (value == null || value === '') return null;
  const s = String(value).trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function isOpenCreditPaymentStatus(paymentStatus) {
  const ps = String(paymentStatus || '').toLowerCase();
  return ps === 'on_credit' || ps === 'partial' || ps === 'partially_paid';
}

function creditOrderSelectCols(db) {
  const noteCol = hasColumn(db, 'orders', 'credit_reminder_note') ? 'o.credit_reminder_note,' : '';
  return `
      o.id,
      o.order_number,
      o.customer_id,
      o.credit_amount,
      o.due_date,
      o.payment_status,
      ${noteCol}
      c.name AS customer_name,
      c.phone AS customer_phone`;
}

function findOrdersForReminder(db, reminderType, dueDate, options = {}) {
  if (!creditReminderSchemaReady(db)) return [];
  const minAmount = Math.max(0, Number(options.minAmount) || 0);
  return db
    .prepare(
      `
    SELECT
      ${creditOrderSelectCols(db)}
    FROM orders o
    LEFT JOIN customers c ON c.id = o.customer_id
    WHERE o.status = 'completed'
      AND o.payment_status IN ('on_credit', 'partial', 'partially_paid')
      AND COALESCE(o.credit_amount, 0) > 0
      AND COALESCE(o.credit_amount, 0) >= ?
      AND o.due_date IS NOT NULL
      AND date(o.due_date) = date(?)
      AND NOT EXISTS (
        SELECT 1 FROM credit_reminders cr
        WHERE cr.order_id = o.id AND cr.reminder_type = ?
      )
    ORDER BY o.due_date ASC, o.created_at ASC
    LIMIT 50
  `,
    )
    .all(minAmount, dueDate, reminderType);
}

function findOrdersForStaffAlert(db, alertType, dueDate, options = {}) {
  if (!creditReminderSchemaReady(db) || !creditStaffAlertSchemaReady(db)) return [];
  const minAmount = Math.max(0, Number(options.minAmount) || 0);
  return db
    .prepare(
      `
    SELECT
      ${creditOrderSelectCols(db)}
    FROM orders o
    LEFT JOIN customers c ON c.id = o.customer_id
    WHERE o.status = 'completed'
      AND o.payment_status IN ('on_credit', 'partial', 'partially_paid')
      AND COALESCE(o.credit_amount, 0) > 0
      AND COALESCE(o.credit_amount, 0) >= ?
      AND o.due_date IS NOT NULL
      AND date(o.due_date) = date(?)
      AND NOT EXISTS (
        SELECT 1 FROM credit_staff_alerts csa
        WHERE csa.order_id = o.id AND csa.alert_type = ?
      )
    ORDER BY o.due_date ASC, o.created_at ASC
    LIMIT 50
  `,
    )
    .all(minAmount, dueDate, alertType);
}

/**
 * Customers with open debt (negative balance) for daily reminders.
 * One row per customer; nearest due_date when open credit orders exist.
 */
function findDailyDebtCustomers(db, options = {}) {
  if (!hasTable(db, 'customers')) return [];
  const minAmount = Math.max(0, Number(options.minAmount) || 0);
  const limit = Math.min(200, Math.max(1, Number(options.limit) || 100));
  const hasOrders = hasTable(db, 'orders');
  const nearestDueSql = hasOrders
    ? `(
        SELECT MIN(o.due_date) FROM orders o
        WHERE o.customer_id = c.id
          AND o.status = 'completed'
          AND o.payment_status IN ('on_credit', 'partial', 'partially_paid')
          AND COALESCE(o.credit_amount, 0) > 0
          AND o.due_date IS NOT NULL
      )`
    : 'NULL';
  const latestOrderSql = hasOrders
    ? `(
        SELECT o.id FROM orders o
        WHERE o.customer_id = c.id
          AND o.status = 'completed'
          AND o.payment_status IN ('on_credit', 'partial', 'partially_paid')
          AND COALESCE(o.credit_amount, 0) > 0
        ORDER BY COALESCE(o.due_date, o.created_at) ASC, o.created_at ASC
        LIMIT 1
      )`
    : 'NULL';

  return db
    .prepare(
      `
    SELECT
      c.id AS customer_id,
      c.name AS customer_name,
      c.phone AS customer_phone,
      CASE WHEN c.balance < 0 THEN -c.balance ELSE 0 END AS debt_amount,
      ${nearestDueSql} AS due_date,
      ${latestOrderSql} AS order_id
    FROM customers c
    WHERE c.balance < 0
      AND (-c.balance) >= ?
    ORDER BY (-c.balance) DESC
    LIMIT ?
  `,
    )
    .all(minAmount, limit);
}

function alreadySentDailyDebt(db, customerId, isoDate) {
  if (!hasTable(db, 'report_notify_log')) return false;
  const day = String(isoDate || '').slice(0, 10);
  const ref = `${String(customerId)}:${day}`;
  try {
    return !!db
      .prepare(
        `SELECT 1 AS x FROM report_notify_log
         WHERE event_key = 'credit_daily_debt' AND ref_id = ? LIMIT 1`,
      )
      .get(ref);
  } catch {
    return false;
  }
}

function claimDailyDebtDedup(db, customerId, isoDate) {
  if (!hasTable(db, 'report_notify_log')) return true;
  const day = String(isoDate || '').slice(0, 10);
  const ref = `${String(customerId)}:${day}`;
  try {
    const r = db
      .prepare(
        `INSERT OR IGNORE INTO report_notify_log (event_key, ref_id, sent_at)
         VALUES ('credit_daily_debt', ?, datetime('now'))`,
      )
      .run(ref);
    return Number(r?.changes || 0) > 0;
  } catch {
    return true;
  }
}

async function deliverDailyDebtReminder({ db, debtor, settings, botToken, today }) {
  const debt = Number(debtor.debt_amount || 0) || 0;
  if (debt <= 0) return { ok: false, skipped: true, reason: 'no_debt' };

  const order = {
    id: debtor.order_id || `daily:${debtor.customer_id}`,
    order_number: null,
    customer_id: debtor.customer_id,
    customer_name: debtor.customer_name,
    credit_amount: debt,
    due_date: debtor.due_date || today,
  };

  const reminderType = `daily_${today}`;
  const out = await deliverReminder({
    db,
    order,
    reminderType,
    settings,
    botToken,
    manual: false,
  });

  // Customer-level dedup is claimed by caller; also record when we used a synthetic order id
  if (out.ok && String(order.id).startsWith('daily:')) {
    try {
      if (hasTable(db, 'credit_reminders')) {
        db.prepare(
          `INSERT OR IGNORE INTO credit_reminders
           (order_id, reminder_type, channel, status, provider_id, sent_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        ).run(
          order.id,
          reminderType,
          out.channel,
          out.status,
          out.providerId || null,
          new Date().toISOString(),
        );
      }
    } catch {
      // ignore
    }
  }

  return out;
}

function buildStaffAlertCopy(order, alertType) {
  const name = order.customer_name || 'Mijoz';
  const amount = formatSumma(order.credit_amount);
  const date = formatUzDate(order.due_date);
  const note = order.credit_reminder_note
    ? `\n${String(order.credit_reminder_note).trim()}`
    : '';
  if (alertType === 'due_minus_1') {
    return {
      title: 'Nasiya: ertaga muddat',
      body: `${name} — ${amount} so'm (${date})${note}`,
    };
  }
  if (alertType === 'overdue_3') {
    return {
      title: 'Nasiya: muddati o\'tgan',
      body: `${name} — ${amount} so'm, muddat ${date}${note}`,
    };
  }
  return {
    title: 'Nasiya: bugun muddat',
    body: `${name} — ${amount} so'm bugun qaytariladi${note}`,
  };
}

function createStaffAlertsForDueDate(db, alertType, dueDate, options = {}) {
  if (!staffInAppAlertsEnabled(db)) return 0;
  const orders = findOrdersForStaffAlert(db, alertType, dueDate, options);
  if (!orders.length) return 0;
  const ins = db.prepare(
    `INSERT OR IGNORE INTO credit_staff_alerts (order_id, alert_type, title, body, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  );
  const now = new Date().toISOString();
  let created = 0;
  for (const order of orders) {
    const copy = buildStaffAlertCopy(order, alertType);
    const out = ins.run(order.id, alertType, copy.title, copy.body, now);
    if (out.changes > 0) created += 1;
  }
  return created;
}

function listUnreadStaffCreditAlerts(db, filters = {}) {
  if (!creditStaffAlertSchemaReady(db)) return [];
  const limit = Math.min(100, Math.max(1, Number(filters.limit) || 20));
  const noteCol = hasColumn(db, 'orders', 'credit_reminder_note') ? 'o.credit_reminder_note,' : '';
  return db
    .prepare(
      `
    SELECT
      csa.id,
      csa.order_id,
      csa.alert_type,
      csa.title,
      csa.body,
      csa.created_at,
      csa.read_at,
      o.order_number,
      o.credit_amount,
      o.due_date,
      ${noteCol}
      c.name AS customer_name
    FROM credit_staff_alerts csa
    INNER JOIN orders o ON o.id = csa.order_id
    LEFT JOIN customers c ON c.id = o.customer_id
    WHERE csa.read_at IS NULL
    ORDER BY csa.created_at ASC
    LIMIT ?
  `,
    )
    .all(limit);
}

function markStaffCreditAlertRead(db, alertId) {
  if (!creditStaffAlertSchemaReady(db)) return { ok: false, error: 'schema_not_ready' };
  const id = Number(alertId);
  if (!Number.isFinite(id) || id <= 0) return { ok: false, error: 'invalid_id' };
  const row = db.prepare(`SELECT id FROM credit_staff_alerts WHERE id = ?`).get(id);
  if (!row) return { ok: false, error: 'not_found' };
  db.prepare(`UPDATE credit_staff_alerts SET read_at = ? WHERE id = ?`).run(new Date().toISOString(), id);
  return { ok: true, id };
}

function listOpenCreditOrders(db, filters = {}) {
  if (!creditReminderSchemaReady(db)) return [];
  const limit = Math.min(200, Math.max(1, Number(filters.limit) || 100));
  const offset = Math.max(0, Number(filters.offset) || 0);
  const noteCol = hasColumn(db, 'orders', 'credit_reminder_note') ? 'o.credit_reminder_note,' : '';
  let sql = `
    SELECT
      o.id,
      o.order_number,
      o.customer_id,
      o.credit_amount,
      o.due_date,
      o.payment_status,
      o.created_at,
      ${noteCol}
      c.name AS customer_name,
      c.phone AS customer_phone
    FROM orders o
    LEFT JOIN customers c ON c.id = o.customer_id
    WHERE o.status = 'completed'
      AND o.payment_status IN ('on_credit', 'partial', 'partially_paid')
      AND COALESCE(o.credit_amount, 0) > 0
  `;
  const params = [];
  if (filters.customerId) {
    sql += ' AND o.customer_id = ?';
    params.push(filters.customerId);
  }
  if (filters.missingDueDateOnly) {
    sql += ' AND o.due_date IS NULL';
  }
  sql += ' ORDER BY COALESCE(o.due_date, o.created_at) ASC, o.created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);
  return db.prepare(sql).all(...params);
}

function updateOrderDueDate(db, orderId, dueDate) {
  if (!creditReminderSchemaReady(db)) {
    return { ok: false, error: 'schema_not_ready' };
  }
  const normalized = normalizeDueDate(dueDate);
  if (!normalized) {
    return { ok: false, error: 'invalid_due_date' };
  }
  const order = db
    .prepare(
      `SELECT id, payment_status, credit_amount FROM orders WHERE id = ?`,
    )
    .get(orderId);
  if (!order) return { ok: false, error: 'order_not_found' };
  if (!isOpenCreditPaymentStatus(order.payment_status)) {
    return { ok: false, error: 'not_credit_order' };
  }
  if (Number(order.credit_amount || 0) <= 0) {
    return { ok: false, error: 'no_credit_balance' };
  }
  db.prepare(
    `UPDATE orders SET due_date = ?, updated_at = datetime('now') WHERE id = ?`,
  ).run(normalized, orderId);
  return { ok: true, due_date: normalized, order_id: orderId };
}

async function runCreditReminderTick(db, options = {}) {
  if (!creditReminderSchemaReady(db) && !hasTable(db, 'customers')) {
    return { processed: 0, sent: 0, skipped: true, reason: 'schema_not_ready' };
  }

  const settings = getCreditReminderSettings(db);
  if (!settings.enabled && !options.force) {
    return { processed: 0, sent: 0, skipped: true, reason: 'disabled' };
  }

  const gate = shouldRunScheduledTick(db, settings, options);
  if (!gate.ok) {
    return { processed: 0, sent: 0, skipped: true, reason: gate.reason };
  }

  const botToken = String(options.botToken || process.env.TELEGRAM_BOT_TOKEN || '').trim();
  const today = todayLocalDate(db);
  const minOpts = { minAmount: settings.minAmount };
  let processed = 0;
  let sent = 0;
  let dailySent = 0;
  let staffAlertsCreated = 0;

  // 1) Daily reminders for ALL open debtors (default on)
  if (settings.dailyEnabled) {
    const debtors = findDailyDebtCustomers(db, minOpts);
    for (const debtor of debtors) {
      if (!options.force && alreadySentDailyDebt(db, debtor.customer_id, today)) {
        continue;
      }
      processed += 1;
      // eslint-disable-next-line no-await-in-loop
      const out = await deliverDailyDebtReminder({
        db,
        debtor,
        settings,
        botToken,
        today,
      });
      if (out.ok) {
        sent += 1;
        dailySent += 1;
        claimDailyDebtDedup(db, debtor.customer_id, today);
      }
    }
  }

  // 2) Due-window staff alerts always; customer SMS only if daily_enabled is off
  //    (avoids double messages when daily covers all debtors)
  if (creditReminderSchemaReady(db)) {
    for (const spec of REMINDER_SPECS) {
      const dueDate = dbDateOffset(today, spec.dueOffsetDays);
      staffAlertsCreated += createStaffAlertsForDueDate(db, spec.type, dueDate, minOpts);
      if (settings.dailyEnabled) continue;
      const orders = findOrdersForReminder(db, spec.type, dueDate, minOpts);
      for (const order of orders) {
        processed += 1;
        // eslint-disable-next-line no-await-in-loop
        const out = await deliverReminder({
          db,
          order,
          reminderType: spec.type,
          settings,
          botToken,
          manual: false,
        });
        if (out.ok) sent += 1;
      }
    }
  }

  if (!options.force) {
    markCreditReminderTickRan(db, gate.today || today);
  }

  return {
    processed,
    sent,
    dailySent,
    staffAlertsCreated,
    skipped: false,
    scheduleTime: settings.scheduleTime,
    minAmount: settings.minAmount,
    dailyEnabled: settings.dailyEnabled,
  };
}

async function sendManualCreditReminder(db, orderId, options = {}) {
  if (!creditReminderSchemaReady(db)) {
    return reminderFail('schema_not_ready');
  }
  const order = db
    .prepare(
      `
    SELECT o.id, o.order_number, o.customer_id, o.credit_amount, o.due_date, o.payment_status,
           c.name AS customer_name
    FROM orders o
    LEFT JOIN customers c ON c.id = o.customer_id
    WHERE o.id = ?
  `,
    )
    .get(orderId);
  if (!order) return reminderFail('order_not_found');
  if (!isOpenCreditPaymentStatus(order.payment_status)) {
    return reminderFail('not_credit_order');
  }
  if (Number(order.credit_amount || 0) <= 0) {
    return reminderFail('no_credit_balance');
  }

  const settings = getCreditReminderSettings(db);
  const botToken = String(options.botToken || process.env.TELEGRAM_BOT_TOKEN || '').trim();
  const reminderType = options.reminderType || 'due_today';
  const out = await deliverReminder({
    db,
    order,
    reminderType,
    settings,
    botToken,
    manual: true,
  });

  if (out.ok) {
    const sentAt = new Date().toISOString();
    db.prepare(
      `INSERT OR IGNORE INTO credit_reminders
       (order_id, reminder_type, channel, status, provider_id, sent_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(order.id, `manual_${reminderType}`, out.channel, out.status, out.providerId, sentAt);
  }

  return out;
}

function findLatestCreditOrderForCustomer(db, customerId) {
  return db
    .prepare(
      `
    SELECT o.id, o.order_number, o.customer_id, o.credit_amount, o.due_date, o.payment_status,
           c.name AS customer_name
    FROM orders o
    LEFT JOIN customers c ON c.id = o.customer_id
    WHERE o.customer_id = ?
      AND o.status = 'completed'
      AND o.payment_status IN ('on_credit', 'partial', 'partially_paid')
      AND COALESCE(o.credit_amount, 0) > 0
    ORDER BY COALESCE(o.due_date, o.created_at) DESC, o.created_at DESC
    LIMIT 1
  `,
    )
    .get(customerId);
}

async function sendManualCreditReminderForCustomer(db, customerId, options = {}) {
  const order = findLatestCreditOrderForCustomer(db, customerId);
  if (!order) return reminderFail('no_open_credit_order');
  return sendManualCreditReminder(db, order.id, options);
}

function listCreditReminders(db, filters = {}) {
  if (!hasTable(db, 'credit_reminders')) return [];
  const limit = Math.min(200, Math.max(1, Number(filters.limit) || 50));
  const offset = Math.max(0, Number(filters.offset) || 0);
  let sql = `
    SELECT cr.*, o.order_number, o.due_date, o.credit_amount, c.name AS customer_name, c.phone AS customer_phone
    FROM credit_reminders cr
    INNER JOIN orders o ON o.id = cr.order_id
    LEFT JOIN customers c ON c.id = o.customer_id
    WHERE 1=1
  `;
  const params = [];
  if (filters.customerId) {
    sql += ' AND o.customer_id = ?';
    params.push(filters.customerId);
  }
  if (filters.orderId) {
    sql += ' AND cr.order_id = ?';
    params.push(filters.orderId);
  }
  sql += ' ORDER BY cr.sent_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);
  return db.prepare(sql).all(...params);
}

module.exports = {
  REMINDER_SPECS,
  VALID_CHANNELS,
  ERROR_MESSAGES_UZ,
  buildReminderMessage,
  buildStaffAlertCopy,
  claimDailyDebtDedup,
  alreadySentDailyDebt,
  countSmsSentToday,
  createStaffAlertsForDueDate,
  creditReminderSchemaReady,
  creditStaffAlertSchemaReady,
  deliverDailyDebtReminder,
  deliverReminder,
  findDailyDebtCustomers,
  findOrdersForReminder,
  findOrdersForStaffAlert,
  getCreditReminderSettings,
  getCustomerPhone,
  getTelegramIdForCustomer,
  humanizeCreditReminderError,
  listCreditReminders,
  listOpenCreditOrders,
  listUnreadStaffCreditAlerts,
  markStaffCreditAlertRead,
  normalizeScheduleTime,
  resolveChannels,
  runCreditReminderTick,
  sendManualCreditReminder,
  sendManualCreditReminderForCustomer,
  shouldRunScheduledTick,
  truncateSms,
  updateOrderDueDate,
};

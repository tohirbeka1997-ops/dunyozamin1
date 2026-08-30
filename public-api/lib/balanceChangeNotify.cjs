'use strict';

/**
 * Notify customer (DM) + staff reports channel when customer balance changes.
 * Dedup: same customer + rounded delta within 1 minute.
 */

const SettingsService = require('../../electron/services/settingsService.cjs');
const { sendSms, getSmsProvider } = require('./smsGateway.cjs');
const { sendTelegramText } = require('./telegramNotify.cjs');
const { sendToReportChats, resolveReportChatIds } = require('./reportNotify.cjs');
const { logger } = require('./logger.cjs');

const EVENT_BALANCE_CHANGE = 'balance_change';
const DEDUP_WINDOW_SECONDS = 60;

function hasTable(db, name) {
  try {
    return !!db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(name);
  } catch {
    return false;
  }
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

function toBool(v, fallback = false) {
  if (v === undefined || v === null || v === '') return fallback;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  const s = String(v).toLowerCase().trim();
  if (s === '1' || s === 'true' || s === 'yes' || s === 'on') return true;
  if (s === '0' || s === 'false' || s === 'no' || s === 'off') return false;
  return fallback;
}

function formatSumma(amount) {
  return Math.round(Number(amount) || 0).toLocaleString('uz-UZ');
}

function formatSignedSumma(amount) {
  const n = Math.round(Number(amount) || 0);
  const abs = Math.abs(n).toLocaleString('uz-UZ');
  if (n > 0) return `+${abs}`;
  if (n < 0) return `-${abs}`;
  return '0';
}

function reasonLabelUz(reason) {
  const r = String(reason || '').toLowerCase();
  if (r === 'credit_sale' || r === 'sale') return 'Nasiya / sotuv';
  if (r === 'payment_in') return "To'lov qabul qilindi";
  if (r === 'payment_out') return 'Pul berildi';
  if (r === 'refund' || r === 'return') return 'Qaytarish';
  if (r === 'adjust' || r === 'debt' || r === 'credit') return 'Hisob tuzatish';
  return 'Hisob o‘zgarishi';
}

function debtLabel(balanceAfter) {
  const bal = Number(balanceAfter) || 0;
  if (bal < 0) return `Qarz qoldig'i: ${formatSumma(-bal)} so'm`;
  if (bal > 0) return `Oldindan to'lov: ${formatSumma(bal)} so'm`;
  return "Hisob: 0 (qarz yo'q)";
}

function buildCustomerBalanceChangeText({
  customerName,
  delta,
  balanceAfter,
  currency,
  reason,
  storeName,
}) {
  const cur = String(currency || 'UZS').toUpperCase() === 'USD' ? 'USD' : "so'm";
  const lines = [
    `Hurmatli ${customerName || 'mijoz'}!`,
    `${reasonLabelUz(reason)}: ${formatSignedSumma(delta)} ${cur}.`,
    debtLabel(balanceAfter),
  ];
  if (storeName) lines.push(String(storeName));
  return lines.join('\n');
}

function buildStaffBalanceChangeText({
  customerName,
  customerId,
  delta,
  balanceAfter,
  currency,
  reason,
  refId,
  storeName,
}) {
  const cur = String(currency || 'UZS').toUpperCase() === 'USD' ? 'USD' : "so'm";
  const lines = [
    '💵 Hisob o‘zgarishi',
    storeName ? `Do'kon: ${storeName}` : null,
    customerName ? `Mijoz: ${customerName}` : null,
    customerId ? `ID: ${customerId}` : null,
    `Sabab: ${reasonLabelUz(reason)}`,
    `O‘zgarish: ${formatSignedSumma(delta)} ${cur}`,
    debtLabel(balanceAfter),
    refId ? `Ref: ${String(refId).slice(0, 48)}` : null,
  ].filter(Boolean);
  return lines.join('\n');
}

function getBalanceChangeSettings(db) {
  const channelRaw = String(readSetting(db, 'credit.reminder.channel', 'telegram_first') || 'telegram_first')
    .trim()
    .toLowerCase();
  return {
    enabled: toBool(readSetting(db, 'credit.reminder.balance_change_notify', true), true),
    smsEnabled: toBool(readSetting(db, 'credit.reminder.sms_enabled', true), true),
    telegramEnabled: toBool(readSetting(db, 'credit.reminder.telegram_enabled', true), true),
    channel: channelRaw,
    staffChannelEnabled: toBool(readSetting(db, 'reports.telegram.balance_change', true), true),
    storeName: String(
      readSetting(db, 'company_name', '') || readSetting(db, 'company.name', '') || "Do'kon",
    ).trim(),
  };
}

function makeDedupRef(customerId, delta) {
  const rounded = Math.round(Number(delta) || 0);
  return `${String(customerId)}:${rounded}`;
}

/**
 * Returns true if we should send (not a duplicate within the window).
 * Claims the slot immediately to stop parallel double-writes.
 */
function claimBalanceChangeDedup(db, customerId, delta, options = {}) {
  if (options.force) return true;
  if (!hasTable(db, 'report_notify_log')) return true;
  const ref = makeDedupRef(customerId, delta);
  const windowSec = Math.max(1, Number(options.windowSeconds) || DEDUP_WINDOW_SECONDS);
  try {
    const recent = db
      .prepare(
        `
        SELECT 1 AS x FROM report_notify_log
        WHERE event_key = ?
          AND ref_id = ?
          AND sent_at >= datetime('now', ?)
        LIMIT 1
      `,
      )
      .get(EVENT_BALANCE_CHANGE, ref, `-${windowSec} seconds`);
    if (recent) return false;

    db.prepare(
      `INSERT INTO report_notify_log (event_key, ref_id, sent_at)
       VALUES (?, ?, datetime('now'))`,
    ).run(EVENT_BALANCE_CHANGE, ref);
    return true;
  } catch {
    return true;
  }
}

function loadCustomerName(db, customerId) {
  try {
    const row = db.prepare(`SELECT name FROM customers WHERE id = ?`).get(customerId);
    return row?.name || null;
  } catch {
    return null;
  }
}

async function notifyCustomerBalanceChange(db, payload = {}, options = {}) {
  const customerId = payload.customerId || payload.customer_id;
  const delta = Number(payload.delta != null ? payload.delta : payload.signed_amount);
  if (!customerId || !Number.isFinite(delta) || delta === 0) {
    return { ok: false, skipped: true, reason: 'no_change' };
  }

  const settings = getBalanceChangeSettings(db);
  if (!settings.enabled && !options.force) {
    return { ok: false, skipped: true, reason: 'disabled' };
  }

  if (!claimBalanceChangeDedup(db, customerId, delta, options)) {
    return { ok: false, skipped: true, reason: 'dedup' };
  }

  const balanceAfter =
    payload.balanceAfter != null
      ? Number(payload.balanceAfter)
      : payload.new_balance != null
        ? Number(payload.new_balance)
        : 0;
  const currency = payload.currency || 'UZS';
  const reason = payload.reason || payload.operation || 'adjust';
  const refId = payload.refId || payload.ref_id || payload.payment_id || payload.order_id || null;
  const customerName = payload.customerName || payload.customer_name || loadCustomerName(db, customerId);
  const storeName = settings.storeName;

  const customerText = buildCustomerBalanceChangeText({
    customerName,
    delta,
    balanceAfter,
    currency,
    reason,
    storeName,
  });
  const staffText = buildStaffBalanceChangeText({
    customerName,
    customerId,
    delta,
    balanceAfter,
    currency,
    reason,
    refId,
    storeName,
  });

  const botToken = String(options.botToken || process.env.TELEGRAM_BOT_TOKEN || '').trim();
  let customerSent = false;
  let staffSent = false;
  let channels = [];

  // --- Customer DM / SMS (reuse credit reminder channel prefs) ---
  try {
    const {
      getTelegramIdForCustomer,
      getCustomerPhone,
      resolveChannels,
    } = require('./creditReminder.cjs');
    const telegramId = getTelegramIdForCustomer(db, customerId);
    const phone = getCustomerPhone(db, customerId);
    const ch = resolveChannels(
      {
        channel: settings.channel,
        telegramEnabled: settings.telegramEnabled,
        smsEnabled: settings.smsEnabled,
      },
      telegramId != null,
      !!phone,
    );

    if (ch.sendTelegram && telegramId && botToken) {
      const tgOut = await sendTelegramText({ botToken, telegramId, text: customerText });
      if (tgOut?.ok) {
        customerSent = true;
        channels.push('telegram');
      }
    }
    if (ch.sendSms && phone && settings.smsEnabled && getSmsProvider() !== 'off') {
      const smsOut = await sendSms(phone, customerText.slice(0, 160));
      if (smsOut?.ok) {
        customerSent = true;
        if (!channels.includes('sms')) channels.push('sms');
      }
    }
    // telegram_first fallback already handled by resolveChannels; sms_first fallback:
    if (!customerSent && ch.fallbackTelegram && telegramId && botToken) {
      const tgOut = await sendTelegramText({ botToken, telegramId, text: customerText });
      if (tgOut?.ok) {
        customerSent = true;
        channels.push('telegram');
      }
    }
  } catch (e) {
    logger.warn({ err: e?.message || e, customerId }, '[balance-change] customer notify failed');
  }

  // --- Staff reports channel (opt-in only; customer ops stay in private DM) ---
  // Default: skip staff to avoid spamming reports channel with every payment.
  const includeStaff =
    options.includeStaff === true ||
    (options.includeStaff !== false && options.forceStaff === true);
  if (includeStaff && settings.staffChannelEnabled) {
    try {
      const chatIds = resolveReportChatIds(db);
      if (chatIds.length && botToken) {
        const out = await sendToReportChats(db, staffText, { ...options, botToken, chatIds });
        if (out?.ok || out?.sent > 0) staffSent = true;
      }
    } catch (e) {
      logger.warn({ err: e?.message || e, customerId }, '[balance-change] staff notify failed');
    }
  }

  return {
    ok: customerSent || staffSent,
    customerSent,
    staffSent,
    channels,
    skipped: !(customerSent || staffSent),
    reason: customerSent || staffSent ? null : 'no_delivery',
  };
}

/**
 * Fire-and-forget wrapper for services (never throws into checkout / payment).
 */
function fireBalanceChangeNotify(db, payload, options = {}) {
  try {
    void notifyCustomerBalanceChange(db, payload, options).catch((e) => {
      console.warn('[balance-change] notify failed:', e?.message || e);
    });
  } catch (e) {
    console.warn('[balance-change] notify unavailable:', e?.message || e);
  }
}

module.exports = {
  EVENT_BALANCE_CHANGE,
  DEDUP_WINDOW_SECONDS,
  buildCustomerBalanceChangeText,
  buildStaffBalanceChangeText,
  claimBalanceChangeDedup,
  fireBalanceChangeNotify,
  getBalanceChangeSettings,
  makeDedupRef,
  notifyCustomerBalanceChange,
  reasonLabelUz,
};

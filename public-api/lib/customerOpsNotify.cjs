'use strict';

/**
 * Customer-only Telegram operation reports (private DM).
 * Never sends to staff / reports channel — those use reportNotify separately.
 *
 * Events: sale, credit_sale, payment_in, payment_out, refund, adjust.
 * Link: Mini App binding → customers.telegram_id → @username (via creditReminder).
 */

const SettingsService = require('../../electron/services/settingsService.cjs');
const { sendTelegramText } = require('./telegramNotify.cjs');
const { logger } = require('./logger.cjs');

const EVENT_CUSTOMER_OPS = 'customer_ops';
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

function currencyLabel(currency) {
  return String(currency || 'UZS').toUpperCase() === 'USD' ? 'USD' : "so'm";
}

function debtLabel(balanceAfter) {
  const bal = Number(balanceAfter) || 0;
  if (bal < 0) return `Qarz qoldig'i: ${formatSumma(-bal)} so'm`;
  if (bal > 0) return `Oldindan to'lov: ${formatSumma(bal)} so'm`;
  return "Hisob: 0 (qarz yo'q)";
}

function titleForReason(reason) {
  const r = String(reason || '').toLowerCase();
  if (r === 'credit_sale') return '🛒 Nasiya sotuv';
  if (r === 'sale') return '🛒 Xarid';
  if (r === 'payment_in') return "✅ To'lov qabul qilindi";
  if (r === 'payment_out') return '💸 Pul berildi';
  if (r === 'refund' || r === 'return') return '↩️ Qaytarish';
  if (r === 'debt' || r === 'credit' || r === 'adjust') return '📝 Hisob tuzatish';
  return '📋 Hisob yangilandi';
}

/**
 * Short Uzbek report card for the customer's private chat.
 */
function buildCustomerOpsReportText(payload = {}) {
  const reason = String(payload.reason || payload.operation || 'adjust').toLowerCase();
  const cur = currencyLabel(payload.currency);
  const customerName = payload.customerName || payload.customer_name || 'mijoz';
  const storeName = payload.storeName || payload.store_name || null;
  const orderNumber = payload.orderNumber || payload.order_number || null;
  const paymentNumber = payload.paymentNumber || payload.payment_number || null;
  const refId = payload.refId || payload.ref_id || null;
  const totalAmount =
    payload.totalAmount != null
      ? Number(payload.totalAmount)
      : payload.total_amount != null
        ? Number(payload.total_amount)
        : null;
  const creditAmount =
    payload.creditAmount != null
      ? Number(payload.creditAmount)
      : payload.credit_amount != null
        ? Number(payload.credit_amount)
        : null;
  const paidAmount =
    payload.paidAmount != null
      ? Number(payload.paidAmount)
      : payload.paid_amount != null
        ? Number(payload.paid_amount)
        : null;
  const delta =
    payload.delta != null
      ? Number(payload.delta)
      : payload.signed_amount != null
        ? Number(payload.signed_amount)
        : null;
  const balanceAfter =
    payload.balanceAfter != null
      ? Number(payload.balanceAfter)
      : payload.new_balance != null
        ? Number(payload.new_balance)
        : null;

  const lines = [titleForReason(reason), `Hurmatli ${customerName}!`, ''];

  if (reason === 'sale' || reason === 'credit_sale') {
    if (totalAmount != null && Number.isFinite(totalAmount)) {
      lines.push(`Summa: ${formatSumma(totalAmount)} ${cur}`);
    }
    if (paidAmount != null && Number.isFinite(paidAmount) && paidAmount > 0) {
      lines.push(`To'langan: ${formatSumma(paidAmount)} ${cur}`);
    }
    if (creditAmount != null && Number.isFinite(creditAmount) && creditAmount > 0) {
      lines.push(`Nasiya: ${formatSumma(creditAmount)} ${cur}`);
    }
  } else if (reason === 'payment_in' || reason === 'payment_out') {
    const amt =
      totalAmount != null && Number.isFinite(totalAmount)
        ? Math.abs(totalAmount)
        : delta != null && Number.isFinite(delta)
          ? Math.abs(delta)
          : null;
    if (amt != null) {
      lines.push(
        reason === 'payment_in'
          ? `Qabul qilindi: ${formatSumma(amt)} ${cur}`
          : `Berildi: ${formatSumma(amt)} ${cur}`,
      );
    }
  } else if (reason === 'refund' || reason === 'return') {
    const amt =
      totalAmount != null && Number.isFinite(totalAmount)
        ? Math.abs(totalAmount)
        : delta != null && Number.isFinite(delta)
          ? Math.abs(delta)
          : null;
    if (amt != null) lines.push(`Qaytarilgan: ${formatSumma(amt)} ${cur}`);
  } else if (delta != null && Number.isFinite(delta) && delta !== 0) {
    lines.push(`O'zgarish: ${formatSignedSumma(delta)} ${cur}`);
  }

  if (balanceAfter != null && Number.isFinite(balanceAfter)) {
    lines.push(debtLabel(balanceAfter));
  }

  if (orderNumber) lines.push(`Buyurtma: ${String(orderNumber).slice(0, 48)}`);
  else if (paymentNumber) lines.push(`To'lov: ${String(paymentNumber).slice(0, 48)}`);
  else if (refId) lines.push(`Ref: ${String(refId).slice(0, 48)}`);

  if (storeName) lines.push(String(storeName));
  return lines.filter((l, i, arr) => !(l === '' && arr[i - 1] === '')).join('\n');
}

function getCustomerOpsSettings(db) {
  return {
    enabled: toBool(readSetting(db, 'credit.reminder.balance_change_notify', true), true),
    telegramEnabled: toBool(readSetting(db, 'credit.reminder.telegram_enabled', true), true),
    storeName: String(
      readSetting(db, 'company_name', '') || readSetting(db, 'company.name', '') || "Do'kon",
    ).trim(),
  };
}

function makeDedupRef(payload = {}) {
  const customerId = String(payload.customerId || payload.customer_id || '');
  const reason = String(payload.reason || payload.operation || 'op').toLowerCase();
  const ref =
    payload.refId ||
    payload.ref_id ||
    payload.order_id ||
    payload.payment_id ||
    payload.orderNumber ||
    payload.paymentNumber ||
    '';
  if (ref) return `${customerId}:${reason}:${String(ref).slice(0, 64)}`;
  const delta = Math.round(Number(payload.delta != null ? payload.delta : payload.signed_amount) || 0);
  return `${customerId}:${reason}:${delta}`;
}

function claimCustomerOpsDedup(db, payload, options = {}) {
  if (options.force) return true;
  if (!hasTable(db, 'report_notify_log')) return true;
  const ref = makeDedupRef(payload);
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
      .get(EVENT_CUSTOMER_OPS, ref, `-${windowSec} seconds`);
    if (recent) return false;

    db.prepare(
      `INSERT INTO report_notify_log (event_key, ref_id, sent_at)
       VALUES (?, ?, datetime('now'))`,
    ).run(EVENT_CUSTOMER_OPS, ref);
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

function loadOrderTotals(db, orderId) {
  if (!orderId || !hasTable(db, 'orders')) return null;
  try {
    return db
      .prepare(
        `SELECT order_number, total_amount, paid_amount, credit_amount, customer_id
         FROM orders WHERE id = ?`,
      )
      .get(orderId);
  } catch {
    return null;
  }
}

/**
 * Dedicated customer ops bot token.
 * Prefer TELEGRAM_CUSTOMER_BOT_TOKEN. Optional fallback to TELEGRAM_BOT_TOKEN only when
 * TELEGRAM_CUSTOMER_BOT_FALLBACK=1 (documented escape hatch — not for staff/reports tokens).
 */
function resolveCustomerBotToken(options = {}) {
  const explicit = String(options.botToken || '').trim();
  if (explicit) return explicit;
  const dedicated = String(process.env.TELEGRAM_CUSTOMER_BOT_TOKEN || '').trim();
  if (dedicated) return dedicated;
  const allowFallback =
    String(process.env.TELEGRAM_CUSTOMER_BOT_FALLBACK || '').trim() === '1' ||
    options.allowMiniAppFallback === true;
  if (allowFallback) {
    return String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
  }
  return '';
}

/**
 * Notify linked customer in private Telegram chat only.
 * @returns {Promise<{ok:boolean, skipped?:boolean, reason?:string|null, customerSent?:boolean}>}
 */
async function notifyCustomerOps(db, payload = {}, options = {}) {
  const customerId = payload.customerId || payload.customer_id;
  if (!customerId) {
    return { ok: false, skipped: true, reason: 'no_customer' };
  }

  const settings = getCustomerOpsSettings(db);
  if (!settings.enabled && !options.force) {
    return { ok: false, skipped: true, reason: 'disabled' };
  }
  if (!settings.telegramEnabled && !options.force) {
    return { ok: false, skipped: true, reason: 'telegram_disabled' };
  }

  const reason = String(payload.reason || payload.operation || 'adjust').toLowerCase();
  const delta =
    payload.delta != null
      ? Number(payload.delta)
      : payload.signed_amount != null
        ? Number(payload.signed_amount)
        : null;

  // Sales may have delta=0 (fully paid) — still notify when total/order present.
  const isSale = reason === 'sale' || reason === 'credit_sale';
  const hasSaleContext =
    isSale &&
    (payload.order_id ||
      payload.orderId ||
      payload.order_number ||
      payload.orderNumber ||
      (payload.totalAmount != null && Number(payload.totalAmount) !== 0) ||
      (payload.total_amount != null && Number(payload.total_amount) !== 0));

  if (!isSale && (delta == null || !Number.isFinite(delta) || delta === 0) && !options.force) {
    return { ok: false, skipped: true, reason: 'no_change' };
  }
  if (isSale && !hasSaleContext && (delta == null || !Number.isFinite(delta) || delta === 0)) {
    return { ok: false, skipped: true, reason: 'no_sale_context' };
  }

  if (!claimCustomerOpsDedup(db, { ...payload, customerId, reason, delta }, options)) {
    return { ok: false, skipped: true, reason: 'dedup' };
  }

  let enriched = { ...payload, customerId, reason, storeName: settings.storeName };
  const orderId = payload.order_id || payload.orderId || payload.refId;
  if (isSale && orderId && !payload.orderNumber && !payload.totalAmount) {
    const order = loadOrderTotals(db, orderId);
    if (order) {
      enriched = {
        ...enriched,
        orderNumber: order.order_number,
        totalAmount: order.total_amount,
        paidAmount: order.paid_amount,
        creditAmount: order.credit_amount,
      };
    }
  }

  if (!enriched.customerName && !enriched.customer_name) {
    enriched.customerName = loadCustomerName(db, customerId);
  }

  const botToken = resolveCustomerBotToken(options);
  if (!botToken) {
    return { ok: false, skipped: true, reason: 'no_customer_bot_token' };
  }

  let telegramId = null;
  try {
    const { getTelegramIdForCustomer } = require('./creditReminder.cjs');
    telegramId = getTelegramIdForCustomer(db, customerId);
  } catch (e) {
    logger.warn({ err: e?.message || e, customerId }, '[customer-ops] resolve telegram failed');
  }

  if (telegramId == null) {
    return { ok: false, skipped: true, reason: 'no_telegram' };
  }

  const text = buildCustomerOpsReportText(enriched);
  const tgOut = await sendTelegramText({ botToken, telegramId, text });
  if (!tgOut?.ok) {
    return {
      ok: false,
      skipped: false,
      reason: tgOut?.reason || 'send_failed',
      customerSent: false,
    };
  }

  return { ok: true, customerSent: true, skipped: false, reason: null };
}

/**
 * Fire-and-forget — never throws into POS checkout / payment.
 */
function fireCustomerOpsNotify(db, payload, options = {}) {
  try {
    void notifyCustomerOps(db, payload, options).catch((e) => {
      console.warn('[customer-ops] notify failed:', e?.message || e);
    });
  } catch (e) {
    console.warn('[customer-ops] notify unavailable:', e?.message || e);
  }
}

module.exports = {
  EVENT_CUSTOMER_OPS,
  DEDUP_WINDOW_SECONDS,
  buildCustomerOpsReportText,
  claimCustomerOpsDedup,
  fireCustomerOpsNotify,
  getCustomerOpsSettings,
  makeDedupRef,
  notifyCustomerOps,
  resolveCustomerBotToken,
  titleForReason,
};

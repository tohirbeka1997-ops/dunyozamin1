'use strict';

/**
 * Staff device push via Expo Push API.
 * Tokens are stored in staff_devices.fcm_token (often ExponentPushToken[…]).
 * No-ops when EXPO_PUSH_ENABLED=0 or no tokens.
 */

const { openTenantDatabase } = require('./staffDb.cjs');
const { logger } = require('./logger.cjs');

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

function pushEnabled() {
  const raw = String(process.env.EXPO_PUSH_ENABLED || '1').trim().toLowerCase();
  return raw !== '0' && raw !== 'false' && raw !== 'off';
}

function isExpoPushToken(token) {
  const t = String(token || '').trim();
  return t.startsWith('ExponentPushToken[') || t.startsWith('ExpoPushToken[');
}

/**
 * @param {import('better-sqlite3').Database} db
 * @returns {string[]}
 */
function listStaffPushTokens(db) {
  try {
    const rows = db
      .prepare(
        `SELECT DISTINCT fcm_token AS token
         FROM staff_devices
         WHERE fcm_token IS NOT NULL AND TRIM(fcm_token) != ''`,
      )
      .all();
    return rows.map((r) => String(r.token || '').trim()).filter(isExpoPushToken);
  } catch (e) {
    logger.warn({ err: e.message || String(e) }, '[staffPush] listStaffPushTokens failed');
    return [];
  }
}

/**
 * @param {{ to: string|string[], title: string, body: string, data?: Record<string, unknown> }} msg
 */
async function sendExpoPush(msg) {
  const to = Array.isArray(msg.to) ? msg.to : [msg.to];
  const tokens = to.map((t) => String(t || '').trim()).filter(Boolean);
  if (!tokens.length) return { ok: true, sent: 0 };

  const payloads = tokens.map((token) => ({
    to: token,
    sound: 'default',
    title: msg.title,
    body: msg.body,
    data: msg.data || {},
    channelId: 'staff-orders',
  }));

  const res = await fetch(EXPO_PUSH_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Accept-Encoding': 'gzip, deflate',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payloads.length === 1 ? payloads[0] : payloads),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Expo push HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  return { ok: true, sent: tokens.length };
}

/**
 * Notify all registered staff devices for a tenant (default DB).
 * @param {{ tenant?: string, title: string, body: string, data?: Record<string, unknown> }} opts
 */
async function notifyStaffDevices(opts) {
  if (!pushEnabled()) return { ok: true, sent: 0, skipped: 'disabled' };
  try {
    const db = openTenantDatabase(opts.tenant || 'default');
    const tokens = listStaffPushTokens(db);
    if (!tokens.length) return { ok: true, sent: 0, skipped: 'no_tokens' };
    await sendExpoPush({
      to: tokens,
      title: opts.title,
      body: opts.body,
      data: opts.data,
    });
    return { ok: true, sent: tokens.length };
  } catch (e) {
    logger.warn({ err: e.message || String(e) }, '[staffPush] notifyStaffDevices failed');
    return { ok: false, sent: 0, error: e.message || String(e) };
  }
}

/**
 * Fire-and-forget helper for new web orders.
 */
function notifyStaffNewWebOrder({ tenant, orderNumber, totalAmount }) {
  const total =
    totalAmount != null && Number.isFinite(Number(totalAmount))
      ? `${Math.round(Number(totalAmount)).toLocaleString('uz-UZ')} so'm`
      : '';
  void notifyStaffDevices({
    tenant,
    title: 'Yangi onlayn buyurtma',
    body: total ? `${orderNumber} · ${total}` : String(orderNumber || 'Yangi buyurtma'),
    data: { type: 'web_order_new', order_number: orderNumber || null },
  });
}

module.exports = {
  pushEnabled,
  isExpoPushToken,
  listStaffPushTokens,
  sendExpoPush,
  notifyStaffDevices,
  notifyStaffNewWebOrder,
};

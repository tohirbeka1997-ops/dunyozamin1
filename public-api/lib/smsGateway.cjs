'use strict';

const { randomUUID } = require('crypto');
const { normalizePhoneUz } = require('../../electron/lib/phoneNormalize.cjs');
const { logger } = require('./logger.cjs');

const ESKIZ_BASE = String(process.env.ESKIZ_BASE_URL || 'https://notify.eskiz.uz/api').replace(/\/$/, '');
const PLAYMOBILE_URL = String(
  process.env.PLAYMOBILE_API_URL || 'https://send.smsxabar.uz/broker-api/send',
).trim();

let eskizTokenCache = { token: null, expiresAt: 0 };

function getSmsProvider() {
  const raw = String(process.env.SMS_PROVIDER || 'off').trim().toLowerCase();
  if (raw === 'eskiz' || raw === 'playmobile' || raw === 'off') return raw;
  return 'off';
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timeoutMs = Math.max(1000, Number.parseInt(String(process.env.SMS_TIMEOUT_MS || '12000'), 10) || 12000);
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    const text = await res.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { raw: text.slice(0, 500) };
    }
    return { ok: res.ok, status: res.status, body, text };
  } finally {
    clearTimeout(timer);
  }
}

async function getEskizToken() {
  const now = Date.now();
  if (eskizTokenCache.token && eskizTokenCache.expiresAt > now + 60_000) {
    return eskizTokenCache.token;
  }
  const email = String(process.env.ESKIZ_EMAIL || '').trim();
  const password = String(process.env.ESKIZ_PASSWORD || '').trim();
  if (!email || !password) {
    throw new Error('eskiz_credentials_missing');
  }
  const form = new URLSearchParams();
  form.set('email', email);
  form.set('password', password);
  const out = await fetchJson(`${ESKIZ_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  const token = out.body?.data?.token || out.body?.token;
  if (!out.ok || !token) {
    throw new Error(out.body?.message || out.body?.error || `eskiz_auth_${out.status}`);
  }
  eskizTokenCache = { token, expiresAt: now + 23 * 60 * 60 * 1000 };
  return token;
}

async function sendViaEskiz(phone, text) {
  const token = await getEskizToken();
  const from = String(process.env.SMS_SENDER || process.env.ESKIZ_SENDER || '4546').trim();
  const form = new URLSearchParams();
  form.set('mobile_phone', phone);
  form.set('message', text);
  if (from) form.set('from', from);
  const out = await fetchJson(`${ESKIZ_BASE}/message/sms/send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form.toString(),
  });
  const providerId =
    out.body?.id ||
    out.body?.message_id ||
    out.body?.data?.id ||
    out.body?.data?.message_id ||
    null;
  if (!out.ok) {
    return { ok: false, error: out.body?.message || out.body?.error || `eskiz_http_${out.status}` };
  }
  return { ok: true, id: providerId ? String(providerId) : undefined };
}

async function sendViaPlayMobile(phone, text) {
  const login = String(process.env.PLAYMOBILE_LOGIN || '').trim();
  const password = String(process.env.PLAYMOBILE_PASSWORD || '').trim();
  const originator = String(process.env.SMS_SENDER || process.env.PLAYMOBILE_ORIGINATOR || '').trim();
  if (!login || !password || !originator) {
    return { ok: false, error: 'playmobile_credentials_missing' };
  }
  const auth = Buffer.from(`${login}:${password}`, 'utf8').toString('base64');
  const messageId = `pos${randomUUID().replace(/-/g, '').slice(0, 24)}`;
  const payload = {
    messages: [
      {
        recipient: phone,
        'message-id': messageId,
        sms: {
          originator,
          content: { text },
        },
      },
    ],
  };
  const out = await fetchJson(PLAYMOBILE_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json; charset=UTF-8',
    },
    body: JSON.stringify(payload),
  });
  if (!out.ok) {
    const err =
      out.body?.error_description ||
      out.body?.error_code ||
      out.text?.slice(0, 200) ||
      `playmobile_http_${out.status}`;
    return { ok: false, error: String(err) };
  }
  return { ok: true, id: messageId };
}

/**
 * Send SMS to Uzbekistan mobile number.
 * @param {string} phone raw phone
 * @param {string} text message body
 * @returns {Promise<{ ok: boolean, id?: string, error?: string, skipped?: boolean }>}
 */
async function sendSms(phone, text) {
  const provider = getSmsProvider();
  if (provider === 'off') {
    return { ok: false, skipped: true, error: 'sms_provider_off' };
  }
  const normalized = normalizePhoneUz(phone);
  if (!normalized) {
    return { ok: false, error: 'invalid_phone' };
  }
  const body = String(text || '').trim();
  if (!body) {
    return { ok: false, error: 'empty_message' };
  }
  try {
    if (provider === 'eskiz') {
      return await sendViaEskiz(normalized, body);
    }
    if (provider === 'playmobile') {
      return await sendViaPlayMobile(normalized, body);
    }
    return { ok: false, skipped: true, error: 'sms_provider_off' };
  } catch (e) {
    logger.warn({ err: e?.message || e, provider }, '[sms] send failed');
    return { ok: false, error: e?.message || String(e) };
  }
}

function resetEskizTokenCache() {
  eskizTokenCache = { token: null, expiresAt: 0 };
}

module.exports = {
  sendSms,
  getSmsProvider,
  normalizePhoneUz,
  resetEskizTokenCache,
};

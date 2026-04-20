'use strict';

const crypto = require('crypto');

/**
 * Telegram Web App initData imzo tekshiruvi (TZ §6.3).
 * @see https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
function buildDataCheckString(initData) {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return { ok: false, error: 'missing_hash' };

  const pairs = [];
  for (const [key, value] of params.entries()) {
    if (key === 'hash') continue;
    pairs.push([key, value]);
  }
  pairs.sort((a, b) => a[0].localeCompare(b[0]));
  const dataCheckString = pairs.map(([k, v]) => `${k}=${v}`).join('\n');
  return { ok: true, hash, dataCheckString, params };
}

function verifyTelegramInitData(initData, botToken) {
  const built = buildDataCheckString(initData);
  if (!built.ok) return false;

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const calculated = crypto.createHmac('sha256', secretKey).update(built.dataCheckString).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(calculated, 'hex'), Buffer.from(built.hash, 'hex'));
  } catch {
    return false;
  }
}

/** initData dan auth_date ni tekshirish (sekundlar, Unix) */
function getAuthDateUnix(initData) {
  const params = new URLSearchParams(initData);
  const raw = params.get('auth_date');
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * @param {string} initData - query string format
 * @param {string} botToken
 * @param {number} maxAgeSec - default 86400 (24 soat)
 */
function assertInitDataFresh(initData, botToken, maxAgeSec = 86400) {
  if (!botToken || typeof botToken !== 'string') {
    const err = new Error('BOT_TOKEN_MISSING');
    err.code = 'BOT_TOKEN_MISSING';
    throw err;
  }
  if (!verifyTelegramInitData(initData, botToken)) {
    const err = new Error('INVALID_INIT_DATA');
    err.code = 'INVALID_INIT_DATA';
    throw err;
  }
  const authUnix = getAuthDateUnix(initData);
  if (authUnix == null) {
    const err = new Error('MISSING_AUTH_DATE');
    err.code = 'MISSING_AUTH_DATE';
    throw err;
  }
  const now = Math.floor(Date.now() / 1000);
  if (now - authUnix > maxAgeSec) {
    const err = new Error('INIT_DATA_EXPIRED');
    err.code = 'INIT_DATA_EXPIRED';
    throw err;
  }
}

/**
 * @returns {{ id: number, first_name?: string, last_name?: string, username?: string, language_code?: string } | null}
 */
function parseTelegramUser(initData) {
  const params = new URLSearchParams(initData);
  const raw = params.get('user');
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

module.exports = {
  verifyTelegramInitData,
  assertInitDataFresh,
  parseTelegramUser,
  getAuthDateUnix,
};

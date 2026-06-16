'use strict';

const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const STAFF_ACCESS_EXPIRES = process.env.STAFF_JWT_ACCESS_EXPIRES || '15m';
const STAFF_REFRESH_EXPIRES = process.env.STAFF_JWT_REFRESH_EXPIRES || '30d';

function getSecrets() {
  const access = process.env.STAFF_JWT_SECRET || process.env.JWT_SECRET;
  const refresh = process.env.STAFF_JWT_REFRESH_SECRET || process.env.JWT_REFRESH_SECRET || access;
  if (!access || String(access).length < 16) {
    const err = new Error('STAFF_JWT_SECRET (or JWT_SECRET) must be set (min 16 chars)');
    err.code = 'JWT_CONFIG';
    throw err;
  }
  return { access, refresh };
}

function signStaffAccessToken(userId, role, tenant) {
  const { access } = getSecrets();
  return jwt.sign(
    { sub: String(userId), typ: 'staff_access', role: String(role || ''), tenant: String(tenant || 'default') },
    access,
    { expiresIn: STAFF_ACCESS_EXPIRES },
  );
}

function signStaffRefreshToken(userId, jti, tenant) {
  const { refresh } = getSecrets();
  return jwt.sign(
    { sub: String(userId), typ: 'staff_refresh', jti, tenant: String(tenant || 'default') },
    refresh,
    { expiresIn: STAFF_REFRESH_EXPIRES },
  );
}

function verifyStaffAccessToken(token) {
  const { access } = getSecrets();
  const payload = jwt.verify(token, access);
  if (payload.typ !== 'staff_access') {
    const err = new Error('INVALID_TOKEN_TYPE');
    err.code = 'INVALID_TOKEN_TYPE';
    throw err;
  }
  return payload;
}

function verifyStaffRefreshToken(token) {
  const { refresh } = getSecrets();
  const payload = jwt.verify(token, refresh);
  if (payload.typ !== 'staff_refresh' || !payload.jti) {
    const err = new Error('INVALID_REFRESH');
    err.code = 'INVALID_REFRESH';
    throw err;
  }
  return payload;
}

function staffAccessExpiresInSeconds() {
  const raw = String(STAFF_ACCESS_EXPIRES).trim();
  const m = /^(\d+)([smhd])$/i.exec(raw);
  if (!m) return 900;
  const n = Number.parseInt(m[1], 10);
  const unit = m[2].toLowerCase();
  if (unit === 's') return n;
  if (unit === 'm') return n * 60;
  if (unit === 'h') return n * 3600;
  if (unit === 'd') return n * 86400;
  return 900;
}

function newJti() {
  return crypto.randomBytes(24).toString('hex');
}

module.exports = {
  signStaffAccessToken,
  signStaffRefreshToken,
  verifyStaffAccessToken,
  verifyStaffRefreshToken,
  staffAccessExpiresInSeconds,
  newJti,
};

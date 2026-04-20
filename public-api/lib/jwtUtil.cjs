'use strict';

const crypto = require('crypto');
const jwt = require('jsonwebtoken');

function getSecrets() {
  const access = process.env.JWT_SECRET;
  const refresh = process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET;
  if (!access || String(access).length < 16) {
    const err = new Error('JWT_SECRET must be set (min 16 chars)');
    err.code = 'JWT_CONFIG';
    throw err;
  }
  return { access, refresh };
}

function signAccessToken(customerId) {
  const { access } = getSecrets();
  return jwt.sign(
    { sub: String(customerId), typ: 'access' },
    access,
    { expiresIn: process.env.JWT_ACCESS_EXPIRES || '24h' }
  );
}

function signRefreshToken(customerId, jti) {
  const { refresh } = getSecrets();
  return jwt.sign(
    { sub: String(customerId), typ: 'refresh', jti },
    refresh,
    { expiresIn: process.env.JWT_REFRESH_EXPIRES || '30d' }
  );
}

function verifyAccessToken(token) {
  const { access } = getSecrets();
  const payload = jwt.verify(token, access);
  if (payload.typ !== 'access') {
    const err = new Error('INVALID_TOKEN_TYPE');
    err.code = 'INVALID_TOKEN_TYPE';
    throw err;
  }
  return payload;
}

function verifyRefreshToken(token) {
  const { refresh } = getSecrets();
  const payload = jwt.verify(token, refresh);
  if (payload.typ !== 'refresh' || !payload.jti) {
    const err = new Error('INVALID_REFRESH');
    err.code = 'INVALID_REFRESH';
    throw err;
  }
  return payload;
}

function newJti() {
  return crypto.randomBytes(24).toString('hex');
}

module.exports = {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  newJti,
};

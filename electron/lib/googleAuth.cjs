/**
 * Verify Google ID tokens (GIS / One Tap) without heavy deps.
 * Env: GOOGLE_CLIENT_ID (must match the token audience).
 */
'use strict';

function getGoogleClientId() {
  return String(process.env.GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID || '').trim();
}

function googleAuthConfigured() {
  return Boolean(getGoogleClientId());
}

/**
 * @param {string} idToken
 * @returns {Promise<{ email: string, email_verified: boolean, sub: string, name?: string, picture?: string }>}
 */
async function verifyGoogleIdToken(idToken) {
  const clientId = getGoogleClientId();
  if (!clientId) {
    const err = new Error('GOOGLE_CLIENT_ID sozlanmagan');
    err.code = 'GOOGLE_NOT_CONFIGURED';
    throw err;
  }
  const token = String(idToken || '').trim();
  if (!token || token.length < 20) {
    const err = new Error('Google token noto‘g‘ri');
    err.code = 'GOOGLE_TOKEN_INVALID';
    throw err;
  }

  const url = `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(token)}`;
  let res;
  try {
    res = await fetch(url, { method: 'GET' });
  } catch (e) {
    const err = new Error('Google token tekshirib bo‘lmadi (tarmoq)');
    err.code = 'GOOGLE_NETWORK';
    err.cause = e;
    throw err;
  }
  if (!res.ok) {
    const err = new Error('Google token yaroqsiz yoki muddati tugagan');
    err.code = 'GOOGLE_TOKEN_INVALID';
    throw err;
  }
  const data = await res.json();
  const aud = String(data.aud || '');
  if (aud !== clientId) {
    const err = new Error('Google Client ID mos kelmadi');
    err.code = 'GOOGLE_AUD_MISMATCH';
    throw err;
  }
  const email = String(data.email || '').trim().toLowerCase();
  if (!email) {
    const err = new Error('Google hisobida email yo‘q');
    err.code = 'GOOGLE_NO_EMAIL';
    throw err;
  }
  const verified =
    data.email_verified === true ||
    data.email_verified === 'true' ||
    data.email_verified === '1';
  if (!verified) {
    const err = new Error('Google email tasdiqlanmagan');
    err.code = 'GOOGLE_EMAIL_UNVERIFIED';
    throw err;
  }
  return {
    email,
    email_verified: true,
    sub: String(data.sub || ''),
    name: data.name ? String(data.name) : undefined,
    picture: data.picture ? String(data.picture) : undefined,
  };
}

module.exports = {
  getGoogleClientId,
  googleAuthConfigured,
  verifyGoogleIdToken,
};

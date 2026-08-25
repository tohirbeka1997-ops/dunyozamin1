'use strict';

/**
 * Password hashing utilities.
 *
 * Uses Node's built-in scrypt KDF (no native deps, works in Electron and
 * headless Node). Legacy SHA-256 hex digests are still accepted for verify
 * during password reset, but successful login with a legacy hash is blocked
 * until the user completes a reset (new passwords are scrypt-only).
 *
 * Stored scrypt format: `scrypt$<N>$<r>$<p>$<saltHex>$<hashHex>`
 * Legacy format: 64-char lowercase/uppercase hex (raw SHA-256 of the password)
 */

const crypto = require('crypto');

const SCRYPT_PREFIX = 'scrypt';
const SCRYPT_N = 16384; // CPU/memory cost (~16 MB at r=8)
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEYLEN = 64;
const SALT_BYTES = 16;
const MAXMEM = 64 * 1024 * 1024;

function isScryptHash(stored) {
  return typeof stored === 'string' && stored.startsWith(SCRYPT_PREFIX + '$');
}

function isLegacySha256Hash(stored) {
  return typeof stored === 'string' && /^[0-9a-f]{64}$/i.test(stored);
}

function timingSafeHexEqual(aHex, bHex) {
  try {
    const a = Buffer.from(String(aHex), 'hex');
    const b = Buffer.from(String(bHex), 'hex');
    return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Hash a plaintext password into a self-describing scrypt string.
 * @param {string} plain
 * @returns {string}
 */
function hashPassword(plain) {
  const password = String(plain == null ? '' : plain);
  const salt = crypto.randomBytes(SALT_BYTES);
  const derived = crypto.scryptSync(password, salt, KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: MAXMEM,
  });
  return [
    SCRYPT_PREFIX,
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString('hex'),
    derived.toString('hex'),
  ].join('$');
}

/**
 * Verify a plaintext password against a stored hash.
 * Accepts both scrypt strings and legacy SHA-256 hex digests.
 * @param {string} plain
 * @param {string} stored
 * @returns {boolean}
 */
function verifyPassword(plain, stored) {
  if (!stored) return false;
  const password = String(plain == null ? '' : plain);

  if (isScryptHash(stored)) {
    const parts = String(stored).split('$');
    // scrypt$N$r$p$salt$hash
    if (parts.length !== 6) return false;
    const N = Number(parts[1]);
    const r = Number(parts[2]);
    const p = Number(parts[3]);
    const salt = Buffer.from(parts[4], 'hex');
    const expectedHex = parts[5];
    if (
      !Number.isFinite(N) ||
      !Number.isFinite(r) ||
      !Number.isFinite(p) ||
      salt.length === 0 ||
      !expectedHex
    ) {
      return false;
    }
    let derivedHex;
    try {
      derivedHex = crypto
        .scryptSync(password, salt, expectedHex.length / 2, { N, r, p, maxmem: MAXMEM })
        .toString('hex');
    } catch {
      return false;
    }
    return timingSafeHexEqual(derivedHex, expectedHex);
  }

  if (isLegacySha256Hash(stored)) {
    const sha = crypto.createHash('sha256').update(password).digest('hex');
    return timingSafeHexEqual(sha, stored);
  }

  return false;
}

/**
 * Returns true if the stored hash is not in the preferred (scrypt) format and
 * should be re-hashed after a successful verify.
 * @param {string} stored
 * @returns {boolean}
 */
function needsUpgrade(stored) {
  return !isScryptHash(stored);
}

module.exports = {
  hashPassword,
  verifyPassword,
  needsUpgrade,
  isScryptHash,
  isLegacySha256Hash,
};

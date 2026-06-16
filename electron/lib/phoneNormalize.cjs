'use strict';

/**
 * Normalize Uzbekistan phone numbers to canonical digits: 998XXXXXXXXX (12 digits).
 * Accepts +998, 998, 9-digit local, and 8-9x... legacy prefixes.
 * @param {unknown} raw
 * @returns {string|null}
 */
function normalizePhoneUz(raw) {
  if (raw == null) return null;
  let compact = String(raw).trim().replace(/[\s().-]/g, '');
  if (!compact) return null;

  if (compact.startsWith('+')) {
    compact = compact.slice(1);
  }
  const digits = compact.replace(/\D/g, '');
  if (!digits) return null;

  let normalized = null;
  if (digits.startsWith('998') && digits.length >= 12) {
    normalized = digits.slice(0, 12);
  } else if (digits.length === 9) {
    // Any 9-digit local UZ number. Mobile operator prefixes include not only
    // 9x (90/91/93/94/95/97/98/99) but also 20/33/50/55/77/88 and landline
    // area codes — so accept all 9-digit locals instead of only those
    // starting with "9" (previous bug dropped 88/77/33/55/20 numbers).
    normalized = `998${digits}`;
  } else if (digits.length === 10 && digits.startsWith('8')) {
    // Legacy national trunk prefix "8" + 9-digit local (any operator).
    normalized = `998${digits.slice(1)}`;
  } else if (digits.length === 12 && digits.startsWith('998')) {
    normalized = digits;
  }

  if (!normalized || !/^998\d{9}$/.test(normalized)) {
    return null;
  }
  return normalized;
}

/**
 * Format normalized UZ phone for storage/display (+998XXXXXXXXX).
 * @param {unknown} raw
 * @returns {string|null}
 */
function formatPhoneUz(raw) {
  const normalized = normalizePhoneUz(raw);
  if (!normalized) return null;
  return `+${normalized}`;
}

module.exports = {
  normalizePhoneUz,
  formatPhoneUz,
};

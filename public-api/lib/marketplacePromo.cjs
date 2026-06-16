'use strict';

/**
 * Marketplace promo-code helpers.
 *
 * Mirrors the validation done by `POST /v1/me/promo/preview` so checkout can
 * actually apply the discount instead of only echoing the code into the note.
 * Read-only against the lazily-created `marketplace_promo_codes` table; if the
 * table is missing or the code is invalid we return a zero discount.
 */

function tableExists(db) {
  try {
    return !!db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='marketplace_promo_codes'`)
      .get();
  } catch {
    return false;
  }
}

function normalizeCode(raw) {
  return raw != null ? String(raw).trim().toUpperCase().slice(0, 32) : '';
}

/**
 * Compute the discount (in sums) a promo code grants for a given subtotal.
 * Never throws — returns { code, discount } with discount clamped to [0, subtotal].
 * @param {import('better-sqlite3').Database} db
 * @param {string} rawCode
 * @param {number} subtotal
 * @returns {{ code: string|null, discount: number }}
 */
function getPromoDiscount(db, rawCode, subtotal) {
  const code = normalizeCode(rawCode);
  const sub = Math.max(0, Math.floor(Number(subtotal) || 0));
  if (!code || sub <= 0 || !tableExists(db)) return { code: null, discount: 0 };

  let row;
  try {
    row = db
      .prepare(
        `SELECT code, discount_pct, discount_amount, min_subtotal, active, valid_until
         FROM marketplace_promo_codes
         WHERE code = ?`,
      )
      .get(code);
  } catch {
    return { code: null, discount: 0 };
  }

  if (!row || !row.active) return { code: null, discount: 0 };
  if (row.valid_until) {
    const exp = new Date(row.valid_until).getTime();
    if (Number.isFinite(exp) && exp < Date.now()) return { code: null, discount: 0 };
  }
  if (sub < Number(row.min_subtotal || 0)) return { code: null, discount: 0 };

  let discount = 0;
  if (Number.isFinite(Number(row.discount_pct)) && row.discount_pct > 0) {
    discount = Math.floor((sub * Number(row.discount_pct)) / 100);
  } else if (Number.isFinite(Number(row.discount_amount)) && row.discount_amount > 0) {
    discount = Number(row.discount_amount);
  }
  discount = Math.max(0, Math.min(sub, Math.floor(discount)));
  return { code: discount > 0 ? row.code : null, discount };
}

module.exports = { getPromoDiscount, normalizeCode };

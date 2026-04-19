const { ERROR_CODES, createError } = require('../lib/errors.cjs');

class PricingService {
  constructor(db, cacheService = null) {
    this.db = db;
    this.cacheService = cacheService;
  }

  _hasTable(name) {
    try {
      return !!this.db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?`).get(name);
    } catch {
      return false;
    }
  }

  _getSettingValue(key) {
    try {
      const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
      return row?.value ?? null;
    } catch {
      return null;
    }
  }

  _isTruthySetting(key) {
    const v = String(this._getSettingValue(key) ?? '').trim().toLowerCase();
    return v === '1' || v === 'true' || v === 'yes' || v === 'on';
  }

  getTiers() {
    if (!this._hasTable('price_tiers')) return [];
    return this.db
      .prepare(
        `
        SELECT id, code, name, priority, is_active
        FROM price_tiers
        ORDER BY priority ASC, id ASC
      `
      )
      .all();
  }

  getTierByCode(code) {
    if (!code) return null;
    if (!this._hasTable('price_tiers')) return null;
    return this.db.prepare(`SELECT * FROM price_tiers WHERE code = ?`).get(code);
  }

  getPriceForProduct({ product_id, tier_id, tier_code, currency = 'UZS', unit }) {
    if (!product_id) throw createError(ERROR_CODES.VALIDATION_ERROR, 'product_id is required');
    if (!this._hasTable('product_prices')) return null;
    let tierId = tier_id;
    if (!tierId && tier_code) {
      tierId = this.db.prepare(`SELECT id FROM price_tiers WHERE code = ?`).get(tier_code)?.id;
    }
    if (!tierId) throw createError(ERROR_CODES.VALIDATION_ERROR, 'tier_id or tier_code is required');
    if (!unit) throw createError(ERROR_CODES.VALIDATION_ERROR, 'unit is required');

    if (this.cacheService) {
      const cached = this.cacheService.getPrice({ product_id, tier_id: tierId, currency, unit });
      if (cached != null) return Number(cached || 0) || 0;
    }

    const row = this.db
      .prepare(
        `
        SELECT price
        FROM product_prices
        WHERE product_id = ?
          AND tier_id = ?
          AND currency = ?
          AND unit = ?
        LIMIT 1
      `
      )
      .get(product_id, tierId, currency, unit);

    if (row?.price != null) {
      if (this.cacheService) {
        this.cacheService.setPrice({ product_id, tier_id: tierId, currency, unit, price: Number(row.price || 0) || 0 });
      }
      return Number(row.price || 0) || 0;
    }

    const allowRetailFallback = this._isTruthySetting('pricing.allow_retail_fallback');
    if (!allowRetailFallback) return null;

    const retailId = this.db.prepare(`SELECT id FROM price_tiers WHERE code = 'retail'`).get()?.id;
    if (!retailId) return null;
    const fallbackRow = this.db
      .prepare(
        `
        SELECT price
        FROM product_prices
        WHERE product_id = ?
          AND tier_id = ?
          AND currency = ?
          AND unit = ?
        LIMIT 1
      `
      )
      .get(product_id, retailId, currency, unit);
    if (fallbackRow?.price == null) return null;
    const fallbackPrice = Number(fallbackRow.price || 0) || 0;
    if (this.cacheService) {
      this.cacheService.setPrice({ product_id, tier_id: retailId, currency, unit, price: fallbackPrice });
    }
    return fallbackPrice;
  }

  setPrice({ product_id, tier_id, currency = 'UZS', unit, price, updated_at = null }) {
    if (!product_id) throw createError(ERROR_CODES.VALIDATION_ERROR, 'product_id is required');
    if (!tier_id) throw createError(ERROR_CODES.VALIDATION_ERROR, 'tier_id is required');
    if (!unit) throw createError(ERROR_CODES.VALIDATION_ERROR, 'unit is required');
    const p = Number(price || 0);
    if (!Number.isFinite(p) || p < 0) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'price must be a non-negative number');
    }

    const now = updated_at || new Date().toISOString().replace('T', ' ').replace('Z', '').substring(0, 19);
    this.db
      .prepare(
        `
        INSERT INTO product_prices (product_id, tier_id, unit, currency, price, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(product_id, tier_id, currency, unit)
        DO UPDATE SET price = excluded.price, updated_at = excluded.updated_at
      `
      )
      .run(product_id, tier_id, unit, currency, p, now);
    if (this.cacheService) {
      this.cacheService.invalidatePricesForProduct(product_id);
    }

    return { success: true };
  }
}

module.exports = PricingService;

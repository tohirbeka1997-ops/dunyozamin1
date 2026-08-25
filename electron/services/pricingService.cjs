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

  _normalizeUnitCode(code) {
    if (!code) return 'pcs';
    const raw = String(code).trim();
    if (!raw) return 'pcs';
    const lower = raw.toLowerCase();
    if (lower === 'l') return 'L';
    if (lower === 'ml') return 'mL';
    return lower;
  }

  /**
   * Authoritative retail/master price from product_units / products (not product_prices).
   */
  _getLiveCatalogPrice(product_id, unit, tier_code = 'retail') {
    if (!product_id) return null;
    const unitNorm = this._normalizeUnitCode(unit);
    const product = this.db
      .prepare(`SELECT sale_price, master_price, base_unit, unit FROM products WHERE id = ?`)
      .get(product_id);
    if (!product) return null;

    let unitSale = null;
    let ratioToBase = 1;
    if (this._hasTable('product_units')) {
      const rows =
        this.db
          .prepare(
            `
            SELECT unit, ratio_to_base, sale_price, is_default
            FROM product_units
            WHERE product_id = ?
          `,
          )
          .all(product_id) || [];
      const picked =
        rows.find((r) => this._normalizeUnitCode(r.unit) === unitNorm) ||
        rows.find((r) => r.is_default === 1) ||
        rows[0];
      if (picked) {
        unitSale = Number(picked.sale_price ?? 0);
        ratioToBase = Number(picked.ratio_to_base ?? 1) || 1;
      }
    }

    const tier = String(tier_code || 'retail').toLowerCase();
    if (tier === 'master') {
      const masterBase = Number(product.master_price ?? 0);
      if (masterBase > 0) return masterBase * ratioToBase;
    }
    if (unitSale != null && Number.isFinite(unitSale) && unitSale > 0) return unitSale;
    if (tier === 'master') {
      const masterBase = Number(product.master_price ?? 0);
      if (masterBase > 0) return masterBase;
    }
    return Number(product.sale_price ?? 0) || null;
  }

  _resolveStoredPriceRow(product_id, tierId, currency, unit) {
    const unitNorm = this._normalizeUnitCode(unit);
    const exact = this.db
      .prepare(
        `
        SELECT price, unit
        FROM product_prices
        WHERE product_id = ?
          AND tier_id = ?
          AND currency = ?
          AND unit = ?
        LIMIT 1
      `,
      )
      .get(product_id, tierId, currency, unit);
    if (exact?.price != null) return exact;

    const rows =
      this.db
        .prepare(
          `
          SELECT price, unit
          FROM product_prices
          WHERE product_id = ?
            AND tier_id = ?
            AND currency = ?
        `,
        )
        .all(product_id, tierId, currency) || [];
    return rows.find((r) => this._normalizeUnitCode(r.unit) === unitNorm) || null;
  }

  _normalizeCurrency(currency) {
    const c = String(currency || 'UZS').trim().toUpperCase();
    return c || 'UZS';
  }

  /**
   * Live catalog (`products` / `product_units`) is always UZS.
   * Never reconcile or fall back to it for foreign currencies.
   */
  _isUzsCurrency(currency) {
    return this._normalizeCurrency(currency) === 'UZS';
  }

  /**
   * Detect USD (etc.) rows accidentally filled with UZS catalog amounts
   * (e.g. 220000 written as "USD" when catalog sale_price is 220000).
   */
  _looksLikeCorruptedForeignPrice(storedPrice, liveUzs) {
    const stored = storedPrice != null ? Number(storedPrice) : NaN;
    const live = liveUzs != null ? Number(liveUzs) : NaN;
    if (!Number.isFinite(stored) || stored <= 0) return false;
    if (!Number.isFinite(live) || live <= 0) return false;
    if (Math.abs(stored - live) <= 0.01) return true;
    // Foreign retail should be << UZS at typical FX; amount >= UZS catalog is not USD.
    if (stored >= live) return true;
    return false;
  }

  _clearStoredPrice({ product_id, tierId, currency, unit }) {
    try {
      this.db
        .prepare(
          `
          DELETE FROM product_prices
          WHERE product_id = ?
            AND tier_id = ?
            AND currency = ?
            AND unit = ?
        `,
        )
        .run(product_id, tierId, currency, unit);
      if (this.cacheService?.invalidatePricesForProduct) {
        this.cacheService.invalidatePricesForProduct(product_id);
      }
    } catch {
      /* best-effort */
    }
  }

  /**
   * For non-UZS: return stored price only (null if missing/corrupt). Never touch live UZS catalog.
   */
  _resolveForeignStoredPrice({ product_id, tierId, tier_code, currency, unit, storedPrice }) {
    const cur = this._normalizeCurrency(currency);
    const unitKey = this._normalizeUnitCode(unit);
    const stored = storedPrice != null ? Number(storedPrice) : null;
    if (stored == null || !Number.isFinite(stored) || stored <= 0) return null;

    const liveUzs = this._getLiveCatalogPrice(product_id, unitKey, tier_code);
    if (this._looksLikeCorruptedForeignPrice(stored, liveUzs)) {
      this._clearStoredPrice({ product_id, tierId, currency: cur, unit: unitKey });
      return null;
    }
    return stored;
  }

  _reconcileWithLiveCatalog({ product_id, tierId, tier_code, currency, unit, storedPrice }) {
    // Catalog is UZS-only — never write live UZS into USD/other product_prices rows.
    if (!this._isUzsCurrency(currency)) {
      return this._resolveForeignStoredPrice({
        product_id,
        tierId,
        tier_code,
        currency,
        unit,
        storedPrice,
      });
    }

    const live = this._getLiveCatalogPrice(product_id, unit, tier_code);
    if (live == null || !Number.isFinite(live) || live <= 0) {
      return storedPrice != null ? Number(storedPrice) : null;
    }
    const stored = storedPrice != null ? Number(storedPrice) : null;
    if (stored != null && Math.abs(stored - live) <= 0.01) {
      return stored;
    }
    if (this.cacheService?.invalidatePricesForProduct) {
      this.cacheService.invalidatePricesForProduct(product_id);
    }
    try {
      this.setPrice({
        product_id,
        tier_id: tierId,
        currency: 'UZS',
        unit: this._normalizeUnitCode(unit),
        price: live,
      });
    } catch {
      /* best-effort repair */
    }
    return live;
  }

  getPriceForProduct({ product_id, tier_id, tier_code, currency = 'UZS', unit }) {
    if (!product_id) throw createError(ERROR_CODES.VALIDATION_ERROR, 'product_id is required');
    if (!this._hasTable('product_prices')) return null;
    const currencyKey = this._normalizeCurrency(currency);
    const isUzs = currencyKey === 'UZS';
    let tierId = tier_id;
    let tierCode = tier_code;
    if (!tierId && tier_code) {
      const tierRow = this.db.prepare(`SELECT id, code FROM price_tiers WHERE code = ?`).get(tier_code);
      tierId = tierRow?.id;
      tierCode = tierRow?.code ?? tier_code;
    }
    if (!tierId) throw createError(ERROR_CODES.VALIDATION_ERROR, 'tier_id or tier_code is required');
    if (!unit) throw createError(ERROR_CODES.VALIDATION_ERROR, 'unit is required');
    if (!tierCode) {
      tierCode = this.db.prepare(`SELECT code FROM price_tiers WHERE id = ?`).get(tierId)?.code ?? 'retail';
    }

    const unitKey = this._normalizeUnitCode(unit);

    if (this.cacheService) {
      const cached = this.cacheService.getPrice({
        product_id,
        tier_id: tierId,
        currency: currencyKey,
        unit: unitKey,
      });
      if (cached != null) {
        if (!isUzs) {
          const foreign = this._resolveForeignStoredPrice({
            product_id,
            tierId,
            tier_code: tierCode,
            currency: currencyKey,
            unit: unitKey,
            storedPrice: cached,
          });
          if (foreign != null) return foreign;
        } else {
          const reconciled = this._reconcileWithLiveCatalog({
            product_id,
            tierId,
            tier_code: tierCode,
            currency: currencyKey,
            unit: unitKey,
            storedPrice: cached,
          });
          if (reconciled != null) return reconciled;
        }
      }
    }

    const row = this._resolveStoredPriceRow(product_id, tierId, currencyKey, unitKey);

    if (row?.price != null) {
      let price;
      if (!isUzs) {
        price = this._resolveForeignStoredPrice({
          product_id,
          tierId,
          tier_code: tierCode,
          currency: currencyKey,
          unit: unitKey,
          storedPrice: row.price,
        });
        if (price == null) return null;
      } else {
        const reconciled = this._reconcileWithLiveCatalog({
          product_id,
          tierId,
          tier_code: tierCode,
          currency: currencyKey,
          unit: unitKey,
          storedPrice: row.price,
        });
        price = reconciled != null ? reconciled : Number(row.price || 0) || 0;
      }
      if (this.cacheService) {
        this.cacheService.setPrice({
          product_id,
          tier_id: tierId,
          currency: currencyKey,
          unit: unitKey,
          price,
        });
      }
      return price;
    }

    // Live catalog is UZS — never return it as USD/foreign price.
    if (!isUzs) {
      const allowRetailFallback = this._isTruthySetting('pricing.allow_retail_fallback');
      if (!allowRetailFallback) return null;
      const retailId = this.db.prepare(`SELECT id FROM price_tiers WHERE code = 'retail'`).get()?.id;
      if (!retailId || retailId === tierId) return null;
      const fallbackRow = this._resolveStoredPriceRow(product_id, retailId, currencyKey, unitKey);
      if (fallbackRow?.price == null) return null;
      return this._resolveForeignStoredPrice({
        product_id,
        tierId: retailId,
        tier_code: 'retail',
        currency: currencyKey,
        unit: unitKey,
        storedPrice: fallbackRow.price,
      });
    }

    const liveOnly = this._getLiveCatalogPrice(product_id, unitKey, tierCode);
    if (liveOnly != null && liveOnly > 0) {
      return liveOnly;
    }

    const allowRetailFallback = this._isTruthySetting('pricing.allow_retail_fallback');
    if (!allowRetailFallback) return null;

    const retailId = this.db.prepare(`SELECT id FROM price_tiers WHERE code = 'retail'`).get()?.id;
    if (!retailId) return null;
    const fallbackRow = this._resolveStoredPriceRow(product_id, retailId, currencyKey, unitKey);
    if (fallbackRow?.price == null) return null;
    const fallbackPrice = this._reconcileWithLiveCatalog({
      product_id,
      tierId: retailId,
      tier_code: 'retail',
      currency: currencyKey,
      unit: unitKey,
      storedPrice: fallbackRow.price,
    });
    if (fallbackPrice == null) return null;
    if (this.cacheService) {
      this.cacheService.setPrice({
        product_id,
        tier_id: retailId,
        currency: currencyKey,
        unit: unitKey,
        price: fallbackPrice,
      });
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
    const currencyKey = this._normalizeCurrency(currency);

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
      .run(product_id, tier_id, unit, currencyKey, p, now);
    if (this.cacheService) {
      this.cacheService.invalidatePricesForProduct(product_id);
    }

    return { success: true };
  }
}

module.exports = PricingService;

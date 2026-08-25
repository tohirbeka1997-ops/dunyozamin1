const { ERROR_CODES, createError } = require('../lib/errors.cjs');
const { getCategorySubtreeIds } = require('../lib/categoryTree.cjs');
const { randomUUID } = require('crypto');

/**
 * Products Service
 * Handles product CRUD operations with optional stock-aware listing.
 *
 * Notes:
 * - This code supports slight schema drift by introspecting `products` columns at runtime.
 * - All methods are synchronous (better-sqlite3).
 */
class ProductsService {
  constructor(db, cacheService = null, pricingService = null) {
    this.db = db;
    this.cacheService = cacheService;
    this.pricingService = pricingService;
    this.salesService = null;
    this._productsColumns = null;
    this._orderItemsColumns = null;
    this._priceHistoryColumns = null;
  }

  /** Late-bound to avoid circular init (sales needs products; products refreshes hold orders). */
  bindSalesService(salesService) {
    this.salesService = salesService;
  }

  _getOrderItemsColumns() {
    if (this._orderItemsColumns) return this._orderItemsColumns;
    try {
      const cols = this.db.prepare('PRAGMA table_info(order_items)').all() || [];
      this._orderItemsColumns = new Set(cols.map((c) => c.name));
    } catch {
      this._orderItemsColumns = new Set();
    }
    return this._orderItemsColumns;
  }

  _hasOrderItemCol(name) {
    return this._getOrderItemsColumns().has(name);
  }

  _priceFieldsChanged(data) {
    if (!data || typeof data !== 'object') return false;
    return (
      data.sale_price !== undefined ||
      data.master_price !== undefined ||
      data.product_units !== undefined
    );
  }

  /**
   * Keep product_prices (POS complete) in sync with product_units / products.sale_price.
   * Migration 050 only backfills once (INSERT OR IGNORE); updates must refresh retail/master rows.
   */
  _syncProductPricesCatalog(productId) {
    if (!this._hasTable('product_prices') || !this._hasTable('price_tiers')) return;
    const product = this.db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
    if (!product) return;

    const retailTier = this.db.prepare(`SELECT id FROM price_tiers WHERE code = 'retail' LIMIT 1`).get();
    const masterTier = this.db.prepare(`SELECT id FROM price_tiers WHERE code = 'master' LIMIT 1`).get();
    const retailId = retailTier?.id;
    const masterId = masterTier?.id;

    const units = this._hasTable('product_units')
      ? this.db
          .prepare(
            `SELECT unit, ratio_to_base, sale_price, is_default FROM product_units WHERE product_id = ? ORDER BY is_default DESC`,
          )
          .all(productId)
      : [];

    const fallbackUnit = this._normalizeUnitCode(product.base_unit ?? product.unit ?? 'pcs');
    const unitRows =
      units.length > 0
        ? units
        : [
            {
              unit: fallbackUnit,
              ratio_to_base: 1,
              sale_price: Number(product.sale_price ?? 0) || 0,
              is_default: 1,
            },
          ];

    const defaultRow = unitRows.find((u) => u.is_default === 1) || unitRows[0];
    const defaultSale = Number(defaultRow?.sale_price ?? product.sale_price ?? 0) || 0;

    if (this._hasCol('sale_price') && defaultSale !== Number(product.sale_price ?? 0)) {
      const now = new Date().toISOString();
      this.db
        .prepare(`UPDATE products SET sale_price = ?, updated_at = ? WHERE id = ?`)
        .run(defaultSale, now, productId);
    }

    const now = new Date().toISOString().replace('T', ' ').replace('Z', '').substring(0, 19);
    const upsert = this.db.prepare(`
      INSERT INTO product_prices (product_id, tier_id, unit, currency, price, updated_at)
      VALUES (?, ?, ?, 'UZS', ?, ?)
      ON CONFLICT(product_id, tier_id, currency, unit)
      DO UPDATE SET price = excluded.price, updated_at = excluded.updated_at
    `);

    for (const u of unitRows) {
      const unit = this._normalizeUnitCode(u.unit ?? fallbackUnit);
      const ratio = Number(u.ratio_to_base ?? 1) || 1;
      const retailPrice = Number(u.sale_price ?? 0) || 0;
      if (retailId != null) {
        upsert.run(productId, retailId, unit, retailPrice, now);
      }
      const masterBase = product.master_price;
      if (masterId != null && masterBase != null && Number(masterBase) > 0) {
        const masterPrice = (Number(masterBase) || 0) * ratio;
        upsert.run(productId, masterId, unit, masterPrice, now);
      }
    }

    if (this.cacheService?.invalidatePricesForProduct) {
      this.cacheService.invalidatePricesForProduct(productId);
    }
  }

  _resolveCatalogUnitPrice(product, { saleUnit = null, tierCode = 'retail' } = {}) {
    const unitForPrice = this._normalizeUnitCode(
      saleUnit ?? product.base_unit ?? product.unit ?? 'pcs',
    );
    const tier = tierCode === 'master' ? 'master' : 'retail';
    if (this.pricingService?.getPriceForProduct) {
      try {
        const p = this.pricingService.getPriceForProduct({
          product_id: product.id,
          tier_code: tier,
          currency: 'UZS',
          unit: unitForPrice,
        });
        if (p != null && Number(p) > 0) return Number(p);
      } catch {
        /* fallback below */
      }
    }
    if (this._hasTable('product_units')) {
      const byUnit = this.db
        .prepare(`SELECT sale_price FROM product_units WHERE product_id = ? AND unit = ?`)
        .get(product.id, unitForPrice);
      if (byUnit?.sale_price != null && Number(byUnit.sale_price) > 0) {
        return Number(byUnit.sale_price);
      }
      const def = this.db
        .prepare(`SELECT sale_price FROM product_units WHERE product_id = ? AND is_default = 1`)
        .get(product.id);
      if (def?.sale_price != null && Number(def.sale_price) > 0) {
        return Number(def.sale_price);
      }
    }
    if (tier === 'master') {
      return Number(product.master_price ?? product.sale_price ?? 0) || 0;
    }
    return Number(product.sale_price ?? 0) || 0;
  }

  /**
   * Qoralama (hold) buyurtmalardagi qatorlarni katalog narxi bilan yangilash (qo‘lda narx bundan mustasno).
   */
  _refreshHoldOrderItemsForProduct(productId) {
    if (!this._hasTable('orders') || !this._hasTable('order_items')) return;
    const product = this.db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
    if (!product) return;

    const hasPriceSource = this._hasOrderItemCol('price_source');
    const hasSaleUnit = this._hasOrderItemCol('sale_unit');
    const hasPriceTier = this._hasOrderItemCol('price_tier');
    const hasFinalUnitPrice = this._hasOrderItemCol('final_unit_price');
    const hasFinalTotal = this._hasOrderItemCol('final_total');
    const hasBasePrice = this._hasOrderItemCol('base_price');
    const hasUstaPrice = this._hasOrderItemCol('usta_price');

    const rows = this.db
      .prepare(
        `
        SELECT oi.*, o.id AS order_id
        FROM order_items oi
        INNER JOIN orders o ON o.id = oi.order_id
        WHERE oi.product_id = ? AND o.status = 'hold'
      `,
      )
      .all(productId);

    const touchedOrders = new Set();
    for (const item of rows) {
      if (hasPriceSource && String(item.price_source || '').toLowerCase() === 'manual') {
        continue;
      }
      const tierCode = hasPriceTier && item.price_tier === 'master' ? 'master' : 'retail';
      const saleUnit = hasSaleUnit ? item.sale_unit : null;
      const unitPrice = this._resolveCatalogUnitPrice(product, { saleUnit, tierCode });
      const qtySale = Number(item.qty_sale ?? item.quantity ?? 0) || 0;
      const discountAmount = Number(item.discount_amount ?? 0) || 0;
      const lineTotal = unitPrice * qtySale - discountAmount;
      const finalUnitPrice = qtySale > 0 ? lineTotal / qtySale : unitPrice;

      const sets = ['unit_price = ?', 'line_total = ?'];
      const params = [unitPrice, lineTotal];
      if (hasFinalUnitPrice) {
        sets.push('final_unit_price = ?');
        params.push(finalUnitPrice);
      }
      if (hasFinalTotal) {
        sets.push('final_total = ?');
        params.push(lineTotal);
      }
      if (hasBasePrice) {
        sets.push('base_price = ?');
        params.push(unitPrice);
      }
      if (hasUstaPrice && tierCode === 'master') {
        sets.push('usta_price = ?');
        params.push(unitPrice);
      }
      params.push(item.id);
      this.db.prepare(`UPDATE order_items SET ${sets.join(', ')} WHERE id = ?`).run(...params);
      touchedOrders.add(item.order_id);
    }

    if (this.salesService?._recalculateOrderTotals) {
      for (const orderId of touchedOrders) {
        this.salesService._recalculateOrderTotals(orderId);
      }
    }
  }

  _afterCatalogPriceChange(productId) {
    this._syncProductPricesCatalog(productId);
    this._refreshHoldOrderItemsForProduct(productId);
  }

  _categoryFilterClause(filters) {
    if (!filters.category_id) return { clause: '', params: [] };
    const includeSubtree = filters.include_subcategories !== false;
    const ids = includeSubtree
      ? getCategorySubtreeIds(this.db, filters.category_id)
      : [String(filters.category_id)];
    if (ids.length === 1) {
      return { clause: ` AND p.category_id = ?`, params: [ids[0]] };
    }
    return {
      clause: ` AND p.category_id IN (${ids.map(() => '?').join(', ')})`,
      params: ids,
    };
  }

  _normalizeUnitCode(code) {
    if (!code) return null;
    const raw = String(code).trim();
    if (!raw) return null;
    // Keep compatibility with seeded units which use 'L' and 'mL'
    const lower = raw.toLowerCase();
    if (lower === 'l') return 'L';
    if (lower === 'ml') return 'mL';
    return raw;
  }

  _normalizeName(value) {
    const raw = String(value ?? '').trim().toLowerCase();
    if (!raw) return '';
    return raw.replace(/\s+/g, ' ');
  }

  _resolveUnitIdFromCode(unitCode) {
    const code = this._normalizeUnitCode(unitCode);
    if (!code) return null;
    try {
      const row = this.db.prepare('SELECT id FROM units WHERE code = ? LIMIT 1').get(code);
      return row?.id || null;
    } catch (_e) {
      return null;
    }
  }

  _padSku5(n) {
    return String(n);
  }

  _computeEan13CheckDigit(twelveDigits) {
    const s = String(twelveDigits);
    if (!/^\d{12}$/.test(s)) return null;
    let sum = 0;
    for (let i = 0; i < 12; i++) {
      const digit = Number(s[i]);
      // EAN-13: positions are 1-based from the left
      const pos = i + 1;
      sum += pos % 2 === 0 ? digit * 3 : digit;
    }
    return (10 - (sum % 10)) % 10;
  }

  _generateEan13(prefix3 = '300') {
    // 3-digit prefix + 9 random digits = 12 digits, then check digit
    const p = String(prefix3);
    if (!/^\d{3}$/.test(p)) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Barcode prefix must be 3 digits');
    }
    const nine = String(Math.floor(Math.random() * 1_000_000_000)).padStart(9, '0');
    const base12 = `${p}${nine}`;
    const check = this._computeEan13CheckDigit(base12);
    if (check === null) {
      throw createError(ERROR_CODES.INTERNAL_ERROR, 'Failed to compute barcode check digit');
    }
    return `${base12}${check}`;
  }

  _generateEan13FromBody(prefix3, nineDigits) {
    const p = String(prefix3);
    const nine = String(nineDigits);
    if (!/^\d{3}$/.test(p)) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Barcode prefix must be 3 digits');
    }
    if (!/^\d{9}$/.test(nine)) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Barcode body must be 9 digits');
    }
    const base12 = `${p}${nine}`;
    const check = this._computeEan13CheckDigit(base12);
    if (check === null) {
      throw createError(ERROR_CODES.INTERNAL_ERROR, 'Failed to compute barcode check digit');
    }
    return `${base12}${check}`;
  }

  _getProductsColumns() {
    if (this._productsColumns) return this._productsColumns;
    const cols = this.db.prepare(`PRAGMA table_info(products)`).all() || [];
    this._productsColumns = new Set(cols.map((c) => c.name));
    return this._productsColumns;
  }

  _hasCol(name) {
    return this._getProductsColumns().has(name);
  }

  /** WHERE fragment for product text search (name/sku/barcode/article/brand). */
  _productSearchWhere(raw, params) {
    const term = String(raw ?? '').trim();
    if (!term) return '';
    const search = `%${term}%`;
    const fields = [];
    if (this._hasCol('normalized_name')) {
      fields.push('p.normalized_name LIKE ?');
      params.push(`%${this._normalizeName(term)}%`);
    } else {
      fields.push('p.name LIKE ?');
      params.push(search);
    }
    fields.push('p.sku LIKE ?', 'p.barcode LIKE ?');
    params.push(search, search);
    if (this._hasCol('article')) {
      fields.push('p.article LIKE ?');
      params.push(search);
    }
    if (this._hasCol('brand')) {
      fields.push('p.brand LIKE ?');
      params.push(search);
    }
    return ` AND (${fields.join(' OR ')})`;
  }

  /**
   * Relevance CASE for product search (lower = better).
   * Exact SKU/barcode/article/brand → prefix codes → name prefix → name contains.
   * Pushes bind params onto `params` and returns SQL expression (or null if empty term).
   */
  _productSearchRankExpr(raw, params) {
    const term = String(raw ?? '').trim();
    if (!term) return null;
    const prefixSearch = `${term}%`;
    const search = `%${term}%`;
    const exactParts = ['p.sku = ?', 'p.barcode = ?'];
    params.push(term, term);
    if (this._hasCol('article')) {
      exactParts.push('UPPER(COALESCE(p.article, \'\')) = UPPER(?)');
      params.push(term);
    }
    if (this._hasCol('brand')) {
      exactParts.push('LOWER(COALESCE(p.brand, \'\')) = LOWER(?)');
      params.push(term);
    }
    const prefixParts = ['p.sku LIKE ?', 'p.barcode LIKE ?'];
    params.push(prefixSearch, prefixSearch);
    if (this._hasCol('article')) {
      prefixParts.push('p.article LIKE ?');
      params.push(prefixSearch);
    }
    if (this._hasCol('brand')) {
      prefixParts.push('p.brand LIKE ?');
      params.push(prefixSearch);
    }
    if (this._hasCol('normalized_name')) {
      const normalizedPrefix = `${this._normalizeName(term)}%`;
      const normalized = `%${this._normalizeName(term)}%`;
      params.push(normalizedPrefix, normalized);
      return `CASE
        WHEN ${exactParts.join(' OR ')} THEN 0
        WHEN ${prefixParts.join(' OR ')} THEN 1
        WHEN p.normalized_name LIKE ? THEN 2
        WHEN p.normalized_name LIKE ? THEN 3
        ELSE 4
      END`;
    }
    params.push(prefixSearch, search);
    return `CASE
      WHEN ${exactParts.join(' OR ')} THEN 0
      WHEN ${prefixParts.join(' OR ')} THEN 1
      WHEN p.name LIKE ? THEN 2
      WHEN p.name LIKE ? THEN 3
      ELSE 4
    END`;
  }

  _hasTable(name) {
    try {
      return !!this.db
        .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?")
        .get(name);
    } catch {
      return false;
    }
  }

  /**
   * Read inventory.default_min_stock from settings (Settings → Ombor UI).
   * Used as the default min_stock_level when callers don't supply one.
   */
  _readDefaultMinStock() {
    try {
      const row = this.db
        .prepare("SELECT value FROM settings WHERE key = 'inventory.default_min_stock'")
        .get();
      const n = Number(row?.value);
      if (Number.isFinite(n) && n >= 0) return Math.floor(n);
    } catch (_e) {
      // ignore
    }
    return 0;
  }

  _getPriceHistoryColumns() {
    if (this._priceHistoryColumns) return this._priceHistoryColumns;
    try {
      const cols = this.db.prepare('PRAGMA table_info(price_history)').all() || [];
      this._priceHistoryColumns = new Set(cols.map((c) => c.name));
    } catch {
      this._priceHistoryColumns = new Set();
    }
    return this._priceHistoryColumns;
  }

  _priceHistoryHasBatchId() {
    return this._getPriceHistoryColumns().has('batch_id');
  }

  _appendPriceHistoryRow({ productId, priceType, oldPrice, newPrice, changedBy, reason, unit, batchId }) {
    if (!this._hasTable('price_history')) return;
    let oldP = Number(oldPrice);
    let newP = Number(newPrice);
    if (!Number.isFinite(oldP)) oldP = 0;
    if (!Number.isFinite(newP)) newP = 0;
    if (Math.abs(oldP - newP) < 1e-6) return;
    const rid = randomUUID();
    const now = new Date().toISOString();
    const cols = ['id', 'product_id', 'price_type', 'old_price', 'new_price', 'changed_by', 'changed_at', 'reason', 'unit'];
    const vals = [rid, productId, priceType, oldP, newP, changedBy || null, now, reason || null, unit || null];
    if (batchId && this._priceHistoryHasBatchId()) {
      cols.push('batch_id');
      vals.push(batchId);
    }
    this.db
      .prepare(
        `INSERT INTO price_history (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`
      )
      .run(...vals);
  }

  _recordInitialPriceHistory(productId, row, changedBy) {
    if (!this._hasTable('price_history') || !row) return;
    const uid = changedBy || null;
    const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0) || 0;
    if (this._hasCol('purchase_price') && n(row.purchase_price) !== 0) {
      this._appendPriceHistoryRow({
        productId,
        priceType: 'purchase',
        oldPrice: 0,
        newPrice: n(row.purchase_price),
        changedBy: uid,
        reason: "Birinchi ombor narxi (yaratish)",
        unit: null,
      });
    }
    if (this._hasCol('sale_price') && n(row.sale_price) !== 0) {
      this._appendPriceHistoryRow({
        productId,
        priceType: 'sale',
        oldPrice: 0,
        newPrice: n(row.sale_price),
        changedBy: uid,
        reason: "Birinchi sotuv narxi (yaratish)",
        unit: null,
      });
    }
    if (this._hasCol('master_price') && row.master_price != null && n(row.master_price) !== 0) {
      this._appendPriceHistoryRow({
        productId,
        priceType: 'master',
        oldPrice: 0,
        newPrice: n(row.master_price),
        changedBy: uid,
        reason: "Birinchi yirik optom (yaratish)",
        unit: null,
      });
    }
    if (this._hasTable('product_units') && Array.isArray(row.product_units)) {
      for (const u of row.product_units) {
        const unit = String(u.unit || '').trim();
        if (!unit) continue;
        const sp = n(u.sale_price);
        if (sp === 0) continue;
        this._appendPriceHistoryRow({
          productId,
          priceType: 'unit',
          oldPrice: 0,
          newPrice: sp,
          changedBy: uid,
          reason: "Birlik bo'yicha birinchi sotuv (yaratish)",
          unit,
        });
      }
    }
  }

  _recordPriceHistoryAfterUpdate(productId, beforeRow, afterRow, changedBy, opts = {}) {
    if (!this._hasTable('price_history') || !beforeRow || !afterRow) return;
    const uid = changedBy || null;
    const batchId = opts.batchId || null;
    const reasonOverride = opts.reasonOverride != null ? opts.reasonOverride : null;
    const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0) || 0;
    if (this._hasCol('purchase_price')) {
      // Tannarx uchun ASL (omborda saqlangan) ustun qiymatini solishtiramiz.
      // `getById()` (before/afterRow) qabul qilingan PO tannarxi bilan ustini
      // yopadi, shu sabab faqat shu qiymatlarga tayansak — qabul qilingan PO si
      // bor mahsulotda haqiqiy o'zgarish "o'zgarmagan" ko'rinib, price_history
      // yozilmay qoladi. Mavjud bo'lsa chaqiruvchi bergan RAW qiymatlardan
      // foydalanamiz, aks holda before/afterRow ga qaytamiz.
      const rawBefore =
        opts.rawPurchaseBefore != null ? n(opts.rawPurchaseBefore) : n(beforeRow.purchase_price);
      const rawAfter =
        opts.rawPurchaseAfter != null ? n(opts.rawPurchaseAfter) : n(afterRow.purchase_price);
      if (rawBefore !== rawAfter) {
        this._appendPriceHistoryRow({
          productId,
          priceType: 'purchase',
          oldPrice: rawBefore,
          newPrice: rawAfter,
          changedBy: uid,
          reason: reasonOverride,
          unit: null,
          batchId,
        });
      }
    }
    if (this._hasCol('sale_price') && n(beforeRow.sale_price) !== n(afterRow.sale_price)) {
      this._appendPriceHistoryRow({
        productId,
        priceType: 'sale',
        oldPrice: n(beforeRow.sale_price),
        newPrice: n(afterRow.sale_price),
        changedBy: uid,
        reason: reasonOverride,
        unit: null,
        batchId,
      });
    }
    if (this._hasCol('master_price') && n(beforeRow.master_price ?? 0) !== n(afterRow.master_price ?? 0)) {
      this._appendPriceHistoryRow({
        productId,
        priceType: 'master',
        oldPrice: n(beforeRow.master_price),
        newPrice: n(afterRow.master_price),
        changedBy: uid,
        reason: reasonOverride,
        unit: null,
        batchId,
      });
    }
    if (this._hasTable('product_units')) {
      const beforeUnits = Array.isArray(beforeRow.product_units) ? beforeRow.product_units : [];
      const afterUnits = Array.isArray(afterRow.product_units) ? afterRow.product_units : [];
      const toMap = (arr) => {
        const m = new Map();
        for (const u of arr) {
          const k = String(u.unit || '').trim();
          if (k) m.set(k, n(u.sale_price));
        }
        return m;
      };
      const bm = toMap(beforeUnits);
      const am = toMap(afterUnits);
      const allKeys = new Set([...bm.keys(), ...am.keys()]);
      for (const u of allKeys) {
        const o = bm.has(u) ? bm.get(u) : 0;
        const nv = am.has(u) ? am.get(u) : 0;
        if (Math.abs(o - nv) < 1e-6) continue;
        this._appendPriceHistoryRow({
          productId,
          priceType: 'unit',
          oldPrice: o,
          newPrice: nv,
          changedBy: uid,
          reason: reasonOverride != null ? reasonOverride : "O'lchov bo'yicha sotuv",
          unit: u,
          batchId,
        });
      }
    }
  }

  _getProductUnitsByIds(ids) {
    if (!ids || ids.length === 0 || !this._hasTable('product_units')) return new Map();
    const placeholders = ids.map(() => '?').join(', ');
    const rows =
      this.db
        .prepare(
          `
          SELECT product_id, unit, ratio_to_base, sale_price, is_default
          FROM product_units
          WHERE product_id IN (${placeholders})
          ORDER BY is_default DESC, unit ASC
        `
        )
        .all(...ids) || [];
    const map = new Map();
    for (const row of rows) {
      const list = map.get(row.product_id) || [];
      list.push({
        unit: row.unit,
        ratio_to_base: Number(row.ratio_to_base ?? 1) || 1,
        sale_price: Number(row.sale_price ?? 0) || 0,
        is_default: row.is_default === 1 || row.is_default === true,
      });
      map.set(row.product_id, list);
    }
    return map;
  }

  _upsertProductUnits(productId, units, baseUnit, fallbackSalePrice) {
    if (!this._hasTable('product_units')) return;
    const list = Array.isArray(units) ? units : [];
    const safeBase = this._normalizeUnitCode(baseUnit ?? 'pcs');
    const hasAny = list.length > 0;
    const normalized = hasAny
      ? list.map((u, idx) => ({
          unit: this._normalizeUnitCode(u.unit ?? safeBase),
          ratio_to_base: Number(u.ratio_to_base ?? (u.ratioToBase ?? 1)) || 1,
          sale_price: Number(u.sale_price ?? u.salePrice ?? fallbackSalePrice ?? 0) || 0,
          is_default: u.is_default === true || u.is_default === 1 || idx === 0,
        }))
      : [
          {
            unit: safeBase,
            ratio_to_base: 1,
            sale_price: Number(fallbackSalePrice ?? 0) || 0,
            is_default: true,
          },
        ];

    // Ensure exactly one default
    if (!normalized.some((u) => u.is_default)) {
      normalized[0].is_default = true;
    }
    const defaultUnit = normalized.find((u) => u.is_default)?.unit ?? safeBase;
    const deduped = [];
    const seen = new Set();
    for (const u of normalized) {
      if (seen.has(u.unit)) continue;
      seen.add(u.unit);
      deduped.push({
        ...u,
        is_default: u.unit === defaultUnit,
      });
    }

    this.db.prepare('DELETE FROM product_units WHERE product_id = ?').run(productId);
    const stmt = this.db.prepare(
      `
      INSERT INTO product_units (id, product_id, unit, ratio_to_base, sale_price, is_default, created_at)
      VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?, ?, datetime('now'))
    `
    );
    for (const u of deduped) {
      stmt.run(productId, u.unit, u.ratio_to_base, u.sale_price, u.is_default ? 1 : 0);
    }
  }

  _normalizeVariantOptionsArray(parsed) {
    if (!Array.isArray(parsed)) return [];
    const out = [];
    for (const it of parsed) {
      if (!it || typeof it !== 'object') continue;
      const name = String(it.name ?? '').trim().slice(0, 40);
      const value = String(it.value ?? '').trim().slice(0, 120);
      if (!name || !value) continue;
      out.push({ name, value });
      if (out.length >= 16) break;
    }
    return out;
  }

  _parseVariantOptions(raw) {
    if (raw == null || raw === '') return [];
    if (Array.isArray(raw)) return this._normalizeVariantOptionsArray(raw);
    if (typeof raw === 'string') {
      try {
        return this._normalizeVariantOptionsArray(JSON.parse(raw));
      } catch {
        return [];
      }
    }
    return [];
  }

  _serializeVariantOptions(value) {
    if (value === undefined) return null;
    const norm = this._normalizeVariantOptionsArray(Array.isArray(value) ? value : []);
    if (norm.length === 0) return null;
    return JSON.stringify(norm);
  }

  _normalizeProductRow(row) {
    if (!row) return row;
    return {
      ...row,
      // Normalize SQLite INTEGER to booleans when present
      is_active: row.is_active === 1 || row.is_active === true,
      track_stock: row.track_stock === 1 || row.track_stock === true,
      show_in_marketplace:
        row.show_in_marketplace === undefined || row.show_in_marketplace === null
          ? true
          : row.show_in_marketplace === 1 || row.show_in_marketplace === true,
      variant_options: this._parseVariantOptions(row.variant_options),
    };
  }

  /**
   * SQL: latest positive unit_cost from a received PO line (same rules as InventoryService.getProductDetail).
   */
  _sqlLatestReceivedPurchaseUnitCost(alias = 'p') {
    return `(
      SELECT poi.unit_cost
      FROM purchase_order_items poi
      INNER JOIN purchase_orders po ON poi.purchase_order_id = po.id
      WHERE poi.product_id = ${alias}.id
        AND po.status = 'received'
        AND COALESCE(poi.received_qty, 0) > 0
        AND COALESCE(poi.unit_cost, 0) > 0
      ORDER BY po.created_at DESC
      LIMIT 1
    )`;
  }

  _effectivePurchasePriceForDisplay(productId, storedPurchasePrice) {
    const stored = Number(storedPurchasePrice) || 0;
    if (!productId) return stored;
    try {
      const latestPurchase = this.db
        .prepare(
          `
        SELECT poi.unit_cost
        FROM purchase_order_items poi
        INNER JOIN purchase_orders po ON poi.purchase_order_id = po.id
        WHERE poi.product_id = ?
          AND po.status = 'received'
          AND COALESCE(poi.received_qty, 0) > 0
        ORDER BY po.created_at DESC
        LIMIT 1
      `
        )
        .get(productId);
      if (latestPurchase && latestPurchase.unit_cost) {
        return Number(latestPurchase.unit_cost);
      }
    } catch (_e) {
      /* ignore */
    }
    return stored;
  }

  /** Default product_units row is authoritative for catalog retail display. */
  _effectiveSalePriceFromUnits(storedSalePrice, units = []) {
    if (!Array.isArray(units) || units.length === 0) {
      return Number(storedSalePrice ?? 0) || 0;
    }
    const defaultRow = units.find((u) => u.is_default) || units[0];
    const fromUnit = Number(defaultRow?.sale_price ?? 0);
    if (Number.isFinite(fromUnit) && fromUnit > 0) return fromUnit;
    return Number(storedSalePrice ?? 0) || 0;
  }

  _applyEffectiveSalePrice(row) {
    if (!row) return row;
    if (Array.isArray(row.product_units) && row.product_units.length > 0) {
      row.sale_price = this._effectiveSalePriceFromUnits(row.sale_price, row.product_units);
    }
    return row;
  }

  /**
   * RAW (omborda saqlangan) `products.purchase_price` qiymatini o'qiydi —
   * `getById()` dagi qabul qilingan PO tannarxi bilan ustini yopish (display
   * override) ni chetlab o'tadi. Ommaviy tannarx yangilash va price_history
   * yozuvi ASL ustun qiymati bilan ishlashi uchun kerak.
   * Mahsulot topilmasa `null` qaytaradi.
   */
  _rawStoredPurchasePrice(productId) {
    if (!this._hasCol('purchase_price') || !productId) return null;
    try {
      const row = this.db
        .prepare('SELECT purchase_price FROM products WHERE id = ?')
        .get(productId);
      if (!row) return null;
      return Number(row.purchase_price) || 0;
    } catch (_e) {
      return null;
    }
  }

  _requireNonEmptyString(value, fieldName) {
    if (typeof value !== 'string' || !value.trim()) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, `${fieldName} is required`);
    }
    return value.trim();
  }

  _toFiniteNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  _assertNonNegative(value, fieldName) {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, `${fieldName} must be >= 0`);
    }
    return n;
  }

  _ensureSkuUnique(sku, excludeId = null) {
    const row = this.db
      .prepare(`SELECT id FROM products WHERE sku = ? ${excludeId ? 'AND id != ?' : ''} LIMIT 1`)
      .get(...(excludeId ? [sku, excludeId] : [sku]));
    if (row?.id) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'SKU must be unique');
    }
  }

  _ensureBarcodeUnique(barcode, excludeId = null) {
    if (!barcode) return;
    const row = this.db
      .prepare(`SELECT id FROM products WHERE barcode = ? ${excludeId ? 'AND id != ?' : ''} LIMIT 1`)
      .get(...(excludeId ? [barcode, excludeId] : [barcode]));
    if (row?.id) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Barcode must be unique');
    }
  }

  /**
   * List products with optional filters:
   * - search, category_id, status, track_stock
   * - stock_filter ('low'|'out') + warehouse_id for stock-aware filtering
   * - sort_by/sort_order, limit/offset
   */
  list(filters = {}) {
    const params = [];
    const requestedLimit = Number(filters.limit);
    // Perf guard: computing latest PO unit_cost with a correlated subquery for every row
    // is expensive on large product lists. Keep it for focused views and small pages.
    const includeLatestPurchaseCost =
      filters.include_latest_purchase_cost === true ||
      filters.include_latest_purchase_cost === 1 ||
      String(filters.include_latest_purchase_cost || '').toLowerCase() === 'true' ||
      (Number.isFinite(requestedLimit) && requestedLimit > 0 && requestedLimit <= 300);

    const wantsWarehouse = !!filters.warehouse_id;
    const wantsStockJoin = wantsWarehouse || !!filters.stock_filter;

    // Stock join shape:
    // - If warehouse provided: join that warehouse's balance
    // - Else: sum across warehouses
    const stockJoin = wantsWarehouse
      ? `LEFT JOIN stock_balances sb ON sb.product_id = p.id AND sb.warehouse_id = ?`
      : `LEFT JOIN (
          SELECT product_id, SUM(quantity) AS quantity
          FROM stock_balances
          GROUP BY product_id
        ) sb ON sb.product_id = p.id`;

    let query = `
      SELECT
        p.*,
        ${includeLatestPurchaseCost ? `${this._sqlLatestReceivedPurchaseUnitCost('p')} AS __latest_recv_po_uc,` : `NULL AS __latest_recv_po_uc,`}
        c.name AS category_name,
        u.code AS unit_code,
        u.name AS unit_name,
        u.symbol AS unit_symbol
        ${wantsStockJoin ? ', COALESCE(sb.quantity, 0) AS stock_quantity' : ''}
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
      LEFT JOIN units u ON u.id = p.unit_id
      ${wantsStockJoin ? stockJoin : ''}
      WHERE 1=1
    `;

    if (wantsWarehouse) {
      params.push(filters.warehouse_id);
    }

    const listSearch = String(filters.search || '').trim();
    if (listSearch) {
      query += this._productSearchWhere(listSearch, params);
    }

    const catFilter = this._categoryFilterClause(filters);
    query += catFilter.clause;
    params.push(...catFilter.params);

    if (filters.status === 'active') {
      query += ` AND p.is_active = 1`;
    } else if (filters.status === 'inactive') {
      query += ` AND p.is_active = 0`;
    }

    if (filters.track_stock !== undefined) {
      query += ` AND p.track_stock = ?`;
      params.push(filters.track_stock ? 1 : 0);
    }

    if (this._hasCol('show_in_marketplace')) {
      if (filters.marketplace === 'online') {
        query += ` AND COALESCE(p.show_in_marketplace, 1) = 1`;
      } else if (filters.marketplace === 'pos_only') {
        query += ` AND COALESCE(p.show_in_marketplace, 1) = 0`;
      }
    }

    if (filters.stock_filter && wantsStockJoin) {
      if (filters.stock_filter === 'low') {
        query += ` AND COALESCE(sb.quantity, 0) > 0 AND COALESCE(sb.quantity, 0) <= COALESCE(p.min_stock_level, 0)`;
      } else if (filters.stock_filter === 'out') {
        query += ` AND COALESCE(sb.quantity, 0) <= 0`;
      }
    }

    // Sorting (whitelist)
    const sortByRaw = String(filters.sort_by || '').trim();
    const sortOrder = String(filters.sort_order || 'ASC').toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
    const sortBy = (() => {
      switch (sortByRaw) {
        case 'name':
        case 'sku':
        case 'purchase_price':
        case 'sale_price':
        case 'created_at':
        case 'updated_at':
          return `p.${sortByRaw}`;
        case 'current_stock':
        case 'stock_quantity':
          return wantsStockJoin ? 'stock_quantity' : (this._hasCol('current_stock') ? 'p.current_stock' : 'p.name');
        default:
          return `p.name`;
      }
    })();

    // When a search term is given and no explicit sort is requested, rank by relevance
    if (listSearch && !sortByRaw) {
      const rankExpr = this._productSearchRankExpr(listSearch, params);
      if (rankExpr) {
        query += ` ORDER BY ${rankExpr} ASC, ${sortBy} ${sortOrder}`;
      } else {
        query += ` ORDER BY ${sortBy} ${sortOrder}`;
      }
    } else {
      query += ` ORDER BY ${sortBy} ${sortOrder}`;
    }

    const limit = Number.isFinite(Number(filters.limit)) ? Number(filters.limit) : 1000;
    const offset = Number.isFinite(Number(filters.offset)) ? Number(filters.offset) : 0;
    query += ` LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const rows = this.db.prepare(query).all(params);
    const normalizedRows = rows.map((row) => {
      const poUc = row.__latest_recv_po_uc;
      delete row.__latest_recv_po_uc;
      const normalized = this._normalizeProductRow(row);
      if (poUc != null && Number(poUc) > 0) {
        normalized.purchase_price = Number(poUc);
      }
      // Ensure a simple `unit` field exists for UI (frontend expects 'pcs' | 'kg' | ...)
      if (normalized.unit === undefined) {
        normalized.unit = row.unit_code ?? row.unit ?? null;
      }
      // Provide a consistent `current_stock` for UI even when the column doesn't exist
      if (normalized.stock_quantity !== undefined) {
        normalized.current_stock = normalized.stock_quantity;
      }
      return normalized;
    });
    if (this._hasTable('product_units')) {
      const ids = normalizedRows.map((r) => r.id).filter(Boolean);
      const unitsMap = this._getProductUnitsByIds(ids);
      return normalizedRows.map((row) =>
        this._applyEffectiveSalePrice({
          ...row,
          product_units: unitsMap.get(row.id) || [],
          base_unit: row.base_unit ?? row.unit ?? row.unit_code ?? null,
        }),
      );
    }
    return normalizedRows;
  }

  /**
   * Lightweight POS search (thin DTO)
   * filters: { search, status, warehouse_id, limit, offset }
   */
  searchScreen(filters = {}) {
    const params = [];
    const wantsWarehouse = !!filters.warehouse_id;
    const extraSelects = [];
    if (this._hasCol('purchase_price')) {
      extraSelects.push('p.purchase_price');
    } else {
      extraSelects.push('0 AS purchase_price');
    }
    if (this._hasCol('master_price')) {
      extraSelects.push('p.master_price');
    } else {
      extraSelects.push('NULL AS master_price');
    }
    if (this._hasCol('master_min_qty')) {
      extraSelects.push('p.master_min_qty');
    } else {
      extraSelects.push('NULL AS master_min_qty');
    }
    const stockJoin = wantsWarehouse
      ? `LEFT JOIN stock_balances sb ON sb.product_id = p.id AND sb.warehouse_id = ?`
      : `LEFT JOIN (
          SELECT product_id, SUM(quantity) AS quantity
          FROM stock_balances
          GROUP BY product_id
        ) sb ON sb.product_id = p.id`;

    if (this._hasCol('brand')) extraSelects.push('p.brand');
    else extraSelects.push('NULL AS brand');
    if (this._hasCol('article')) extraSelects.push('p.article');
    else extraSelects.push('NULL AS article');

    let query = `
      SELECT
        p.id,
        p.name,
        p.sku,
        p.barcode,
        p.category_id,
        p.sale_price,
        p.image_url,
        ${extraSelects.join(', ')},
        p.min_stock_level,
        p.is_active,
        COALESCE(sb.quantity, 0) AS current_stock,
        COALESCE(u.code, p.unit) AS unit
      FROM products p
      LEFT JOIN units u ON u.id = p.unit_id
      ${stockJoin}
      WHERE 1=1
    `;

    if (wantsWarehouse) {
      params.push(filters.warehouse_id);
    }

    let searchRankClause = null;
    const screenSearch = String(filters.search || '').trim();
    if (screenSearch) {
      query += this._productSearchWhere(screenSearch, params);
      searchRankClause = this._productSearchRankExpr(screenSearch, params);
    }

    const status = filters.status || 'active';
    if (status === 'active') query += ` AND p.is_active = 1`;
    if (status === 'inactive') query += ` AND p.is_active = 0`;

    if (searchRankClause) {
      query += ` ORDER BY ${searchRankClause} ASC, p.name ASC`;
    } else {
      query += ` ORDER BY p.name ASC`;
    }
    const limit = Number.isFinite(Number(filters.limit)) ? Number(filters.limit) : 20;
    const offset = Number.isFinite(Number(filters.offset)) ? Number(filters.offset) : 0;
    query += ` LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const screenRows = this.db.prepare(query).all(params);
    if (!this._hasCol('purchase_price')) return screenRows;
    return screenRows.map((r) => ({
      ...r,
      purchase_price: this._effectivePurchasePriceForDisplay(r.id, r.purchase_price),
    }));
  }

  /**
   * Lightweight POS scan index — minimal columns/joins for fast full-catalog load.
   * filters: { status, warehouse_id, limit, offset }
   */
  listScanIndex(filters = {}) {
    const params = [];
    const wantsWarehouse = !!filters.warehouse_id;
    const stockJoin = wantsWarehouse
      ? `LEFT JOIN stock_balances sb ON sb.product_id = p.id AND sb.warehouse_id = ?`
      : `LEFT JOIN (
          SELECT product_id, SUM(quantity) AS quantity
          FROM stock_balances
          GROUP BY product_id
        ) sb ON sb.product_id = p.id`;

    const extraCols = [];
    if (this._hasCol('purchase_price')) extraCols.push('p.purchase_price');
    else extraCols.push('0 AS purchase_price');
    if (this._hasCol('master_price')) extraCols.push('p.master_price');
    else extraCols.push('NULL AS master_price');
    if (this._hasCol('master_min_qty')) extraCols.push('p.master_min_qty');
    else extraCols.push('NULL AS master_min_qty');
    if (this._hasCol('base_unit')) extraCols.push('p.base_unit');
    else extraCols.push('NULL AS base_unit');
    if (this._hasCol('category_id')) extraCols.push('p.category_id');
    else extraCols.push('NULL AS category_id');
    if (this._hasCol('brand')) extraCols.push('p.brand');
    else extraCols.push('NULL AS brand');
    if (this._hasCol('article')) extraCols.push('p.article');
    else extraCols.push('NULL AS article');

    let query = `
      SELECT
        p.id,
        p.name,
        p.sku,
        p.barcode,
        p.sale_price,
        p.track_stock,
        p.min_stock_level,
        p.is_active,
        ${extraCols.join(', ')},
        c.name AS category_name,
        COALESCE(u.code, p.unit) AS unit,
        COALESCE(sb.quantity, 0) AS current_stock
      FROM products p
      LEFT JOIN units u ON u.id = p.unit_id
      LEFT JOIN categories c ON c.id = p.category_id
      ${stockJoin}
      WHERE 1=1
    `;

    if (wantsWarehouse) params.push(filters.warehouse_id);

    const status = filters.status || 'active';
    if (status === 'active') query += ` AND p.is_active = 1`;
    else if (status === 'inactive') query += ` AND p.is_active = 0`;

    query += ` ORDER BY p.name ASC`;
    const limit = Number.isFinite(Number(filters.limit)) ? Number(filters.limit) : 10000;
    const offset = Number.isFinite(Number(filters.offset)) ? Number(filters.offset) : 0;
    query += ` LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const rows = this.db.prepare(query).all(params) || [];
    const normalizedRows = rows.map((row) => {
      const purchasePrice = this._hasCol('purchase_price')
        ? this._effectivePurchasePriceForDisplay(row.id, row.purchase_price)
        : 0;
      const baseUnit = row.base_unit ?? row.unit ?? 'pcs';
      return {
        id: row.id,
        name: row.name,
        sku: row.sku,
        barcode: row.barcode,
        sale_price: Number(row.sale_price ?? 0) || 0,
        purchase_price: Number(purchasePrice ?? 0) || 0,
        cost_price: Number(purchasePrice ?? 0) || 0,
        track_stock: row.track_stock !== 0 && row.track_stock !== false,
        current_stock: Number(row.current_stock ?? 0) || 0,
        min_stock_level: Number(row.min_stock_level ?? 0) || 0,
        is_active: row.is_active !== 0 && row.is_active !== false,
        master_price: row.master_price ?? null,
        master_min_qty: row.master_min_qty ?? null,
        base_unit: baseUnit,
        unit: row.unit ?? baseUnit,
        category_id: row.category_id ?? null,
        category_name: row.category_name ?? null,
        brand: row.brand ?? null,
        article: row.article ?? null,
      };
    });

    if (this._hasTable('product_units')) {
      const ids = normalizedRows.map((r) => r.id).filter(Boolean);
      const unitsMap = this._getProductUnitsByIds(ids);
      return normalizedRows.map((row) =>
        this._applyEffectiveSalePrice({
          ...row,
          product_units: unitsMap.get(row.id) || [],
          base_unit: row.base_unit ?? row.unit ?? 'pcs',
        }),
      );
    }
    return normalizedRows;
  }

  /**
   * Batched barcode/SKU resolve for POS scan fallback (single round-trip).
   * keys: string[] — lookup variants; returns { product, matchKind, matchedKey } | null
   */
  resolveScan(rawKeys = [], opts = {}) {
    const keys = [
      ...new Set(
        (Array.isArray(rawKeys) ? rawKeys : [])
          .map((k) => String(k || '').trim())
          .filter(Boolean)
      ),
    ];
    if (!keys.length) return null;

    const tryBarcode = (key) => {
      try {
        const product = this.getByBarcode(key);
        if (product) return { product, matchKind: 'barcode', matchedKey: key };
      } catch (err) {
        if (!err || err.code !== ERROR_CODES.NOT_FOUND) throw err;
      }
      return null;
    };

    const trySku = (key) => {
      try {
        const product = this.getBySku(key);
        if (product) return { product, matchKind: 'sku', matchedKey: key };
      } catch (err) {
        if (!err || err.code !== ERROR_CODES.NOT_FOUND) throw err;
      }
      return null;
    };

    for (const key of keys) {
      const looksLikeBarcode = key.length >= 8;
      let hit = null;
      if (looksLikeBarcode) {
        hit = tryBarcode(key);
        if (!hit && key.length <= 8) hit = trySku(key);
      } else {
        hit = trySku(key);
        if (!hit) hit = tryBarcode(key);
      }
      if (hit) return hit;
    }

    const nameTerm = keys.join(' ').trim();
    if (nameTerm.length >= 2) {
      const params = [];
      let query = `
        SELECT p.id
        FROM products p
        WHERE 1=1
      `;
      query += this._productSearchWhere(nameTerm, params);
      query += ` ORDER BY p.name ASC LIMIT 5`;
      const rows = this.db.prepare(query).all(params) || [];
      if (rows.length === 1) {
        const product = this.getById(rows[0].id);
        if (product) return { product, matchKind: 'sku', matchedKey: nameTerm };
      }
      const exact = rows.find((r) => {
        const p = this.db.prepare('SELECT name FROM products WHERE id = ?').get(r.id);
        return String(p?.name || '').toLowerCase() === nameTerm.toLowerCase();
      });
      if (exact) {
        const product = this.getById(exact.id);
        if (product) return { product, matchKind: 'sku', matchedKey: nameTerm };
      }
    }
    return null;
  }

  /**
   * Count products for the same filter set as `list()` (without pagination).
   * Useful for paginated UIs to show accurate totals.
   */
  count(filters = {}) {
    const params = [];

    const wantsWarehouse = !!filters.warehouse_id;
    const wantsStockJoin = wantsWarehouse || !!filters.stock_filter;

    const stockJoin = wantsWarehouse
      ? `LEFT JOIN stock_balances sb ON sb.product_id = p.id AND sb.warehouse_id = ?`
      : `LEFT JOIN (
          SELECT product_id, SUM(quantity) AS quantity
          FROM stock_balances
          GROUP BY product_id
        ) sb ON sb.product_id = p.id`;

    let query = `
      SELECT COUNT(1) AS cnt
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
      LEFT JOIN units u ON u.id = p.unit_id
      ${wantsStockJoin ? stockJoin : ''}
      WHERE 1=1
    `;

    if (wantsWarehouse) {
      params.push(filters.warehouse_id);
    }

    const countSearch = String(filters.search || '').trim();
    if (countSearch) {
      query += this._productSearchWhere(countSearch, params);
    }

    const catFilter = this._categoryFilterClause(filters);
    query += catFilter.clause;
    params.push(...catFilter.params);

    if (filters.status === 'active') {
      query += ` AND p.is_active = 1`;
    } else if (filters.status === 'inactive') {
      query += ` AND p.is_active = 0`;
    }

    if (filters.track_stock !== undefined) {
      query += ` AND p.track_stock = ?`;
      params.push(filters.track_stock ? 1 : 0);
    }

    if (this._hasCol('show_in_marketplace')) {
      if (filters.marketplace === 'online') {
        query += ` AND COALESCE(p.show_in_marketplace, 1) = 1`;
      } else if (filters.marketplace === 'pos_only') {
        query += ` AND COALESCE(p.show_in_marketplace, 1) = 0`;
      }
    }

    if (filters.stock_filter && wantsStockJoin) {
      if (filters.stock_filter === 'low') {
        query += ` AND COALESCE(sb.quantity, 0) > 0 AND COALESCE(sb.quantity, 0) <= COALESCE(p.min_stock_level, 0)`;
      } else if (filters.stock_filter === 'out') {
        query += ` AND COALESCE(sb.quantity, 0) <= 0`;
      }
    }

    const row = this.db.prepare(query).get(params);
    return Number(row?.cnt || 0) || 0;
  }

  /**
   * Get product by ID
   */
  getById(id) {
    if (!id) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Product ID is required');
    }
    if (this.cacheService) {
      const cached = this.cacheService.getProductById(id);
      if (cached) return cached;
    }
    let row;
    try {
      row = this.db
        .prepare(
          `
          SELECT
            p.*,
            c.name AS category_name,
            u.code AS unit_code,
            u.name AS unit_name,
            u.symbol AS unit_symbol
          FROM products p
          LEFT JOIN categories c ON c.id = p.category_id
          LEFT JOIN units u ON u.id = p.unit_id
          WHERE p.id = ?
          LIMIT 1
        `
        )
        .get(id);
    } catch (_e) {
      // Fallback for older schemas without joins
      row = this.db.prepare(`SELECT * FROM products WHERE id = ?`).get(id);
    }
    if (!row) {
      throw createError(ERROR_CODES.NOT_FOUND, `Product with id ${id} not found`);
    }
    const normalized = this._normalizeProductRow(row);
    // Ensure a simple `unit` field exists for UI (frontend expects 'pcs' | 'kg' | ...)
    if (normalized.unit === undefined) {
      normalized.unit = row.unit_code ?? row.unit ?? null;
    }
    if (this._hasCol('purchase_price')) {
      normalized.purchase_price = this._effectivePurchasePriceForDisplay(
        normalized.id,
        normalized.purchase_price
      );
    }
    if (this._hasTable('product_units')) {
      const unitsMap = this._getProductUnitsByIds([normalized.id]);
      normalized.product_units = unitsMap.get(normalized.id) || [];
      normalized.base_unit = normalized.base_unit ?? normalized.unit ?? row.unit_code ?? null;
      this._applyEffectiveSalePrice(normalized);
    }
    if (this.cacheService) this.cacheService.setProduct(normalized);
    return normalized;
  }

  /**
   * Get product by SKU
   */
  _queryProductRowBySku(sku) {
    try {
      return this.db
        .prepare(
          `
          SELECT
            p.*,
            c.name AS category_name,
            u.code AS unit_code,
            u.name AS unit_name,
            u.symbol AS unit_symbol
          FROM products p
          LEFT JOIN categories c ON c.id = p.category_id
          LEFT JOIN units u ON u.id = p.unit_id
          WHERE p.sku = ?
          LIMIT 1
        `
        )
        .get(sku);
    } catch (_e) {
      return this.db.prepare(`SELECT * FROM products WHERE sku = ?`).get(sku);
    }
  }

  getBySku(sku) {
    const s = this._requireNonEmptyString(sku, 'SKU');
    if (this.cacheService) {
      const cached = this.cacheService.getProductBySku(s);
      if (cached) return cached;
    }
    const candidates = [s];
    const trimmedLeadingZeros = s.replace(/^0+/, '') || '0';
    if (trimmedLeadingZeros !== s) candidates.push(trimmedLeadingZeros);
    const skuNormalized = s.toLowerCase().replace(/[\s\-_]/g, '');
    if (skuNormalized && skuNormalized !== s) candidates.push(skuNormalized);

    let row = null;
    for (const candidate of candidates) {
      row = this._queryProductRowBySku(candidate);
      if (row) break;
    }
    if (!row) {
      throw createError(ERROR_CODES.NOT_FOUND, `Product with sku ${s} not found`);
    }
    const normalized = this._normalizeProductRow(row);
    if (normalized.unit === undefined) {
      normalized.unit = row.unit_code ?? row.unit ?? null;
    }
    if (this._hasCol('purchase_price')) {
      normalized.purchase_price = this._effectivePurchasePriceForDisplay(
        normalized.id,
        normalized.purchase_price
      );
    }
    if (this._hasTable('product_units')) {
      const unitsMap = this._getProductUnitsByIds([normalized.id]);
      normalized.product_units = unitsMap.get(normalized.id) || [];
      normalized.base_unit = normalized.base_unit ?? normalized.unit ?? row.unit_code ?? null;
      this._applyEffectiveSalePrice(normalized);
    }
    if (this.cacheService) this.cacheService.setProduct(normalized);
    return normalized;
  }

  /**
   * Get product by barcode
   */
  _queryProductRowByBarcode(barcode) {
    try {
      return this.db
        .prepare(
          `
          SELECT
            p.*,
            c.name AS category_name,
            u.code AS unit_code,
            u.name AS unit_name,
            u.symbol AS unit_symbol
          FROM products p
          LEFT JOIN categories c ON c.id = p.category_id
          LEFT JOIN units u ON u.id = p.unit_id
          WHERE p.barcode = ?
          LIMIT 1
        `
        )
        .get(barcode);
    } catch (_e) {
      return this.db.prepare(`SELECT * FROM products WHERE barcode = ?`).get(barcode);
    }
  }

  getByBarcode(barcode) {
    const b = this._requireNonEmptyString(barcode, 'Barcode');
    const candidates = [b];
    const digitsOnly = b.replace(/[^\d]/g, '');
    if (digitsOnly && digitsOnly !== b) candidates.push(digitsOnly);
    const upper = b.toUpperCase();
    if (upper !== b) candidates.push(upper);
    const lower = b.toLowerCase();
    if (lower !== b) candidates.push(lower);

    if (this.cacheService) {
      for (const candidate of candidates) {
        const cached = this.cacheService.getProductByBarcode(candidate);
        if (cached) return cached;
      }
    }

    let row = null;
    for (const candidate of candidates) {
      row = this._queryProductRowByBarcode(candidate);
      if (row) break;
    }
    if (!row) {
      throw createError(ERROR_CODES.NOT_FOUND, `Product with barcode ${b} not found`);
    }
    const normalized = this._normalizeProductRow(row);
    if (normalized.unit === undefined) {
      normalized.unit = row.unit_code ?? row.unit ?? null;
    }
    if (this._hasCol('purchase_price')) {
      normalized.purchase_price = this._effectivePurchasePriceForDisplay(
        normalized.id,
        normalized.purchase_price
      );
    }
    if (this._hasTable('product_units')) {
      const unitsMap = this._getProductUnitsByIds([normalized.id]);
      normalized.product_units = unitsMap.get(normalized.id) || [];
      normalized.base_unit = normalized.base_unit ?? normalized.unit ?? row.unit_code ?? null;
      this._applyEffectiveSalePrice(normalized);
    }
    if (this.cacheService) this.cacheService.setProduct(normalized);
    return normalized;
  }

  /**
   * Generate next SKU in 5-digit numeric format: `00001`, `00002`, ...
   *
   * IMPORTANT:
   * - We intentionally reuse gaps (e.g. if 00003 is missing, return 00003).
   * - We DO NOT use a recursive CTE because SQLite recursion depth may be limited (often 1000),
   *   which breaks once SKUs exceed that range (e.g. 09001).
   */
  getNextSku() {
    // Consider only purely numeric SKUs; ignore legacy/non-numeric formats.
    // Fetch sorted numeric SKUs and find the smallest missing positive integer.
    const rows = this.db
      .prepare(
        `
        SELECT CAST(sku AS INTEGER) AS n
        FROM products
        WHERE sku GLOB '[0-9]*'
          AND sku NOT GLOB '*[^0-9]*'
        ORDER BY n ASC
      `
      )
      .all();

    let expected = 1;
    for (const r of rows) {
      const n = Number(r?.n);
      if (!Number.isFinite(n) || n <= 0) continue;
      if (n < expected) continue;
      if (n === expected) {
        expected++;
        continue;
      }
      // n > expected => gap found
      break;
    }

    if (expected > 99999) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'SKU range exhausted (max 99999)');
    }

    return this._padSku5(expected);
  }

  /**
   * Generate a new unique EAN-13 barcode (numeric 13 digits).
   * Uses a reserved 300- prefix by default, then random digits + check digit.
   */
  getNextBarcode() {
    // Try multiple times to avoid (very unlikely) collisions.
    for (let i = 0; i < 25; i++) {
      const barcode = this._generateEan13('300');
      const exists = this.db.prepare(`SELECT 1 AS ok FROM products WHERE barcode = ? LIMIT 1`).get(barcode);
      if (!exists) return barcode;
    }
    // Deterministic fallback (timestamp-based) to guarantee progress even under extreme collision scenarios.
    const base = Number(Date.now() % 1_000_000_000);
    for (let i = 0; i < 5000; i++) {
      const n = (base + i) % 1_000_000_000;
      const nine = String(n).padStart(9, '0');
      const barcode = this._generateEan13FromBody('300', nine);
      const exists = this.db.prepare(`SELECT 1 AS ok FROM products WHERE barcode = ? LIMIT 1`).get(barcode);
      if (!exists) return barcode;
    }
    throw createError(ERROR_CODES.INTERNAL_ERROR, 'Failed to generate a unique barcode');
  }

  /**
   * Generate a new unique EAN-13 barcode depending on product unit.
   *
   * - Piece goods (default): 300- prefix
   * - Weight goods (kg): 310- prefix (kept away from scale prefixes 20-29)
   */
  getNextBarcodeForUnit(unit) {
    const u = String(unit ?? '').trim().toLowerCase();
    const prefix3 = u === 'kg' ? '310' : '300';

    for (let i = 0; i < 25; i++) {
      const barcode = this._generateEan13(prefix3);
      const exists = this.db.prepare(`SELECT 1 AS ok FROM products WHERE barcode = ? LIMIT 1`).get(barcode);
      if (!exists) return barcode;
    }
    const base = Number(Date.now() % 1_000_000_000);
    for (let i = 0; i < 5000; i++) {
      const n = (base + i) % 1_000_000_000;
      const nine = String(n).padStart(9, '0');
      const barcode = this._generateEan13FromBody(prefix3, nine);
      const exists = this.db.prepare(`SELECT 1 AS ok FROM products WHERE barcode = ? LIMIT 1`).get(barcode);
      if (!exists) return barcode;
    }
    throw createError(ERROR_CODES.INTERNAL_ERROR, 'Failed to generate a unique barcode');
  }

  /**
   * Create product
   */
  create(data, meta = {}) {
    if (!data || typeof data !== 'object') {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Product data is required');
    }

    const name = this._requireNonEmptyString(data.name, 'Product name');
    const sku = this._requireNonEmptyString(data.sku, 'SKU');
    const barcode = data.barcode ? String(data.barcode).trim() : null;
    const purchasePrice = this._assertNonNegative(data.purchase_price ?? 0, 'purchase_price');
    const salePrice = this._assertNonNegative(data.sale_price ?? 0, 'sale_price');
    const minStockLevel = this._assertNonNegative(
      data.min_stock_level ?? this._readDefaultMinStock(),
      'min_stock_level'
    );
    const currentStock = this._toFiniteNumber(data.current_stock ?? 0, 0);
    if (currentStock < 0) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'current_stock must be >= 0');
    }
    if (data.master_min_qty !== undefined && data.master_min_qty !== null) {
      this._assertNonNegative(data.master_min_qty, 'master_min_qty');
    }

    this._ensureSkuUnique(sku);
    this._ensureBarcodeUnique(barcode);

    const id = randomUUID();
    const now = new Date().toISOString();

    // Build insert dynamically based on existing columns
    const cols = [];
    const placeholders = [];
    const values = [];
    const add = (col, value) => {
      if (!this._hasCol(col)) return;
      cols.push(col);
      placeholders.push('?');
      values.push(value);
    };

    add('id', id);
    add('sku', sku);
    add('barcode', barcode);
    add('name', name);
    if (this._hasCol('normalized_name')) add('normalized_name', this._normalizeName(name));
    add('description', data.description ?? null);
    add('category_id', data.category_id ?? null);

    // unit/unit_id support (older schema uses `unit`, newer uses `unit_id`)
    if (this._hasCol('unit_id')) {
      const resolvedUnitId =
        data.unit_id ??
        (data.unit ? this._resolveUnitIdFromCode(data.unit) : null);
      add('unit_id', resolvedUnitId ?? null);
    }
    if (this._hasCol('unit')) add('unit', this._normalizeUnitCode(data.unit ?? 'pcs'));
    if (this._hasCol('base_unit')) {
      add('base_unit', this._normalizeUnitCode(data.base_unit ?? data.unit ?? 'pcs'));
    }

    add('purchase_price', purchasePrice);
    add('sale_price', salePrice);
    // Dual pricing (optional columns)
    if (data.master_price !== undefined) add('master_price', data.master_price === null ? null : (Number(data.master_price) || 0));
    if (data.master_min_qty !== undefined) add('master_min_qty', data.master_min_qty === null ? null : (Number(data.master_min_qty) || 0));
    // Brand and article (optional columns added in migration 061)
    if (data.brand !== undefined) add('brand', data.brand ? String(data.brand).trim() || null : null);
    if (data.article !== undefined) add('article', data.article ? String(data.article).trim().toUpperCase() || null : null);
    add('min_stock_level', minStockLevel);
    add('max_stock_level', data.max_stock_level !== undefined ? Number(data.max_stock_level) : null);
    add('track_stock', data.track_stock !== undefined ? (data.track_stock ? 1 : 0) : 1);
    add('image_url', data.image_url ?? null);
    add('image', data.image ?? null);
    add('is_active', data.is_active !== undefined ? (data.is_active ? 1 : 0) : 1);
    if (data.show_in_marketplace !== undefined) {
      add('show_in_marketplace', data.show_in_marketplace ? 1 : 0);
    } else if (this._hasCol('show_in_marketplace')) {
      add('show_in_marketplace', 1);
    }
    if (data.variant_options !== undefined && this._hasCol('variant_options')) {
      add('variant_options', this._serializeVariantOptions(data.variant_options));
    }
    // Some schemas keep a cached current_stock column; do not auto-set from movements here.
    if (this._hasCol('current_stock')) add('current_stock', currentStock);
    add('created_at', now);
    add('updated_at', now);

    this.db.prepare(`INSERT INTO products (${cols.join(', ')}) VALUES (${placeholders.join(', ')})`).run(values);
    const baseUnit = this._normalizeUnitCode(data.base_unit ?? data.unit ?? 'pcs');
    this._upsertProductUnits(id, data.product_units, baseUnit, Number(data.sale_price ?? 0) || 0);
    if (this.cacheService) {
      this.cacheService.invalidateProduct(id);
      this.cacheService.invalidatePricesForProduct(id);
    }
    this._afterCatalogPriceChange(id);
    const created = this.getById(id);
    try {
      this._recordInitialPriceHistory(id, created, meta?.actorUserId);
    } catch (err) {
      // Best-effort: a missing price_history row should not fail product
      // creation. But we DO want to know when it happens (price-change
      // reports rely on the row), so emit a warning instead of swallowing.
      console.warn(
        '[productsService] _recordInitialPriceHistory failed for product',
        id,
        err?.message || err,
      );
    }
    return created;
  }

  /**
   * Update product
   */
  update(id, data, meta = {}) {
    if (!id) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Product ID is required');
    }
    if (!data || typeof data !== 'object') {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Update data is required');
    }

    const existing = this.getById(id);
    // ASL (PO override'siz) tannarxni UPDATE dan OLDIN olamiz — price_history
    // solishtiruvi `getById` ning PO display override'iga aldanmasligi uchun.
    const rawPurchaseBefore = this._hasCol('purchase_price')
      ? this._rawStoredPurchasePrice(id)
      : null;

    const updates = [];
    const params = [];
    const set = (col, value) => {
      if (!this._hasCol(col)) return;
      updates.push(`${col} = ?`);
      params.push(value);
    };

    if (data.name !== undefined) {
      const nextName = this._requireNonEmptyString(data.name, 'Product name');
      set('name', nextName);
      if (this._hasCol('normalized_name')) {
        set('normalized_name', this._normalizeName(nextName));
      }
    }

    if (data.sku !== undefined) {
      const sku = this._requireNonEmptyString(data.sku, 'SKU');
      this._ensureSkuUnique(sku, id);
      set('sku', sku);
    }

    if (data.barcode !== undefined) {
      const barcode = data.barcode ? String(data.barcode).trim() : null;
      this._ensureBarcodeUnique(barcode, id);
      set('barcode', barcode);
    }

    if (data.description !== undefined) set('description', data.description ?? null);
    if (data.category_id !== undefined) set('category_id', data.category_id ?? null);

    if (data.unit_id !== undefined) set('unit_id', data.unit_id ?? null);
    if (data.unit !== undefined) {
      const normalizedCode = this._normalizeUnitCode(data.unit ?? 'pcs');
      // If schema uses unit_id and caller passed a unit code, map it
      if (this._hasCol('unit_id') && data.unit_id === undefined) {
        const resolvedUnitId = this._resolveUnitIdFromCode(normalizedCode);
        if (resolvedUnitId) set('unit_id', resolvedUnitId);
      }
      set('unit', normalizedCode);
    }
    if (data.base_unit !== undefined) {
      set('base_unit', this._normalizeUnitCode(data.base_unit ?? 'pcs'));
    }

    if (data.purchase_price !== undefined) {
      set('purchase_price', this._assertNonNegative(data.purchase_price, 'purchase_price'));
    }
    if (data.sale_price !== undefined) {
      set('sale_price', this._assertNonNegative(data.sale_price, 'sale_price'));
    }
    // Dual pricing (optional columns)
    if (data.master_price !== undefined) set('master_price', data.master_price === null ? null : (Number(data.master_price) || 0));
    if (data.master_min_qty !== undefined) {
      if (data.master_min_qty === null) {
        set('master_min_qty', null);
      } else {
        set('master_min_qty', this._assertNonNegative(data.master_min_qty, 'master_min_qty'));
      }
    }
    if (data.min_stock_level !== undefined) {
      set('min_stock_level', this._assertNonNegative(data.min_stock_level, 'min_stock_level'));
    }
    if (data.max_stock_level !== undefined) set('max_stock_level', data.max_stock_level !== null ? Number(data.max_stock_level) : null);
    if (data.track_stock !== undefined) set('track_stock', data.track_stock ? 1 : 0);
    if (data.image_url !== undefined) set('image_url', data.image_url ?? null);
    if (data.image !== undefined) set('image', data.image ?? null);
    if (data.is_active !== undefined) set('is_active', data.is_active ? 1 : 0);
    if (data.show_in_marketplace !== undefined) set('show_in_marketplace', data.show_in_marketplace ? 1 : 0);
    if (data.variant_options !== undefined) {
      set('variant_options', this._serializeVariantOptions(data.variant_options));
    }
    // Brand and article
    if (data.brand !== undefined) set('brand', data.brand ? String(data.brand).trim() || null : null);
    if (data.article !== undefined) set('article', data.article ? String(data.article).trim().toUpperCase() || null : null);

    if (this._hasCol('current_stock') && data.current_stock !== undefined) {
      set('current_stock', this._assertNonNegative(data.current_stock, 'current_stock'));
    }

    const hasUnitUpdate = data.product_units !== undefined;
    if (updates.length === 0 && !hasUnitUpdate) return existing;

    if (updates.length > 0) {
      set('updated_at', new Date().toISOString());
      params.push(id);
      this.db.prepare(`UPDATE products SET ${updates.join(', ')} WHERE id = ?`).run(params);
    } else {
      this.db
        .prepare(`UPDATE products SET updated_at = ? WHERE id = ?`)
        .run(new Date().toISOString(), id);
    }
    const baseUnit =
      this._normalizeUnitCode(
        data.base_unit ??
          (data.unit !== undefined ? data.unit : existing.base_unit ?? existing.unit ?? 'pcs')
      );
    if (data.product_units !== undefined) {
      this._upsertProductUnits(id, data.product_units, baseUnit, Number(existing.sale_price ?? 0) || 0);
    }
    if (this.cacheService) {
      this.cacheService.invalidateProduct(id);
      this.cacheService.invalidatePricesForProduct(id);
    }
    if (this._priceFieldsChanged(data)) {
      this._afterCatalogPriceChange(id);
    }
    const after = this.getById(id);
    if (!meta?.skipPriceHistory) {
      try {
        this._recordPriceHistoryAfterUpdate(id, existing, after, meta?.actorUserId, {
          batchId: meta?.batchId,
          reasonOverride: meta?.priceChangeReason,
          rawPurchaseBefore,
          rawPurchaseAfter: this._hasCol('purchase_price')
            ? this._rawStoredPurchasePrice(id)
            : null,
        });
      } catch (err) {
        // Best-effort: see note in `create` above. Log so a broken
        // price_history table doesn't go unnoticed.
        console.warn(
          '[productsService] _recordPriceHistoryAfterUpdate failed for product',
          id,
          err?.message || err,
        );
      }
    }
    return after;
  }

  /**
   * Ommaviy narx yangilash (bulk price update) — bitta narx maydonini
   * (sotuv / tannarx / yirik optom) tanlangan mahsulotlarga qo'llaydi.
   *
   * Har bir mahsulot uchun mavjud `update()` chaqiriladi — shu orqali
   * `product_prices` va `product_units` sinxron qoladi va o'zgarish
   * `price_history` ga (bitta `batch_id` bilan) yoziladi. `batch_id`
   * keyinchalik `undoBulkPriceUpdate()` orqali aniq oxirgi amalni
   * qaytarishga imkon beradi.
   *
   * payload:
   *  - product_ids: string[]              (majburiy)
   *  - field: 'sale' | 'purchase' | 'master' (default: 'sale')
   *  - mode: 'percent' | 'amount' | 'set' | 'round'
   *  - percent / amount / exact_price / round_to (mode'ga qarab)
   *  - reason?: string
   */
  bulkAdjustPrices(payload, meta = {}) {
    if (!payload || typeof payload !== 'object') {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Bulk price payload is required');
    }

    const FIELD_MAP = {
      sale: { col: 'sale_price', type: 'sale' },
      purchase: { col: 'purchase_price', type: 'purchase' },
      master: { col: 'master_price', type: 'master' },
    };
    const field = String(payload.field || 'sale');
    const map = FIELD_MAP[field];
    if (!map) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, `Invalid price field: ${field}`);
    }
    if (!this._hasCol(map.col)) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, `Price column ${map.col} not available`);
    }

    const ids = Array.isArray(payload.product_ids)
      ? [...new Set(payload.product_ids.filter(Boolean).map(String))]
      : [];
    if (ids.length === 0) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'No products selected for bulk update');
    }
    const MAX_BULK_PRODUCT_IDS = 5000;
    if (ids.length > MAX_BULK_PRODUCT_IDS) {
      throw createError(
        ERROR_CODES.VALIDATION_ERROR,
        `Too many products selected for bulk update (max ${MAX_BULK_PRODUCT_IDS})`
      );
    }

    const mode = String(payload.mode || '');
    const validModes = new Set(['percent', 'amount', 'set', 'round']);
    if (!validModes.has(mode)) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, `Invalid bulk price mode: ${mode}`);
    }

    const opts = {
      mode,
      percent: Number(payload.percent),
      amount: Number(payload.amount),
      exactPrice: Number(payload.exact_price),
      roundTo: Number(payload.round_to),
    };
    if (mode === 'percent' && !Number.isFinite(opts.percent)) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'percent is required');
    }
    if (mode === 'amount' && !Number.isFinite(opts.amount)) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'amount is required');
    }
    if (mode === 'set' && (!Number.isFinite(opts.exactPrice) || opts.exactPrice < 0)) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'exact_price must be >= 0');
    }
    if (mode === 'round' && (!Number.isFinite(opts.roundTo) || opts.roundTo <= 0)) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'round_to must be > 0');
    }

    const batchId = randomUUID();
    const reason =
      typeof payload.reason === 'string' && payload.reason.trim()
        ? payload.reason.trim()
        : 'Ommaviy narx yangilash';
    const changes = [];

    const apply = () => {
      for (const id of ids) {
        let product;
        try {
          product = this.getById(id);
        } catch {
          continue;
        }
        // Tannarx uchun ASL omborda saqlangan ustun qiymatini o'qiymiz —
        // `product.purchase_price` (getById) qabul qilingan PO tannarxi bilan
        // ustini yopgan bo'lishi mumkin, bu esa hisoblash/undo'ni buzadi.
        const oldPrice =
          field === 'purchase'
            ? this._rawStoredPurchasePrice(id) ?? 0
            : Number(product[map.col] ?? 0) || 0;
        // Yirik optom narxi hali belgilanmagan bo'lsa, faqat "set" rejimida
        // o'rnatamiz (foiz/summa hech narsadan hisoblanmaydi).
        if (
          field === 'master' &&
          mode !== 'set' &&
          (product.master_price == null || Number(product.master_price) <= 0)
        ) {
          continue;
        }
        const newPrice = this._computeBulkNewPrice(oldPrice, opts);
        if (!Number.isFinite(newPrice) || newPrice < 0) continue;
        if (Math.abs(newPrice - oldPrice) < 1e-6) continue;
        const updateMeta = { actorUserId: meta.actorUserId, batchId, priceChangeReason: reason };
        if (field === 'sale') {
          this._applySalePriceToProduct(id, newPrice, updateMeta);
        } else {
          this.update(id, { [map.col]: newPrice }, updateMeta);
        }
        changes.push({
          product_id: id,
          name: product.name,
          sku: product.sku,
          old_price: oldPrice,
          new_price: newPrice,
        });
      }
    };

    if (typeof this.db.transaction === 'function') {
      this.db.transaction(apply)();
    } else {
      apply();
    }

    return {
      batch_id: batchId,
      field,
      price_type: map.type,
      mode,
      requested: ids.length,
      count: changes.length,
      changes,
    };
  }

  /**
   * Sotuv narxini barqaror o'zgartirish.
   *
   * `products.sale_price` `product_units` (default birlik) dan sinxronlanadi
   * (`_syncProductPricesCatalog`). Shu sabab faqat `sale_price` ustunini
   * yangilash yetarli emas — default birlik narxini ham yangilash kerak,
   * aks holda sinxron eski qiymatga qaytarib qo'yadi.
   */
  _applySalePriceToProduct(productId, newSale, meta = {}) {
    const p = this.getById(productId);
    const list = Array.isArray(p.product_units) ? p.product_units : [];
    if (list.length > 0) {
      let di = list.findIndex((u) => u.is_default);
      if (di < 0) di = 0;
      const units = list.map((u, i) => ({
        unit: u.unit,
        ratio_to_base: u.ratio_to_base,
        sale_price: i === di ? newSale : u.sale_price,
        is_default: i === di,
      }));
      return this.update(productId, { sale_price: newSale, product_units: units }, meta);
    }
    return this.update(productId, { sale_price: newSale }, meta);
  }

  _computeBulkNewPrice(oldPrice, opts) {
    const old = Number(oldPrice) || 0;
    let np;
    switch (opts.mode) {
      case 'percent':
        np = old * (1 + Number(opts.percent) / 100);
        break;
      case 'amount':
        np = old + Number(opts.amount);
        break;
      case 'set':
        np = Number(opts.exactPrice);
        break;
      case 'round': {
        const step = Number(opts.roundTo) > 0 ? Number(opts.roundTo) : 1000;
        np = Math.round(old / step) * step;
        break;
      }
      default:
        np = old;
    }
    if (!Number.isFinite(np)) return old;
    np = Math.round(np);
    return np < 0 ? 0 : np;
  }

  /**
   * Oxirgi ommaviy narx amalining qisqa ma'lumoti (undo tugmasini yoqish uchun).
   * Faqat ommaviy amallar (batch_id bor) hisobga olinadi.
   */
  getLastBulkPriceBatch() {
    if (!this._hasTable('price_history') || !this._priceHistoryHasBatchId()) return null;
    const row = this.db
      .prepare(
        `SELECT batch_id, MAX(changed_at) AS changed_at, reason, COUNT(*) AS cnt
         FROM price_history
         WHERE batch_id IS NOT NULL
         GROUP BY batch_id
         ORDER BY MAX(changed_at) DESC
         LIMIT 1`
      )
      .get();
    if (!row || !row.batch_id) return null;
    return {
      batch_id: row.batch_id,
      changed_at: row.changed_at,
      reason: row.reason || null,
      count: Number(row.cnt || 0) || 0,
    };
  }

  /**
   * Ommaviy narx amalini orqaga qaytarish (undo).
   * - batchId berilsa — o'sha amal, aks holda eng oxirgi ommaviy amal.
   * - Har bir mahsulot narxi `old_price` ga qaytariladi (yana `update()` orqali,
   *   product_prices/units sinxron qolishi uchun), so'ng shu batch'ning
   *   price_history yozuvlari o'chiriladi (takroriy undo'ni oldini olish uchun).
   */
  undoBulkPriceUpdate(batchId, meta = {}) {
    if (!this._hasTable('price_history') || !this._priceHistoryHasBatchId()) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Undo is not supported on this database');
    }
    let bid = batchId && String(batchId).trim() ? String(batchId).trim() : null;
    if (!bid) {
      const last = this.getLastBulkPriceBatch();
      bid = last?.batch_id || null;
    }
    if (!bid) {
      throw createError(ERROR_CODES.NOT_FOUND, 'No bulk price operation to undo');
    }

    const rows = this.db
      .prepare(
        `SELECT product_id, price_type, old_price, new_price, changed_at
         FROM price_history
         WHERE batch_id = ?
         ORDER BY changed_at ASC`
      )
      .all(bid);
    if (!rows || rows.length === 0) {
      throw createError(ERROR_CODES.NOT_FOUND, 'Bulk price operation not found');
    }

    const FIELD_BY_TYPE = {
      sale: 'sale_price',
      purchase: 'purchase_price',
      master: 'master_price',
    };

    let reverted = 0;
    let skipped = 0;
    const revert = () => {
      const seen = new Set();
      for (const r of rows) {
        const col = FIELD_BY_TYPE[r.price_type];
        if (!col) continue;
        // Bitta batch ichida bir mahsulot+tur uchun faqat birinchi (eng erta)
        // old_price asl qiymat hisoblanadi.
        const key = `${r.product_id}|${r.price_type}`;
        if (seen.has(key)) continue;
        seen.add(key);
        try {
          // Ommaviy amaldan KEYIN qo'lda tahrirlangan bo'lsa undo q'la
          // yangi qiymatni bosib ketmasligi kerak. Mahsulotning shu narx
          // turi bo'yicha JORIY qiymati hali ommaviy amal o'rnatgan
          // `new_price` ga teng bo'lsagina qaytaramiz.
          // Tannarx uchun ASL ustun qiymatini o'qiymiz (PO override'siz).
          let current;
          if (r.price_type === 'purchase') {
            current = this._rawStoredPurchasePrice(r.product_id);
            if (current == null) continue; // mahsulot o'chirilgan
          } else {
            const p = this.getById(r.product_id);
            current = Number(p[col] ?? 0) || 0;
          }
          if (Math.abs(Number(current) - (Number(r.new_price) || 0)) > 1e-6) {
            skipped += 1;
            continue;
          }
          const oldPrice = Number(r.old_price) || 0;
          const undoMeta = { actorUserId: meta.actorUserId, skipPriceHistory: true };
          if (r.price_type === 'sale') {
            this._applySalePriceToProduct(r.product_id, oldPrice, undoMeta);
          } else {
            this.update(r.product_id, { [col]: oldPrice }, undoMeta);
          }
          reverted += 1;
        } catch {
          // Mahsulot o'chirilgan bo'lishi mumkin — o'tkazib yuboramiz.
        }
      }
      // Idempotentlik uchun butun batch'ning price_history yozuvlarini
      // o'chiramiz (o'tkazib yuborilganlar ham). O'tkazib yuborilganlar
      // soni `skipped` orqali chaqiruvchiga bildiriladi.
      this.db.prepare('DELETE FROM price_history WHERE batch_id = ?').run(bid);
    };

    if (typeof this.db.transaction === 'function') {
      this.db.transaction(revert)();
    } else {
      revert();
    }

    return { batch_id: bid, reverted, skipped };
  }

  /**
   * Delete product
   * - If referenced by transactional documents (sales/returns/purchases): soft delete (is_active = 0, archive)
   * - Otherwise: hard delete (remove inventory/batch traces, delete product row)
   */
  delete(id) {
    if (!id) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Product ID is required');
    }

    // Ensure it exists
    this.getById(id);

    const tableExists = (name) => {
      try {
        const row = this.db
          .prepare(`SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name = ? LIMIT 1`)
          .get(String(name));
        return !!row?.ok;
      } catch {
        return false;
      }
    };

    const countByProductId = (tableName) => {
      if (!tableExists(tableName)) return 0;
      const row = this.db.prepare(`SELECT COUNT(*) AS count FROM ${tableName} WHERE product_id = ?`).get(id);
      return Number(row?.count || 0) || 0;
    };

    // Block deletion if product is referenced by transactional documents.
    // These tables intentionally keep product_id for traceability.
    const transactionalTables = [
      'order_items',
      // returns (new schema)
      'sale_return_items',
      // returns (legacy schema)
      'return_items',
      // purchases
      'purchase_order_items',
      'goods_receipt_items',
      'purchase_receipt_items',
      'supplier_return_items',
    ];

    const usedInDocs = transactionalTables.some((t) => countByProductId(t) > 0);
    if (usedInDocs) {
      // Soft delete (archive): set is_active = 0 to preserve history
      const now = new Date().toISOString().replace('T', ' ').replace('Z', '').substring(0, 19);
      this.db.prepare('UPDATE products SET is_active = 0, updated_at = ? WHERE id = ?').run(now, id);
      if (this.cacheService) {
        this.cacheService.invalidateProduct(id);
        this.cacheService.invalidatePricesForProduct(id);
      }
      return { success: true, softDeleted: true };
    }

    // Hard delete with cleanup for tables that reference products via FK and can block the DELETE.
    const cleanupTables = [
      // Pricing (FK to products without CASCADE)
      'product_prices',
      // Multi-unit definitions (FK with CASCADE, but explicit for safety)
      'product_units',
      // Quotes (non-transactional, safe to clean up)
      'quote_items',
      // Batch mode (FIFO)
      'inventory_batch_allocations',
      'inventory_batches',
      // Inventory adjustments
      'inventory_adjustment_items',
      // Inventory moves (new schema)
      'stock_moves',
      // Inventory movements (legacy schema)
      'inventory_movements',
      // Stock balances (new schema) - FK cascades, but delete explicitly for clarity
      'stock_balances',
      // Product images
      'product_images',
    ];

    const doCleanupAndDelete = () => {
      for (const t of cleanupTables) {
        if (!tableExists(t)) continue;
        this.db.prepare(`DELETE FROM ${t} WHERE product_id = ?`).run(id);
      }
      this.db.prepare(`DELETE FROM products WHERE id = ?`).run(id);
    };

    if (typeof this.db.transaction === 'function') {
      this.db.transaction(doCleanupAndDelete)();
    } else {
      // Fallback (shouldn't happen with better-sqlite3)
      doCleanupAndDelete();
    }
    if (this.cacheService) {
      this.cacheService.invalidateProduct(id);
      this.cacheService.invalidatePricesForProduct(id);
    }

    return { success: true, softDeleted: false };
  }

  /**
   * Get all images for a product (from product_images table)
   * Falls back to product.image_url if no product_images
   */
  getProductImages(productId) {
    if (!productId) return [];
    if (!this._hasTable('product_images')) {
      const p = this.db.prepare('SELECT image_url FROM products WHERE id = ?').get(productId);
      return p?.image_url ? [{ id: 'legacy', url: p.image_url, sort_order: 0, is_primary: 1 }] : [];
    }
    const rows = this.db.prepare(`
      SELECT id, url, sort_order, is_primary FROM product_images
      WHERE product_id = ? ORDER BY is_primary DESC, sort_order ASC, created_at ASC
    `).all(productId);
    if (rows.length > 0) return rows;
    const p = this.db.prepare('SELECT image_url FROM products WHERE id = ?').get(productId);
    return p?.image_url ? [{ id: 'legacy', url: p.image_url, sort_order: 0, is_primary: 1 }] : [];
  }

  /**
   * Add image to product
   */
  addProductImage(productId, url, sortOrder = 0, isPrimary = 0) {
    if (!this._hasTable('product_images')) {
      this.db.prepare('UPDATE products SET image_url = ?, updated_at = datetime(\'now\') WHERE id = ?').run(url, productId);
      return { id: 'legacy', url, sort_order: 0, is_primary: 1 };
    }
    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO product_images (id, product_id, url, sort_order, is_primary)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, productId, url, sortOrder, isPrimary ? 1 : 0);
    if (isPrimary) {
      this.db.prepare('UPDATE product_images SET is_primary = 0 WHERE product_id = ? AND id != ?').run(productId, id);
      this.db.prepare('UPDATE products SET image_url = ?, updated_at = datetime(\'now\') WHERE id = ?').run(url, productId);
    }
    return { id, url, sort_order: sortOrder, is_primary: isPrimary ? 1 : 0 };
  }

  /**
   * Remove image from product
   */
  removeProductImage(imageId, productId) {
    if (!this._hasTable('product_images')) {
      this.db.prepare('UPDATE products SET image_url = NULL, updated_at = datetime(\'now\') WHERE id = ?').run(productId);
      return { success: true };
    }
    const img = this.db.prepare('SELECT * FROM product_images WHERE id = ? AND product_id = ?').get(imageId, productId);
    if (!img) return { success: true };
    this.db.prepare('DELETE FROM product_images WHERE id = ?').run(imageId);
    if (img.is_primary) {
      const next = this.db.prepare('SELECT id, url FROM product_images WHERE product_id = ? ORDER BY sort_order ASC LIMIT 1').get(productId);
      this.db.prepare('UPDATE products SET image_url = ?, updated_at = datetime(\'now\') WHERE id = ?').run(next?.url || null, productId);
      if (next) {
        this.db.prepare('UPDATE product_images SET is_primary = 1 WHERE id = ?').run(next.id);
      }
    }
    return { success: true };
  }

  /**
   * Set product images (replace all): [{ url, sort_order?, is_primary? }]
   */
  setProductImages(productId, images) {
    const arr = Array.isArray(images) ? images : [];
    const firstUrl = arr[0] ? (typeof arr[0] === 'string' ? arr[0] : arr[0].url) : null;
    if (!this._hasTable('product_images')) {
      this.db.prepare('UPDATE products SET image_url = ?, updated_at = datetime(\'now\') WHERE id = ?').run(firstUrl, productId);
      return arr.map((img, i) => ({ id: `legacy-${i}`, url: typeof img === 'string' ? img : img.url, sort_order: i, is_primary: i === 0 ? 1 : 0 }));
    }
    this.db.prepare('DELETE FROM product_images WHERE product_id = ?').run(productId);
    if (arr.length === 0) {
      this.db
        .prepare("UPDATE products SET image_url = NULL, updated_at = datetime('now') WHERE id = ?")
        .run(productId);
      return [];
    }
    const result = [];
    const primaryIdx = arr.findIndex((x) => (typeof x === 'object' && x && x.is_primary));
    const firstPrimary = primaryIdx >= 0 ? primaryIdx : 0;
    for (let i = 0; i < arr.length; i++) {
      const img = arr[i];
      const url = typeof img === 'string' ? img : (img?.url || '');
      if (!url) continue;
      const id = randomUUID();
      const isPrimary = i === firstPrimary ? 1 : 0;
      const sortOrder = typeof img === 'object' && img && typeof img.sort_order === 'number' ? img.sort_order : i;
      this.db.prepare(`
        INSERT INTO product_images (id, product_id, url, sort_order, is_primary)
        VALUES (?, ?, ?, ?, ?)
      `).run(id, productId, url, sortOrder, isPrimary);
      result.push({ id, url, sort_order: sortOrder, is_primary: isPrimary });
      if (isPrimary) {
        this.db.prepare('UPDATE products SET image_url = ?, updated_at = datetime(\'now\') WHERE id = ?').run(url, productId);
      }
    }
    return result;
  }
}

module.exports = ProductsService;

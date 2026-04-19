const { ERROR_CODES, createError } = require('../lib/errors.cjs');
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
  constructor(db, cacheService = null) {
    this.db = db;
    this.cacheService = cacheService;
    this._productsColumns = null;
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

  _hasTable(name) {
    try {
      return !!this.db
        .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?")
        .get(name);
    } catch {
      return false;
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

  _normalizeProductRow(row) {
    if (!row) return row;
    return {
      ...row,
      // Normalize SQLite INTEGER to booleans when present
      is_active: row.is_active === 1 || row.is_active === true,
      track_stock: row.track_stock === 1 || row.track_stock === true,
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

  /**
   * Match product detail / inventory: if last received PO line has a cost, use it for API display.
   */
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

  _requireNonEmptyString(value, fieldName) {
    if (typeof value !== 'string' || !value.trim()) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, `${fieldName} is required`);
    }
    return value.trim();
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
        ${this._sqlLatestReceivedPurchaseUnitCost('p')} AS __latest_recv_po_uc,
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

    if (filters.search) {
      const raw = String(filters.search);
      const search = `%${raw}%`;
      const hasArticle = this._hasCol('article');
      if (this._hasCol('normalized_name')) {
        const normalized = `%${this._normalizeName(raw)}%`;
        query += hasArticle
          ? ` AND (p.normalized_name LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ? OR p.article LIKE ?)`
          : ` AND (p.normalized_name LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ?)`;
        params.push(normalized, search, search, ...(hasArticle ? [search] : []));
      } else {
        query += hasArticle
          ? ` AND (p.name LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ? OR p.article LIKE ?)`
          : ` AND (p.name LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ?)`;
        params.push(search, search, search, ...(hasArticle ? [search] : []));
      }
    }

    if (filters.category_id) {
      query += ` AND p.category_id = ?`;
      params.push(filters.category_id);
    }

    if (filters.status === 'active') {
      query += ` AND p.is_active = 1`;
    } else if (filters.status === 'inactive') {
      query += ` AND p.is_active = 0`;
    }

    if (filters.track_stock !== undefined) {
      query += ` AND p.track_stock = ?`;
      params.push(filters.track_stock ? 1 : 0);
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
    if (filters.search && !sortByRaw) {
      const raw = String(filters.search);
      const prefixSearch = `${raw}%`;
      const search = `%${raw}%`;
      let rankExpr;
      if (this._hasCol('normalized_name')) {
        const normalizedPrefix = `${this._normalizeName(raw)}%`;
        const normalized = `%${this._normalizeName(raw)}%`;
        rankExpr = `CASE WHEN p.sku = ? OR p.barcode = ? THEN 0 WHEN p.sku LIKE ? OR p.barcode LIKE ? THEN 1 WHEN p.normalized_name LIKE ? THEN 2 WHEN p.normalized_name LIKE ? THEN 3 ELSE 4 END`;
        params.push(raw, raw, prefixSearch, prefixSearch, normalizedPrefix, normalized);
      } else {
        rankExpr = `CASE WHEN p.sku = ? OR p.barcode = ? THEN 0 WHEN p.sku LIKE ? OR p.barcode LIKE ? THEN 1 WHEN p.name LIKE ? THEN 2 WHEN p.name LIKE ? THEN 3 ELSE 4 END`;
        params.push(raw, raw, prefixSearch, prefixSearch, prefixSearch, search);
      }
      query += ` ORDER BY ${rankExpr} ASC, ${sortBy} ${sortOrder}`;
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
      return normalizedRows.map((row) => ({
        ...row,
        product_units: unitsMap.get(row.id) || [],
        base_unit: row.base_unit ?? row.unit ?? row.unit_code ?? null,
      }));
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
    if (filters.search) {
      const raw = String(filters.search);
      const search = `%${raw}%`;
      const prefixSearch = `${raw}%`;
      const hasArticle = this._hasCol('article');
      if (this._hasCol('normalized_name')) {
        const normalized = `%${this._normalizeName(raw)}%`;
        const normalizedPrefix = `${this._normalizeName(raw)}%`;
        query += hasArticle
          ? ` AND (p.normalized_name LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ? OR p.article LIKE ?)`
          : ` AND (p.normalized_name LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ?)`;
        params.push(normalized, search, search, ...(hasArticle ? [search] : []));
        // Build ranking CASE WHEN — exact > prefix > contains
        searchRankClause = `CASE
          WHEN p.sku = ? OR p.barcode = ? THEN 0
          WHEN p.sku LIKE ? OR p.barcode LIKE ? THEN 1
          WHEN p.normalized_name LIKE ? THEN 2
          WHEN p.normalized_name LIKE ? THEN 3
          ELSE 4
        END`;
        params.push(raw, raw, prefixSearch, prefixSearch, normalizedPrefix, normalized);
      } else {
        query += hasArticle
          ? ` AND (p.name LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ? OR p.article LIKE ?)`
          : ` AND (p.name LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ?)`;
        params.push(search, search, search, ...(hasArticle ? [search] : []));
        searchRankClause = `CASE
          WHEN p.sku = ? OR p.barcode = ? THEN 0
          WHEN p.sku LIKE ? OR p.barcode LIKE ? THEN 1
          WHEN p.name LIKE ? THEN 2
          WHEN p.name LIKE ? THEN 3
          ELSE 4
        END`;
        params.push(raw, raw, prefixSearch, prefixSearch, prefixSearch, search);
      }
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

    if (filters.search) {
      const raw = String(filters.search);
      const search = `%${raw}%`;
      const hasArticle = this._hasCol('article');
      if (this._hasCol('normalized_name')) {
        const normalized = `%${this._normalizeName(raw)}%`;
        query += hasArticle
          ? ` AND (p.normalized_name LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ? OR p.article LIKE ?)`
          : ` AND (p.normalized_name LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ?)`;
        params.push(normalized, search, search, ...(hasArticle ? [search] : []));
      } else {
        query += hasArticle
          ? ` AND (p.name LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ? OR p.article LIKE ?)`
          : ` AND (p.name LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ?)`;
        params.push(search, search, search, ...(hasArticle ? [search] : []));
      }
    }

    if (filters.category_id) {
      query += ` AND p.category_id = ?`;
      params.push(filters.category_id);
    }

    if (filters.status === 'active') {
      query += ` AND p.is_active = 1`;
    } else if (filters.status === 'inactive') {
      query += ` AND p.is_active = 0`;
    }

    if (filters.track_stock !== undefined) {
      query += ` AND p.track_stock = ?`;
      params.push(filters.track_stock ? 1 : 0);
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
    }
    if (this.cacheService) this.cacheService.setProduct(normalized);
    return normalized;
  }

  /**
   * Get product by SKU
   */
  getBySku(sku) {
    const s = this._requireNonEmptyString(sku, 'SKU');
    if (this.cacheService) {
      const cached = this.cacheService.getProductBySku(s);
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
          WHERE p.sku = ?
          LIMIT 1
        `
        )
        .get(s);
    } catch (_e) {
      // Fallback for older schemas without joins
      row = this.db.prepare(`SELECT * FROM products WHERE sku = ?`).get(s);
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
    }
    if (this.cacheService) this.cacheService.setProduct(normalized);
    return normalized;
  }

  /**
   * Get product by barcode
   */
  getByBarcode(barcode) {
    const b = this._requireNonEmptyString(barcode, 'Barcode');
    if (this.cacheService) {
      const cached = this.cacheService.getProductByBarcode(b);
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
          WHERE p.barcode = ?
          LIMIT 1
        `
        )
        .get(b);
    } catch (_e) {
      // Fallback for older schemas without joins
      row = this.db.prepare(`SELECT * FROM products WHERE barcode = ?`).get(b);
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
  create(data) {
    if (!data || typeof data !== 'object') {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Product data is required');
    }

    const name = this._requireNonEmptyString(data.name, 'Product name');
    const sku = this._requireNonEmptyString(data.sku, 'SKU');
    const barcode = data.barcode ? String(data.barcode).trim() : null;

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

    add('purchase_price', Number(data.purchase_price ?? 0) || 0);
    add('sale_price', Number(data.sale_price ?? 0) || 0);
    // Dual pricing (optional columns)
    if (data.master_price !== undefined) add('master_price', data.master_price === null ? null : (Number(data.master_price) || 0));
    if (data.master_min_qty !== undefined) add('master_min_qty', data.master_min_qty === null ? null : (Number(data.master_min_qty) || 0));
    // Brand and article (optional columns added in migration 061)
    if (data.brand !== undefined) add('brand', data.brand ? String(data.brand).trim() || null : null);
    if (data.article !== undefined) add('article', data.article ? String(data.article).trim().toUpperCase() || null : null);
    add('min_stock_level', Number(data.min_stock_level ?? 0) || 0);
    add('max_stock_level', data.max_stock_level !== undefined ? Number(data.max_stock_level) : null);
    add('track_stock', data.track_stock !== undefined ? (data.track_stock ? 1 : 0) : 1);
    add('image_url', data.image_url ?? null);
    add('image', data.image ?? null);
    add('is_active', data.is_active !== undefined ? (data.is_active ? 1 : 0) : 1);
    // Some schemas keep a cached current_stock column; do not auto-set from movements here.
    if (this._hasCol('current_stock')) add('current_stock', Number(data.current_stock ?? 0) || 0);
    add('created_at', now);
    add('updated_at', now);

    this.db.prepare(`INSERT INTO products (${cols.join(', ')}) VALUES (${placeholders.join(', ')})`).run(values);
    const baseUnit = this._normalizeUnitCode(data.base_unit ?? data.unit ?? 'pcs');
    this._upsertProductUnits(id, data.product_units, baseUnit, Number(data.sale_price ?? 0) || 0);
    if (this.cacheService) {
      this.cacheService.invalidateProduct(id);
      this.cacheService.invalidatePricesForProduct(id);
    }
    return this.getById(id);
  }

  /**
   * Update product
   */
  update(id, data) {
    if (!id) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Product ID is required');
    }
    if (!data || typeof data !== 'object') {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Update data is required');
    }

    const existing = this.getById(id);

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

    if (data.purchase_price !== undefined) set('purchase_price', Number(data.purchase_price ?? 0) || 0);
    if (data.sale_price !== undefined) set('sale_price', Number(data.sale_price ?? 0) || 0);
    // Dual pricing (optional columns)
    if (data.master_price !== undefined) set('master_price', data.master_price === null ? null : (Number(data.master_price) || 0));
    if (data.master_min_qty !== undefined) set('master_min_qty', data.master_min_qty === null ? null : (Number(data.master_min_qty) || 0));
    if (data.min_stock_level !== undefined) set('min_stock_level', Number(data.min_stock_level ?? 0) || 0);
    if (data.max_stock_level !== undefined) set('max_stock_level', data.max_stock_level !== null ? Number(data.max_stock_level) : null);
    if (data.track_stock !== undefined) set('track_stock', data.track_stock ? 1 : 0);
    if (data.image_url !== undefined) set('image_url', data.image_url ?? null);
    if (data.image !== undefined) set('image', data.image ?? null);
    if (data.is_active !== undefined) set('is_active', data.is_active ? 1 : 0);
    // Brand and article
    if (data.brand !== undefined) set('brand', data.brand ? String(data.brand).trim() || null : null);
    if (data.article !== undefined) set('article', data.article ? String(data.article).trim().toUpperCase() || null : null);

    if (this._hasCol('current_stock') && data.current_stock !== undefined) {
      set('current_stock', Number(data.current_stock ?? 0) || 0);
    }

    if (updates.length === 0) return existing;

    set('updated_at', new Date().toISOString());
    params.push(id);

    this.db.prepare(`UPDATE products SET ${updates.join(', ')} WHERE id = ?`).run(params);
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
    return this.getById(id);
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

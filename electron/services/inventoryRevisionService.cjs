'use strict';

const { randomUUID } = require('crypto');
const { ERROR_CODES, createError } = require('../lib/errors.cjs');
const {
  roleCanApproveInventoryRevision,
  normalizeProductCode,
  matchesRevisionProductSearch,
  isRevisionExactBarcodeQuery,
} = require('../lib/posHardening.cjs');

const MAIN_WAREHOUSE_ID = 'main-warehouse-001';
const ACTIVE_STATUSES = new Set(['draft', 'in_progress']);
const OPEN_STATUSES_SQL = "'draft', 'in_progress'";

/**
 * Warehouse inventory revision (ombor reviziyasi).
 * Snapshots system qty at start; complete requires 100% counted in session scope.
 * Variances applied as per-item inventory_adjustment movements (counted − live).
 */
class InventoryRevisionService {
  constructor(db, inventoryService) {
    this.db = db;
    this.inventory = inventoryService;
    this.audit = null;
  }

  _nowIso() {
    return new Date().toISOString();
  }

  _hasTable(name) {
    try {
      const row = this.db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
        .get(name);
      return !!row;
    } catch {
      return false;
    }
  }

  _requireTables() {
    if (!this._hasTable('inventory_revisions') || !this._hasTable('inventory_revision_items')) {
      throw createError(
        ERROR_CODES.INTERNAL_ERROR,
        'Inventory revision tables missing — run migrations (122_inventory_revisions)'
      );
    }
  }

  _ensureWarehouse(warehouseId) {
    const id = String(warehouseId || MAIN_WAREHOUSE_ID).trim() || MAIN_WAREHOUSE_ID;
    const row = this.db.prepare('SELECT id FROM warehouses WHERE id = ?').get(id);
    if (!row) {
      throw createError(ERROR_CODES.NOT_FOUND, `Warehouse not found: ${id}`);
    }
    return id;
  }

  _getRevisionRow(revisionId) {
    const id = String(revisionId || '').trim();
    if (!id) throw createError(ERROR_CODES.VALIDATION_ERROR, 'Revision ID is required');
    const row = this.db.prepare('SELECT * FROM inventory_revisions WHERE id = ?').get(id);
    if (!row) throw createError(ERROR_CODES.NOT_FOUND, `Revision not found: ${id}`);
    return row;
  }

  _assertEditable(revision) {
    if (!ACTIVE_STATUSES.has(revision.status)) {
      throw createError(
        ERROR_CODES.VALIDATION_ERROR,
        `Revision is ${revision.status} and cannot be modified`
      );
    }
  }

  /**
   * Return the open (draft|in_progress) revision for a warehouse, if any.
   * Used by createRevision uniqueness check and InventoryService soft-lock.
   */
  findOpenRevision(warehouseId) {
    if (!this._hasTable('inventory_revisions')) return null;
    const id = String(warehouseId || MAIN_WAREHOUSE_ID).trim() || MAIN_WAREHOUSE_ID;
    return (
      this.db
        .prepare(
          `
        SELECT id, revision_number, warehouse_id, status, revision_type, created_at
        FROM inventory_revisions
        WHERE warehouse_id = ?
          AND status IN (${OPEN_STATUSES_SQL})
        ORDER BY created_at DESC
        LIMIT 1
      `
        )
        .get(id) || null
    );
  }

  findOpenFullRevision(warehouseId) {
    if (!this._hasTable('inventory_revisions')) return null;
    const id = String(warehouseId || MAIN_WAREHOUSE_ID).trim() || MAIN_WAREHOUSE_ID;
    return (
      this.db
        .prepare(
          `
        SELECT id, revision_number, warehouse_id, status, revision_type, created_at
        FROM inventory_revisions
        WHERE warehouse_id = ?
          AND status IN (${OPEN_STATUSES_SQL})
          AND COALESCE(revision_type, 'full') = 'full'
        ORDER BY created_at DESC
        LIMIT 1
      `
        )
        .get(id) || null
    );
  }

  _parseScope(payload = {}) {
    const raw = payload.scope ?? payload.scope_json;
    if (!raw) return null;
    if (typeof raw === 'string') {
      try {
        return JSON.parse(raw);
      } catch {
        return null;
      }
    }
    return raw;
  }

  _scopeProductFilter(scope) {
    if (!scope || typeof scope !== 'object') return { sql: '', params: [] };
    const parts = [];
    const params = [];
    if (Array.isArray(scope.product_ids) && scope.product_ids.length > 0) {
      const ph = scope.product_ids.map(() => '?').join(',');
      parts.push(`p.id IN (${ph})`);
      params.push(...scope.product_ids.map(String));
    }
    if (Array.isArray(scope.category_ids) && scope.category_ids.length > 0) {
      const ph = scope.category_ids.map(() => '?').join(',');
      parts.push(`p.category_id IN (${ph})`);
      params.push(...scope.category_ids.map(String));
    }
    if (scope.shelf) {
      parts.push(`COALESCE(p.shelf, '') = ?`);
      params.push(String(scope.shelf));
    }
    if (scope.zone) {
      parts.push(`COALESCE(p.zone, '') = ?`);
      params.push(String(scope.zone));
    }
    if (!parts.length) return { sql: '', params: [] };
    return { sql: ` AND (${parts.join(' OR ')})`, params };
  }

  _audit(action, revision, userId, extra = {}) {
    try {
      if (!this.audit?.log) return;
      this.audit.log({
        action,
        entity_type: 'inventory_revision',
        entity_id: revision?.id || null,
        user_id: userId || null,
        new_values: {
          revision_number: revision?.revision_number,
          status: revision?.status,
          revision_type: revision?.revision_type,
          ...extra,
        },
      });
    } catch (err) {
      console.warn('[inventoryRevision] audit failed:', err?.message || err);
    }
  }

  _movementsDuringRevision(revision) {
    if (!revision?.snapshot_at || !this._hasTable('inventory_movements')) {
      return [];
    }
    const since = revision.snapshot_at;
    const productIds = this.db
      .prepare(`SELECT DISTINCT product_id FROM inventory_revision_items WHERE revision_id = ?`)
      .all(revision.id)
      .map((r) => r.product_id);
    if (!productIds.length) return [];
    const ph = productIds.map(() => '?').join(',');
    return this.db
      .prepare(
        `
      SELECT
        im.id,
        im.product_id,
        im.movement_type,
        im.quantity,
        im.before_quantity,
        im.after_quantity,
        im.reference_type,
        im.reference_id,
        im.reason,
        im.created_at,
        p.name AS product_name,
        p.sku AS product_sku
      FROM inventory_movements im
      INNER JOIN products p ON p.id = im.product_id
      WHERE im.warehouse_id = ?
        AND im.product_id IN (${ph})
        AND im.created_at >= ?
      ORDER BY im.created_at ASC
      LIMIT 500
    `
      )
      .all(revision.warehouse_id, ...productIds, since);
  }

  _completePreview(revisionId) {
    const revision = this._getRevisionRow(revisionId);
    const snapRows = this.db
      .prepare(`SELECT * FROM inventory_revision_items WHERE revision_id = ?`)
      .all(revision.id);
    const liveByProduct = this._liveQtyMap(revision.id, revision.warehouse_id);
    const stockDriftItems = this._countStockDrift(snapRows, liveByProduct);
    const summary = this._revisionSummary(revision.id, stockDriftItems);

    let surplusQty = 0;
    let shortageQty = 0;
    let surplusValue = 0;
    let shortageValue = 0;
    const varianceLines = [];

    for (const row of snapRows) {
      if (row.counted_qty == null) continue;
      const counted = Number(row.counted_qty) || 0;
      const systemQty = Number(row.system_qty) || 0;
      const variance = counted - systemQty;
      if (Math.abs(variance) <= 0.0001) continue;
      const product = this.db
        .prepare('SELECT purchase_price, name, sku FROM products WHERE id = ?')
        .get(row.product_id);
      const unitCost = Number(product?.purchase_price || 0) || 0;
      varianceLines.push({
        product_id: row.product_id,
        product_name: product?.name || null,
        product_sku: product?.sku || null,
        system_qty: systemQty,
        counted_qty: counted,
        variance,
        unit_cost: unitCost,
        value_impact: variance * unitCost,
      });
      if (variance > 0) {
        surplusQty += variance;
        surplusValue += variance * unitCost;
      } else {
        shortageQty += Math.abs(variance);
        shortageValue += Math.abs(variance) * unitCost;
      }
    }

    return {
      revision_id: revision.id,
      revision_number: revision.revision_number,
      revision_type: revision.revision_type || 'full',
      status: revision.status,
      can_complete: summary.pending_items === 0 && summary.total_items > 0,
      pending_items: summary.pending_items,
      total_items: summary.total_items,
      counted_items: summary.counted_items,
      variance_items: summary.variance_items,
      stock_drift_items: stockDriftItems,
      surplus_qty: surplusQty,
      shortage_qty: shortageQty,
      surplus_value: surplusValue,
      shortage_value: shortageValue,
      variance_lines: varianceLines,
      movements_during_revision: this._movementsDuringRevision(revision),
      requires_manager_approval: true,
      requires_stock_drift_approval: stockDriftItems > 0,
    };
  }

  getCompletePreview(revisionId) {
    this._requireTables();
    return this._completePreview(revisionId);
  }

  _itemCountStatus(item) {
    const counted = item.counted_qty != null && Number.isFinite(Number(item.counted_qty));
    if (!counted) return 'pending';
    const variance = Number(item.variance);
    if (Number.isFinite(variance) && Math.abs(variance) > 0.0001) return 'variance';
    return 'counted';
  }

  _enrichItem(row, liveQty) {
    const counted = row.counted_qty != null && Number.isFinite(Number(row.counted_qty));
    const systemQty = Number(row.system_qty || 0) || 0;
    const countedQty = counted ? Number(row.counted_qty) : null;
    const variance =
      counted && row.variance != null
        ? Number(row.variance)
        : counted
          ? countedQty - systemQty
          : null;
    const live =
      liveQty != null && Number.isFinite(Number(liveQty)) ? Number(liveQty) : null;
    const stockDrift =
      live != null && Math.abs(live - systemQty) > 0.0001;
    return {
      ...row,
      system_qty: systemQty,
      counted_qty: countedQty,
      variance,
      live_qty: live,
      current_qty: live,
      stock_drift: stockDrift,
      is_counted: counted,
      count_status: this._itemCountStatus({ ...row, counted_qty: countedQty, variance }),
    };
  }

  _liveQtyMap(revisionId, warehouseId) {
    const map = new Map();
    if (!this.inventory || typeof this.inventory.getCurrentStock !== 'function') {
      return map;
    }
    const rows = this.db
      .prepare(
        `SELECT DISTINCT product_id FROM inventory_revision_items WHERE revision_id = ?`
      )
      .all(revisionId);
    for (const row of rows) {
      map.set(
        row.product_id,
        Number(this.inventory.getCurrentStock(row.product_id, warehouseId)) || 0
      );
    }
    return map;
  }

  _countStockDrift(systemRows, liveByProduct) {
    let n = 0;
    for (const row of systemRows) {
      const live = liveByProduct.get(row.product_id);
      if (live == null) continue;
      if (Math.abs(live - (Number(row.system_qty) || 0)) > 0.0001) n += 1;
    }
    return n;
  }

  _revisionSummary(revisionId, stockDriftItems = 0) {
    const agg = this.db
      .prepare(
        `
      SELECT
        COUNT(*) AS total_items,
        SUM(CASE WHEN counted_qty IS NOT NULL THEN 1 ELSE 0 END) AS counted_items,
        SUM(CASE WHEN counted_qty IS NULL THEN 1 ELSE 0 END) AS pending_items,
        SUM(
          CASE
            WHEN counted_qty IS NOT NULL
             AND ABS(COALESCE(variance, counted_qty - system_qty)) > 0.0001
            THEN 1 ELSE 0
          END
        ) AS variance_items
      FROM inventory_revision_items
      WHERE revision_id = ?
    `
      )
      .get(revisionId);
    const total = Number(agg?.total_items || 0);
    const counted = Number(agg?.counted_items || 0);
    return {
      total_items: total,
      counted_items: counted,
      pending_items: Number(agg?.pending_items || 0),
      variance_items: Number(agg?.variance_items || 0),
      stock_drift_items: Number(stockDriftItems) || 0,
      progress_percent: total > 0 ? Math.round((counted / total) * 100) : 0,
    };
  }

  /**
   * Create revision and snapshot system qty for all active track_stock products.
   */
  createRevision(payload = {}) {
    this._requireTables();
    const warehouseId = this._ensureWarehouse(payload.warehouse_id);
    const revisionType = payload.revision_type === 'partial' ? 'partial' : 'full';
    const scope = this._parseScope(payload);

    if (revisionType === 'partial' && (!scope || !this._scopeProductFilter(scope).sql)) {
      throw createError(
        ERROR_CODES.VALIDATION_ERROR,
        'Partial revision requires scope (category, shelf, zone, or product list)'
      );
    }

    const openAny = this.findOpenRevision(warehouseId);
    if (openAny) {
      throw createError(
        ERROR_CODES.VALIDATION_ERROR,
        `Ochiq ombor reviziyasi bor (${openAny.revision_number}). Avval uni yakunlang yoki bekor qiling.`
      );
    }
    if (revisionType === 'full') {
      const openFull = this.findOpenFullRevision(warehouseId);
      if (openFull) {
        throw createError(
          ERROR_CODES.VALIDATION_ERROR,
          `Ochiq to'liq reviziya bor (${openFull.revision_number}).`
        );
      }
    }

    const notes = payload.notes != null ? String(payload.notes).trim() || null : null;
    const createdBy = payload.created_by || null;
    const responsibleUserId = payload.responsible_user_id || payload.responsible_id || createdBy || null;
    if (!responsibleUserId) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Responsible person is required');
    }
    const countMethod = payload.count_method ? String(payload.count_method).trim() || null : null;
    const plannedDate = payload.planned_date ? String(payload.planned_date).trim() || null : null;
    const now = this._nowIso();
    const revisionId = randomUUID();
    const revisionNumber = `REV-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const scopeJson = scope ? JSON.stringify(scope) : null;
    const scopeFilter = this._scopeProductFilter(scope);

    let productsSql = `
      SELECT
        p.id,
        COALESCE(u.code, p.unit, p.base_unit) AS unit,
        COALESCE(p.is_active, 1) AS is_active,
        COALESCE(p.track_stock, 1) AS track_stock
      FROM products p
      LEFT JOIN units u ON u.id = p.unit_id
      WHERE COALESCE(p.track_stock, 1) = 1
        AND COALESCE(p.is_active, 1) = 1
        ${scopeFilter.sql}
      ORDER BY p.name COLLATE NOCASE ASC
    `;
    const products = this.db.prepare(productsSql).all(...scopeFilter.params);

    if (!products.length) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'No stock-tracked products to revise for this scope');
    }

    const snapshotVersion = 1;
    const insertRev = this.db.prepare(`
      INSERT INTO inventory_revisions (
        id, revision_number, warehouse_id, status, revision_type, scope_json,
        count_method, planned_date, responsible_user_id, snapshot_at, snapshot_version,
        notes, created_by, started_by, started_at, created_at, updated_at
      ) VALUES (?, ?, ?, 'in_progress', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertItem = this.db.prepare(`
      INSERT INTO inventory_revision_items (
        id, revision_id, product_id, system_qty, counted_qty, variance, unit,
        snapshot_version, snapshot_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?)
    `);

    this.db.transaction(() => {
      insertRev.run(
        revisionId,
        revisionNumber,
        warehouseId,
        revisionType,
        scopeJson,
        countMethod,
        plannedDate,
        responsibleUserId,
        now,
        snapshotVersion,
        notes,
        createdBy,
        createdBy,
        now,
        now,
        now
      );
      for (const p of products) {
        const systemQty = Number(this.inventory.getCurrentStock(p.id, warehouseId)) || 0;
        insertItem.run(
          randomUUID(),
          revisionId,
          p.id,
          systemQty,
          p.unit || null,
          snapshotVersion,
          now,
          now,
          now
        );
      }
    })();

    const created = this.getRevision(revisionId);
    this._audit('create', created, createdBy, {
      revision_type: revisionType,
      total_items: created.summary?.total_items,
      scope: scope || null,
    });
    return created;
  }

  listRevisions(filters = {}) {
    this._requireTables();
    let sql = `
      SELECT
        r.*,
        w.name AS warehouse_name,
        u.full_name AS created_by_name,
        (SELECT COUNT(*) FROM inventory_revision_items i WHERE i.revision_id = r.id) AS total_items,
        (SELECT COUNT(*) FROM inventory_revision_items i
          WHERE i.revision_id = r.id AND i.counted_qty IS NOT NULL) AS counted_items,
        (SELECT COUNT(*) FROM inventory_revision_items i
          WHERE i.revision_id = r.id AND i.counted_qty IS NULL) AS pending_items,
        (SELECT COUNT(*) FROM inventory_revision_items i
          WHERE i.revision_id = r.id
            AND i.counted_qty IS NOT NULL
            AND ABS(COALESCE(i.variance, i.counted_qty - i.system_qty)) > 0.0001) AS variance_items
      FROM inventory_revisions r
      LEFT JOIN warehouses w ON w.id = r.warehouse_id
      LEFT JOIN users u ON u.id = r.created_by
      WHERE 1=1
    `;
    const params = [];
    if (filters.status && filters.status !== 'all') {
      sql += ' AND r.status = ?';
      params.push(String(filters.status));
    }
    if (filters.warehouse_id) {
      sql += ' AND r.warehouse_id = ?';
      params.push(String(filters.warehouse_id));
    }
    sql += ' ORDER BY r.created_at DESC';
    const limit = Math.min(Math.max(Number(filters.limit) || 100, 1), 500);
    sql += ' LIMIT ?';
    params.push(limit);
    return this.db.prepare(sql).all(...params);
  }

  _cleanScanCode(raw) {
    return String(raw || '')
      .replace(/[\u0000-\u001F\u007F]/g, '')
      .replace(/\s+/g, '')
      .trim();
  }

  _isExactCodeQuery(raw) {
    // Only full numeric barcodes are exclusive exact queries.
    // Short tokens like "evn" / "2188" use partial normalized search.
    return isRevisionExactBarcodeQuery(raw);
  }

  _encodeItemCursor(row) {
    const name = String(row.product_name || row.name || '');
    const id = String(row.id || '');
    return Buffer.from(JSON.stringify({ n: name, i: id }), 'utf8').toString('base64url');
  }

  _decodeItemCursor(cursor) {
    if (!cursor) return null;
    try {
      const raw = Buffer.from(String(cursor), 'base64url').toString('utf8');
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      return { name: String(parsed.n || ''), id: String(parsed.i || '') };
    } catch {
      return null;
    }
  }

  _hasScanEventsTable() {
    return this._hasTable('inventory_revision_scan_events');
  }

  _hasProductCol(col) {
    if (!this._productColCache) {
      try {
        this._productColCache = new Set(
          this.db.prepare(`PRAGMA table_info(products)`).all().map((c) => c.name)
        );
      } catch {
        this._productColCache = new Set();
      }
    }
    return this._productColCache.has(col);
  }

  getRevision(revisionId, opts = {}) {
    this._requireTables();
    const revision = this._getRevisionRow(revisionId);
    const filter = String(opts.count_filter || opts.filter || opts.status || 'all').toLowerCase();
    const searchRaw = String(opts.search || opts.query || '').trim();
    const focusItemId = opts.focus_item_id || opts.focusItemId || null;
    const limitRaw = opts.limit != null ? Number(opts.limit) : null;
    const limit =
      limitRaw != null && Number.isFinite(limitRaw)
        ? Math.min(Math.max(Math.trunc(limitRaw), 1), 500)
        : null;
    const cursor = this._decodeItemCursor(opts.cursor || opts.after || null);

    const hasArticle = this._hasProductCol('article');
    const hasBrand = this._hasProductCol('brand');

    let itemsSql = `
      SELECT
        i.*,
        p.name AS product_name,
        p.sku AS product_sku,
        p.barcode AS product_barcode,
        ${hasArticle ? 'p.article AS product_article,' : ''}
        ${hasBrand ? 'p.brand AS product_brand,' : ''}
        COALESCE(u.code, p.unit, p.base_unit, i.unit) AS product_unit
      FROM inventory_revision_items i
      INNER JOIN products p ON p.id = i.product_id
      LEFT JOIN units u ON u.id = p.unit_id
      WHERE i.revision_id = ?
    `;
    const params = [revision.id];

    if (focusItemId) {
      itemsSql += ' AND i.id = ?';
      params.push(String(focusItemId));
    }

    if (filter === 'counted') {
      itemsSql += ' AND i.counted_qty IS NOT NULL';
    } else if (filter === 'pending' || filter === 'not_counted' || filter === 'uncounted') {
      itemsSql += ' AND i.counted_qty IS NULL';
    } else if (filter === 'variance' || filter === 'has_variance') {
      itemsSql += `
        AND i.counted_qty IS NOT NULL
        AND ABS(COALESCE(i.variance, i.counted_qty - i.system_qty)) > 0.0001
      `;
    }

    let searchApplied = false;
    let exactMatch = false;
    let useJsPartialSearch = false;
    if (searchRaw && !focusItemId) {
      const isExactBarcode = this._isExactCodeQuery(searchRaw);
      const termNorm = normalizeProductCode(searchRaw);
      const exactRows = this.db
        .prepare(
          `SELECT p.id, p.sku, p.barcode FROM products p
           INNER JOIN inventory_revision_items i ON i.product_id = p.id AND i.revision_id = ?
           WHERE lower(trim(COALESCE(p.sku, ''))) = lower(trim(?))
              OR lower(trim(COALESCE(p.barcode, ''))) = lower(trim(?))`
        )
        .all(revision.id, searchRaw, searchRaw)
        .filter((row) => {
          const skuN = normalizeProductCode(row.sku);
          const bcN = normalizeProductCode(row.barcode);
          return skuN === termNorm || bcN === termNorm;
        });
      if (exactRows.length > 0) {
        exactMatch = true;
        searchApplied = true;
        const ph = exactRows.map(() => '?').join(',');
        itemsSql += ` AND p.id IN (${ph})`;
        params.push(...exactRows.map((r) => r.id));
      } else if (isExactBarcode) {
        // Full barcode with no hit → empty (do not fall back to name search).
        searchApplied = true;
        itemsSql += ' AND 1 = 0';
      } else if (searchRaw.length >= 2) {
        // Partial / token search: fetch candidates then filter with shared normalize.
        searchApplied = true;
        useJsPartialSearch = true;
      }
    }

    // Keyset cursor only when not doing full JS search pass (search re-filters all).
    if (!useJsPartialSearch && cursor && cursor.id) {
      itemsSql += ` AND (
        p.name COLLATE NOCASE > ?
        OR (p.name COLLATE NOCASE = ? AND i.id > ?)
      )`;
      params.push(cursor.name, cursor.name, cursor.id);
    }

    itemsSql += ' ORDER BY p.name COLLATE NOCASE ASC, i.id ASC';

    const fetchLimit = !useJsPartialSearch && limit != null ? limit + 1 : null;
    if (fetchLimit != null) {
      itemsSql += ' LIMIT ?';
      params.push(fetchLimit);
    }

    let rawItems = this.db.prepare(itemsSql).all(...params);

    if (useJsPartialSearch) {
      rawItems = rawItems.filter((row) =>
        matchesRevisionProductSearch(
          {
            name: row.product_name,
            sku: row.product_sku,
            barcode: row.product_barcode,
            article: row.product_article,
            brand: row.product_brand,
          },
          searchRaw
        )
      );
      if (cursor && cursor.id) {
        const cName = String(cursor.name || '').toLowerCase();
        rawItems = rawItems.filter((row) => {
          const name = String(row.product_name || '').toLowerCase();
          const id = String(row.id || '');
          return name > cName || (name === cName && id > cursor.id);
        });
      }
    }

    let hasMore = false;
    let pageRows = rawItems;
    if (limit != null && rawItems.length > limit) {
      hasMore = true;
      pageRows = rawItems.slice(0, limit);
    }

    const liveByProduct = this._liveQtyMap(revision.id, revision.warehouse_id);
    const snapRows = this.db
      .prepare(
        `SELECT product_id, system_qty FROM inventory_revision_items WHERE revision_id = ?`
      )
      .all(revision.id);
    const stockDriftItems = this._countStockDrift(snapRows, liveByProduct);
    const items = pageRows.map((row) =>
      this._enrichItem(row, liveByProduct.get(row.product_id))
    );
    const summary = this._revisionSummary(revision.id, stockDriftItems);
    const nextCursor =
      hasMore && items.length > 0 ? this._encodeItemCursor(items[items.length - 1]) : null;

    return {
      ...revision,
      warehouse_name:
        this.db.prepare('SELECT name FROM warehouses WHERE id = ?').get(revision.warehouse_id)
          ?.name || null,
      items,
      summary,
      pagination: {
        limit: limit,
        has_more: hasMore,
        next_cursor: nextCursor,
        exact_match: exactMatch,
        search_applied: searchApplied,
      },
    };
  }

  updateItemCount(payload = {}) {
    this._requireTables();
    const revisionId = payload.revision_id;
    const productId = payload.product_id;
    const itemId = payload.item_id;
    const revision = this._getRevisionRow(revisionId);
    this._assertEditable(revision);

    if (payload.counted_qty === undefined || payload.counted_qty === null || payload.counted_qty === '') {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'counted_qty is required');
    }
    const countedQty = Number(payload.counted_qty);
    if (!Number.isFinite(countedQty) || countedQty < 0) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'counted_qty must be a non-negative number');
    }

    let item;
    if (itemId) {
      item = this.db
        .prepare('SELECT * FROM inventory_revision_items WHERE id = ? AND revision_id = ?')
        .get(String(itemId), revision.id);
    } else if (productId) {
      item = this.db
        .prepare('SELECT * FROM inventory_revision_items WHERE revision_id = ? AND product_id = ?')
        .get(revision.id, String(productId));
    } else {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'item_id or product_id is required');
    }
    if (!item) throw createError(ERROR_CODES.NOT_FOUND, 'Revision item not found');

    const now = this._nowIso();
    const variance = countedQty - (Number(item.system_qty) || 0);
    this.db
      .prepare(
        `
      UPDATE inventory_revision_items
      SET counted_qty = ?, variance = ?, counted_at = ?, notes = COALESCE(?, notes), updated_at = ?
      WHERE id = ?
    `
      )
      .run(
        countedQty,
        variance,
        now,
        payload.notes != null ? String(payload.notes) : null,
        now,
        item.id
      );

    this.db
      .prepare(`UPDATE inventory_revisions SET updated_at = ? WHERE id = ?`)
      .run(now, revision.id);

    return this.getRevision(revision.id, { filter: 'all' });
  }

  clearItemCount(payload = {}) {
    this._requireTables();
    const revision = this._getRevisionRow(payload.revision_id);
    this._assertEditable(revision);

    let item;
    if (payload.item_id) {
      item = this.db
        .prepare('SELECT * FROM inventory_revision_items WHERE id = ? AND revision_id = ?')
        .get(String(payload.item_id), revision.id);
    } else if (payload.product_id) {
      item = this.db
        .prepare('SELECT * FROM inventory_revision_items WHERE revision_id = ? AND product_id = ?')
        .get(revision.id, String(payload.product_id));
    } else {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'item_id or product_id is required');
    }
    if (!item) throw createError(ERROR_CODES.NOT_FOUND, 'Revision item not found');

    const now = this._nowIso();
    this.db
      .prepare(
        `
      UPDATE inventory_revision_items
      SET counted_qty = NULL, variance = NULL, counted_at = NULL, updated_at = ?
      WHERE id = ?
    `
      )
      .run(now, item.id);
    this.db
      .prepare(`UPDATE inventory_revisions SET updated_at = ? WHERE id = ?`)
      .run(now, revision.id);

    return this.getRevision(revision.id);
  }

  /**
   * Resolve barcode/SKU within a revision and set counted qty (quick count).
   * Default behaviour: set counted_qty to the given qty (or +1 if omit and already counted).
   * Supports scan_event_id idempotency and multi-match disambiguation.
   */
  countByBarcode(payload = {}) {
    this._requireTables();
    const revision = this._getRevisionRow(payload.revision_id);
    this._assertEditable(revision);

    const code = this._cleanScanCode(payload.barcode || payload.code || '');
    if (!code) throw createError(ERROR_CODES.VALIDATION_ERROR, 'barcode is required');

    const scanEventId = String(payload.scan_event_id || payload.scanEventId || '').trim() || null;
    const userId = payload.user_id || payload.userId || payload.created_by || null;
    const deviceId = payload.device_id || payload.deviceId || null;

    if (scanEventId && this._hasScanEventsTable()) {
      const existing = this.db
        .prepare(`SELECT * FROM inventory_revision_scan_events WHERE scan_event_id = ?`)
        .get(scanEventId);
      if (existing) {
        const focused = this.getRevision(revision.id, {
          filter: 'all',
          focus_item_id: existing.item_id,
        });
        const matched =
          (focused.items || []).find((it) => it.id === existing.item_id) || null;
        return {
          ...focused,
          matched_item: matched,
          focus_item_id: existing.item_id,
          counted_qty: existing.new_counted_qty,
          previous_counted_qty: existing.previous_counted_qty,
          scan_event_id: scanEventId,
          idempotent_replay: true,
        };
      }
    }

    const termNorm = normalizeProductCode(code);
    const candidates = this.db
      .prepare(
        `
      SELECT
        p.id AS product_id,
        p.name AS product_name,
        p.sku,
        p.barcode,
        i.id AS item_id,
        i.counted_qty,
        i.system_qty
      FROM products p
      INNER JOIN inventory_revision_items i ON i.product_id = p.id AND i.revision_id = ?
      WHERE lower(trim(COALESCE(p.barcode, ''))) = lower(trim(?))
         OR lower(trim(COALESCE(p.sku, ''))) = lower(trim(?))
      LIMIT 20
    `
      )
      .all(revision.id, code, code)
      .filter((row) => {
        const skuN = normalizeProductCode(row.sku);
        const bcN = normalizeProductCode(row.barcode);
        return skuN === termNorm || bcN === termNorm;
      });

    if (candidates.length === 0) {
      throw createError(
        ERROR_CODES.NOT_FOUND,
        'Mahsulot ushbu reviziyada topilmadi',
        { code: 'REVISION_PRODUCT_NOT_FOUND', barcode: code }
      );
    }

    if (candidates.length > 1) {
      throw createError(
        ERROR_CODES.CONFLICT,
        'Bir nechta mahsulot topildi — tanlang',
        {
          code: 'REVISION_BARCODE_AMBIGUOUS',
          barcode: code,
          candidates: candidates.map((c) => ({
            product_id: c.product_id,
            item_id: c.item_id,
            product_name: c.product_name,
            sku: c.sku,
            barcode: c.barcode,
          })),
        }
      );
    }

    const product = candidates[0];
    const item = this.db
      .prepare('SELECT * FROM inventory_revision_items WHERE revision_id = ? AND product_id = ?')
      .get(revision.id, product.product_id);
    if (!item) {
      throw createError(ERROR_CODES.NOT_FOUND, 'Mahsulot ushbu reviziyada topilmadi');
    }

    const previousCounted =
      item.counted_qty != null && Number.isFinite(Number(item.counted_qty))
        ? Number(item.counted_qty)
        : null;

    let countedQty;
    if (payload.counted_qty !== undefined && payload.counted_qty !== null && payload.counted_qty !== '') {
      countedQty = Number(payload.counted_qty);
    } else if (payload.increment) {
      const prev = previousCounted != null ? previousCounted : 0;
      countedQty = prev + (Number(payload.increment) || 1);
    } else if (previousCounted != null) {
      countedQty = previousCounted + 1;
    } else {
      countedQty = 1;
    }

    if (!Number.isFinite(countedQty) || countedQty < 0) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'counted_qty must be a non-negative number');
    }

    this.updateItemCount({
      revision_id: revision.id,
      product_id: product.product_id,
      counted_qty: countedQty,
      notes: payload.notes,
    });

    if (scanEventId && this._hasScanEventsTable()) {
      try {
        this.db
          .prepare(
            `
          INSERT INTO inventory_revision_scan_events (
            scan_event_id, revision_id, item_id, product_id, barcode,
            previous_counted_qty, new_counted_qty, user_id, device_id, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
          )
          .run(
            scanEventId,
            revision.id,
            item.id,
            product.product_id,
            code,
            previousCounted,
            countedQty,
            userId,
            deviceId,
            this._nowIso()
          );
      } catch (err) {
        // Unique race: treat as replay
        if (String(err?.message || '').includes('UNIQUE')) {
          const existing = this.db
            .prepare(`SELECT * FROM inventory_revision_scan_events WHERE scan_event_id = ?`)
            .get(scanEventId);
          if (existing) {
            const focused = this.getRevision(revision.id, {
              filter: 'all',
              focus_item_id: existing.item_id,
            });
            return {
              ...focused,
              matched_item: (focused.items || [])[0] || null,
              focus_item_id: existing.item_id,
              counted_qty: existing.new_counted_qty,
              previous_counted_qty: existing.previous_counted_qty,
              scan_event_id: scanEventId,
              idempotent_replay: true,
            };
          }
        }
        console.warn('[inventoryRevision] scan_event insert failed:', err?.message || err);
      }
    }

    this._audit('scan_count', revision, userId, {
      barcode: code,
      product_id: product.product_id,
      item_id: item.id,
      previous_counted_qty: previousCounted,
      new_counted_qty: countedQty,
      scan_event_id: scanEventId,
      device_id: deviceId,
    });

    const focused = this.getRevision(revision.id, {
      filter: 'all',
      focus_item_id: item.id,
    });
    const matched = (focused.items || []).find((it) => it.id === item.id) || null;

    return {
      ...focused,
      matched_item: matched,
      focus_item_id: item.id,
      counted_qty: countedQty,
      previous_counted_qty: previousCounted,
      scan_event_id: scanEventId,
      idempotent_replay: false,
    };
  }

  _assertCanComplete(revision, summary, payload = {}) {
    const userRole = payload.user_role || payload.userRole || null;
    // Client flags alone are not enough — role must authorize completion.
    const managerOk = roleCanApproveInventoryRevision(userRole);
    const approverId =
      payload.approver_id ||
      payload.approverId ||
      (managerOk ? payload.created_by || payload.user_id || null : null);

    if (summary.total_items <= 0) {
      throw createError(
        ERROR_CODES.VALIDATION_ERROR,
        'Cannot complete revision: no products in scope'
      );
    }
    if (summary.counted_items === 0) {
      throw createError(
        ERROR_CODES.VALIDATION_ERROR,
        'Cannot complete revision: no products have been counted'
      );
    }
    if (summary.pending_items > 0) {
      throw createError(
        ERROR_CODES.VALIDATION_ERROR,
        `Cannot complete revision: ${summary.pending_items} product(s) not counted`
      );
    }
    if (summary.counted_items !== summary.total_items) {
      throw createError(
        ERROR_CODES.VALIDATION_ERROR,
        `Cannot complete revision: counted ${summary.counted_items} of ${summary.total_items}`
      );
    }
    if (!managerOk) {
      throw createError(
        ERROR_CODES.FORBIDDEN,
        'Manager or admin approval is required to complete a revision'
      );
    }
    if (!approverId) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Approver is required');
    }
    return { managerOk, approverId: approverId || revision.responsible_user_id || revision.created_by };
  }

  /**
   * Apply per-item stock deltas (counted − live) then mark revision complete atomically.
   */
  completeRevision(payload = {}) {
    this._requireTables();
    const revisionId = String(payload.revision_id || '').trim();
    if (!revisionId) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Revision ID is required');
    }

    const revisionPre = this._getRevisionRow(revisionId);
    if (!ACTIVE_STATUSES.has(revisionPre.status)) {
      if (revisionPre.status === 'completed' || revisionPre.status === 'partially_completed') {
        throw createError(ERROR_CODES.VALIDATION_ERROR, 'Revision already completed');
      }
      throw createError(
        ERROR_CODES.VALIDATION_ERROR,
        `Revision is ${revisionPre.status} and cannot be completed`
      );
    }

    const preview = this._completePreview(revisionId);
    if (!preview.can_complete) {
      if (preview.counted_items === 0) {
        throw createError(
          ERROR_CODES.VALIDATION_ERROR,
          'Cannot complete revision: no products have been counted'
        );
      }
      throw createError(
        ERROR_CODES.VALIDATION_ERROR,
        `Cannot complete revision: ${preview.pending_items} product(s) not counted`
      );
    }

    this._assertCanComplete(revisionPre, preview, payload);

    const approveStockDrift =
      payload.approve_stock_drift === true ||
      payload.approveStockDrift === true ||
      roleCanApproveInventoryRevision(payload.user_role || payload.userRole);

    if (preview.stock_drift_items > 0 && !approveStockDrift) {
      throw createError(
        ERROR_CODES.VALIDATION_ERROR,
        `Stock changed during revision (${preview.stock_drift_items} item(s)); recount or manager approval required`
      );
    }

    const now = this._nowIso();
    const notesUpdate =
      payload.notes != null ? String(payload.notes).trim() || null : null;
    const userId = payload.created_by || payload.user_id || revisionPre.created_by || null;
    const approverId =
      payload.approver_id ||
      payload.approverId ||
      (roleCanApproveInventoryRevision(payload.user_role || payload.userRole) ? userId : null);

    const result = this.db.transaction(() => {
      const revision = this._getRevisionRow(revisionId);
      if (!ACTIVE_STATUSES.has(revision.status)) {
        if (revision.status === 'completed' || revision.status === 'partially_completed') {
          throw createError(ERROR_CODES.VALIDATION_ERROR, 'Revision already completed');
        }
        throw createError(
          ERROR_CODES.VALIDATION_ERROR,
          `Revision is ${revision.status} and cannot be completed`
        );
      }

      const snapRows = this.db
        .prepare('SELECT * FROM inventory_revision_items WHERE revision_id = ?')
        .all(revision.id);
      const liveByProduct = this._liveQtyMap(revision.id, revision.warehouse_id);
      const stockDriftItems = this._countStockDrift(snapRows, liveByProduct);
      const summary = this._revisionSummary(revision.id, stockDriftItems);
      this._assertCanComplete(revision, summary, payload);

      if (stockDriftItems > 0 && !approveStockDrift) {
        throw createError(
          ERROR_CODES.VALIDATION_ERROR,
          `Stock changed during revision (${stockDriftItems} item(s)); recount or manager approval required`
        );
      }

      const counted = snapRows.filter((row) => row.counted_qty != null);
      const toAdjust = [];
      const stockDrift = [];

      for (const row of counted) {
        const target = Number(row.counted_qty);
        if (!Number.isFinite(target)) continue;
        const mappedLive = liveByProduct.get(row.product_id);
        const live =
          mappedLive != null
            ? Number(mappedLive) || 0
            : Number(this.inventory.getCurrentStock(row.product_id, revision.warehouse_id)) || 0;
        const snap = Number(row.system_qty) || 0;
        if (Math.abs(live - snap) > 0.0001) {
          stockDrift.push({
            product_id: row.product_id,
            system_qty: snap,
            live_qty: live,
            current_qty: live,
            counted_qty: target,
          });
        }
        const delta = target - live;
        if (Math.abs(delta) > 0.0001) {
          toAdjust.push({ ...row, live_qty: live, delta });
        }
      }

      const adjustmentIds = [];
      if (toAdjust.length > 0) {
        if (!this.inventory || typeof this.inventory.adjustStock !== 'function') {
          throw createError(ERROR_CODES.INTERNAL_ERROR, 'InventoryService.adjustStock unavailable');
        }
        for (const row of toAdjust) {
          const delta = Number(row.delta);
          const adjType = delta > 0 ? 'surplus' : 'shortage';
          const adj = this.inventory.adjustStock({
            warehouse_id: revision.warehouse_id,
            adjustment_type: adjType,
            reason: `Reviziya ${revision.revision_number}: ${adjType}`,
            notes: `revision_id=${revision.id}; revision_item_id=${row.id}; snapshot=${row.system_qty}; counted=${row.counted_qty}; live=${row.live_qty}`,
            created_by: userId,
            approver_id: approverId,
            authorized: true,
            allow_during_open_revision: true,
            items: [
              {
                product_id: row.product_id,
                quantity: delta,
                notes: `revision_item_id=${row.id}`,
                unit_cost:
                  delta > 0 && this.inventory?.batchService?.defaultUnitCost
                    ? this.inventory.batchService.defaultUnitCost(row.product_id)
                    : undefined,
              },
            ],
          });
          if (adj && adj.id) adjustmentIds.push(adj.id);
        }
      }

      const finalStatus =
        (revision.revision_type || 'full') === 'partial' ? 'partially_completed' : 'completed';

      const claim = this.db
        .prepare(
          `
        UPDATE inventory_revisions
        SET status = ?, completed_at = ?, updated_at = ?, notes = COALESCE(?, notes),
            completed_by = ?, approved_by = ?
        WHERE id = ? AND status IN ('draft', 'in_progress')
      `
        )
        .run(finalStatus, now, now, notesUpdate, userId, approverId, revisionId);

      if (!claim.changes) {
        throw createError(ERROR_CODES.CONFLICT, 'Revision was already completed by another process');
      }

      return {
        adjustmentIds,
        toAdjustCount: toAdjust.length,
        countedCount: counted.length,
        stockDrift,
        finalStatus,
      };
    })();

    const full = this.getRevision(revisionId);
    this._audit('complete', full, userId, {
      adjusted_items: result.toAdjustCount,
      stock_drift_items: result.stockDrift.length,
      final_status: result.finalStatus,
    });
    return {
      ...full,
      adjustment_ids: result.adjustmentIds,
      adjustment_id: result.adjustmentIds[0] || null,
      adjusted_items: result.toAdjustCount,
      counted_items: result.countedCount,
      stock_drift_items: result.stockDrift.length,
      stock_drift: result.stockDrift,
      stock_changed_since_snapshot: result.stockDrift.length > 0,
    };
  }

  bulkSetItemCounts(payload = {}) {
    this._requireTables();
    const revision = this._getRevisionRow(payload.revision_id);
    this._assertEditable(revision);

    if (payload.counted_qty === undefined || payload.counted_qty === null || payload.counted_qty === '') {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'counted_qty is required');
    }
    const countedQty = Number(payload.counted_qty);
    if (!Number.isFinite(countedQty) || countedQty < 0) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'counted_qty must be a non-negative number');
    }

    let items;
    if (Array.isArray(payload.item_ids) && payload.item_ids.length > 0) {
      const placeholders = payload.item_ids.map(() => '?').join(',');
      items = this.db
        .prepare(
          `
        SELECT * FROM inventory_revision_items
        WHERE revision_id = ? AND id IN (${placeholders})
      `
        )
        .all(revision.id, ...payload.item_ids.map(String));
    } else if (payload.only_pending) {
      items = this.db
        .prepare(
          `
        SELECT * FROM inventory_revision_items
        WHERE revision_id = ? AND counted_qty IS NULL
      `
        )
        .all(revision.id);
    } else {
      throw createError(
        ERROR_CODES.VALIDATION_ERROR,
        'item_ids or only_pending is required'
      );
    }

    if (payload.only_pending) {
      items = items.filter((row) => row.counted_qty == null);
    }

    if (!items.length) {
      return this.getRevision(revision.id, {
        filter: payload.filter,
        search: payload.search,
      });
    }

    const now = this._nowIso();
    const upd = this.db.prepare(`
      UPDATE inventory_revision_items
      SET counted_qty = ?, variance = ?, counted_at = ?, updated_at = ?
      WHERE id = ? AND revision_id = ?
    `);

    this.db.transaction(() => {
      for (const item of items) {
        const variance = countedQty - (Number(item.system_qty) || 0);
        upd.run(countedQty, variance, now, now, item.id, revision.id);
      }
      this.db
        .prepare(`UPDATE inventory_revisions SET updated_at = ? WHERE id = ?`)
        .run(now, revision.id);
    })();

    return this.getRevision(revision.id, {
      filter: payload.filter,
      search: payload.search,
    });
  }

  cancelRevision(payload = {}) {
    this._requireTables();
    const revision = this._getRevisionRow(payload.revision_id);
    if (revision.status === 'completed' || revision.status === 'partially_completed') {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Completed revision cannot be cancelled');
    }
    if (revision.status === 'cancelled') {
      return this.getRevision(revision.id);
    }
    const cancelReason = String(
      payload.cancel_reason || payload.reason || payload.notes || ''
    ).trim();
    if (!cancelReason) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Cancel reason is required');
    }
    const now = this._nowIso();
    const userId = payload.cancelled_by || payload.user_id || payload.created_by || null;
    this.db
      .prepare(
        `
      UPDATE inventory_revisions
      SET status = 'cancelled', updated_at = ?, cancel_reason = ?, notes = COALESCE(?, notes),
          cancelled_by = ?, cancelled_at = ?
      WHERE id = ?
    `
      )
      .run(now, cancelReason, cancelReason, userId, now, revision.id);
    const cancelled = this.getRevision(revision.id);
    this._audit('cancel', cancelled, userId, { cancel_reason: cancelReason });
    return cancelled;
  }
}

module.exports = InventoryRevisionService;

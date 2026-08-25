'use strict';

const { randomUUID } = require('crypto');
const { ERROR_CODES, createError } = require('../lib/errors.cjs');

const MAIN_WAREHOUSE_ID = 'main-warehouse-001';
const ACTIVE_STATUSES = new Set(['draft', 'in_progress']);

/**
 * Warehouse inventory revision (ombor reviziyasi) — Phase 1.
 * Snapshots system qty, tracks counted vs not counted, applies only counted
 * items via InventoryService.adjustStock({ adjustment_type: 'set' }).
 */
class InventoryRevisionService {
  constructor(db, inventoryService) {
    this.db = db;
    this.inventory = inventoryService;
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
        SELECT id, revision_number, warehouse_id, status, created_at
        FROM inventory_revisions
        WHERE warehouse_id = ?
          AND status IN ('draft', 'in_progress')
        ORDER BY created_at DESC
        LIMIT 1
      `
        )
        .get(id) || null
    );
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
    const open = this.findOpenRevision(warehouseId);
    if (open) {
      throw createError(
        ERROR_CODES.VALIDATION_ERROR,
        `Ochiq ombor reviziyasi bor (${open.revision_number}). Avval uni yakunlang yoki bekor qiling.`
      );
    }
    const notes = payload.notes != null ? String(payload.notes).trim() || null : null;
    const createdBy = payload.created_by || null;
    const now = this._nowIso();
    const revisionId = randomUUID();
    const revisionNumber = `REV-${Date.now()}-${randomUUID().slice(0, 8)}`;

    const products = this.db
      .prepare(
        `
      SELECT
        p.id,
        COALESCE(u.code, p.unit, p.base_unit) AS unit,
        COALESCE(p.is_active, 1) AS is_active,
        COALESCE(p.track_stock, 1) AS track_stock
      FROM products p
      LEFT JOIN units u ON u.id = p.unit_id
      WHERE COALESCE(p.track_stock, 1) = 1
        AND COALESCE(p.is_active, 1) = 1
      ORDER BY p.name COLLATE NOCASE ASC
    `
      )
      .all();

    if (!products.length) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'No stock-tracked products to revise');
    }

    const insertRev = this.db.prepare(`
      INSERT INTO inventory_revisions (
        id, revision_number, warehouse_id, status, notes, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, 'in_progress', ?, ?, ?, ?)
    `);
    const insertItem = this.db.prepare(`
      INSERT INTO inventory_revision_items (
        id, revision_id, product_id, system_qty, counted_qty, variance, unit, created_at, updated_at
      ) VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, ?)
    `);

    this.db.transaction(() => {
      insertRev.run(revisionId, revisionNumber, warehouseId, notes, createdBy, now, now);
      for (const p of products) {
        const systemQty = Number(this.inventory.getCurrentStock(p.id, warehouseId)) || 0;
        insertItem.run(
          randomUUID(),
          revisionId,
          p.id,
          systemQty,
          p.unit || null,
          now,
          now
        );
      }
    })();

    return this.getRevision(revisionId);
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

  getRevision(revisionId, opts = {}) {
    this._requireTables();
    const revision = this._getRevisionRow(revisionId);
    const filter = String(opts.count_filter || opts.filter || 'all').toLowerCase();
    const search = String(opts.search || '').trim().toLowerCase();

    let itemsSql = `
      SELECT
        i.*,
        p.name AS product_name,
        p.sku AS product_sku,
        p.barcode AS product_barcode,
        COALESCE(u.code, p.unit, p.base_unit, i.unit) AS product_unit
      FROM inventory_revision_items i
      INNER JOIN products p ON p.id = i.product_id
      LEFT JOIN units u ON u.id = p.unit_id
      WHERE i.revision_id = ?
    `;
    const params = [revision.id];

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

    if (search) {
      itemsSql += ` AND (
        LOWER(COALESCE(p.name, '')) LIKE ?
        OR LOWER(COALESCE(p.sku, '')) LIKE ?
        OR LOWER(COALESCE(p.barcode, '')) LIKE ?
      )`;
      const like = `%${search}%`;
      params.push(like, like, like);
    }

    itemsSql += ' ORDER BY p.name COLLATE NOCASE ASC';

    const rawItems = this.db.prepare(itemsSql).all(...params);
    const liveByProduct = this._liveQtyMap(revision.id, revision.warehouse_id);
    const snapRows = this.db
      .prepare(
        `SELECT product_id, system_qty FROM inventory_revision_items WHERE revision_id = ?`
      )
      .all(revision.id);
    const stockDriftItems = this._countStockDrift(snapRows, liveByProduct);
    const items = rawItems.map((row) =>
      this._enrichItem(row, liveByProduct.get(row.product_id))
    );
    const summary = this._revisionSummary(revision.id, stockDriftItems);

    return {
      ...revision,
      warehouse_name:
        this.db.prepare('SELECT name FROM warehouses WHERE id = ?').get(revision.warehouse_id)
          ?.name || null,
      items,
      summary,
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
   */
  countByBarcode(payload = {}) {
    this._requireTables();
    const revision = this._getRevisionRow(payload.revision_id);
    this._assertEditable(revision);
    const code = String(payload.barcode || payload.code || '').trim();
    if (!code) throw createError(ERROR_CODES.VALIDATION_ERROR, 'barcode is required');

    const product = this.db
      .prepare(
        `
      SELECT p.id
      FROM products p
      INNER JOIN inventory_revision_items i ON i.product_id = p.id AND i.revision_id = ?
      WHERE p.barcode = ? OR p.sku = ?
      LIMIT 1
    `
      )
      .get(revision.id, code, code);
    if (!product) {
      throw createError(ERROR_CODES.NOT_FOUND, `Product not found in revision for code: ${code}`);
    }

    const item = this.db
      .prepare('SELECT * FROM inventory_revision_items WHERE revision_id = ? AND product_id = ?')
      .get(revision.id, product.id);

    let countedQty;
    if (payload.counted_qty !== undefined && payload.counted_qty !== null && payload.counted_qty !== '') {
      countedQty = Number(payload.counted_qty);
    } else if (payload.increment) {
      const prev = item.counted_qty != null ? Number(item.counted_qty) : 0;
      countedQty = prev + (Number(payload.increment) || 1);
    } else if (item.counted_qty != null) {
      countedQty = Number(item.counted_qty) + 1;
    } else {
      countedQty = 1;
    }

    return this.updateItemCount({
      revision_id: revision.id,
      product_id: product.id,
      counted_qty: countedQty,
      notes: payload.notes,
    });
  }

  /**
   * Apply stock set only for counted items; leave uncounted unchanged.
   * Status claim is atomic inside the transaction so parallel completes cannot double-apply.
   */
  completeRevision(payload = {}) {
    this._requireTables();
    const revisionId = String(payload.revision_id || '').trim();
    if (!revisionId) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Revision ID is required');
    }

    const now = this._nowIso();
    const notesUpdate =
      payload.notes != null ? String(payload.notes).trim() || null : null;

    const result = this.db.transaction(() => {
      const claim = this.db
        .prepare(
          `
        UPDATE inventory_revisions
        SET status = 'completed', completed_at = ?, updated_at = ?, notes = COALESCE(?, notes)
        WHERE id = ? AND status IN ('draft', 'in_progress')
      `
        )
        .run(now, now, notesUpdate, revisionId);

      if (!claim.changes) {
        const row = this.db
          .prepare('SELECT id, status FROM inventory_revisions WHERE id = ?')
          .get(revisionId);
        if (!row) {
          throw createError(ERROR_CODES.NOT_FOUND, `Revision not found: ${revisionId}`);
        }
        if (row.status === 'completed') {
          throw createError(
            ERROR_CODES.VALIDATION_ERROR,
            'Revision already completed'
          );
        }
        throw createError(
          ERROR_CODES.VALIDATION_ERROR,
          `Revision is ${row.status} and cannot be completed`
        );
      }

      const revision = this.db
        .prepare('SELECT * FROM inventory_revisions WHERE id = ?')
        .get(revisionId);

      const counted = this.db
        .prepare(
          `
        SELECT * FROM inventory_revision_items
        WHERE revision_id = ? AND counted_qty IS NOT NULL
      `
        )
        .all(revision.id);

      if (!counted.length) {
        throw createError(
          ERROR_CODES.VALIDATION_ERROR,
          'Cannot complete revision: no products have been counted'
        );
      }

      // Always write counted_qty for every counted item (idempotent set).
      // Do NOT skip when variance vs snapshot is 0 — live stock may have drifted.
      const toAdjust = [];
      const stockDrift = [];
      for (const row of counted) {
        const target = Number(row.counted_qty);
        if (!Number.isFinite(target)) continue;
        const live =
          this.inventory && typeof this.inventory.getCurrentStock === 'function'
            ? Number(this.inventory.getCurrentStock(row.product_id, revision.warehouse_id)) || 0
            : Number(row.system_qty) || 0;
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
        toAdjust.push(row);
      }

      let adjustment = null;
      if (toAdjust.length > 0) {
        if (!this.inventory || typeof this.inventory.adjustStock !== 'function') {
          throw createError(ERROR_CODES.INTERNAL_ERROR, 'InventoryService.adjustStock unavailable');
        }
        adjustment = this.inventory.adjustStock({
          warehouse_id: revision.warehouse_id,
          adjustment_type: 'set',
          reason: `Ombor reviziyasi ${revision.revision_number}`,
          notes: `revision_id=${revision.id}`,
          created_by: payload.created_by || revision.created_by || null,
          allow_during_open_revision: true,
          items: toAdjust.map((row) => ({
            product_id: row.product_id,
            target_quantity: Number(row.counted_qty),
            notes: `revision_item_id=${row.id}`,
          })),
        });
      }

      return {
        adjustment,
        toAdjustCount: toAdjust.length,
        countedCount: counted.length,
        stockDrift,
      };
    })();

    const full = this.getRevision(revisionId);
    return {
      ...full,
      adjustment_id: result.adjustment?.id || null,
      adjusted_items: result.toAdjustCount,
      counted_items: result.countedCount,
      stock_drift_items: result.stockDrift.length,
      stock_drift: result.stockDrift,
      stock_changed_since_snapshot: result.stockDrift.length > 0,
    };
  }

  /**
   * Set counted_qty for many items at once (e.g. mark filtered pending as zero).
   */
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
    if (revision.status === 'completed') {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Completed revision cannot be cancelled');
    }
    if (revision.status === 'cancelled') {
      return this.getRevision(revision.id);
    }
    const now = this._nowIso();
    this.db
      .prepare(
        `
      UPDATE inventory_revisions
      SET status = 'cancelled', updated_at = ?, notes = COALESCE(?, notes)
      WHERE id = ?
    `
      )
      .run(
        now,
        payload.notes != null ? String(payload.notes).trim() || null : null,
        revision.id
      );
    return this.getRevision(revision.id);
  }
}

module.exports = InventoryRevisionService;

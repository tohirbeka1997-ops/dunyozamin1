const { randomUUID } = require('crypto');
const { ERROR_CODES, createError } = require('../lib/errors.cjs');

/**
 * BatchService
 * Inventory batches + allocations to enable FIFO costing, accurate profit, and audit traceability.
 *
 * IMPORTANT:
 * - Overall stock "source of truth" remains inventory_movements (see InventoryService).
 * - This service manages batch quantities (remaining_qty) and allocation records.
 * - Call write methods inside the SAME db.transaction() as the corresponding stock movement.
 */
class BatchService {
  /**
   * @param {import('better-sqlite3').Database} db
   * @param {any} inventoryService Used for stock reconciliation.
   */
  constructor(db, inventoryService) {
    this.db = db;
    this.inventoryService = inventoryService;
    this._batchCols = null;
  }

  // ---------------------------------------------------------------------------
  // Basics
  // ---------------------------------------------------------------------------
  _nowSql() {
    return new Date().toISOString().replace('T', ' ').replace('Z', '').substring(0, 19);
  }

  _resolveWarehouseId(warehouseId) {
    return warehouseId || 'main-warehouse-001';
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

  _requireBatchTables() {
    if (!this._hasTable('inventory_batches') || !this._hasTable('inventory_batch_allocations')) {
      const err = createError(
        ERROR_CODES.DB_ERROR,
        'Batch tables are missing. Please run database migrations (inventory_batches, inventory_batch_allocations).'
      );
      err.details = { missing: ['inventory_batches', 'inventory_batch_allocations'] };
      throw err;
    }
  }

  _getBatchCols() {
    if (this._batchCols) return this._batchCols;
    try {
      const cols = this.db.prepare(`PRAGMA table_info(inventory_batches)`).all() || [];
      this._batchCols = new Set(cols.map((c) => c.name));
    } catch {
      this._batchCols = new Set();
    }
    return this._batchCols;
  }

  _hasBatchCol(name) {
    return this._getBatchCols().has(name);
  }

  _insertBatch(fields) {
    const cols = [];
    const vals = [];
    for (const [key, value] of Object.entries(fields)) {
      if (!this._hasBatchCol(key)) continue;
      cols.push(key);
      vals.push(value);
    }
    if (cols.length === 0) {
      throw createError(ERROR_CODES.DB_ERROR, 'inventory_batches schema mismatch: no insertable columns found');
    }
    const placeholders = cols.map(() => '?').join(', ');
    const sql = `INSERT INTO inventory_batches (${cols.join(', ')}) VALUES (${placeholders})`;
    this.db.prepare(sql).run(...vals);
  }

  // ---------------------------------------------------------------------------
  // Settings helpers (batch enable + cutover)
  // ---------------------------------------------------------------------------
  _getSettingValue(key) {
    try {
      const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
      return row?.value ?? null;
    } catch {
      return null;
    }
  }

  _isTruthySetting(key) {
    const v = this._getSettingValue(key);
    return v === '1' || v === 'true' || v === 'TRUE' || v === 'yes';
  }

  isBatchModeEnabled() {
    return this._isTruthySetting('inventory.batch_mode_enabled') || this._isTruthySetting('batch_mode_enabled');
  }

  getCutoverAt() {
    // Expected format: 'YYYY-MM-DD HH:MM:SS'
    return this._getSettingValue('inventory.batch_cutover_at');
  }

  /**
   * Whether to strictly enforce batches at the given timestamp.
   * - If enabled but no cutover configured => enforce immediately (safe default).
   */
  shouldEnforceAt(timestampSqlLike) {
    if (!this.isBatchModeEnabled()) return false;
    const cutoverAt = this.getCutoverAt();
    if (!cutoverAt) return true;
    const ts = String(timestampSqlLike || '');
    return ts >= cutoverAt; // lexicographic ok for normalized timestamps
  }

  /**
   * Alias used by some code.
   */
  isBatchModeActive(at) {
    return this.shouldEnforceAt(at || this._nowSql());
  }

  _upsertSetting({ key, value, type = 'string', category = 'inventory', description = null, isPublic = 0, updatedBy = null }) {
    const allowedTypes = new Set(['string', 'number', 'boolean', 'json']);
    if (!key) throw createError(ERROR_CODES.VALIDATION_ERROR, 'Setting key is required');
    if (!allowedTypes.has(type)) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, `Invalid setting type: ${type}`);
    }

    const now = this._nowSql();
    const serialized =
      type === 'boolean'
        ? (value ? '1' : '0')
        : type === 'json'
          ? JSON.stringify(value ?? null)
          : String(value ?? '');

    const existing = this.db.prepare('SELECT id FROM settings WHERE key = ?').get(key);
    if (existing?.id) {
      this.db
        .prepare(
          `
          UPDATE settings
          SET value = ?, type = ?, description = COALESCE(?, description), category = COALESCE(?, category),
              is_public = COALESCE(?, is_public),
              updated_by = ?, updated_at = ?
          WHERE key = ?
        `
        )
        .run(serialized, type, description, category, isPublic, updatedBy, now, key);
      return { key, value: serialized, type };
    }

    this.db
      .prepare(
        `
        INSERT INTO settings (id, key, value, type, description, category, is_public, updated_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
      )
      .run(randomUUID(), key, serialized, type, description, category, isPublic, updatedBy, now, now);
    return { key, value: serialized, type };
  }

  // ---------------------------------------------------------------------------
  // Cost helpers (for opening batches / adjustments)
  // ---------------------------------------------------------------------------
  _getLatestReceivedUnitCost(productId) {
    try {
      const row = this.db
        .prepare(
          `
          SELECT poi.unit_cost
          FROM purchase_order_items poi
          INNER JOIN purchase_orders po ON po.id = poi.purchase_order_id
          WHERE poi.product_id = ?
            AND po.status = 'received'
            AND COALESCE(poi.received_qty, 0) > 0
          ORDER BY po.created_at DESC
          LIMIT 1
        `
        )
        .get(productId);
      if (row && row.unit_cost != null) return Number(row.unit_cost) || 0;
    } catch {
      // ignore
    }
    return null;
  }

  _getProductPurchasePrice(productId) {
    try {
      const row = this.db.prepare('SELECT purchase_price FROM products WHERE id = ?').get(productId);
      if (row && row.purchase_price != null) return Number(row.purchase_price) || 0;
    } catch {
      // ignore
    }
    return 0;
  }

  defaultUnitCost(productId) {
    const latest = this._getLatestReceivedUnitCost(productId);
    if (latest != null) return latest;
    return this._getProductPurchasePrice(productId);
  }

  // ---------------------------------------------------------------------------
  // Cutover (opening batches)
  // ---------------------------------------------------------------------------

  /**
   * One-time cutover snapshot: stores settings and creates opening batches based on current stock.
   * Idempotent per (product_id, warehouse_id, opened_at) so re-running is safe.
   */
  runCutoverSnapshot({ cutoverAt, warehouseId, costMode = 'last_received_po_cost', updatedBy = null } = {}) {
    this._requireBatchTables();
    if (!cutoverAt) throw createError(ERROR_CODES.VALIDATION_ERROR, 'cutoverAt is required');
    const wh = this._resolveWarehouseId(warehouseId);

    // normalize: accept ISO too
    const cutoverAtSql = String(cutoverAt).replace('T', ' ').replace('Z', '').substring(0, 19);

    return this.db.transaction(() => {
      // 1) Persist settings (category: inventory)
      this._upsertSetting({
        key: 'inventory.batch_mode_enabled',
        value: true,
        type: 'boolean',
        category: 'inventory',
        description: 'Enable inventory batch mode (FIFO costing)',
        isPublic: 1,
        updatedBy,
      });
      this._upsertSetting({
        key: 'inventory.batch_cutover_at',
        value: cutoverAtSql,
        type: 'string',
        category: 'inventory',
        description: 'Batch mode cutover timestamp (YYYY-MM-DD HH:MM:SS)',
        isPublic: 1,
        updatedBy,
      });
      this._upsertSetting({
        key: 'inventory.batch_opening_cost_mode',
        value: String(costMode),
        type: 'string',
        category: 'inventory',
        description: 'Opening batch cost mode (last_received_po_cost | product_purchase_price | manual_once)',
        isPublic: 1,
        updatedBy,
      });

      // 2) Create opening batches
      const result = this.createOpeningBatchesForWarehouse({
        warehouseId: wh,
        openedAt: cutoverAtSql,
        costMode,
      });

      return {
        ok: true,
        settings: {
          batch_mode_enabled: true,
          batch_cutover_at: cutoverAtSql,
          batch_opening_cost_mode: String(costMode),
        },
        ...result,
      };
    })();
  }

  createOpeningBatchesForWarehouse({ warehouseId, openedAt, costMode = 'last_received_po_cost' } = {}) {
    this._requireBatchTables();
    if (!openedAt) throw createError(ERROR_CODES.VALIDATION_ERROR, 'openedAt is required');
    const wh = this._resolveWarehouseId(warehouseId);
    const openedAtSql = String(openedAt).replace('T', ' ').replace('Z', '').substring(0, 19);

    const products = this.db
      .prepare(
        `
        SELECT id, name, purchase_price
        FROM products
        WHERE track_stock = 1
      `
      )
      .all();

    let created = 0;
    let skipped = 0;
    const createdBatches = [];

    for (const p of products) {
      const productId = String(p.id);
      const stock =
        this.inventoryService?.getCurrentStock
          ? Number(this.inventoryService.getCurrentStock(productId, wh)) || 0
          : 0;
      if (!(stock > 0)) {
        skipped++;
        continue;
      }

      const already = this.db
        .prepare(
          `
          SELECT 1
          FROM inventory_batches
          WHERE product_id = ?
            AND warehouse_id = ?
            AND source_type = 'opening'
            AND opened_at = ?
          LIMIT 1
        `
        )
        .get(productId, wh, openedAtSql);
      if (already) {
        skipped++;
        continue;
      }

      let unitCost = 0;
      if (String(costMode) === 'last_received_po_cost') {
        unitCost = this.defaultUnitCost(productId);
      } else if (String(costMode) === 'product_purchase_price') {
        unitCost = Number(p.purchase_price || 0) || 0;
      } else {
        // manual_once not implemented as a batch job (requires UI input per product)
        unitCost = this.defaultUnitCost(productId);
      }

      const batch = this.createOpeningBatch(productId, wh, stock, unitCost, openedAtSql, null);
      created++;
      createdBatches.push(batch);
    }

    return {
      warehouse_id: wh,
      opened_at: openedAtSql,
      created,
      skipped,
      batches: createdBatches,
    };
  }

  // ---------------------------------------------------------------------------
  // Read APIs (UI/reporting)
  // ---------------------------------------------------------------------------
  listBatchesByProduct(productId, warehouseId) {
    this._requireBatchTables();
    if (!productId) throw createError(ERROR_CODES.VALIDATION_ERROR, 'productId is required');
    const wh = this._resolveWarehouseId(warehouseId);
    return this.db
      .prepare(
        `
        SELECT
          b.*,
          p.name AS product_name,
          p.sku AS product_sku,
          w.name AS warehouse_name
        FROM inventory_batches b
        INNER JOIN products p ON p.id = b.product_id
        INNER JOIN warehouses w ON w.id = b.warehouse_id
        WHERE b.product_id = ? AND b.warehouse_id = ?
        ORDER BY b.opened_at DESC, b.created_at DESC
      `
      )
      .all(productId, wh);
  }

  getBatchStock(productId, warehouseId) {
    this._requireBatchTables();
    const wh = this._resolveWarehouseId(warehouseId);
    const row = this.db
      .prepare(
        `
        SELECT COALESCE(SUM(remaining_qty), 0) AS stock
        FROM inventory_batches
        WHERE product_id = ? AND warehouse_id = ?
      `
      )
      .get(productId, wh);
    return Number(row?.stock || 0) || 0;
  }

  // ---------------------------------------------------------------------------
  // Batch creation
  // ---------------------------------------------------------------------------

  /**
   * Supports both call styles:
   * - createBatchFromPurchase({ purchaseOrderId, productId, warehouseId, quantity, unitCost, supplierId?, supplierName?, docNo?, openedAt? })
   * - createBatchFromPurchase(purchaseOrderId, productId, warehouseId, quantity, unitCost, supplierSnapshot?, openedAt?)
   */
  createBatchFromPurchase(arg1, productId, warehouseId, quantity, unitCost, supplierSnapshot = null, openedAt) {
    this._requireBatchTables();

    let payload;
    if (arg1 && typeof arg1 === 'object') {
      payload = arg1;
    } else {
      payload = {
        purchaseOrderId: arg1,
        productId,
        warehouseId,
        quantity,
        unitCost,
        supplierId: supplierSnapshot?.supplier_id || null,
        supplierName: supplierSnapshot?.supplier_name || null,
        docNo: supplierSnapshot?.doc_no || null,
        openedAt,
      };
    }

    const purchaseOrderId2 = payload.purchaseOrderId;
    const productId2 = payload.productId;
    const warehouseId2 = this._resolveWarehouseId(payload.warehouseId);
    const qty = Number(payload.quantity || 0);
    const cost = Number(payload.unitCost || 0);
    const openedAt2 = payload.openedAt || this._nowSql();

    if (!purchaseOrderId2) throw createError(ERROR_CODES.VALIDATION_ERROR, 'purchaseOrderId is required');
    if (!productId2) throw createError(ERROR_CODES.VALIDATION_ERROR, 'productId is required');
    if (!(qty > 0)) throw createError(ERROR_CODES.VALIDATION_ERROR, 'quantity must be > 0');
    if (!(cost >= 0)) throw createError(ERROR_CODES.VALIDATION_ERROR, 'unitCost must be >= 0');

    // Snapshot supplier / doc number if not provided
    let supplierId = payload.supplierId || null;
    let supplierName = payload.supplierName || null;
    let docNo = payload.docNo || null;
    try {
      const po = this.db
        .prepare('SELECT po_number, supplier_id, supplier_name FROM purchase_orders WHERE id = ?')
        .get(purchaseOrderId2);
      if (po) {
        docNo = docNo || po.po_number || null;
        supplierId = supplierId || po.supplier_id || null;
        supplierName = supplierName || po.supplier_name || null;
      }
    } catch {
      // ignore
    }

    const now = this._nowSql();
    const batchId = randomUUID();

    this._insertBatch({
      id: batchId,
      product_id: productId2,
      warehouse_id: warehouseId2,
      opened_at: openedAt2,
      unit_cost: cost,
      cost_price_uzs: cost,
      initial_qty: qty,
      remaining_qty: qty,
      source_type: 'purchase_receive',
      source_id: purchaseOrderId2,
      supplier_id: supplierId,
      supplier_name: supplierName,
      doc_no: docNo,
      status: 'active',
      created_at: now,
    });

    return this.db.prepare('SELECT * FROM inventory_batches WHERE id = ?').get(batchId);
  }

  /**
   * Create batch from purchase receipt (receipt-only flow)
   * payload: {
   *  receiptId, receiptItemId, productId, warehouseId, quantity, unitCost,
   *  supplierId?, supplierName?, docNo?, openedAt?, currency?, exchangeRate?,
   *  usdPrice?, usdTotal?
   * }
   */
  createBatchFromReceipt(payload = {}) {
    this._requireBatchTables();

    const receiptId = payload.receiptId;
    const receiptItemId = payload.receiptItemId;
    const productId2 = payload.productId;
    const warehouseId2 = this._resolveWarehouseId(payload.warehouseId);
    const qty = Number(payload.quantity || 0);
    const cost = Number(payload.unitCost || 0);
    const openedAt2 = payload.openedAt || this._nowSql();

    if (!receiptId) throw createError(ERROR_CODES.VALIDATION_ERROR, 'receiptId is required');
    if (!receiptItemId) throw createError(ERROR_CODES.VALIDATION_ERROR, 'receiptItemId is required');
    if (!productId2) throw createError(ERROR_CODES.VALIDATION_ERROR, 'productId is required');
    if (!(qty > 0)) throw createError(ERROR_CODES.VALIDATION_ERROR, 'quantity must be > 0');
    if (!(cost >= 0)) throw createError(ERROR_CODES.VALIDATION_ERROR, 'unitCost must be >= 0');

    const now = this._nowSql();
    const batchId = randomUUID();
    this._insertBatch({
      id: batchId,
      product_id: productId2,
      warehouse_id: warehouseId2,
      opened_at: openedAt2,
      unit_cost: cost,
      cost_price_uzs: cost,
      initial_qty: qty,
      remaining_qty: qty,
      source_type: 'purchase_receive',
      source_id: receiptId,
      receipt_id: receiptId,
      receipt_item_id: receiptItemId,
      currency: payload.currency || null,
      exchange_rate: payload.exchangeRate ?? null,
      usd_price: payload.usdPrice ?? null,
      usd_total: payload.usdTotal ?? null,
      supplier_id: payload.supplierId || null,
      supplier_name: payload.supplierName || null,
      doc_no: payload.docNo || null,
      status: 'active',
      created_at: now,
    });

    return this.db.prepare('SELECT * FROM inventory_batches WHERE id = ?').get(batchId);
  }

  createOpeningBatch(productId, warehouseId, quantity, unitCost, openedAt, docNo) {
    this._requireBatchTables();
    if (!productId) throw createError(ERROR_CODES.VALIDATION_ERROR, 'productId is required');
    const wh = this._resolveWarehouseId(warehouseId);
    const qty = Number(quantity || 0);
    if (!(qty > 0)) throw createError(ERROR_CODES.VALIDATION_ERROR, 'quantity must be > 0');
    const cost = Number(unitCost || 0);
    if (!(cost >= 0)) throw createError(ERROR_CODES.VALIDATION_ERROR, 'unitCost must be >= 0');

    const now = this._nowSql();
    const ts = openedAt || now;
    const doc = docNo || `OPENING-${String(ts).slice(0, 10).replace(/-/g, '')}`;

    const batchId = randomUUID();
    this._insertBatch({
      id: batchId,
      product_id: productId,
      warehouse_id: wh,
      opened_at: ts,
      unit_cost: cost,
      cost_price_uzs: cost,
      initial_qty: qty,
      remaining_qty: qty,
      source_type: 'opening',
      source_id: null,
      supplier_id: null,
      supplier_name: null,
      doc_no: doc,
      status: 'active',
      created_at: now,
    });

    return this.db.prepare('SELECT * FROM inventory_batches WHERE id = ?').get(batchId);
  }

  // ---------------------------------------------------------------------------
  // Allocations
  // ---------------------------------------------------------------------------

  /**
   * Supports both call styles:
   * - allocateFIFOForOrderItem({ orderItemId, productId, warehouseId, quantity })
   * - allocateFIFOForOrderItem(orderItemId, productId, warehouseId, quantity)
   */
  allocateFIFOForOrderItem(arg1, productId, warehouseId, quantity) {
    this._requireBatchTables();
    const payload = arg1 && typeof arg1 === 'object'
      ? arg1
      : { orderItemId: arg1, productId, warehouseId, quantity };

    const orderItemId2 = payload.orderItemId;
    const productId2 = payload.productId;
    const wh = this._resolveWarehouseId(payload.warehouseId);
    const requested = Number(payload.quantity || 0);
    if (!orderItemId2) throw createError(ERROR_CODES.VALIDATION_ERROR, 'orderItemId is required');
    if (!productId2) throw createError(ERROR_CODES.VALIDATION_ERROR, 'productId is required');
    if (!(requested > 0)) throw createError(ERROR_CODES.VALIDATION_ERROR, 'quantity must be > 0');

    let remaining = requested;
    const allocations = [];
    const now = this._nowSql();

    const batches = this.db
      .prepare(
        `
        SELECT id, unit_cost, remaining_qty
        FROM inventory_batches
        WHERE product_id = ?
          AND warehouse_id = ?
          AND status = 'active'
          AND remaining_qty > 0
        ORDER BY opened_at ASC, created_at ASC, id ASC
      `
      )
      .all(productId2, wh);

    for (const b of batches) {
      if (remaining <= 0) break;
      const available = Number(b.remaining_qty || 0);
      if (!(available > 0)) continue;

      const take = Math.min(available, remaining);
      const after = available - take;

      this.db
        .prepare(
          `
          UPDATE inventory_batches
          SET remaining_qty = ?, status = CASE WHEN ? <= 0 THEN 'closed' ELSE status END
          WHERE id = ?
        `
        )
        .run(after, after, b.id);

      const allocId = randomUUID();
      this.db
        .prepare(
          `
          INSERT INTO inventory_batch_allocations (
            id, batch_id, direction, product_id, warehouse_id,
            quantity, unit_cost, reference_type, reference_id, created_at
          )
          VALUES (?, ?, 'out', ?, ?, ?, ?, 'order_item', ?, ?)
        `
        )
        .run(allocId, b.id, productId2, wh, take, Number(b.unit_cost || 0), orderItemId2, now);

      allocations.push({
        id: allocId,
        batch_id: b.id,
        quantity: take,
        unit_cost: Number(b.unit_cost || 0),
      });

      remaining -= take;
    }

    if (remaining > 0) {
      const err = createError(
        ERROR_CODES.INSUFFICIENT_BATCH_STOCK,
        `Insufficient batch stock for product ${productId2}. Requested: ${requested}, Allocated: ${requested - remaining}`
      );
      err.details = { productId: productId2, warehouseId: wh, requested, allocated: requested - remaining, shortage: remaining };
      throw err;
    }

    return allocations;
  }

  /**
   * Supports both call styles:
   * - allocateReturnForReturnItem({ returnItemId, orderItemId, productId, warehouseId, quantity })
   * - allocateReturnForReturnItem(returnItemId, orderItemId, productId, warehouseId, quantity)
   */
  allocateReturnForReturnItem(arg1, orderItemId, productId, warehouseId, quantity) {
    this._requireBatchTables();
    const payload = arg1 && typeof arg1 === 'object'
      ? arg1
      : { returnItemId: arg1, orderItemId, productId, warehouseId, quantity };

    const returnItemId2 = payload.returnItemId;
    const orderItemId2 = payload.orderItemId;
    const productId2 = payload.productId;
    const wh = this._resolveWarehouseId(payload.warehouseId);
    const requested = Number(payload.quantity || 0);

    if (!returnItemId2) throw createError(ERROR_CODES.VALIDATION_ERROR, 'returnItemId is required');
    if (!orderItemId2) throw createError(ERROR_CODES.VALIDATION_ERROR, 'orderItemId is required');
    if (!productId2) throw createError(ERROR_CODES.VALIDATION_ERROR, 'productId is required');
    if (!(requested > 0)) throw createError(ERROR_CODES.VALIDATION_ERROR, 'quantity must be > 0');

    // Sold allocations for this order item (what we need to return into)
    const soldAllocs = this.db
      .prepare(
        `
        SELECT batch_id, quantity, unit_cost
        FROM inventory_batch_allocations
        WHERE direction = 'out'
          AND reference_type = 'order_item'
          AND reference_id = ?
        ORDER BY created_at ASC, id ASC
      `
      )
      .all(orderItemId2);

    if (!soldAllocs || soldAllocs.length === 0) {
      const err = createError(
        ERROR_CODES.VALIDATION_ERROR,
        'Cannot process return: no batch allocations found for original sale (order_item)'
      );
      err.details = { orderItemId: orderItemId2, productId: productId2, warehouseId: wh };
      throw err;
    }

    // Build set of other return_item ids for this order_item (to compute already returned per batch)
    const returnItemIds = new Set();
    try {
      const returnItemsTable = this._hasTable('return_items')
        ? 'return_items'
        : this._hasTable('sale_return_items')
          ? 'sale_return_items'
          : null;
      if (returnItemsTable) {
        const rows = this.db
          .prepare(`SELECT id FROM ${returnItemsTable} WHERE order_item_id = ?`)
          .all(orderItemId2);
        for (const r of rows) {
          if (r?.id) returnItemIds.add(String(r.id));
        }
      }
    } catch {
      // ignore
    }

    // Compute already returned per batch (excluding current return item)
    const returnedByBatch = new Map();
    if (returnItemIds.size > 0) {
      const ids = Array.from(returnItemIds).filter((x) => x !== String(returnItemId2));
      if (ids.length > 0) {
        const placeholders = ids.map(() => '?').join(', ');
        const rows = this.db
          .prepare(
            `
            SELECT batch_id, COALESCE(SUM(quantity), 0) AS qty
            FROM inventory_batch_allocations
            WHERE direction = 'in'
              AND reference_type = 'return_item'
              AND reference_id IN (${placeholders})
            GROUP BY batch_id
          `
          )
          .all(ids);
        for (const r of rows) returnedByBatch.set(String(r.batch_id), Number(r.qty || 0));
      }
    }

    let remaining = requested;
    const allocations = [];
    const now = this._nowSql();
    const inThisCall = new Map(); // batch_id -> qty in this call

    for (const s of soldAllocs) {
      if (remaining <= 0) break;
      const batchId = String(s.batch_id);
      const soldQty = Number(s.quantity || 0);
      const alreadyReturned = Number(returnedByBatch.get(batchId) || 0);
      const alreadyInThis = Number(inThisCall.get(batchId) || 0);
      const canReturn = soldQty - alreadyReturned - alreadyInThis;
      if (!(canReturn > 0)) continue;

      const take = Math.min(canReturn, remaining);

      // Increase batch remaining_qty (and reopen if it was closed)
      const batch = this.db.prepare('SELECT remaining_qty, status FROM inventory_batches WHERE id = ?').get(batchId);
      if (!batch) throw createError(ERROR_CODES.NOT_FOUND, `Batch not found: ${batchId}`);

      const before = Number(batch.remaining_qty || 0);
      const after = before + take;
      this.db
        .prepare(
          `
          UPDATE inventory_batches
          SET remaining_qty = ?,
              status = CASE WHEN status = 'closed' AND ? > 0 THEN 'active' ELSE status END
          WHERE id = ?
        `
        )
        .run(after, after, batchId);

      const allocId = randomUUID();
      const unitCost = Number(s.unit_cost || 0);
      this.db
        .prepare(
          `
          INSERT INTO inventory_batch_allocations (
            id, batch_id, direction, product_id, warehouse_id,
            quantity, unit_cost, reference_type, reference_id, created_at
          )
          VALUES (?, ?, 'in', ?, ?, ?, ?, 'return_item', ?, ?)
        `
        )
        .run(allocId, batchId, productId2, wh, take, unitCost, returnItemId2, now);

      allocations.push({ id: allocId, batch_id: batchId, quantity: take, unit_cost: unitCost });
      inThisCall.set(batchId, alreadyInThis + take);
      remaining -= take;
    }

    if (remaining > 0) {
      const err = createError(
        ERROR_CODES.VALIDATION_ERROR,
        `Return quantity exceeds sold batch allocations. Requested: ${requested}, Allocated: ${requested - remaining}`
      );
      err.details = { orderItemId: orderItemId2, returnItemId: returnItemId2, productId: productId2, warehouseId: wh, requested, allocated: requested - remaining };
      throw err;
    }

    return allocations;
  }

  // ---------------------------------------------------------------------------
  // Adjustments
  // ---------------------------------------------------------------------------
  allocateFIFOForAdjustment(adjustmentId, productId, warehouseId, quantity) {
    this._requireBatchTables();
    if (!adjustmentId) throw createError(ERROR_CODES.VALIDATION_ERROR, 'adjustmentId is required');
    if (!productId) throw createError(ERROR_CODES.VALIDATION_ERROR, 'productId is required');
    const wh = this._resolveWarehouseId(warehouseId);
    const requested = Number(quantity || 0);
    if (!(requested > 0)) throw createError(ERROR_CODES.VALIDATION_ERROR, 'quantity must be > 0');

    let remaining = requested;
    const allocations = [];
    const now = this._nowSql();

    const batches = this.db
      .prepare(
        `
        SELECT id, unit_cost, remaining_qty
        FROM inventory_batches
        WHERE product_id = ?
          AND warehouse_id = ?
          AND status = 'active'
          AND remaining_qty > 0
        ORDER BY opened_at ASC, created_at ASC, id ASC
      `
      )
      .all(productId, wh);

    for (const b of batches) {
      if (remaining <= 0) break;
      const available = Number(b.remaining_qty || 0);
      if (!(available > 0)) continue;

      const take = Math.min(available, remaining);
      const after = available - take;

      this.db
        .prepare(
          `
          UPDATE inventory_batches
          SET remaining_qty = ?, status = CASE WHEN ? <= 0 THEN 'closed' ELSE status END
          WHERE id = ?
        `
        )
        .run(after, after, b.id);

      const allocId = randomUUID();
      this.db
        .prepare(
          `
          INSERT INTO inventory_batch_allocations (
            id, batch_id, direction, product_id, warehouse_id,
            quantity, unit_cost, reference_type, reference_id, created_at
          )
          VALUES (?, ?, 'out', ?, ?, ?, ?, 'adjustment', ?, ?)
        `
        )
        .run(allocId, b.id, productId, wh, take, Number(b.unit_cost || 0), adjustmentId, now);

      allocations.push({ id: allocId, batch_id: b.id, quantity: take, unit_cost: Number(b.unit_cost || 0) });
      remaining -= take;
    }

    if (remaining > 0) {
      const err = createError(
        ERROR_CODES.INSUFFICIENT_BATCH_STOCK,
        `Insufficient batch stock for adjustment. Requested: ${requested}, Allocated: ${requested - remaining}`
      );
      err.details = { productId, warehouseId: wh, requested, allocated: requested - remaining, shortage: remaining };
      throw err;
    }

    return allocations;
  }

  /**
   * Apply adjustment delta at batch level.
   * Supports both call styles:
   * - applyAdjustmentDelta(productId, warehouseId, deltaQty, adjustmentId, unitCostForIn?)
   * - applyAdjustmentDelta({ productId, warehouseId, deltaQty, adjustmentId, unitCostForIn? })
   */
  applyAdjustmentDelta(arg1, warehouseId, deltaQty, adjustmentId, unitCostForIn = null) {
    this._requireBatchTables();
    const payload = arg1 && typeof arg1 === 'object'
      ? arg1
      : { productId: arg1, warehouseId, deltaQty, adjustmentId, unitCostForIn };

    const productId2 = payload.productId;
    const wh = this._resolveWarehouseId(payload.warehouseId);
    const delta = Number(payload.deltaQty || 0);
    const adjustmentId2 = payload.adjustmentId;
    const unitCostForIn2 = payload.unitCostForIn;

    if (!productId2) throw createError(ERROR_CODES.VALIDATION_ERROR, 'productId is required');
    if (!adjustmentId2) throw createError(ERROR_CODES.VALIDATION_ERROR, 'adjustmentId is required');
    if (!Number.isFinite(delta) || delta === 0) return { createdBatch: null, allocations: [] };

    const now = this._nowSql();

    if (delta > 0) {
      const cost = Number(unitCostForIn2 ?? 0);
      if (!(cost >= 0)) throw createError(ERROR_CODES.VALIDATION_ERROR, 'unitCostForIn must be >= 0 for adjustment_in');
      const batchId = randomUUID();
      this._insertBatch({
        id: batchId,
        product_id: productId2,
        warehouse_id: wh,
        opened_at: now,
        unit_cost: cost,
        cost_price_uzs: cost,
        initial_qty: delta,
        remaining_qty: delta,
        source_type: 'adjustment_in',
        source_id: adjustmentId2,
        supplier_id: null,
        supplier_name: null,
        doc_no: null,
        status: 'active',
        created_at: now,
      });
      return { createdBatch: this.db.prepare('SELECT * FROM inventory_batches WHERE id = ?').get(batchId), allocations: [] };
    }

    const allocations = this.allocateFIFOForAdjustment(adjustmentId2, productId2, wh, Math.abs(delta));
    return { createdBatch: null, allocations };
  }

  // ---------------------------------------------------------------------------
  // Reconciliation
  // ---------------------------------------------------------------------------
  reconcile(productId = null, warehouseId = null) {
    this._requireBatchTables();
    const wh = warehouseId ? this._resolveWarehouseId(warehouseId) : null;

    const params = [];
    let where = 'WHERE 1=1';
    if (wh) {
      where += ' AND b.warehouse_id = ?';
      params.push(wh);
    }
    if (productId) {
      where += ' AND b.product_id = ?';
      params.push(productId);
    }

    const rows = this.db
      .prepare(
        `
        SELECT
          b.product_id,
          b.warehouse_id,
          COALESCE(SUM(b.remaining_qty), 0) AS stock_from_batches
        FROM inventory_batches b
        ${where}
        GROUP BY b.product_id, b.warehouse_id
      `
      )
      .all(params);

    return rows.map((r) => {
      const stockFromBatches = Number(r.stock_from_batches || 0) || 0;
      const stockFromMovements =
        this.inventoryService?.getCurrentStock
          ? Number(this.inventoryService.getCurrentStock(r.product_id, r.warehouse_id)) || 0
          : null;
      return {
        product_id: r.product_id,
        warehouse_id: r.warehouse_id,
        stock_from_batches: stockFromBatches,
        stock_from_movements: stockFromMovements,
        difference: stockFromMovements == null ? null : stockFromBatches - stockFromMovements,
      };
    });
  }
}

module.exports = BatchService;



const { randomUUID } = require('crypto');
const { ERROR_CODES, createError } = require('../lib/errors.cjs');
const { createLogger } = require('../lib/logger.cjs');

const batchLogger = createLogger('batch');

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
    this._allocCols = null;
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

  _getAllocCols() {
    if (this._allocCols) return this._allocCols;
    try {
      const cols = this.db.prepare(`PRAGMA table_info(inventory_batch_allocations)`).all() || [];
      this._allocCols = new Set(cols.map((c) => c.name));
    } catch {
      this._allocCols = new Set();
    }
    return this._allocCols;
  }

  _hasAllocCol(name) {
    return this._getAllocCols().has(name);
  }

  _insertAllocation(fields) {
    const cols = [];
    const vals = [];
    for (const [key, value] of Object.entries(fields)) {
      if (!this._hasAllocCol(key)) continue;
      cols.push(key);
      vals.push(value);
    }
    if (cols.length === 0) {
      throw createError(ERROR_CODES.DB_ERROR, 'inventory_batch_allocations schema mismatch');
    }
    const placeholders = cols.map(() => '?').join(', ');
    const sql = `INSERT INTO inventory_batch_allocations (${cols.join(', ')}) VALUES (${placeholders})`;
    this.db.prepare(sql).run(...vals);
  }

  _warnZeroCostBatch(batchId, productId, unitCost, context = 'batch_create') {
    const cost = Number(unitCost || 0);
    if (!(cost === 0)) return;
    batchLogger.warn('Zero-cost batch created', {
      batch_id: batchId,
      product_id: productId,
      context,
    });
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

  /**
   * Whether batch coverage must be complete before sale.
   * Missing setting = strict (safe). Existing DBs with inventory.batch_strict_block=0
   * keep auto-coverage; do not flip that stored production default.
   */
  isBatchStrictBlock() {
    const v = this._getSettingValue('inventory.batch_strict_block');
    if (v == null || String(v).trim() === '') return true;
    return this._isTruthySetting('inventory.batch_strict_block');
  }

  isAutoReconcileEnabled() {
    const v = this._getSettingValue('inventory.batch_auto_reconcile');
    if (v == null || v === '') return true;
    return this._isTruthySetting('inventory.batch_auto_reconcile');
  }

  isAutoRepairEnabled() {
    return this._isTruthySetting('inventory.batch_auto_repair');
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
  runCutoverSnapshot({ cutoverAt, warehouseId, costMode = 'last_received_po_cost', updatedBy = null, force = false } = {}) {
    this._requireBatchTables();
    if (!cutoverAt) throw createError(ERROR_CODES.VALIDATION_ERROR, 'cutoverAt is required');

    // normalize: accept ISO too
    const cutoverAtSql = String(cutoverAt).replace('T', ' ').replace('Z', '').substring(0, 19);

    // Guard against duplicate opening batches when toggling off then on without reset.
    // If a previous cutover already exists, just re-enable the flag and return early.
    const existingCutover = this._getSettingValue('inventory.batch_cutover_at');
    if (existingCutover && !force) {
      this._upsertSetting({
        key: 'inventory.batch_mode_enabled',
        value: true,
        type: 'boolean',
        category: 'inventory',
        description: 'Enable inventory batch mode (FIFO costing)',
        isPublic: 1,
        updatedBy,
      });
      let repair = null;
      try {
        repair = this.repairBatchCoverage({ warehouseId: warehouseId || null, dryRun: false });
      } catch (repairErr) {
        batchLogger.warn('repairBatchCoverage on batch re-enable failed', repairErr);
      }
      return {
        ok: true,
        resumed: true,
        settings: {
          batch_mode_enabled: true,
          batch_cutover_at: existingCutover,
          batch_opening_cost_mode: this._getSettingValue('inventory.batch_opening_cost_mode') || 'last_received_po_cost',
        },
        warehouse_id: warehouseId || null,
        opened_at: existingCutover,
        created: 0,
        skipped: 0,
        batches: [],
        repair,
        message: 'Existing cutover preserved. Uncovered stock repaired. Use force=true to override.',
      };
    }

    return this.db.transaction(() => {
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

      // If forced reset, clear unconsumed opening batches for the affected warehouses
      // to avoid double-counting when a fresh cutover is issued.
      if (force) {
        this._purgeUnconsumedOpeningBatches(warehouseId || null);
      }

      // Create opening batches: when warehouseId is omitted, iterate over all warehouses
      // so multi-warehouse setups are not silently broken.
      const targetWarehouses = warehouseId
        ? [this._resolveWarehouseId(warehouseId)]
        : this._listAllWarehouseIds();

      let totalCreated = 0;
      let totalSkipped = 0;
      const allBatches = [];
      for (const wh of targetWarehouses) {
        const r = this.createOpeningBatchesForWarehouse({
          warehouseId: wh,
          openedAt: cutoverAtSql,
          costMode,
        });
        totalCreated += Number(r?.created || 0);
        totalSkipped += Number(r?.skipped || 0);
        if (Array.isArray(r?.batches)) allBatches.push(...r.batches);
      }

      let repair = null;
      try {
        repair = this.repairBatchCoverage({ warehouseId: warehouseId || null, dryRun: false });
      } catch (repairErr) {
        batchLogger.warn('repairBatchCoverage after cutover failed', repairErr);
      }

      return {
        ok: true,
        resumed: false,
        settings: {
          batch_mode_enabled: true,
          batch_cutover_at: cutoverAtSql,
          batch_opening_cost_mode: String(costMode),
        },
        warehouses: targetWarehouses,
        opened_at: cutoverAtSql,
        created: totalCreated,
        skipped: totalSkipped,
        batches: allBatches,
        repair,
      };
    })();
  }

  /**
   * Internal helper used by runCutoverSnapshot when force=true.
   * Removes opening batches that have NEVER been allocated (so it's safe to wipe).
   * Allocated opening batches are kept for audit trail integrity.
   */
  _purgeUnconsumedOpeningBatches(warehouseId = null) {
    this._requireBatchTables();
    const params = [];
    let where = "WHERE source_type = 'opening'";
    if (warehouseId) {
      where += ' AND warehouse_id = ?';
      params.push(warehouseId);
    }
    where +=
      ' AND id NOT IN (SELECT DISTINCT batch_id FROM inventory_batch_allocations WHERE batch_id IS NOT NULL)';
    const sql = `DELETE FROM inventory_batches ${where}`;
    try {
      const info = this.db.prepare(sql).run(...params);
      return { deleted: info.changes || 0 };
    } catch (_e) {
      return { deleted: 0 };
    }
  }

  _listAllWarehouseIds() {
    if (!this._hasTable('warehouses')) return [this._resolveWarehouseId(null)];
    try {
      const cols = this.db.prepare(`PRAGMA table_info(warehouses)`).all() || [];
      const colNames = new Set(cols.map((c) => c.name));
      const where = colNames.has('is_active') ? 'WHERE COALESCE(is_active, 1) = 1' : '';
      const orderCol = colNames.has('created_at') ? 'created_at' : 'id';
      const rows = this.db.prepare(`SELECT id FROM warehouses ${where} ORDER BY ${orderCol} ASC`).all();
      const ids = rows.map((r) => r.id).filter(Boolean);
      return ids.length > 0 ? ids : [this._resolveWarehouseId(null)];
    } catch (_e) {
      return [this._resolveWarehouseId(null)];
    }
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

    this._warnZeroCostBatch(batchId, productId2, cost, 'purchase_receive');
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

    this._warnZeroCostBatch(batchId, productId2, cost, 'purchase_receipt');
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

    this._warnZeroCostBatch(batchId, productId, cost, 'opening');
    return this.db.prepare('SELECT * FROM inventory_batches WHERE id = ?').get(batchId);
  }

  // ---------------------------------------------------------------------------
  // Allocations
  // ---------------------------------------------------------------------------

  _fifoTakeFromBatches({
    productId,
    warehouseId,
    quantity,
    referenceType,
    referenceId,
    note = null,
    supplierId = null,
  }) {
    const wh = this._resolveWarehouseId(warehouseId);
    const requested = Number(quantity || 0);
    let remaining = requested;
    const allocations = [];
    const now = this._nowSql();

    const hasSupplierCol = this._hasBatchCol('supplier_id');
    const supplierFilter =
      supplierId && hasSupplierCol ? ' AND supplier_id = ?' : '';
    const batchParams = supplierId && hasSupplierCol ? [productId, wh, supplierId] : [productId, wh];

    const batches = this.db
      .prepare(
        `
        SELECT id, unit_cost, remaining_qty
        FROM inventory_batches
        WHERE product_id = ?
          AND warehouse_id = ?
          AND status = 'active'
          AND remaining_qty > 0
          ${supplierFilter}
        ORDER BY opened_at ASC, created_at ASC, id ASC
      `
      )
      .all(...batchParams);

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
      this._insertAllocation({
        id: allocId,
        batch_id: b.id,
        direction: 'out',
        product_id: productId,
        warehouse_id: wh,
        quantity: take,
        unit_cost: Number(b.unit_cost || 0),
        reference_type: referenceType,
        reference_id: referenceId,
        note,
        created_at: now,
      });

      allocations.push({
        id: allocId,
        batch_id: b.id,
        quantity: take,
        unit_cost: Number(b.unit_cost || 0),
      });
      remaining -= take;
    }

    return { allocations, remaining, requested, warehouseId: wh };
  }

  _createAutoCoverageBatch(productId, warehouseId, quantity, orderItemId) {
    const wh = this._resolveWarehouseId(warehouseId);
    const qty = Number(quantity || 0);
    if (!(qty > 0)) return null;

    const unitCost = this.defaultUnitCost(productId);
    const now = this._nowSql();
    const batchId = randomUUID();
    const docNo = `AUTO-COVERAGE-${String(now).slice(0, 10).replace(/-/g, '')}`;

    this._insertBatch({
      id: batchId,
      product_id: productId,
      warehouse_id: wh,
      opened_at: now,
      unit_cost: unitCost,
      cost_price_uzs: unitCost,
      initial_qty: qty,
      remaining_qty: qty,
      source_type: 'adjustment_in',
      source_id: orderItemId,
      supplier_id: null,
      supplier_name: null,
      doc_no: docNo,
      status: 'active',
      created_at: now,
    });

    this._warnZeroCostBatch(batchId, productId, unitCost, 'auto_coverage');
    batchLogger.warn('Auto-coverage batch created for missing batch stock', {
      batch_id: batchId,
      product_id: productId,
      warehouse_id: wh,
      quantity: qty,
      order_item_id: orderItemId,
    });

    return this.db.prepare('SELECT * FROM inventory_batches WHERE id = ?').get(batchId);
  }

  /**
   * FIFO allocation with protected fallback: never throws when strict block is off.
   */
  allocateFIFOWithFallback(arg1, productId, warehouseId, quantity) {
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

    const first = this._fifoTakeFromBatches({
      productId: productId2,
      warehouseId: wh,
      quantity: requested,
      referenceType: 'order_item',
      referenceId: orderItemId2,
    });

    if (first.remaining <= 0) return first.allocations;

    if (this.isBatchStrictBlock()) {
      const err = createError(
        ERROR_CODES.INSUFFICIENT_BATCH_STOCK,
        `Insufficient batch stock for product ${productId2}. Requested: ${requested}, Allocated: ${requested - first.remaining}`
      );
      err.details = {
        productId: productId2,
        warehouseId: wh,
        requested,
        allocated: requested - first.remaining,
        shortage: first.remaining,
      };
      throw err;
    }

    const autoBatch = this._createAutoCoverageBatch(productId2, wh, first.remaining, orderItemId2);
    if (!autoBatch) return first.allocations;

    const second = this._fifoTakeFromBatches({
      productId: productId2,
      warehouseId: wh,
      quantity: first.remaining,
      referenceType: 'order_item',
      referenceId: orderItemId2,
      note: 'auto-created: missing batch coverage',
    });

    if (second.remaining > 0) {
      batchLogger.error('Auto-coverage batch still insufficient after creation', {
        product_id: productId2,
        warehouse_id: wh,
        shortage: second.remaining,
      });
    }

    return [...first.allocations, ...second.allocations];
  }

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

    const { allocations, remaining } = this._fifoTakeFromBatches({
      productId: productId2,
      warehouseId: wh,
      quantity: requested,
      referenceType: 'order_item',
      referenceId: orderItemId2,
    });

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

  /**
   * Supplier return: consume FIFO only from batches that belong to this supplier.
   * Does not fall back to other suppliers' stock.
   */
  allocateFIFOForSupplierReturn({
    returnId,
    productId,
    warehouseId,
    quantity,
    supplierId,
  } = {}) {
    this._requireBatchTables();
    if (!returnId) throw createError(ERROR_CODES.VALIDATION_ERROR, 'returnId is required');
    if (!productId) throw createError(ERROR_CODES.VALIDATION_ERROR, 'productId is required');
    if (!supplierId) throw createError(ERROR_CODES.VALIDATION_ERROR, 'supplierId is required');
    const wh = this._resolveWarehouseId(warehouseId);
    const requested = Number(quantity || 0);
    if (!(requested > 0)) throw createError(ERROR_CODES.VALIDATION_ERROR, 'quantity must be > 0');

    const { allocations, remaining } = this._fifoTakeFromBatches({
      productId,
      warehouseId: wh,
      quantity: requested,
      referenceType: 'supplier_return',
      referenceId: returnId,
      note: 'supplier return',
      supplierId,
    });

    if (remaining > 0) {
      const product = this.db.prepare('SELECT name FROM products WHERE id = ?').get(productId);
      const productName = product?.name || productId;
      const err = createError(
        ERROR_CODES.INSUFFICIENT_BATCH_STOCK,
        `Qaytarish miqdori yetkazib beruvchidan kelgan partiya qoldig‘idan oshib ketdi. Mahsulot: ${productName}. Mavjud: ${requested - remaining}, so‘ralgan: ${requested}.`
      );
      err.details = {
        productId,
        productName,
        warehouseId: wh,
        supplierId,
        requested,
        allocated: requested - remaining,
        shortage: remaining,
      };
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
      this._warnZeroCostBatch(batchId, productId2, cost, 'adjustment_in');
      return { createdBatch: this.db.prepare('SELECT * FROM inventory_batches WHERE id = ?').get(batchId), allocations: [] };
    }

    const allocations = this.allocateFIFOForAdjustment(adjustmentId2, productId2, wh, Math.abs(delta));
    return { createdBatch: null, allocations };
  }

  // ---------------------------------------------------------------------------
  // Reconciliation
  // ---------------------------------------------------------------------------

  _listTargetWarehouseIds(warehouseId = null) {
    if (warehouseId) return [this._resolveWarehouseId(warehouseId)];
    return this._listAllWarehouseIds();
  }

  _stockPairsForReconcile(productId = null, warehouseId = null) {
    this._requireBatchTables();
    const warehouses = this._listTargetWarehouseIds(warehouseId);
    const whPlaceholders = warehouses.map(() => '?').join(', ');
    const params = [];
    let productWhere = 'WHERE p.track_stock = 1';
    if (productId) {
      productWhere += ' AND p.id = ?';
      params.push(productId);
    }
    params.push(...warehouses);

    const hasStockBalances = this._hasTable('stock_balances');
    const hasWhView = !!this.db
      .prepare(`SELECT 1 FROM sqlite_master WHERE name = 'v_product_stock_by_warehouse' LIMIT 1`)
      .get();
    const stockSql = hasStockBalances
      ? `COALESCE((SELECT SUM(sb.quantity) FROM stock_balances sb
          WHERE sb.product_id = p.id AND sb.warehouse_id = w.id), 0)`
      : hasWhView
        ? `COALESCE((SELECT v.stock FROM v_product_stock_by_warehouse v
          WHERE v.product_id = p.id AND v.warehouse_id = w.id), 0)`
        : `COALESCE((SELECT SUM(im.quantity) FROM inventory_movements im
          WHERE im.product_id = p.id AND im.warehouse_id = w.id), 0)`;

    const rows = this.db
      .prepare(
        `
        SELECT
          p.id AS product_id,
          p.name AS product_name,
          w.id AS warehouse_id,
          ${stockSql} AS stock_from_balances,
          COALESCE((
            SELECT SUM(b.remaining_qty)
            FROM inventory_batches b
            WHERE b.product_id = p.id AND b.warehouse_id = w.id
          ), 0) AS stock_from_batches,
          COALESCE((
            SELECT COUNT(*)
            FROM inventory_batches b
            WHERE b.product_id = p.id AND b.warehouse_id = w.id AND b.status = 'active'
          ), 0) AS active_batch_count,
          COALESCE((
            SELECT COUNT(*)
            FROM inventory_batches b
            WHERE b.product_id = p.id AND b.warehouse_id = w.id
              AND b.status = 'active' AND COALESCE(b.unit_cost, 0) = 0 AND COALESCE(b.remaining_qty, 0) > 0
          ), 0) AS zero_cost_active_batches
        FROM products p
        CROSS JOIN warehouses w
        ${productWhere}
          AND w.id IN (${whPlaceholders})
        ORDER BY p.name ASC, w.id ASC
      `
      )
      .all(...params);

    return rows.map((r) => {
      const stockFromBalances = Number(r.stock_from_balances || 0) || 0;
      const stockFromMovements = stockFromBalances;
      const stockFromBatches = Number(r.stock_from_batches || 0) || 0;
      const difference = stockFromBatches - stockFromBalances;
      const activeBatchCount = Number(r.active_batch_count || 0) || 0;
      const zeroCostActive = Number(r.zero_cost_active_batches || 0) || 0;
      return {
        product_id: r.product_id,
        product_name: r.product_name,
        warehouse_id: r.warehouse_id,
        stock_from_balances: stockFromBalances,
        stock_from_movements: stockFromMovements,
        stock_from_batches: stockFromBatches,
        difference,
        drift: Math.abs(difference) > 0.0001 ? Math.abs(difference) : 0,
        has_no_batch_stock: stockFromMovements > 0.0001 && activeBatchCount === 0,
        zero_cost_batches: zeroCostActive,
      };
    });
  }

  reconcile(productId = null, warehouseId = null) {
    return this._stockPairsForReconcile(productId, warehouseId).filter(
      (r) => Math.abs(r.difference) > 0.0001 || r.has_no_batch_stock || r.zero_cost_batches > 0
    );
  }

  getBatchHealth(productId = null, warehouseId = null) {
    const rows = this._stockPairsForReconcile(productId, warehouseId);
    const drifts = rows.filter((r) => r.drift > 0);
    const noBatchStock = rows.filter((r) => r.has_no_batch_stock);
    const zeroCostRows = rows.filter((r) => r.zero_cost_batches > 0);
    const zeroCostBatchCount = zeroCostRows.reduce((sum, r) => sum + r.zero_cost_batches, 0);

    return {
      drift_count: drifts.length,
      no_batch_stock_count: noBatchStock.length,
      zero_cost_batch_count: zeroCostBatchCount,
      total_drift_qty: drifts.reduce((sum, r) => sum + r.drift, 0),
      drifts: drifts.slice(0, 50),
      no_batch_stock: noBatchStock.slice(0, 50),
      zero_cost: zeroCostRows.slice(0, 50),
      checked_at: this._nowSql(),
    };
  }

  runReconcileCheck({ autoRepair = null, source = 'scheduler' } = {}) {
    if (!this.isBatchModeEnabled()) return { ok: true, skipped: true, reason: 'batch_mode_off' };
    if (!this.isAutoReconcileEnabled()) return { ok: true, skipped: true, reason: 'auto_reconcile_off' };

    const health = this.getBatchHealth();
    if (health.drift_count > 0 || health.no_batch_stock_count > 0) {
      batchLogger.warn('Batch drift detected', { source, ...health });
    }

    const shouldRepair = autoRepair != null ? !!autoRepair : this.isAutoRepairEnabled();
    let repair = null;
    if (shouldRepair && (health.drift_count > 0 || health.no_batch_stock_count > 0)) {
      repair = this.repairBatchCoverage({ dryRun: false });
    }

    return { ok: true, health, repair, source };
  }

  repairBatchCoverage({ warehouseId = null, dryRun = true } = {}) {
    this._requireBatchTables();
    const rows = this._stockPairsForReconcile(null, warehouseId);
    const actions = [];
    let created = 0;
    let reduced = 0;
    let skipped = 0;

    const work = () => {
      for (const row of rows) {
        const diff = Number(row.difference || 0);
        if (Math.abs(diff) <= 0.0001) continue;

        if (diff < 0) {
          const shortage = Math.abs(diff);
          const unitCost = this.defaultUnitCost(row.product_id);
          const action = {
            type: 'create_opening',
            product_id: row.product_id,
            warehouse_id: row.warehouse_id,
            quantity: shortage,
            unit_cost: unitCost,
            dry_run: dryRun,
          };
          if (!dryRun) {
            this.createOpeningBatch(
              row.product_id,
              row.warehouse_id,
              shortage,
              unitCost,
              this._nowSql(),
              `REPAIR-COVERAGE-${String(this._nowSql()).slice(0, 10).replace(/-/g, '')}`
            );
            created += 1;
          }
          actions.push(action);
          continue;
        }

        const excess = diff;
        const reducedQty = this._reduceExcessBatches(row.product_id, row.warehouse_id, excess, dryRun);
        if (reducedQty > 0) {
          reduced += 1;
          actions.push({
            type: 'reduce_excess',
            product_id: row.product_id,
            warehouse_id: row.warehouse_id,
            quantity: reducedQty,
            dry_run: dryRun,
          });
        } else {
          skipped += 1;
          actions.push({
            type: 'reduce_skipped',
            product_id: row.product_id,
            warehouse_id: row.warehouse_id,
            excess,
            dry_run: dryRun,
            reason: 'no_unallocated_batches',
          });
        }
      }

      const after = dryRun ? null : this.getBatchHealth(null, warehouseId);
      return {
        ok: true,
        dry_run: dryRun,
        warehouse_id: warehouseId || null,
        created,
        reduced,
        skipped,
        actions,
        after_health: after,
      };
    };

    if (dryRun) return work();
    return this.db.transaction(work)();
  }

  _reduceExcessBatches(productId, warehouseId, excessQty, dryRun) {
    const wh = this._resolveWarehouseId(warehouseId);
    let remaining = Number(excessQty || 0);
    if (!(remaining > 0)) return 0;

    const batches = this.db
      .prepare(
        `
        SELECT b.id, b.remaining_qty
        FROM inventory_batches b
        WHERE b.product_id = ?
          AND b.warehouse_id = ?
          AND b.status = 'active'
          AND COALESCE(b.remaining_qty, 0) > 0
          AND b.id NOT IN (
            SELECT DISTINCT batch_id
            FROM inventory_batch_allocations
            WHERE direction = 'out' AND batch_id IS NOT NULL
          )
        ORDER BY b.opened_at DESC, b.created_at DESC, b.id DESC
      `
      )
      .all(productId, wh);

    let reducedTotal = 0;
    for (const b of batches) {
      if (remaining <= 0) break;
      const available = Number(b.remaining_qty || 0);
      if (!(available > 0)) continue;
      const take = Math.min(available, remaining);
      const after = available - take;
      if (!dryRun) {
        this.db
          .prepare(
            `
            UPDATE inventory_batches
            SET remaining_qty = ?, status = CASE WHEN ? <= 0 THEN 'closed' ELSE status END
            WHERE id = ?
          `
          )
          .run(after, after, b.id);
      }
      reducedTotal += take;
      remaining -= take;
    }
    return reducedTotal;
  }
}

module.exports = BatchService;



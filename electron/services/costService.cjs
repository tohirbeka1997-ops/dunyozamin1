const { ERROR_CODES, createError } = require('../lib/errors.cjs');

class CostService {
  constructor(db, batchService = null) {
    this.db = db;
    this.batchService = batchService;
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

  _legacyFallbackEnabled() {
    return this._isTruthySetting('accounting.cogs_legacy_fallback');
  }

  getLatestReceiptCost(productId) {
    if (!productId) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'productId is required');
    }
    if (!this._hasTable('purchase_receipts') || !this._hasTable('purchase_receipt_items')) {
      return null;
    }
    const row = this.db
      .prepare(
        `
        SELECT pri.unit_cost
        FROM purchase_receipt_items pri
        INNER JOIN purchase_receipts pr ON pr.id = pri.receipt_id
        WHERE pri.product_id = ?
        ORDER BY
          COALESCE(pr.received_at, pr.created_at) DESC,
          COALESCE(pr.created_at, pr.received_at) DESC,
          pri.id DESC
        LIMIT 1
      `
      )
      .get(productId);
    if (!row) return null;
    const cost = Number(row.unit_cost || 0) || 0;
    return cost > 0 ? cost : 0;
  }

  calculateBatchAllocationCost(orderItemId) {
    if (!orderItemId) return null;
    if (!this._hasTable('inventory_batch_allocations')) return null;
    const row = this.db
      .prepare(
        `
        SELECT
          COALESCE(SUM(quantity * unit_cost), 0) AS total_cost,
          COALESCE(SUM(quantity), 0) AS total_qty
        FROM inventory_batch_allocations
        WHERE reference_type = 'order_item'
          AND reference_id = ?
          AND direction = 'out'
      `
      )
      .get(orderItemId);
    const totalCost = Number(row?.total_cost || 0) || 0;
    const totalQty = Number(row?.total_qty || 0) || 0;
    if (totalQty <= 0) return null;
    return totalCost / totalQty;
  }

  getHistoricalCost(orderItemId) {
    if (!orderItemId) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'orderItemId is required');
    }
    if (!this._hasTable('order_items')) return null;
    const row = this.db
      .prepare('SELECT cost_price FROM order_items WHERE id = ?')
      .get(orderItemId);
    if (!row) return null;
    return Number(row.cost_price || 0) || 0;
  }

  resolveCostForSale(productId, quantity, warehouseId, orderItemId = null) {
    if (!productId) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'productId is required');
    }

    let unitCost = null;

    // 1. Try batch allocation cost (FIFO)
    if (orderItemId) {
      unitCost = this.calculateBatchAllocationCost(orderItemId);
    }

    // 2. Try latest purchase receipt cost
    if (!(unitCost > 0)) {
      unitCost = this.getLatestReceiptCost(productId);
    }

    // 3. Always fall back to products.purchase_price
    if (!(unitCost > 0)) {
      const row = this.db.prepare('SELECT purchase_price FROM products WHERE id = ?').get(productId);
      unitCost = Number(row?.purchase_price || 0) || 0;
    }

    return Number(unitCost || 0) || 0;
  }
}

module.exports = CostService;

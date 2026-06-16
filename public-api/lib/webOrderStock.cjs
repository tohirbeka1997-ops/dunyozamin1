'use strict';

const { randomUUID } = require('crypto');

const MAIN_WAREHOUSE_ID = 'main-warehouse-001';

// Lazily-loaded BatchService (FIFO costing). Online sales must consume batches
// the same way POS sales do, otherwise inventory_batches.remaining_qty drifts
// and online-sale COGS/profit is not captured. Loaded lazily so the public-api
// keeps working even if the electron service tree is unavailable.
let _BatchService = null;
let _batchLoadFailed = false;
function getBatchService(db) {
  if (_batchLoadFailed) return null;
  if (!_BatchService) {
    try {
      _BatchService = require('../../electron/services/batchService.cjs');
    } catch (e) {
      _batchLoadFailed = true;
      console.warn('[webOrderStock] BatchService unavailable — FIFO costing skipped:', e?.message || e);
      return null;
    }
  }
  try {
    return new _BatchService(db, null);
  } catch {
    return null;
  }
}

function nowSqlLike() {
  return new Date().toISOString().replace('T', ' ').replace('Z', '').substring(0, 19);
}

// Namespaced reference id so web allocations never collide with POS order_item
// ids and can be reversed symmetrically on cancellation.
function webItemRef(webItemId) {
  return `web_item:${webItemId}`;
}

/**
 * Best-effort FIFO batch consumption for an online sale line. No-op when batch
 * mode is off or batch tables are missing; never throws (stock quantity already
 * comes from inventory_movements, so costing must not block fulfillment).
 */
function allocateWebSaleBatches(db, webItemId, productId, qty) {
  if (!webItemId || !productId || !(Number(qty) > 0)) return;
  try {
    const bs = getBatchService(db);
    if (!bs || typeof bs.shouldEnforceAt !== 'function' || !bs.shouldEnforceAt(nowSqlLike())) return;
    bs.allocateFIFOForOrderItem({
      orderItemId: webItemRef(webItemId),
      productId,
      warehouseId: MAIN_WAREHOUSE_ID,
      quantity: Number(qty),
    });
  } catch (e) {
    console.warn(
      `[webOrderStock] FIFO allocation skipped for product ${productId} (item ${webItemId}):`,
      e?.message || e,
    );
  }
}

/**
 * Best-effort reversal of FIFO allocations when a fulfilled online order is
 * cancelled — returns the consumed quantity back into the original batches.
 */
function reverseWebSaleBatches(db, orderId, webItemId, productId, qty) {
  if (!webItemId || !productId || !(Number(qty) > 0)) return;
  try {
    const bs = getBatchService(db);
    if (!bs || typeof bs.allocateReturnForReturnItem !== 'function') return;
    bs.allocateReturnForReturnItem({
      returnItemId: `web_return:${orderId}:${webItemId}`,
      orderItemId: webItemRef(webItemId),
      productId,
      warehouseId: MAIN_WAREHOUSE_ID,
      quantity: Number(qty),
    });
  } catch (e) {
    console.warn(
      `[webOrderStock] FIFO reversal skipped for product ${productId} (item ${webItemId}):`,
      e?.message || e,
    );
  }
}

function boolCol(v) {
  return v === 1 || v === true;
}

function hasColumn(db, tableName, columnName) {
  try {
    return db.prepare(`PRAGMA table_info(${tableName})`).all().some((c) => c.name === columnName);
  } catch {
    return false;
  }
}

function hasInventoryMovements(db) {
  try {
    return !!db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='inventory_movements'`)
      .get();
  } catch {
    return false;
  }
}

function getLedgerStock(db, productId, warehouseId = MAIN_WAREHOUSE_ID) {
  const balanceRow = db
    .prepare(
      `SELECT COALESCE(quantity, 0) AS q FROM stock_balances WHERE product_id = ? AND warehouse_id = ?`,
    )
    .get(productId, warehouseId);

  if (!hasInventoryMovements(db)) {
    return Number(balanceRow?.q || 0);
  }

  const row = db
    .prepare(
      `
      SELECT COALESCE(SUM(quantity), 0) AS q
      FROM inventory_movements
      WHERE product_id = ? AND (warehouse_id = ? OR warehouse_id IS NULL)
    `,
    )
    .get(productId, warehouseId);
  const ledgerSum = Number(row?.q || 0);
  const moveCount = db
    .prepare(
      `SELECT COUNT(*) AS n FROM inventory_movements WHERE product_id = ? AND (warehouse_id = ? OR warehouse_id IS NULL)`,
    )
    .get(productId, warehouseId);

  // Legacy rows: stock_balances populated before any ledger movement exists.
  if (Number(moveCount?.n || 0) === 0) {
    return Number(balanceRow?.q || 0);
  }

  return ledgerSum;
}

function getReservedQty(db, productId, warehouseId = MAIN_WAREHOUSE_ID) {
  const row = db
    .prepare(
      `SELECT COALESCE(reserved_quantity, 0) AS rq FROM stock_balances WHERE product_id = ? AND warehouse_id = ?`,
    )
    .get(productId, warehouseId);
  return Number(row?.rq || 0);
}

function ensureBalanceRow(db, productId, warehouseId = MAIN_WAREHOUSE_ID) {
  let row = db
    .prepare(`SELECT * FROM stock_balances WHERE product_id = ? AND warehouse_id = ?`)
    .get(productId, warehouseId);
  if (row) return row;
  const id = randomUUID();
  const qty = getLedgerStock(db, productId, warehouseId);
  db.prepare(
    `
    INSERT INTO stock_balances (id, product_id, warehouse_id, quantity, reserved_quantity, created_at, updated_at)
    VALUES (?, ?, ?, ?, 0, datetime('now'), datetime('now'))
  `,
  ).run(id, productId, warehouseId, qty);
  return db
    .prepare(`SELECT * FROM stock_balances WHERE product_id = ? AND warehouse_id = ?`)
    .get(productId, warehouseId);
}

function syncBalanceQuantityFromLedger(db, productId, warehouseId = MAIN_WAREHOUSE_ID) {
  const bal = ensureBalanceRow(db, productId, warehouseId);
  const ledgerQty = getLedgerStock(db, productId, warehouseId);
  if (Number(bal.quantity) !== ledgerQty) {
    db.prepare(
      `UPDATE stock_balances SET quantity = ?, updated_at = datetime('now') WHERE id = ?`,
    ).run(ledgerQty, bal.id);
  }
  return ledgerQty;
}

function orderItems(db, orderId) {
  return db
    .prepare(`SELECT id, product_id, quantity FROM web_order_items WHERE order_id = ?`)
    .all(orderId);
}

function isOrderStockFulfilled(db, orderId) {
  const col = db.prepare(`PRAGMA table_info(web_orders)`).all();
  if (col.some((c) => c.name === 'stock_fulfilled_at')) {
    const wo = db.prepare(`SELECT stock_fulfilled_at FROM web_orders WHERE id = ?`).get(orderId);
    return !!wo?.stock_fulfilled_at;
  }
  if (hasInventoryMovements(db)) {
    const row = db
      .prepare(
        `
        SELECT COUNT(*) AS n FROM inventory_movements
        WHERE reference_type = 'web_order' AND reference_id = ? AND movement_type = 'sale'
      `,
      )
      .get(String(orderId));
    return Number(row?.n || 0) > 0;
  }
  return false;
}

function markOrderStockFulfilled(db, orderId) {
  const cols = db.prepare(`PRAGMA table_info(web_orders)`).all();
  if (cols.some((c) => c.name === 'stock_fulfilled_at')) {
    db.prepare(`UPDATE web_orders SET stock_fulfilled_at = datetime('now') WHERE id = ?`).run(orderId);
  }
}

/**
 * Reserve stock when web order is created (available = quantity - reserved).
 */
function reserveWebOrderStock(db, orderId) {
  const items = orderItems(db, orderId);
  for (const it of items) {
    const p = db.prepare('SELECT track_stock FROM products WHERE id = ?').get(it.product_id);
    if (!p || !boolCol(p.track_stock)) continue;
    const qty = Number(it.quantity) || 0;
    if (qty <= 0) continue;

    syncBalanceQuantityFromLedger(db, it.product_id);
    const bal = ensureBalanceRow(db, it.product_id);
    const available = Number(bal.quantity) - Number(bal.reserved_quantity);
    if (available + 1e-9 < qty) {
      const err = new Error('insufficient_stock');
      err.code = 'INSUFFICIENT_STOCK';
      err.meta = { product_id: it.product_id, available: Math.floor(available), requested: qty };
      throw err;
    }
    db.prepare(
      `UPDATE stock_balances SET reserved_quantity = reserved_quantity + ?, updated_at = datetime('now') WHERE id = ?`,
    ).run(qty, bal.id);
  }
}

function releaseWebOrderStock(db, orderId) {
  const items = orderItems(db, orderId);
  for (const it of items) {
    const p = db.prepare('SELECT track_stock FROM products WHERE id = ?').get(it.product_id);
    if (!p || !boolCol(p.track_stock)) continue;
    const qty = Number(it.quantity) || 0;
    const bal = db
      .prepare(`SELECT id, reserved_quantity FROM stock_balances WHERE product_id = ? AND warehouse_id = ?`)
      .get(it.product_id, MAIN_WAREHOUSE_ID);
    if (!bal) continue;
    const newRes = Math.max(0, Number(bal.reserved_quantity) - qty);
    db.prepare(
      `UPDATE stock_balances SET reserved_quantity = ?, updated_at = datetime('now') WHERE id = ?`,
    ).run(newRes, bal.id);
  }
}

function insertInventoryMovement(db, opts) {
  if (!hasInventoryMovements(db)) return null;
  const now = new Date().toISOString().replace('T', ' ').replace('Z', '').substring(0, 19);
  const movementId = randomUUID();
  const movementNumber = `MOV-WO-${Date.now()}-${movementId.substring(0, 8)}`;
  db.prepare(
    `
    INSERT INTO inventory_movements (
      id, product_id, warehouse_id, movement_number, movement_type, quantity,
      before_quantity, after_quantity, reference_type, reference_id,
      reason, notes, created_by, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    movementId,
    opts.productId,
    opts.warehouseId || MAIN_WAREHOUSE_ID,
    movementNumber,
    opts.movementType,
    opts.quantityChange,
    opts.beforeQuantity,
    opts.afterQuantity,
    opts.referenceType || 'web_order',
    opts.referenceId != null ? String(opts.referenceId) : null,
    opts.reason || null,
    opts.notes || null,
    opts.createdBy || null,
    now,
  );
  return movementId;
}

/**
 * Fulfill stock: ledger sale + reduce reserved (idempotent per order).
 */
function fulfillWebOrderStock(db, orderId, options = {}) {
  if (isOrderStockFulfilled(db, orderId)) return { ok: true, skipped: true };

  const order = db.prepare(`SELECT order_number FROM web_orders WHERE id = ?`).get(orderId);
  const orderNumber = order?.order_number || String(orderId);
  const items = orderItems(db, orderId);

  const tx = db.transaction(() => {
    for (const it of items) {
      const p = db.prepare('SELECT track_stock, name FROM products WHERE id = ?').get(it.product_id);
      if (!p || !boolCol(p.track_stock)) continue;
      const dec = Number(it.quantity) || 0;
      if (dec <= 0) continue;

      const bal = ensureBalanceRow(db, it.product_id);
      const beforeQty = Number(bal.quantity) || 0;
      const reserved = Number(bal.reserved_quantity) || 0;
      const release = Math.min(reserved, dec);
      const afterQty = beforeQty - dec;

      insertInventoryMovement(db, {
        productId: it.product_id,
        movementType: 'sale',
        quantityChange: -dec,
        beforeQuantity: beforeQty,
        afterQuantity: afterQty,
        referenceType: 'web_order',
        referenceId: orderId,
        reason: options.reason || `Online order ${orderNumber}`,
      });

      const lastMoveCol = hasColumn(db, 'stock_balances', 'last_movement_at')
        ? ', last_movement_at = datetime(\'now\')'
        : '';
      db.prepare(
        `
        UPDATE stock_balances
        SET quantity = ?, reserved_quantity = ?, updated_at = datetime('now')${lastMoveCol}
        WHERE id = ?
      `,
      ).run(afterQty, Math.max(0, reserved - release), bal.id);

      const totalRow = db
        .prepare(
          `
          SELECT COALESCE(SUM(quantity), 0) AS q FROM stock_balances WHERE product_id = ?
        `,
        )
        .get(it.product_id);
      const totalQty = Number(totalRow?.q || afterQty);
      db.prepare(`UPDATE products SET current_stock = ?, updated_at = datetime('now') WHERE id = ?`).run(
        totalQty,
        it.product_id,
      );

      // FIFO costing: consume batches the same way POS sales do (best-effort;
      // no-op when batch mode is off). Inside the same transaction as the
      // stock movement, per BatchService contract.
      allocateWebSaleBatches(db, it.id, it.product_id, dec);
    }
    markOrderStockFulfilled(db, orderId);
  });
  tx();
  return { ok: true, skipped: false };
}

/** @deprecated use fulfillWebOrderStock */
function decrementStockForPaidWebOrder(db, orderId) {
  return fulfillWebOrderStock(db, orderId, { reason: 'Online payment confirmed' });
}

/**
 * Reverse ledger sale when a fulfilled online order is cancelled.
 */
function restoreWebOrderStock(db, orderId, options = {}) {
  if (!isOrderStockFulfilled(db, orderId)) return { ok: true, skipped: true };

  const order = db.prepare(`SELECT order_number FROM web_orders WHERE id = ?`).get(orderId);
  const orderNumber = order?.order_number || String(orderId);
  const items = orderItems(db, orderId);

  const tx = db.transaction(() => {
    for (const it of items) {
      const p = db.prepare('SELECT track_stock FROM products WHERE id = ?').get(it.product_id);
      if (!p || !boolCol(p.track_stock)) continue;
      const qty = Number(it.quantity) || 0;
      if (qty <= 0) continue;

      const bal = ensureBalanceRow(db, it.product_id);
      const beforeQty = Number(bal.quantity) || 0;
      const afterQty = beforeQty + qty;

      insertInventoryMovement(db, {
        productId: it.product_id,
        movementType: 'return',
        quantityChange: qty,
        beforeQuantity: beforeQty,
        afterQuantity: afterQty,
        referenceType: 'web_order',
        referenceId: orderId,
        reason: options.reason || `Online order cancelled ${orderNumber}`,
      });

      const lastMoveCol = hasColumn(db, 'stock_balances', 'last_movement_at')
        ? ', last_movement_at = datetime(\'now\')'
        : '';
      db.prepare(
        `
        UPDATE stock_balances
        SET quantity = ?, updated_at = datetime('now')${lastMoveCol}
        WHERE id = ?
      `,
      ).run(afterQty, bal.id);

      const totalRow = db
        .prepare(`SELECT COALESCE(SUM(quantity), 0) AS q FROM stock_balances WHERE product_id = ?`)
        .get(it.product_id);
      db.prepare(`UPDATE products SET current_stock = ?, updated_at = datetime('now') WHERE id = ?`).run(
        Number(totalRow?.q || afterQty),
        it.product_id,
      );

      // FIFO costing: return the consumed quantity back into its original
      // batches (best-effort; mirrors allocateWebSaleBatches on fulfill).
      reverseWebSaleBatches(db, orderId, it.id, it.product_id, qty);
    }

    const cols = db.prepare(`PRAGMA table_info(web_orders)`).all();
    if (cols.some((c) => c.name === 'stock_fulfilled_at')) {
      db.prepare(`UPDATE web_orders SET stock_fulfilled_at = NULL WHERE id = ?`).run(orderId);
    }
  });
  tx();
  return { ok: true, skipped: false };
}

function handleWebOrderCancelled(db, orderId) {
  // Refund any loyalty points redeemed at checkout (idempotent, plain
  // statements — safe inside or outside an open transaction). Best-effort:
  // never block the stock release if the loyalty tables are unavailable.
  try {
    require('./marketplaceLoyalty.cjs').refundOrderRedemption(db, orderId);
  } catch (e) {
    console.warn('[webOrderStock] loyalty refund failed:', e.message || String(e));
  }

  if (isOrderStockFulfilled(db, orderId)) {
    return restoreWebOrderStock(db, orderId);
  }
  return releaseWebOrderStock(db, orderId);
}

/**
 * Cash / COD: mark paid when order is delivered (optional bookkeeping).
 */
function markCashPaymentOnDelivered(db, orderId) {
  const row = db
    .prepare(`SELECT payment_method, payment_status, status FROM web_orders WHERE id = ?`)
    .get(orderId);
  if (!row) return;
  if (String(row.payment_method) !== 'cash') return;
  if (String(row.payment_status) === 'paid') return;
  if (String(row.status) !== 'delivered') return;
  db.prepare(
    `UPDATE web_orders SET payment_status = 'paid', updated_at = datetime('now') WHERE id = ?`,
  ).run(orderId);
}

module.exports = {
  MAIN_WAREHOUSE_ID,
  reserveWebOrderStock,
  releaseWebOrderStock,
  fulfillWebOrderStock,
  decrementStockForPaidWebOrder,
  restoreWebOrderStock,
  handleWebOrderCancelled,
  markCashPaymentOnDelivered,
  isOrderStockFulfilled,
  getLedgerStock,
};

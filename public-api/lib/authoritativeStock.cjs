'use strict';

const MAIN_WAREHOUSE_ID = 'main-warehouse-001';

/** Open web-order lines that still hold stock (not fulfilled / not cancelled). */
const OPEN_WEB_ORDER_RESERVE_SQL = `
  SELECT
    wi.product_id,
    COALESCE(SUM(wi.quantity), 0) AS reserved_qty
  FROM web_order_items wi
  INNER JOIN web_orders wo ON wo.id = wi.order_id
  WHERE wo.status NOT IN ('cancelled', 'delivered')
    AND (
      NOT EXISTS (
        SELECT 1 FROM pragma_table_info('web_orders') c
        WHERE c.name = 'stock_fulfilled_at'
      )
      OR wo.stock_fulfilled_at IS NULL
    )
  GROUP BY wi.product_id
`;

function hasTable(db, name) {
  try {
    return !!db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(name);
  } catch {
    return false;
  }
}

function hasView(db, name) {
  try {
    return !!db.prepare(`SELECT name FROM sqlite_master WHERE type='view' AND name=?`).get(name);
  } catch {
    return false;
  }
}

function hasInventoryMovements(db) {
  return hasTable(db, 'inventory_movements');
}

function movementCount(db, productId, warehouseId = MAIN_WAREHOUSE_ID) {
  if (!hasInventoryMovements(db)) return 0;
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM inventory_movements
       WHERE product_id = ? AND (warehouse_id = ? OR warehouse_id IS NULL)`,
    )
    .get(productId, warehouseId);
  return Number(row?.n || 0);
}

function ledgerStock(db, productId, warehouseId = MAIN_WAREHOUSE_ID) {
  if (!hasInventoryMovements(db)) {
    const row = db
      .prepare(
        `SELECT COALESCE(SUM(quantity), 0) AS q FROM stock_balances
         WHERE product_id = ? AND (warehouse_id = ? OR warehouse_id IS NULL OR warehouse_id = '')`,
      )
      .get(productId, warehouseId);
    return Number(row?.q || 0);
  }

  if (hasView(db, 'v_product_stock_by_warehouse')) {
    const whRow = db
      .prepare(`SELECT COALESCE(stock, 0) AS q FROM v_product_stock_by_warehouse WHERE product_id = ? AND warehouse_id = ?`)
      .get(productId, warehouseId);
    if (whRow) return Number(whRow.q || 0);
  }

  if (movementCount(db, productId, warehouseId) > 0) {
    const row = db
      .prepare(
        `SELECT COALESCE(SUM(quantity), 0) AS q FROM inventory_movements
         WHERE product_id = ? AND (warehouse_id = ? OR warehouse_id IS NULL)`,
      )
      .get(productId, warehouseId);
    return Number(row?.q || 0);
  }

  const balanceRow = db
    .prepare(
      `SELECT COALESCE(quantity, 0) AS q FROM stock_balances
       WHERE product_id = ? AND (warehouse_id = ? OR warehouse_id IS NULL OR warehouse_id = '')`,
    )
    .get(productId, warehouseId);
  return Number(balanceRow?.q || 0);
}

function balanceReserved(db, productId) {
  if (!hasTable(db, 'stock_balances')) return 0;
  const row = db
    .prepare(`SELECT COALESCE(SUM(reserved_quantity), 0) AS rq FROM stock_balances WHERE product_id = ?`)
    .get(productId);
  return Number(row?.rq || 0);
}

function openWebOrderReserved(db, productId) {
  if (!hasTable(db, 'web_orders') || !hasTable(db, 'web_order_items')) return 0;
  try {
    const row = db
      .prepare(
        `SELECT COALESCE(SUM(wi.quantity), 0) AS q
         FROM web_order_items wi
         INNER JOIN web_orders wo ON wo.id = wi.order_id
         WHERE wi.product_id = ?
           AND wo.status NOT IN ('cancelled', 'delivered')
           AND (
             NOT EXISTS (
               SELECT 1 FROM pragma_table_info('web_orders') c
               WHERE c.name = 'stock_fulfilled_at'
             )
             OR wo.stock_fulfilled_at IS NULL
           )`,
      )
      .get(productId);
    return Number(row?.q || 0);
  } catch (e) {
    if (String(e.message || '').includes('no such')) return 0;
    throw e;
  }
}

function authoritativeReserved(db, productId) {
  return Math.max(balanceReserved(db, productId), openWebOrderReserved(db, productId));
}

/**
 * Visible stock for checkout / catalog: ledger quantity minus active reserve.
 * @param {import('better-sqlite3').Database} db
 * @param {string} productId
 * @returns {number}
 */
function getAvailableStock(db, productId) {
  const onHand = ledgerStock(db, productId);
  const reserved = authoritativeReserved(db, productId);
  return Math.max(0, onHand - reserved);
}

/**
 * SQL subquery (product_id, stock_qty) for catalog list/detail joins.
 * Reads inventory_movements (v_product_stock) and subtracts authoritative reserve.
 * @param {import('better-sqlite3').Database} db
 */
function catalogStockSubquery(db) {
  const hasMovements = hasInventoryMovements(db);
  const hasStockView = hasView(db, 'v_product_stock');
  const hasBalances = hasTable(db, 'stock_balances');
  const hasWebReserve = hasTable(db, 'web_orders') && hasTable(db, 'web_order_items');

  if (hasMovements && hasStockView) {
    const balanceReserve = hasBalances
      ? `LEFT JOIN (
          SELECT product_id, COALESCE(SUM(reserved_quantity), 0) AS reserved_qty
          FROM stock_balances
          GROUP BY product_id
        ) sb ON sb.product_id = vps.product_id`
      : '';
    const webReserve = hasWebReserve
      ? `LEFT JOIN (${OPEN_WEB_ORDER_RESERVE_SQL}) wr ON wr.product_id = vps.product_id`
      : '';
    const reserveExpr = hasBalances && hasWebReserve
      ? 'MAX(COALESCE(sb.reserved_qty, 0), COALESCE(wr.reserved_qty, 0))'
      : hasBalances
        ? 'COALESCE(sb.reserved_qty, 0)'
        : hasWebReserve
          ? 'COALESCE(wr.reserved_qty, 0)'
          : '0';

    return `
      SELECT
        vps.product_id,
        MAX(0, COALESCE(vps.stock, 0) - ${reserveExpr}) AS stock_qty
      FROM v_product_stock vps
      ${balanceReserve}
      ${webReserve}
    `;
  }

  if (hasBalances) {
    const webJoin = hasWebReserve
      ? `LEFT JOIN (${OPEN_WEB_ORDER_RESERVE_SQL}) wr ON wr.product_id = sb.product_id`
      : '';
    const reserveExpr = hasWebReserve
      ? 'MAX(COALESCE(SUM(sb.reserved_quantity), 0), COALESCE(MAX(wr.reserved_qty), 0))'
      : 'COALESCE(SUM(sb.reserved_quantity), 0)';
    return `
      SELECT
        sb.product_id,
        MAX(0, COALESCE(SUM(sb.quantity), 0) - ${reserveExpr}) AS stock_qty
      FROM stock_balances sb
      ${webJoin}
      GROUP BY sb.product_id
    `;
  }

  return `SELECT NULL AS product_id, 0 AS stock_qty WHERE 0`;
}

module.exports = {
  MAIN_WAREHOUSE_ID,
  catalogStockSubquery,
  getAvailableStock,
  ledgerStock,
  authoritativeReserved,
  hasInventoryMovements,
};

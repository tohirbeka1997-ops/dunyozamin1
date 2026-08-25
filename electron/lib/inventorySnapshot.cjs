'use strict';

const { formatYmdInTimeZone } = require('./timezone.cjs');

function hasTable(db, name) {
  try {
    return !!db.prepare(`SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name = ? LIMIT 1`).get(name)?.ok;
  } catch {
    return false;
  }
}

function monthStartYmd(date = new Date()) {
  const ymd = formatYmdInTimeZone(date);
  if (!ymd) return null;
  return `${ymd.slice(0, 7)}-01`;
}

function previousMonthStartYmd(ymd) {
  const [y, m] = String(ymd || '').split('-').map((v) => Number(v));
  if (!y || !m) return null;
  const d = new Date(y, m - 2, 1);
  return formatYmdInTimeZone(d);
}

function computeBalanceAt(db, productId, warehouseId, asOfYmd) {
  const snapRow = db
    .prepare(
      `
      SELECT snapshot_ymd, quantity
      FROM inventory_balance_snapshots
      WHERE product_id = ? AND warehouse_id = ? AND snapshot_ymd <= date(?)
      ORDER BY snapshot_ymd DESC
      LIMIT 1
    `,
    )
    .get(productId, warehouseId, asOfYmd);

  const fromYmd = snapRow?.snapshot_ymd || '1970-01-01';
  const baseQty = Number(snapRow?.quantity || 0) || 0;
  const deltaRow = db
    .prepare(
      `
      SELECT COALESCE(SUM(quantity), 0) AS delta
      FROM inventory_movements
      WHERE product_id = ? AND warehouse_id = ?
        AND date(created_at) >= date(?)
        AND date(created_at) < date(?)
    `,
    )
    .get(productId, warehouseId, fromYmd, asOfYmd);
  return baseQty + (Number(deltaRow?.delta || 0) || 0);
}

function ensureSnapshotForMonth(db, snapshotYmd) {
  if (!hasTable(db, 'inventory_balance_snapshots') || !hasTable(db, 'inventory_movements')) return;
  const exists = db
    .prepare(
      `SELECT 1 AS ok FROM inventory_balance_snapshots WHERE snapshot_ymd = date(?) LIMIT 1`,
    )
    .get(snapshotYmd);
  if (exists?.ok) return;

  const pairs = db
    .prepare(
      `
      SELECT DISTINCT product_id, warehouse_id
      FROM inventory_movements
    `,
    )
    .all();
  if (!pairs.length) return;

  const insert = db.prepare(
    `
    INSERT OR IGNORE INTO inventory_balance_snapshots (product_id, warehouse_id, snapshot_ymd, quantity)
    VALUES (?, ?, date(?), ?)
  `,
  );

  const tx = db.transaction(() => {
    for (const row of pairs) {
      const qty = computeBalanceAt(db, row.product_id, row.warehouse_id, snapshotYmd);
      insert.run(row.product_id, row.warehouse_id, snapshotYmd, qty);
    }
  });
  tx();
}

function ensureRecentSnapshots(db) {
  const current = monthStartYmd(new Date());
  if (!current) return current;
  ensureSnapshotForMonth(db, current);
  const prev = previousMonthStartYmd(current);
  if (prev) ensureSnapshotForMonth(db, prev);
  return current;
}

/**
 * SQL fragment: stock_from_movements per product/warehouse using latest snapshot + delta.
 * Returns { cteSql, snapshotYmd, paramsPrefix } where paramsPrefix is [snapshotYmd] for the CTE.
 */
function movementBalanceCteSql(db) {
  const snapshotYmd = ensureRecentSnapshots(db) || monthStartYmd(new Date()) || '1970-01-01';
  if (!hasTable(db, 'inventory_balance_snapshots')) {
    return {
      snapshotYmd: null,
      cteSql: `
        m AS (
          SELECT product_id, warehouse_id, COALESCE(SUM(quantity), 0) AS stock_from_movements
          FROM inventory_movements
          GROUP BY product_id, warehouse_id
        )`,
      cteParams: [],
    };
  }

  return {
    snapshotYmd,
    cteParams: [snapshotYmd, snapshotYmd],
    cteSql: `
      snap AS (
        SELECT product_id, warehouse_id, quantity AS snap_qty
        FROM inventory_balance_snapshots
        WHERE snapshot_ymd = date(?)
      ),
      delta AS (
        SELECT product_id, warehouse_id, COALESCE(SUM(quantity), 0) AS delta_qty
        FROM inventory_movements
        WHERE date(created_at) >= date(?)
        GROUP BY product_id, warehouse_id
      ),
      keys AS (
        SELECT product_id, warehouse_id FROM snap
        UNION
        SELECT product_id, warehouse_id FROM delta
      ),
      m AS (
        SELECT
          k.product_id,
          k.warehouse_id,
          COALESCE(s.snap_qty, 0) + COALESCE(d.delta_qty, 0) AS stock_from_movements
        FROM keys k
        LEFT JOIN snap s ON s.product_id = k.product_id AND s.warehouse_id = k.warehouse_id
        LEFT JOIN delta d ON d.product_id = k.product_id AND d.warehouse_id = k.warehouse_id
      )`,
  };
}

module.exports = {
  monthStartYmd,
  ensureRecentSnapshots,
  movementBalanceCteSql,
  computeBalanceAt,
};

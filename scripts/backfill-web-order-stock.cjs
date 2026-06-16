'use strict';

/**
 * One-off: fulfill stock for delivered web orders that skipped processing (legacy admin).
 * Usage: POS_DATA_DIR=/var/lib/pos node scripts/backfill-web-order-stock.cjs
 */
const path = require('path');
const Database = require('better-sqlite3');

function resolveDbPath() {
  const dataDir = process.env.POS_DATA_DIR && String(process.env.POS_DATA_DIR).trim();
  if (dataDir) return path.join(dataDir, 'pos.db');
  try {
    return require('../electron/lib/resolvePosDbPath.cjs').resolvePosDbPath();
  } catch {
    return path.join(process.cwd(), 'pos.db');
  }
}

const { fulfillWebOrderStock, isOrderStockFulfilled } = require('../public-api/lib/webOrderStock.cjs');
const { linkMarketplaceCustomerToPos } = require('../public-api/lib/marketplacePosCustomer.cjs');

const dbPath = resolveDbPath();
const db = new Database(dbPath);

const rows = db
  .prepare(
    `
    SELECT id, order_number, status, customer_id
    FROM web_orders
    WHERE status = 'delivered'
    ORDER BY id ASC
  `,
  )
  .all();

let fulfilled = 0;
let linked = 0;

for (const row of rows) {
  if (row.customer_id) {
    try {
      const posId = linkMarketplaceCustomerToPos(db, row.customer_id);
      if (posId) linked += 1;
    } catch {
      // ignore
    }
  }
  if (isOrderStockFulfilled(db, row.id)) continue;
  fulfillWebOrderStock(db, row.id, { reason: `Backfill delivered ${row.order_number}` });
  fulfilled += 1;
  console.log(`fulfilled order ${row.order_number} (#${row.id})`);
}

console.log(JSON.stringify({ db: dbPath, delivered_orders: rows.length, fulfilled, linked }, null, 2));

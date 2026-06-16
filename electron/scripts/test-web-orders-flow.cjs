'use strict';

/**
 * Smoke test: web order queues + stock hooks (run: node electron/scripts/test-web-orders-flow.cjs)
 */
const path = require('path');
const Database = require('better-sqlite3');
const { runMigrations } = require('../db/migrate.cjs');

const tmpDb = path.join(__dirname, '../../.pos-data-test-web-orders.db');
const fs = require('fs');
if (fs.existsSync(tmpDb)) fs.unlinkSync(tmpDb);

const db = new Database(tmpDb);
runMigrations(db);

const WebOrdersService = require('../services/webOrdersService.cjs');
const { reserveWebOrderStock, isOrderStockFulfilled } = require('../../public-api/lib/webOrderStock.cjs');

db.prepare(`INSERT INTO products (id, name, track_stock, is_active, sale_price, current_stock) VALUES ('wp1', 'Web P', 1, 1, 10000, 50)`).run();
db.prepare(
  `INSERT INTO stock_balances (id, product_id, warehouse_id, quantity, reserved_quantity, created_at, updated_at)
   VALUES ('wb1', 'wp1', 'main-warehouse-001', 50, 0, datetime('now'), datetime('now'))`,
).run();
db.prepare(`INSERT INTO marketplace_customers (id, telegram_id, first_name) VALUES (1, 999, 'Test')`).run();

const ins = db
  .prepare(
    `INSERT INTO web_orders (order_number, customer_id, status, payment_method, payment_status, total_amount, delivery_method, sales_channel, created_at, updated_at)
     VALUES ('WO-SMOKE', 1, 'new', 'cash', 'pending', 20000, 'courier', 'telegram', datetime('now'), datetime('now'))`,
  )
  .run();
const orderId = ins.lastInsertRowid;
db.prepare(`INSERT INTO web_order_items (order_id, product_id, quantity, price_at_order) VALUES (?, 'wp1', 3, 10000)`).run(orderId);

reserveWebOrderStock(db, orderId);

const svc = new WebOrdersService(db);
const counts = svc.countsByQueue();
if (counts.incoming < 1) {
  console.error('FAIL: expected incoming >= 1', counts);
  process.exit(1);
}

svc.updateStatus(orderId, 'processing');
if (!isOrderStockFulfilled(db, orderId)) {
  console.error('FAIL: stock should be fulfilled after processing');
  process.exit(1);
}

const preparing = svc.list({ queue: 'preparing' });
if (!preparing.data.some((r) => r.id === orderId)) {
  console.error('FAIL: order not in preparing queue');
  process.exit(1);
}

svc.updateStatus(orderId, 'ready');
const ready = svc.list({ queue: 'ready' });
if (!ready.data.some((r) => r.id === orderId)) {
  console.error('FAIL: order not in ready queue');
  process.exit(1);
}

const report = svc.reportSummary({ days: 30 });
if (Number(report.totals?.orders || 0) < 1) {
  console.error('FAIL: report should include order', report);
  process.exit(1);
}

console.log('OK web-orders-flow smoke:', { counts, reportTotals: report.totals });
fs.unlinkSync(tmpDb);
process.exit(0);

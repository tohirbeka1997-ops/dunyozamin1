/* eslint-disable no-console */
/**
 * unifiedOrders.smoke.test.cjs — POS Orders list merges orders + web_orders.
 * Run: electron electron/services/unifiedOrders.smoke.test.cjs
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-unified-orders-'));
process.env.POS_SERVER_MODE = '1';
process.env.POS_DATA_DIR = tmpDir;
process.env.POS_VERBOSE_LOGS = '0';

const { open, close } = require('../db/open.cjs');
const { createServices } = require('./index.cjs');

let passed = 0;
let failed = 0;

function ok(name) {
  passed += 1;
  console.log(`  ✓ ${name}`);
}

function fail(name, err) {
  failed += 1;
  console.log(`  ✗ ${name}`);
  console.log(`     ${err.message || err}`);
}

function runStep(name, fn) {
  try {
    fn();
    ok(name);
  } catch (e) {
    fail(name, e);
  }
}

async function main() {
  console.log('\n=== unifiedOrders.smoke ===\n');
  const db = open();
  const services = createServices(db);
  const { sales, shifts } = services;

  runStep('sales_channel column exists on orders', () => {
    const cols = db.prepare(`PRAGMA table_info(orders)`).all().map((c) => c.name);
    assert(cols.includes('sales_channel'), 'missing sales_channel on orders');
  });

  runStep('staff_mobile sale lands in orders table', () => {
    const shift = shifts.openShift({ user_id: 'default-admin-001' });
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO products (id, sku, name, sale_price, unit, is_active, track_stock, current_stock, created_at, updated_at)
       VALUES ('prod-unified-smoke', 'USM-1', 'Smoke Product', 1000, 'pcs', 1, 0, 0, ?, ?)`,
    ).run(now, now);
    const product = { id: 'prod-unified-smoke' };
    const res = sales.completePOSOrder(
      {
        user_id: 'default-admin-001',
        cashier_id: 'default-admin-001',
        shift_id: shift.id,
        subtotal: 1000,
        total_amount: 1000,
        sales_channel: 'staff_mobile',
      },
      [{ product_id: product.id, quantity: 1 }],
      [{ payment_method: 'cash', amount: 1000 }],
    );
    const row = db.prepare(`SELECT sales_channel FROM orders WHERE id = ?`).get(res.order_id);
    assert.strictEqual(row?.sales_channel, 'staff_mobile');
  });

  runStep('web order appears in unified list', () => {
    const now = new Date().toISOString();
    const cust = db
      .prepare(
        `INSERT INTO marketplace_customers (telegram_id, first_name, phone, created_at)
         VALUES (991001, 'Web', '+998901234567', ?)`,
      )
      .run(now);
    const wo = db
      .prepare(
        `INSERT INTO web_orders (order_number, customer_id, status, payment_method, payment_status, total_amount, created_at, updated_at)
         VALUES ('WEB-SMOKE-1', ?, 'processing', 'click', 'paid', 25000, ?, ?)`,
      )
      .run(cust.lastInsertRowid, now, now);
    const unified = sales.list({ include_web_orders: true, limit: 50 });
    const webRow = unified.find((r) => String(r.id) === `web:${wo.lastInsertRowid}`);
    assert(webRow, 'web order missing from unified list');
    assert.strictEqual(webRow.order_source, 'web');
    assert.strictEqual(webRow.order_number, 'WEB-SMOKE-1');
  });

  runStep('channel filter staff_mobile excludes web rows', () => {
    const rows = sales.list({ include_web_orders: true, sales_channel: 'staff_mobile', limit: 50 });
    assert(rows.every((r) => r.sales_channel === 'staff_mobile'));
    assert(rows.every((r) => r.order_source === 'pos'));
  });

  runStep('newest sort: newer POS order ranks above older web order', () => {
    const webAt = '2026-06-09T16:34:00.000Z';
    const posAt = '2026-06-09 19:05:49';
    const cust = db
      .prepare(
        `INSERT INTO marketplace_customers (telegram_id, first_name, phone, created_at)
         VALUES (991002, 'Sort', '+998901234568', ?)`,
      )
      .run(webAt);
    const wo = db
      .prepare(
        `INSERT INTO web_orders (order_number, customer_id, status, payment_method, payment_status, total_amount, created_at, updated_at)
         VALUES ('WEB-SORT-OLD', ?, 'processing', 'click', 'paid', 10000, ?, ?)`,
      )
      .run(cust.lastInsertRowid, webAt, webAt);
    const posId = 'pos-sort-newer-001';
    db.prepare(
      `INSERT INTO orders (id, order_number, customer_id, cashier_id, user_id, warehouse_id, subtotal, total_amount, status, payment_status, created_at, updated_at, sales_channel)
       VALUES (?, 'POS-SORT-NEW', 'default-customer-001', 'default-admin-001', 'default-admin-001', 'main-warehouse-001', 5000, 5000, 'completed', 'paid', ?, ?, 'pos')`,
    ).run(posId, posAt, posAt);

    const rows = sales.list({
      include_web_orders: true,
      limit: 50,
      sort_by: 'created_at',
      sort_order: 'DESC',
    });
    const webIdx = rows.findIndex((r) => String(r.id) === `web:${wo.lastInsertRowid}`);
    const posIdx = rows.findIndex((r) => r.id === posId);
    assert(webIdx >= 0, 'web order missing');
    assert(posIdx >= 0, 'pos order missing');
    assert(posIdx < webIdx, 'newer POS order should appear before older web order');
  });

  close();
  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

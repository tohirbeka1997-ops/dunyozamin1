/* eslint-disable no-console */
/**
 * Phase 2 finance: FIFO valuation, remaining-batch cost on PO edit,
 * mixed USD sale + UZS payment buckets.
 *
 * Ishga tushirish: node electron/services/phase2Finance.smoke.test.cjs
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const WH = 'main-warehouse-001';
const ADMIN = 'default-admin-001';
const FX = 12500;

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-phase2-finance-'));
process.env.POS_SERVER_MODE = '1';
process.env.POS_DATA_DIR = tmpDir;
process.env.POS_VERBOSE_LOGS = '0';

const { open, close, getDb } = require('../db/open.cjs');
const { createServices } = require('./index.cjs');
const { readCustomerBalances } = require('../lib/customerBalance.cjs');

let passed = 0;
let failed = 0;
function ok(name) {
  passed += 1;
  console.log(`  ✓ ${name}`);
}
function fail(name, err) {
  failed += 1;
  console.log(`  ✗ ${name}`);
  console.log(`     ${err?.message || err}`);
}
function runStep(name, fn) {
  try {
    fn();
    ok(name);
  } catch (e) {
    fail(name, e);
  }
}

function enableBatchMode(db) {
  db.prepare(
    `INSERT INTO settings (id, key, value, type, category, is_public, created_at, updated_at)
     VALUES (lower(hex(randomblob(16))), 'inventory.batch_mode_enabled', '1', 'boolean', 'inventory', 0, datetime('now'), datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value='1', updated_at=datetime('now')`
  ).run();
  db.prepare(
    `INSERT INTO settings (id, key, value, type, category, is_public, created_at, updated_at)
     VALUES (lower(hex(randomblob(16))), 'inventory.batch_cutover_at', '2000-01-01 00:00:00', 'string', 'inventory', 0, datetime('now'), datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')`
  ).run();
  db.prepare(
    `INSERT INTO settings (id, key, value, type, category, is_public, created_at, updated_at)
     VALUES (lower(hex(randomblob(16))), 'inventory.batch_strict_block', '0', 'boolean', 'inventory', 0, datetime('now'), datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value='0', updated_at=datetime('now')`
  ).run();
}

(async () => {
  console.log('\n=== PHASE 2 FINANCE SMOKE ===\n');
  try {
    open();
    const db = getDb();
    const { products, inventory, sales, shifts, reports, purchases, suppliers, customers, batches } =
      createServices(db);

    runStep('simple valuation uses current_stock × purchase_price', () => {
      db.prepare(
        `INSERT INTO settings (id, key, value, type, category, is_public, created_at, updated_at)
         VALUES (lower(hex(randomblob(16))), 'inventory.batch_mode_enabled', '0', 'boolean', 'inventory', 0, datetime('now'), datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value='0', updated_at=datetime('now')`
      ).run();
      db.prepare(
        `INSERT INTO settings (id, key, value, type, category, is_public, created_at, updated_at)
         VALUES (lower(hex(randomblob(16))), 'inventory.fifo_enabled', '0', 'boolean', 'inventory', 0, datetime('now'), datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value='0', updated_at=datetime('now')`
      ).run();
      const p = products.create({
        name: 'Val Simple',
        sku: `VS-${Date.now()}`,
        sale_price: 2000,
        purchase_price: 400,
        track_stock: 1,
        current_stock: 0,
      });
      inventory.adjustStock({
        warehouse_id: WH,
        adjustment_type: 'set',
        reason: 'phase2 simple val',
        created_by: ADMIN,
        items: [{ product_id: p.id, target_quantity: 5 }],
      });
      const rows = reports.getInventoryValuation({ warehouse_id: WH, status: 'active' });
      const row = rows.find((r) => r.product_id === p.id);
      assert.ok(row, 'valuation row');
      assert.strictEqual(Number(row.current_stock), 5);
      assert.strictEqual(Number(row.stock_value), 5 * 400);
    });

    enableBatchMode(db);
    runStep('FIFO valuation uses remaining_qty × unit_cost (not stock × catalog)', () => {
      const p = products.create({
        name: 'Val FIFO',
        sku: `VF-${Date.now()}`,
        sale_price: 3000,
        purchase_price: 999,
        track_stock: 1,
        current_stock: 0,
      });
      inventory.adjustStock({
        warehouse_id: WH,
        adjustment_type: 'set',
        reason: 'phase2 fifo val stock',
        created_by: ADMIN,
        items: [{ product_id: p.id, target_quantity: 10 }],
      });
      db.prepare('DELETE FROM inventory_batches WHERE product_id = ?').run(p.id);
      batches.createOpeningBatch(p.id, WH, 4, 250, '2000-01-01 00:00:00', 'P2-OPEN');
      const rows = reports.getInventoryValuation({ warehouse_id: WH, status: 'active' });
      const row = rows.find((r) => r.product_id === p.id);
      assert.ok(row, 'fifo valuation row');
      assert.strictEqual(Number(row.current_stock), 10, 'display stock from balances');
      assert.strictEqual(Number(row.stock_value), 4 * 250 + 6 * 999, 'batches + leftover at purchase_price');
      assert.strictEqual(Number(row.phantom_batch_value || 0), 0, 'no leftover when remaining_qty < stock');
      const detail = inventory.getProductDetail(p.id);
      assert.strictEqual(Number(detail.stock_value), 4 * 250 + 6 * 999, 'product card FIFO matches valuation');
    });

    runStep('FIFO valuation excludes leftover batches when stock is 0', () => {
      const p = products.create({
        name: 'Val Phantom',
        sku: `VP-${Date.now()}`,
        sale_price: 3000,
        purchase_price: 147840,
        track_stock: 1,
        current_stock: 0,
      });
      db.prepare('DELETE FROM inventory_batches WHERE product_id = ?').run(p.id);
      batches.createOpeningBatch(p.id, WH, 5, 147840, '2000-01-01 00:00:00', 'P2-PHANTOM');
      const rows = reports.getInventoryValuation({ warehouse_id: WH, status: 'active' });
      const row = rows.find((r) => r.product_id === p.id);
      assert.ok(row, 'phantom valuation row');
      assert.strictEqual(Number(row.current_stock), 0);
      assert.strictEqual(Number(row.stock_value), 0, 'on-hand value is 0 when stock is 0');
      assert.strictEqual(Number(row.phantom_batch_value), 5 * 147840, 'leftover batch value is split out');
      assert.strictEqual(Number(row.phantom_batch_qty), 5);
      const detail = inventory.getProductDetail(p.id);
      assert.strictEqual(Number(detail.stock_value), 0, 'product card on-hand value is 0 when stock is 0');
    });

    runStep('PO edit updates remaining batch unit_cost, not closed history', () => {
      const supplier = suppliers.create({ name: `P2 Sup ${Date.now()}`, phone: `+99890${Date.now()}`.slice(0, 13) });
      const p = products.create({
        name: 'PO Batch Cost',
        sku: `PBC-${Date.now()}`,
        sale_price: 8000,
        purchase_price: 1000,
        track_stock: 1,
        current_stock: 0,
      });
      const po = purchases.createOrder({
        supplier_id: supplier.id,
        warehouse_id: WH,
        status: 'approved',
        created_by: ADMIN,
        items: [{ product_id: p.id, ordered_qty: 3, unit_cost: 1000, line_total: 3000 }],
      });
      const itemId = po.items[0].id;
      purchases.receiveGoods(po.id, {
        items: [{ item_id: itemId, product_id: p.id, received_qty: 3 }],
        received_by: ADMIN,
      });
      const before = db
        .prepare(
          `SELECT id, remaining_qty, unit_cost FROM inventory_batches
           WHERE product_id = ? AND remaining_qty > 0`
        )
        .all(p.id);
      assert.ok(before.length >= 1, 'open batch after receive');
      purchases.updateOrder(
        po.id,
        { notes: 'phase2 cost fix' },
        [{ id: itemId, product_id: p.id, ordered_qty: 3, unit_cost: 1500, line_total: 4500 }]
      );
      const after = db
        .prepare(`SELECT unit_cost, remaining_qty FROM inventory_batches WHERE id = ?`)
        .get(before[0].id);
      assert.ok(Number(after.remaining_qty) > 0, 'batch still open');
      assert.strictEqual(Number(after.unit_cost), 1500, 'open batch cost updated');
    });

    const shift = shifts.openShift({ user_id: ADMIN });

    runStep('mixed USD sale + UZS payment hits USD bucket, not UZS', () => {
      const cust = customers.create({
        name: 'USD Mix',
        phone: `+99891${Date.now()}`.slice(0, 13),
        allow_credit: 1,
        allow_debt: 1,
        credit_limit: 1_000_000,
      });
      const p = products.create({
        name: 'USD Mix Prod',
        sku: `UMP-${Date.now()}`,
        sale_price: 10,
        purchase_price: 5,
        track_stock: 1,
        current_stock: 0,
      });
      inventory.adjustStock({
        warehouse_id: WH,
        adjustment_type: 'set',
        reason: 'usd mix seed',
        created_by: ADMIN,
        items: [{ product_id: p.id, target_quantity: 2 }],
      });
      sales.completePOSOrder(
        {
          total_amount: 10,
          currency: 'USD',
          fx_rate: FX,
          shift_id: shift.id,
          user_id: ADMIN,
          customer_id: cust.id,
          sales_channel: 'pos',
        },
        [
          {
            product_id: p.id,
            product_name: p.name,
            quantity: 1,
            qty_sale: 1,
            qty_base: 1,
            unit_price: 10,
            line_total: 10,
            final_total: 10,
          },
        ],
        [{ payment_method: 'cash', amount: 10 * FX, currency: 'UZS' }],
      );
      const bals = readCustomerBalances(db, cust.id);
      assert.ok(Math.abs(bals.usd) < 0.02, `USD bucket should be settled, got ${bals.usd}`);
      assert.ok(Math.abs(bals.uzs) < 0.02, `UZS bucket should stay 0, got ${bals.uzs}`);
    });

    runStep('USD sale without fx_rate is blocked', () => {
      let blocked = false;
      try {
        sales.completePOSOrder(
          { total_amount: 5, currency: 'USD', shift_id: shift.id, user_id: ADMIN },
          [{ product_id: 'x', quantity: 1, unit_price: 5, line_total: 5 }],
          [{ payment_method: 'cash', amount: 5 }],
        );
      } catch (e) {
        blocked = /fx_rate/i.test(String(e.message || e.code || ''));
      }
      assert.ok(blocked, 'missing fx_rate rejected');
    });

    close();
  } catch (e) {
    console.error(e);
    failed += 1;
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})();

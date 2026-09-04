/* eslint-disable no-console */
/**
 * batchFifo.smoke.test.cjs
 * FIFO / batch P0–P1:
 *   - one receipt batch then sale
 *   - two batches different costs, FIFO sale
 *   - partial sale
 *   - sale return restores original batch
 *   - revision surplus/shortage
 *   - costless correction blocked
 *   - parallel/retry allocate cannot consume same qty twice
 *   - purchase receipt appears in traceability, FIFO akt-sverka, valuation
 *
 * Ishga tushirish: npm run test:batch-fifo-smoke
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const WH = 'main-warehouse-001';
const ADMIN = 'default-admin-001';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-batch-fifo-smoke-'));
process.env.POS_SERVER_MODE = '1';
process.env.POS_DATA_DIR = tmpDir;
process.env.POS_VERBOSE_LOGS = '0';

const { open, close, getDb } = require('../db/open.cjs');
const { createServices } = require('./index.cjs');

function stockOf(inventory, productId) {
  return Number(inventory.getCurrentStock(productId, WH)) || 0;
}

function cartLine(product, { qtySale, unitPrice = 2000 }) {
  const lineTotal = unitPrice * qtySale;
  return {
    product_id: product.id,
    product_name: product.name,
    quantity: qtySale,
    qty_sale: qtySale,
    qty_base: qtySale,
    unit_price: unitPrice,
    line_total: lineTotal,
    discount_amount: 0,
  };
}

function enableBatchMode(db, batches) {
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
     VALUES (lower(hex(randomblob(16))), 'inventory.batch_strict_block', '1', 'boolean', 'inventory', 0, datetime('now'), datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value='1', updated_at=datetime('now')`
  ).run();
  db.prepare(
    `INSERT INTO settings (id, key, value, type, category, is_public, created_at, updated_at)
     VALUES (lower(hex(randomblob(16))), 'inventory.batch_require_cost_on_increase', '1', 'boolean', 'inventory', 0, datetime('now'), datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value='1', updated_at=datetime('now')`
  ).run();
  assert.ok(batches.isBatchModeEnabled(), 'batch mode should be enabled');
}

function receive(purchases, suppliers, product, qty, unitCost, skuTag, receivedAt) {
  const supplier = suppliers.create({
    name: `FIFO Sup ${skuTag}-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
    phone: `+99890${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`,
    settlement_currency: 'UZS',
  });
  const po = purchases.createOrder({
    supplier_id: supplier.id,
    warehouse_id: WH,
    order_date: '2026-09-03',
    status: 'approved',
    currency: 'UZS',
    created_by: ADMIN,
    items: [
      {
        product_id: product.id,
        product_name: product.name,
        product_sku: product.sku,
        ordered_qty: qty,
        unit_cost: unitCost,
        line_total: qty * unitCost,
      },
    ],
  });
  purchases.createReceipt({
    purchase_order_id: po.id,
    supplier_id: supplier.id,
    status: 'received',
    currency: 'UZS',
    received_at: receivedAt || '2026-09-03 12:00:00',
    created_by: ADMIN,
    items: [
      {
        purchase_order_item_id: po.items[0].id,
        product_id: product.id,
        product_name: product.name,
        received_qty: qty,
        unit_cost: unitCost,
        line_total: qty * unitCost,
      },
    ],
  });
  return { supplier, po };
}

let passed = 0;
let failed = 0;
function ok(name) {
  passed += 1;
  console.log(`  ✓ ${name}`);
}
function fail(name, err) {
  failed += 1;
  console.log(`  ✗ ${name}`);
  console.log(`     ${err && err.message ? err.message : err}`);
}
function runStep(name, fn) {
  try {
    fn();
    ok(name);
  } catch (e) {
    fail(name, e);
  }
}

try {
  console.log('\n=== BATCH FIFO SMOKE TEST ===');
  console.log(`Temp DB: ${tmpDir}\n`);

  open();
  const db = getDb();
  const {
    products,
    inventory,
    sales,
    shifts,
    batches,
    purchases,
    suppliers,
    reports,
    returns,
  } = createServices(db);

  enableBatchMode(db, batches);
  const shift = shifts.openShift({ user_id: ADMIN });

  const skuA = `FIFO-A-${Date.now()}`;
  const productA = products.create({
    name: 'FIFO One Batch',
    sku: skuA,
    sale_price: 2000,
    purchase_price: 1000,
    track_stock: 1,
    current_stock: 0,
  });

  runStep('one product, one receipt batch then sale', () => {
    receive(purchases, suppliers, productA, 1, 1000, 'A');
    assert.strictEqual(stockOf(inventory, productA.id), 1);
    const layers = db
      .prepare(`SELECT remaining_qty, unit_cost, source_type FROM inventory_batches WHERE product_id = ?`)
      .all(productA.id);
    assert.strictEqual(layers.length, 1);
    assert.strictEqual(Number(layers[0].remaining_qty), 1);
    assert.strictEqual(Number(layers[0].unit_cost), 1000);
    assert.strictEqual(layers[0].source_type, 'purchase_receive');

    const saleRes = sales.completePOSOrder(
      { total_amount: 2000, shift_id: shift.id, user_id: ADMIN },
      [cartLine(productA, { qtySale: 1 })],
      [{ payment_method: 'cash', amount: 2000 }],
    );
    assert.ok(saleRes?.order_id);
    assert.strictEqual(stockOf(inventory, productA.id), 0);
    const rem = db
      .prepare(`SELECT remaining_qty FROM inventory_batches WHERE product_id = ?`)
      .get(productA.id);
    assert.strictEqual(Number(rem.remaining_qty), 0);
  });

  const skuB = `FIFO-B-${Date.now()}`;
  const productB = products.create({
    name: 'FIFO Two Batches',
    sku: skuB,
    sale_price: 5000,
    purchase_price: 1000,
    track_stock: 1,
    current_stock: 0,
  });

  runStep('two batches different costs, FIFO sale + partial', () => {
    receive(purchases, suppliers, productB, 2, 1000, 'B1', '2026-09-03 10:00:00');
    receive(purchases, suppliers, productB, 2, 3000, 'B2', '2026-09-03 12:00:00');
    assert.strictEqual(stockOf(inventory, productB.id), 4);

    sales.completePOSOrder(
      { total_amount: 5000, shift_id: shift.id, user_id: ADMIN },
      [cartLine(productB, { qtySale: 1, unitPrice: 5000 })],
      [{ payment_method: 'cash', amount: 5000 }],
    );

    const layers = db
      .prepare(
        `SELECT unit_cost, remaining_qty, opened_at FROM inventory_batches
         WHERE product_id = ? ORDER BY opened_at ASC, created_at ASC, id ASC`
      )
      .all(productB.id);
    assert.ok(layers.length >= 2);
    const cheap = layers.find((l) => Number(l.unit_cost) === 1000);
    const dear = layers.find((l) => Number(l.unit_cost) === 3000);
    assert.ok(cheap && dear);
    assert.strictEqual(Number(cheap.remaining_qty), 1, 'FIFO consumes oldest/cheapest first receipt');
    assert.strictEqual(Number(dear.remaining_qty), 2);

    sales.completePOSOrder(
      { total_amount: 5000, shift_id: shift.id, user_id: ADMIN },
      [cartLine(productB, { qtySale: 2, unitPrice: 2500 })],
      [{ payment_method: 'cash', amount: 5000 }],
    );
    const after = db
      .prepare(
        `SELECT unit_cost, remaining_qty FROM inventory_batches
         WHERE product_id = ? ORDER BY opened_at ASC, created_at ASC, id ASC`
      )
      .all(productB.id);
    const cheap2 = after.find((l) => Number(l.unit_cost) === 1000);
    const dear2 = after.find((l) => Number(l.unit_cost) === 3000);
    assert.strictEqual(Number(cheap2.remaining_qty), 0);
    assert.strictEqual(Number(dear2.remaining_qty), 1);
    assert.strictEqual(stockOf(inventory, productB.id), 1);
  });

  const skuC = `FIFO-C-${Date.now()}`;
  const productC = products.create({
    name: 'FIFO Return',
    sku: skuC,
    sale_price: 2000,
    purchase_price: 800,
    track_stock: 1,
    current_stock: 0,
  });

  runStep('sale return restores original batch remaining', () => {
    receive(purchases, suppliers, productC, 2, 800, 'C');
    const saleRes = sales.completePOSOrder(
      { total_amount: 2000, shift_id: shift.id, user_id: ADMIN },
      [cartLine(productC, { qtySale: 1 })],
      [{ payment_method: 'cash', amount: 2000 }],
    );
    const remAfterSale = Number(
      db.prepare(`SELECT SUM(remaining_qty) AS q FROM inventory_batches WHERE product_id = ?`).get(productC.id).q
    );
    assert.strictEqual(remAfterSale, 1);

    const orderItem = db
      .prepare(`SELECT id FROM order_items WHERE order_id = ? AND product_id = ? LIMIT 1`)
      .get(saleRes.order_id, productC.id);
    assert.ok(orderItem?.id);
    const ret = returns.createReturn({
      order_id: saleRes.order_id,
      warehouse_id: WH,
      created_by: ADMIN,
      cashier_id: ADMIN,
      return_reason: 'fifo smoke return',
      refund_method: 'cash',
      items: [
        {
          order_item_id: orderItem.id,
          product_id: productC.id,
          quantity: 1,
          qty_base: 1,
        },
      ],
    });
    assert.ok(ret?.id || ret?.return_id);
    const remAfterReturn = Number(
      db.prepare(`SELECT SUM(remaining_qty) AS q FROM inventory_batches WHERE product_id = ?`).get(productC.id).q
    );
    assert.strictEqual(remAfterReturn, 2);
    assert.strictEqual(stockOf(inventory, productC.id), 2);
  });

  const skuD = `FIFO-D-${Date.now()}`;
  const productD = products.create({
    name: 'FIFO Revision',
    sku: skuD,
    sale_price: 1000,
    purchase_price: 400,
    track_stock: 1,
    current_stock: 0,
  });

  runStep('revision surplus/shortage with cost', () => {
    receive(purchases, suppliers, productD, 2, 400, 'D');
    inventory.adjustStock({
      warehouse_id: WH,
      adjustment_type: 'decrease',
      reason: 'shortage fifo smoke',
      created_by: ADMIN,
      items: [{ product_id: productD.id, quantity: 1 }],
    });
    assert.strictEqual(stockOf(inventory, productD.id), 1);
    inventory.adjustStock({
      warehouse_id: WH,
      adjustment_type: 'increase',
      reason: 'surplus fifo smoke',
      created_by: ADMIN,
      items: [{ product_id: productD.id, quantity: 1, unit_cost: 400 }],
    });
    assert.strictEqual(stockOf(inventory, productD.id), 2);
  });

  const skuE = `FIFO-E-${Date.now()}`;
  const productE = products.create({
    name: 'FIFO Costless Block',
    sku: skuE,
    sale_price: 1000,
    purchase_price: 0,
    track_stock: 1,
    current_stock: 0,
  });

  runStep('costless correction blocked', () => {
    receive(purchases, suppliers, productE, 1, 500, 'E');
    db.prepare(`UPDATE products SET purchase_price = 0 WHERE id = ?`).run(productE.id);
    let blocked = false;
    try {
      inventory.adjustStock({
        warehouse_id: WH,
        adjustment_type: 'increase',
        reason: 'zero cost should fail',
        created_by: ADMIN,
        items: [{ product_id: productE.id, quantity: 1, unit_cost: 0 }],
      });
    } catch (e) {
      blocked = /tannarx|unit_cost|cost/i.test(String(e.message || e));
    }
    assert.ok(blocked, 'zero-cost increase must be rejected');
  });

  runStep('retry allocate cannot consume same order_item twice', () => {
    const sku = `FIFO-IDEM-${Date.now()}`;
    const p = products.create({
      name: 'FIFO Idempotent',
      sku,
      sale_price: 1000,
      purchase_price: 100,
      track_stock: 1,
      current_stock: 0,
    });
    receive(purchases, suppliers, p, 1, 100, 'IDEM');
    const itemId = 'order-item-idem-001';
    const first = batches.allocateFIFOWithFallback({
      orderItemId: itemId,
      productId: p.id,
      warehouseId: WH,
      quantity: 1,
    });
    assert.strictEqual(first.length, 1);
    const rem1 = Number(
      db.prepare(`SELECT SUM(remaining_qty) AS q FROM inventory_batches WHERE product_id = ?`).get(p.id).q
    );
    assert.strictEqual(rem1, 0);
    const second = batches.allocateFIFOWithFallback({
      orderItemId: itemId,
      productId: p.id,
      warehouseId: WH,
      quantity: 1,
    });
    assert.strictEqual(second.length, 1);
    const rem2 = Number(
      db.prepare(`SELECT SUM(remaining_qty) AS q FROM inventory_batches WHERE product_id = ?`).get(p.id).q
    );
    assert.strictEqual(rem2, 0, 'second allocate must be idempotent');
    const outs = db
      .prepare(
        `SELECT COUNT(*) AS n FROM inventory_batch_allocations
         WHERE reference_type='order_item' AND reference_id=?`
      )
      .get(itemId);
    assert.strictEqual(Number(outs.n), 1);
  });

  runStep('two parallel sales cannot consume same batch qty twice', () => {
    const sku = `FIFO-PAR-${Date.now()}`;
    const p = products.create({
      name: 'FIFO Parallel',
      sku,
      sale_price: 1000,
      purchase_price: 100,
      track_stock: 1,
      current_stock: 0,
    });
    receive(purchases, suppliers, p, 1, 100, 'PAR');
    batches.allocateFIFOForOrderItem({
      orderItemId: 'order-item-par-a',
      productId: p.id,
      warehouseId: WH,
      quantity: 1,
    });
    let blocked = false;
    try {
      batches.allocateFIFOForOrderItem({
        orderItemId: 'order-item-par-b',
        productId: p.id,
        warehouseId: WH,
        quantity: 1,
      });
    } catch (e) {
      blocked = /INSUFFICIENT_BATCH|Insufficient batch/i.test(String(e.message || e.code || ''));
    }
    assert.ok(blocked, 'second sale must not consume the same remaining qty');
    const rem = Number(
      db.prepare(`SELECT SUM(remaining_qty) AS q FROM inventory_batches WHERE product_id = ?`).get(p.id).q
    );
    assert.strictEqual(rem, 0);
  });

  runStep('purchase invoice appears in traceability, FIFO akt-sverka, valuation', () => {
    const sku = `FIFO-RPT-${Date.now()}`;
    const p = products.create({
      name: 'FIFO Report SKU',
      sku,
      sale_price: 1500,
      purchase_price: 1000,
      track_stock: 1,
      current_stock: 0,
    });
    receive(purchases, suppliers, p, 1, 1000, 'RPT');

    const ledger = inventory.getProductLedger({ product_id: p.id });
    const inRow = (ledger.rows || []).find((r) => r.reference_type === 'purchase_receipt' || Number(r.qty_in) > 0);
    assert.ok(inRow, 'traceability should include purchase receipt');
    assert.ok(Number(inRow.cost_price) > 0, 'receipt cost should be present');
    assert.ok(Array.isArray(inRow.allocations) && inRow.allocations.length > 0, 'receipt batch layer on ledger');

    const sverka = reports.getActSverka({ search: sku });
    const hit = (sverka || []).find((r) => r.product_id === p.id || String(r.product_sku) === sku);
    assert.ok(hit, 'SKU search must find newly received product in FIFO akt-sverka');
    assert.ok(Number(hit.purchase_qty) >= 1, `purchase_qty=${hit.purchase_qty}`);
    assert.ok(Number(hit.remaining_qty) >= 1, `remaining_qty=${hit.remaining_qty}`);
    assert.ok(Math.abs(Number(hit.qty_balance_diff || 0)) < 0.0001, `qty_balance_diff=${hit.qty_balance_diff}`);

    const valFifo = reports.getInventoryValuation({
      warehouse_id: WH,
      cost_method: 'fifo',
      status: 'all',
      search: sku,
    });
    const valRows = Array.isArray(valFifo) ? valFifo : valFifo?.rows || [];
    const v = valRows.find((r) => r.product_id === p.id);
    assert.ok(v, 'valuation FIFO should include product');
    assert.ok(Number(v.current_stock) >= 1);
    assert.ok(Number(v.fifo_value || v.stock_value) >= 1000 - 0.01);

    const valCmp = reports.getInventoryValuation({
      warehouse_id: WH,
      cost_method: 'compare',
      status: 'all',
      search: sku,
    });
    const cmpRows = Array.isArray(valCmp) ? valCmp : valCmp?.rows || [];
    const c = cmpRows.find((r) => r.product_id === p.id);
    assert.ok(c, 'compare valuation should include product');
  });

  console.log(`\nPassed: ${passed}  Failed: ${failed}\n`);
  close();
  process.exit(failed > 0 ? 1 : 0);
} catch (err) {
  console.error(err);
  try {
    close();
  } catch {
    /* ignore */
  }
  process.exit(1);
}

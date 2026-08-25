/* eslint-disable no-console */
/**
 * batchFallback.smoke.test.cjs
 * FIFO batch audit tasks 1–3:
 *   - Sell without batch coverage → auto-batch + sale succeeds (fallback)
 *   - strict block restores old blocking behavior
 *   - repairBatchCoverage zeros drift (dryRun + apply)
 *
 * Ishga tushirish: npm run test:batch-fallback-smoke
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const WH = 'main-warehouse-001';
const ADMIN = 'default-admin-001';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-batch-fb-smoke-'));
process.env.POS_SERVER_MODE = '1';
process.env.POS_DATA_DIR = tmpDir;
process.env.POS_VERBOSE_LOGS = '0';

const { open, close, getDb } = require('../db/open.cjs');
const { createServices } = require('./index.cjs');

function stockOf(inventory, productId) {
  return Number(inventory.getCurrentStock(productId, WH)) || 0;
}

function batchStockOf(batches, productId) {
  return Number(batches.getBatchStock(productId, WH)) || 0;
}

function cartLine(product, { qtySale, unitPrice = 1000 }) {
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

function enableBatchMode(db, batches, cutoverAt) {
  db.prepare(
    `INSERT INTO settings (id, key, value, type, category, is_public, created_at, updated_at)
     VALUES (lower(hex(randomblob(16))), 'inventory.batch_mode_enabled', '1', 'boolean', 'inventory', 0, datetime('now'), datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value='1', updated_at=datetime('now')`
  ).run();
  db.prepare(
    `INSERT INTO settings (id, key, value, type, category, is_public, created_at, updated_at)
     VALUES (lower(hex(randomblob(16))), 'inventory.batch_cutover_at', ?, 'string', 'inventory', 0, datetime('now'), datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')`
  ).run(cutoverAt);
  db.prepare(
    `INSERT INTO settings (id, key, value, type, category, is_public, created_at, updated_at)
     VALUES (lower(hex(randomblob(16))), 'inventory.batch_strict_block', '0', 'boolean', 'inventory', 0, datetime('now'), datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value='0', updated_at=datetime('now')`
  ).run();
  assert.ok(batches.isBatchModeEnabled(), 'batch mode should be enabled');
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

try {
  console.log('\n=== BATCH FALLBACK SMOKE TEST ===');
  console.log(`Temp DB: ${tmpDir}\n`);

  open();
  const db = getDb();
  const { products, inventory, sales, shifts, batches } = createServices(db);

  const cutoverAt = '2000-01-01 00:00:00';

  const product = products.create({
    name: 'Batch Fallback Smoke',
    sku: `BFB-${Date.now()}`,
    sale_price: 1000,
    purchase_price: 500,
    track_stock: 1,
    current_stock: 0,
  });

  inventory.adjustStock({
    warehouse_id: WH,
    adjustment_type: 'set',
    reason: 'batch fallback smoke initial',
    created_by: ADMIN,
    items: [{ product_id: product.id, target_quantity: 10 }],
  });
  assert.strictEqual(stockOf(inventory, product.id), 10);
  db.prepare('DELETE FROM inventory_batches WHERE product_id = ?').run(product.id);
  assert.strictEqual(batchStockOf(batches, product.id), 0);
  ok('stock=10, batches cleared (uncovered stock)');

  enableBatchMode(db, batches, cutoverAt);

  const shift = shifts.openShift({ user_id: ADMIN });
  const saleQty = 2;

  const saleRes = sales.completePOSOrder(
    { total_amount: saleQty * 1000, shift_id: shift.id, user_id: ADMIN },
    [cartLine(product, { qtySale: saleQty })],
    [{ payment_method: 'cash', amount: saleQty * 1000 }],
  );
  assert.ok(saleRes?.order_id, 'sale should succeed with fallback');
  assert.strictEqual(stockOf(inventory, product.id), 8, 'stock decremented once');
  ok('sale without batches → auto-batch fallback, stock -2');

  const autoBatch = db
    .prepare(
      `SELECT id, source_type, doc_no, remaining_qty FROM inventory_batches
       WHERE product_id = ? AND warehouse_id = ? ORDER BY created_at DESC LIMIT 1`
    )
    .get(product.id, WH);
  assert.ok(autoBatch, 'auto-coverage batch should exist');
  assert.ok(String(autoBatch.doc_no || '').includes('AUTO-COVERAGE') || autoBatch.source_type === 'adjustment_in');
  ok('auto-coverage batch created and logged');

  const strictProduct = products.create({
    name: 'Strict Block Smoke',
    sku: `BFB-STRICT-${Date.now()}`,
    sale_price: 1000,
    purchase_price: 500,
    track_stock: 1,
    current_stock: 0,
  });
  db.prepare(`UPDATE settings SET value='0' WHERE key='inventory.batch_mode_enabled'`).run();
  inventory.adjustStock({
    warehouse_id: WH,
    adjustment_type: 'set',
    reason: 'strict block setup',
    created_by: ADMIN,
    items: [{ product_id: strictProduct.id, target_quantity: 5 }],
  });
  enableBatchMode(db, batches, cutoverAt);
  db.prepare(`UPDATE settings SET value='1' WHERE key='inventory.batch_strict_block'`).run();
  db.prepare('DELETE FROM inventory_batches WHERE product_id = ?').run(strictProduct.id);
  assert.strictEqual(stockOf(inventory, strictProduct.id), 5);

  let strictBlocked = false;
  try {
    sales.completePOSOrder(
      { total_amount: 1000, shift_id: shift.id, user_id: ADMIN },
      [cartLine(strictProduct, { qtySale: 1 })],
      [{ payment_method: 'cash', amount: 1000 }],
    );
  } catch (e) {
    strictBlocked = /INSUFFICIENT_BATCH|Insufficient batch/i.test(String(e.message || e.code || ''));
  }
  assert.ok(strictBlocked, 'strict block should reject sale without batches');
  assert.strictEqual(stockOf(inventory, strictProduct.id), 5, 'stock unchanged when blocked');
  ok('strict=true blocks sale without batch coverage');

  db.prepare(`UPDATE settings SET value='0' WHERE key='inventory.batch_strict_block'`).run();

  const repairProduct = products.create({
    name: 'Repair Drift Smoke',
    sku: `BFB-REP-${Date.now()}`,
    sale_price: 1000,
    purchase_price: 500,
    track_stock: 1,
    current_stock: 0,
  });
  db.prepare(`UPDATE settings SET value='0' WHERE key='inventory.batch_mode_enabled'`).run();
  inventory.adjustStock({
    warehouse_id: WH,
    adjustment_type: 'set',
    reason: 'repair drift test',
    created_by: ADMIN,
    items: [{ product_id: repairProduct.id, target_quantity: 7 }],
  });
  enableBatchMode(db, batches, cutoverAt);
  db.prepare('DELETE FROM inventory_batches WHERE product_id = ?').run(repairProduct.id);
  assert.strictEqual(stockOf(inventory, repairProduct.id), 7);
  assert.strictEqual(batchStockOf(batches, repairProduct.id), 0);

  const healthBefore = batches.getBatchHealth(repairProduct.id, WH);
  const reconcileBefore = batches.reconcile(repairProduct.id, WH);
  assert.ok(
    healthBefore.drift_count > 0 ||
      healthBefore.no_batch_stock_count > 0 ||
      reconcileBefore.length > 0,
    'drift visible before repair',
  );
  ok('reconcile shows uncovered stock');

  const dry = batches.repairBatchCoverage({ warehouseId: WH, dryRun: true });
  assert.ok(dry.dry_run);
  assert.ok(Array.isArray(dry.actions) && dry.actions.length > 0);
  ok('repairBatchCoverage dryRun lists actions');

  const repaired = batches.repairBatchCoverage({ warehouseId: WH, dryRun: false });
  assert.ok(repaired.created > 0 || repaired.reduced > 0);
  const healthAfter = batches.getBatchHealth(repairProduct.id, WH);
  assert.strictEqual(healthAfter.drift_count, 0, 'drift should be zero after repair');
  ok('repairBatchCoverage zeros drift');

  const product2 = products.create({
    name: 'Cutover Resume Smoke',
    sku: `BFB2-${Date.now()}`,
    sale_price: 2000,
    purchase_price: 800,
    track_stock: 1,
    current_stock: 0,
  });
  db.prepare(`UPDATE settings SET value='0' WHERE key='inventory.batch_mode_enabled'`).run();
  inventory.adjustStock({
    warehouse_id: WH,
    adjustment_type: 'set',
    reason: 'cutover resume',
    created_by: ADMIN,
    items: [{ product_id: product2.id, target_quantity: 4 }],
  });
  enableBatchMode(db, batches, cutoverAt);
  db.prepare('DELETE FROM inventory_batches WHERE product_id = ?').run(product2.id);

  const resume = batches.runCutoverSnapshot({
    cutoverAt: '2000-01-02 00:00:00',
    warehouseId: WH,
    force: false,
  });
  assert.ok(resume.resumed || resume.ok);
  const health2 = batches.getBatchHealth(product2.id, WH);
  assert.strictEqual(health2.drift_count, 0, 'after cutover resume repair, drift zero');
  ok('cutover re-enable repairs uncovered stock');

  db.prepare(`DELETE FROM settings WHERE key='inventory.batch_strict_block'`).run();
  assert.strictEqual(batches.isBatchStrictBlock(), true);
  ok('missing batch_strict_block defaults to strict block');

  console.log(`\n=== NATIJA: ${passed} o'tdi, ${failed} yiqildi ===\n`);
  close();
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
  process.exit(failed > 0 ? 1 : 0);
} catch (err) {
  fail('FATAL', err);
  try {
    close();
  } catch {
    // ignore
  }
  process.exit(1);
}

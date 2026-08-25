/* eslint-disable no-console */
/**
 * inventoryRevision.smoke.test.cjs
 * Ombor reviziyasi Phase 1: create → count some → leave others uncounted → complete
 * → only counted products' stock changes.
 *
 * Run: npm run test:inventory-revision-smoke
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const WH = 'main-warehouse-001';
const ADMIN = 'default-admin-001';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-inv-rev-smoke-'));
process.env.POS_SERVER_MODE = '1';
process.env.POS_DATA_DIR = tmpDir;
process.env.POS_VERBOSE_LOGS = '0';

const { open, close, getDb } = require('../db/open.cjs');
const { createServices } = require('./index.cjs');

function stockOf(inventory, productId) {
  return Number(inventory.getCurrentStock(productId, WH)) || 0;
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
  console.log(`     ${err.message || err}`);
  if (err.stack) console.log(err.stack.split('\n').slice(1, 4).join('\n'));
}

try {
  console.log('\n=== INVENTORY REVISION SMOKE TEST ===');
  console.log(`Temp DB dir: ${tmpDir}\n`);

  open();
  const db = getDb();
  const services = createServices(db);
  const { products, inventory, inventoryRevisions } = services;

  assert.ok(inventoryRevisions, 'inventoryRevisions service wired');
  ok('service wired');

  const tables = db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name IN ('inventory_revisions','inventory_revision_items')`
    )
    .all()
    .map((r) => r.name);
  assert.ok(tables.includes('inventory_revisions'), 'inventory_revisions table');
  assert.ok(tables.includes('inventory_revision_items'), 'inventory_revision_items table');
  ok('migration tables present');

  const pA = products.create({
    name: 'Rev Smoke A',
    sku: `REV-A-${Date.now()}`,
    barcode: `4600001${String(Date.now()).slice(-5)}`,
    sale_price: 1000,
    purchase_price: 500,
    track_stock: 1,
    current_stock: 0,
  });
  const pB = products.create({
    name: 'Rev Smoke B',
    sku: `REV-B-${Date.now()}`,
    barcode: `4600002${String(Date.now()).slice(-5)}`,
    sale_price: 2000,
    purchase_price: 800,
    track_stock: 1,
    current_stock: 0,
  });
  const pC = products.create({
    name: 'Rev Smoke C',
    sku: `REV-C-${Date.now()}`,
    barcode: `4600003${String(Date.now()).slice(-5)}`,
    sale_price: 3000,
    purchase_price: 900,
    track_stock: 1,
    current_stock: 0,
  });
  ok('create 3 products');

  inventory.adjustStock({
    warehouse_id: WH,
    reason: 'Revision smoke seed',
    adjustment_type: 'set',
    created_by: ADMIN,
    items: [
      { product_id: pA.id, target_quantity: 10 },
      { product_id: pB.id, target_quantity: 5 },
      { product_id: pC.id, target_quantity: 7 },
    ],
  });
  assert.strictEqual(stockOf(inventory, pA.id), 10);
  assert.strictEqual(stockOf(inventory, pB.id), 5);
  assert.strictEqual(stockOf(inventory, pC.id), 7);
  ok('seed stock A=10 B=5 C=7');

  const rev = inventoryRevisions.createRevision({
    warehouse_id: WH,
    created_by: ADMIN,
    notes: 'smoke',
  });
  assert.strictEqual(rev.status, 'in_progress');
  assert.ok(rev.items.length >= 3, 'snapshot includes products');
  const itemA = rev.items.find((i) => i.product_id === pA.id);
  const itemB = rev.items.find((i) => i.product_id === pB.id);
  const itemC = rev.items.find((i) => i.product_id === pC.id);
  assert.ok(itemA && itemB && itemC);
  assert.strictEqual(Number(itemA.system_qty), 10);
  assert.strictEqual(itemA.counted_qty, null);
  assert.strictEqual(itemA.count_status, 'pending');
  ok('createRevision snapshots system qty; pending badges');

  inventoryRevisions.updateItemCount({
    revision_id: rev.id,
    product_id: pA.id,
    counted_qty: 8,
  });
  let afterA = inventoryRevisions.getRevision(rev.id);
  const countedA = afterA.items.find((i) => i.product_id === pA.id);
  assert.strictEqual(Number(countedA.counted_qty), 8);
  assert.strictEqual(Number(countedA.variance), -2);
  assert.strictEqual(countedA.count_status, 'variance');
  ok('updateItemCount → variance badge');

  inventoryRevisions.updateItemCount({
    revision_id: rev.id,
    product_id: pB.id,
    counted_qty: 5,
  });
  afterA = inventoryRevisions.getRevision(rev.id);
  const countedB = afterA.items.find((i) => i.product_id === pB.id);
  assert.strictEqual(countedB.count_status, 'counted');
  ok('exact count → counted badge (no variance)');

  const pendingOnly = inventoryRevisions.getRevision(rev.id, { filter: 'pending' });
  assert.ok(pendingOnly.items.some((i) => i.product_id === pC.id));
  assert.ok(!pendingOnly.items.some((i) => i.product_id === pA.id));
  const varianceOnly = inventoryRevisions.getRevision(rev.id, { filter: 'variance' });
  assert.ok(varianceOnly.items.some((i) => i.product_id === pA.id));
  assert.ok(!varianceOnly.items.some((i) => i.product_id === pB.id));
  ok('filters: pending / variance');

  inventoryRevisions.countByBarcode({
    revision_id: rev.id,
    barcode: pA.barcode,
    counted_qty: 9,
  });
  afterA = inventoryRevisions.getRevision(rev.id);
  assert.strictEqual(Number(afterA.items.find((i) => i.product_id === pA.id).counted_qty), 9);
  ok('countByBarcode sets qty');

  inventoryRevisions.clearItemCount({ revision_id: rev.id, product_id: pB.id });
  afterA = inventoryRevisions.getRevision(rev.id);
  assert.strictEqual(afterA.items.find((i) => i.product_id === pB.id).counted_qty, null);
  // Re-count B so we have two counted (A variance, B exact) and C uncounted
  inventoryRevisions.updateItemCount({
    revision_id: rev.id,
    product_id: pB.id,
    counted_qty: 5,
  });
  ok('clearItemCount then re-count B');

  // Soft-lock: manual adjustStock blocked while revision open
  let softLockBlocked = false;
  try {
    inventory.adjustStock({
      warehouse_id: WH,
      reason: 'Should be blocked',
      adjustment_type: 'set',
      created_by: ADMIN,
      items: [{ product_id: pA.id, target_quantity: 1 }],
    });
  } catch (e) {
    softLockBlocked = /Ochiq ombor reviziyasi bor/i.test(String(e.message || e));
  }
  assert.ok(softLockBlocked, 'manual adjustStock blocked during open revision');
  assert.strictEqual(stockOf(inventory, pA.id), 10, 'soft-lock did not change stock');
  ok('soft-lock blocks manual adjustStock while revision open');

  // Live stock drift: change warehouse after snapshot, before complete
  // (allow flag simulates non-adjustStock paths like sales that still move stock)
  inventory.adjustStock({
    warehouse_id: WH,
    reason: 'Revision smoke mid-count sale',
    adjustment_type: 'set',
    created_by: ADMIN,
    allow_during_open_revision: true,
    items: [{ product_id: pA.id, target_quantity: 4 }],
  });
  const drifted = inventoryRevisions.getRevision(rev.id);
  const driftA = drifted.items.find((i) => i.product_id === pA.id);
  assert.strictEqual(Number(driftA.system_qty), 10, 'snapshot stays 10');
  assert.strictEqual(Number(driftA.live_qty), 4, 'live_qty reflects warehouse');
  assert.strictEqual(Number(driftA.current_qty), 4);
  assert.strictEqual(driftA.stock_drift, true);
  assert.ok((drifted.summary?.stock_drift_items || 0) >= 1);
  ok('getRevision exposes live_qty / stock_drift when live ≠ snapshot');

  // Only one open revision
  let duplicateBlocked = false;
  try {
    inventoryRevisions.createRevision({ warehouse_id: WH, created_by: ADMIN });
  } catch (e) {
    duplicateBlocked = /Ochiq ombor reviziyasi bor/i.test(String(e.message || e));
  }
  assert.ok(duplicateBlocked, 'second open revision rejected');
  ok('createRevision rejects when another draft/in_progress exists');

  const completed = inventoryRevisions.completeRevision({
    revision_id: rev.id,
    created_by: ADMIN,
  });
  assert.strictEqual(completed.status, 'completed');
  assert.ok(completed.stock_changed_since_snapshot === true);
  assert.ok((completed.stock_drift_items || 0) >= 1);
  assert.strictEqual(stockOf(inventory, pA.id), 9, 'A set to counted 9 (not live 4)');
  assert.strictEqual(stockOf(inventory, pB.id), 5, 'B set to counted 5 (idempotent)');
  assert.strictEqual(stockOf(inventory, pC.id), 7, 'C uncounted left unchanged');
  ok('completeRevision applies only counted (A→9 despite live drift, B same, C untouched)');

  let doubleCompleteBlocked = false;
  try {
    inventoryRevisions.completeRevision({ revision_id: rev.id, created_by: ADMIN });
  } catch (e) {
    doubleCompleteBlocked = /already completed/i.test(String(e.message || e));
  }
  assert.ok(doubleCompleteBlocked, 'second complete throws already completed');
  assert.strictEqual(stockOf(inventory, pA.id), 9, 'stock not double-adjusted');
  ok('double-complete is rejected atomically');

  let cancelledOk = false;
  try {
    inventoryRevisions.cancelRevision({ revision_id: rev.id });
  } catch (e) {
    cancelledOk = /cannot be cancelled/i.test(String(e.message || e));
  }
  assert.ok(cancelledOk, 'completed cannot cancel');
  ok('completed revision cannot be cancelled');

  // counted == snapshot, live drifted → complete must still write counted
  const revDrift = inventoryRevisions.createRevision({ warehouse_id: WH, created_by: ADMIN });
  inventoryRevisions.updateItemCount({
    revision_id: revDrift.id,
    product_id: pB.id,
    counted_qty: 5, // equals snapshot
  });
  inventory.adjustStock({
    warehouse_id: WH,
    reason: 'Drift B while counted==snapshot',
    adjustment_type: 'set',
    created_by: ADMIN,
    allow_during_open_revision: true,
    items: [{ product_id: pB.id, target_quantity: 2 }],
  });
  assert.strictEqual(stockOf(inventory, pB.id), 2);
  const driftOnly = inventoryRevisions.getRevision(revDrift.id);
  const driftB = driftOnly.items.find((i) => i.product_id === pB.id);
  assert.strictEqual(Number(driftB.system_qty), 5);
  assert.strictEqual(Number(driftB.counted_qty), 5);
  assert.strictEqual(Number(driftB.variance), 0);
  assert.strictEqual(Number(driftB.live_qty), 2);
  inventoryRevisions.completeRevision({ revision_id: revDrift.id, created_by: ADMIN });
  assert.strictEqual(
    stockOf(inventory, pB.id),
    5,
    'counted==snapshot but live drifted → stock forced to counted'
  );
  ok('complete always sets counted items even when variance vs snapshot is 0');

  const rev2 = inventoryRevisions.createRevision({ warehouse_id: WH, created_by: ADMIN });
  inventoryRevisions.cancelRevision({ revision_id: rev2.id });
  const cancelled = inventoryRevisions.getRevision(rev2.id);
  assert.strictEqual(cancelled.status, 'cancelled');
  assert.strictEqual(stockOf(inventory, pA.id), 9);
  ok('cancelRevision leaves stock unchanged');

  const rev3 = inventoryRevisions.createRevision({ warehouse_id: WH, created_by: ADMIN });
  const pendingIds = rev3.items
    .filter((i) => [pA.id, pB.id, pC.id].includes(i.product_id) && i.counted_qty == null)
    .map((i) => i.id);
  assert.ok(pendingIds.length >= 3);
  const zeroed = inventoryRevisions.bulkSetItemCounts({
    revision_id: rev3.id,
    counted_qty: 0,
    item_ids: pendingIds,
    only_pending: true,
  });
  for (const pid of [pA.id, pB.id, pC.id]) {
    const it = zeroed.items.find((i) => i.product_id === pid);
    assert.strictEqual(Number(it.counted_qty), 0);
  }
  assert.ok((zeroed.summary?.progress_percent || 0) > 0);
  ok('bulkSetItemCounts marks pending as zero + progress_percent');

  const listed = inventoryRevisions.listRevisions({ limit: 50 });
  assert.ok(listed.some((r) => r.id === rev.id));
  assert.ok(listed.some((r) => r.id === rev2.id));
  ok('listRevisions');

  // Soft-lock lifted after cancel/complete — cancel rev3 then adjust ok
  inventoryRevisions.cancelRevision({ revision_id: rev3.id });
  inventory.adjustStock({
    warehouse_id: WH,
    reason: 'After revision closed',
    adjustment_type: 'set',
    created_by: ADMIN,
    items: [{ product_id: pC.id, target_quantity: 7 }],
  });
  assert.strictEqual(stockOf(inventory, pC.id), 7);
  ok('soft-lock lifts after open revision closed');

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  close();
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch (_e) {
    /* ignore */
  }
  process.exit(failed > 0 ? 1 : 0);
} catch (err) {
  fail('fatal', err);
  try {
    close();
  } catch (_e) {
    /* ignore */
  }
  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(1);
}

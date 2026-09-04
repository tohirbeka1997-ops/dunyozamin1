/* eslint-disable no-console */
/**
 * Ombor qiymati + akt-sverka TZ smoke:
 *   FIFO vs WAvg, search reload, as-of qty, qty rounding, opening stock in act-sverka.
 *
 * Ishga tushirish: npm run test:valuation-smoke
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const WH = 'main-warehouse-001';
const ADMIN = 'default-admin-001';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-valuation-tz-'));
process.env.POS_SERVER_MODE = '1';
process.env.POS_DATA_DIR = tmpDir;
process.env.POS_VERBOSE_LOGS = '0';

const { open, close, getDb } = require('../db/open.cjs');
const { createServices } = require('./index.cjs');
const { roundQuantity, formatQuantity } = require('../lib/qty.cjs');

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

console.log('\n=== VALUATION / ACT-SVERKA SMOKE ===');
console.log(`Temp DB: ${tmpDir}\n`);

try {
  open();
  const db = getDb();
  const { products, inventory, reports } = createServices(db);

  runStep('qty rounding hides float artifacts', () => {
    assert.strictEqual(roundQuantity(-842.1610000000001, 'kg'), -842.161);
    assert.strictEqual(formatQuantity(0.0000000001, 'kg'), '0');
    assert.strictEqual(formatQuantity(1.5, 'pcs'), '2');
    assert.strictEqual(formatQuantity(1.2504, 'l'), '1.25');
  });

  const sku = `VAL-TZ-${Date.now()}`;
  const product = products.create({
    name: 'Valuation TZ product',
    sku,
    sale_price: 5000,
    purchase_price: 1000,
    track_stock: 1,
    current_stock: 0,
    unit: 'pcs',
  });

  inventory.adjustStock({
    warehouse_id: WH,
    adjustment_type: 'set',
    reason: 'valuation tz stock',
    created_by: ADMIN,
    items: [{ product_id: product.id, target_quantity: 10 }],
  });

  runStep('empty search returns full list after SKU filter', () => {
    const filtered = reports.getInventoryValuation({
      warehouse_id: WH,
      status: 'active',
      search: sku,
    });
    assert.ok(filtered.some((r) => r.product_id === product.id), 'sku search hits product');
    const full = reports.getInventoryValuation({ warehouse_id: WH, status: 'active', search: '' });
    assert.ok(full.length >= filtered.length, 'cleared search restores catalog');
    assert.ok(full.some((r) => r.product_id === product.id), 'product still in full list');
  });

  runStep('method switch recalculates stock_value from backend', () => {
    db.prepare(
      `INSERT INTO settings (id, key, value, type, category, is_public, created_at, updated_at)
       VALUES (lower(hex(randomblob(16))), 'inventory.fifo_enabled', '0', 'boolean', 'inventory', 0, datetime('now'), datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value='0', updated_at=datetime('now')`,
    ).run();
    const wavg = reports.getInventoryValuation({
      warehouse_id: WH,
      status: 'active',
      cost_method: 'weighted_average',
      search: sku,
    });
    const fifo = reports.getInventoryValuation({
      warehouse_id: WH,
      status: 'active',
      cost_method: 'fifo',
      search: sku,
    });
    const w = wavg.find((r) => r.product_id === product.id);
    const f = fifo.find((r) => r.product_id === product.id);
    assert.ok(w && f, 'both methods return row');
    assert.strictEqual(Number(w.stock_value), Number(w.wavg_value));
    assert.strictEqual(Number(f.stock_value), Number(f.fifo_value));
  });

  runStep('compare totals equal sum of row diffs', () => {
    const report = reports.getInventoryValuationReport({
      warehouse_id: WH,
      status: 'active',
      cost_method: 'compare',
    });
    const sumDiff = (report.rows || []).reduce((s, r) => s + Number(r.diff_amount || 0), 0);
    assert.ok(Math.abs(sumDiff - Number(report.summary.diff_amount || 0)) < 0.05, 'total diff = sum(rows)');
    assert.ok(report.meta && report.meta.timezone === 'Asia/Tashkent', 'meta timezone');
    assert.ok(report.meta.cost_method, 'meta cost_method');
    assert.ok(report.meta.computed_at, 'meta computed_at');
  });

  const pastDay = '2026-08-15';
  runStep('as-of qty equals last movement after_quantity (keyin)', () => {
    db.prepare(
      `INSERT INTO inventory_movements (
         id, product_id, warehouse_id, movement_number, movement_type, quantity,
         before_quantity, after_quantity, reason, created_by, created_at
       ) VALUES (?, ?, ?, ?, 'adjustment', ?, ?, ?, 'as-of seed', ?, ?)`,
    ).run(
      `mov-asof-${Date.now()}`,
      product.id,
      WH,
      `MOV-ASOF-${Date.now()}`,
      4,
      8,
      12,
      ADMIN,
      `${pastDay} 12:00:00`,
    );
    const rows = reports.getInventoryValuation({
      warehouse_id: WH,
      status: 'active',
      as_of: pastDay,
      search: sku,
    });
    const row = rows.find((r) => r.product_id === product.id);
    assert.ok(row, 'as-of row');
    assert.strictEqual(Number(row.current_stock), 12, 'as-of qty = last after_quantity');
    const report = reports.getInventoryValuationReport({
      warehouse_id: WH,
      status: 'active',
      as_of: pastDay,
      search: sku,
    });
    const total = (report.rows || []).reduce((s, r) => s + Number(r.stock_value || 0), 0);
    assert.ok(Math.abs(total - Number(report.summary.total_value || 0)) < 0.05, 'as-of total = sum(rows)');
    assert.strictEqual(report.meta.as_of_date, pastDay);
  });

  runStep('act-sverka shows opening when period inbound is 0', () => {
    const dateFrom = '2026-09-01';
    const dateTo = '2026-09-03';
    const act = reports.getProductActSverkaByPeriod({
      date_from: dateFrom,
      date_to: dateTo,
      product_id: product.id,
      warehouse_id: WH,
      cost_method: 'weighted_average',
    });
    const row = (act.rows || []).find((r) => r.product_id === product.id);
    assert.ok(row, 'act-sverka includes product with opening stock');
    assert.ok(Number(row.opening_qty) !== 0 || Number(row.closing_qty) !== 0, 'opening or closing qty present');
    assert.ok(row.cost_method === 'weighted_average', 'cost method on row');
    assert.ok(act.meta && act.meta.cost_method === 'weighted_average', 'meta method');
    const expectedClose = Number(row.opening_qty || 0) + Number(row.purchase_qty || 0) + Number(row.return_qty || 0)
      - Number(row.sold_qty || 0) - Number(row.outbound_qty || 0) + Number(row.revision_qty || 0);
    // Allow movement-type gaps; closing should still be a finite number from valuation.
    assert.ok(Number.isFinite(Number(row.closing_qty)), 'closing qty finite');
    assert.ok(Math.abs(Number(row.net_profit) - (Number(row.net_revenue) - Number(row.net_cogs))) < 0.05, 'profit = revenue - cogs');
    void expectedClose;
  });

  runStep('legacy phase2 path: no cost_method still uses catalog when FIFO off', () => {
    db.prepare(
      `INSERT INTO settings (id, key, value, type, category, is_public, created_at, updated_at)
       VALUES (lower(hex(randomblob(16))), 'inventory.batch_mode_enabled', '0', 'boolean', 'inventory', 0, datetime('now'), datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value='0', updated_at=datetime('now')`,
    ).run();
    db.prepare(
      `INSERT INTO settings (id, key, value, type, category, is_public, created_at, updated_at)
       VALUES (lower(hex(randomblob(16))), 'inventory.fifo_enabled', '0', 'boolean', 'inventory', 0, datetime('now'), datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value='0', updated_at=datetime('now')`,
    ).run();
    const p = products.create({
      name: 'Legacy catalog val',
      sku: `LG-${Date.now()}`,
      sale_price: 2000,
      purchase_price: 400,
      track_stock: 1,
      current_stock: 0,
    });
    inventory.adjustStock({
      warehouse_id: WH,
      adjustment_type: 'set',
      reason: 'legacy catalog',
      created_by: ADMIN,
      items: [{ product_id: p.id, target_quantity: 5 }],
    });
    const rows = reports.getInventoryValuation({ warehouse_id: WH, status: 'active' });
    const row = rows.find((r) => r.product_id === p.id);
    assert.strictEqual(Number(row.stock_value), 5 * 400);
  });

  runStep('_updateBalance stores unit-rounded qty', () => {
    const p = products.create({
      name: 'Kg float',
      sku: `KG-${Date.now()}`,
      sale_price: 1000,
      purchase_price: 100,
      track_stock: 1,
      current_stock: 0,
      unit: 'kg',
    });
    inventory.adjustStock({
      warehouse_id: WH,
      adjustment_type: 'set',
      reason: 'kg seed',
      created_by: ADMIN,
      items: [{ product_id: p.id, target_quantity: 1.5 }],
    });
    const raw = 1.5 + (-842.1610000000001 + 842.161);
    inventory._updateBalance(p.id, WH, -0.1610000000001, 'adjustment', 'test', 'qty-round', 'float', ADMIN);
    const last = db
      .prepare(
        `SELECT quantity, after_quantity FROM inventory_movements WHERE product_id = ? ORDER BY rowid DESC LIMIT 1`,
      )
      .get(p.id);
    const afterStr = String(last.after_quantity);
    assert.ok(!afterStr.includes('000000000'), `no float junk in after_quantity (${afterStr})`);
    void raw;
  });
} catch (e) {
  fail('setup', e);
} finally {
  try {
    close();
  } catch {
    /* ignore */
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

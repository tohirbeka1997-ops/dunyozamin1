/* eslint-disable no-console */
/**
 * purchasePlanning.smoke.test.cjs — Bozorga borish hisoboti
 *
 * Ishga tushirish: npm run test:purchase-planning-smoke
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { formatYmdInTimeZone } = require('../lib/timezone.cjs');

const WH = 'main-warehouse-001';
const ADMIN = 'default-admin-001';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-plan-smoke-'));
process.env.POS_SERVER_MODE = '1';
process.env.POS_DATA_DIR = tmpDir;
process.env.POS_VERBOSE_LOGS = '0';

const { open, close, getDb } = require('../db/open.cjs');
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

function findRow(result, productId) {
  return (result.rows || []).find((r) => r.product_id === productId);
}

try {
  console.log('\n=== PURCHASE PLANNING SMOKE TEST ===');
  console.log(`Temp DB dir: ${tmpDir}\n`);

  open();
  const db = getDb();
  const { products, inventory, purchases, suppliers, reports, sales, shifts } = createServices(db);
  const today = formatYmdInTimeZone(new Date());

  const supplier = suppliers.create({
    name: 'Plan Smoke Supplier',
    phone: '+998901111000',
  });

  const piece = products.create({
    name: 'Plan Piece',
    sku: `PLAN-PCS-${Date.now()}`,
    sale_price: 2000,
    purchase_price: 1000,
    track_stock: 1,
    current_stock: 0,
    unit: 'pcs',
    base_unit: 'pcs',
  });
  const meter = products.create({
    name: 'Plan Meter',
    sku: `PLAN-M-${Date.now()}`,
    sale_price: 5000,
    purchase_price: 3000,
    track_stock: 1,
    current_stock: 0,
    unit: 'm',
    base_unit: 'm',
  });
  const nosale = products.create({
    name: 'Plan NoSale',
    sku: `PLAN-NS-${Date.now()}`,
    sale_price: 1000,
    purchase_price: 500,
    track_stock: 1,
    current_stock: 8,
    unit: 'pcs',
    base_unit: 'pcs',
  });
  const inboundP = products.create({
    name: 'Plan Inbound',
    sku: `PLAN-IN-${Date.now()}`,
    sale_price: 2000,
    purchase_price: 1000,
    track_stock: 1,
    current_stock: 0,
    unit: 'pcs',
    base_unit: 'pcs',
  });
  const reservedP = products.create({
    name: 'Plan Reserved',
    sku: `PLAN-RS-${Date.now()}`,
    sale_price: 2000,
    purchase_price: 1000,
    track_stock: 1,
    current_stock: 0,
    unit: 'pcs',
    base_unit: 'pcs',
  });

  inventory.adjustStock({
    warehouse_id: WH,
    reason: 'plan smoke stock',
    adjustment_type: 'set',
    created_by: ADMIN,
    items: [{ product_id: nosale.id, target_quantity: 8 }],
  });

  const receiveCost = (product, qty, cost) => {
    const po = purchases.createOrder({
      supplier_id: supplier.id,
      supplier_name: supplier.name,
      order_date: today,
      status: 'approved',
      created_by: ADMIN,
      items: [
        {
          product_id: product.id,
          product_name: product.name,
          ordered_qty: qty,
          unit_cost: cost,
          line_total: qty * cost,
        },
      ],
    });
    purchases.receiveGoods(po.id, {
      items: [{ item_id: po.items[0].id, product_id: product.id, received_qty: qty }],
      received_by: ADMIN,
    });
  };

  receiveCost(piece, 20, 1000);
  receiveCost(meter, 40, 3000);
  receiveCost(inboundP, 10, 1000);
  receiveCost(reservedP, 10, 1000);

  const shift = shifts.openShift({ user_id: ADMIN });
  const sell = (product, qty, price) => {
    const total = qty * price;
    sales.completePOSOrder(
      { total_amount: total, shift_id: shift.id, user_id: ADMIN },
      [
        {
          product_id: product.id,
          product_name: product.name,
          quantity: qty,
          qty_base: qty,
          unit_price: price,
          line_total: total,
        },
      ],
      [{ payment_method: 'cash', amount: total }],
    );
  };

  sell(piece, 10, 2000);
  sell(meter, 26.5, 5000);
  sell(inboundP, 10, 2000);
  sell(reservedP, 5, 2000);

  inventory.adjustStock({
    warehouse_id: WH,
    reason: 'post-sale stock for planning',
    adjustment_type: 'set',
    created_by: ADMIN,
    items: [
      { product_id: piece.id, target_quantity: 0 },
      { product_id: meter.id, target_quantity: 0 },
    ],
  });

  const openInbound = purchases.createOrder({
    supplier_id: supplier.id,
    supplier_name: supplier.name,
    order_date: today,
    status: 'approved',
    created_by: ADMIN,
    items: [
      {
        product_id: inboundP.id,
        product_name: inboundP.name,
        ordered_qty: 4,
        unit_cost: 1000,
        line_total: 4000,
      },
    ],
  });
  assert.ok(openInbound.id);

  db.prepare(
    `UPDATE stock_balances SET reserved_quantity = 2 WHERE product_id = ? AND warehouse_id = ?`,
  ).run(reservedP.id, WH);

  try {
    db.prepare(
      `INSERT INTO product_purchase_settings (product_id, preferred_supplier_id, moq, order_step, qty_precision, lead_time_days)
       VALUES (?, ?, 1, 1, 3, 5)
       ON CONFLICT(product_id) DO UPDATE SET order_step=1, qty_precision=3, preferred_supplier_id=excluded.preferred_supplier_id`,
    ).run(meter.id, supplier.id);
  } catch {
    db.prepare(`UPDATE products SET order_step = 1, qty_precision = 3, preferred_supplier_id = ? WHERE id = ?`).run(
      supplier.id,
      meter.id,
    );
  }

  const all = reports.getPurchasePlanning({
    analysis_days: 7,
    plan_days: 7,
    only_risk: false,
    date_to: today,
  });
  assert.ok(all && Array.isArray(all.rows), 'result.rows array');
  assert.ok(all.meta && all.meta.timezone, 'meta.timezone');
  assert.ok(Number.isFinite(all.meta.calc_ms), 'calc_ms');
  assert.ok(all.meta.formula && all.meta.formula.includes('dailySalesRate'), 'formula');
  ok('backend payload: rows + meta + formula + calc time');

  runStep('1. Search → clear → full list restored', () => {
    const searched = reports.getPurchasePlanning({
      analysis_days: 7,
      plan_days: 7,
      only_risk: false,
      search: piece.sku,
      date_to: today,
    });
    assert.ok(searched.rows.some((r) => r.product_id === piece.id));
    assert.ok(searched.rows.length < all.rows.length, 'search narrows list');
    const cleared = reports.getPurchasePlanning({
      analysis_days: 7,
      plan_days: 7,
      only_risk: false,
      search: '',
      date_to: today,
    });
    assert.equal(cleared.rows.length, all.rows.length);
    assert.equal(cleared.totals.row_count, all.totals.row_count);
  });

  runStep('2. 7 / 14 / 30 day analysis recalculates recommendation', () => {
    const r7 = findRow(reports.getPurchasePlanning({ analysis_days: 7, plan_days: 7, only_risk: false, date_to: today }), piece.id);
    const r14 = findRow(reports.getPurchasePlanning({ analysis_days: 14, plan_days: 7, only_risk: false, date_to: today }), piece.id);
    const r30 = findRow(reports.getPurchasePlanning({ analysis_days: 30, plan_days: 7, only_risk: false, date_to: today }), piece.id);
    assert.ok(r7 && r14 && r30);
    assert.notEqual(r7.recommended_qty, r14.recommended_qty);
    assert.notEqual(r14.recommended_qty, r30.recommended_qty);
    assert.ok(r7.recommended_qty > r30.recommended_qty);
  });

  runStep('3. Piece product rounds up', () => {
    const row = findRow(all, piece.id);
    assert.ok(row);
    assert.equal(row.unit_precision, 0);
    const rec = Number(row.recommended_qty);
    assert.equal(rec, Math.ceil(rec));
    assert.ok(rec >= 1);
    assert.match(String(row.rounding_rule), /dona|ceil/i);
  });

  runStep('4. Meter respects fractional precision and step', () => {
    const meterResult = reports.getPurchasePlanning({
      analysis_days: 7,
      plan_days: 7,
      safety_days: 0,
      only_risk: false,
      date_to: today,
    });
    const row = findRow(meterResult, meter.id);
    assert.ok(row);
    assert.ok(row.unit_precision >= 3);
    assert.ok(Number(row.forecast_demand_qty) >= 26.5);
    assert.ok(Number(row.recommended_qty) >= 26.5);
    assert.equal(Number(row.recommended_qty), 27);
  });

  runStep('5. Inbound PO reduces recommendation', () => {
    const row = findRow(all, inboundP.id);
    assert.ok(row);
    assert.ok(Number(row.confirmed_inbound_qty) >= 4);
    const without = Number(row.forecast_demand_qty) + Number(row.safety_qty);
    assert.ok(Number(row.recommended_qty) < without);
  });

  runStep('6. Reserved qty increases recommendation', () => {
    const row = findRow(all, reservedP.id);
    assert.ok(row);
    assert.equal(Number(row.reserved_qty), 2);
    assert.ok(Number(row.available_qty) <= Number(row.on_hand_qty) - 2 + 1e-9);
  });

  runStep('7. No-sales product gets distinct status', () => {
    const row = findRow(all, nosale.id);
    assert.ok(row);
    assert.equal(row.status, 'NO_SALES');
  });

  runStep('8. Total recommended qty equals sum of rows', () => {
    const sum = all.rows.reduce((s, r) => s + Number(r.recommended_qty || 0), 0);
    assert.ok(Math.abs(sum - Number(all.totals.recommended_qty || 0)) < 0.000001);
    const counts = all.totals.status_counts;
    const recount = { SHORTAGE: 0, RISK: 0, OK: 0, NO_SALES: 0, INSUFFICIENT_DATA: 0 };
    for (const r of all.rows) recount[r.status] = (recount[r.status] || 0) + 1;
    assert.deepStrictEqual(counts, recount);
  });

  runStep('9. Draft PO from recommendation copies qty and prices', () => {
    const row = findRow(all, piece.id);
    assert.ok(row && Number(row.recommended_qty) > 0);
    let threw = false;
    try {
      purchases.createDraftFromPlanning({
        product_ids: [piece.id],
        planning_filters: { analysis_days: 7, plan_days: 7, date_to: today },
        confirm: false,
      });
    } catch {
      threw = true;
    }
    assert.ok(threw, 'create without confirm must fail');

    const preview = purchases.previewDraftFromPlanning({
      product_ids: [piece.id],
      planning_filters: { analysis_days: 7, plan_days: 7, date_to: today },
    });
    assert.ok(preview.groups.length >= 1);
    const g = preview.groups.find((x) => x.supplier_id === supplier.id);
    assert.ok(g);
    const item = g.items.find((i) => i.product_id === piece.id);
    assert.equal(Number(item.ordered_qty), Number(row.recommended_qty));
    assert.equal(Number(item.unit_cost), Number(row.last_purchase_cost));

    const created = purchases.createDraftFromPlanning({
      product_ids: [piece.id],
      planning_filters: { analysis_days: 7, plan_days: 7, date_to: today },
      confirm: true,
      created_by: ADMIN,
    });
    assert.equal(created.created.length, 1);
    const po = purchases.get(created.created[0].id);
    assert.equal(String(po.status).toLowerCase(), 'draft');
    assert.equal(Number(po.items[0].ordered_qty), Number(row.recommended_qty));
    assert.equal(Number(po.items[0].unit_cost), Number(row.last_purchase_cost));
  });

  runStep('report never auto-creates extra POs', () => {
    const before = db.prepare(`SELECT COUNT(*) AS n FROM purchase_orders`).get().n;
    reports.getPurchasePlanning({ analysis_days: 7, plan_days: 7, only_risk: false, date_to: today });
    const after = db.prepare(`SELECT COUNT(*) AS n FROM purchase_orders`).get().n;
    assert.equal(before, after);
  });
} catch (e) {
  fail('setup', e);
} finally {
  try {
    close();
  } catch {
    /* ignore */
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

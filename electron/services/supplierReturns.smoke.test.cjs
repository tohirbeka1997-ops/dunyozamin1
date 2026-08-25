/* eslint-disable no-console */
/**
 * supplierReturns.smoke.test.cjs
 * Postavshikka qaytarish:
 *   - faqat shu yetkazib beruvchidan kelgan mahsulotlar
 *   - miqdor qoldiqdan oshmasligi
 *   - ombor + credit note + (batch mode) partiya FIFO
 *
 * Ishga tushirish: npm run test:supplier-return-smoke
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const WH = 'main-warehouse-001';
const ADMIN = 'default-admin-001';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-supplier-return-smoke-'));
process.env.POS_SERVER_MODE = '1';
process.env.POS_DATA_DIR = tmpDir;
process.env.POS_VERBOSE_LOGS = '0';

const { open, close, getDb } = require('../db/open.cjs');
const { createServices } = require('./index.cjs');
const { formatYmdInTimeZone } = require('../lib/timezone.cjs');

function stockOf(inventory, productId) {
  return Number(inventory.getCurrentStock(productId, WH)) || 0;
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
function runStep(name, fn) {
  try {
    fn();
    ok(name);
  } catch (e) {
    fail(name, e);
  }
}

console.log('\n=== SUPPLIER RETURN SMOKE TEST ===');
console.log(`Temp DB: ${tmpDir}\n`);

try {
  open();
  const db = getDb();
  const { products, inventory, purchases, suppliers, supplierReturns, batches, exchangeRates } =
    createServices(db);

  const today = formatYmdInTimeZone(new Date());
  enableBatchMode(db, batches, '2000-01-01 00:00:00');

  const supplierA = suppliers.create({
    name: 'Smoke Return A',
    phone: '+998901111001',
    settlement_currency: 'UZS',
  });
  const supplierB = suppliers.create({
    name: 'Smoke Return B',
    phone: '+998901111002',
    settlement_currency: 'UZS',
  });

  const productShared = products.create({
    name: 'Shared Return Product',
    sku: `SR-SHARED-${Date.now()}`,
    sale_price: 12000,
    purchase_price: 5000,
    track_stock: 1,
    current_stock: 0,
  });
  const productOnlyB = products.create({
    name: 'Only From B',
    sku: `SR-ONLYB-${Date.now()}`,
    sale_price: 9000,
    purchase_price: 4000,
    track_stock: 1,
    current_stock: 0,
  });
  const productOrphan = products.create({
    name: 'Never Purchased',
    sku: `SR-ORPHAN-${Date.now()}`,
    sale_price: 5000,
    purchase_price: 2000,
    track_stock: 1,
    current_stock: 0,
  });

  // Stock for orphan via adjustment (not from any supplier)
  inventory._updateBalance(
    productOrphan.id,
    WH,
    5,
    'adjustment',
    'adjustment',
    'adj-orphan-001',
    'orphan stock',
    ADMIN
  );

  // A receives 10 of shared
  const poA = purchases.createOrder({
    supplier_id: supplierA.id,
    supplier_name: supplierA.name,
    order_date: today,
    status: 'approved',
    created_by: ADMIN,
    currency: 'UZS',
    items: [
      {
        product_id: productShared.id,
        product_name: productShared.name,
        ordered_qty: 10,
        unit_cost: 5000,
        line_total: 50000,
      },
    ],
  });
  purchases.receiveGoods(poA.id, {
    items: [
      {
        item_id: poA.items.find((it) => it.product_id === productShared.id).id,
        product_id: productShared.id,
        received_qty: 10,
      },
    ],
    received_by: ADMIN,
  });

  // B receives 7 of shared + 4 of onlyB
  const poB = purchases.createOrder({
    supplier_id: supplierB.id,
    supplier_name: supplierB.name,
    order_date: today,
    status: 'approved',
    created_by: ADMIN,
    currency: 'UZS',
    items: [
      {
        product_id: productShared.id,
        product_name: productShared.name,
        ordered_qty: 7,
        unit_cost: 5500,
        line_total: 38500,
      },
      {
        product_id: productOnlyB.id,
        product_name: productOnlyB.name,
        ordered_qty: 4,
        unit_cost: 4000,
        line_total: 16000,
      },
    ],
  });
  const poBShared = poB.items.find((it) => it.product_id === productShared.id);
  const poBOnly = poB.items.find((it) => it.product_id === productOnlyB.id);
  purchases.receiveGoods(poB.id, {
    items: [
      { item_id: poBShared.id, product_id: productShared.id, received_qty: 7 },
      { item_id: poBOnly.id, product_id: productOnlyB.id, received_qty: 4 },
    ],
    received_by: ADMIN,
  });

  assert.strictEqual(stockOf(inventory, productShared.id), 17);
  assert.strictEqual(stockOf(inventory, productOnlyB.id), 4);
  ok('setup: A=10 shared, B=7 shared + 4 onlyB, orphan=5');

  runStep('listReturnable: A da faqat shared (10)', () => {
    const list = supplierReturns.listReturnableProducts({ supplier_id: supplierA.id });
    assert.ok(list.some((p) => p.product_id === productShared.id));
    assert.ok(!list.some((p) => p.product_id === productOnlyB.id));
    assert.ok(!list.some((p) => p.product_id === productOrphan.id));
    const shared = list.find((p) => p.product_id === productShared.id);
    assert.strictEqual(Number(shared.returnable_qty), 10);
  });

  runStep('listReturnable: B da shared=7 va onlyB=4', () => {
    const list = supplierReturns.listReturnableProducts({ supplier_id: supplierB.id });
    const shared = list.find((p) => p.product_id === productShared.id);
    const onlyB = list.find((p) => p.product_id === productOnlyB.id);
    assert.strictEqual(Number(shared?.returnable_qty), 7);
    assert.strictEqual(Number(onlyB?.returnable_qty), 4);
  });

  runStep('rad: orphan mahsulotni A ga qaytarish', () => {
    let threw = false;
    try {
      supplierReturns.create({
        supplier_id: supplierA.id,
        created_by: ADMIN,
        items: [{ product_id: productOrphan.id, quantity: 1, unit_cost: 2000 }],
      });
    } catch (e) {
      threw = true;
      assert.ok(
        /qabul qilinmagan|qoldiq yo‘q|qoldiq yo'q/i.test(String(e.message || '')),
        `unexpected message: ${e.message}`
      );
    }
    assert.ok(threw, 'expected validation error');
  });

  runStep('rad: B mahsulotini A ga qaytarish', () => {
    let threw = false;
    try {
      supplierReturns.create({
        supplier_id: supplierA.id,
        created_by: ADMIN,
        items: [{ product_id: productOnlyB.id, quantity: 1, unit_cost: 4000 }],
      });
    } catch (e) {
      threw = true;
      assert.ok(/qabul qilinmagan|qoldiq yo‘q|qoldiq yo'q/i.test(String(e.message || '')));
    }
    assert.ok(threw);
  });

  runStep('rad: A dan shared 11 (faqat 10 bor)', () => {
    let threw = false;
    try {
      supplierReturns.create({
        supplier_id: supplierA.id,
        created_by: ADMIN,
        items: [{ product_id: productShared.id, quantity: 11, unit_cost: 5000 }],
      });
    } catch (e) {
      threw = true;
      assert.ok(/oshib ketdi/i.test(String(e.message || '')), `unexpected: ${e.message}`);
      assert.ok(/Mavjud:\s*10/i.test(String(e.message || '')), `unexpected: ${e.message}`);
    }
    assert.ok(threw);
    assert.strictEqual(stockOf(inventory, productShared.id), 17);
  });

  runStep('muvaffaqiyat: A ga shared 3 qaytarish', () => {
    const ret = supplierReturns.create({
      supplier_id: supplierA.id,
      created_by: ADMIN,
      return_reason: 'defekt',
      items: [{ product_id: productShared.id, quantity: 3, unit_cost: 5000 }],
    });
    assert.ok(ret?.id);
    assert.strictEqual(Number(ret.total_amount), 15000);
    assert.strictEqual(stockOf(inventory, productShared.id), 14);

    const credit = db
      .prepare(
        `SELECT * FROM supplier_payments WHERE supplier_id = ? AND payment_method = 'credit_note' ORDER BY created_at DESC LIMIT 1`
      )
      .get(supplierA.id);
    assert.ok(credit, 'credit_note yozuvi kerak');
    assert.strictEqual(Number(credit.amount), 15000);

    const remA = supplierReturns.getReturnableQty(supplierA.id, productShared.id, WH);
    assert.strictEqual(remA, 7);

    const batchRemA = db
      .prepare(
        `
        SELECT COALESCE(SUM(remaining_qty), 0) AS qty
        FROM inventory_batches
        WHERE product_id = ? AND warehouse_id = ? AND supplier_id = ? AND remaining_qty > 0
      `
      )
      .get(productShared.id, WH, supplierA.id);
    assert.strictEqual(Number(batchRemA.qty), 7);
  });

  runStep('A qaytargandan keyin B returnable o‘zgarmasligi (7)', () => {
    const remB = supplierReturns.getReturnableQty(supplierB.id, productShared.id, WH);
    assert.strictEqual(remB, 7);
  });

  runStep('B ga shared 7 to‘liq qaytarish', () => {
    supplierReturns.create({
      supplier_id: supplierB.id,
      created_by: ADMIN,
      items: [{ product_id: productShared.id, quantity: 7, unit_cost: 5500 }],
    });
    assert.strictEqual(stockOf(inventory, productShared.id), 7);
    assert.strictEqual(supplierReturns.getReturnableQty(supplierB.id, productShared.id, WH), 0);
    assert.strictEqual(supplierReturns.getReturnableQty(supplierA.id, productShared.id, WH), 7);
  });

  // -------------------------------------------------------------------------
  // USD settlement: credit note must never store raw UZS as amount_usd
  // -------------------------------------------------------------------------
  const FX = 12800;
  exchangeRates.upsert({
    base_currency: 'USD',
    quote_currency: 'UZS',
    rate: FX,
    effective_date: today,
    source: 'smoke',
    created_by: ADMIN,
  });

  const usdSupplier = suppliers.create({
    name: 'Smoke Return USD',
    phone: '+998901111003',
    settlement_currency: 'USD',
  });

  const productUsd = products.create({
    name: 'USD Return Product',
    sku: `SR-USD-${Date.now()}`,
    sale_price: 200000,
    purchase_price: 1280000,
    track_stock: 1,
    current_stock: 0,
  });

  const poUsd = purchases.createOrder({
    supplier_id: usdSupplier.id,
    supplier_name: usdSupplier.name,
    order_date: today,
    status: 'approved',
    created_by: ADMIN,
    currency: 'USD',
    fx_rate: FX,
    items: [
      {
        product_id: productUsd.id,
        product_name: productUsd.name,
        ordered_qty: 5,
        unit_cost_usd: 100,
        line_total_usd: 500,
      },
    ],
  });
  purchases.receiveGoods(poUsd.id, {
    items: [
      {
        item_id: poUsd.items.find((it) => it.product_id === productUsd.id).id,
        product_id: productUsd.id,
        received_qty: 5,
      },
    ],
    received_by: ADMIN,
  });
  ok('setup: USD supplier PO 5×100 USD');

  runStep('listReturnable: USD unit_cost settlement currencyda (~100)', () => {
    const list = supplierReturns.listReturnableProducts({ supplier_id: usdSupplier.id });
    const row = list.find((p) => p.product_id === productUsd.id);
    assert.ok(row, 'product should be returnable');
    assert.strictEqual(String(row.settlement_currency || '').toUpperCase(), 'USD');
    assert.strictEqual(String(row.cost_currency || '').toUpperCase(), 'USD');
    assert.ok(Math.abs(Number(row.unit_cost) - 100) < 0.05, `unit_cost expected ~100 USD, got ${row.unit_cost}`);
    assert.ok(
      Number(row.unit_cost) < 1000,
      `unit_cost must not be raw UZS stuffed as USD (got ${row.unit_cost})`
    );
    assert.strictEqual(Number(row.returnable_qty), 5);
  });

  runStep('USD qaytarish: unit_cost_usd → credit_note amount_usd (not millions)', () => {
    const beforeBal = Number(suppliers.get(usdSupplier.id).balance);
    const ret = supplierReturns.create({
      supplier_id: usdSupplier.id,
      created_by: ADMIN,
      items: [
        {
          product_id: productUsd.id,
          quantity: 2,
          unit_cost: 100,
          unit_cost_usd: 100,
          cost_currency: 'USD',
        },
      ],
    });
    assert.ok(Math.abs(Number(ret.total_amount) - 200) < 0.05, `total_amount expected 200 USD, got ${ret.total_amount}`);
    assert.ok(Number(ret.total_amount) < 10000, 'total must not be UZS-scale');

    const credit = db
      .prepare(
        `SELECT * FROM supplier_payments WHERE supplier_id = ? AND payment_method = 'credit_note' ORDER BY created_at DESC LIMIT 1`
      )
      .get(usdSupplier.id);
    assert.ok(credit);
    assert.strictEqual(String(credit.currency || '').toUpperCase(), 'USD');
    assert.strictEqual(Number(credit.amount), 0);
    assert.ok(Math.abs(Number(credit.amount_usd) - 200) < 0.05, `amount_usd expected 200, got ${credit.amount_usd}`);
    assert.ok(Number(credit.amount_usd) < 10000, 'amount_usd must not be millions of so\'m labeled USD');

    const afterBal = Number(suppliers.get(usdSupplier.id).balance);
    assert.ok(
      Math.abs(afterBal - (beforeBal - 200)) < 0.05,
      `balance should drop by 200 USD: before=${beforeBal} after=${afterBal}`
    );
    assert.strictEqual(stockOf(inventory, productUsd.id), 3);
  });

  runStep('USD qaytarish: faqat UZS unit_cost + fx_rate → convert', () => {
    const ret = supplierReturns.create({
      supplier_id: usdSupplier.id,
      created_by: ADMIN,
      fx_rate: FX,
      items: [
        {
          product_id: productUsd.id,
          quantity: 1,
          unit_cost: 100 * FX, // UZS
          cost_currency: 'UZS',
        },
      ],
    });
    assert.ok(Math.abs(Number(ret.total_amount) - 100) < 0.05, `expected 100 USD, got ${ret.total_amount}`);
    const credit = db
      .prepare(
        `
        SELECT amount_usd, reference_number
        FROM supplier_payments
        WHERE supplier_id = ?
          AND payment_method = 'credit_note'
          AND reference_number = ?
      `
      )
      .get(usdSupplier.id, ret.return_number);
    assert.ok(credit, 'credit_note for this return missing');
    assert.ok(
      Math.abs(Number(credit.amount_usd) - 100) < 0.05,
      `amount_usd expected 100, got ${credit.amount_usd}`
    );
  });

  runStep('USD qaytarish: bog‘us unit_cost_usd (=UZS) sanitize + convert', () => {
    // Simulate legacy row where unit_cost_usd was stuffed with UZS amount.
    const uzsCost = 100 * FX;
    db.prepare(
      `UPDATE purchase_order_items SET unit_cost_usd = ? WHERE purchase_order_id = ? AND product_id = ?`
    ).run(uzsCost, poUsd.id, productUsd.id);

    const list = supplierReturns.listReturnableProducts({ supplier_id: usdSupplier.id, fx_rate: FX });
    const row = list.find((p) => p.product_id === productUsd.id);
    assert.ok(row);
    assert.ok(
      Math.abs(Number(row.unit_cost) - 100) < 1,
      `sanitized list unit_cost expected ~100 USD, got ${row.unit_cost}`
    );

    const ret = supplierReturns.create({
      supplier_id: usdSupplier.id,
      created_by: ADMIN,
      fx_rate: FX,
      items: [
        {
          product_id: productUsd.id,
          quantity: 1,
          // Client mistakenly sends UZS as unit_cost with cost_currency USD (the 40M bug path).
          unit_cost: uzsCost,
          cost_currency: 'USD',
        },
      ],
    });
    assert.ok(
      Math.abs(Number(ret.total_amount) - 100) < 1,
      `bogus USD input must convert via fx → ~100, got ${ret.total_amount}`
    );
    assert.ok(Number(ret.total_amount) < 1000, 'must not write millions as USD');
  });

  runStep('createReturnAll: USD supplier fills max qty in settlement currency', () => {
    const rem = supplierReturns.getReturnableQty(usdSupplier.id, productUsd.id, WH);
    assert.ok(rem > 0, 'still returnable qty left');
    const ret = supplierReturns.createReturnAll({
      supplier_id: usdSupplier.id,
      created_by: ADMIN,
      fx_rate: FX,
    });
    assert.ok(ret?.id);
    assert.ok(Number(ret.total_amount) < rem * 1000, 'return-all total must stay in USD scale');
    assert.ok(
      Math.abs(Number(ret.total_amount) - rem * 100) < rem + 1,
      `return-all expected ~${rem * 100} USD, got ${ret.total_amount}`
    );
    assert.strictEqual(supplierReturns.getReturnableQty(usdSupplier.id, productUsd.id, WH), 0);
  });

  console.log(`\nNatija: ${passed} o‘tdi, ${failed} yiqildi\n`);
  close();
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
  process.exit(failed > 0 ? 1 : 0);
} catch (err) {
  console.error('FATAL:', err);
  try {
    close();
  } catch {
    // ignore
  }
  process.exit(1);
}

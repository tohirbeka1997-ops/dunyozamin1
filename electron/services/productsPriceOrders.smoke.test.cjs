/* eslint-disable no-console */
/**
 * Mahsulot narxi o‘zgarishi → product_prices, qoralama buyurtma, yakuniy sotuv mosligi.
 *
 * Ishga tushirish: npm run test:products-smoke
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const WH = 'main-warehouse-001';
const ADMIN = 'default-admin-001';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-products-price-smoke-'));
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

function retailPrice(db, productId, unit = 'pcs') {
  const row = db
    .prepare(
      `
      SELECT pp.price
      FROM product_prices pp
      INNER JOIN price_tiers pt ON pt.id = pp.tier_id
      WHERE pp.product_id = ? AND pt.code = 'retail' AND pp.unit = ? AND pp.currency = 'UZS'
      LIMIT 1
    `,
    )
    .get(productId, unit);
  return row ? Number(row.price) : null;
}

console.log('\n=== MAHSULOT NARXI / BUYURTMA SMOKE TEST ===');
console.log(`Temp DB: ${tmpDir}\n`);

try {
  open();
  const db = getDb();
  const { products, inventory, sales, shifts } = createServices(db);

  const sku = `PRICE-SMOKE-${Date.now()}`;
  const product = products.create({
    name: 'Price Sync Smoke',
    sku,
    sale_price: 5000,
    purchase_price: 2000,
    track_stock: 1,
    product_units: [{ unit: 'pcs', ratio_to_base: 1, sale_price: 5000, is_default: true }],
  });
  inventory.adjustStock({
    warehouse_id: WH,
    adjustment_type: 'set',
    reason: 'Price smoke stock',
    created_by: ADMIN,
    items: [{ product_id: product.id, target_quantity: 100 }],
  });
  ok('mahsulot yaratildi (5000)');

  runStep('product_prices: boshlang‘ich retail 5000', () => {
    assert.strictEqual(retailPrice(db, product.id), 5000);
  });

  const shift = shifts.openShift({ user_id: ADMIN });
  const draft = sales.createDraftOrder({
    shift_id: shift.id,
    user_id: ADMIN,
    cashier_id: ADMIN,
  });
  sales.addItem(draft.id, {
    product_id: product.id,
    quantity: 2,
    qty_sale: 2,
  });
  const draftItem = db
    .prepare('SELECT unit_price, line_total FROM order_items WHERE order_id = ?')
    .get(draft.id);
  assert.strictEqual(Number(draftItem.unit_price), 5000);
  assert.strictEqual(Number(draftItem.line_total), 10000);
  ok('qoralama: addItem katalog narxi 5000');

  // Eski versiya holati: products yangilangan, product_prices eski qolgan
  db.prepare(
    `
    UPDATE products SET sale_price = 9000, updated_at = datetime('now') WHERE id = ?
  `,
  ).run(product.id);
  db.prepare(
    `
    UPDATE product_units SET sale_price = 9000 WHERE product_id = ? AND is_default = 1
  `,
  ).run(product.id);
  const retailId = db.prepare(`SELECT id FROM price_tiers WHERE code = 'retail'`).get()?.id;
  db.prepare(
    `
    UPDATE product_prices SET price = 5000, updated_at = datetime('now')
    WHERE product_id = ? AND tier_id = ? AND unit = 'pcs' AND currency = 'UZS'
  `,
  ).run(product.id, retailId);

  runStep('sintetik: product_prices hali 5000 (eskicha)', () => {
    assert.strictEqual(retailPrice(db, product.id), 5000);
    const row = db.prepare('SELECT sale_price FROM products WHERE id = ?').get(product.id);
    assert.strictEqual(Number(row.sale_price), 9000);
  });

  products.update(product.id, {
    sale_price: 9000,
    product_units: [{ unit: 'pcs', ratio_to_base: 1, sale_price: 9000, is_default: true }],
  });

  runStep('products.update: product_prices retail 9000', () => {
    assert.strictEqual(retailPrice(db, product.id), 9000);
  });

  runStep('qoralama qator narxi 9000 ga yangilandi', () => {
    const row = db
      .prepare('SELECT unit_price, line_total FROM order_items WHERE order_id = ?')
      .get(draft.id);
    assert.strictEqual(Number(row.unit_price), 9000);
    assert.strictEqual(Number(row.line_total), 18000);
    const hold = db.prepare('SELECT total_amount FROM orders WHERE id = ?').get(draft.id);
    assert.strictEqual(Number(hold.total_amount), 18000);
  });

  runStep('qo‘lda narx qoralamada saqlanadi', () => {
    const draftManual = sales.createDraftOrder({
      shift_id: shift.id,
      user_id: ADMIN,
      cashier_id: ADMIN,
    });
    sales.addItem(draftManual.id, {
      product_id: product.id,
      quantity: 1,
      qty_sale: 1,
      unit_price: 5500,
      price_source: 'manual',
    });
    products.update(product.id, {
      sale_price: 11000,
      product_units: [{ unit: 'pcs', ratio_to_base: 1, sale_price: 11000, is_default: true }],
    });
    const row = db
      .prepare('SELECT unit_price FROM order_items WHERE order_id = ?')
      .get(draftManual.id);
    assert.strictEqual(Number(row.unit_price), 5500);
  });

  products.update(product.id, {
    sale_price: 9000,
    product_units: [{ unit: 'pcs', ratio_to_base: 1, sale_price: 9000, is_default: true }],
  });

  runStep('completePOSOrder: product_prices bo‘yicha 9000 (unit_price yuborilmasa)', () => {
    const res = sales.completePOSOrder(
      { total_amount: 9000, shift_id: shift.id, user_id: ADMIN },
      [
        {
          product_id: product.id,
          product_name: product.name,
          quantity: 1,
          qty_sale: 1,
          qty_base: 1,
          line_total: 9000,
        },
      ],
      [{ payment_method: 'cash', amount: 9000 }],
    );
    const item = db
      .prepare('SELECT unit_price, line_total FROM order_items WHERE order_id = ?')
      .get(res.order_id);
    assert.strictEqual(Number(item.unit_price), 9000);
    assert.strictEqual(Number(item.line_total), 9000);
  });

  // --- Ommaviy narx yangilash (bulk) + orqaga qaytarish (undo) ---
  runStep('bulkAdjustPrices: sotuv narxi +10%', () => {
    const before = Number(
      db.prepare('SELECT sale_price FROM products WHERE id = ?').get(product.id).sale_price,
    );
    const res = products.bulkAdjustPrices(
      { product_ids: [product.id], field: 'sale', mode: 'percent', percent: 10 },
      { actorUserId: ADMIN },
    );
    assert.strictEqual(res.count, 1);
    const after = Number(
      db.prepare('SELECT sale_price FROM products WHERE id = ?').get(product.id).sale_price,
    );
    assert.strictEqual(after, Math.round(before * 1.1));
    // product_prices sinxron qoldi
    assert.strictEqual(retailPrice(db, product.id), after);
    // price_history batch yozildi (sale turi)
    const hist = db
      .prepare("SELECT COUNT(*) AS c FROM price_history WHERE batch_id = ? AND price_type = 'sale'")
      .get(res.batch_id);
    assert.strictEqual(Number(hist.c), 1);
  });

  runStep('bulkAdjustPrices: yaxlitlash 1000 ga', () => {
    products.update(product.id, {
      sale_price: 9870,
      product_units: [{ unit: 'pcs', ratio_to_base: 1, sale_price: 9870, is_default: true }],
    });
    const res = products.bulkAdjustPrices(
      { product_ids: [product.id], field: 'sale', mode: 'round', round_to: 1000 },
      { actorUserId: ADMIN },
    );
    assert.strictEqual(res.count, 1);
    const after = Number(
      db.prepare('SELECT sale_price FROM products WHERE id = ?').get(product.id).sale_price,
    );
    assert.strictEqual(after, 10000);
  });

  runStep('undoBulkPriceUpdate: oxirgi amal qaytdi (9870)', () => {
    const res = products.undoBulkPriceUpdate(null, { actorUserId: ADMIN });
    assert.strictEqual(res.reverted, 1);
    const after = Number(
      db.prepare('SELECT sale_price FROM products WHERE id = ?').get(product.id).sale_price,
    );
    assert.strictEqual(after, 9870);
    // batch yozuvlari o'chirildi
    const rows = db
      .prepare('SELECT COUNT(*) AS c FROM price_history WHERE batch_id = ?')
      .get(res.batch_id);
    assert.strictEqual(Number(rows.c), 0);
  });

  // --- Bug 1: qabul qilingan PO si bor mahsulotda tannarx ommaviy yangilash ---
  // getById() tannarxni qabul qilingan PO tannarxi bilan ustini yopadi; ommaviy
  // yangilash va price_history ASL (omborda saqlangan) ustun bilan ishlashi shart.
  runStep('bulkAdjustPrices(purchase): qabul qilingan PO bo‘lsa ham price_history yoziladi/undo', () => {
    const crypto = require('crypto');
    const poId = crypto.randomUUID();
    const poItemId = crypto.randomUUID();
    db.prepare(
      `INSERT INTO purchase_orders
         (id, po_number, warehouse_id, order_date, status, created_at, updated_at)
       VALUES (?, ?, ?, datetime('now'), 'received', datetime('now'), datetime('now'))`,
    ).run(poId, `PO-SMOKE-${Date.now()}`, WH);
    db.prepare(
      `INSERT INTO purchase_order_items
         (id, purchase_order_id, product_id, product_name, product_sku, ordered_qty, received_qty, unit_cost, line_total)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(poItemId, poId, product.id, product.name, sku, 10, 10, 7777, 77770);
    // PO to'g'ridan-to'g'ri DB ga yozildi — getById keshini bekor qilamiz,
    // shunda u qayta so'rov yuborib PO tannarxi bilan ustini yopadi.
    products.cacheService.invalidateProduct(product.id);

    // getById PO tannarxi bilan ustini yopadi (7777), RAW ustun esa 2000
    assert.strictEqual(Number(products.getById(product.id).purchase_price), 7777);
    const rawBefore = Number(
      db.prepare('SELECT purchase_price FROM products WHERE id = ?').get(product.id).purchase_price,
    );
    assert.strictEqual(rawBefore, 2000);

    const res = products.bulkAdjustPrices(
      { product_ids: [product.id], field: 'purchase', mode: 'set', exact_price: 3000 },
      { actorUserId: ADMIN },
    );
    assert.strictEqual(res.count, 1);
    // RAW ustun yangilandi
    const rawAfter = Number(
      db.prepare('SELECT purchase_price FROM products WHERE id = ?').get(product.id).purchase_price,
    );
    assert.strictEqual(rawAfter, 3000);
    // price_history RAW qiymatlar bilan yozildi (PO override emas)
    const hist = db
      .prepare(
        "SELECT old_price, new_price FROM price_history WHERE batch_id = ? AND price_type = 'purchase'",
      )
      .get(res.batch_id);
    assert.ok(hist, 'purchase price_history yozuvi mavjud bo‘lishi kerak');
    assert.strictEqual(Number(hist.old_price), 2000);
    assert.strictEqual(Number(hist.new_price), 3000);
    // undo RAW ustunni 2000 ga qaytaradi
    const undo = products.undoBulkPriceUpdate(res.batch_id, { actorUserId: ADMIN });
    assert.strictEqual(undo.reverted, 1);
    assert.strictEqual(undo.skipped, 0);
    const rawReverted = Number(
      db.prepare('SELECT purchase_price FROM products WHERE id = ?').get(product.id).purchase_price,
    );
    assert.strictEqual(rawReverted, 2000);
  });

  // --- Bug 2: ommaviy amaldan keyin qo'lda tahrir → undo o'tkazib yuboradi ---
  runStep('undoBulkPriceUpdate: qo‘lda tahrirlangan qator o‘tkazib yuboriladi (skipped)', () => {
    const res = products.bulkAdjustPrices(
      { product_ids: [product.id], field: 'sale', mode: 'set', exact_price: 12000 },
      { actorUserId: ADMIN },
    );
    assert.strictEqual(res.count, 1);
    // Ommaviy amaldan KEYIN qo'lda boshqa narx qo'yamiz
    products.update(product.id, {
      sale_price: 13500,
      product_units: [{ unit: 'pcs', ratio_to_base: 1, sale_price: 13500, is_default: true }],
    });
    const undo = products.undoBulkPriceUpdate(res.batch_id, { actorUserId: ADMIN });
    assert.strictEqual(undo.reverted, 0);
    assert.strictEqual(undo.skipped, 1);
    // Qo'lda qo'yilgan narx saqlanib qoldi (undo bosib ketmadi)
    const after = Number(
      db.prepare('SELECT sale_price FROM products WHERE id = ?').get(product.id).sale_price,
    );
    assert.strictEqual(after, 13500);
  });

  close();
} catch (e) {
  fail('setup / teardown', e);
  try {
    close();
  } catch {
    /* ignore */
  }
}

console.log(`\n=== NATIJA: ${passed} OK, ${failed} FAIL ===\n`);
process.exit(failed > 0 ? 1 : 0);

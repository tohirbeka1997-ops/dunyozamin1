/* eslint-disable no-console */
/**
 * salesIdempotency.smoke.test.cjs
 *
 * POS checkout idempotency guard (Task 1):
 *   - Same `order_uuid` (idempotency key) sent twice → exactly ONE order is
 *     created, stock is decremented ONCE, and the second call returns the SAME
 *     order (success), not a duplicate or an error.
 *   - A different key creates a separate order (no false dedup).
 *   - Missing key still works (server generates one) and does not dedup across
 *     independent sales.
 *
 * Ishga tushirish: npm run test:idempotency-smoke
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const WH = 'main-warehouse-001';
const ADMIN = 'default-admin-001';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-idem-smoke-'));
process.env.POS_SERVER_MODE = '1';
process.env.POS_DATA_DIR = tmpDir;
process.env.POS_VERBOSE_LOGS = '0';

const { open, close, getDb } = require('../db/open.cjs');
const { createServices } = require('./index.cjs');

function stockOf(inventory, productId) {
  return Number(inventory.getCurrentStock(productId, WH)) || 0;
}

function cartLine(product, { qtySale, unitPrice = 1000, discount = 0 }) {
  const lineTotal = unitPrice * qtySale - discount;
  return {
    product_id: product.id,
    product_name: product.name,
    quantity: qtySale,
    qty_sale: qtySale,
    qty_base: qtySale,
    unit_price: unitPrice,
    line_total: lineTotal,
    discount_amount: discount,
  };
}

let passed = 0;
let failed = 0;
function ok(name) {
  passed += 1;
  console.log(`  \u2713 ${name}`);
}
function fail(name, err) {
  failed += 1;
  console.log(`  \u2717 ${name}`);
  console.log(`     ${err && err.message ? err.message : err}`);
}

function ordersWithUuid(db, uuid) {
  return Number(
    db.prepare('SELECT COUNT(*) AS c FROM orders WHERE order_uuid = ?').get(uuid).c,
  );
}

try {
  console.log('\n=== SALE IDEMPOTENCY SMOKE TEST ===');
  console.log(`Temp DB: ${tmpDir}\n`);

  open();
  const db = getDb();

  // Sanity: the UNIQUE index that backs the idempotency guard must exist
  // (migration 094 / original order_uuid migration).
  const idx = db
    .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_orders_order_uuid'")
    .get();
  assert.ok(idx, 'idx_orders_order_uuid UNIQUE index must exist');
  ok('UNIQUE index idx_orders_order_uuid mavjud');

  const { products, inventory, sales, shifts } = createServices(db);

  const product = products.create({
    name: 'Idem Smoke A',
    sku: `IDEM-A-${Date.now()}`,
    sale_price: 1000,
    track_stock: 1,
    current_stock: 0,
  });
  inventory.adjustStock({
    warehouse_id: WH,
    adjustment_type: 'set',
    reason: 'Idem smoke initial',
    created_by: ADMIN,
    items: [{ product_id: product.id, target_quantity: 10 }],
  });
  const shift = shifts.openShift({ user_id: ADMIN });
  assert.strictEqual(stockOf(inventory, product.id), 10);
  ok("mahsulot + boshlang'ich qoldiq (10)");

  // --- 1) Same key twice → one order, stock once, same order returned ---
  const key = `idem-key-${Date.now()}`;
  const items = [cartLine(product, { qtySale: 2 })];
  const total = 2000;

  const first = sales.completePOSOrder(
    { total_amount: total, shift_id: shift.id, user_id: ADMIN, order_uuid: key },
    items,
    [{ payment_method: 'cash', amount: total }],
  );
  assert.ok(first && first.order_id, 'first sale should create an order');
  assert.strictEqual(stockOf(inventory, product.id), 8, 'stock 10 - 2 = 8 after first');

  const second = sales.completePOSOrder(
    { total_amount: total, shift_id: shift.id, user_id: ADMIN, order_uuid: key },
    items,
    [{ payment_method: 'cash', amount: total }],
  );
  assert.ok(second && second.order_id, 'second sale must return an order (success, not error)');
  assert.strictEqual(second.order_id, first.order_id, 'second call returns the SAME order_id');
  assert.strictEqual(stockOf(inventory, product.id), 8, 'stock NOT decremented twice (still 8)');
  assert.strictEqual(ordersWithUuid(db, key), 1, 'exactly ONE order row for the key');
  ok('bir xil order_uuid 2 marta \u2192 bitta buyurtma, stok bir marta, ayni order qaytdi');

  // --- 2) Different key → separate order, stock decremented again ---
  const key2 = `idem-key-${Date.now()}-B`;
  const third = sales.completePOSOrder(
    { total_amount: 1000, shift_id: shift.id, user_id: ADMIN, order_uuid: key2 },
    [cartLine(product, { qtySale: 1 })],
    [{ payment_method: 'cash', amount: 1000 }],
  );
  assert.ok(third && third.order_id);
  assert.notStrictEqual(third.order_id, first.order_id, 'different key → different order');
  assert.strictEqual(stockOf(inventory, product.id), 7, 'stock 8 - 1 = 7 (new sale counted)');
  assert.strictEqual(ordersWithUuid(db, key2), 1);
  ok('boshqa order_uuid \u2192 alohida buyurtma, stok yana kamaydi');

  // --- 3) Missing key still works and does not dedup independent sales ---
  const noKey1 = sales.completePOSOrder(
    { total_amount: 1000, shift_id: shift.id, user_id: ADMIN },
    [cartLine(product, { qtySale: 1 })],
    [{ payment_method: 'cash', amount: 1000 }],
  );
  const noKey2 = sales.completePOSOrder(
    { total_amount: 1000, shift_id: shift.id, user_id: ADMIN },
    [cartLine(product, { qtySale: 1 })],
    [{ payment_method: 'cash', amount: 1000 }],
  );
  assert.ok(noKey1 && noKey1.order_id);
  assert.ok(noKey2 && noKey2.order_id);
  assert.notStrictEqual(noKey1.order_id, noKey2.order_id, 'no-key sales are independent');
  assert.strictEqual(stockOf(inventory, product.id), 5, 'stock 7 - 1 - 1 = 5');
  ok("kalitsiz sotuvlar mustaqil (server o'zi uuid beradi)");

  console.log(`\n=== NATIJA: ${passed} OK, ${failed} FAIL ===\n`);
  process.exit(failed > 0 ? 1 : 0);
} catch (e) {
  fail('sale idempotency suite', e);
  console.log(`\n=== NATIJA: ${passed} OK, ${failed} FAIL ===\n`);
  process.exit(1);
} finally {
  try {
    close();
  } catch {
    /* ignore */
  }
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

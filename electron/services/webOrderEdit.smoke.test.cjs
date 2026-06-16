/* eslint-disable no-console */
/**
 * webOrderEdit.smoke.test.cjs
 * Onlayn buyurtmalar — tahrir (WebOrdersService.update, POS UI bilan bir xil maydonlar).
 *
 * Ishga tushirish: npm run test:web-order-edit-smoke
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const WH = 'main-warehouse-001';
const ADMIN = 'default-admin-001';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-web-edit-smoke-'));
process.env.POS_SERVER_MODE = '1';
process.env.POS_DATA_DIR = tmpDir;
process.env.POS_VERBOSE_LOGS = '0';

const { open, close, getDb } = require('../db/open.cjs');
const { createServices } = require('./index.cjs');
const WebOrdersService = require('./webOrdersService.cjs');
const { createOrder, parseCreateBody } = require('../../public-api/routes/orders.cjs');
const { hasShowInMarketplaceColumn } = require('../../public-api/lib/productVisibility.cjs');

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

function expectThrows(fn, pattern) {
  let threw = false;
  let msg = '';
  try {
    fn();
  } catch (e) {
    threw = true;
    msg = String(e.message || e);
  }
  assert.ok(threw, 'expected error');
  if (pattern) assert.match(msg, pattern);
}

function seedCustomer(db, first = 'Eski', phone = '+998901112233') {
  const now = new Date().toISOString();
  const r = db
    .prepare(
      `INSERT INTO marketplace_customers (telegram_id, first_name, last_name, phone, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(910000 + Math.floor(Math.random() * 100000), first, 'Familiya', phone, now);
  return Number(r.lastInsertRowid);
}

function makeCourierOrder(db, customerId, productId, qty = 1) {
  const body = parseCreateBody({
    items: [{ product_id: productId, quantity: qty }],
    payment_method: 'cash',
    delivery_method: 'courier',
    delivery_address: 'Toshkent, Chilonzor 1',
    phone: '+998901112233',
    note: 'boshlang\'ich izoh',
  });
  return createOrder(db, customerId, body);
}

console.log('\n=== WEB ORDER EDIT SMOKE TEST ===');
console.log(`Temp DB: ${tmpDir}\n`);

try {
  open();
  const db = getDb();
  const { products, inventory } = createServices(db);
  const webOrders = new WebOrdersService(db);

  const product = products.create({
    name: 'Edit Smoke Product',
    sku: `EDIT-SMOKE-${Date.now()}`,
    sale_price: 3000,
    purchase_price: 1000,
    track_stock: 1,
    current_stock: 0,
  });
  if (hasShowInMarketplaceColumn(db)) {
    db.prepare(`UPDATE products SET show_in_marketplace = 1 WHERE id = ?`).run(product.id);
  }
  inventory.adjustStock({
    warehouse_id: WH,
    reason: 'Edit smoke stock',
    adjustment_type: 'set',
    created_by: ADMIN,
    items: [{ product_id: product.id, target_quantity: 10 }],
  });

  const customerId = seedCustomer(db);
  const created = makeCourierOrder(db, customerId, product.id);
  const orderId = Number(created.order_id);
  ok(`buyurtma yaratildi (id=${orderId})`);

  runStep('tahrir: ism, telefon, manzil, izoh (UI kabi)', () => {
    const updated = webOrders.update(orderId, {
      first_name: 'Yangi',
      last_name: 'Mijoz',
      phone: '+998909998877',
      delivery_address: 'Toshkent, Yunusobod 42',
      delivery_method: 'courier',
      note: 'yangilangan izoh',
    });
    assert.strictEqual(updated.first_name, 'Yangi');
    assert.strictEqual(updated.last_name, 'Mijoz');
    assert.strictEqual(updated.phone, '+998909998877');
    assert.strictEqual(updated.delivery_address, 'Toshkent, Yunusobod 42');
    assert.strictEqual(updated.note, 'yangilangan izoh');

    const cust = db.prepare(`SELECT first_name, last_name, phone FROM marketplace_customers WHERE id = ?`).get(customerId);
    assert.strictEqual(cust.first_name, 'Yangi');
    assert.strictEqual(cust.last_name, 'Mijoz');
    assert.strictEqual(cust.phone, '+998909998877');
  });

  runStep('tahrir: pickup ga o\'tkazish', () => {
    const updated = webOrders.update(orderId, {
      delivery_method: 'pickup',
      delivery_address: "O'zi olib ketish",
    });
    assert.strictEqual(String(updated.delivery_method).toLowerCase(), 'pickup');
    assert.strictEqual(updated.delivery_address, "O'zi olib ketish");
  });

  runStep('tahrir: pickup dan courier ga (to\'g\'ri manzil bilan)', () => {
    const updated = webOrders.update(orderId, {
      delivery_method: 'courier',
      delivery_address: 'Samarqand, Registon 5',
    });
    assert.strictEqual(String(updated.delivery_method).toLowerCase(), 'courier');
    assert.strictEqual(updated.delivery_address, 'Samarqand, Registon 5');
  });

  runStep('tahrir: faqat telefon (qisman)', () => {
    const updated = webOrders.update(orderId, { phone: '+998901234567' });
    assert.strictEqual(updated.phone, '+998901234567');
  });

  runStep('xato: maydon berilmagan', () => {
    expectThrows(() => webOrders.update(orderId, {}), /editable fields|No editable/i);
  });

  runStep('xato: courier uchun noto\'g\'ri manzil', () => {
    expectThrows(
      () =>
        webOrders.update(orderId, {
          delivery_method: 'courier',
          delivery_address: "O'zi olib ketish",
        }),
      /delivery address|Courier orders/i,
    );
  });

  runStep('xato: izoh juda uzun', () => {
    expectThrows(() => webOrders.update(orderId, { note: 'x'.repeat(2001) }), /too long/i);
  });

  runStep('xato: buyurtma topilmadi', () => {
    expectThrows(() => webOrders.update(999999, { note: 'test' }), /not found/i);
  });

  const customerId2 = seedCustomer(db, 'Pickup', '+998901111111');
  const pickupCreated = createOrder(
    db,
    customerId2,
    parseCreateBody({
      items: [{ product_id: product.id, quantity: 1 }],
      payment_method: 'cash',
      delivery_method: 'pickup',
      delivery_address: "O'zi olib ketish",
    }),
  );
  const pickupId = Number(pickupCreated.order_id);

  runStep('pickup buyurtmada faqat izoh tahriri', () => {
    const updated = webOrders.update(pickupId, { note: 'pickup izoh yangi' });
    assert.strictEqual(updated.note, 'pickup izoh yangi');
    assert.strictEqual(String(updated.delivery_method).toLowerCase(), 'pickup');
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

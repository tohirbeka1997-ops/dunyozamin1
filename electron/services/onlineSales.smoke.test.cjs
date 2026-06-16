/* eslint-disable no-console */
/**
 * onlineSales.smoke.test.cjs
 * Onlayn savdo: public-api (Mini App API) + WebOrdersService + createOrder + ombor rezerv/fulfill/cancel.
 *
 * Ishga tushirish: npm run test:online-smoke
 */
'use strict';

const assert = require('assert');
const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const WH = 'main-warehouse-001';
const ADMIN = 'default-admin-001';

const repoRoot = path.join(__dirname, '../..');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-online-smoke-'));
process.env.POS_SERVER_MODE = '1';
process.env.POS_DATA_DIR = tmpDir;
process.env.POS_VERBOSE_LOGS = '0';
delete process.env.TELEGRAM_BOT_TOKEN;

const { open, close, getDb } = require('../db/open.cjs');
const { createServices } = require('./index.cjs');
const WebOrdersService = require('./webOrdersService.cjs');
const { createOrder, parseCreateBody } = require('../../public-api/routes/orders.cjs');
const { getAvailableStock } = require('../../public-api/lib/stockHelpers.cjs');
const { isValidTransition } = require('../../public-api/lib/webOrderStatusFlow.cjs');
const { hasShowInMarketplaceColumn } = require('../../public-api/lib/productVisibility.cjs');
const { isOrderStockFulfilled } = require('../../public-api/lib/stockDecrement.cjs');

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

function runStep(name, fn) {
  try {
    fn();
    ok(name);
  } catch (e) {
    fail(name, e);
  }
}

function hasCol(db, table, col) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col);
}

function reservedQty(db, productId) {
  const row = db
    .prepare(`SELECT COALESCE(reserved_quantity, 0) AS rq FROM stock_balances WHERE product_id = ? AND warehouse_id = ?`)
    .get(productId, WH);
  return Number(row?.rq || 0);
}

function seedMarketplaceCustomer(db) {
  const now = new Date().toISOString();
  const r = db
    .prepare(
      `INSERT INTO marketplace_customers (telegram_id, first_name, phone, created_at)
       VALUES (?, ?, ?, ?)`,
    )
    .run(900001 + Math.floor(Math.random() * 100000), 'Smoke', '+998901112233', now);
  return Number(r.lastInsertRowid);
}

function makeOrderBody(productId, qty, deliveryMethod) {
  return parseCreateBody({
    items: [{ product_id: productId, quantity: qty }],
    payment_method: 'cash',
    delivery_method: deliveryMethod,
    delivery_address: deliveryMethod === 'pickup' ? "O'zi olib ketish" : 'Toshkent, smoke test 12',
    phone: '+998901112233',
    note: 'online smoke',
  });
}

console.log('\n=== ONLINE SALES SMOKE TEST ===\n');

console.log('--- Phase A: public-api unit tests ---');
try {
  const out = execSync('npm run test --prefix public-api', {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const m = out.match(/# tests (\d+)/);
  const mPass = out.match(/# pass (\d+)/);
  const mFail = out.match(/# fail (\d+)/);
  const total = m ? Number(m[1]) : 0;
  const pass = mPass ? Number(mPass[1]) : 0;
  const failN = mFail ? Number(mFail[1]) : 0;
  if (failN > 0) {
    fail(`public-api (${pass}/${total} pass)`, new Error(`${failN} failed`));
    console.log(out.slice(-2000));
  } else {
    ok(`public-api (${pass}/${total} tests)`);
  }
} catch (e) {
  fail('public-api suite', e);
  if (e.stdout) console.log(String(e.stdout).slice(-1500));
  if (e.stderr) console.log(String(e.stderr).slice(-800));
}

console.log('\n--- Phase B: WebOrders + createOrder (Electron DB) ---');
console.log(`Temp DB dir: ${tmpDir}\n`);

try {
  open();
  const db = getDb();
  const { products, inventory } = createServices(db);
  const webOrders = new WebOrdersService(db);

  const sku = `ONLINE-SMOKE-${Date.now()}`;
  const product = products.create({
    name: 'Online Smoke Product',
    sku,
    sale_price: 5000,
    purchase_price: 2000,
    track_stock: 1,
    current_stock: 0,
  });
  const productId = product.id;
  ok('create product');

  if (hasShowInMarketplaceColumn(db)) {
    db.prepare(`UPDATE products SET show_in_marketplace = 1 WHERE id = ?`).run(productId);
    ok('show_in_marketplace = 1');
  }

  inventory.adjustStock({
    warehouse_id: WH,
    reason: 'Online smoke: boshlang\'ich',
    adjustment_type: 'set',
    created_by: ADMIN,
    items: [{ product_id: productId, target_quantity: 20 }],
  });
  assert.strictEqual(getAvailableStock(db, productId), 20);
  ok('omborda 20 dona');

  const customerId = seedMarketplaceCustomer(db);
  ok('marketplace customer');

  runStep('status flow: pickup delivered path valid', () => {
    assert.strictEqual(isValidTransition('new', 'processing', { deliveryMethod: 'pickup' }), true);
    assert.strictEqual(isValidTransition('ready', 'delivered', { deliveryMethod: 'pickup' }), true);
    assert.strictEqual(isValidTransition('delivered', 'processing', { deliveryMethod: 'pickup' }), false);
  });

  const availBefore = getAvailableStock(db, productId);
  const pickupBody = makeOrderBody(productId, 3, 'pickup');
  const created = createOrder(db, customerId, pickupBody);
  assert.ok(created.order_id, 'order_id');
  assert.strictEqual(created.status, 'new');
  assert.strictEqual(created.delivery_method, 'pickup');
  const orderId = Number(created.order_id);
  ok(`createOrder pickup (id=${orderId})`);

  runStep('reserve: available kamayadi', () => {
    assert.strictEqual(reservedQty(db, productId), 3);
    assert.ok(getAvailableStock(db, productId) < availBefore);
  });

  runStep('list incoming queue', () => {
    const list = webOrders.list({ queue: 'incoming', limit: 50 });
    assert.ok(Array.isArray(list.data));
    assert.ok(list.data.some((o) => Number(o.id) === orderId));
    assert.ok(list.meta && typeof list.meta.total === 'number');
  });

  runStep('countsByQueue', () => {
    const counts = webOrders.countsByQueue();
    assert.ok(typeof counts.incoming === 'number');
    assert.ok(counts.incoming >= 1);
  });

  runStep('get order detail', () => {
    const row = webOrders.get(orderId);
    assert.ok(row);
    assert.strictEqual(String(row.status).toLowerCase(), 'new');
    assert.ok(Array.isArray(row.items) && row.items.length === 1);
  });

  runStep('updateStatus rejects invalid transition', () => {
    let threw = false;
    try {
      webOrders.updateStatus(orderId, 'delivered');
    } catch (e) {
      threw = true;
      assert.match(String(e.message || e), /invalid status transition/i);
    }
    assert.ok(threw, 'expected invalid transition error');
  });

  runStep('pickup workflow → delivered', () => {
    webOrders.updateStatus(orderId, 'processing');
    assert.strictEqual(isOrderStockFulfilled(db, orderId), true);
    const balAfterFulfill = db
      .prepare(`SELECT quantity, reserved_quantity FROM stock_balances WHERE product_id = ? AND warehouse_id = ?`)
      .get(productId, WH);
    assert.strictEqual(Number(balAfterFulfill.quantity), 17);
    assert.strictEqual(Number(balAfterFulfill.reserved_quantity), 0);

    webOrders.updateStatus(orderId, 'ready');
    const delivered = webOrders.updateStatus(orderId, 'delivered');
    assert.strictEqual(String(delivered.status).toLowerCase(), 'delivered');
    assert.strictEqual(String(delivered.payment_status).toLowerCase(), 'paid');
    assert.strictEqual(getAvailableStock(db, productId), 17);
  });

  const customerId2 = seedMarketplaceCustomer(db);
  const courierBody = makeOrderBody(productId, 2, 'courier');
  const courierCreated = createOrder(db, customerId2, courierBody);
  const courierId = Number(courierCreated.order_id);
  ok(`createOrder courier (id=${courierId})`);

  runStep('courier workflow → out_for_delivery → delivered', () => {
    webOrders.updateStatus(courierId, 'processing');
    webOrders.updateStatus(courierId, 'ready');
    webOrders.updateStatus(courierId, 'out_for_delivery');
    const done = webOrders.updateStatus(courierId, 'delivered');
    assert.strictEqual(String(done.status).toLowerCase(), 'delivered');
    assert.strictEqual(getAvailableStock(db, productId), 15);
  });

  const customerId3 = seedMarketplaceCustomer(db);
  const availBeforeNewOrder = getAvailableStock(db, productId);
  const cancelCreated = createOrder(db, customerId3, makeOrderBody(productId, 2, 'pickup'));
  const cancelId = Number(cancelCreated.order_id);

  runStep('cancel before processing → rezerv qaytadi', () => {
    assert.strictEqual(reservedQty(db, productId), 2);
    assert.strictEqual(getAvailableStock(db, productId), availBeforeNewOrder - 2);
    const cancelled = webOrders.cancel(cancelId);
    assert.strictEqual(String(cancelled.status).toLowerCase(), 'cancelled');
    assert.strictEqual(reservedQty(db, productId), 0);
    assert.strictEqual(getAvailableStock(db, productId), availBeforeNewOrder);
  });

  runStep('delivered buyurtmani bekor qilib bo‘lmaydi', () => {
    let threw = false;
    try {
      webOrders.cancel(orderId);
    } catch (e) {
      threw = true;
      assert.match(String(e.message || e), /cannot be cancelled|bekor/i);
    }
    assert.ok(threw, 'expected validation error');
  });

  runStep('insufficient_stock (createOrder)', () => {
    const customerId4 = seedMarketplaceCustomer(db);
    let threw = false;
    try {
      createOrder(db, customerId4, makeOrderBody(productId, 9999, 'pickup'));
    } catch (e) {
      threw = true;
      assert.match(String(e.message || e.code || e), /insufficient|stock/i);
    }
    assert.ok(threw);
  });

  runStep('reportSummary', () => {
    const summary = webOrders.reportSummary({ days: 30 });
    assert.ok(Array.isArray(summary.by_status));
    assert.ok(summary.totals && typeof summary.totals.orders === 'number');
    assert.ok(summary.totals.orders >= 2);
  });

  runStep('marketplace catalog SQL (faol + ko\'rinadigan)', () => {
    const mpCol = hasShowInMarketplaceColumn(db);
    const sql = mpCol
      ? `SELECT COUNT(*) AS n FROM products WHERE is_active = 1 AND show_in_marketplace = 1 AND id = ?`
      : `SELECT COUNT(*) AS n FROM products WHERE is_active = 1 AND id = ?`;
    const n = Number(db.prepare(sql).get(productId).n || 0);
    assert.strictEqual(n, 1);
  });

  console.log('\n--- Phase C: multi-tenant DB path (public-api ↔ POS admin) ---');
  runStep('resolvePosDbPath uses tenant DB when POS_MULTI_TENANT=1', () => {
    const { resolvePosDbPath } = require('../lib/resolvePosDbPath.cjs');
    const mtDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-online-mt-'));
    const tenantDbPath = path.join(mtDir, 'tenants', 'default', 'pos.db');
    fs.mkdirSync(path.dirname(tenantDbPath), { recursive: true });
    fs.writeFileSync(path.join(mtDir, 'master.db'), '');
    fs.copyFileSync(path.join(tmpDir, 'pos.db'), tenantDbPath);

    const prevMt = process.env.POS_MULTI_TENANT;
    const prevDir = process.env.POS_DATA_DIR;
    const prevExplicit = process.env.PUBLIC_API_DB_PATH;
    process.env.POS_MULTI_TENANT = '1';
    process.env.POS_DATA_DIR = mtDir;
    delete process.env.PUBLIC_API_DB_PATH;
    try {
      assert.strictEqual(resolvePosDbPath(), tenantDbPath);
      const tenantDb = require('better-sqlite3')(tenantDbPath, { readonly: true });
      const orderCount = Number(
        tenantDb.prepare(`SELECT COUNT(*) AS n FROM web_orders`).get().n || 0,
      );
      tenantDb.close();
      assert.ok(orderCount >= 2, 'tenant DB should contain orders from Phase B');
    } finally {
      if (prevMt == null) delete process.env.POS_MULTI_TENANT;
      else process.env.POS_MULTI_TENANT = prevMt;
      if (prevDir == null) delete process.env.POS_DATA_DIR;
      else process.env.POS_DATA_DIR = prevDir;
      if (prevExplicit == null) delete process.env.PUBLIC_API_DB_PATH;
      else process.env.PUBLIC_API_DB_PATH = prevExplicit;
    }
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

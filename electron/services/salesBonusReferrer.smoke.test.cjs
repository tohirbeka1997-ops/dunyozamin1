/* eslint-disable no-console */
/**
 * salesBonusReferrer.smoke.test.cjs — bonus points route to usta (bonus_referrer_customer_id).
 *
 * Ishga tushirish: npm run test:bonus-referrer-smoke
 */
'use strict';

const assert = require('assert');
const Database = require('better-sqlite3');
const SalesService = require('./salesService.cjs');

function createSalesDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE settings (
      id TEXT PRIMARY KEY,
      key TEXT UNIQUE,
      value TEXT
    );
    CREATE TABLE customers (
      id TEXT PRIMARY KEY,
      pricing_tier TEXT DEFAULT 'retail',
      bonus_points REAL DEFAULT 0,
      updated_at TEXT
    );
    CREATE TABLE customer_bonus_ledger (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      type TEXT NOT NULL,
      points REAL NOT NULL,
      order_id TEXT,
      note TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_by TEXT
    );
    CREATE TABLE orders (id TEXT PRIMARY KEY);
  `);
  db.prepare(`INSERT INTO customers (id, pricing_tier, bonus_points) VALUES ('c-buyer', 'retail', 0)`).run();
  db.prepare(`INSERT INTO customers (id, pricing_tier, bonus_points) VALUES ('c-usta', 'master', 0)`).run();
  db.prepare(
    `INSERT INTO settings (id, key, value) VALUES
      ('g1', 'loyalty.general.enabled', '1'),
      ('g2', 'loyalty.earn.scope', 'all_customers'),
      ('g3', 'loyalty.earn.points_per_uzs', '1000'),
      ('g4', 'loyalty.earn.min_order_uzs', '0')`,
  ).run();
  return db;
}

let passed = 0;
let failed = 0;

function run(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  OK  ${name}`);
  } catch (e) {
    failed += 1;
    console.error(`  FAIL ${name}:`, e?.message || e);
  }
}

run('without referrer: buyer earns bonus', () => {
  const db = createSalesDb();
  const sales = new SalesService(db);
  const now = new Date().toISOString();
  sales._accrueCustomerLoyalty({
    customerId: 'c-buyer',
    bonusReferrerCustomerId: null,
    paidAmount: 5000,
    orderTotalAmount: 5000,
    orderId: 'ord-1',
    orderNumber: 'S-001',
    createdBy: null,
    now,
    skipWalkInCustomerId: 'default-customer-001',
  });
  const buyer = db.prepare(`SELECT bonus_points FROM customers WHERE id = 'c-buyer'`).get();
  const usta = db.prepare(`SELECT bonus_points FROM customers WHERE id = 'c-usta'`).get();
  assert.strictEqual(Number(buyer.bonus_points), 5);
  assert.strictEqual(Number(usta.bonus_points), 0);
});

run('with usta referrer: usta earns, buyer does not', () => {
  const db = createSalesDb();
  const sales = new SalesService(db);
  const now = new Date().toISOString();
  sales._accrueCustomerLoyalty({
    customerId: 'c-buyer',
    bonusReferrerCustomerId: 'c-usta',
    paidAmount: 8000,
    orderTotalAmount: 8000,
    orderId: 'ord-2',
    orderNumber: 'S-002',
    createdBy: null,
    now,
    skipWalkInCustomerId: 'default-customer-001',
  });
  const buyer = db.prepare(`SELECT bonus_points FROM customers WHERE id = 'c-buyer'`).get();
  const usta = db.prepare(`SELECT bonus_points FROM customers WHERE id = 'c-usta'`).get();
  assert.strictEqual(Number(buyer.bonus_points), 0);
  assert.strictEqual(Number(usta.bonus_points), 8);
  const ledger = db
    .prepare(
      `SELECT note FROM customer_bonus_ledger WHERE customer_id = 'c-usta' AND order_id = 'ord-2'`,
    )
    .get();
  assert.ok(String(ledger?.note || '').includes('Usta bonus'));
});

run('walk-in buyer + usta referrer: usta still earns', () => {
  const db = createSalesDb();
  const sales = new SalesService(db);
  const now = new Date().toISOString();
  sales._accrueCustomerLoyalty({
    customerId: 'default-customer-001',
    bonusReferrerCustomerId: 'c-usta',
    paidAmount: 3000,
    orderTotalAmount: 3000,
    orderId: 'ord-3',
    orderNumber: 'S-003',
    createdBy: null,
    now,
    skipWalkInCustomerId: 'default-customer-001',
  });
  const usta = db.prepare(`SELECT bonus_points FROM customers WHERE id = 'c-usta'`).get();
  assert.strictEqual(Number(usta.bonus_points), 3);
});

run('credit sale with usta referrer: earns on order total (not paid)', () => {
  const db = createSalesDb();
  const sales = new SalesService(db);
  const now = new Date().toISOString();
  sales._accrueCustomerLoyalty({
    customerId: 'c-buyer',
    bonusReferrerCustomerId: 'c-usta',
    paidAmount: 0,
    orderTotalAmount: 12000,
    orderId: 'ord-credit',
    orderNumber: 'S-CR',
    createdBy: null,
    now,
    skipWalkInCustomerId: 'default-customer-001',
  });
  const usta = db.prepare(`SELECT bonus_points FROM customers WHERE id = 'c-usta'`).get();
  assert.strictEqual(Number(usta.bonus_points), 12);
});

run('buyer without referrer on credit: no earn when paid is zero', () => {
  const db = createSalesDb();
  const sales = new SalesService(db);
  const now = new Date().toISOString();
  sales._accrueCustomerLoyalty({
    customerId: 'c-buyer',
    bonusReferrerCustomerId: null,
    paidAmount: 0,
    orderTotalAmount: 12000,
    orderId: 'ord-buyer-credit',
    orderNumber: 'S-BC',
    createdBy: null,
    now,
    skipWalkInCustomerId: 'default-customer-001',
  });
  const buyer = db.prepare(`SELECT bonus_points FROM customers WHERE id = 'c-buyer'`).get();
  assert.strictEqual(Number(buyer.bonus_points), 0);
});

console.log(`\n=== NATIJA: ${passed} OK, ${failed} FAIL ===\n`);
process.exit(failed > 0 ? 1 : 0);

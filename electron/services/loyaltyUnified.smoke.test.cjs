/* eslint-disable no-console */
/**
 * loyaltyUnified.smoke.test.cjs
 * Loyalty earn scope=all_customers smoke for retail customers.
 *
 * Ishga tushirish: npm run test:loyalty-smoke
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
  db.prepare(`INSERT INTO customers (id, pricing_tier, bonus_points) VALUES ('c-retail', 'retail', 0)`).run();
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

run('scope=all_customers earns points for retail customer', () => {
  const db = createSalesDb();
  const sales = new SalesService(db);
  const now = new Date().toISOString();
  sales._accrueCustomerLoyalty({
    customerId: 'c-retail',
    paidAmount: 5000,
    orderTotalAmount: 5000,
    orderId: 'ord-1',
    orderNumber: 'S-001',
    createdBy: null,
    now,
    skipWalkInCustomerId: null,
  });
  const row = db.prepare(`SELECT bonus_points FROM customers WHERE id = 'c-retail'`).get();
  assert.strictEqual(Number(row.bonus_points), 5);
});

run('scope=off skips general earn', () => {
  const db = createSalesDb();
  db.prepare(`UPDATE settings SET value = 'off' WHERE key = 'loyalty.earn.scope'`).run();
  const sales = new SalesService(db);
  const now = new Date().toISOString();
  sales._accrueCustomerLoyalty({
    customerId: 'c-retail',
    paidAmount: 5000,
    orderTotalAmount: 5000,
    orderId: 'ord-2',
    orderNumber: 'S-002',
    createdBy: null,
    now,
    skipWalkInCustomerId: null,
  });
  const row = db.prepare(`SELECT bonus_points FROM customers WHERE id = 'c-retail'`).get();
  assert.strictEqual(Number(row.bonus_points), 0);
});

console.log(`\n=== NATIJA: ${passed} OK, ${failed} FAIL ===\n`);
process.exit(failed > 0 ? 1 : 0);

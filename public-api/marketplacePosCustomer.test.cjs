'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const {
  recordWebOrderCustomerSale,
  ensurePosCustomerForMarketplace,
  normalizePhoneUz,
} = require('./lib/marketplacePosCustomer.cjs');

function createTestDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE marketplace_customers (
      id INTEGER PRIMARY KEY,
      telegram_id INTEGER UNIQUE,
      first_name TEXT,
      last_name TEXT,
      phone TEXT
    );
    CREATE TABLE customers (
      id TEXT PRIMARY KEY,
      code TEXT,
      name TEXT,
      phone TEXT,
      phone_normalized TEXT,
      type TEXT,
      status TEXT,
      balance REAL DEFAULT 0,
      total_sales REAL DEFAULT 0,
      total_orders INTEGER DEFAULT 0,
      created_at TEXT,
      updated_at TEXT
    );
    CREATE TABLE marketplace_customer_bindings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      marketplace_customer_id INTEGER NOT NULL UNIQUE,
      pos_customer_id TEXT NOT NULL,
      loyalty_card_code TEXT NOT NULL UNIQUE,
      qr_payload TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE customer_ledger (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      type TEXT NOT NULL,
      ref_id TEXT,
      ref_no TEXT,
      amount INTEGER NOT NULL,
      balance_after INTEGER NOT NULL,
      note TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE web_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_number TEXT UNIQUE,
      customer_id INTEGER,
      status TEXT,
      payment_method TEXT,
      payment_status TEXT,
      total_amount INTEGER,
      created_at TEXT,
      updated_at TEXT
    );
  `);
  db.prepare(`INSERT INTO marketplace_customers (id, telegram_id, first_name, phone) VALUES (1, 999, 'Ali', '+998901112233')`).run();
  db.prepare(
    `INSERT INTO customers (id, code, name, phone, type, status, balance, total_sales, total_orders, created_at, updated_at)
     VALUES ('cust-1', 'CUST-0001', 'Ali Valiyev', '+998901112233', 'individual', 'active', 0, 0, 0, datetime('now'), datetime('now'))`,
  ).run();
  db.prepare(
    `INSERT INTO marketplace_customer_bindings (marketplace_customer_id, pos_customer_id, loyalty_card_code, qr_payload)
     VALUES (1, 'cust-1', 'LC-999-1', 'LOYALTY:LC-999-1')`,
  ).run();
  return db;
}

test('recordWebOrderCustomerSale writes ledger on delivered (idempotent)', () => {
  const db = createTestDb();
  const r = db
    .prepare(
      `INSERT INTO web_orders (order_number, customer_id, status, payment_method, payment_status, total_amount, created_at, updated_at)
       VALUES ('WO-DONE', 1, 'delivered', 'cash', 'paid', 50000, datetime('now'), datetime('now'))`,
    )
    .run();
  const orderId = r.lastInsertRowid;
  const out = recordWebOrderCustomerSale(db, orderId);
  assert.equal(out.ok, true);
  assert.equal(out.skipped, false);

  const cust = db.prepare(`SELECT total_sales, total_orders FROM customers WHERE id = 'cust-1'`).get();
  assert.equal(Number(cust.total_sales), 50000);
  assert.equal(Number(cust.total_orders), 1);

  const ledger = db
    .prepare(`SELECT type, ref_id, amount FROM customer_ledger WHERE customer_id = 'cust-1'`)
    .get();
  assert.equal(ledger.type, 'sale');
  assert.equal(ledger.ref_id, `web:${orderId}`);

  const again = recordWebOrderCustomerSale(db, orderId);
  assert.equal(again.skipped, true);
  assert.equal(again.reason, 'already_recorded');
});

test('normalizePhoneUz treats +998, 998, and local 9-digit as same', () => {
  const canonical = '998901112233';
  assert.equal(normalizePhoneUz('+998901112233'), canonical);
  assert.equal(normalizePhoneUz('998901112233'), canonical);
  assert.equal(normalizePhoneUz('901112233'), canonical);
  assert.equal(normalizePhoneUz('8 90 111 22 33'), canonical);
});

test('ensurePosCustomerForMarketplace reuses existing customer across phone formats', () => {
  const db = createTestDb();
  db.prepare(
    `UPDATE customers SET phone = '+998901112233', phone_normalized = '998901112233' WHERE id = 'cust-1'`,
  ).run();

  const posId = ensurePosCustomerForMarketplace(db, {
    first_name: 'Vali',
    last_name: 'Karimov',
    phone: '901112233',
  });
  assert.equal(posId, 'cust-1');

  const count = db.prepare(`SELECT COUNT(*) AS c FROM customers`).get();
  assert.equal(Number(count.c), 1);
});

test('recordWebOrderCustomerSale skips non-delivered orders', () => {
  const db = createTestDb();
  const r = db
    .prepare(
      `INSERT INTO web_orders (order_number, customer_id, status, payment_method, payment_status, total_amount, created_at, updated_at)
       VALUES ('WO-PROC', 1, 'processing', 'cash', 'pending', 50000, datetime('now'), datetime('now'))`,
    )
    .run();
  const out = recordWebOrderCustomerSale(db, r.lastInsertRowid);
  assert.equal(out.skipped, true);
  assert.equal(out.reason, 'not_delivered');
});

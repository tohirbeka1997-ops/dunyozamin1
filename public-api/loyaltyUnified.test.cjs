'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const CustomersService = require('../electron/services/customersService.cjs');
const {
  ensureLoyaltySchema,
  getBalance,
  awardPaidOrderPoints,
  redeemPointsForOrder,
  resolvePosCustomerId,
} = require('./lib/marketplaceLoyalty.cjs');

function createUnifiedDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE settings (
      id TEXT PRIMARY KEY,
      key TEXT UNIQUE,
      value TEXT,
      type TEXT,
      description TEXT,
      category TEXT,
      is_public INTEGER DEFAULT 1
    );
    CREATE TABLE customers (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE,
      name TEXT NOT NULL,
      phone TEXT,
      phone_normalized TEXT,
      email TEXT,
      address TEXT,
      type TEXT DEFAULT 'individual',
      company_name TEXT,
      tax_number TEXT,
      pricing_tier TEXT DEFAULT 'retail',
      credit_limit REAL DEFAULT 0,
      allow_debt INTEGER DEFAULT 0,
      allow_credit INTEGER DEFAULT 0,
      balance REAL DEFAULT 0,
      status TEXT DEFAULT 'active',
      notes TEXT,
      bonus_points REAL DEFAULT 0,
      loyalty_card_code TEXT,
      loyalty_qr_payload TEXT,
      total_sales REAL DEFAULT 0,
      total_orders INTEGER DEFAULT 0,
      created_at TEXT,
      updated_at TEXT
    );
    CREATE TABLE marketplace_customers (
      id INTEGER PRIMARY KEY,
      telegram_id INTEGER
    );
    CREATE TABLE marketplace_customer_bindings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      marketplace_customer_id INTEGER NOT NULL UNIQUE,
      pos_customer_id TEXT NOT NULL,
      loyalty_card_code TEXT NOT NULL UNIQUE,
      qr_payload TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE customer_bonus_ledger (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      type TEXT NOT NULL,
      points REAL NOT NULL,
      order_id TEXT,
      note TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  ensureLoyaltySchema(db);
  db.prepare(`INSERT INTO marketplace_customers (id, telegram_id) VALUES (1, 555)`).run();
  db.prepare(
    `INSERT INTO customers (id, code, name, bonus_points, loyalty_card_code, loyalty_qr_payload, created_at, updated_at)
     VALUES ('pos-1', 'CUST-0001', 'Ali', 5, 'LC-CUST-0001', 'LOYALTY:LC-CUST-0001', datetime('now'), datetime('now'))`,
  ).run();
  db.prepare(
    `INSERT INTO marketplace_customer_bindings (marketplace_customer_id, pos_customer_id, loyalty_card_code, qr_payload)
     VALUES (1, 'pos-1', 'LC-555-1', 'LOYALTY:LC-555-1')`,
  ).run();
  return db;
}

test('unified balance: online earn writes to bound POS bonus_points', () => {
  const db = createUnifiedDb();
  const out = awardPaidOrderPoints(db, { customerId: 1, orderId: 42, totalAmount: 2500 });
  assert.equal(out.inserted, true);
  assert.equal(out.earned_points, 2);
  assert.equal(out.balance, 7);

  const pos = db.prepare(`SELECT bonus_points FROM customers WHERE id = 'pos-1'`).get();
  assert.equal(Number(pos.bonus_points), 7);
  assert.equal(getBalance(db, 1), 7);

  const again = awardPaidOrderPoints(db, { customerId: 1, orderId: 42, totalAmount: 2500 });
  assert.equal(again.inserted, false);
  assert.equal(getBalance(db, 1), 7);
});

test('unified balance: redeem deducts POS bonus_points', () => {
  const db = createUnifiedDb();
  db.prepare(`UPDATE customers SET bonus_points = 30 WHERE id = 'pos-1'`).run();

  const r = redeemPointsForOrder(db, { customerId: 1, orderId: 99, points: 12 });
  assert.equal(r.redeemed, 12);
  assert.equal(getBalance(db, 1), 18);

  const pos = db.prepare(`SELECT bonus_points FROM customers WHERE id = 'pos-1'`).get();
  assert.equal(Number(pos.bonus_points), 18);
});

test('loyalty card generated for every new POS customer', () => {
  const db = createUnifiedDb();
  const svc = new CustomersService(db);
  const created = svc.create({ name: 'Vali', phone: '+998901112233' });
  assert.ok(created.loyalty_card_code);
  assert.ok(String(created.loyalty_qr_payload || '').startsWith('LOYALTY:'));

  const byQr = svc.getByLoyaltyQr(created.loyalty_qr_payload);
  assert.equal(byQr?.id, created.id);
});

test('getByLoyaltyQr finds mini-app LC-telegram-mc binding codes', () => {
  const db = createUnifiedDb();
  const svc = new CustomersService(db);
  const found = svc.getByLoyaltyQr('LOYALTY:LC-555-1');
  assert.equal(found?.id, 'pos-1');
  assert.equal(resolvePosCustomerId(db, 1), 'pos-1');
});

test('phoneless duplicate warning on create', () => {
  const db = createUnifiedDb();
  db.exec(`INSERT INTO settings (id, key, value) VALUES ('s1', 'customers.phone.mode', 'recommend')`);
  const svc = new CustomersService(db);
  svc.create({ name: 'Onlayn mijoz' });
  const second = svc.create({ name: 'Onlayn mijoz' });
  assert.ok(second._probable_duplicate);
  assert.equal(second._probable_duplicate.name, 'Onlayn mijoz');
});

test('phone required setting blocks phoneless create', () => {
  const db = createUnifiedDb();
  db.exec(`INSERT INTO settings (id, key, value) VALUES ('s1', 'customers.phone.mode', 'required')`);
  const svc = new CustomersService(db);
  assert.throws(() => svc.create({ name: 'No Phone' }), /Telefon raqami majburiy/);
});

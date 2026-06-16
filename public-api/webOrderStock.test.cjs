'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const {
  reserveWebOrderStock,
  releaseWebOrderStock,
  fulfillWebOrderStock,
  handleWebOrderCancelled,
  isOrderStockFulfilled,
  restoreWebOrderStock,
} = require('./lib/webOrderStock.cjs');

function createTestDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE products (
      id TEXT PRIMARY KEY,
      name TEXT,
      track_stock INTEGER DEFAULT 1,
      current_stock REAL DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      sale_price REAL DEFAULT 1000,
      updated_at TEXT
    );
    CREATE TABLE stock_balances (
      id TEXT PRIMARY KEY,
      product_id TEXT,
      warehouse_id TEXT,
      quantity REAL DEFAULT 0,
      reserved_quantity REAL DEFAULT 0,
      created_at TEXT,
      updated_at TEXT
    );
    CREATE TABLE inventory_movements (
      id TEXT PRIMARY KEY,
      product_id TEXT,
      warehouse_id TEXT,
      movement_number TEXT,
      movement_type TEXT,
      quantity REAL,
      before_quantity REAL,
      after_quantity REAL,
      reference_type TEXT,
      reference_id TEXT,
      reason TEXT,
      notes TEXT,
      created_by TEXT,
      created_at TEXT
    );
    CREATE TABLE marketplace_customers (
      id INTEGER PRIMARY KEY,
      telegram_id INTEGER UNIQUE
    );
    CREATE TABLE web_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_number TEXT UNIQUE,
      customer_id INTEGER,
      status TEXT,
      payment_method TEXT,
      payment_status TEXT,
      total_amount INTEGER,
      stock_fulfilled_at TEXT,
      created_at TEXT,
      updated_at TEXT
    );
    CREATE TABLE web_order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER,
      product_id TEXT,
      quantity INTEGER,
      price_at_order INTEGER
    );
  `);
  db.prepare(`INSERT INTO products (id, name, track_stock, current_stock) VALUES ('p1', 'Test', 1, 10)`).run();
  db.prepare(
    `INSERT INTO stock_balances (id, product_id, warehouse_id, quantity, reserved_quantity, created_at, updated_at)
     VALUES ('b1', 'p1', 'main-warehouse-001', 10, 0, datetime('now'), datetime('now'))`,
  ).run();
  db.prepare(`INSERT INTO marketplace_customers (id, telegram_id) VALUES (1, 123)`).run();
  return db;
}

function insertOrder(db, status = 'new') {
  const r = db
    .prepare(
      `INSERT INTO web_orders (order_number, customer_id, status, payment_method, payment_status, total_amount, created_at, updated_at)
       VALUES ('WO-TEST', 1, ?, 'cash', 'pending', 5000, datetime('now'), datetime('now'))`,
    )
    .run(status);
  const orderId = r.lastInsertRowid;
  db.prepare(`INSERT INTO web_order_items (order_id, product_id, quantity, price_at_order) VALUES (?, 'p1', 2, 2500)`).run(
    orderId,
  );
  return orderId;
}

test('reserve reduces available stock via reserved_quantity', () => {
  const db = createTestDb();
  const orderId = insertOrder(db);
  reserveWebOrderStock(db, orderId);
  const bal = db.prepare(`SELECT quantity, reserved_quantity FROM stock_balances WHERE product_id = 'p1'`).get();
  assert.equal(bal.quantity, 10);
  assert.equal(bal.reserved_quantity, 2);
});

test('fulfill is idempotent and writes inventory_movements', () => {
  const db = createTestDb();
  const orderId = insertOrder(db);
  reserveWebOrderStock(db, orderId);
  fulfillWebOrderStock(db, orderId);
  fulfillWebOrderStock(db, orderId);
  assert.equal(isOrderStockFulfilled(db, orderId), true);
  const moves = db
    .prepare(`SELECT COUNT(*) AS n FROM inventory_movements WHERE reference_type = 'web_order' AND reference_id = ?`)
    .get(String(orderId));
  assert.equal(moves.n, 1);
  const bal = db.prepare(`SELECT quantity, reserved_quantity FROM stock_balances WHERE product_id = 'p1'`).get();
  assert.equal(bal.quantity, 8);
  assert.equal(bal.reserved_quantity, 0);
});

test('cancel before fulfill releases reservation', () => {
  const db = createTestDb();
  const orderId = insertOrder(db);
  reserveWebOrderStock(db, orderId);
  handleWebOrderCancelled(db, orderId);
  const bal = db.prepare(`SELECT reserved_quantity FROM stock_balances WHERE product_id = 'p1'`).get();
  assert.equal(bal.reserved_quantity, 0);
  assert.equal(isOrderStockFulfilled(db, orderId), false);
});

test('cancel after fulfill restores stock', () => {
  const db = createTestDb();
  const orderId = insertOrder(db);
  reserveWebOrderStock(db, orderId);
  fulfillWebOrderStock(db, orderId);
  restoreWebOrderStock(db, orderId);
  const bal = db.prepare(`SELECT quantity FROM stock_balances WHERE product_id = 'p1'`).get();
  assert.equal(bal.quantity, 10);
  assert.equal(isOrderStockFulfilled(db, orderId), false);
});

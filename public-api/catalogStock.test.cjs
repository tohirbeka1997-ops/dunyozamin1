'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { getProductById } = require('./routes/catalog.cjs');
const { getAvailableStock, ledgerStock } = require('./lib/authoritativeStock.cjs');

function createStockDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE products (
      id TEXT PRIMARY KEY,
      sku TEXT,
      name TEXT,
      description TEXT,
      sale_price REAL,
      category_id TEXT,
      track_stock INTEGER DEFAULT 1,
      image_url TEXT,
      is_active INTEGER DEFAULT 1
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
    CREATE VIEW v_product_stock AS
    SELECT product_id, COALESCE(SUM(quantity), 0) AS stock
    FROM inventory_movements
    GROUP BY product_id;
    CREATE TABLE web_orders (
      id INTEGER PRIMARY KEY,
      order_number TEXT,
      status TEXT,
      stock_fulfilled_at TEXT
    );
    CREATE TABLE web_order_items (
      id INTEGER PRIMARY KEY,
      order_id INTEGER,
      product_id TEXT,
      quantity INTEGER
    );
  `);

  db.prepare(
    `INSERT INTO products (id, sku, name, sale_price, track_stock, is_active)
     VALUES ('p1', 'SKU1', 'Product 1', 1000, 1, 1)`,
  ).run();

  // Drifted cache: stock_balances says 3 available but ledger has 10 on hand.
  db.prepare(
    `INSERT INTO stock_balances (id, product_id, warehouse_id, quantity, reserved_quantity, created_at, updated_at)
     VALUES ('b1', 'p1', 'main-warehouse-001', 3, 0, datetime('now'), datetime('now'))`,
  ).run();
  db.prepare(
    `INSERT INTO inventory_movements (
      id, product_id, warehouse_id, movement_number, movement_type, quantity,
      before_quantity, after_quantity, created_at
    ) VALUES ('m1', 'p1', 'main-warehouse-001', 'MOV-1', 'adjustment', 10, 0, 10, datetime('now'))`,
  ).run();

  return db;
}

test('catalog stock uses inventory_movements not drifted stock_balances cache', () => {
  const db = createStockDb();
  const product = getProductById(db, 'p1', { headers: {} });
  assert.ok(product);
  assert.equal(product.stock_quantity, 10);
  assert.equal(product.is_available, true);
  assert.equal(ledgerStock(db, 'p1'), 10);
  assert.equal(getAvailableStock(db, 'p1'), 10);
});

test('catalog stock subtracts authoritative web-order reserve', () => {
  const db = createStockDb();
  db.prepare(`INSERT INTO web_orders (id, order_number, status) VALUES (1, 'WO-1', 'new')`).run();
  db.prepare(`INSERT INTO web_order_items (order_id, product_id, quantity) VALUES (1, 'p1', 4)`).run();
  // Drift: balance reserve lower than open web order lines.
  db.prepare(`UPDATE stock_balances SET reserved_quantity = 1 WHERE product_id = 'p1'`).run();

  assert.equal(getAvailableStock(db, 'p1'), 6);
  const product = getProductById(db, 'p1', { headers: {} });
  assert.equal(product.stock_quantity, 6);
});

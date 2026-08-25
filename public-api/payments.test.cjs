'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const { handlePaycomRpc } = require('./lib/payme.cjs');
const { handleClickCallback } = require('./lib/click.cjs');
const { sumsToTiyin } = require('./lib/paymentLinks.cjs');
const { isOrderStockFulfilled } = require('./lib/webOrderStock.cjs');

// Mirrors the production web_orders columns the payment handlers touch
// (incl. payment_provider / payment_id, which the stock test omits).
function createTestDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE products (
      id TEXT PRIMARY KEY,
      name TEXT,
      track_stock INTEGER DEFAULT 1,
      current_stock REAL DEFAULT 0,
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
    CREATE TABLE web_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_number TEXT UNIQUE,
      customer_id INTEGER,
      status TEXT,
      payment_method TEXT,
      payment_status TEXT,
      payment_id TEXT,
      payment_provider TEXT,
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
     VALUES ('b1', 'p1', 'main-warehouse-001', 10, 2, datetime('now'), datetime('now'))`,
  ).run();
  return db;
}

function insertPayableOrder(db, method) {
  const r = db
    .prepare(
      `INSERT INTO web_orders (order_number, customer_id, status, payment_method, payment_status, total_amount, created_at, updated_at)
       VALUES ('WO-PAY', 1, 'new', ?, 'pending', 5000, datetime('now'), datetime('now'))`,
    )
    .run(method);
  const orderId = r.lastInsertRowid;
  db.prepare(
    `INSERT INTO web_order_items (order_id, product_id, quantity, price_at_order) VALUES (?, 'p1', 2, 2500)`,
  ).run(orderId);
  return orderId;
}

function stockQty(db) {
  return db.prepare(`SELECT quantity, reserved_quantity FROM stock_balances WHERE product_id = 'p1'`).get();
}

function saleMovementCount(db, orderId) {
  return db
    .prepare(
      `SELECT COUNT(*) AS n FROM inventory_movements
       WHERE reference_type = 'web_order' AND reference_id = ? AND movement_type = 'sale'`,
    )
    .get(String(orderId)).n;
}

// --- Payme ---------------------------------------------------------------

const PAYME_MID = 'merchant-123';
const PAYME_KEY = 'secret-key-456';

function paymeReq() {
  const token = Buffer.from(`${PAYME_MID}:${PAYME_KEY}`, 'utf8').toString('base64');
  return { headers: { authorization: `Basic ${token}` } };
}

function performTransactionBody(orderId, amountTiyin) {
  return {
    jsonrpc: '2.0',
    id: 42,
    method: 'PerformTransaction',
    params: { id: 'payme-tx-1', amount: amountTiyin, account: { order_id: String(orderId) } },
  };
}

test('payme PerformTransaction twice decrements stock once and marks paid once', () => {
  const db = createTestDb();
  const orderId = insertPayableOrder(db, 'payme');
  const amount = sumsToTiyin(5000);

  const first = handlePaycomRpc(db, paymeReq(), performTransactionBody(orderId, amount), {
    merchantId: PAYME_MID,
    apiKey: PAYME_KEY,
  });
  // First call performs the transition -> success + notify, stock down by 2.
  assert.equal(first.body.result.state, 2);
  assert.equal(first.notifyOrderId, orderId);
  assert.equal(saleMovementCount(db, orderId), 1);
  assert.equal(stockQty(db).quantity, 8);
  assert.equal(isOrderStockFulfilled(db, orderId), true);

  const second = handlePaycomRpc(db, paymeReq(), performTransactionBody(orderId, amount), {
    merchantId: PAYME_MID,
    apiKey: PAYME_KEY,
  });
  // Retry returns the SAME provider contract (state 2) but does NOT decrement
  // again and does NOT re-notify the customer.
  assert.equal(second.body.result.state, 2);
  assert.equal(second.notifyOrderId, undefined);
  assert.equal(saleMovementCount(db, orderId), 1);
  assert.equal(stockQty(db).quantity, 8);

  const row = db.prepare(`SELECT payment_status, payment_provider FROM web_orders WHERE id = ?`).get(orderId);
  assert.equal(row.payment_status, 'paid');
  assert.equal(row.payment_provider, 'payme');
});

test('payme CancelTransaction after capture marks refunded and cancelled', () => {
  const db = createTestDb();
  const orderId = insertPayableOrder(db, 'payme');
  const amount = sumsToTiyin(5000);
  handlePaycomRpc(db, paymeReq(), performTransactionBody(orderId, amount), {
    merchantId: PAYME_MID,
    apiKey: PAYME_KEY,
  });
  const cancel = handlePaycomRpc(
    db,
    paymeReq(),
    {
      jsonrpc: '2.0',
      id: 43,
      method: 'CancelTransaction',
      params: { id: 'payme-tx-1', account: { order_id: String(orderId) } },
    },
    { merchantId: PAYME_MID, apiKey: PAYME_KEY },
  );
  assert.equal(cancel.body.result.state, -1);
  const row = db.prepare(`SELECT status, payment_status FROM web_orders WHERE id = ?`).get(orderId);
  assert.equal(row.status, 'cancelled');
  assert.equal(row.payment_status, 'refunded');
});

// --- Click ---------------------------------------------------------------

const CLICK_SERVICE = '900';
const CLICK_SECRET = 'click-secret-789';

function clickCompleteParams(orderId, amountTiyin) {
  const params = {
    click_trans_id: 'click-tx-1',
    service_id: CLICK_SERVICE,
    merchant_trans_id: String(orderId),
    amount: String(amountTiyin),
    action: '1',
    sign_time: '2026-01-01 10:00:00',
  };
  const str = `${params.click_trans_id}${params.service_id}${CLICK_SECRET}${params.merchant_trans_id}${params.amount}${params.action}${params.sign_time}`;
  params.sign_string = crypto.createHash('md5').update(str).digest('hex');
  return params;
}

test('click action=1 twice decrements stock once and marks paid once', () => {
  const db = createTestDb();
  const orderId = insertPayableOrder(db, 'click');
  const amount = sumsToTiyin(5000);

  let notified = 0;
  const onPaid = () => {
    notified += 1;
  };

  const first = handleClickCallback(db, clickCompleteParams(orderId, amount), {
    serviceId: CLICK_SERVICE,
    secretKey: CLICK_SECRET,
  }, onPaid);
  assert.equal(first.error, 0);
  assert.equal(saleMovementCount(db, orderId), 1);
  assert.equal(stockQty(db).quantity, 8);
  assert.equal(notified, 1);

  const second = handleClickCallback(db, clickCompleteParams(orderId, amount), {
    serviceId: CLICK_SERVICE,
    secretKey: CLICK_SECRET,
  }, onPaid);
  // Retry: provider still receives error: 0 (success) but no second decrement
  // and no second onPaid notification.
  assert.equal(second.error, 0);
  assert.equal(saleMovementCount(db, orderId), 1);
  assert.equal(stockQty(db).quantity, 8);
  assert.equal(notified, 1);

  const row = db.prepare(`SELECT payment_status, payment_provider FROM web_orders WHERE id = ?`).get(orderId);
  assert.equal(row.payment_status, 'paid');
  assert.equal(row.payment_provider, 'click');
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { randomUUID } = crypto;
const Database = require('better-sqlite3');
const express = require('express');
const http = require('http');

const { runMigrations } = require('../electron/db/migrate.cjs');
const { ensureStaffSchema } = require('./lib/staffDb.cjs');
const { mountStaffRoutes } = require('./routes/staff/index.cjs');

const TEST_SECRET = 'test-staff-jwt-secret-min-16-chars';

function withEnv(overrides, fn) {
  const prev = {};
  for (const [k, v] of Object.entries(overrides)) {
    prev[k] = process.env[k];
    if (v == null) delete process.env[k];
    else process.env[k] = v;
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const [k, v] of Object.entries(prev)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    });
}

const { hashPassword } = require('../electron/lib/password.cjs');

const SALES_USER_ID = 'staff-sales-001';
const PRODUCT_ID = 'prod-sell-001';
const WAREHOUSE_ID = 'main-warehouse-001';

function seedDatabase(dbPath) {
  const db = new Database(dbPath);
  runMigrations(db);
  ensureStaffSchema(db);

  db.prepare(
    `INSERT OR IGNORE INTO roles (id, code, name, description, is_active, created_at)
     VALUES ('role-sales-001', 'sales', 'Sales', 'Sales role', 1, datetime('now'))`,
  ).run();

  db.prepare(
    `INSERT INTO users (id, username, full_name, email, password_hash, is_active, created_at, updated_at)
     VALUES (?, 'seller@test.com', 'Seller User', 'seller@test.com', ?, 1, datetime('now'), datetime('now'))`,
  ).run(SALES_USER_ID, hashPassword('secret123'));

  db.prepare(
    `INSERT INTO user_roles (id, user_id, role_id, assigned_at)
     VALUES ('ur-sales-sell-001', ?, 'role-sales-001', datetime('now'))`,
  ).run(SALES_USER_ID);

  db.prepare(
    `INSERT INTO products (id, sku, name, unit, sale_price, purchase_price, current_stock, track_stock, is_active, created_at, updated_at)
     VALUES (?, 'SKU-SELL-1', 'Test Cola', 'pcs', 10000, 6000, 20, 1, 1, datetime('now'), datetime('now'))`,
  ).run(PRODUCT_ID);

  db.prepare(
    `INSERT INTO stock_balances (id, product_id, warehouse_id, quantity, created_at, updated_at)
     VALUES (?, ?, ?, 20, datetime('now'), datetime('now'))`,
  ).run(randomUUID(), PRODUCT_ID, WAREHOUSE_ID);

  db.prepare(
    `INSERT INTO inventory_movements (
       id, product_id, warehouse_id, movement_number, movement_type, quantity,
       before_quantity, after_quantity, reference_type, reference_id, reason, created_at
     ) VALUES (?, ?, ?, ?, 'purchase', 20, 0, 20, 'seed', 'seed', 'seed stock', datetime('now'))`,
  ).run(randomUUID(), PRODUCT_ID, WAREHOUSE_ID, `MOV-RET-${Date.now()}`);

  db.close();
}

function stockOf(dbPath, productId) {
  const db = new Database(dbPath);
  const row = db
    .prepare('SELECT COALESCE(SUM(quantity), 0) AS s FROM inventory_movements WHERE product_id = ?')
    .get(productId);
  db.close();
  return Number(row?.s || 0);
}

function orderItemId(dbPath, orderId) {
  const db = new Database(dbPath);
  const row = db.prepare('SELECT id FROM order_items WHERE order_id = ? LIMIT 1').get(orderId);
  db.close();
  return row?.id;
}

test('staff returns: sell → returnable → partial return → stock restored', async () => {
  const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'staff-returns-test-'));
  const dbPath = path.join(tmpDir, 'pos.db');
  seedDatabase(dbPath);

  await withEnv(
    {
      STAFF_JWT_SECRET: TEST_SECRET,
      STAFF_JWT_REFRESH_SECRET: TEST_SECRET + '-r',
      POS_DATA_DIR: tmpDir,
    },
    async () => {
      const { clearTenantDbCache } = require('./lib/staffDb.cjs');
      clearTenantDbCache();

      const app = express();
      app.use('/v1/staff', mountStaffRoutes());

      const server = http.createServer(app);
      await new Promise((resolve) => server.listen(0, resolve));
      const { port } = server.address();
      const base = `http://127.0.0.1:${port}`;

      const authHeader = (token) => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });

      try {
        const loginRes = await fetch(`${base}/v1/staff/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tenant: 'default', username: 'seller@test.com', password: 'secret123' }),
        });
        assert.equal(loginRes.status, 200);
        const token = (await loginRes.json()).access_token;

        await fetch(`${base}/v1/staff/shifts/open`, {
          method: 'POST',
          headers: authHeader(token),
          body: JSON.stringify({ opening_cash: 100000 }),
        });

        const sellRes = await fetch(`${base}/v1/staff/sales`, {
          method: 'POST',
          headers: authHeader(token),
          body: JSON.stringify({
            items: [{ product_id: PRODUCT_ID, quantity: 4 }],
            payment_method: 'cash',
            order_uuid: randomUUID(),
          }),
        });
        assert.equal(sellRes.status, 201);
        const sellBody = await sellRes.json();
        const orderId = sellBody.data.id;
        assert.equal(stockOf(dbPath, PRODUCT_ID), 16);

        const returnableRes = await fetch(`${base}/v1/staff/sales/${orderId}/returnable`, {
          headers: authHeader(token),
        });
        assert.equal(returnableRes.status, 200);
        const returnableBody = await returnableRes.json();
        assert.equal(returnableBody.data.has_returnable, true);
        assert.equal(returnableBody.data.items.length, 1);
        assert.equal(returnableBody.data.items[0].returnable_quantity, 4);
        const orderItemIdVal = returnableBody.data.items[0].order_item_id;

        const returnRes = await fetch(`${base}/v1/staff/returns`, {
          method: 'POST',
          headers: authHeader(token),
          body: JSON.stringify({
            order_id: orderId,
            items: [{ order_item_id: orderItemIdVal, quantity: 2 }],
            refund_method: 'cash',
            reason: 'Test qaytarish',
          }),
        });
        assert.equal(returnRes.status, 201);
        const returnBody = await returnRes.json();
        assert.equal(returnBody.data.status, 'completed');
        assert.ok(returnBody.data.return_number);
        assert.equal(stockOf(dbPath, PRODUCT_ID), 18);

        const returnable2 = await fetch(`${base}/v1/staff/sales/${orderId}/returnable`, {
          headers: authHeader(token),
        });
        const returnable2Body = await returnable2.json();
        assert.equal(returnable2Body.data.items[0].returnable_quantity, 2);

        const overRes = await fetch(`${base}/v1/staff/returns`, {
          method: 'POST',
          headers: authHeader(token),
          body: JSON.stringify({
            order_id: orderId,
            items: [{ order_item_id: orderItemIdVal, quantity: 5 }],
            refund_method: 'cash',
          }),
        });
        assert.equal(overRes.status, 400);
        const overBody = await overRes.json();
        assert.equal(overBody.error, 'validation_error');

        const fullRes = await fetch(`${base}/v1/staff/returns`, {
          method: 'POST',
          headers: authHeader(token),
          body: JSON.stringify({
            order_id: orderId,
            items: [{ order_item_id: orderItemIdVal, quantity: 2 }],
            refund_method: 'cash',
          }),
        });
        assert.equal(fullRes.status, 201, `full return failed: ${await fullRes.text()}`);
        assert.equal(stockOf(dbPath, PRODUCT_ID), 20);

        const returnable3 = await fetch(`${base}/v1/staff/sales/${orderId}/returnable`, {
          headers: authHeader(token),
        });
        const returnable3Body = await returnable3.json();
        assert.equal(returnable3Body.data.items.length, 0);
        assert.equal(returnable3Body.data.has_returnable, false);
      } finally {
        server.close();
      }
    },
  );
});

test('staff returns: credit refund requires customer on order', async () => {
  const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'staff-returns-credit-'));
  const dbPath = path.join(tmpDir, 'pos.db');
  seedDatabase(dbPath);

  await withEnv(
    {
      STAFF_JWT_SECRET: TEST_SECRET,
      STAFF_JWT_REFRESH_SECRET: TEST_SECRET + '-r',
      POS_DATA_DIR: tmpDir,
    },
    async () => {
      const { clearTenantDbCache } = require('./lib/staffDb.cjs');
      clearTenantDbCache();

      const app = express();
      app.use('/v1/staff', mountStaffRoutes());
      const server = http.createServer(app);
      await new Promise((resolve) => server.listen(0, resolve));
      const { port } = server.address();
      const base = `http://127.0.0.1:${port}`;
      const authHeader = (token) => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });

      try {
        const loginRes = await fetch(`${base}/v1/staff/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tenant: 'default', username: 'seller@test.com', password: 'secret123' }),
        });
        const token = (await loginRes.json()).access_token;

        await fetch(`${base}/v1/staff/shifts/open`, {
          method: 'POST',
          headers: authHeader(token),
          body: JSON.stringify({ opening_cash: 0 }),
        });

        const sellRes = await fetch(`${base}/v1/staff/sales`, {
          method: 'POST',
          headers: authHeader(token),
          body: JSON.stringify({
            items: [{ product_id: PRODUCT_ID, quantity: 1 }],
            payment_method: 'cash',
            order_uuid: randomUUID(),
          }),
        });
        const orderId = (await sellRes.json()).data.id;
        const oiId = orderItemId(dbPath, orderId);

        const badCredit = await fetch(`${base}/v1/staff/returns`, {
          method: 'POST',
          headers: authHeader(token),
          body: JSON.stringify({
            order_id: orderId,
            items: [{ order_item_id: oiId, quantity: 1 }],
            refund_method: 'credit',
          }),
        });
        assert.equal(badCredit.status, 400);
        const badBody = await badCredit.json();
        assert.match(badBody.message, /mijoz/i);
      } finally {
        server.close();
      }
    },
  );
});

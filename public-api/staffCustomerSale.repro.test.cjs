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
const { ensureStaffSchema, clearTenantDbCache } = require('./lib/staffDb.cjs');
const { mountStaffRoutes } = require('./routes/staff/index.cjs');

const TEST_SECRET = 'test-staff-jwt-secret-min-16-chars';
const STAFF_USER = 'staff-sales-001';
const CUSTOMER_ID = 'cust-ismoil-001';
const PRODUCT_ID = 'prod-plafon-006';
const WAREHOUSE_ID = 'main-warehouse-001';

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
  ).run(STAFF_USER, hashPassword('secret123'));

  db.prepare(
    `INSERT INTO user_roles (id, user_id, role_id, assigned_at)
     VALUES ('ur-sales-sell-001', ?, 'role-sales-001', datetime('now'))`,
  ).run(STAFF_USER);

  // ISmoil with prepaid balance (positive = oldindan to'lov) + master tier (price mismatch scenario)
  db.prepare(
    `INSERT INTO customers (id, name, phone, status, balance, total_sales, total_orders, pricing_tier, created_at, updated_at)
     VALUES (?, 'ISmoil', '998901111111', 'active', 57000, 0, 0, 'master', datetime('now'), datetime('now'))`,
  ).run(CUSTOMER_ID);

  db.prepare(
    `UPDATE products SET master_price = 180000 WHERE id = ?`
  ).run(PRODUCT_ID);

  db.prepare(
    `INSERT INTO products (id, sku, name, unit, sale_price, purchase_price, current_stock, track_stock, is_active, created_at, updated_at)
     VALUES (?, '006', 'Hi-Tech Plafon', 'pcs', 195000, 100000, 5, 1, 1, datetime('now'), datetime('now'))`,
  ).run(PRODUCT_ID);

  db.prepare(
    `INSERT INTO stock_balances (id, product_id, warehouse_id, quantity, created_at, updated_at)
     VALUES (?, ?, ?, 5, datetime('now'), datetime('now'))`,
  ).run(randomUUID(), PRODUCT_ID, WAREHOUSE_ID);

  db.prepare(
    `INSERT INTO inventory_movements (
       id, product_id, warehouse_id, movement_number, movement_type, quantity,
       before_quantity, after_quantity, reference_type, reference_id, reason, created_at
     ) VALUES (?, ?, ?, ?, 'purchase', 5, 0, 5, 'seed', 'seed', 'seed stock', datetime('now'))`,
  ).run(randomUUID(), PRODUCT_ID, WAREHOUSE_ID, `MOV-SEED-${Date.now()}`);

  db.close();
}

test('staff sale with customer ISmoil + card (prepaid balance) succeeds', async () => {
  const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'cust-sale-test-'));
  const dbPath = path.join(tmpDir, 'pos.db');
  seedDatabase(dbPath);

  await withEnv(
    {
      STAFF_JWT_SECRET: TEST_SECRET,
      STAFF_JWT_REFRESH_SECRET: TEST_SECRET + '-r',
      POS_DATA_DIR: tmpDir,
    },
    async () => {
      clearTenantDbCache();

      const app = express();
      app.use(express.json());
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
        const { access_token: token } = await loginRes.json();

        const openRes = await fetch(`${base}/v1/staff/shifts/open`, {
          method: 'POST',
          headers: authHeader(token),
          body: JSON.stringify({ opening_cash: 0 }),
        });
        assert.equal(openRes.status, 201);

        const sellRes = await fetch(`${base}/v1/staff/sales`, {
          method: 'POST',
          headers: authHeader(token),
          body: JSON.stringify({
            items: [{ product_id: PRODUCT_ID, quantity: 1 }],
            payment_method: 'card',
            customer_id: CUSTOMER_ID,
            order_uuid: randomUUID(),
          }),
        });
        const sellBody = await sellRes.json();
        if (sellRes.status !== 201) {
          console.error('SALE FAILED:', sellRes.status, sellBody);
        }
        assert.equal(sellRes.status, 201, JSON.stringify(sellBody));
        assert.equal(sellBody.data.status, 'completed');
        assert.equal(Number(sellBody.data.total_amount), 195000);
        assert.equal(Number(sellBody.meta?.prepaid_applied), 57000);
        assert.equal(Number(sellBody.data.paid_amount), 138000);

        const db = new Database(dbPath);
        const cust = db.prepare('SELECT balance FROM customers WHERE id = ?').get(CUSTOMER_ID);
        db.close();
        assert.equal(Number(cust.balance), 0, 'prepaid consumed from balance');
      } finally {
        server.close();
        clearTenantDbCache();
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    },
  );
});

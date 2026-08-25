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
const { signStaffAccessToken } = require('./lib/staffJwt.cjs');
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

  // Product with stock (stock truth = inventory_movements SUM).
  db.prepare(
    `INSERT INTO products (id, sku, name, unit, sale_price, purchase_price, current_stock, track_stock, is_active, created_at, updated_at)
     VALUES (?, 'SKU-SELL-1', 'Test Cola', 'pcs', 10000, 6000, 10, 1, 1, datetime('now'), datetime('now'))`,
  ).run(PRODUCT_ID);

  db.prepare(
    `INSERT INTO stock_balances (id, product_id, warehouse_id, quantity, created_at, updated_at)
     VALUES (?, ?, ?, 10, datetime('now'), datetime('now'))`,
  ).run(randomUUID(), PRODUCT_ID, WAREHOUSE_ID);

  db.prepare(
    `INSERT INTO inventory_movements (
       id, product_id, warehouse_id, movement_number, movement_type, quantity,
       before_quantity, after_quantity, reference_type, reference_id, reason, created_at
     ) VALUES (?, ?, ?, ?, 'purchase', 10, 0, 10, 'seed', 'seed', 'seed stock', datetime('now'))`,
  ).run(randomUUID(), PRODUCT_ID, WAREHOUSE_ID, `MOV-SEED-${Date.now()}`);

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

test('staff POS: shift open → product search → sell → receipt → close + RBAC + stock', async () => {
  const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'staff-sales-test-'));
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
        // 1. Login as sales user
        const loginRes = await fetch(`${base}/v1/staff/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tenant: 'default', username: 'seller@test.com', password: 'secret123' }),
        });
        assert.equal(loginRes.status, 200);
        const login = await loginRes.json();
        const token = login.access_token;
        assert.equal(login.user.role, 'sales');

        // 2. Cashier may authenticate and attempt sales (needs open shift → 409, not 403).
        //    Web orders remain forbidden for cashier.
        const cashierToken = signStaffAccessToken(SALES_USER_ID, 'cashier', 'default');
        const cashierSaleRes = await fetch(`${base}/v1/staff/sales`, {
          method: 'POST',
          headers: authHeader(cashierToken),
          body: JSON.stringify({ items: [{ product_id: PRODUCT_ID, quantity: 1 }], payment_method: 'cash' }),
        });
        assert.equal(cashierSaleRes.status, 409);

        const cashierOrdersRes = await fetch(`${base}/v1/staff/orders/queues`, {
          headers: authHeader(cashierToken),
        });
        assert.equal(cashierOrdersRes.status, 403);

        // 3. Selling before opening a shift fails (shift required)
        const noShiftRes = await fetch(`${base}/v1/staff/sales`, {
          method: 'POST',
          headers: authHeader(token),
          body: JSON.stringify({ items: [{ product_id: PRODUCT_ID, quantity: 1 }], payment_method: 'cash' }),
        });
        assert.equal(noShiftRes.status, 409);

        // 4. Open a shift
        const openRes = await fetch(`${base}/v1/staff/shifts/open`, {
          method: 'POST',
          headers: authHeader(token),
          body: JSON.stringify({ opening_cash: 100000 }),
        });
        assert.equal(openRes.status, 201);
        const openBody = await openRes.json();
        assert.ok(openBody.data.id);
        assert.equal(openBody.data.status, 'open');

        // 5. Current shift reflects the open shift
        const curRes = await fetch(`${base}/v1/staff/shifts/current`, { headers: authHeader(token) });
        assert.equal(curRes.status, 200);
        const curBody = await curRes.json();
        assert.ok(curBody.data && curBody.data.shift && curBody.data.shift.id === openBody.data.id);

        // 5b. Hold sale — no payment, stock unchanged until cashier completes
        const stockBeforeHold = stockOf(dbPath, PRODUCT_ID);
        const holdRes = await fetch(`${base}/v1/staff/sales/hold`, {
          method: 'POST',
          headers: authHeader(token),
          body: JSON.stringify({
            items: [{ product_id: PRODUCT_ID, quantity: 1 }],
            shift_id: openBody.data.id,
            order_uuid: randomUUID(),
            device_id: 'test-mobile-device',
            notes: 'Mobil test',
          }),
        });
        assert.equal(holdRes.status, 201);
        const holdBody = await holdRes.json();
        assert.equal(String(holdBody.data.status).toLowerCase(), 'hold');
        assert.equal(holdBody.data.sales_channel, 'staff_mobile');
        assert.equal(stockOf(dbPath, PRODUCT_ID), stockBeforeHold);

        const holdListRes = await fetch(`${base}/v1/staff/sales?status=hold&limit=20`, {
          headers: authHeader(token),
        });
        assert.equal(holdListRes.status, 200);
        const holdListBody = await holdListRes.json();
        assert.ok(holdListBody.data.some((o) => o.id === holdBody.data.id));

        // 6. Product search
        const searchRes = await fetch(`${base}/v1/staff/products/search?q=SKU-SELL-1`, {
          headers: authHeader(token),
        });
        assert.equal(searchRes.status, 200);
        const searchBody = await searchRes.json();
        assert.ok(Array.isArray(searchBody.data));
        assert.ok(searchBody.data.some((p) => p.id === PRODUCT_ID));

        // 7. Complete a sale: 2 x 10000 = 20000, cash
        const stockBefore = stockOf(dbPath, PRODUCT_ID);
        assert.equal(stockBefore, 10);

        const sellRes = await fetch(`${base}/v1/staff/sales`, {
          method: 'POST',
          headers: authHeader(token),
          body: JSON.stringify({
            items: [{ product_id: PRODUCT_ID, quantity: 2 }],
            payment_method: 'cash',
            order_uuid: randomUUID(),
          }),
        });
        assert.equal(sellRes.status, 201);
        const sellBody = await sellRes.json();
        assert.equal(sellBody.data.status, 'completed');
        assert.equal(sellBody.data.payment_status, 'paid');
        assert.equal(Number(sellBody.data.total_amount), 20000);
        assert.ok(Array.isArray(sellBody.receipt.lines) && sellBody.receipt.lines.length > 0);
        const orderId = sellBody.data.id;

        // 8. Stock decremented by 2
        const stockAfter = stockOf(dbPath, PRODUCT_ID);
        assert.equal(stockAfter, 8);

        // 9. Receipt retrieval
        const receiptRes = await fetch(`${base}/v1/staff/sales/${orderId}/receipt`, {
          headers: authHeader(token),
        });
        assert.equal(receiptRes.status, 200);
        const receiptBody = await receiptRes.json();
        assert.ok(receiptBody.data.receipt.text.includes('JAMI'));

        // 9b. List POS sales — completed orders from orders table
        const listRes = await fetch(`${base}/v1/staff/sales?page=1&limit=50`, {
          headers: authHeader(token),
        });
        assert.equal(listRes.status, 200);
        const listBody = await listRes.json();
        assert.ok(Array.isArray(listBody.data));
        assert.ok(listBody.data.length >= 1);
        const listed = listBody.data.find((o) => o.id === orderId);
        assert.ok(listed, 'completed sale should appear in GET /v1/staff/sales');
        assert.equal(listed.order_number, sellBody.data.order_number);
        assert.equal(Number(listed.total_amount), 20000);
        assert.equal(listed.sales_channel, 'staff_mobile');
        assert.ok(listBody.meta && listBody.meta.page === 1);

        const filterRes = await fetch(`${base}/v1/staff/sales?sales_channel=staff_mobile`, {
          headers: authHeader(token),
        });
        assert.equal(filterRes.status, 200);
        const filterBody = await filterRes.json();
        assert.ok(filterBody.data.every((o) => o.sales_channel === 'staff_mobile'));

        // 10. Card sale also works
        const cardRes = await fetch(`${base}/v1/staff/sales`, {
          method: 'POST',
          headers: authHeader(token),
          body: JSON.stringify({
            items: [{ product_id: PRODUCT_ID, quantity: 1 }],
            payment_method: 'card',
            order_uuid: randomUUID(),
          }),
        });
        assert.equal(cardRes.status, 201);
        assert.equal(stockOf(dbPath, PRODUCT_ID), 7);

        // 11. Bad payment method rejected
        const badPay = await fetch(`${base}/v1/staff/sales`, {
          method: 'POST',
          headers: authHeader(token),
          body: JSON.stringify({ items: [{ product_id: PRODUCT_ID, quantity: 1 }], payment_method: 'bitcoin' }),
        });
        assert.equal(badPay.status, 400);

        // 12. Close shift — expected cash = opening + cash sales (20000), card excluded
        const closeRes = await fetch(`${base}/v1/staff/shifts/close`, {
          method: 'POST',
          headers: authHeader(token),
          body: JSON.stringify({ closing_cash: 120000 }),
        });
        assert.equal(closeRes.status, 200);
        const closeBody = await closeRes.json();
        assert.equal(closeBody.data.success, true);
        assert.equal(Number(closeBody.data.cashPayments), 20000);
        assert.equal(Number(closeBody.data.expectedCash), 120000);
      } finally {
        server.close();
        clearTenantDbCache();
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    },
  );
});

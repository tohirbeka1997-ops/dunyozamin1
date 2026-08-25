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
const STAFF_USER_ID = 'staff-report-001';
const PRODUCT_ID = 'prod-report-001';
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

function isYmd(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '').trim());
}

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
     VALUES (?, 'reportseller@test.com', 'Report Seller', 'reportseller@test.com', ?, 1, datetime('now'), datetime('now'))`,
  ).run(STAFF_USER_ID, hashPassword('secret123'));

  db.prepare(
    `INSERT INTO user_roles (id, user_id, role_id, assigned_at)
     VALUES ('ur-report-sell-001', ?, 'role-sales-001', datetime('now'))`,
  ).run(STAFF_USER_ID);

  db.prepare(
    `INSERT INTO products (id, sku, name, unit, sale_price, purchase_price, current_stock, track_stock, is_active, created_at, updated_at)
     VALUES (?, 'SKU-RPT-1', 'Report Cola', 'pcs', 12000, 7000, 10, 1, 1, datetime('now'), datetime('now'))`,
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
  ).run(randomUUID(), PRODUCT_ID, WAREHOUSE_ID, `MOV-RPT-${Date.now()}`);

  db.close();
}

test('staff daily report', async () => {
  const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'staff-report-test-'));
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
          body: JSON.stringify({
            tenant: 'default',
            username: 'reportseller@test.com',
            password: 'secret123',
          }),
        });
        assert.equal(loginRes.status, 200);
        const { access_token: token } = await loginRes.json();

        const openRes = await fetch(`${base}/v1/staff/shifts/open`, {
          method: 'POST',
          headers: authHeader(token),
          body: JSON.stringify({ opening_cash: 50000 }),
        });
        assert.equal(openRes.status, 201);

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

        const reportRes = await fetch(`${base}/v1/staff/reports/daily`, {
          headers: authHeader(token),
        });
        assert.equal(reportRes.status, 200);
        const reportBody = await reportRes.json();
        assert.ok(isYmd(reportBody.data.date), 'report date should be YYYY-MM-DD');
        assert.equal(reportBody.data.order_count, 1);
        assert.ok(Number(reportBody.data.total_sales) >= 24000);
        assert.ok(Number(reportBody.data.cash_total) >= 24000);
        assert.ok(reportBody.data.open_shift);
        assert.ok(reportBody.data.open_shift.shift_number);
      } finally {
        server.close();
        clearTenantDbCache();
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    },
  );
});

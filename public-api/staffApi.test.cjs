'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const express = require('express');
const http = require('http');

const { runMigrations } = require('../electron/db/migrate.cjs');
const {
  signStaffAccessToken,
  signStaffRefreshToken,
  verifyStaffAccessToken,
  verifyStaffRefreshToken,
  newJti,
} = require('./lib/staffJwt.cjs');
const { isStaffRoleAllowed } = require('./lib/staffRoles.cjs');
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

test('staff JWT sign and verify', () =>
  withEnv({ STAFF_JWT_SECRET: TEST_SECRET, STAFF_JWT_REFRESH_SECRET: TEST_SECRET + '-r' }, () => {
    const jti = newJti();
    const access = signStaffAccessToken('u1', 'sales', 'default');
    const refresh = signStaffRefreshToken('u1', jti, 'default');
    const ap = verifyStaffAccessToken(access);
    assert.equal(ap.sub, 'u1');
    assert.equal(ap.role, 'sales');
    assert.equal(ap.tenant, 'default');
    const rp = verifyStaffRefreshToken(refresh);
    assert.equal(rp.jti, jti);
  }));

test('isStaffRoleAllowed accepts admin manager sales cashier', () => {
  assert.equal(isStaffRoleAllowed('admin'), true);
  assert.equal(isStaffRoleAllowed('manager'), true);
  assert.equal(isStaffRoleAllowed('sales'), true);
  assert.equal(isStaffRoleAllowed('cashier'), true);
  assert.equal(isStaffRoleAllowed('courier'), false);
});

const { staffCanAccessArea } = require('./lib/staffRoles.cjs');

test('staffCanAccessArea blocks cashier from web orders and purchasing', () => {
  assert.equal(staffCanAccessArea('cashier', 'sales'), true);
  assert.equal(staffCanAccessArea('cashier', 'orders'), false);
  assert.equal(staffCanAccessArea('cashier', 'purchaseOrders'), false);
  assert.equal(staffCanAccessArea('cashier', 'suppliers'), false);
  assert.equal(staffCanAccessArea('cashier', 'expenses'), false);
  assert.equal(staffCanAccessArea('cashier', 'cost'), false);
  assert.equal(staffCanAccessArea('sales', 'orders'), true);
  assert.equal(staffCanAccessArea('sales', 'cost'), true);
});

test('staff auth login and orders list (integration)', async () => {
  const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'staff-api-test-'));
  const dbPath = path.join(tmpDir, 'pos.db');
  const db = new Database(dbPath);
  runMigrations(db);
  ensureStaffSchema(db);

  db.prepare(
    `
    INSERT OR IGNORE INTO roles (id, code, name, description, is_active, created_at)
    VALUES ('role-sales-001', 'sales', 'Sales', 'Sales role', 1, datetime('now'))
  `,
  ).run();

  const userId = 'staff-user-001';
  db.prepare(
    `
    INSERT INTO users (id, username, full_name, email, password_hash, is_active, created_at, updated_at)
    VALUES (?, 'sales@test.com', 'Sales User', 'sales@test.com', ?, 1, datetime('now'), datetime('now'))
  `,
  ).run(userId, hashPassword('secret123'));

  db.prepare(
    `
    INSERT INTO user_roles (id, user_id, role_id, assigned_at)
    VALUES ('ur-sales-001', ?, 'role-sales-001', datetime('now'))
  `,
  ).run(userId);

  db.prepare(`INSERT INTO marketplace_customers (id, telegram_id, first_name, phone) VALUES (1, 111, 'Ali', '998901234567')`).run();
  db.prepare(
    `
    INSERT INTO web_orders (order_number, customer_id, status, payment_method, payment_status, total_amount, delivery_method, created_at, updated_at)
    VALUES ('WO-TEST-1', 1, 'new', 'cash', 'pending', 50000, 'courier', datetime('now'), datetime('now'))
  `,
  ).run();
  db.close();

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

      try {
        const loginRes = await fetch(`http://127.0.0.1:${port}/v1/staff/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tenant: 'default',
            username: 'sales@test.com',
            password: 'secret123',
          }),
        });
        assert.equal(loginRes.status, 200);
        const loginBody = await loginRes.json();
        assert.ok(loginBody.access_token);
        assert.ok(loginBody.refresh_token);
        assert.equal(loginBody.user.role, 'sales');

        const badRes = await fetch(`http://127.0.0.1:${port}/v1/staff/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tenant: 'default', username: 'sales@test.com', password: 'wrong' }),
        });
        assert.equal(badRes.status, 401);

        const queuesRes = await fetch(`http://127.0.0.1:${port}/v1/staff/orders/queues`, {
          headers: { Authorization: `Bearer ${loginBody.access_token}` },
        });
        assert.equal(queuesRes.status, 200);
        const queuesBody = await queuesRes.json();
        assert.ok(queuesBody.data.incoming >= 1);

        const listRes = await fetch(`http://127.0.0.1:${port}/v1/staff/orders?queue=incoming`, {
          headers: { Authorization: `Bearer ${loginBody.access_token}` },
        });
        assert.equal(listRes.status, 200);
        const listBody = await listRes.json();
        assert.ok(Array.isArray(listBody.data));
        assert.ok(listBody.data.some((o) => o.order_number === 'WO-TEST-1'));

        const refreshRes = await fetch(`http://127.0.0.1:${port}/v1/staff/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh_token: loginBody.refresh_token }),
        });
        assert.equal(refreshRes.status, 200);
        const refreshBody = await refreshRes.json();
        assert.ok(refreshBody.access_token);
      } finally {
        server.close();
        clearTenantDbCache();
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    },
  );
});

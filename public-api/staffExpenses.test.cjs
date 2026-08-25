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
const STAFF_USER_ID = 'staff-exp-001';
const EXPENSE_CAT_ID = 'exp-cat-rent-001';

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
     VALUES (?, 'expseller@test.com', 'Exp Seller', 'expseller@test.com', ?, 1, datetime('now'), datetime('now'))`,
  ).run(STAFF_USER_ID, hashPassword('secret123'));

  db.prepare(
    `INSERT INTO user_roles (id, user_id, role_id, assigned_at)
     VALUES ('ur-exp-sell-001', ?, 'role-sales-001', datetime('now'))`,
  ).run(STAFF_USER_ID);

  db.prepare(
    `INSERT INTO expense_categories (id, code, name, description, is_active, created_at)
     VALUES (?, 'RENT', 'Ijara', 'Ijara xarajati', 1, datetime('now'))`,
  ).run(EXPENSE_CAT_ID);

  db.close();
}

function authHeader(token) {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

test('staff expenses (integration)', async () => {
  const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'staff-exp-test-'));
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

      try {
        const loginRes = await fetch(`${base}/v1/staff/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tenant: 'default',
            username: 'expseller@test.com',
            password: 'secret123',
          }),
        });
        assert.equal(loginRes.status, 200);
        const loginBody = await loginRes.json();
        const token = loginBody.access_token;

        const catRes = await fetch(`${base}/v1/staff/expenses/categories`, {
          headers: authHeader(token),
        });
        assert.equal(catRes.status, 200);
        const catBody = await catRes.json();
        assert.ok(Array.isArray(catBody.data));
        assert.ok(catBody.data.some((c) => c.id === EXPENSE_CAT_ID));

        const listEmptyRes = await fetch(`${base}/v1/staff/expenses`, {
          headers: authHeader(token),
        });
        assert.equal(listEmptyRes.status, 200);
        const listEmptyBody = await listEmptyRes.json();
        assert.equal(listEmptyBody.data.length, 0);

        const badRes = await fetch(`${base}/v1/staff/expenses`, {
          method: 'POST',
          headers: authHeader(token),
          body: JSON.stringify({ category_id: EXPENSE_CAT_ID, amount: 0, description: 'test' }),
        });
        assert.equal(badRes.status, 400);

        const createRes = await fetch(`${base}/v1/staff/expenses`, {
          method: 'POST',
          headers: authHeader(token),
          body: JSON.stringify({
            category_id: EXPENSE_CAT_ID,
            amount: 25000,
            description: 'Ofis ijarasi',
            notes: 'mobil test',
          }),
        });
        assert.equal(createRes.status, 201, JSON.stringify(await createRes.clone().json()));
        const createBody = await createRes.json();
        assert.equal(createBody.data.amount, 25000);
        assert.equal(createBody.data.category_name, 'Ijara');
        assert.ok(createBody.data.expense_number);

        const listRes = await fetch(`${base}/v1/staff/expenses`, {
          headers: authHeader(token),
        });
        assert.equal(listRes.status, 200);
        const listBody = await listRes.json();
        assert.equal(listBody.data.length, 1);
        assert.equal(listBody.data[0].description, 'Ofis ijarasi');
      } finally {
        server.close();
        clearTenantDbCache();
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    },
  );
});

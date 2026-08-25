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

const SALES_USER_ID = 'staff-products-001';
const PRODUCT_ID = 'prod-cost-001';
const WAREHOUSE_ID = 'main-warehouse-001';
const OLD_BATCH_ID = 'batch-old-001';
const NEW_BATCH_ID = 'batch-new-001';

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
     VALUES (?, 'coster@test.com', 'Cost Seller', 'coster@test.com', ?, 1, datetime('now'), datetime('now'))`,
  ).run(SALES_USER_ID, hashPassword('secret123'));

  db.prepare(
    `INSERT INTO user_roles (id, user_id, role_id, assigned_at)
     VALUES ('ur-products-001', ?, 'role-sales-001', datetime('now'))`,
  ).run(SALES_USER_ID);

  // Default warehouse is normally seeded by migrations; ensure it exists.
  db.prepare(
    `INSERT OR IGNORE INTO warehouses (id, name, is_active, created_at)
     VALUES (?, 'Main', 1, datetime('now'))`,
  ).run(WAREHOUSE_ID);

  // Product with a base purchase_price (tan narx) of 6000.
  db.prepare(
    `INSERT INTO products (id, sku, barcode, name, unit, sale_price, purchase_price, current_stock, track_stock, is_active, created_at, updated_at)
     VALUES (?, 'SKU-COST-1', '8690001234567', 'Cost Cola', 'pcs', 12000, 6000, 15, 1, 1, datetime('now'), datetime('now'))`,
  ).run(PRODUCT_ID);

  // Two batches at DIFFERENT unit costs / dates. Newest (more expensive) first.
  db.prepare(
    `INSERT INTO inventory_batches (
       id, product_id, warehouse_id, opened_at, unit_cost, initial_qty, remaining_qty,
       source_type, source_id, supplier_id, supplier_name, doc_no, status, created_at
     ) VALUES (?, ?, ?, '2026-01-10 09:00:00', 6000, 10, 4, 'purchase_receive', 'po-001', 'sup-1', 'Bozor Supply', 'PO-001', 'active', '2026-01-10 09:00:00')`,
  ).run(OLD_BATCH_ID, PRODUCT_ID, WAREHOUSE_ID);

  db.prepare(
    `INSERT INTO inventory_batches (
       id, product_id, warehouse_id, opened_at, unit_cost, initial_qty, remaining_qty,
       source_type, source_id, supplier_id, supplier_name, doc_no, status, created_at
     ) VALUES (?, ?, ?, '2026-03-15 09:00:00', 7500, 8, 8, 'purchase_receive', 'po-002', 'sup-2', 'Optom Trade', 'PO-002', 'active', '2026-03-15 09:00:00')`,
  ).run(NEW_BATCH_ID, PRODUCT_ID, WAREHOUSE_ID);

  db.close();
}

test('staff products: cost price + batch history (RBAC + ordering + amounts)', async () => {
  const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'staff-products-test-'));
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
        const token = signStaffAccessToken(SALES_USER_ID, 'sales', 'default');

        // 1. Search returns the product with a visible cost_price (= purchase_price).
        const searchRes = await fetch(`${base}/v1/staff/products/search?q=SKU-COST-1`, {
          headers: authHeader(token),
        });
        assert.equal(searchRes.status, 200);
        const searchBody = await searchRes.json();
        const found = searchBody.data.find((p) => p.id === PRODUCT_ID);
        assert.ok(found, 'product should be in search results');
        assert.equal(Number(found.cost_price), 6000);

        // 1b. Barcode exact match ranks first (POS scanner lookup).
        const barcodeRes = await fetch(`${base}/v1/staff/products/search?q=8690001234567`, {
          headers: authHeader(token),
        });
        assert.equal(barcodeRes.status, 200);
        const barcodeBody = await barcodeRes.json();
        assert.ok(barcodeBody.data.length >= 1);
        assert.equal(barcodeBody.data[0].id, PRODUCT_ID);
        assert.equal(barcodeBody.data[0].barcode, '8690001234567');

        // 2. Detail returns cost_price + cost_summary derived from batches.
        const detailRes = await fetch(`${base}/v1/staff/products/${PRODUCT_ID}`, {
          headers: authHeader(token),
        });
        assert.equal(detailRes.status, 200);
        const detailBody = await detailRes.json();
        assert.equal(Number(detailBody.data.cost_price), 6000);
        assert.ok(detailBody.data.cost_summary, 'cost_summary present');
        assert.equal(detailBody.data.cost_summary.batch_count, 2);
        assert.equal(Number(detailBody.data.cost_summary.latest_cost), 7500);
        assert.equal(Number(detailBody.data.cost_summary.min_cost), 6000);
        assert.equal(Number(detailBody.data.cost_summary.max_cost), 7500);
        // Weighted avg over remaining qty: (4*6000 + 8*7500) / 12 = 7000.
        assert.equal(Number(detailBody.data.cost_summary.avg_cost), 7000);

        // 3. Batches endpoint returns both batches newest-first with correct fields.
        const batchesRes = await fetch(`${base}/v1/staff/products/${PRODUCT_ID}/batches`, {
          headers: authHeader(token),
        });
        assert.equal(batchesRes.status, 200);
        const batchesBody = await batchesRes.json();
        assert.ok(Array.isArray(batchesBody.data));
        assert.equal(batchesBody.data.length, 2);

        const [newest, oldest] = batchesBody.data;
        assert.equal(newest.batch_id, NEW_BATCH_ID);
        assert.equal(Number(newest.unit_cost), 7500);
        assert.equal(Number(newest.quantity), 8);
        assert.equal(Number(newest.remaining_quantity), 8);
        assert.equal(newest.received_at, '2026-03-15 09:00:00');
        assert.equal(newest.supplier_name, 'Optom Trade');
        assert.equal(newest.purchase_order_id, 'po-002');

        assert.equal(oldest.batch_id, OLD_BATCH_ID);
        assert.equal(Number(oldest.unit_cost), 6000);
        assert.equal(Number(oldest.quantity), 10);
        assert.equal(Number(oldest.remaining_quantity), 4);
        assert.equal(oldest.supplier_name, 'Bozor Supply');

        assert.equal(batchesBody.summary.batch_count, 2);
        assert.equal(Number(batchesBody.summary.avg_cost), 7000);

        // 4. Cashier may auth, but cost/batch history stays forbidden.
        const cashierToken = signStaffAccessToken(SALES_USER_ID, 'cashier', 'default');
        const cashierRes = await fetch(`${base}/v1/staff/products/${PRODUCT_ID}/batches`, {
          headers: authHeader(cashierToken),
        });
        assert.equal(cashierRes.status, 403);

        // 5. Unknown product → 404.
        const missingRes = await fetch(`${base}/v1/staff/products/does-not-exist/batches`, {
          headers: authHeader(token),
        });
        assert.equal(missingRes.status, 404);
      } finally {
        server.close();
        clearTenantDbCache();
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    },
  );
});

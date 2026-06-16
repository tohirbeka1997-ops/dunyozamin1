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
const STAFF_USER_ID = 'staff-cust-001';
const CUSTOMER_ID = 'cust-test-001';
const SUPPLIER_ID = 'sup-test-001';
const PRODUCT_ID = 'prod-po-001';
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

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
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
     VALUES (?, 'custseller@test.com', 'Cust Seller', 'custseller@test.com', ?, 1, datetime('now'), datetime('now'))`,
  ).run(STAFF_USER_ID, sha256('secret123'));

  db.prepare(
    `INSERT INTO user_roles (id, user_id, role_id, assigned_at)
     VALUES ('ur-cust-sell-001', ?, 'role-sales-001', datetime('now'))`,
  ).run(STAFF_USER_ID);

  db.prepare(
    `INSERT INTO customers (id, name, phone, status, balance, total_sales, total_orders, created_at, updated_at)
     VALUES (?, 'Test Mijoz', '998901234567', 'active', -50000, 0, 0, datetime('now'), datetime('now'))`,
  ).run(CUSTOMER_ID);

  db.prepare(
    `INSERT INTO customers (id, name, phone, status, balance, total_sales, total_orders, created_at, updated_at)
     VALUES ('cust-ali-001', 'Alisher Karimov', '998901112233', 'active', 0, 0, 0, datetime('now'), datetime('now'))`,
  ).run();

  db.prepare(
    `INSERT INTO suppliers (id, name, phone, status, created_at, updated_at)
     VALUES (?, 'Test Supplier', '998909876543', 'active', datetime('now'), datetime('now'))`,
  ).run(SUPPLIER_ID);

  db.prepare(
    `INSERT INTO products (id, sku, name, unit, sale_price, purchase_price, current_stock, track_stock, is_active, created_at, updated_at)
     VALUES (?, 'SKU-PO-1', 'PO Product', 'pcs', 15000, 8000, 5, 1, 1, datetime('now'), datetime('now'))`,
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
  ).run(randomUUID(), PRODUCT_ID, WAREHOUSE_ID, `MOV-PO-${Date.now()}`);

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

test('staff customers, suppliers, purchase orders (integration)', async () => {
  const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'staff-cust-test-'));
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
          body: JSON.stringify({ tenant: 'default', username: 'custseller@test.com', password: 'secret123' }),
        });
        assert.equal(loginRes.status, 200);
        const { access_token: token } = await loginRes.json();

        // Customer search + detail balance
        const searchRes = await fetch(`${base}/v1/staff/customers/search?q=Test`, {
          headers: authHeader(token),
        });
        assert.equal(searchRes.status, 200);
        const searchBody = await searchRes.json();
        assert.ok(searchBody.data.some((c) => c.id === CUSTOMER_ID));
        const listed = searchBody.data.find((c) => c.id === CUSTOMER_ID);
        assert.equal(Number(listed.balance_uzs), -50000);

        const aliRes = await fetch(`${base}/v1/staff/customers/search?q=Ali`, {
          headers: authHeader(token),
        });
        assert.equal(aliRes.status, 200);
        const aliBody = await aliRes.json();
        assert.ok(
          aliBody.data.some((c) => c.id === 'cust-ali-001'),
          'partial name search "Ali" should match Alisher Karimov',
        );

        const aliLowerRes = await fetch(`${base}/v1/staff/customers/search?q=ali`, {
          headers: authHeader(token),
        });
        assert.equal(aliLowerRes.status, 200);
        const aliLowerBody = await aliLowerRes.json();
        assert.ok(
          aliLowerBody.data.some((c) => c.id === 'cust-ali-001'),
          'case-insensitive search "ali" should match Alisher Karimov',
        );

        const detailRes = await fetch(`${base}/v1/staff/customers/${CUSTOMER_ID}`, {
          headers: authHeader(token),
        });
        assert.equal(detailRes.status, 200);
        const detailBody = await detailRes.json();
        assert.equal(Number(detailBody.data.balance_uzs), -50000);

        // Create customer
        const createRes = await fetch(`${base}/v1/staff/customers`, {
          method: 'POST',
          headers: authHeader(token),
          body: JSON.stringify({
            name: 'Yangi Mijoz',
            phone: '998909998877',
            notes: 'VIP mijoz',
          }),
        });
        assert.equal(createRes.status, 201);
        const createBody = await createRes.json();
        assert.equal(createBody.data.name, 'Yangi Mijoz');
        assert.equal(createBody.data.phone, '+998909998877');
        assert.equal(createBody.data.notes, 'VIP mijoz');
        const newCustId = createBody.data.id;
        assert.ok(newCustId);

        const createBadRes = await fetch(`${base}/v1/staff/customers`, {
          method: 'POST',
          headers: authHeader(token),
          body: JSON.stringify({ phone: '998900000000' }),
        });
        assert.equal(createBadRes.status, 400);

        // Update customer
        const patchRes = await fetch(`${base}/v1/staff/customers/${newCustId}`, {
          method: 'PATCH',
          headers: authHeader(token),
          body: JSON.stringify({ name: 'Yangi Mijoz 2', notes: 'Yangilangan' }),
        });
        assert.equal(patchRes.status, 200);
        const patchBody = await patchRes.json();
        assert.equal(patchBody.data.name, 'Yangi Mijoz 2');
        assert.equal(patchBody.data.notes, 'Yangilangan');

        // Supplier list
        const supRes = await fetch(`${base}/v1/staff/suppliers/search?q=Supplier`, {
          headers: authHeader(token),
        });
        assert.equal(supRes.status, 200);
        const supBody = await supRes.json();
        assert.ok(supBody.data.some((s) => s.id === SUPPLIER_ID));

        // Open shift for sale + payment
        const openRes = await fetch(`${base}/v1/staff/shifts/open`, {
          method: 'POST',
          headers: authHeader(token),
          body: JSON.stringify({ opening_cash: 0 }),
        });
        assert.equal(openRes.status, 201);

        // Receive payment reduces debt (balance increases toward zero)
        const payRes = await fetch(`${base}/v1/staff/customers/${CUSTOMER_ID}/receive-payment`, {
          method: 'POST',
          headers: authHeader(token),
          body: JSON.stringify({ amount: 20000, payment_method: 'cash' }),
        });
        assert.equal(payRes.status, 201);
        const payBody = await payRes.json();
        assert.equal(Number(payBody.data.new_balance), -30000);

        // Credit sale increases debt
        const sellRes = await fetch(`${base}/v1/staff/sales`, {
          method: 'POST',
          headers: authHeader(token),
          body: JSON.stringify({
            items: [{ product_id: PRODUCT_ID, quantity: 1 }],
            payment_method: 'credit',
            customer_id: CUSTOMER_ID,
            order_uuid: randomUUID(),
          }),
        });
        assert.equal(sellRes.status, 201);
        const sellBody = await sellRes.json();
        assert.equal(sellBody.data.payment_status, 'on_credit');
        assert.equal(Number(sellBody.data.credit_amount), 15000);

        const afterSellRes = await fetch(`${base}/v1/staff/customers/${CUSTOMER_ID}`, {
          headers: authHeader(token),
        });
        const afterSell = await afterSellRes.json();
        assert.equal(Number(afterSell.data.balance_uzs), -45000);

        // Ledger has entries
        const ledgerRes = await fetch(`${base}/v1/staff/customers/${CUSTOMER_ID}/ledger`, {
          headers: authHeader(token),
        });
        assert.equal(ledgerRes.status, 200);
        const ledgerBody = await ledgerRes.json();
        assert.ok(Array.isArray(ledgerBody.data));
        assert.ok(ledgerBody.data.length >= 1);

        // Create PO + receive goods
        const stockBefore = stockOf(dbPath, PRODUCT_ID);
        const createPoRes = await fetch(`${base}/v1/staff/purchase-orders`, {
          method: 'POST',
          headers: authHeader(token),
          body: JSON.stringify({
            supplier_id: SUPPLIER_ID,
            items: [{ product_id: PRODUCT_ID, ordered_qty: 3, unit_cost: 7000 }],
          }),
        });
        assert.equal(createPoRes.status, 201);
        const createPoBody = await createPoRes.json();
        const poId = createPoBody.data.id;
        const poItemId = createPoBody.data.items[0].id;

        const recvRes = await fetch(`${base}/v1/staff/purchase-orders/${poId}/receive`, {
          method: 'POST',
          headers: authHeader(token),
          body: JSON.stringify({
            items: [{ item_id: poItemId, received_qty: 3 }],
          }),
        });
        assert.equal(recvRes.status, 200);
        const recvBody = await recvRes.json();
        assert.ok(['received', 'partially_received'].includes(recvBody.data.status));
        assert.equal(stockOf(dbPath, PRODUCT_ID), stockBefore + 3);

        // USD supplier: mobile payload (UZS unit_cost, no currency) must succeed when FX exists
        const usdDb = new Database(dbPath);
        const usdSupplierId = 'sup-usd-test-001';
        usdDb.prepare(
          `INSERT INTO suppliers (id, name, phone, status, settlement_currency, created_at, updated_at)
           VALUES (?, 'USD Supplier', '998901112233', 'active', 'USD', datetime('now'), datetime('now'))`,
        ).run(usdSupplierId);
        usdDb.prepare(
          `INSERT INTO exchange_rates (id, base_currency, quote_currency, rate, effective_date, source, created_at, updated_at)
           VALUES (?, 'USD', 'UZS', 12800, date('now'), 'test', datetime('now'), datetime('now'))`,
        ).run(randomUUID());
        usdDb.close();

        const usdPoRes = await fetch(`${base}/v1/staff/purchase-orders`, {
          method: 'POST',
          headers: authHeader(token),
          body: JSON.stringify({
            supplier_id: usdSupplierId,
            items: [{ product_id: PRODUCT_ID, ordered_qty: 2, unit_cost: 12800 }],
          }),
        });
        const usdPoBody = await usdPoRes.json();
        assert.equal(usdPoRes.status, 201, JSON.stringify(usdPoBody));
        assert.equal(usdPoBody.data.currency, 'USD');
        assert.ok(Number(usdPoBody.data.fx_rate) > 0);

        // Supplier detail shows balance after PO receive
        const supDetailRes = await fetch(`${base}/v1/staff/suppliers/${SUPPLIER_ID}`, {
          headers: authHeader(token),
        });
        assert.equal(supDetailRes.status, 200);
        const supDetailBody = await supDetailRes.json();
        assert.ok(Number(supDetailBody.data.balance) > 0, 'supplier balance should reflect received PO');

        // Pay supplier reduces balance
        const supPayRes = await fetch(`${base}/v1/staff/suppliers/${SUPPLIER_ID}/pay`, {
          method: 'POST',
          headers: authHeader(token),
          body: JSON.stringify({ amount: 5000, method: 'cash', notes: 'test pay' }),
        });
        assert.equal(supPayRes.status, 201);
        const supPayBody = await supPayRes.json();
        assert.ok(supPayBody.data.payment);
        assert.ok(Number(supPayBody.data.supplier.balance) < Number(supDetailBody.data.balance));

        // Supplier ledger after PO + payment
        const supLedgerRes = await fetch(`${base}/v1/staff/suppliers/${SUPPLIER_ID}/ledger?limit=50`, {
          headers: authHeader(token),
        });
        assert.equal(supLedgerRes.status, 200);
        const supLedgerBody = await supLedgerRes.json();
        assert.ok(Array.isArray(supLedgerBody.data));
        assert.ok(supLedgerBody.data.length >= 2, 'ledger should include PO and payment');
        const purchaseEntry = supLedgerBody.data.find((e) => e.type === 'PURCHASE');
        const paymentEntry = supLedgerBody.data.find((e) => e.type === 'PAYMENT');
        assert.ok(purchaseEntry);
        assert.ok(paymentEntry);
        assert.ok(Number(purchaseEntry.debit) > 0);
        assert.ok(Number(paymentEntry.credit) > 0);
        assert.equal(supLedgerBody.meta.limit, 50);

        const supPayBadRes = await fetch(`${base}/v1/staff/suppliers/${SUPPLIER_ID}/pay`, {
          method: 'POST',
          headers: authHeader(token),
          body: JSON.stringify({ amount: 0 }),
        });
        assert.equal(supPayBadRes.status, 400);

        // Device register (FCM foundation)
        const devRes = await fetch(`${base}/v1/staff/devices/register`, {
          method: 'POST',
          headers: authHeader(token),
          body: JSON.stringify({
            fcm_token: 'test-fcm-token-abc',
            platform: 'ios',
            device_id: 'device-test-001',
          }),
        });
        assert.equal(devRes.status, 201);
        const devBody = await devRes.json();
        assert.equal(devBody.data.registered, true);

        const devUpdateRes = await fetch(`${base}/v1/staff/devices/register`, {
          method: 'POST',
          headers: authHeader(token),
          body: JSON.stringify({
            fcm_token: 'test-fcm-token-xyz',
            platform: 'ios',
            device_id: 'device-test-001',
          }),
        });
        assert.equal(devUpdateRes.status, 200);
        const devUpdateBody = await devUpdateRes.json();
        assert.equal(devUpdateBody.data.updated, true);
      } finally {
        server.close();
        clearTenantDbCache();
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    },
  );
});

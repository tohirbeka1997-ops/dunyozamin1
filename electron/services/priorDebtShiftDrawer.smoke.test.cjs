'use strict';

/**
 * P0: prior_debt_payment must hit shift drawer via customer_payments.
 * Run: electron electron/services/priorDebtShiftDrawer.smoke.test.cjs
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { randomUUID } = require('crypto');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-prior-debt-drawer-'));
process.env.POS_SERVER_MODE = '1';
process.env.POS_DATA_DIR = tmpDir;
process.env.POS_VERBOSE_LOGS = '0';

const { open, close, getDb } = require('../db/open.cjs');
const { createServices } = require('./index.cjs');
const { readBalanceInCurrency } = require('../lib/customerBalance.cjs');

const WH = 'main-warehouse-001';
const ADMIN = 'default-admin-001';

function bal(db, customerId) {
  return readBalanceInCurrency(db, customerId, 'UZS');
}

function cartLine(product, qty, unitPrice) {
  return {
    product_id: product.id,
    product_name: product.name,
    quantity: qty,
    qty_sale: qty,
    qty_base: qty,
    unit_price: unitPrice,
    line_total: unitPrice * qty,
  };
}

let passed = 0;
let failed = 0;

function ok(name) {
  passed += 1;
  console.log(`  ✓ ${name}`);
}

function fail(name, err) {
  failed += 1;
  console.log(`  ✗ ${name}`);
  console.log(`     ${err && err.message ? err.message : err}`);
}

function runStep(name, fn) {
  try {
    fn();
    ok(name);
  } catch (e) {
    fail(name, e);
  }
}

console.log('\n=== PRIOR DEBT → SHIFT DRAWER SMOKE ===');
console.log(`Temp DB: ${tmpDir}\n`);

try {
  open();
  const db = getDb();
  const { products, inventory, sales, shifts, customers } = createServices(db);

  assert.ok(
    sales.customers && typeof sales.customers.recordDrawerPaymentOnly === 'function',
    'sales.customers.recordDrawerPaymentOnly wired'
  );
  ok('customers service wired onto sales');

  const product = products.create({
    name: 'Prior Debt Drawer Product',
    sku: `PDD-${Date.now()}`,
    sale_price: 10000,
    purchase_price: 4000,
    track_stock: 1,
    current_stock: 0,
    unit: 'pcs',
    base_unit: 'pcs',
  });
  inventory.adjustStock({
    warehouse_id: WH,
    adjustment_type: 'set',
    reason: 'prior debt drawer smoke stock',
    created_by: ADMIN,
    items: [{ product_id: product.id, target_quantity: 50 }],
  });

  const customer = customers.create({
    name: 'Prior Debt Drawer Customer',
    phone: '+998901239911',
    allow_credit: 1,
    allow_debt: 1,
    credit_limit: 50000000,
  });
  const customerId = customer.id;

  const shift = shifts.openShift({
    user_id: ADMIN,
    opening_cash: 100000,
  });
  ok('open shift with opening cash 100000');

  // Seed prior debt: full credit sale 30000
  sales.completePOSOrder(
    {
      total_amount: 30000,
      customer_id: customerId,
      shift_id: shift.id,
      user_id: ADMIN,
      order_uuid: randomUUID(),
    },
    [cartLine(product, 3, 10000)],
    []
  );
  assert.strictEqual(bal(db, customerId), -30000);
  ok('seed credit sale → balance -30000');

  const summaryBefore = shifts.getShiftSummary(shift.id);
  const expectedBefore = Number(summaryBefore.expectedCash ?? 0) || 0;
  const drawerBefore = Number(summaryBefore.customerDrawerCashNet ?? 0) || 0;
  assert.strictEqual(drawerBefore, 0);
  ok(`baseline expectedCash=${expectedBefore}, customerDrawerCashNet=0`);

  // New sale: 10000 cash merch + 15000 prior_debt_payment (no new credit)
  const PRIOR = 15000;
  const MERCH = 10000;
  sales.completePOSOrder(
    {
      total_amount: MERCH,
      paid_amount: MERCH,
      credit_amount: 0,
      customer_id: customerId,
      shift_id: shift.id,
      user_id: ADMIN,
      prior_debt_payment: PRIOR,
      order_uuid: randomUUID(),
    },
    [cartLine(product, 1, MERCH)],
    [{ payment_method: 'cash', amount: MERCH }]
  );

  runStep('balance reduced by prior debt (not double-applied)', () => {
    // -30000 + 15000 prior = -15000; merch fully paid so no new credit
    assert.strictEqual(bal(db, customerId), -15000);
  });

  runStep('customer_payments row exists with shift_id and cash amount', () => {
    const row = db
      .prepare(
        `
        SELECT amount, payment_method, shift_id, operation, old_balance, order_id
        FROM customer_payments
        WHERE customer_id = ? AND shift_id = ? AND ABS(amount - ?) < 0.01
        ORDER BY rowid DESC LIMIT 1
      `
      )
      .get(customerId, shift.id, PRIOR);
    assert.ok(row, 'expected customer_payments row for prior debt');
    assert.strictEqual(String(row.payment_method).toLowerCase(), 'cash');
    assert.strictEqual(row.shift_id, shift.id);
    assert.ok(!row.operation || row.operation === 'payment_in');
    assert.ok(Number(row.old_balance) < -0.009, 'old_balance should show prior debt');
  });

  runStep('shift rollup / expected cash includes prior debt cash', () => {
    const summary = shifts.getShiftSummary(shift.id);
    const drawer = Number(summary.customerDrawerCashNet ?? 0) || 0;
    const debtCash = Number(summary.debtRepaidCash ?? 0) || 0;
    const expected = Number(summary.expectedCash ?? 0) || 0;
    assert.strictEqual(drawer, PRIOR, `customerDrawerCashNet expected ${PRIOR}, got ${drawer}`);
    assert.ok(debtCash >= PRIOR - 0.01, `debtRepaidCash expected >= ${PRIOR}, got ${debtCash}`);
    // opening 100000 + merch cash 10000 + prior 15000 = 125000
    assert.strictEqual(
      expected,
      expectedBefore + MERCH + PRIOR,
      `expectedCash ${expected} !== ${expectedBefore + MERCH + PRIOR}`
    );
  });

  runStep('idempotent replay does not double drawer cash', () => {
    const uuid = randomUUID();
    const first = sales.completePOSOrder(
      {
        total_amount: MERCH,
        paid_amount: MERCH,
        customer_id: customerId,
        shift_id: shift.id,
        user_id: ADMIN,
        prior_debt_payment: 5000,
        order_uuid: uuid,
      },
      [cartLine(product, 1, MERCH)],
      [{ payment_method: 'cash', amount: MERCH }]
    );
    const mid = shifts.getShiftSummary(shift.id);
    const drawerMid = Number(mid.customerDrawerCashNet ?? 0) || 0;

    const second = sales.completePOSOrder(
      {
        total_amount: MERCH,
        paid_amount: MERCH,
        customer_id: customerId,
        shift_id: shift.id,
        user_id: ADMIN,
        prior_debt_payment: 5000,
        order_uuid: uuid,
      },
      [cartLine(product, 1, MERCH)],
      [{ payment_method: 'cash', amount: MERCH }]
    );
    assert.strictEqual(second.order_id, first.order_id);
    const after = shifts.getShiftSummary(shift.id);
    const drawerAfter = Number(after.customerDrawerCashNet ?? 0) || 0;
    assert.strictEqual(drawerAfter, drawerMid, 'replay must not double prior-debt drawer cash');
  });

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  close();
  process.exit(failed ? 1 : 0);
} catch (err) {
  fail('fatal', err);
  console.error(err);
  try {
    close();
  } catch {
    /* ignore */
  }
  process.exit(1);
}

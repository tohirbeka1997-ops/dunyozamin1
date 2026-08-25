/* eslint-disable no-console */
/**
 * Two partial payments against the same order_id must both apply when payment_uuid differs.
 * Same payment_uuid must apply only once (idempotent retry).
 *
 * Run: electron electron/services/customersReceivePayment.uuid.smoke.test.cjs
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { randomUUID } = require('crypto');

const WH = 'main-warehouse-001';
const ADMIN = 'default-admin-001';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-pay-uuid-smoke-'));
process.env.POS_SERVER_MODE = '1';
process.env.POS_DATA_DIR = tmpDir;
process.env.POS_VERBOSE_LOGS = '0';

const { open, close, getDb } = require('../db/open.cjs');
const { createServices } = require('./index.cjs');
const { readBalanceInCurrency } = require('../lib/customerBalance.cjs');

function bal(db, customerId) {
  return readBalanceInCurrency(db, customerId, 'UZS');
}

function cartLine(product, qty, unitPrice = 5000) {
  const lineTotal = unitPrice * qty;
  return {
    product_id: product.id,
    product_name: product.name,
    quantity: qty,
    qty_sale: qty,
    qty_base: qty,
    unit_price: unitPrice,
    line_total: lineTotal,
  };
}

console.log('\n=== CUSTOMER receivePayment payment_uuid SMOKE ===');
console.log(`Temp DB: ${tmpDir}\n`);

let failed = 0;

try {
  open();
  const db = getDb();
  const { products, inventory, sales, shifts, customers } = createServices(db);

  const product = products.create({
    name: 'UUID Pay Smoke Product',
    sku: `UUID-PAY-${Date.now()}`,
    sale_price: 5000,
    purchase_price: 2000,
    track_stock: 1,
    current_stock: 0,
  });
  inventory.adjustStock({
    warehouse_id: WH,
    adjustment_type: 'set',
    reason: 'UUID pay smoke stock',
    created_by: ADMIN,
    items: [{ product_id: product.id, target_quantity: 50 }],
  });

  const customer = customers.create({
    name: 'UUID Pay Customer',
    phone: '+998901239901',
    allow_credit: 1,
    allow_debt: 1,
    credit_limit: 50000000,
  });
  const customerId = customer.id;
  const shift = shifts.openShift({ user_id: ADMIN });

  const creditSale = sales.completePOSOrder(
    {
      total_amount: 20000,
      customer_id: customerId,
      shift_id: shift.id,
      user_id: ADMIN,
    },
    [cartLine(product, 4, 5000)],
    [{ payment_method: 'credit', amount: 20000 }]
  );
  assert.strictEqual(bal(db, customerId), -20000);
  console.log('  ✓ credit sale → balance -20000');

  const orderId = creditSale.order_id;
  const uuid1 = randomUUID();
  const uuid2 = randomUUID();

  const pay1 = customers.receivePayment({
    customer_id: customerId,
    amount: 5000,
    payment_method: 'cash',
    operation: 'payment_in',
    order_id: orderId,
    received_by: ADMIN,
    payment_uuid: uuid1,
  });
  assert.notStrictEqual(pay1.duplicate, true);
  assert.strictEqual(bal(db, customerId), -15000);
  console.log('  ✓ first partial (uuid1) → -15000');

  const pay2 = customers.receivePayment({
    customer_id: customerId,
    amount: 7000,
    payment_method: 'cash',
    operation: 'payment_in',
    order_id: orderId,
    received_by: ADMIN,
    payment_uuid: uuid2,
  });
  assert.notStrictEqual(pay2.duplicate, true);
  assert.strictEqual(bal(db, customerId), -8000);
  console.log('  ✓ second partial same order_id, different uuid → -8000');

  const retry = customers.receivePayment({
    customer_id: customerId,
    amount: 7000,
    payment_method: 'cash',
    operation: 'payment_in',
    order_id: orderId,
    received_by: ADMIN,
    payment_uuid: uuid2,
  });
  assert.strictEqual(retry.duplicate, true);
  assert.strictEqual(bal(db, customerId), -8000);
  console.log('  ✓ retry same payment_uuid → duplicate, balance unchanged');

  const debt = customers.getTotalDebt();
  assert.ok(Number(debt.debt_uzs) >= 8000);
  console.log('  ✓ getTotalDebt includes UZS debt');

  // Soft-delete when balance/history without orders
  const lonely = customers.create({
    name: 'Soft Delete Balance',
    phone: '+998901239902',
  });
  customers.receivePayment({
    customer_id: lonely.id,
    amount: 1000,
    payment_method: 'cash',
    operation: 'payment_in',
    received_by: ADMIN,
    payment_uuid: randomUUID(),
  });
  assert.strictEqual(bal(db, lonely.id), 1000);
  const del = customers.delete(lonely.id);
  assert.strictEqual(del.softDeleted, true);
  assert.strictEqual(del.reason, 'has_balance_or_history');
  const stillThere = customers.getById(lonely.id);
  assert.strictEqual(stillThere.status, 'inactive');
  console.log('  ✓ delete with balance soft-deletes (has_balance_or_history)');

  console.log('\nAll payment_uuid smoke checks passed.\n');
} catch (e) {
  failed = 1;
  console.error('\nFAILED:', e && e.stack ? e.stack : e);
} finally {
  try {
    close();
  } catch {
    /* ignore */
  }
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

process.exit(failed ? 1 : 0);

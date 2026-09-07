'use strict';

/**
 * Close-shift expected cash must stay a physical till total.
 * Run: electron electron/services/shiftExpectedCash.smoke.test.cjs
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { randomUUID } = require('crypto');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-shift-expected-cash-'));
process.env.POS_SERVER_MODE = '1';
process.env.POS_DATA_DIR = tmpDir;
process.env.POS_VERBOSE_LOGS = '0';

const { open, close, getDb } = require('../db/open.cjs');
const { createServices } = require('./index.cjs');

const WH = 'main-warehouse-001';
const ADMIN = 'default-admin-001';

const OPENING = 91_000;
const CASH_SALE = 3_876_615;
const DEBT_CASH = 184_000;
const CASH_RETURN = 576_250;
const SANE_TILL = OPENING + CASH_SALE + DEBT_CASH - CASH_RETURN; // 3_575_365
const BUGGY_NEGATIVE = -4_967_635;
const LEAKED_SUPPLIER = 8_543_000;

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

console.log('\n=== SHIFT EXPECTED CASH SMOKE ===');
console.log(`Temp DB: ${tmpDir}\n`);

try {
  open();
  const db = getDb();
  const { products, inventory, sales, shifts, customers, suppliers, returns } = createServices(db);

  const product = products.create({
    name: 'Expected Cash Product',
    sku: `EXP-CASH-${Date.now()}`,
    sale_price: CASH_SALE,
    purchase_price: 1000,
    track_stock: 1,
    current_stock: 0,
    unit: 'pcs',
    base_unit: 'pcs',
  });
  inventory.adjustStock({
    warehouse_id: WH,
    adjustment_type: 'set',
    reason: 'expected cash smoke stock',
    created_by: ADMIN,
    items: [{ product_id: product.id, target_quantity: 20 }],
  });

  const customer = customers.create({
    name: 'Expected Cash Customer',
    phone: '+998901239922',
    allow_credit: 1,
    allow_debt: 1,
    credit_limit: 50_000_000,
  });

  const shift = shifts.openShift({
    user_id: ADMIN,
    opening_cash: OPENING,
  });
  ok(`open shift opening=${OPENING}`);

  sales.completePOSOrder(
    {
      total_amount: DEBT_CASH,
      customer_id: customer.id,
      shift_id: shift.id,
      user_id: ADMIN,
      order_uuid: randomUUID(),
    },
    [cartLine(product, 1, DEBT_CASH)],
    []
  );
  ok('credit sale (no till movement)');

  const keepCash = CASH_SALE - CASH_RETURN;
  const cashOrder = sales.completePOSOrder(
    {
      total_amount: CASH_SALE,
      paid_amount: CASH_SALE,
      shift_id: shift.id,
      user_id: ADMIN,
      order_uuid: randomUUID(),
    },
    [cartLine(product, 1, keepCash), cartLine(product, 1, CASH_RETURN)],
    [{ payment_method: 'cash', amount: CASH_SALE }]
  );
  ok('cash sale 3_876_615');

  customers.receivePayment({
    customer_id: customer.id,
    amount: DEBT_CASH,
    payment_method: 'cash',
    notes: 'prior debt for till test',
    received_by: ADMIN,
    shift_id: shift.id,
    operation: 'payment_in',
    source: 'test',
  });
  ok('customer debt cash 184_000');

  const orderId = cashOrder.order_id || cashOrder.id;
  assert.ok(orderId, 'cash sale must return order_id');
  const retItem = db
    .prepare(
      `
      SELECT id FROM order_items
      WHERE order_id = ?
        AND (
          ABS(COALESCE(unit_price, 0) - ?) < 0.01
          OR ABS(COALESCE(line_total, 0) - ?) < 0.01
        )
      ORDER BY rowid DESC LIMIT 1
    `
    )
    .get(orderId, CASH_RETURN, CASH_RETURN);
  assert.ok(retItem, `return line ${CASH_RETURN} not found on order ${orderId}`);
  const draft = returns.createReturn({
    order_id: orderId,
    cashier_id: ADMIN,
    user_id: ADMIN,
    return_reason: 'expected cash refund',
    refund_method: 'cash',
    shift_id: shift.id,
    notes: 'screenshot till refund 576250',
    approval_reason: 'till expected-cash smoke',
    items: [
      {
        order_item_id: retItem.id,
        product_id: product.id,
        quantity: 1,
        unit_price: CASH_RETURN,
        line_total: CASH_RETURN,
      },
    ],
  });
  try {
    returns.approveReturn(draft.id, { user_id: ADMIN, approval_reason: 'till test' });
  } catch {
    /* cashier may auto-complete */
  }
  try {
    if (String(draft.status).toLowerCase() !== 'completed') {
      returns.completeReturn(draft.id, { user_id: ADMIN });
    }
  } catch {
    /* already completed */
  }
  ok('cash return 576_250');

  const beforeLeak = shifts.getShiftSummary(shift.id);
  runStep('screenshot arithmetic → 3_575_365', () => {
    assert.equal(Number(beforeLeak.cashSales), CASH_SALE);
    assert.equal(Number(beforeLeak.customerDrawerCashNet), DEBT_CASH);
    assert.equal(Number(beforeLeak.totalRefunds), CASH_RETURN);
    assert.equal(Number(beforeLeak.expectedCash), SANE_TILL);
  });

  const sup = suppliers.create({
    name: 'Leaked Supplier Pay',
    phone: '+998901239933',
    settlement_currency: 'UZS',
  });
  suppliers.createPayment({
    supplier_id: sup.id,
    amount: LEAKED_SUPPLIER,
    payment_method: 'cash',
    created_by: ADMIN,
    accept_as_advance: true,
  });
  ok(`store-wide supplier cash ${LEAKED_SUPPLIER} inserted`);

  const afterLeak = shifts.getShiftSummary(shift.id);
  runStep('supplier leak must not reproduce −4_967_635', () => {
    const expected = Number(afterLeak.expectedCash);
    assert.equal(expected, SANE_TILL);
    assert.notEqual(expected, BUGGY_NEGATIVE);
    assert.notEqual(expected, SANE_TILL - LEAKED_SUPPLIER);
    assert.equal(SANE_TILL - LEAKED_SUPPLIER, BUGGY_NEGATIVE);
    assert.ok(
      Number(afterLeak.supplierPaymentsCash ?? 0) >= LEAKED_SUPPLIER - 1,
      'supplier rollup still visible for reports'
    );
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

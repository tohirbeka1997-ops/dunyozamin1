'use strict';

/**
 * Cash movement + shift close validation smoke (P1).
 * Run: electron electron/services/shiftCashHardening.smoke.test.cjs
 *   or: node electron/services/shiftCashHardening.smoke.test.cjs  (if POS_SERVER_MODE works)
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-shift-cash-'));
process.env.POS_SERVER_MODE = '1';
process.env.POS_DATA_DIR = tmpDir;
process.env.POS_VERBOSE_LOGS = '0';

const { open, close, getDb } = require('../db/open.cjs');
const { createServices } = require('./index.cjs');
const { ERROR_CODES } = require('../lib/errors.cjs');

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

function expectCode(fn, code) {
  try {
    fn();
    throw new Error(`expected error ${code}`);
  } catch (e) {
    assert.equal(e.code, code, `got ${e.code}: ${e.message}`);
  }
}

try {
  console.log('\n=== SHIFT CASH HARDENING SMOKE ===');
  console.log(`Temp DB: ${tmpDir}\n`);

  open();
  const db = getDb();
  const { shifts, products, inventory } = createServices(db);

  const ADMIN = 'default-admin-001';
  const WH = 'main-warehouse-001';

  const shift = shifts.openShift({
    user_id: ADMIN,
    opening_cash: 50000,
  });
  ok('open shift');

  expectCode(() => shifts.cashIn({ shiftId: shift.id, amount: -1000, createdBy: ADMIN }), ERROR_CODES.UNPROCESSABLE_ENTITY);
  ok('rejects negative cash in');

  expectCode(() => shifts.cashIn({ shiftId: shift.id, amount: 0, createdBy: ADMIN }), ERROR_CODES.UNPROCESSABLE_ENTITY);
  ok('rejects zero cash in');

  expectCode(() => shifts.cashIn({ shiftId: shift.id, amount: 'abc', createdBy: ADMIN }), ERROR_CODES.UNPROCESSABLE_ENTITY);
  ok('rejects non-numeric cash in');

  const cin = shifts.cashIn({
    shiftId: shift.id,
    amount: 1000,
    reason: 'test deposit',
    createdBy: ADMIN,
  });
  assert.ok(cin.id);
  assert.ok(Number(cin.previous_cash_balance) >= 0);
  assert.equal(Number(cin.next_cash_balance), Number(cin.previous_cash_balance) + 1000);
  ok('cash in records previous/next balance');

  const auditIn = db
    .prepare(`SELECT * FROM audit_log WHERE action = 'cash_in' ORDER BY created_at DESC LIMIT 1`)
    .get();
  assert.ok(auditIn, 'cash_in audit row');
  ok('cash in audit log');

  expectCode(
    () => shifts.cashOut({ shiftId: shift.id, amount: 999999999, createdBy: ADMIN }),
    ERROR_CODES.INSUFFICIENT_CASH
  );
  ok('rejects cash out larger than drawer');

  expectCode(
    () => shifts.closeShift(shift.id, { closing_cash: -1, closed_by: ADMIN }),
    ERROR_CODES.UNPROCESSABLE_ENTITY
  );
  ok('rejects negative closing cash');

  const summary = shifts.getShiftSummary(shift.id);
  const expected = Number(summary.expectedCash ?? summary.expected_cash ?? 0) || 0;
  expectCode(
    () =>
      shifts.closeShift(shift.id, {
        closing_cash: expected + 20000,
        closed_by: ADMIN,
        notes: '',
      }),
    ERROR_CODES.UNPROCESSABLE_ENTITY
  );
  ok('large variance without reason rejected');

  const closed = shifts.closeShift(shift.id, {
    closing_cash: expected + 20000,
    closed_by: ADMIN,
    notes: 'sanash farqi',
  });
  assert.equal(closed.success, true);
  ok('close with variance reason');

  expectCode(
    () => shifts.closeShift(shift.id, { closing_cash: 0, closed_by: ADMIN }),
    ERROR_CODES.VALIDATION_ERROR
  );
  ok('double close rejected');

  // Parallel last-unit race (P0)
  const sku = `RACE-${Date.now()}`;
  const p = products.create({
    name: 'Race Unit',
    sku,
    sale_price: 1000,
    track_stock: 1,
    current_stock: 0,
  });
  inventory.adjustStock({
    warehouse_id: WH,
    adjustment_type: 'set',
    reason: 'seed',
    created_by: ADMIN,
    items: [{ product_id: p.id, target_quantity: 1 }],
  });

  const { sales } = createServices(db);
  const shift2 = shifts.openShift({
    user_id: ADMIN,
    warehouse_id: WH,
    opening_cash: 0,
  });

  const line = {
    product_id: p.id,
    product_name: p.name,
    quantity: 1,
    qty_sale: 1,
    qty_base: 1,
    unit_price: 1000,
    line_total: 1000,
    discount_amount: 0,
  };
  const pay = [{ payment_method: 'cash', amount: 1000 }];

  let okCount = 0;
  let failCount = 0;
  try {
    sales.completePOSOrder(
      {
        user_id: ADMIN,
        shift_id: shift2.id,
        warehouse_id: WH,
        total_amount: 1000,
        order_uuid: `race-a-${Date.now()}`,
      },
      [line],
      pay
    );
    okCount += 1;
  } catch (e) {
    failCount += 1;
    throw e;
  }
  try {
    sales.completePOSOrder(
      {
        user_id: ADMIN,
        shift_id: shift2.id,
        warehouse_id: WH,
        total_amount: 1000,
        order_uuid: `race-b-${Date.now()}`,
      },
      [line],
      pay
    );
    okCount += 1;
  } catch (e) {
    failCount += 1;
    assert.equal(e.code, ERROR_CODES.INSUFFICIENT_STOCK);
    assert.ok(e.details);
    assert.equal(e.details.productName || e.details.product_name, 'Race Unit');
  }
  assert.equal(okCount, 1);
  assert.equal(failCount, 1);
  assert.equal(Number(inventory.getCurrentStock(p.id, WH)) || 0, 0);
  ok('last-unit: only one sale succeeds with stock details');

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

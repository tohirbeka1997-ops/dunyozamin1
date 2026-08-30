/* eslint-disable no-console */
/**
 * Sales return over-return / idempotency smoke.
 * Run: npx electron electron/services/returnsOverReturn.smoke.test.cjs
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const WH = 'main-warehouse-001';
const ADMIN = 'default-admin-001';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-return-over-'));
process.env.POS_SERVER_MODE = '1';
process.env.POS_DATA_DIR = tmpDir;
process.env.POS_VERBOSE_LOGS = '0';

const { open, close, getDb } = require('../db/open.cjs');
const { createServices } = require('./index.cjs');
const { ERROR_CODES } = require('../lib/errors.cjs');

function cartLine(product, { qtySale, unitPrice = 1000 }) {
  const lineTotal = unitPrice * qtySale;
  return {
    product_id: product.id,
    product_name: product.name,
    quantity: qtySale,
    qty_sale: qtySale,
    qty_base: qtySale,
    unit_price: unitPrice,
    line_total: lineTotal,
    discount_amount: 0,
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
  console.log(`     ${err.message || err}`);
}

try {
  console.log('\n=== RETURNS OVER-RETURN / IDEMPOTENCY SMOKE ===');
  console.log(`Temp DB: ${tmpDir}\n`);

  open();
  const db = getDb();
  const { products, inventory, sales, shifts, returns } = createServices(db);

  const product = products.create({
    name: 'Return Smoke Product',
    sku: `RET-SMOKE-${Date.now()}`,
    sale_price: 1000,
    track_stock: 1,
    current_stock: 0,
    unit: 'pcs',
    base_unit: 'pcs',
  });
  inventory.adjustStock({
    warehouse_id: WH,
    adjustment_type: 'set',
    reason: 'seed',
    created_by: ADMIN,
    allow_during_open_revision: true,
    items: [{ product_id: product.id, target_quantity: 50 }],
  });

  const shift = shifts.openShift({ user_id: ADMIN, opening_cash: 50_000 });

  const sale1 = sales.completePOSOrder(
    { total_amount: 5000, shift_id: shift.id, user_id: ADMIN, order_uuid: `sale-${Date.now()}` },
    [cartLine(product, { qtySale: 5 })],
    [{ payment_method: 'cash', amount: 5000 }],
  );
  assert.ok(sale1?.order_id);
  const line = db.prepare('SELECT * FROM order_items WHERE order_id = ?').get(sale1.order_id);
  assert.ok(line);

  const full = returns.createReturn({
    order_id: sale1.order_id,
    return_reason: 'damaged',
    refund_method: 'cash',
    cashier_id: ADMIN,
    items: [{ order_item_id: line.id, quantity: 5 }],
    idempotency_key: `full-${sale1.order_id}`,
  });
  ok('full return created');

  const replay = returns.createReturn({
    order_id: sale1.order_id,
    return_reason: 'damaged',
    refund_method: 'cash',
    cashier_id: ADMIN,
    items: [{ order_item_id: line.id, quantity: 5 }],
    idempotency_key: `full-${sale1.order_id}`,
  });
  assert.equal(replay.id, full.id);
  ok('same idempotency_key returns existing (no second money/stock)');

  let blocked = false;
  try {
    returns.createReturn({
      order_id: sale1.order_id,
      return_reason: 'damaged',
      refund_method: 'cash',
      cashier_id: ADMIN,
      items: [{ order_item_id: line.id, quantity: 1 }],
      idempotency_key: `again-${sale1.order_id}`,
    });
  } catch (e) {
    blocked = e.code === ERROR_CODES.RETURN_LIMIT_EXCEEDED;
    assert.ok(blocked, `expected RETURN_LIMIT_EXCEEDED, got ${e.code}: ${e.message}`);
  }
  assert.ok(blocked);
  ok('fully returned order cannot return again (409 RETURN_LIMIT_EXCEEDED)');

  const sale2 = sales.completePOSOrder(
    { total_amount: 4000, shift_id: shift.id, user_id: ADMIN, order_uuid: `sale2-${Date.now()}` },
    [cartLine(product, { qtySale: 4 })],
    [{ payment_method: 'cash', amount: 4000 }],
  );
  const line2 = db.prepare('SELECT * FROM order_items WHERE order_id = ?').get(sale2.order_id);
  returns.createReturn({
    order_id: sale2.order_id,
    return_reason: 'damaged',
    refund_method: 'cash',
    cashier_id: ADMIN,
    items: [{ order_item_id: line2.id, quantity: 2 }],
    idempotency_key: `partial-${sale2.order_id}`,
  });
  let overPartial = false;
  try {
    returns.createReturn({
      order_id: sale2.order_id,
      return_reason: 'damaged',
      refund_method: 'cash',
      cashier_id: ADMIN,
      items: [{ order_item_id: line2.id, quantity: 3 }],
      idempotency_key: `over-${sale2.order_id}`,
    });
  } catch (e) {
    overPartial = e.code === ERROR_CODES.RETURN_LIMIT_EXCEEDED;
  }
  assert.ok(overPartial);
  ok('partial return cannot exceed remaining qty');

  // P0 regression: getOrderDetails must keep remaining_quantity=0 (not coalesce to sold).
  const detailsAfterFull = returns.getOrderDetails(sale1.order_id);
  const detailLine = (detailsAfterFull.items || []).find((it) => it.orderItemId === line.id || it.id === line.id);
  assert.ok(detailLine, 'order detail line present');
  assert.equal(Number(detailLine.sold_quantity), 5);
  assert.equal(Number(detailLine.returned_quantity), 5);
  assert.equal(Number(detailLine.remaining_quantity), 0);
  assert.equal(Number(detailLine.refundableQty), 0);
  ok('getOrderDetails remaining_quantity stays 0 after full return');

  // Concurrent race: two different keys on same fully-returned line → both CONFLICT.
  let raceBlocked = 0;
  for (const key of [`race-a-${sale1.order_id}`, `race-b-${sale1.order_id}`]) {
    try {
      returns.createReturn({
        order_id: sale1.order_id,
        return_reason: 'damaged',
        refund_method: 'cash',
        cashier_id: ADMIN,
        items: [{ order_item_id: line.id, quantity: 1 }],
        idempotency_key: key,
      });
    } catch (e) {
      if (e.code === ERROR_CODES.RETURN_LIMIT_EXCEEDED) raceBlocked += 1;
    }
  }
  assert.equal(raceBlocked, 2);
  ok('concurrent re-return keys both CONFLICT after full return');

  console.log(`\n=== NATIJA: ${passed} OK, ${failed} FAIL ===\n`);
  process.exit(failed > 0 ? 1 : 0);
} catch (e) {
  fail('suite', e);
  console.log(`\n=== NATIJA: ${passed} OK, ${failed} FAIL ===\n`);
  process.exit(1);
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

/* eslint-disable no-console */
/**
 * Sales return P1 controls smoke:
 * - method ≠ original needs manager
 * - orderless forbidden for cashier
 * - cancel reverse TX
 * - drawer insufficient cash return
 *
 * Run: npx electron electron/services/returnsControls.smoke.test.cjs
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { randomUUID } = require('crypto');

const WH = 'main-warehouse-001';
const ADMIN = 'default-admin-001';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-return-ctrl-'));
process.env.POS_SERVER_MODE = '1';
process.env.POS_DATA_DIR = tmpDir;
process.env.POS_VERBOSE_LOGS = '0';

const { open, close, getDb } = require('../db/open.cjs');
const { createServices } = require('./index.cjs');
const { ERROR_CODES } = require('../lib/errors.cjs');
const {
  summarizeOrderPayments,
  requiresMethodMismatchApproval,
} = require('../lib/returnsControls.cjs');

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

function ensureRole(db, userId, roleCode) {
  let role = db.prepare(`SELECT id FROM roles WHERE code = ? LIMIT 1`).get(roleCode);
  if (!role) {
    const id = `role-${roleCode}-smoke`;
    db.prepare(
      `INSERT INTO roles (id, code, name, description, is_active, created_at)
       VALUES (?, ?, ?, ?, 1, datetime('now'))`,
    ).run(id, roleCode, roleCode, roleCode);
    role = { id };
  }
  const has = db
    .prepare(`SELECT 1 AS ok FROM user_roles WHERE user_id = ? AND role_id = ?`)
    .get(userId, role.id);
  if (!has) {
    db.prepare(
      `INSERT INTO user_roles (id, user_id, role_id, assigned_at) VALUES (?, ?, ?, datetime('now'))`,
    ).run(randomUUID(), userId, role.id);
  }
}

function createCashierUser(db) {
  const id = `cashier-smoke-${Date.now()}`;
  db.prepare(
    `INSERT INTO users (id, username, password_hash, full_name, is_active, created_at)
     VALUES (?, ?, 'x', 'Cashier Smoke', 1, datetime('now'))`,
  ).run(id, `cashier_${Date.now()}@pos.local`);
  ensureRole(db, id, 'cashier');
  // Remove accidental admin role if any
  try {
    const adminRole = db.prepare(`SELECT id FROM roles WHERE code = 'admin' LIMIT 1`).get();
    if (adminRole) {
      db.prepare(`DELETE FROM user_roles WHERE user_id = ? AND role_id = ?`).run(id, adminRole.id);
    }
  } catch (_) {
    /* ignore */
  }
  return id;
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
  console.log('\n=== RETURNS CONTROLS (P1) SMOKE ===');
  console.log(`Temp DB: ${tmpDir}\n`);

  // Unit-ish helpers (no DB)
  {
    const mixed = summarizeOrderPayments(
      [
        { payment_method: 'cash', amount: 3000 },
        { payment_method: 'card', amount: 2000 },
      ],
      null,
    );
    assert.strictEqual(mixed.isMixed, true);
    assert.strictEqual(requiresMethodMismatchApproval('customer_account', mixed), false);
    assert.strictEqual(requiresMethodMismatchApproval('cash', mixed), false);
    assert.strictEqual(requiresMethodMismatchApproval('card', mixed), false);
    const cashOnly = summarizeOrderPayments([{ payment_method: 'cash', amount: 5000 }], null);
    assert.strictEqual(requiresMethodMismatchApproval('card', cashOnly), true);
    ok('payment summarize / mismatch helpers');
  }

  open();
  const db = getDb();
  const { products, inventory, sales, shifts, returns } = createServices(db);
  ensureRole(db, ADMIN, 'admin');

  const product = products.create({
    name: 'Return Ctrl Product',
    sku: `RET-CTRL-${Date.now()}`,
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
    items: [{ product_id: product.id, target_quantity: 100 }],
  });

  const shift = shifts.openShift({ user_id: ADMIN, opening_cash: 1000 });

  // Cash sale 5000 → expected drawer = 1000 + 5000 = 6000
  const saleCash = sales.completePOSOrder(
    { total_amount: 5000, shift_id: shift.id, user_id: ADMIN, order_uuid: `sale-cash-${Date.now()}` },
    [cartLine(product, { qtySale: 5 })],
    [{ payment_method: 'cash', amount: 5000 }],
  );
  const lineCash = db.prepare('SELECT * FROM order_items WHERE order_id = ?').get(saleCash.order_id);

  // 1) Method mismatch: cash sale → card refund without manager reason → FORBIDDEN/VALIDATION
  try {
    returns.createReturn({
      order_id: saleCash.order_id,
      return_reason: 'incorrect',
      refund_method: 'card',
      cashier_id: ADMIN,
      notes: 'mismatch attempt',
      items: [{ order_item_id: lineCash.id, quantity: 1 }],
      // no method_mismatch_reason / approval_reason
    });
    fail('method mismatch without reason should fail', new Error('expected throw'));
  } catch (e) {
    assert.ok(
      e?.code === ERROR_CODES.FORBIDDEN ||
        e?.code === ERROR_CODES.VALIDATION_ERROR ||
        /mismatch|approval|reason/i.test(String(e?.message || '')),
      `unexpected: ${e?.code} ${e?.message}`,
    );
    ok('method≠original without reason blocked');
  }

  // With manager + reason → OK
  const mismatchOk = returns.createReturn({
    order_id: saleCash.order_id,
    return_reason: 'incorrect',
    refund_method: 'card',
    cashier_id: ADMIN,
    notes: 'manager override',
    method_mismatch_reason: 'Customer insisted on card refund',
    approval_reason: 'Customer insisted on card refund',
    items: [{ order_item_id: lineCash.id, quantity: 1 }],
    shift_id: shift.id,
  });
  assert.ok(mismatchOk?.id);
  ok('method≠original with manager reason allowed');

  // 2) Orderless forbidden for cashier
  const cashierId = createCashierUser(db);
  try {
    returns.createReturn({
      mode: 'manual',
      return_reason: 'damaged',
      refund_method: 'cash',
      cashier_id: cashierId,
      notes: 'should fail',
      visitor: true,
      approval_reason: 'n/a',
      items: [
        {
          product_id: product.id,
          product_name: product.name,
          quantity: 1,
          unit_price: 1000,
          line_total: 1000,
        },
      ],
      shift_id: shift.id,
    });
    fail('orderless cashier should fail', new Error('expected throw'));
  } catch (e) {
    assert.ok(
      e?.code === ERROR_CODES.FORBIDDEN || /manager|admin|orderless/i.test(String(e?.message || '')),
      `unexpected: ${e?.code} ${e?.message}`,
    );
    ok('orderless forbidden for cashier');
  }

  // Admin orderless OK (cash + visitor — not customer_account without customer)
  const orderless = returns.createReturn({
    mode: 'manual',
    return_reason: 'damaged',
    refund_method: 'cash',
    cashier_id: ADMIN,
    notes: 'admin orderless ok',
    visitor: true,
    approval_reason: 'Privilege orderless return',
    items: [
      {
        product_id: product.id,
        product_name: product.name,
        quantity: 1,
        unit_price: 1000,
        line_total: 1000,
      },
    ],
    shift_id: shift.id,
  });
  assert.ok(orderless?.id);
  assert.strictEqual(orderless.return_mode, 'manual');
  ok('orderless allowed for admin');

  // 3) Insufficient drawer cash
  // Empty another shift with tiny opening, try large cash return
  // Close isn't needed — open second shift may not be allowed; use same shift after draining.
  // Force check: refund amount > expectedCash by using opening-only path with huge refund on card-paid order
  const saleCard = sales.completePOSOrder(
    {
      total_amount: 8000,
      shift_id: shift.id,
      user_id: ADMIN,
      order_uuid: `sale-card-${Date.now()}`,
    },
    [cartLine(product, { qtySale: 8, unitPrice: 1000 })],
    [{ payment_method: 'card', amount: 8000 }],
  );
  const lineCard = db.prepare('SELECT * FROM order_items WHERE order_id = ?').get(saleCard.order_id);
  // Expected cash does not include card sales; try cash refund of 8000 which should exceed drawer
  try {
    returns.createReturn({
      order_id: saleCard.order_id,
      return_reason: 'incorrect',
      refund_method: 'cash',
      cashier_id: ADMIN,
      notes: 'want cash back',
      method_mismatch_reason: 'Customer wants cash',
      approval_reason: 'Customer wants cash',
      items: [{ order_item_id: lineCard.id, quantity: 8 }],
      shift_id: shift.id,
    });
    fail('insufficient drawer should fail', new Error('expected throw'));
  } catch (e) {
    assert.ok(
      e?.code === ERROR_CODES.INSUFFICIENT_CASH || /drawer|cash|insufficient/i.test(String(e?.message || '')),
      `unexpected: ${e?.code} ${e?.message}`,
    );
    ok('drawer insufficient cash return blocked');
  }

  // 4) Cancel reverse TX
  const saleCancel = sales.completePOSOrder(
    {
      total_amount: 2000,
      shift_id: shift.id,
      user_id: ADMIN,
      order_uuid: `sale-cancel-${Date.now()}`,
    },
    [cartLine(product, { qtySale: 2 })],
    [{ payment_method: 'cash', amount: 2000 }],
  );
  const lineCancel = db.prepare('SELECT * FROM order_items WHERE order_id = ?').get(saleCancel.order_id);
  const retCancel = returns.createReturn({
    order_id: saleCancel.order_id,
    return_reason: 'dissatisfaction',
    refund_method: 'cash',
    cashier_id: ADMIN,
    notes: 'will cancel',
    items: [{ order_item_id: lineCancel.id, quantity: 2 }],
    shift_id: shift.id,
  });
  assert.strictEqual(String(retCancel.status).toLowerCase(), 'completed');

  try {
    returns.deleteReturn(retCancel.id);
    fail('delete completed should fail', new Error('expected throw'));
  } catch (e) {
    assert.ok(
      e?.code === ERROR_CODES.FORBIDDEN || /cannot be deleted|cancel/i.test(String(e?.message || '')),
    );
    ok('completed not deletable');
  }

  const cancelled = returns.cancelReturn(retCancel.id, {
    user_id: ADMIN,
    cancel_reason: 'Entered by mistake',
  });
  assert.strictEqual(String(cancelled.status).toLowerCase(), 'cancelled');
  const lineAfter = db.prepare('SELECT returned_quantity FROM order_items WHERE id = ?').get(lineCancel.id);
  assert.ok(Number(lineAfter.returned_quantity || 0) < 0.001);
  const cashMov = db
    .prepare(`SELECT COUNT(*) AS c FROM cash_movements WHERE reference_type='return' AND reference_id=?`)
    .get(retCancel.id);
  assert.strictEqual(Number(cashMov?.c || 0), 0);
  ok('cancel reverse TX clears returned_qty + cash movement');

  console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===\n`);
  close();
  process.exit(failed ? 1 : 0);
} catch (err) {
  console.error('FATAL', err);
  try {
    close();
  } catch (_) {
    /* ignore */
  }
  process.exit(1);
}

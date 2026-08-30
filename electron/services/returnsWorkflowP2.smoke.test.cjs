/* eslint-disable no-console */
/**
 * Sales return P2 workflow smoke:
 * - draft → approve → complete
 * - reject pending
 * - attachment_url persisted
 * - cashier forbidden for orderless complete / large complete
 * - cashier can submit pending for large return
 *
 * Run: npx electron electron/services/returnsWorkflowP2.smoke.test.cjs
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { randomUUID } = require('crypto');

const WH = 'main-warehouse-001';
const ADMIN = 'default-admin-001';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-return-p2-'));
process.env.POS_SERVER_MODE = '1';
process.env.POS_DATA_DIR = tmpDir;
process.env.POS_VERBOSE_LOGS = '0';

const { open, close, getDb } = require('../db/open.cjs');
const { createServices } = require('./index.cjs');
const { ERROR_CODES } = require('../lib/errors.cjs');
const {
  pickPrimaryReturnsRole,
  canApproveOrRejectReturn,
  getReturnsPermissions,
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

function createUserWithRole(db, roleCode) {
  const id = `${roleCode}-smoke-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  db.prepare(
    `INSERT INTO users (id, username, password_hash, full_name, is_active, created_at)
     VALUES (?, ?, 'x', ?, 1, datetime('now'))`,
  ).run(id, `${roleCode}_${Date.now()}@pos.local`, `${roleCode} Smoke`);
  ensureRole(db, id, roleCode);
  try {
    const adminRole = db.prepare(`SELECT id FROM roles WHERE code = 'admin' LIMIT 1`).get();
    if (adminRole && roleCode !== 'admin') {
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
  console.log('\n=== RETURNS WORKFLOW P2 SMOKE ===');
  console.log(`Temp DB: ${tmpDir}\n`);

  {
    assert.strictEqual(pickPrimaryReturnsRole(['cashier', 'manager']), 'manager');
    assert.strictEqual(canApproveOrRejectReturn('cashier', 1000, 500000), false);
    assert.strictEqual(canApproveOrRejectReturn('senior_cashier', 1000, 500000), true);
    assert.strictEqual(canApproveOrRejectReturn('senior_cashier', 600000, 500000), false);
    assert.strictEqual(getReturnsPermissions('admin').cancel_completed, true);
    ok('role matrix helpers');
  }

  open();
  const db = getDb();
  const { products, inventory, sales, shifts, returns } = createServices(db);
  ensureRole(db, ADMIN, 'admin');
  const cashierId = createUserWithRole(db, 'cashier');
  const managerId = createUserWithRole(db, 'manager');

  const product = products.create({
    name: 'Return P2 Product',
    sku: `RET-P2-${Date.now()}`,
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
    items: [{ product_id: product.id, target_quantity: 200 }],
  });

  const shift = shifts.openShift({ user_id: ADMIN, opening_cash: 5_000_000 });

  const sale = sales.completePOSOrder(
    {
      total_amount: 2000,
      shift_id: shift.id,
      user_id: ADMIN,
      order_uuid: `sale-p2-${Date.now()}`,
    },
    [cartLine(product, { qtySale: 2, unitPrice: 1000 })],
    [{ payment_method: 'cash', amount: 2000 }],
  );
  const orderId = sale.order_id || sale.id;
  const orderItems = db.prepare('SELECT id, product_id FROM order_items WHERE order_id = ?').all(orderId);
  assert.ok(orderItems.length >= 1);

  // 1) draft → approve → complete
  try {
    const draft = returns.createReturn({
      order_id: orderId,
      cashier_id: cashierId,
      user_id: cashierId,
      return_reason: 'damaged',
      refund_method: 'cash',
      notes: 'draft path',
      save_as_draft: true,
      shift_id: shift.id,
      items: [
        {
          order_item_id: orderItems[0].id,
          product_id: product.id,
          quantity: 1,
          unit_price: 1000,
          line_total: 1000,
        },
      ],
    });
    assert.strictEqual(String(draft.status).toLowerCase(), 'draft');

    const approved = returns.approveReturn(draft.id, {
      user_id: managerId,
      approval_reason: 'ok to refund',
    });
    assert.strictEqual(String(approved.status).toLowerCase(), 'approved');

    const completed = returns.completeReturn(draft.id, { user_id: managerId });
    assert.strictEqual(String(completed.status).toLowerCase(), 'completed');
    ok('draft → approve → complete');
  } catch (e) {
    fail('draft → approve → complete', e);
  }

  // 2) pending → reject + attachment persistence
  try {
    const sale2 = sales.completePOSOrder(
      {
        total_amount: 3000,
        shift_id: shift.id,
        user_id: ADMIN,
        order_uuid: `sale-p2b-${Date.now()}`,
      },
      [cartLine(product, { qtySale: 3, unitPrice: 1000 })],
      [{ payment_method: 'cash', amount: 3000 }],
    );
    const oid2 = sale2.order_id || sale2.id;
    const oi2 = db.prepare('SELECT id FROM order_items WHERE order_id = ?').all(oid2);

    const pending = returns.createReturn({
      order_id: oid2,
      cashier_id: cashierId,
      user_id: cashierId,
      return_reason: 'defective',
      refund_method: 'cash',
      notes: 'needs review',
      submit_for_approval: true,
      attachment_note: 'crack on left side',
      attachment_url: '/product-images/ret-smoke-attach.jpg',
      attachment_name: 'ret-smoke-attach.jpg',
      shift_id: shift.id,
      items: [
        {
          order_item_id: oi2[0].id,
          product_id: product.id,
          quantity: 1,
          unit_price: 1000,
          line_total: 1000,
        },
      ],
    });
    assert.strictEqual(String(pending.status).toLowerCase(), 'pending');
    const got = returns.getById(pending.id);
    assert.strictEqual(got.attachment_url, '/product-images/ret-smoke-attach.jpg');
    assert.ok(String(got.attachment_note || '').includes('crack'));

    const rejected = returns.rejectReturn(pending.id, {
      user_id: managerId,
      reject_reason: 'not eligible',
    });
    assert.strictEqual(String(rejected.status).toLowerCase(), 'rejected');
    ok('pending reject + attachment persisted');
  } catch (e) {
    fail('pending reject + attachment persisted', e);
  }

  // 3) cashier forbidden: orderless complete
  try {
    let threw = false;
    try {
      returns.createManualReturn({
        cashier_id: cashierId,
        user_id: cashierId,
        return_reason: 'other',
        refund_method: 'cash',
        notes: 'orderless attempt',
        approval_reason: 'n/a',
        visitor: true,
        shift_id: shift.id,
        items: [
          {
            product_id: product.id,
            quantity: 1,
            unit_price: 1000,
            line_total: 1000,
          },
        ],
      });
    } catch (err) {
      threw = true;
      assert.ok(
        err.code === ERROR_CODES.FORBIDDEN ||
          String(err.message || '').toLowerCase().includes('manager'),
      );
    }
    assert.strictEqual(threw, true);
    ok('cashier forbidden orderless complete');
  } catch (e) {
    fail('cashier forbidden orderless complete', e);
  }

  // 4) cashier can submit large as pending
  try {
    const sale3 = sales.completePOSOrder(
      {
        total_amount: 600000,
        shift_id: shift.id,
        user_id: ADMIN,
        order_uuid: `sale-p2c-${Date.now()}`,
      },
      [cartLine(product, { qtySale: 1, unitPrice: 600000 })],
      [{ payment_method: 'cash', amount: 600000 }],
    );
    const oid3 = sale3.order_id || sale3.id;
    const oi3 = db.prepare('SELECT id FROM order_items WHERE order_id = ?').all(oid3);

    let completeThrew = false;
    try {
      returns.createReturn({
        order_id: oid3,
        cashier_id: cashierId,
        user_id: cashierId,
        return_reason: 'dissatisfaction',
        refund_method: 'cash',
        notes: 'large return note',
        approval_reason: 'should fail',
        shift_id: shift.id,
        items: [
          {
            order_item_id: oi3[0].id,
            product_id: product.id,
            quantity: 1,
            unit_price: 600000,
            line_total: 600000,
          },
        ],
      });
    } catch (err) {
      completeThrew = true;
      assert.ok(err.code === ERROR_CODES.FORBIDDEN);
    }
    assert.strictEqual(completeThrew, true);

    const pendingLarge = returns.createReturn({
      order_id: oid3,
      cashier_id: cashierId,
      user_id: cashierId,
      return_reason: 'dissatisfaction',
      refund_method: 'cash',
      notes: 'large return note',
      submit_for_approval: true,
      shift_id: shift.id,
      items: [
        {
          order_item_id: oi3[0].id,
          product_id: product.id,
          quantity: 1,
          unit_price: 600000,
          line_total: 600000,
        },
      ],
    });
    assert.strictEqual(String(pendingLarge.status).toLowerCase(), 'pending');
    ok('cashier large complete forbidden; pending allowed');
  } catch (e) {
    fail('cashier large complete forbidden; pending allowed', e);
  }

  close();
} catch (fatal) {
  failed += 1;
  console.error('FATAL:', fatal);
  try {
    close();
  } catch (_) {
    /* ignore */
  }
}

console.log(`\n=== P2 RESULT: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);

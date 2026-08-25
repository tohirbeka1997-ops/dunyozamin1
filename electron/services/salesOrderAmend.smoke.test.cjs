/* eslint-disable no-console */
/**
 * salesOrderAmend.smoke.test.cjs — POS buyurtma tahriri (replaces_order_id).
 * - bonus_referrer persisted on amended sale
 * - usta bonus not double-counted after amend
 * - partial credit amend keeps correct balance
 *
 * Ishga tushirish: npm run test:order-amend-smoke
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const WH = 'main-warehouse-001';
const ADMIN = 'default-admin-001';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-order-amend-smoke-'));
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
    subtotal: lineTotal,
    discount_amount: 0,
    total: lineTotal,
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

function runStep(name, fn) {
  try {
    fn();
    ok(name);
  } catch (e) {
    fail(name, e);
  }
}

console.log('\n=== BUYURTMA TAHRIRI (AMEND) SMOKE TEST ===');
console.log(`Temp DB: ${tmpDir}\n`);

try {
  open();
  const db = getDb();
  const { products, inventory, sales, shifts, customers } = createServices(db);

  db.prepare(`UPDATE settings SET value = '1' WHERE key = 'loyalty.general.enabled'`).run();
  db.prepare(`UPDATE settings SET value = 'all_customers' WHERE key = 'loyalty.earn.scope'`).run();
  db.prepare(`UPDATE settings SET value = '1000' WHERE key = 'loyalty.earn.points_per_uzs'`).run();

  const product = products.create({
    name: 'Amend Smoke Product',
    sku: `AMEND-SMOKE-${Date.now()}`,
    sale_price: 10000,
    purchase_price: 5000,
    track_stock: 1,
    current_stock: 0,
  });
  inventory.adjustStock({
    warehouse_id: WH,
    adjustment_type: 'set',
    reason: 'Amend smoke stock',
    created_by: ADMIN,
    items: [{ product_id: product.id, target_quantity: 100 }],
  });

  const buyer = customers.create({
    name: 'Amend Buyer',
    phone: '+998901234600',
    allow_credit: 1,
    allow_debt: 1,
    credit_limit: 50000000,
  });
  const usta = customers.create({
    name: 'Amend Usta',
    phone: '+998901234601',
    pricing_tier: 'master',
  });

  const shift = shifts.openShift({ user_id: ADMIN });

  runStep('usta bonus: asl sotuvda referrer saqlanadi va ball beriladi', () => {
    const res = sales.completePOSOrder(
      {
        total_amount: 10000,
        customer_id: buyer.id,
        bonus_referrer_customer_id: usta.id,
        shift_id: shift.id,
        user_id: ADMIN,
      },
      [cartLine(product, 1, 10000)],
      [{ payment_method: 'cash', amount: 10000 }],
    );
    const row = db
      .prepare('SELECT bonus_referrer_customer_id FROM orders WHERE id = ?')
      .get(res.order_id);
    assert.strictEqual(row?.bonus_referrer_customer_id, usta.id);
    const ustaPts = Number(
      db.prepare('SELECT bonus_points FROM customers WHERE id = ?').get(usta.id)?.bonus_points || 0,
    );
    assert.strictEqual(ustaPts, 10);
  });

  runStep('usta bonus: tahrirda ikki marta ball berilmaydi', () => {
    const ustaBefore = Number(
      db.prepare('SELECT bonus_points FROM customers WHERE id = ?').get(usta.id)?.bonus_points || 0,
    );
    const original = db
      .prepare(
        `SELECT id FROM orders WHERE customer_id = ? AND status = 'completed' ORDER BY created_at DESC LIMIT 1`,
      )
      .get(buyer.id);
    assert.ok(original?.id);

    const amended = sales.completePOSOrder(
      {
        total_amount: 20000,
        customer_id: buyer.id,
        bonus_referrer_customer_id: usta.id,
        shift_id: shift.id,
        user_id: ADMIN,
        replaces_order_id: original.id,
      },
      [cartLine(product, 2, 10000)],
      [{ payment_method: 'cash', amount: 20000 }],
    );
    assert.ok(amended.order_id);

    const amendedRow = db
      .prepare('SELECT bonus_referrer_customer_id FROM orders WHERE id = ?')
      .get(amended.order_id);
    assert.strictEqual(amendedRow?.bonus_referrer_customer_id, usta.id);

    const ustaAfter = Number(
      db.prepare('SELECT bonus_points FROM customers WHERE id = ?').get(usta.id)?.bonus_points || 0,
    );
    // Original 10 pts reversed; new sale 20 pts → net +10 from before amend.
    assert.strictEqual(ustaAfter, ustaBefore + 10);

    const adjustRows = db
      .prepare(
        `SELECT COUNT(*) AS n FROM customer_bonus_ledger
         WHERE order_id = ? AND type = 'adjust' AND note LIKE 'Tahrir:%'`,
      )
      .get(original.id);
    assert.ok(Number(adjustRows?.n) >= 1);
  });

  runStep('qisman nasiya tahrir: balans ikki marta hisoblanmaydi', () => {
    const amendCust = customers.create({
      name: 'Amend Partial Credit',
      phone: '+998901234602',
      allow_credit: 1,
      allow_debt: 1,
      credit_limit: 50000000,
    });
    const original = sales.completePOSOrder(
      {
        total_amount: 10000,
        customer_id: amendCust.id,
        shift_id: shift.id,
        user_id: ADMIN,
      },
      [cartLine(product, 1, 10000)],
      [
        { payment_method: 'cash', amount: 4000 },
        { payment_method: 'credit', amount: 6000 },
      ],
    );
    assert.strictEqual(bal(db, amendCust.id), -6000);

    sales.completePOSOrder(
      {
        total_amount: 20000,
        customer_id: amendCust.id,
        shift_id: shift.id,
        user_id: ADMIN,
        replaces_order_id: original.order_id,
      },
      [cartLine(product, 2, 10000)],
      [
        { payment_method: 'cash', amount: 8000 },
        { payment_method: 'credit', amount: 12000 },
      ],
    );
    assert.strictEqual(bal(db, amendCust.id), -12000);
  });

  close();
} catch (e) {
  fail('setup / teardown', e);
  try {
    close();
  } catch {
    /* ignore */
  }
}

console.log(`\n=== NATIJA: ${passed} OK, ${failed} FAIL ===\n`);
process.exit(failed > 0 ? 1 : 0);

/* eslint-disable no-console */
/**
 * End-to-end: completePOSOrder persists bonus_referrer_customer_id and accrues to usta.
 * npm run test:bonus-referrer-e2e-smoke
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-bonus-e2e-'));
process.env.POS_SERVER_MODE = '1';
process.env.POS_DATA_DIR = tmpDir;
process.env.POS_VERBOSE_LOGS = '0';

const { open, close, getDb } = require('../db/open.cjs');
const { createServices } = require('./index.cjs');

const WH = 'main-warehouse-001';
const ADMIN = 'default-admin-001';

let passed = 0;
let failed = 0;

function run(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  OK  ${name}`);
  } catch (e) {
    failed += 1;
    console.error(`  FAIL ${name}:`, e?.message || e);
  }
}

console.log(`\n=== BONUS REFERRER E2E (${tmpDir}) ===\n`);

try {
  open();
  const db = getDb();
  const { products, inventory, sales, shifts, customers } = createServices(db);

  const product = products.create({
    name: 'Bonus E2E Product',
    sku: `BONUS-E2E-${Date.now()}`,
    sale_price: 10000,
    purchase_price: 5000,
    track_stock: 1,
    current_stock: 0,
  });
  inventory.adjustStock({
    warehouse_id: WH,
    adjustment_type: 'set',
    reason: 'bonus e2e stock',
    created_by: ADMIN,
    items: [{ product_id: product.id, target_quantity: 100 }],
  });

  const buyer = customers.create({
    name: 'E2E Buyer',
    phone: '+998901111101',
    allow_credit: 1,
  });
  const usta = customers.create({
    name: 'E2E Usta',
    phone: '+998901111102',
    pricing_tier: 'master',
  });

  db.prepare(`UPDATE settings SET value = '1' WHERE key = 'loyalty.general.enabled'`).run();
  db.prepare(`UPDATE settings SET value = 'all_customers' WHERE key = 'loyalty.earn.scope'`).run();
  db.prepare(`UPDATE settings SET value = '1000' WHERE key = 'loyalty.earn.points_per_uzs'`).run();

  const shift = shifts.openShift({ user_id: ADMIN });
  const line = {
    product_id: product.id,
    product_name: product.name,
    quantity: 1,
    qty_sale: 1,
    qty_base: 1,
    unit_price: 10000,
    subtotal: 10000,
    discount_amount: 0,
    total: 10000,
  };

  run('cash sale: bonus_referrer persisted on order', () => {
    const res = sales.completePOSOrder(
      {
        total_amount: 10000,
        customer_id: buyer.id,
        bonus_referrer_customer_id: usta.id,
        shift_id: shift.id,
        user_id: ADMIN,
      },
      [line],
      [{ payment_method: 'cash', amount: 10000 }],
    );
    const orderRow = db
      .prepare('SELECT bonus_referrer_customer_id FROM orders WHERE id = ?')
      .get(res.order_id);
    assert.strictEqual(orderRow?.bonus_referrer_customer_id, usta.id);
  });

  run('cash sale: usta earns, buyer does not', () => {
    const buyerPts = db.prepare('SELECT bonus_points FROM customers WHERE id = ?').get(buyer.id);
    const ustaPts = db.prepare('SELECT bonus_points FROM customers WHERE id = ?').get(usta.id);
    assert.strictEqual(Number(buyerPts?.bonus_points || 0), 0);
    assert.strictEqual(Number(ustaPts?.bonus_points || 0), 10);
  });

  run('full credit sale: usta earns on order total', () => {
    const buyer2 = customers.create({
      name: 'E2E Credit Buyer',
      phone: '+998901111103',
      allow_credit: 1,
      allow_debt: 1,
      credit_limit: 50000000,
    });
    const ustaBefore = Number(
      db.prepare('SELECT bonus_points FROM customers WHERE id = ?').get(usta.id)?.bonus_points || 0,
    );
    sales.completePOSOrder(
      {
        total_amount: 5000,
        customer_id: buyer2.id,
        bonus_referrer_customer_id: usta.id,
        shift_id: shift.id,
        user_id: ADMIN,
      },
      [{ ...line, unit_price: 5000, subtotal: 5000, total: 5000 }],
      [{ payment_method: 'credit', amount: 5000 }],
    );
    const ustaAfter = Number(
      db.prepare('SELECT bonus_points FROM customers WHERE id = ?').get(usta.id)?.bonus_points || 0,
    );
    // Recalc may raise line total to 10000; usta earns on authoritative order total.
    assert.ok(ustaAfter > ustaBefore, 'usta should earn on credit sale when selected as referrer');
  });

  run('default loyalty off: master usta earns when loyalty.master.enabled', () => {
    db.prepare(`UPDATE settings SET value = '0' WHERE key = 'loyalty.general.enabled'`).run();
    db.prepare(`UPDATE settings SET value = '1' WHERE key = 'loyalty.master.enabled'`).run();
    const ustaBefore = Number(
      db.prepare('SELECT bonus_points FROM customers WHERE id = ?').get(usta.id)?.bonus_points || 0,
    );
    sales.completePOSOrder(
      {
        total_amount: 7000,
        customer_id: null,
        bonus_referrer_customer_id: usta.id,
        shift_id: shift.id,
        user_id: ADMIN,
      },
      [{ ...line, unit_price: 7000, subtotal: 7000, total: 7000 }],
      [{ payment_method: 'cash', amount: 7000 }],
    );
    const ustaAfter = Number(
      db.prepare('SELECT bonus_points FROM customers WHERE id = ?').get(usta.id)?.bonus_points || 0,
    );
    assert.ok(ustaAfter > ustaBefore, 'master loyalty should accrue to selected usta');
  });
} catch (e) {
  console.error('Setup failed:', e);
  failed += 1;
} finally {
  try {
    close();
  } catch {
    // ignore
  }
}

console.log(`\n=== NATIJA: ${passed} OK, ${failed} FAIL ===\n`);
process.exit(failed > 0 ? 1 : 0);

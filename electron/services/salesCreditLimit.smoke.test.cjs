/* eslint-disable no-console */
/**
 * Server-side nasiya credit_limit / allow_debt + open revision sale block.
 *
 * Ishga tushirish: npm run test:credit-limit-smoke
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const WH = 'main-warehouse-001';
const ADMIN = 'default-admin-001';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-credit-limit-smoke-'));
process.env.POS_SERVER_MODE = '1';
process.env.POS_DATA_DIR = tmpDir;
process.env.POS_VERBOSE_LOGS = '0';
process.env.SMS_PROVIDER = 'off';
process.env.TELEGRAM_BOT_TOKEN = '';

const { open, close, getDb } = require('../db/open.cjs');
const { createServices } = require('./index.cjs');
const { getPaymentFeeRates } = require('../lib/paymentFee.cjs');

function cartLine(product, qtySale, unitPrice) {
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

function expectThrow(fn, re) {
  let err;
  try {
    fn();
  } catch (e) {
    err = e;
  }
  assert.ok(err, 'expected throw');
  if (re) assert.match(String(err.message || err), re);
  return err;
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

(async () => {
  try {
    console.log('\n=== CREDIT LIMIT + REVISION SALE BLOCK SMOKE ===');
    console.log(`Temp DB: ${tmpDir}\n`);

    open();
    const db = getDb();
    const services = createServices(db);
    const { sales, shifts, products, inventory, inventoryRevisions, settings } = services;

    const product = products.create({
      name: 'Credit Limit Smoke Product',
      sku: `CR-LIM-${Date.now()}`,
      sale_price: 10000,
      purchase_price: 4000,
      track_stock: 1,
      current_stock: 0,
    });
    inventory.adjustStock({
      warehouse_id: WH,
      adjustment_type: 'set',
      reason: 'Credit limit smoke stock',
      created_by: ADMIN,
      items: [{ product_id: product.id, target_quantity: 100 }],
    });

    const shift = shifts.openShift({ user_id: ADMIN });

    // --- payment_fees settings read ---
    try {
      settings.set('payment_fees.click.percent', 1.5, 'number', ADMIN);
      settings.set('payment_fees.click.fixed', 100, 'number', ADMIN);
      const rates = getPaymentFeeRates(db, 'click');
      assert.strictEqual(rates.percent, 1.5);
      assert.strictEqual(rates.fixed, 100);
      ok('payment_fees.* settings read by getPaymentFeeRates');
    } catch (e) {
      fail('payment_fees settings read', e);
    }

    // --- allow_debt / credit_limit gate ---
    const noDebtId = 'cust-no-debt-flag';
    db.prepare(
      `INSERT INTO customers (id, name, phone, type, status, balance, credit_limit, allow_debt, allow_credit, created_at, updated_at)
       VALUES (?, 'No Debt', '+998901110001', 'individual', 'active', 0, 0, 0, 0, datetime('now'), datetime('now'))`
    ).run(noDebtId);

    try {
      // Default: legacy allow (no credit_limit). Strict gate via setting.
      settings.set('sales.credit.require_allow_debt', true, 'boolean', ADMIN);
      expectThrow(
        () =>
          sales.completePOSOrder(
            {
              total_amount: 10000,
              customer_id: noDebtId,
              shift_id: shift.id,
              user_id: ADMIN,
              warehouse_id: WH,
            },
            [cartLine(product, 1, 10000)],
            []
          ),
        /nasiya ruxsat|allow_debt/i
      );
      ok('reject credit when require_allow_debt and flags off');
      settings.set('sales.credit.require_allow_debt', false, 'boolean', ADMIN);
    } catch (e) {
      fail('reject credit when allow_debt off', e);
    }

    const limitedId = 'cust-limit-100k';
    db.prepare(
      `INSERT INTO customers (id, name, phone, type, status, balance, credit_limit, allow_debt, allow_credit, created_at, updated_at)
       VALUES (?, 'Limited', '+998901110002', 'individual', 'active', 0, 50000, 1, 1, datetime('now'), datetime('now'))`
    ).run(limitedId);

    try {
      expectThrow(
        () =>
          sales.completePOSOrder(
            {
              total_amount: 80000,
              customer_id: limitedId,
              shift_id: shift.id,
              user_id: ADMIN,
              warehouse_id: WH,
              due_date: db.prepare(`SELECT date('now','localtime') AS d`).get().d,
            },
            [cartLine(product, 8, 10000)],
            []
          ),
        /kredit limiti|limit/i
      );
      ok('reject over credit_limit');
    } catch (e) {
      fail('reject over credit_limit', e);
    }

    try {
      const res = sales.completePOSOrder(
        {
          total_amount: 20000,
          customer_id: limitedId,
          shift_id: shift.id,
          user_id: ADMIN,
          warehouse_id: WH,
          due_date: db.prepare(`SELECT date('now','localtime') AS d`).get().d,
        },
        [cartLine(product, 2, 10000)],
        []
      );
      assert.ok(res?.order_id, 'sale ok');
      ok('allow credit within credit_limit');
    } catch (e) {
      fail('allow credit within credit_limit', e);
    }

    // --- open revision blocks sale ---
    try {
      const rev = inventoryRevisions.createRevision({
        warehouse_id: WH,
        created_by: ADMIN,
        notes: 'credit-limit smoke revision',
      });
      assert.ok(rev?.id, 'revision created');
      expectThrow(
        () =>
          sales.completePOSOrder(
            {
              total_amount: 10000,
              customer_id: limitedId,
              shift_id: shift.id,
              user_id: ADMIN,
              warehouse_id: WH,
            },
            [cartLine(product, 1, 10000)],
            [{ payment_method: 'cash', amount: 10000 }]
          ),
        /reviziyasi|revision/i
      );
      ok('open revision blocks POS sale');

      settings.set('inventory.revision_block_sales', false, 'boolean', ADMIN);
      const allowed = sales.completePOSOrder(
        {
          total_amount: 10000,
          customer_id: limitedId,
          shift_id: shift.id,
          user_id: ADMIN,
          warehouse_id: WH,
        },
        [cartLine(product, 1, 10000)],
        [{ payment_method: 'cash', amount: 10000 }]
      );
      assert.ok(allowed?.order_id, 'sale allowed when revision block off');
      ok('revision_block_sales=false allows sale');

      inventoryRevisions.cancelRevision({ revision_id: rev.id });
      settings.set('inventory.revision_block_sales', true, 'boolean', ADMIN);
    } catch (e) {
      fail('revision sale block', e);
    }

    console.log(`\n--- Result: ${passed} passed, ${failed} failed ---\n`);
    close();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    process.exit(failed > 0 ? 1 : 0);
  } catch (e) {
    console.error(e);
    try {
      close();
    } catch {
      /* ignore */
    }
    process.exit(1);
  }
})();

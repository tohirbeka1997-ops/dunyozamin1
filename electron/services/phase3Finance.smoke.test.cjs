/* eslint-disable no-console */
/**
 * Phase 3 finance: payment commissions, bank vs cash report, qarz credit assert.
 *
 * Ishga tushirish: node electron/services/phase3Finance.smoke.test.cjs
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { formatYmdInTimeZone } = require('../lib/timezone.cjs');
const { computePaymentFee } = require('../lib/paymentFee.cjs');
const { reconcileCustomerLedgerVsBalance } = require('../lib/customerBalance.cjs');
const { randomUUID } = require('crypto');
const { setCurrentUserId } = require('../lib/currentUser.cjs');

const WH = 'main-warehouse-001';
const ADMIN = 'default-admin-001';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-phase3-finance-'));
process.env.POS_SERVER_MODE = '1';
process.env.POS_DATA_DIR = tmpDir;
process.env.POS_VERBOSE_LOGS = '0';

const { open, close, getDb } = require('../db/open.cjs');
const { createServices } = require('./index.cjs');

let passed = 0;
let failed = 0;
function ok(name) {
  passed += 1;
  console.log(`  ✓ ${name}`);
}
function fail(name, err) {
  failed += 1;
  console.log(`  ✗ ${name}`);
  console.log(`     ${err?.message || err}`);
}
function runStep(name, fn) {
  try {
    fn();
    ok(name);
  } catch (e) {
    fail(name, e);
  }
}

function cartLine(product, qty, unit) {
  return {
    product_id: product.id,
    product_name: product.name,
    quantity: qty,
    qty_sale: qty,
    qty_base: qty,
    unit_price: unit,
    line_total: qty * unit,
  };
}

(async () => {
  console.log('\n=== PHASE 3 FINANCE SMOKE ===\n');
  try {
    open();
    const db = getDb();
    setCurrentUserId(ADMIN);
    try {
      const role = db.prepare(`SELECT id FROM roles WHERE code = 'admin' LIMIT 1`).get();
      if (role) {
        const has = db.prepare(`SELECT 1 AS ok FROM user_roles WHERE user_id = ? AND role_id = ?`).get(ADMIN, role.id);
        if (!has) {
          db.prepare(
            `INSERT INTO user_roles (id, user_id, role_id, assigned_at) VALUES (?, ?, ?, datetime('now'))`
          ).run(randomUUID(), ADMIN, role.id);
        }
      }
    } catch {
      /* best-effort */
    }
    const { products, inventory, sales, shifts, reports, dashboard, customers } = createServices(db);

    runStep('payment_fees table exists', () => {
      const row = db
        .prepare(`SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name='payment_fees' LIMIT 1`)
        .get();
      assert.ok(row?.ok, 'payment_fees missing');
    });

    db.prepare(
      `INSERT INTO settings (id, key, value, type, category, is_public, created_at, updated_at)
       VALUES (lower(hex(randomblob(16))), 'payment_fees.card.percent', '2', 'number', 'sales', 0, datetime('now'), datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value='2', updated_at=datetime('now')`
    ).run();

    const product = products.create({
      name: 'Phase3 Fee Product',
      sku: `P3F-${Date.now()}`,
      sale_price: 10000,
      purchase_price: 6000,
      track_stock: 1,
      current_stock: 0,
    });
    inventory.adjustStock({
      warehouse_id: WH,
      adjustment_type: 'set',
      reason: 'phase3 seed',
      created_by: ADMIN,
      items: [{ product_id: product.id, target_quantity: 50 }],
    });

    const shift = shifts.openShift({ user_id: ADMIN });
    const today = formatYmdInTimeZone(new Date());
    const saleTotal = 10000;
    const expectedFee = computePaymentFee(saleTotal, 2, 0);

    const cardSale = sales.completePOSOrder(
      { total_amount: saleTotal, shift_id: shift.id, user_id: ADMIN, sales_channel: 'pos' },
      [cartLine(product, 1, 10000)],
      [{ payment_method: 'card', amount: saleTotal }],
    );
    ok(`seed card sale ${saleTotal}`);

    runStep('payment_fees row recorded at checkout', () => {
      const fee = db
        .prepare(`SELECT fee_amount, fee_amount_uzs, payment_method FROM payment_fees WHERE order_id = ?`)
        .get(cardSale.order_id);
      assert.ok(fee, 'payment_fees row');
      assert.strictEqual(Number(fee.fee_amount), expectedFee);
      assert.strictEqual(String(fee.payment_method), 'card');
    });

    const cashSale = sales.completePOSOrder(
      { total_amount: saleTotal, shift_id: shift.id, user_id: ADMIN, sales_channel: 'pos' },
      [cartLine(product, 1, 10000)],
      [{ payment_method: 'cash', amount: saleTotal }],
    );
    ok(`seed cash sale ${saleTotal}`);

    runStep('cash sale does not persist a fee row', () => {
      const fee = db
        .prepare(`SELECT 1 AS ok FROM payment_fees WHERE order_id = ?`)
        .get(cashSale.order_id);
      assert.ok(!fee, 'cash should skip payment_fees');
    });

    const filters = { date_from: today, date_to: today, warehouse_id: WH };

    runStep('P&L records commission and net profit is yalpi − xarajat', () => {
      const pl = reports.getProfitAndLossSQL(filters);
      const commission = Number(pl.summary?.total_commission ?? pl.summary?.payment_fees ?? 0);
      assert.ok(Math.abs(commission - expectedFee) < 0.02, `commission ${commission} expected ${expectedFee}`);
      const expectedNet = Number(pl.summary.gross_profit) - Number(pl.summary.expenses || 0);
      assert.strictEqual(Number(pl.summary.net_profit), expectedNet);
    });

    runStep('Daily sales and dashboard include total_commission', () => {
      const daily = reports.getDailySalesReportSQL(filters);
      const dash = dashboard.getAnalytics(filters);
      const dayBrief = reports.getDailySales(today, WH);
      assert.ok(Number(daily.summary.total_commission) >= expectedFee - 0.02);
      assert.ok(Number(dash.total_commission) >= expectedFee - 0.02);
      assert.ok(Number(dayBrief.total_commission) >= expectedFee - 0.02);
      assert.strictEqual(
        Number(dash.net_profit),
        Number(dash.total_profit) - Number(dash.total_expenses || 0),
      );
    });

    runStep('bank vs cash report splits card vs cash', () => {
      const rec = reports.getBankCashReconciliation(filters);
      assert.ok(Number(rec.cash.total) >= saleTotal - 1, `cash ${rec.cash.total}`);
      assert.ok(Number(rec.bank.total) >= saleTotal - 1, `bank ${rec.bank.total}`);
      assert.ok(Number(rec.total_commission) >= expectedFee - 0.02);
    });

    const debtor = customers.create({
      name: 'Phase3 Qarz',
      phone: '+998901239003',
      allow_credit: 1,
      allow_debt: 1,
      credit_limit: 50000000,
    });

    runStep('checkout credit_amount = total − paid', () => {
      const creditRes = sales.completePOSOrder(
        {
          total_amount: 10000,
          customer_id: debtor.id,
          shift_id: shift.id,
          user_id: ADMIN,
        },
        [cartLine(product, 1, 10000)],
        [
          { payment_method: 'cash', amount: 4000 },
          { payment_method: 'credit', amount: 6000 },
        ],
      );
      const row = db
        .prepare(`SELECT paid_amount, credit_amount, total_amount FROM orders WHERE id = ?`)
        .get(creditRes.order_id);
      assert.strictEqual(Number(row.credit_amount), 6000);
      assert.ok(Number(row.paid_amount) >= 3999);

      const payLinked = customers.receivePayment({
        customer_id: debtor.id,
        amount: 6000,
        payment_method: 'cash',
        operation: 'payment_in',
        order_id: creditRes.order_id,
        received_by: ADMIN,
        shift_id: shift.id,
      });
      assert.ok(payLinked.success);
      const after = db
        .prepare(`SELECT paid_amount, credit_amount, payment_status FROM orders WHERE id = ?`)
        .get(creditRes.order_id);
      assert.ok(Number(after.credit_amount) <= 0.02, `credit after pay ${after.credit_amount}`);
      assert.ok(Number(after.paid_amount) >= 9999);
    });

    runStep('checkout rejects mismatched credit line', () => {
      assert.throws(
        () =>
          sales.completePOSOrder(
            {
              total_amount: 10000,
              customer_id: debtor.id,
              shift_id: shift.id,
              user_id: ADMIN,
            },
            [cartLine(product, 1, 10000)],
            [
              { payment_method: 'cash', amount: 4000 },
              { payment_method: 'credit', amount: 5000 },
            ],
          ),
        /credit_amount/,
      );
    });

    runStep('ledger vs customers.balance reconcile helper', () => {
      const out = reconcileCustomerLedgerVsBalance(db);
      assert.ok(Array.isArray(out.diffs));
      const viaReports = reports.reconcileCustomerAging({ as_of_date: today });
      assert.ok(Array.isArray(viaReports.ledger_diffs));
      const supplierDebt = reports.getSupplierAging();
      assert.ok(Array.isArray(supplierDebt));
    });

    db.prepare(
      `INSERT INTO settings (id, key, value, type, category, is_public, created_at, updated_at)
       VALUES (lower(hex(randomblob(16))), 'payment_fees.payme.percent', '2', 'number', 'sales', 0, datetime('now'), datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value='2', updated_at=datetime('now')`
    ).run();

    const arCustomer = customers.create({
      name: 'Phase3 AR Card',
      phone: '+998901239004',
      allow_credit: 1,
      allow_debt: 1,
      credit_limit: 50000000,
    });
    const arSale = sales.completePOSOrder(
      {
        total_amount: 10000,
        customer_id: arCustomer.id,
        shift_id: shift.id,
        user_id: ADMIN,
      },
      [cartLine(product, 1, 10000)],
      [{ payment_method: 'credit', amount: 10000 }],
    );
    const arPay = customers.receivePayment({
      customer_id: arCustomer.id,
      amount: 10000,
      payment_method: 'card',
      operation: 'payment_in',
      order_id: arSale.order_id,
      received_by: ADMIN,
      shift_id: shift.id,
    });
    assert.ok(arPay.success);

    runStep('receivePayment card records payment_fees', () => {
      const fee = db
        .prepare(`SELECT fee_amount, payment_id FROM payment_fees WHERE payment_id = ?`)
        .get(arPay.payment_id);
      assert.ok(fee, 'customer_payments fee row');
      assert.strictEqual(Number(fee.fee_amount), computePaymentFee(10000, 2, 0));
    });

    const { recordWebOrderPaymentFee } = require('../lib/paymentFee.cjs');
    const mc = db
      .prepare(
        `INSERT INTO marketplace_customers (telegram_id, first_name, phone, created_at)
         VALUES (?, ?, ?, datetime('now'))`
      )
      .run(990001 + Math.floor(Math.random() * 10000), 'P3 Web', '+998901239005');
    const webIns = db
      .prepare(
        `INSERT INTO web_orders (
           order_number, customer_id, status, payment_method, payment_status,
           total_amount, delivery_address, created_at, updated_at
         ) VALUES (?, ?, 'processing', 'payme', 'paid', 20000, 'pickup', datetime('now'), datetime('now'))`
      )
      .run(`P3-WEB-${Date.now()}`, Number(mc.lastInsertRowid));
    const webOrder = db.prepare(`SELECT * FROM web_orders WHERE id = ?`).get(webIns.lastInsertRowid);
    const webFee = recordWebOrderPaymentFee(db, webOrder);
    assert.ok(webFee.recorded, 'web payme fee recorded');

    runStep('bank recon includes Payme web + AR card collection', () => {
      const rec = reports.getBankCashReconciliation(filters);
      assert.ok(Number(rec.bank.total) >= 10000 + 20000 - 1, `bank ${rec.bank.total}`);
      const payme = (rec.methods || []).find((m) => String(m.method) === 'payme');
      assert.ok(payme && Number(payme.total) >= 19999, 'payme method in bank recon');
      assert.ok(Number(rec.total_commission) >= expectedFee + webFee.fee_amount_uzs + computePaymentFee(10000, 2, 0) - 0.05);
    });

    if (failed > 0) {
      console.log(`\nPHASE 3 FAILED: ${failed}  passed=${passed}\n`);
      process.exitCode = 1;
    } else {
      console.log(`\nPHASE 3 PASSED: ${passed} checks\n`);
    }
  } catch (err) {
    console.error('PHASE 3 fatal:', err);
    process.exitCode = 1;
  } finally {
    try {
      close();
    } catch {
      /* ignore */
    }
    process.exit(process.exitCode || 0);
  }
})();

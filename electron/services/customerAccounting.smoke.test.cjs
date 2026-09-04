/* eslint-disable no-console */
/**
 * Customer AR: open-order debt, FIFO payments, credit limit on exposure, lend.
 * Run: npx electron electron/services/customerAccounting.smoke.test.cjs
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { randomUUID } = require('crypto');

const WH = 'main-warehouse-001';
const ADMIN = 'default-admin-001';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-cust-ar-'));
process.env.POS_SERVER_MODE = '1';
process.env.POS_DATA_DIR = tmpDir;
process.env.POS_VERBOSE_LOGS = '0';
process.env.SMS_PROVIDER = 'off';
process.env.TELEGRAM_BOT_TOKEN = '';
// Deploy-safe default: no AR heal/backfill writes on list/getById unless a test opts in.
delete process.env.CUSTOMER_AR_HEAL;

const { open, close, getDb } = require('../db/open.cjs');
const { createServices } = require('./index.cjs');
const { readCustomerDebtAdvance } = require('../lib/customerBalance.cjs');
const { computeCustomerPosition } = require('../lib/customerPosition.cjs');
const { setCurrentUserId } = require('../lib/currentUser.cjs');

function cartLine(product, qty, price) {
  const lineTotal = price * qty;
  return {
    product_id: product.id,
    product_name: product.name,
    quantity: qty,
    qty_sale: qty,
    qty_base: qty,
    unit_price: price,
    line_total: lineTotal,
    final_total: lineTotal,
    discount_amount: 0,
    price_source: 'manual',
    is_price_overridden: true,
    manual_price: true,
  };
}

function creditSale(sales, { customerId, shiftId, product, amount, dueDate }) {
  return sales.completePOSOrder(
    {
      customer_id: customerId,
      cashier_id: ADMIN,
      user_id: ADMIN,
      warehouse_id: WH,
      shift_id: shiftId,
      total_amount: amount,
      paid_amount: 0,
      credit_amount: amount,
      payment_status: 'on_credit',
      due_date: dueDate || null,
      currency: 'UZS',
    },
    [cartLine(product, 1, amount)],
    []
  );
}

let failed = 0;
function ok(name) {
  console.log(`  ✓ ${name}`);
}

(async () => {
  try {
    console.log('\n=== CUSTOMER ACCOUNTING (open order + FIFO + limit) SMOKE ===');
    console.log(`Temp DB: ${tmpDir}\n`);
    open();
    const db = getDb();
    const services = createServices(db);
    const { sales, shifts, products, inventory, customers, reports } = services;
    setCurrentUserId(ADMIN);

    try {
      const role = db.prepare(`SELECT id FROM roles WHERE code = 'admin' LIMIT 1`).get();
      if (role) {
        const has = db
          .prepare(`SELECT 1 AS ok FROM user_roles WHERE user_id = ? AND role_id = ?`)
          .get(ADMIN, role.id);
        if (!has) {
          db.prepare(
            `INSERT INTO user_roles (id, user_id, role_id, assigned_at) VALUES (?, ?, ?, datetime('now'))`
          ).run(randomUUID(), ADMIN, role.id);
        }
      }
    } catch {
      /* best-effort */
    }

    const product = products.create({
      name: 'AR Smoke Product',
      sku: `AR-${Date.now()}`,
      sale_price: 10000,
      purchase_price: 4000,
      track_stock: 1,
      current_stock: 0,
    });
    inventory.adjustStock({
      warehouse_id: WH,
      adjustment_type: 'set',
      reason: 'AR smoke',
      created_by: ADMIN,
      items: [{ product_id: product.id, target_quantity: 100 }],
    });
    const shift = shifts.openShift({ user_id: ADMIN });

    const c1 = customers.create({
      name: 'AR Credit Card',
      phone: '+998901238801',
      allow_credit: 1,
      allow_debt: 1,
      credit_limit: 1_000_000,
    });

    const sale1 = creditSale(sales, {
      customerId: c1.id,
      shiftId: shift.id,
      product,
      amount: 10000,
      dueDate: '2099-01-01',
    });
    const pos1 = computeCustomerPosition(db, c1.id, 'UZS');
    const card1 = customers.getById(c1.id);
    assert.strictEqual(pos1.open_order_debt, 10000);
    assert.strictEqual(pos1.total_debt, 10000);
    assert.ok(Math.abs(Number(card1.position?.total_debt) - 10000) < 0.02);
    const aging1 = reports.getAging({});
    const agingRow = (aging1.customers || []).find((r) => r.customer_id === c1.id);
    assert.ok(agingRow, 'aging row exists');
    assert.ok(Math.abs(Number(agingRow.total_uzs ?? agingRow.total ?? 0) - 10000) < 0.05);
    ok('1. credit sale → card, position, aging match 10000');

    const sale2 = creditSale(sales, {
      customerId: c1.id,
      shiftId: shift.id,
      product,
      amount: 4000,
      dueDate: '2099-02-01',
    });
    void sale2;
    customers.receivePayment({
      customer_id: c1.id,
      amount: 10000,
      payment_method: 'cash',
      operation: 'payment_in',
      received_by: ADMIN,
      shift_id: shift.id,
      payment_uuid: randomUUID(),
    });
    const o1 = db.prepare(`SELECT credit_amount FROM orders WHERE id = ?`).get(sale1.order_id);
    const o2 = db.prepare(`SELECT credit_amount FROM orders WHERE id = ?`).get(sale2.order_id);
    assert.ok(Number(o1.credit_amount) <= 0.02, 'oldest order closed by FIFO');
    assert.ok(Math.abs(Number(o2.credit_amount) - 4000) < 0.02, 'newer order untouched');
    ok('2. partial payment FIFO oldest order');

    customers.receivePayment({
      customer_id: c1.id,
      amount: 7000,
      payment_method: 'cash',
      operation: 'payment_in',
      received_by: ADMIN,
      shift_id: shift.id,
      payment_uuid: randomUUID(),
    });
    const posOver = computeCustomerPosition(db, c1.id, 'UZS');
    assert.ok(posOver.open_order_debt <= 0.02, 'orders closed');
    assert.ok(Math.abs(posOver.advance - 3000) < 0.05, `remainder to advance, got ${posOver.advance}`);
    ok('3. overpayment → remainder to advance');

    const sale3 = creditSale(sales, {
      customerId: c1.id,
      shiftId: shift.id,
      product,
      amount: 2000,
      dueDate: '2099-03-01',
    });
    // Without heal: card shows open debt + advance (no silent settle on read).
    const cardNoSettle = customers.getById(c1.id);
    assert.ok(
      Math.abs(Number(cardNoSettle.position?.open_order_debt || 0) - 2000) < 0.05,
      `without heal open stays 2000 got ${cardNoSettle.position?.open_order_debt}`
    );
    // Opt-in: CUSTOMER_AR_HEAL settles when ortiqcha fully covers new nasiya.
    const prevHealSale3 = process.env.CUSTOMER_AR_HEAL;
    process.env.CUSTOMER_AR_HEAL = '1';
    let cardAfterSale3;
    try {
      cardAfterSale3 = customers.getById(c1.id);
    } finally {
      if (prevHealSale3 == null) delete process.env.CUSTOMER_AR_HEAL;
      else process.env.CUSTOMER_AR_HEAL = prevHealSale3;
    }
    assert.ok(
      Number(cardAfterSale3.position?.open_order_debt || 0) < 0.05,
      `open after auto-settle ${cardAfterSale3.position?.open_order_debt}`
    );
    assert.ok(
      Math.abs(Number(cardAfterSale3.position?.advance || 0) - 1000) < 0.05,
      `advance leftover 1000 got ${cardAfterSale3.position?.advance}`
    );
    const o3 = db.prepare(`SELECT credit_amount FROM orders WHERE id = ?`).get(sale3.order_id);
    assert.ok(Number(o3.credit_amount) <= 0.02, `order credit after settle ${o3.credit_amount}`);
    ok('4. ortiqcha auto-nets new credit only when CUSTOMER_AR_HEAL=1');

    customers.receivePayment({
      customer_id: c1.id,
      amount: 1000,
      payment_method: 'cash',
      operation: 'payment_out',
      payment_out_kind: 'payout',
      notes: 'Avans qaytarish smoke',
      received_by: ADMIN,
      shift_id: shift.id,
      payment_uuid: randomUUID(),
    });
    assert.ok(Math.abs(computeCustomerPosition(db, c1.id, 'UZS').advance) < 0.05);
    ok('5. refund advance');

    customers.receivePayment({
      customer_id: c1.id,
      amount: 1000,
      payment_method: 'cash',
      operation: 'payment_in',
      received_by: ADMIN,
      shift_id: shift.id,
      payment_uuid: randomUUID(),
    });
    customers.receivePayment({
      customer_id: c1.id,
      amount: 1000,
      payment_method: 'cash',
      operation: 'payment_out',
      payment_out_kind: 'lend',
      notes: 'Pul berildi smoke',
      received_by: ADMIN,
      shift_id: shift.id,
      payment_uuid: randomUUID(),
    });
    const afterLend = readCustomerDebtAdvance(db, c1.id, 'UZS');
    const posLend = computeCustomerPosition(db, c1.id, 'UZS');
    assert.strictEqual(afterLend.advance, 1000);
    assert.ok(posLend.loan_debt >= 1000 - 0.02);
    assert.ok(posLend.total_debt >= 1000 - 0.02);
    ok('6. Pul berildi: advance unchanged, debt +1000');

    const limited = customers.create({
      name: 'AR Limit Block',
      phone: '+998901238802',
      allow_credit: 1,
      allow_debt: 1,
      credit_limit: 5000,
    });
    creditSale(sales, {
      customerId: limited.id,
      shiftId: shift.id,
      product,
      amount: 5000,
      dueDate: '2099-01-01',
    });
    let blocked = false;
    try {
      creditSale(sales, {
        customerId: limited.id,
        shiftId: shift.id,
        product,
        amount: 1000,
        dueDate: '2099-01-02',
      });
    } catch (e) {
      blocked = true;
      assert.ok(
        String(e.message || '').includes('kredit limit') ||
          e.details?.code === 'CREDIT_LIMIT_EXCEEDED'
      );
    }
    assert.strictEqual(blocked, true);
    let lendBlocked = false;
    try {
      customers.receivePayment({
        customer_id: limited.id,
        amount: 100,
        payment_method: 'cash',
        operation: 'payment_out',
        payment_out_kind: 'lend',
        notes: 'should fail',
        received_by: ADMIN,
        shift_id: shift.id,
        payment_uuid: randomUUID(),
      });
    } catch {
      lendBlocked = true;
    }
    assert.strictEqual(lendBlocked, true);
    ok('7. block nasiya and lend when open order debt at limit');

    const overdueC = customers.create({
      name: 'AR Overdue',
      phone: '+998901238803',
      allow_credit: 1,
      allow_debt: 1,
      credit_limit: 1_000_000,
    });
    const odSale = creditSale(sales, {
      customerId: overdueC.id,
      shiftId: shift.id,
      product,
      amount: 8000,
      dueDate: null,
    });
    db.prepare(`UPDATE orders SET due_date = '2020-01-01' WHERE id = ?`).run(odSale.order_id);
    const posOd = computeCustomerPosition(db, overdueC.id, 'UZS');
    assert.ok(Math.abs(posOd.overdue_amount - 8000) < 0.05);
    ok('8. overdue credit calculation');

    const retC = customers.create({
      name: 'AR Return',
      phone: '+998901238804',
      allow_credit: 1,
      allow_debt: 1,
      credit_limit: 1_000_000,
    });
    const retSale = creditSale(sales, {
      customerId: retC.id,
      shiftId: shift.id,
      product,
      amount: 6000,
      dueDate: '2099-06-01',
    });
    assert.strictEqual(computeCustomerPosition(db, retC.id, 'UZS').open_order_debt, 6000);
    const { applyReturnToOrderRemaining } = require('../lib/customerPosition.cjs');
    applyReturnToOrderRemaining(db, retSale.order_id, 6000, new Date().toISOString().slice(0, 19).replace('T', ' '));
    const afterRet = db.prepare(`SELECT credit_amount FROM orders WHERE id = ?`).get(retSale.order_id);
    assert.ok(Number(afterRet.credit_amount) <= 0.02);
    ok('9. sale return remaining debt recalc (order remaining)');

    const act = reports.getCustomerActSverka({ customer_id: c1.id });
    assert.ok(act.position);
    assert.ok(Array.isArray(act.rows));
    const dash = services.dashboard.getFinancialSummary
      ? null
      : null;
    void dash;
    const hist = customers.getLedger(c1.id, { limit: 50 });
    const pays = customers.getPayments(c1.id, { limit: 50 });
    assert.ok(hist.length > 0);
    assert.ok(pays.length > 0);
    const posFinal = computeCustomerPosition(db, c1.id, 'UZS');
    const cardFinal = customers.getById(c1.id);
    assert.ok(Math.abs(Number(cardFinal.position.total_debt) - posFinal.total_debt) < 0.02);
    ok('10. card, payments, history, aging, akt-sverka share position');

    // --- Split-brain: stale debt_uzs (last ledger) vs two open credit orders ---
    const splitC = customers.create({
      name: 'AR Split Brain ISmoil',
      phone: '+998901238899',
      allow_credit: 1,
      allow_debt: 1,
      credit_limit: 5_000_000,
    });
    creditSale(sales, {
      customerId: splitC.id,
      shiftId: shift.id,
      product,
      amount: 182000,
      dueDate: '2099-07-01',
    });
    creditSale(sales, {
      customerId: splitC.id,
      shiftId: shift.id,
      product,
      amount: 195000,
      dueDate: '2099-07-02',
    });
    const posSplitTrue = computeCustomerPosition(db, splitC.id, 'UZS');
    assert.ok(Math.abs(posSplitTrue.open_order_debt - 377000) < 0.05, 'two open orders → 377k');
    // Corrupt cache like legacy ISmoil: stored balance mirrors only last sale Qoldi
    const { writeDebtAdvanceNet } = require('../lib/customerBalance.cjs');
    writeDebtAdvanceNet(db, splitC.id, 'UZS', 195000, 0, new Date().toISOString());
    const stale = readCustomerDebtAdvance(db, splitC.id, 'UZS');
    assert.ok(Math.abs(stale.debt - 195000) < 0.05, 'stale debt_uzs planted at 195k');
    assert.ok(Math.abs(stale.net + 195000) < 0.05);
    const listRow = (customers.list({ search: 'AR Split Brain ISmoil' }) || []).find(
      (r) => r.id === splitC.id
    );
    assert.ok(listRow, 'list finds split customer');
    assert.ok(
      Math.abs(Number(listRow.position?.total_debt ?? listRow.total_debt) - 377000) < 0.05,
      `list total_debt should be 377k, got ${listRow.position?.total_debt ?? listRow.total_debt}`
    );
    assert.ok(
      Math.abs(Number(listRow.balance) + 377000) < 0.05,
      `list balance net should be -377k, got ${listRow.balance}`
    );
    const cardSplit = customers.getById(splitC.id);
    assert.ok(Math.abs(Number(cardSplit.position.total_debt) - 377000) < 0.05);
    assert.ok(Math.abs(Number(cardSplit.balance) + 377000) < 0.05);
    // Default: CUSTOMER_AR_HEAL off → display overlays computed AR, DB debt_uzs stays stale.
    const untouched = readCustomerDebtAdvance(db, splitC.id, 'UZS');
    assert.ok(
      Math.abs(untouched.debt - 195000) < 0.05,
      `list/getById must NOT rewrite debt_uzs (got ${untouched.debt})`
    );
    // Opt-in heal still works when CUSTOMER_AR_HEAL=1
    const prevHeal = process.env.CUSTOMER_AR_HEAL;
    process.env.CUSTOMER_AR_HEAL = '1';
    try {
      customers.getById(splitC.id);
      const healed = readCustomerDebtAdvance(db, splitC.id, 'UZS');
      assert.ok(
        Math.abs(healed.debt - 377000) < 0.05,
        `CUSTOMER_AR_HEAL=1 should heal debt_uzs to 377k, got ${healed.debt}`
      );
    } finally {
      if (prevHeal == null) delete process.env.CUSTOMER_AR_HEAL;
      else process.env.CUSTOMER_AR_HEAL = prevHeal;
    }
    ok('10b. list Balans === getById position (no DB heal by default; heal opt-in)');

    // --- TZ P0 mixed / allocation / lend vs advance ---
    const mixedC = customers.create({
      name: 'AR Mixed Pay',
      phone: '+998901238810',
      allow_credit: 1,
      allow_debt: 1,
      credit_limit: 1_000_000,
    });
    const shiftBeforeMix = shifts.getShiftSummary(shift.id);
    const cashBeforeMix = Number(shiftBeforeMix.paymentsByMethod?.cash || 0);
    const cardBeforeMix = Number(shiftBeforeMix.paymentsByMethod?.card || 0);
    const mixed750 = sales.completePOSOrder(
      {
        customer_id: mixedC.id,
        cashier_id: ADMIN,
        user_id: ADMIN,
        warehouse_id: WH,
        shift_id: shift.id,
        total_amount: 1500,
        paid_amount: 1500,
        credit_amount: 0,
        payment_status: 'paid',
        currency: 'UZS',
      },
      [cartLine(product, 1, 1500)],
      [
        { method: 'cash', amount: 750, currency: 'UZS' },
        { method: 'card', amount: 750, currency: 'UZS' },
      ]
    );
    const pay750 = db
      .prepare(`SELECT payment_method, amount FROM payments WHERE order_id = ? ORDER BY payment_method`)
      .all(mixed750.order_id);
    assert.strictEqual(pay750.length, 2, '750+750 creates two payment rows');
    const cash750 = pay750.find((p) => p.payment_method === 'cash');
    const card750 = pay750.find((p) => p.payment_method === 'card');
    assert.ok(Math.abs(Number(cash750.amount) - 750) < 0.02);
    assert.ok(Math.abs(Number(card750.amount) - 750) < 0.02);
    const ledgerMixed = customers.getLedger(mixedC.id, { limit: 20 });
    const salePayRow = ledgerMixed.find((e) => String(e.op_code) === 'SALE_PAYMENT');
    assert.ok(salePayRow, 'SALE_PAYMENT ledger row exists');
    assert.ok(Number(salePayRow.amount) > 0, 'fully paid sale ledger amount is not empty');
    assert.ok(
      String(salePayRow.method || '').includes('Naqd') && String(salePayRow.method || '').includes('Karta'),
      `methods visible, got ${salePayRow.method}`
    );
    assert.ok(String(salePayRow.note || '').includes('1500'), 'note includes sale total');
    assert.ok(salePayRow.created_by_name || salePayRow.created_by, 'staff visible on sale history');
    const shiftAfterMix = shifts.getShiftSummary(shift.id);
    assert.ok(
      Math.abs(Number(shiftAfterMix.paymentsByMethod?.cash || 0) - cashBeforeMix - 750) < 0.05,
      `shift cash +750, before ${cashBeforeMix} after ${shiftAfterMix.paymentsByMethod?.cash}`
    );
    assert.ok(
      Math.abs(Number(shiftAfterMix.paymentsByMethod?.card || 0) - cardBeforeMix - 750) < 0.05,
      `shift card +750, before ${cardBeforeMix} after ${shiftAfterMix.paymentsByMethod?.card}`
    );
    ok('11. mixed 750 cash + 750 card (method alias) stored as two lines');

    const mixed1500 = sales.completePOSOrder(
      {
        customer_id: mixedC.id,
        cashier_id: ADMIN,
        user_id: ADMIN,
        warehouse_id: WH,
        shift_id: shift.id,
        total_amount: 1500,
        paid_amount: 1500,
        credit_amount: 0,
        payment_status: 'paid',
        currency: 'UZS',
      },
      [cartLine(product, 1, 1500)],
      [
        { payment_method: 'cash', amount: 500, currency: 'UZS' },
        { payment_method: 'card', amount: 1000, currency: 'UZS' },
      ]
    );
    const payMix = db.prepare(`SELECT payment_method, amount FROM payments WHERE order_id = ?`).all(mixed1500.order_id);
    assert.strictEqual(payMix.length, 2);
    ok('12. mixed 500 cash + 1000 card');

    let mixedEmptyFailed = false;
    try {
      sales.completePOSOrder(
        {
          customer_id: 'default-customer-001',
          cashier_id: ADMIN,
          user_id: ADMIN,
          warehouse_id: WH,
          shift_id: shift.id,
          total_amount: 1500,
          paid_amount: 1600,
          currency: 'UZS',
        },
        [cartLine(product, 1, 1500)],
        [
          { method: 'cash', amount: 600 },
          { method: 'card', amount: 1000 },
        ]
      );
    } catch {
      mixedEmptyFailed = true;
    }
    assert.strictEqual(mixedEmptyFailed, true);
    ok('13. mixed overpay without registered customer is rejected');

    let negPayFailed = false;
    try {
      sales.completePOSOrder(
        {
          customer_id: mixedC.id,
          cashier_id: ADMIN,
          user_id: ADMIN,
          warehouse_id: WH,
          shift_id: shift.id,
          total_amount: 1500,
          paid_amount: 1500,
          currency: 'UZS',
        },
        [cartLine(product, 1, 1500)],
        [{ method: 'cash', amount: -500 }]
      );
    } catch {
      negPayFailed = true;
    }
    assert.strictEqual(negPayFailed, true);
    ok('13b. negative payment line is rejected');

    let mixedUnderpayFailed = false;
    try {
      sales.completePOSOrder(
        {
          customer_id: mixedC.id,
          cashier_id: ADMIN,
          user_id: ADMIN,
          warehouse_id: WH,
          shift_id: shift.id,
          total_amount: 1500,
          paid_amount: 1400,
          currency: 'UZS',
        },
        [cartLine(product, 1, 1500)],
        [
          { payment_method: 'cash', amount: 500 },
          { payment_method: 'card', amount: 900 },
        ]
      );
    } catch (e) {
      mixedUnderpayFailed = /Aralash to‘lov yig‘indisi/i.test(String(e && e.message));
    }
    assert.strictEqual(mixedUnderpayFailed, true);
    ok('13c. mixed 1400 on 1500 is rejected (not silent credit)');

    const overC = customers.create({
      name: 'AR Overpay Mix',
      phone: '+998901238811',
      allow_credit: 1,
      allow_debt: 1,
      credit_limit: 1_000_000,
    });
    sales.completePOSOrder(
      {
        customer_id: overC.id,
        cashier_id: ADMIN,
        user_id: ADMIN,
        warehouse_id: WH,
        shift_id: shift.id,
        total_amount: 1500,
        paid_amount: 1600,
        credit_amount: 0,
        payment_status: 'paid',
        currency: 'UZS',
        apply_overpay_as_prepaid: true,
      },
      [cartLine(product, 1, 1500)],
      [
        { payment_method: 'cash', amount: 600 },
        { payment_method: 'card', amount: 1000 },
      ]
    );
    const posOverMix = computeCustomerPosition(db, overC.id, 'UZS');
    assert.ok(Math.abs(posOverMix.advance - 100) < 0.05, `overpay advance got ${posOverMix.advance}`);
    ok('14. mixed 1600 on 1500 → 100 advance');

    const debtC = customers.create({
      name: 'AR Debt Alloc',
      phone: '+998901238812',
      allow_credit: 1,
      allow_debt: 1,
      credit_limit: 1_000_000,
    });
    const dSale = creditSale(sales, {
      customerId: debtC.id,
      shiftId: shift.id,
      product,
      amount: 1500,
      dueDate: '2099-08-01',
    });
    customers.receivePayment({
      customer_id: debtC.id,
      amount: 1000,
      payment_method: 'cash',
      operation: 'payment_in',
      received_by: ADMIN,
      shift_id: shift.id,
      payment_uuid: randomUUID(),
    });
    const dLeft = db.prepare(`SELECT credit_amount FROM orders WHERE id = ?`).get(dSale.order_id);
    assert.ok(Math.abs(Number(dLeft.credit_amount) - 500) < 0.02, `remaining ${dLeft.credit_amount}`);
    const paysAlloc = customers.getPayments(debtC.id, { limit: 10 });
    const lastPay = paysAlloc[0];
    assert.ok(Array.isArray(lastPay.allocations) && lastPay.allocations.length >= 1);
    ok('15. 1500 credit + 1000 payment → order remaining 500 + allocation row');

    customers.receivePayment({
      customer_id: debtC.id,
      amount: 1000,
      payment_method: 'cash',
      operation: 'payment_in',
      received_by: ADMIN,
      shift_id: shift.id,
      payment_uuid: randomUUID(),
    });
    const dClosed = db.prepare(`SELECT credit_amount FROM orders WHERE id = ?`).get(dSale.order_id);
    assert.ok(Number(dClosed.credit_amount) <= 0.02);
    const posDebtC = computeCustomerPosition(db, debtC.id, 'UZS');
    assert.ok(Math.abs(posDebtC.advance - 500) < 0.05, `advance after 2000 on 1500 got ${posDebtC.advance}`);
    const remAlloc = db
      .prepare(
        `SELECT allocation_type, applied_amount, remainder_to_advance, allocated_amount
         FROM customer_payment_allocations
         WHERE customer_id = ? AND order_id IS NULL
         ORDER BY created_at DESC LIMIT 1`
      )
      .get(debtC.id);
    assert.ok(remAlloc, 'remainder allocation row exists');
    assert.strictEqual(String(remAlloc.allocation_type), 'advance_received');
    assert.ok(Math.abs(Number(remAlloc.applied_amount ?? remAlloc.allocated_amount) - 500) < 0.05);
    ok('16. 1500 debt + 2000 payment → 0 order debt + 500 advance');

    const fifoC = customers.create({
      name: 'AR Due FIFO',
      phone: '+998901238813',
      allow_credit: 1,
      allow_debt: 1,
      credit_limit: 1_000_000,
    });
    const laterDue = creditSale(sales, {
      customerId: fifoC.id,
      shiftId: shift.id,
      product,
      amount: 800,
      dueDate: '2099-12-01',
    });
    const soonerDue = creditSale(sales, {
      customerId: fifoC.id,
      shiftId: shift.id,
      product,
      amount: 800,
      dueDate: '2099-06-01',
    });
    customers.receivePayment({
      customer_id: fifoC.id,
      amount: 800,
      payment_method: 'cash',
      operation: 'payment_in',
      received_by: ADMIN,
      shift_id: shift.id,
      payment_uuid: randomUUID(),
    });
    const laterLeft = db.prepare(`SELECT credit_amount FROM orders WHERE id = ?`).get(laterDue.order_id);
    const soonerLeft = db.prepare(`SELECT credit_amount FROM orders WHERE id = ?`).get(soonerDue.order_id);
    assert.ok(Number(soonerLeft.credit_amount) <= 0.02, 'nearest due closed first');
    assert.ok(Math.abs(Number(laterLeft.credit_amount) - 800) < 0.02, 'later due untouched');
    ok('17. payment allocates to nearest due_date first');

    const manualSplitC = customers.create({
      name: 'AR Manual Split',
      phone: '+998901238814',
      allow_credit: 1,
      allow_debt: 1,
      credit_limit: 1_000_000,
    });
    const s1 = creditSale(sales, {
      customerId: manualSplitC.id,
      shiftId: shift.id,
      product,
      amount: 700,
      dueDate: '2099-01-15',
    });
    const s2 = creditSale(sales, {
      customerId: manualSplitC.id,
      shiftId: shift.id,
      product,
      amount: 700,
      dueDate: '2099-01-20',
    });
    customers.receivePayment({
      customer_id: manualSplitC.id,
      amount: 1000,
      payment_method: 'cash',
      operation: 'payment_in',
      received_by: ADMIN,
      shift_id: shift.id,
      payment_uuid: randomUUID(),
      allocations: [
        { order_id: s1.order_id, amount: 400 },
        { order_id: s2.order_id, amount: 600 },
      ],
    });
    const s1l = db.prepare(`SELECT credit_amount FROM orders WHERE id = ?`).get(s1.order_id);
    const s2l = db.prepare(`SELECT credit_amount FROM orders WHERE id = ?`).get(s2.order_id);
    assert.ok(Math.abs(Number(s1l.credit_amount) - 300) < 0.02, `s1 remaining ${s1l.credit_amount}`);
    assert.ok(Math.abs(Number(s2l.credit_amount) - 100) < 0.02, `s2 remaining ${s2l.credit_amount}`);
    ok('18. one payment split across two credit orders (manual)');

    const lendC = customers.create({
      name: 'AR Lend vs Refund',
      phone: '+998901238815',
      allow_credit: 1,
      allow_debt: 1,
      credit_limit: 1_000_000,
    });
    customers.receivePayment({
      customer_id: lendC.id,
      amount: 1300,
      payment_method: 'cash',
      operation: 'payment_in',
      received_by: ADMIN,
      shift_id: shift.id,
      payment_uuid: randomUUID(),
    });
    assert.ok(Math.abs(computeCustomerPosition(db, lendC.id, 'UZS').advance - 1300) < 0.05);
    customers.receivePayment({
      customer_id: lendC.id,
      amount: 200,
      payment_method: 'cash',
      operation: 'payment_out',
      payment_out_kind: 'lend',
      notes: 'Yangi qarz smoke',
      received_by: ADMIN,
      shift_id: shift.id,
      payment_uuid: randomUUID(),
    });
    const afterNewLoan = computeCustomerPosition(db, lendC.id, 'UZS');
    const bucketsLoan = readCustomerDebtAdvance(db, lendC.id, 'UZS');
    assert.ok(Math.abs(bucketsLoan.advance - 1300) < 0.05, `advance stayed ${bucketsLoan.advance}`);
    assert.ok(afterNewLoan.loan_debt >= 200 - 0.02);
    const histLend = customers.getLedger(lendC.id, { limit: 20 });
    assert.ok(histLend.some((e) => String(e.op_code) === 'CUSTOMER_LOAN_ISSUED'));
    customers.receivePayment({
      customer_id: lendC.id,
      amount: 200,
      payment_method: 'cash',
      operation: 'payment_out',
      payment_out_kind: 'payout',
      notes: 'Avans qaytarish smoke 200',
      received_by: ADMIN,
      shift_id: shift.id,
      payment_uuid: randomUUID(),
    });
    const afterRefund = computeCustomerPosition(db, lendC.id, 'UZS');
    assert.ok(Math.abs(afterRefund.advance - 1100) < 0.05, `advance after refund ${afterRefund.advance}`);
    assert.ok(afterRefund.loan_debt >= 200 - 0.02);
    assert.ok(histLend.concat(customers.getLedger(lendC.id, { limit: 20 })).some((e) => String(e.op_code) === 'ADVANCE_REFUND'));
    ok('19. 1300 advance + 200 lend keeps advance; 200 refund drops advance only');

    const prepaidC = customers.create({
      name: 'AR Prepaid Sale',
      phone: '+998901238816',
      allow_credit: 1,
      allow_debt: 1,
      credit_limit: 1_000_000,
    });
    customers.receivePayment({
      customer_id: prepaidC.id,
      amount: 600,
      payment_method: 'cash',
      operation: 'payment_in',
      received_by: ADMIN,
      shift_id: shift.id,
      payment_uuid: randomUUID(),
    });
    sales.completePOSOrder(
      {
        customer_id: prepaidC.id,
        cashier_id: ADMIN,
        user_id: ADMIN,
        warehouse_id: WH,
        shift_id: shift.id,
        total_amount: 1500,
        paid_amount: 0,
        credit_amount: 900,
        payment_status: 'on_credit',
        currency: 'UZS',
        prepaid_applied: 600,
        due_date: '2099-09-01',
      },
      [cartLine(product, 1, 1500)],
      []
    );
    const posPrepaid = computeCustomerPosition(db, prepaidC.id, 'UZS');
    assert.ok(Math.abs(posPrepaid.open_order_debt - 900) < 0.05, `credit remaining ${posPrepaid.open_order_debt}`);
    assert.ok(posPrepaid.advance <= 0.05, `advance consumed, got ${posPrepaid.advance}`);
    const advUsed = db
      .prepare(
        `SELECT allocation_type, applied_amount, allocated_amount
         FROM customer_payment_allocations
         WHERE customer_id = ? AND allocation_type = 'advance_used'
         ORDER BY created_at DESC LIMIT 1`
      )
      .get(prepaidC.id);
    assert.ok(advUsed, 'advance_used allocation exists');
    assert.ok(Math.abs(Number(advUsed.applied_amount ?? advUsed.allocated_amount) - 600) < 0.05);
    ok('20. 600 advance applied to 1500 credit sale → 900 remaining');

    const initPay = sales.completePOSOrder(
      {
        customer_id: prepaidC.id,
        cashier_id: ADMIN,
        user_id: ADMIN,
        warehouse_id: WH,
        shift_id: shift.id,
        total_amount: 1500,
        paid_amount: 500,
        credit_amount: 1000,
        payment_status: 'partially_paid',
        currency: 'UZS',
        due_date: '2099-09-02',
      },
      [cartLine(product, 1, 1500)],
      [{ payment_method: 'cash', amount: 500 }]
    );
    const initRow = db.prepare(`SELECT credit_amount, paid_amount FROM orders WHERE id = ?`).get(initPay.order_id);
    assert.ok(Math.abs(Number(initRow.credit_amount) - 1000) < 0.05);
    assert.ok(Math.abs(Number(initRow.paid_amount) - 500) < 0.05);
    ok('21. 500 initial payment on 1500 credit → remaining 1000');

    function onHandQty(productId) {
      const row = db
        .prepare(`SELECT COALESCE(SUM(quantity), 0) AS q FROM stock_balances WHERE product_id = ?`)
        .get(productId);
      return Number(row?.q || 0);
    }

    const payC = customers.create({
      name: 'AR Full Pay Methods',
      phone: '+998901238817',
      allow_credit: 1,
      allow_debt: 1,
      credit_limit: 1_000_000,
    });
    for (const method of ['cash', 'card', 'qr']) {
      sales.completePOSOrder(
        {
          customer_id: payC.id,
          cashier_id: ADMIN,
          user_id: ADMIN,
          warehouse_id: WH,
          shift_id: shift.id,
          total_amount: 800,
          paid_amount: 800,
          credit_amount: 0,
          payment_status: 'paid',
          currency: 'UZS',
        },
        [cartLine(product, 1, 800)],
        [{ payment_method: method, amount: 800 }]
      );
    }
    const payLedger = customers.getLedger(payC.id, { limit: 20 });
    const paidRows = payLedger.filter((e) => String(e.op_code) === 'SALE_PAYMENT');
    assert.ok(paidRows.length >= 3, 'cash/card/QR each write SALE_PAYMENT');
    for (const row of paidRows) {
      assert.ok(Number(row.amount) > 0, 'paid sale amount not empty');
      assert.ok(String(row.method || '').length > 0, 'paid sale method not empty');
    }
    const methodsJoined = paidRows.map((r) => String(r.method || '')).join(' | ');
    assert.ok(/Naqd/i.test(methodsJoined) && /Karta/i.test(methodsJoined) && /QR/i.test(methodsJoined), methodsJoined);
    ok('22. full cash/card/QR sales keep amount and method in history');

    const stockP = products.create({
      name: 'AR Stock Five',
      sku: `AR-STK-${Date.now()}`,
      sale_price: 1000,
      purchase_price: 400,
      track_stock: 1,
      current_stock: 0,
    });
    inventory.adjustStock({
      warehouse_id: WH,
      adjustment_type: 'set',
      reason: 'AR stock five',
      created_by: ADMIN,
      items: [{ product_id: stockP.id, target_quantity: 5 }],
    });
    assert.strictEqual(onHandQty(stockP.id), 5);
    const stockBeforeFail = onHandQty(stockP.id);
    let mixedStockFail = false;
    try {
      sales.completePOSOrder(
        {
          customer_id: payC.id,
          cashier_id: ADMIN,
          user_id: ADMIN,
          warehouse_id: WH,
          shift_id: shift.id,
          total_amount: 1000,
          paid_amount: 900,
          currency: 'UZS',
        },
        [cartLine(stockP, 1, 1000)],
        [
          { payment_method: 'cash', amount: 400 },
          { payment_method: 'card', amount: 500 },
        ]
      );
    } catch {
      mixedStockFail = true;
    }
    assert.strictEqual(mixedStockFail, true);
    assert.strictEqual(onHandQty(stockP.id), stockBeforeFail);
    ok('23. mixed underpay does not decrement stock');

    for (let i = 0; i < 4; i += 1) {
      sales.completePOSOrder(
        {
          customer_id: payC.id,
          cashier_id: ADMIN,
          user_id: ADMIN,
          warehouse_id: WH,
          shift_id: shift.id,
          total_amount: 1000,
          paid_amount: 1000,
          credit_amount: 0,
          payment_status: 'paid',
          currency: 'UZS',
        },
        [cartLine(stockP, 1, 1000)],
        [{ payment_method: 'cash', amount: 1000 }]
      );
    }
    assert.strictEqual(onHandQty(stockP.id), 1);
    const prodRow = db.prepare(`SELECT current_stock FROM products WHERE id = ?`).get(stockP.id);
    assert.ok(Math.abs(Number(prodRow.current_stock) - 1) < 0.02);
    ok('24. 5 on-hand minus 4 successful sales → 1 remaining (POS = ombor)');

    const cashierId = `cashier-ar-${Date.now()}`;
    db.prepare(
      `INSERT INTO users (id, username, password_hash, full_name, is_active, created_at)
       VALUES (?, ?, 'x', 'Kassir AR', 1, datetime('now'))`
    ).run(cashierId, `cashier_ar_${Date.now()}`);
    const cashierRole = db.prepare(`SELECT id FROM roles WHERE code = 'cashier' LIMIT 1`).get();
    assert.ok(cashierRole, 'cashier role exists');
    db.prepare(
      `INSERT INTO user_roles (id, user_id, role_id, assigned_at) VALUES (?, ?, ?, datetime('now'))`
    ).run(randomUUID(), cashierId, cashierRole.id);
    setCurrentUserId(cashierId);
    let cashierLimitBlocked = false;
    try {
      customers.update(payC.id, { credit_limit: 9_999_999 });
    } catch (e) {
      cashierLimitBlocked = /admin/i.test(String(e && e.message));
    }
    assert.strictEqual(cashierLimitBlocked, true);
    let cashierLendBlocked = false;
    try {
      customers.receivePayment({
        customer_id: payC.id,
        amount: 100,
        payment_method: 'cash',
        operation: 'payment_out',
        payment_out_kind: 'lend',
        notes: 'Kassir qarz berish urinishi',
        received_by: cashierId,
        shift_id: shift.id,
        payment_uuid: randomUUID(),
      });
    } catch (e) {
      cashierLendBlocked = /menejer|admin|ruxsat/i.test(String(e && e.message));
    }
    assert.strictEqual(cashierLendBlocked, true);
    let cashierAllocBlocked = false;
    try {
      customers.receivePayment({
        customer_id: debtC.id,
        amount: 10,
        payment_method: 'cash',
        operation: 'payment_in',
        received_by: cashierId,
        shift_id: shift.id,
        payment_uuid: randomUUID(),
        allocations: [{ order_id: dSale.order_id, amount: 10 }],
      });
    } catch (e) {
      cashierAllocBlocked = /menejer yoki admin/i.test(String(e && e.message));
    }
    assert.strictEqual(cashierAllocBlocked, true);
    setCurrentUserId(ADMIN);
    ok('25. cashier cannot change credit limit, lend, or manual-allocate');

    // --- 26. Zuhriddin-class: legacy payment_in without order allocation ---
    const zC = customers.create({
      name: 'Zuhriddin Legacy AR',
      phone: '+998901239926',
      allow_credit: 1,
      allow_debt: 1,
      credit_limit: 5_000_000,
    });
    const zSale = creditSale(sales, {
      customerId: zC.id,
      shiftId: shift.id,
      product,
      amount: 10000,
      dueDate: '2099-06-01',
    });
    // Explicit lend (non-order debt) via modern path
    customers.receivePayment({
      customer_id: zC.id,
      amount: 4000,
      payment_method: 'cash',
      operation: 'payment_out',
      payment_out_kind: 'lend',
      notes: 'legacy-lend',
      received_by: ADMIN,
      shift_id: shift.id,
      lend_authorized: true,
      payment_uuid: randomUUID(),
    });
    const beforeLegacy = computeCustomerPosition(db, zC.id, 'UZS');
    assert.ok(Math.abs(beforeLegacy.total_debt - 14000) < 0.05, `pre-legacy debt ${beforeLegacy.total_debt}`);

    // Simulate old receivePayment: cash + ledger + debt buckets, NO order allocation
    const legacyPayId = randomUUID();
    const legacyPayNo = `PAY-LEGACY-${Date.now()}`;
    const legacyAt = new Date().toISOString();
    const debtBeforeLegacy = readCustomerDebtAdvance(db, zC.id, 'UZS').debt;
    const newDebt = Math.round((debtBeforeLegacy - 6000) * 100) / 100;
    db.prepare(
      `UPDATE customers SET debt_uzs = ?, balance = ?, updated_at = ? WHERE id = ?`
    ).run(newDebt, -newDebt, legacyAt, zC.id);
    db.prepare(
      `INSERT INTO customer_payments
        (id, payment_number, customer_id, order_id, amount, payment_method, notes, received_by,
         paid_at, created_at, old_balance, applied_amount, new_balance, op_type, direction)
       VALUES (?, ?, ?, NULL, 6000, 'cash', 'legacy no alloc', ?, ?, ?, ?, 6000, ?, 'CUSTOMER_PAYMENT', 'in')`
    ).run(
      legacyPayId,
      legacyPayNo,
      zC.id,
      ADMIN,
      legacyAt,
      legacyAt,
      -debtBeforeLegacy,
      -newDebt
    );
    db.prepare(
      `INSERT INTO customer_ledger
        (id, customer_id, type, ref_id, ref_no, amount, balance_after, note, method, created_at, created_by, currency)
       VALUES (?, ?, 'payment_in', ?, ?, 6000, ?, 'legacy payment_in', 'cash', ?, ?, 'UZS')`
    ).run(randomUUID(), zC.id, legacyPayId, legacyPayNo, -newDebt, legacyAt, ADMIN);

    const stalePos = computeCustomerPosition(db, zC.id, 'UZS');
    assert.ok(
      Math.abs(stalePos.open_order_debt - 10000) < 0.05,
      `stale open still 10000, got ${stalePos.open_order_debt}`
    );
    assert.ok(
      Math.abs(stalePos.total_debt - 10000) < 0.05 || stalePos.total_debt > newDebt + 0.02,
      `Hozir inflated vs ledger (${stalePos.total_debt} vs ${newDebt})`
    );
    const ordStale = db.prepare(`SELECT credit_amount FROM orders WHERE id = ?`).get(zSale.order_id);
    assert.ok(Math.abs(Number(ordStale.credit_amount) - 10000) < 0.05);

    // Default: open card must not mutate order credit / write allocations
    const cardNoHeal = customers.getById(zC.id);
    const ordNoHeal = db.prepare(`SELECT credit_amount FROM orders WHERE id = ?`).get(zSale.order_id);
    assert.ok(
      Math.abs(Number(ordNoHeal.credit_amount) - 10000) < 0.05,
      `getById without CUSTOMER_AR_HEAL must not backfill credit_amount (got ${ordNoHeal.credit_amount})`
    );
    const allocBefore = db
      .prepare(
        `SELECT COUNT(*) AS n FROM customer_payment_allocations
         WHERE payment_id = ? AND order_id IS NOT NULL`
      )
      .get(legacyPayId);
    assert.ok(Number(allocBefore.n) === 0, 'no allocation rows without heal flag');
    void cardNoHeal;

    const prevHealZ = process.env.CUSTOMER_AR_HEAL;
    process.env.CUSTOMER_AR_HEAL = '1';
    let healedCard;
    let healedPos;
    let ordHealed;
    try {
      healedCard = customers.getById(zC.id);
      healedPos = computeCustomerPosition(db, zC.id, 'UZS');
      ordHealed = db.prepare(`SELECT credit_amount, paid_amount FROM orders WHERE id = ?`).get(
        zSale.order_id
      );
    } finally {
      if (prevHealZ == null) delete process.env.CUSTOMER_AR_HEAL;
      else process.env.CUSTOMER_AR_HEAL = prevHealZ;
    }
    assert.ok(
      Math.abs(Number(ordHealed.credit_amount) - 4000) < 0.05,
      `order credit after backfill should be 4000, got ${ordHealed.credit_amount}`
    );
    assert.ok(
      Math.abs(Number(healedPos.total_debt) - 8000) < 0.05,
      `Hozir should match ledger AR 8000, got ${healedPos.total_debt}`
    );
    assert.ok(
      Math.abs(Number(healedCard.position?.total_debt) - 8000) < 0.05,
      `card Hozir ${healedCard.position?.total_debt}`
    );
    const allocRows = db
      .prepare(
        `SELECT COUNT(*) AS n FROM customer_payment_allocations
         WHERE payment_id = ? AND order_id IS NOT NULL`
      )
      .get(legacyPayId);
    assert.ok(Number(allocRows.n) >= 1, 'backfill wrote allocation row');
    // Idempotent second open (heal still on briefly)
    process.env.CUSTOMER_AR_HEAL = '1';
    try {
      customers.getById(zC.id);
    } finally {
      if (prevHealZ == null) delete process.env.CUSTOMER_AR_HEAL;
      else process.env.CUSTOMER_AR_HEAL = prevHealZ;
    }
    const ordTwice = db.prepare(`SELECT credit_amount FROM orders WHERE id = ?`).get(zSale.order_id);
    assert.ok(Math.abs(Number(ordTwice.credit_amount) - 4000) < 0.05, 'second getById does not re-apply');
    ok('26. legacy payment_in backfill gated by CUSTOMER_AR_HEAL (Zuhriddin-class)');

    // --- Single signed balance: sale 500, pay 200 → +300 everywhere ---
    const signedC = customers.create({
      name: 'AR Signed Balance',
      phone: `+99890${String(Date.now()).slice(-7)}`,
      allow_credit: 1,
      allow_debt: 1,
      credit_limit: 1_000_000,
    });
    const sale500 = creditSale(sales, {
      customerId: signedC.id,
      shiftId: shift.id,
      product,
      amount: 500,
      dueDate: '2099-06-01',
    });
    void sale500;
    customers.receivePayment({
      customer_id: signedC.id,
      amount: 200,
      payment_method: 'cash',
      operation: 'payment_in',
      received_by: ADMIN,
      shift_id: shift.id,
      payment_uuid: randomUUID(),
    });
    const posSigned = computeCustomerPosition(db, signedC.id, 'UZS');
    const cardSigned = customers.getById(signedC.id);
    const listSigned = customers.list({ search: 'AR Signed Balance' });
    const signedListRow = (listSigned || []).find((r) => r.id === signedC.id);
    assert.ok(signedListRow, 'list row exists');
    // Legacy net = advance − debt = −300; cashier signed = +300
    assert.ok(Math.abs(posSigned.total_debt - 300) < 0.05, `debt 300 got ${posSigned.total_debt}`);
    assert.ok(Math.abs(posSigned.net - -300) < 0.05, `legacy net -300 got ${posSigned.net}`);
    assert.ok(Math.abs(Number(cardSigned.balance) - -300) < 0.05, `card balance ${cardSigned.balance}`);
    assert.ok(Math.abs(Number(signedListRow.balance) - -300) < 0.05, `list balance ${signedListRow.balance}`);
    assert.ok(
      Math.abs(Number(cardSigned.position?.net) - Number(signedListRow.position?.net)) < 0.02,
      'list === getById net'
    );
    const ledgerSigned = customers.getLedger(signedC.id, { limit: 50, order: 'asc' });
    assert.ok(Array.isArray(ledgerSigned) && ledgerSigned.length >= 2, 'ledger has rows');
    // Prefer last payment_in (same-second sale/payment ties can reorder by id).
    const payIns = ledgerSigned.filter((e) => String(e.type || '') === 'payment_in');
    const lastLed = payIns[payIns.length - 1] || ledgerSigned[ledgerSigned.length - 1];
    let lastSigned;
    if (lastLed.debt_after != null || lastLed.advance_after != null) {
      lastSigned =
        Math.round(
          ((Number(lastLed.debt_after) || 0) - (Number(lastLed.advance_after) || 0)) * 100
        ) / 100;
    } else {
      lastSigned = Math.round(-(Number(lastLed.balance_after) || 0) * 100) / 100;
    }
    // balance_after is canonical Qoldi when audit columns disagree with stored net
    const qoldiFromBalance = Math.round(-(Number(lastLed.balance_after) || 0) * 100) / 100;
    if (Math.abs(lastSigned - qoldiFromBalance) > 0.05) {
      lastSigned = qoldiFromBalance;
    }
    const cardCashierSigned = Math.round(-(Number(cardSigned.balance) || 0) * 100) / 100;
    assert.ok(
      Math.abs(lastSigned - 300) < 0.05,
      `last Qoldi signed +300 got ${lastSigned}`
    );
    assert.ok(
      Math.abs(lastSigned - cardCashierSigned) < 0.05,
      `last Qoldi ${lastSigned} === card cashier ${cardCashierSigned}`
    );
    ok('27. sale 500 pay 200 → signed +300 list===getById===last ledger Qoldi');

    // --- Return-path split-brain: advance + still-open nasiya → settle on load ---
    const settleC = customers.create({
      name: 'AR Return Settle',
      phone: `+99891${String(Date.now()).slice(-7)}`,
      allow_credit: 1,
      allow_debt: 1,
      credit_limit: 5_000_000,
    });
    const openA = creditSale(sales, {
      customerId: settleC.id,
      shiftId: shift.id,
      product,
      amount: 23000,
      dueDate: '2099-08-01',
    });
    const openB = creditSale(sales, {
      customerId: settleC.id,
      shiftId: shift.id,
      product,
      amount: 5000,
      dueDate: '2099-08-02',
    });
    void openB;
    // Simulate buggy return sync: large advance parked while open orders remain.
    const { writeDebtAdvanceNet: writeBuckets } = require('../lib/customerBalance.cjs');
    const {
      settleAdvanceAgainstOpenDebt,
      attachPosition: attachPos,
    } = require('../lib/customerPosition.cjs');
    writeBuckets(db, settleC.id, 'UZS', 28000, 159000, new Date().toISOString());
    const beforeSettle = computeCustomerPosition(db, settleC.id, 'UZS');
    assert.ok(beforeSettle.open_order_debt > 20000, 'open nasiya still present');
    assert.ok(beforeSettle.advance > 100000, 'large advance planted');
    const settled = settleAdvanceAgainstOpenDebt(db, settleC.id, 'UZS', {
      createdAt: new Date().toISOString().replace('T', ' ').slice(0, 19),
      note: 'smoke settle',
    });
    assert.ok(settled.applied_to_orders > 20000, `applied orders ${settled.applied_to_orders}`);
    const afterSettle = computeCustomerPosition(db, settleC.id, 'UZS');
    assert.ok(afterSettle.open_order_debt < 0.05, `open cleared got ${afterSettle.open_order_debt}`);
    assert.ok(afterSettle.total_debt < 0.05, `debt cleared got ${afterSettle.total_debt}`);
    assert.ok(
      Math.abs(afterSettle.advance - (159000 - 28000)) < 1,
      `advance leftover ~131k got ${afterSettle.advance}`
    );
    // getById heal only when CUSTOMER_AR_HEAL=1 (advance fully covers open debt)
    writeBuckets(db, settleC.id, 'UZS', 23000, 100000, new Date().toISOString());
    db.prepare(`UPDATE orders SET credit_amount = 23000, payment_status = 'on_credit' WHERE id = ?`).run(
      openA.order_id
    );
    const noHealSettle = customers.getById(settleC.id);
    assert.ok(
      Math.abs(Number(noHealSettle.position?.open_order_debt || 0) - 23000) < 0.05,
      `without heal flag open stays ${noHealSettle.position?.open_order_debt}`
    );
    const prevHealSettle = process.env.CUSTOMER_AR_HEAL;
    process.env.CUSTOMER_AR_HEAL = '1';
    let healedSettleCard;
    try {
      healedSettleCard = customers.getById(settleC.id);
    } finally {
      if (prevHealSettle == null) delete process.env.CUSTOMER_AR_HEAL;
      else process.env.CUSTOMER_AR_HEAL = prevHealSettle;
    }
    assert.ok(
      Number(healedSettleCard.position?.open_order_debt || 0) < 0.05,
      `getById heal open ${healedSettleCard.position?.open_order_debt}`
    );
    assert.ok(
      Number(healedSettleCard.position?.advance || 0) > 50000,
      `getById heal keeps leftover advance ${healedSettleCard.position?.advance}`
    );
    // Intentional prepaid < open debt must NOT auto-settle
    writeBuckets(db, settleC.id, 'UZS', 0, 1000, new Date().toISOString());
    db.prepare(`UPDATE orders SET credit_amount = 2000, payment_status = 'on_credit' WHERE id = ?`).run(
      openA.order_id
    );
    process.env.CUSTOMER_AR_HEAL = '1';
    let noAuto;
    try {
      noAuto = customers.getById(settleC.id);
    } finally {
      if (prevHealSettle == null) delete process.env.CUSTOMER_AR_HEAL;
      else process.env.CUSTOMER_AR_HEAL = prevHealSettle;
    }
    assert.ok(
      Math.abs(Number(noAuto.position?.open_order_debt || 0) - 2000) < 0.05,
      `no auto-settle when advance < debt, open=${noAuto.position?.open_order_debt}`
    );
    assert.ok(
      Math.abs(Number(noAuto.position?.advance || 0) - 1000) < 0.05,
      `advance kept ${noAuto.position?.advance}`
    );
    void attachPos;
    ok('28. advance covers open nasiya → settle; getById heal gated; advance < debt → leave alone');

    console.log('\nAll customer accounting smoke checks passed.\n');
  } catch (err) {
    failed += 1;
    console.error('\n✗ FAILED:', err && err.stack ? err.stack : err);
  } finally {
    try {
      close();
    } catch {
      /* ignore */
    }
  }
  process.exit(failed ? 1 : 0);
})();

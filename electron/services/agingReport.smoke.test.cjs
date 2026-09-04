/* eslint-disable no-console */
/**
 * agingReport.smoke.test.cjs
 * Qarzdorlik yoshi (Aging) hisoboti: chegara kunlar, FIFO, balans mosligi.
 *
 * Ishga tushirish: npm run test:aging-smoke
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const WH = 'main-warehouse-001';
const ADMIN = 'default-admin-001';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-aging-smoke-'));
process.env.POS_SERVER_MODE = '1';
process.env.POS_DATA_DIR = tmpDir;
process.env.POS_VERBOSE_LOGS = '0';

const { open, close, getDb } = require('../db/open.cjs');
const { createServices } = require('./index.cjs');
const { formatYmdInTimeZone } = require('../lib/timezone.cjs');
const { bucketAgeDays, bucketSum, allocateFifoPool } = require('../lib/agingCalc.cjs');
const { readBalanceInCurrency } = require('../lib/customerBalance.cjs');

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
  };
}

function sumRows(rows) {
  return (rows || []).reduce(
    (acc, r) => ({
      total: acc.total + Number(r.total_debt || 0),
      current: acc.current + Number(r.current || 0),
      days_8_30: acc.days_8_30 + Number(r.days_8_30 || 0),
      days_31_60: acc.days_31_60 + Number(r.days_31_60 || 0),
      days_60_plus: acc.days_60_plus + Number(r.days_60_plus || 0),
    }),
    { total: 0, current: 0, days_8_30: 0, days_31_60: 0, days_60_plus: 0 }
  );
}

function rowBucketSum(row) {
  return (
    Number(row.current || 0) +
    Number(row.days_8_30 || 0) +
    Number(row.days_31_60 || 0) +
    Number(row.days_60_plus || 0)
  );
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

console.log('\n=== AGING REPORT SMOKE TEST ===');
console.log(`Temp DB: ${tmpDir}\n`);

try {
  open();
  const db = getDb();
  const { products, inventory, sales, shifts, customers, reports } = createServices(db);

  runStep('unit: bucket boundaries 7/8, 30/31, 60/61', () => {
    assert.strictEqual(bucketAgeDays(7), '0_7');
    assert.strictEqual(bucketAgeDays(8), '8_30');
    assert.strictEqual(bucketAgeDays(30), '8_30');
    assert.strictEqual(bucketAgeDays(31), '31_60');
    assert.strictEqual(bucketAgeDays(60), '31_60');
    assert.strictEqual(bucketAgeDays(61), '60_plus');
  });

  runStep('unit: FIFO partial payment', () => {
    const inv = [{ outstanding: 10000 }, { outstanding: 20000 }];
    allocateFifoPool(inv, 12000);
    assert.strictEqual(inv[0].outstanding, 0);
    assert.strictEqual(inv[1].outstanding, 18000);
  });

  const product = products.create({
    name: 'Aging Smoke Product',
    sku: `AGING-SMOKE-${Date.now()}`,
    sale_price: 5000,
    purchase_price: 2000,
    track_stock: 1,
    current_stock: 0,
  });
  inventory.adjustStock({
    warehouse_id: WH,
    adjustment_type: 'set',
    reason: 'Aging smoke stock',
    created_by: ADMIN,
    items: [{ product_id: product.id, target_quantity: 100 }],
  });

  const customer = customers.create({
    name: 'Aging Smoke Mijoz',
    phone: '+998901777000',
    allow_credit: 1,
    allow_debt: 1,
    credit_limit: 50000000,
  });
  const customerId = customer.id;
  ok('mijoz + mahsulot');

  const shift = shifts.openShift({ user_id: ADMIN });
  const today = formatYmdInTimeZone(new Date());

  const oldDue = db
    .prepare(`SELECT date(?, '-20 days') AS d`)
    .get(today).d;
  const midDue = db
    .prepare(`SELECT date(?, '-15 days') AS d`)
    .get(today).d;

  const saleOld = sales.completePOSOrder(
    {
      total_amount: 10000,
      customer_id: customerId,
      shift_id: shift.id,
      user_id: ADMIN,
      due_date: today,
    },
    [cartLine(product, 2, 5000)],
    [{ payment_method: 'credit', amount: 10000 }],
  );
  db.prepare(`UPDATE orders SET due_date = ? WHERE id = ?`).run(oldDue, saleOld.order_id);

  const saleMid = sales.completePOSOrder(
    {
      total_amount: 15000,
      customer_id: customerId,
      shift_id: shift.id,
      user_id: ADMIN,
      due_date: today,
    },
    [cartLine(product, 3, 5000)],
    [{ payment_method: 'credit', amount: 15000 }],
  );
  db.prepare(`UPDATE orders SET due_date = ? WHERE id = ?`).run(midDue, saleMid.order_id);

  assert.strictEqual(readBalanceInCurrency(db, customerId, 'UZS'), -25000);
  ok('ikki nasiya sotuv (25000 qarz)');

  runStep('FIFO: qisman to‘lov eng eski invoice dan', () => {
    customers.receivePayment(customerId, 8000, 'cash', 'aging smoke partial', ADMIN, null, 'test');
    assert.strictEqual(readBalanceInCurrency(db, customerId, 'UZS'), -17000);
  });

  runStep('getCustomerAging: jami = balans', () => {
    const rows = reports.getCustomerAging().filter((r) => r.id.startsWith(`${customerId}::`));
    assert.ok(rows.length >= 1);
    const uzsRow = rows.find((r) => r.ledger_currency === 'UZS') || rows[0];
    const debt = Math.abs(readBalanceInCurrency(db, customerId, 'UZS'));
    assert.ok(Math.abs(Number(uzsRow.total_debt) - debt) < 1, `total_debt ${uzsRow.total_debt} vs balance ${debt}`);
    assert.ok(Math.abs(rowBucketSum(uzsRow) - Number(uzsRow.total_debt)) < 1);
  });

  runStep('getCustomerAging: cards sum = table sum', () => {
    const rows = reports.getCustomerAging();
    const totals = sumRows(rows.filter((r) => String(r.ledger_currency || 'UZS') === 'UZS'));
    assert.ok(Math.abs(totals.total - (totals.current + totals.days_8_30 + totals.days_31_60 + totals.days_60_plus)) < 1);
  });

  runStep('customer/supplier aging never mixed in getAging', () => {
    const rep = reports.getAging({ as_of_date: today });
    assert.ok(Array.isArray(rep.customers));
    assert.ok(Array.isArray(rep.suppliers));
    for (const c of rep.customers) {
      assert.ok(c.customer_id);
      assert.ok(!c.supplier_id);
    }
    for (const s of rep.suppliers) {
      assert.ok(s.supplier_id);
      assert.ok(!s.customer_id);
    }
  });

  runStep('default-customer-001 aging ro‘yxatida yo‘q', () => {
    const rows = reports.getCustomerAging();
    assert.ok(!rows.some((r) => String(r.id).startsWith('default-customer-001')));
  });

  runStep('reconcileCustomerAging: diff struktura', () => {
    const out = reports.reconcileCustomerAging({ as_of_date: today });
    assert.ok(out && typeof out === 'object');
    assert.ok(Array.isArray(out.diffs));
    assert.ok(typeof out.aging_total_uzs === 'number');
    assert.ok(typeof out.independent_total_uzs === 'number');
  });

  runStep('getAgingWarnings: telefon "-" ogohlantirish', () => {
    const bad = customers.create({
      name: 'Telefonsiz Qarzdor',
      phone: '',
      allow_credit: 1,
      allow_debt: 1,
      credit_limit: 50000000,
    });
    // Plant invalid placeholder phone the way legacy rows look in reports.
    db.prepare(`UPDATE customers SET phone = '-', phone_normalized = NULL WHERE id = ?`).run(bad.id);
    sales.completePOSOrder(
      { total_amount: 5000, customer_id: bad.id, shift_id: shift.id, user_id: ADMIN, due_date: today },
      [cartLine(product, 1, 5000)],
      [{ payment_method: 'credit', amount: 5000 }],
    );
    const warnings = reports.getAgingWarnings();
    const phoneWarn = warnings.find((w) => w.code === 'debtors_missing_phone');
    assert.ok(phoneWarn);
    assert.ok(Number(phoneWarn.count) >= 1);
  });

  runStep('due_date anchor: 15 kun bucket 8-30', () => {
    const rep = reports.getAging({ as_of_date: today });
    const row = (rep.customers || []).find((c) => c.customer_id === customerId);
    assert.ok(row);
    assert.ok(Number(row._8_30_uzs ?? row._8_30 ?? 0) > 0, '15-kunlik due_date 8-30 bucketda');
  });
} catch (e) {
  fail('setup', e);
} finally {
  try {
    close();
  } catch {
    /* ignore */
  }
}

console.log(`\nNatija: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);

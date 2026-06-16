/* eslint-disable no-console */
/**
 * ordersCustomerBalance.smoke.test.cjs
 * Buyurtmalar bo‘limi: mijoz balansi, buyurtmalar tarixi, kirdi/chiqdi (payment_in/out),
 * nasiya sotuv, qoralama tahrir, qaytarishdan keyin balans, ledger mosligi.
 *
 * Ishga tushirish: npm run test:orders-smoke
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const WH = 'main-warehouse-001';
const ADMIN = 'default-admin-001';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-orders-smoke-'));
process.env.POS_SERVER_MODE = '1';
process.env.POS_DATA_DIR = tmpDir;
process.env.POS_VERBOSE_LOGS = '0';

const { open, close, getDb } = require('../db/open.cjs');
const { createServices } = require('./index.cjs');
const { readBalanceInCurrency } = require('../lib/customerBalance.cjs');

function bal(db, customerId) {
  return readBalanceInCurrency(db, customerId, 'UZS');
}

function lastLedger(db, customerId) {
  return db
    .prepare(
      `SELECT type, amount, balance_after FROM customer_ledger
       WHERE customer_id = ? ORDER BY rowid DESC LIMIT 1`,
    )
    .get(customerId);
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

console.log('\n=== BUYURTMALAR / MIJOZ BALANSI SMOKE TEST ===');
console.log(`Temp DB: ${tmpDir}\n`);

try {
  open();
  const db = getDb();
  const { products, inventory, sales, shifts, customers, returns: returnsSvc } = createServices(db);

  const product = products.create({
    name: 'Orders Smoke Product',
    sku: `ORD-SMOKE-${Date.now()}`,
    sale_price: 5000,
    purchase_price: 2000,
    track_stock: 1,
    current_stock: 0,
  });
  inventory.adjustStock({
    warehouse_id: WH,
    adjustment_type: 'set',
    reason: 'Orders smoke stock',
    created_by: ADMIN,
    items: [{ product_id: product.id, target_quantity: 50 }],
  });

  const customer = customers.create({
    name: 'Smoke Mijoz Buyurtmalar',
    phone: '+998901234500',
    allow_credit: 1,
    allow_debt: 1,
    credit_limit: 50000000,
  });
  const customerId = customer.id;
  ok('mijoz + mahsulot yaratildi');

  const shift = shifts.openShift({ user_id: ADMIN });

  // --- Naqd sotuv (balans o‘zgarmasdi) ---
  const cashRes = sales.completePOSOrder(
    { total_amount: 5000, customer_id: customerId, shift_id: shift.id, user_id: ADMIN },
    [cartLine(product, 1, 5000)],
    [{ payment_method: 'cash', amount: 5000 }],
  );
  assert.strictEqual(bal(db, customerId), 0);
  ok('naqd sotuv: balans 0');

  // --- To‘liq nasiya (qarz) ---
  const creditRes = sales.completePOSOrder(
    { total_amount: 15000, customer_id: customerId, shift_id: shift.id, user_id: ADMIN },
    [cartLine(product, 3, 5000)],
    [{ payment_method: 'credit', amount: 15000 }],
  );
  const creditOrderId = creditRes.order_id;
  const creditRow = db.prepare('SELECT credit_amount, payment_status FROM orders WHERE id = ?').get(creditOrderId);
  assert.strictEqual(Number(creditRow.credit_amount), 15000);
  assert.strictEqual(creditRow.payment_status, 'on_credit');
  assert.strictEqual(bal(db, customerId), -15000);
  ok('nasiya sotuv: qarz 15000, balans -15000');

  runStep('ledger: nasiya sale yozuvi', () => {
    const saleLed = db
      .prepare(
        `SELECT type, amount FROM customer_ledger
         WHERE customer_id = ? AND type = 'sale' AND ref_id = ?`,
      )
      .get(customerId, creditOrderId);
    assert.ok(saleLed);
    assert.strictEqual(Number(saleLed.amount), -15000);
  });

  // --- Qisman to‘lov + nasiya ---
  const partialRes = sales.completePOSOrder(
    { total_amount: 10000, customer_id: customerId, shift_id: shift.id, user_id: ADMIN },
    [cartLine(product, 2, 5000)],
    [
      { payment_method: 'cash', amount: 4000 },
      { payment_method: 'credit', amount: 6000 },
    ],
  );
  const partialOrder = db.prepare('SELECT paid_amount, credit_amount FROM orders WHERE id = ?').get(partialRes.order_id);
  assert.ok(Number(partialOrder.paid_amount) >= 3999);
  assert.strictEqual(Number(partialOrder.credit_amount), 6000);
  assert.strictEqual(bal(db, customerId), -21000);
  ok('qisman: 4000 naqd + 6000 nasiya → balans -21000');

  // --- Kirdi (payment_in / oldi) ---
  const payIn = customers.receivePayment({
    customer_id: customerId,
    amount: 10000,
    payment_method: 'cash',
    operation: 'payment_in',
    notes: 'Smoke: mijozdan oldi',
    received_by: ADMIN,
    shift_id: shift.id,
  });
  assert.strictEqual(payIn.new_balance, -11000);
  assert.strictEqual(bal(db, customerId), -11000);
  ok('kirdi (payment_in 10000): balans -11000');

  runStep('ledger: payment_in', () => {
    const row = db
      .prepare(
        `SELECT type, amount FROM customer_ledger WHERE customer_id = ? AND type = 'payment_in' ORDER BY created_at DESC LIMIT 1`,
      )
      .get(customerId);
    assert.strictEqual(Number(row.amount), 10000);
  });

  // --- Chiqdi (payment_out / berdi) ---
  const payOut = customers.receivePayment({
    customer_id: customerId,
    amount: 3000,
    payment_method: 'cash',
    operation: 'payment_out',
    notes: 'Smoke: mijozga berdi',
    received_by: ADMIN,
  });
  assert.strictEqual(payOut.new_balance, -14000);
  assert.strictEqual(bal(db, customerId), -14000);
  ok('chiqdi (payment_out 3000): balans -14000');

  runStep('buyurtmalar tarixi (getByCustomer)', () => {
    const orders = sales.getByCustomer(customerId);
    assert.ok(orders.length >= 3);
    const completed = orders.filter((o) => o.status === 'completed');
    assert.ok(completed.length >= 3);
    assert.ok(orders.every((o) => o.customer_id === customerId));
    assert.ok(orders[0].items && orders[0].payments);
  });

  runStep('mijoz to‘lovlari (getPayments)', () => {
    const pays = customers.getPayments(customerId, { limit: 20 });
    assert.ok(pays.length >= 2);
    const ops = new Set(pays.map((p) => p.operation).filter(Boolean));
    assert.ok(ops.has('payment_in') || pays.some((p) => Number(p.amount) === 10000));
  });

  runStep('ledger: oxirgi qoldiq = mijoz balansi', () => {
    const last = lastLedger(db, customerId);
    assert.strictEqual(Number(last.balance_after), bal(db, customerId));
    assert.strictEqual(bal(db, customerId), -14000);
  });

  runStep('ledger: chiqdi yozuvi (payment_out)', () => {
    const row = db
      .prepare(
        `SELECT amount FROM customer_ledger WHERE customer_id = ? AND type = 'payment_out' ORDER BY created_at DESC LIMIT 1`,
      )
      .get(customerId);
    assert.strictEqual(Number(row.amount), -3000);
  });

  // --- Qoralama buyurtmani tahrir (POS: yakunlashdan oldin miqdor) ---
  const draft = sales.createDraftOrder({
    customer_id: customerId,
    shift_id: shift.id,
    user_id: ADMIN,
    cashier_id: ADMIN,
  });
  const withItem = sales.addItem(draft.id, {
    product_id: product.id,
    quantity: 2,
    qty_sale: 2,
    unit_price: 5000,
  });
  const itemId = withItem.items[0].id;
  const edited = sales.updateItemQuantity(draft.id, itemId, 3);
  assert.strictEqual(Number(edited.total_amount), 15000);
  assert.strictEqual(String(edited.status).toLowerCase(), 'hold');
  assert.strictEqual(bal(db, customerId), -14000);
  ok('qoralama tahrir (hold): 2→3 dona, jami 15000, balans o‘zgarmagan');

  runStep('tahrirdan keyin hold buyurtma DB da', () => {
    const hold = db.prepare(`SELECT status, total_amount FROM orders WHERE id = ?`).get(draft.id);
    assert.strictEqual(hold.status, 'hold');
    assert.strictEqual(Number(hold.total_amount), 15000);
  });

  // --- Yakunlangan buyurtmani “tuzatish” (qaytarish + yangi nasiya) ---
  const customerFix = customers.create({
    name: 'Smoke Tahrir Qaytarish',
    phone: '+998901234501',
    allow_credit: 1,
    allow_debt: 1,
    credit_limit: 50000000,
  });
  const fixId = customerFix.id;
  const wrongSale = sales.completePOSOrder(
    { total_amount: 10000, customer_id: fixId, shift_id: shift.id, user_id: ADMIN },
    [cartLine(product, 2, 5000)],
    [{ payment_method: 'credit', amount: 10000 }],
  );
  assert.strictEqual(bal(db, fixId), -10000);

  const orderItem = db.prepare('SELECT id FROM order_items WHERE order_id = ? LIMIT 1').get(wrongSale.order_id);
  returnsSvc.createReturn({
    order_id: wrongSale.order_id,
    return_reason: 'Smoke: noto\'g\'ri buyurtma tuzatish',
    refund_method: 'customer_account',
    user_id: ADMIN,
    items: [{ order_item_id: orderItem.id, quantity: 2 }],
  });
  assert.strictEqual(bal(db, fixId), 0);
  ok('qaytarish (customer_account): noto\'g\'ri nasiya bekor → balans 0');

  const fixedSale = sales.completePOSOrder(
    { total_amount: 12000, customer_id: fixId, shift_id: shift.id, user_id: ADMIN },
    [cartLine(product, 2, 6000)],
    [{ payment_method: 'credit', amount: 12000 }],
  );
  assert.ok(fixedSale.order_id);
  assert.strictEqual(bal(db, fixId), -12000);

  runStep('tuzatishdan keyin 2 ta buyurtma', () => {
    const orders = sales.getByCustomer(fixId);
    assert.strictEqual(orders.length, 2);
    const creditOrders = orders.filter((o) => Number(o.credit_amount) > 0);
    assert.strictEqual(creditOrders.length, 2);
  });

  runStep('buyurtmaga bog‘langan to‘lov (order_id)', () => {
    const payLinked = customers.receivePayment({
      customer_id: fixId,
      amount: 12000,
      payment_method: 'cash',
      operation: 'payment_in',
      order_id: fixedSale.order_id,
      received_by: ADMIN,
    });
    assert.strictEqual(payLinked.new_balance, 0);
    const cp = db
      .prepare(`SELECT order_id, operation FROM customer_payments WHERE id = ?`)
      .get(payLinked.payment_id);
    assert.strictEqual(cp.order_id, fixedSale.order_id);
    assert.strictEqual(cp.operation, 'payment_in');
  });

  runStep('sales.list mijoz filtri', () => {
    const page = sales.list({ customer_id: customerId, limit: 20 });
    assert.ok(Array.isArray(page));
    assert.ok(page.length >= 4);
    assert.ok(page.every((o) => o.customer_id === customerId));
  });

  // --- Yakunlangan buyurtmani POS tahriri (replaces_order_id: qaytarish + yangi sotuv) ---
  const amendCustomer = customers.create({
    name: 'Smoke Tahrir Amend',
    phone: '+998901234502',
    allow_credit: 1,
    allow_debt: 1,
    credit_limit: 50000000,
  });
  const amendCustId = amendCustomer.id;

  function stockQty(productId) {
    const row = db
      .prepare(
        `SELECT COALESCE(SUM(quantity), 0) AS total FROM inventory_movements WHERE product_id = ?`,
      )
      .get(productId);
    return Number(row?.total || 0);
  }

  const stockBeforeAmend = stockQty(product.id);

  const originalCredit = sales.completePOSOrder(
    { total_amount: 10000, customer_id: amendCustId, shift_id: shift.id, user_id: ADMIN },
    [cartLine(product, 2, 5000)],
    [{ payment_method: 'credit', amount: 10000 }],
  );
  assert.strictEqual(bal(db, amendCustId), -10000);
  assert.strictEqual(stockQty(product.id), stockBeforeAmend - 2);

  const amendedCredit = sales.completePOSOrder(
    {
      total_amount: 15000,
      customer_id: amendCustId,
      shift_id: shift.id,
      user_id: ADMIN,
      replaces_order_id: originalCredit.order_id,
    },
    [cartLine(product, 3, 5000)],
    [{ payment_method: 'credit', amount: 15000 }],
  );
  assert.ok(amendedCredit.order_id);
  assert.strictEqual(
    bal(db, amendCustId),
    -15000,
    'nasiya tahrir: balans ikki marta emas, faqat yangi qarz',
  );
  assert.strictEqual(
    stockQty(product.id),
    stockBeforeAmend - 3,
    'nasiya tahrir: ombor faqat yangi miqdor bilan kamayadi',
  );

  runStep('tahrir: mijoz statistikasi (total_orders / total_sales)', () => {
    const row = db
      .prepare(`SELECT total_orders, total_sales FROM customers WHERE id = ?`)
      .get(amendCustId);
    assert.strictEqual(Number(row.total_orders), 1, 'tahrir: faqat joriy buyurtma hisoblanadi');
    assert.strictEqual(Number(row.total_sales), 15000, 'tahrir: total_sales yangi summa');
  });

  runStep('tahrir: asl buyurtma amended holatida', () => {
    const row = db.prepare(`SELECT status FROM orders WHERE id = ?`).get(originalCredit.order_id);
    assert.strictEqual(String(row.status).toLowerCase(), 'amended');
  });

  const cashAmendCust = customers.create({
    name: 'Smoke Tahrir Naqd',
    phone: '+998901234503',
    allow_credit: 1,
    allow_debt: 1,
  });
  const cashAmendId = cashAmendCust.id;
  const stockBeforeCash = stockQty(product.id);

  const originalCash = sales.completePOSOrder(
    { total_amount: 5000, customer_id: cashAmendId, shift_id: shift.id, user_id: ADMIN },
    [cartLine(product, 1, 5000)],
    [{ payment_method: 'cash', amount: 5000 }],
  );
  assert.strictEqual(bal(db, cashAmendId), 0);
  assert.strictEqual(stockQty(product.id), stockBeforeCash - 1);

  sales.completePOSOrder(
    {
      total_amount: 10000,
      customer_id: cashAmendId,
      shift_id: shift.id,
      user_id: ADMIN,
      replaces_order_id: originalCash.order_id,
    },
    [cartLine(product, 2, 5000)],
    [{ payment_method: 'cash', amount: 10000 }],
  );
  assert.strictEqual(bal(db, cashAmendId), 0, 'naqd tahrir: mijoz balansi o‘zgarmasdi');
  assert.strictEqual(stockQty(product.id), stockBeforeCash - 2, 'naqd tahrir: ombor delta -2');

  // --- Ledger bog‘langan, customer_id noto‘g‘ri buyurtma (mijoz kartada ko‘rinishi) ---
  runStep('ledger orphan: customer_id tuzatiladi va getByCustomer topadi', () => {
    const orphanCust = customers.create({
      name: 'Smoke Ledger Orphan',
      phone: '+998901234504',
      allow_credit: 1,
      allow_debt: 1,
    });
    const orphanId = orphanCust.id;
    const sale = sales.completePOSOrder(
      { total_amount: 8000, customer_id: orphanId, shift_id: shift.id, user_id: ADMIN },
      [cartLine(product, 1, 8000)],
      [{ payment_method: 'credit', amount: 8000 }],
    );
    db.prepare(`UPDATE orders SET customer_id = 'default-customer-001' WHERE id = ?`).run(sale.order_id);
    const listed = sales.getByCustomer(orphanId);
    assert.ok(
      listed.some((o) => o.id === sale.order_id),
      'ledger orphan buyurtma mijoz kartasida ko‘rinadi',
    );
    const fixed = db.prepare(`SELECT customer_id FROM orders WHERE id = ?`).get(sale.order_id);
    assert.strictEqual(String(fixed.customer_id), orphanId, 'customer_id qayta bog‘landi');
  });

  // --- Buyurtmalar ro‘yxatidan "Yangi mijoz" (walk-in) naqd buyurtma tahriri ---
  // Reproduces the reported bug: editing a completed walk-in (default-customer)
  // POS order from the Buyurtmalar list must REVERSE the original sale, not
  // decrement stock a second time (double sale).
  runStep('walk-in (Yangi mijoz) naqd buyurtma tahriri: ombor ikki marta kamaymaydi', () => {
    const stockBeforeWalkin = stockQty(product.id);

    const originalWalkin = sales.completePOSOrder(
      // No customer_id → falls back to default walk-in customer ("Yangi mijoz")
      { total_amount: 10000, shift_id: shift.id, user_id: ADMIN },
      [cartLine(product, 2, 5000)],
      [{ payment_method: 'cash', amount: 10000 }],
    );
    assert.ok(originalWalkin.order_id, 'walk-in buyurtma yaratildi');
    assert.strictEqual(
      stockQty(product.id),
      stockBeforeWalkin - 2,
      'walk-in: dastlabki sotuvdan keyin ombor -2',
    );

    // Edit/amend with the SAME quantity. Without the reversal this would
    // decrement stock again (-4 total); with it, net delta must stay -2.
    const amendedWalkin = sales.completePOSOrder(
      {
        total_amount: 10000,
        shift_id: shift.id,
        user_id: ADMIN,
        replaces_order_id: originalWalkin.order_id,
      },
      [cartLine(product, 2, 5000)],
      [{ payment_method: 'cash', amount: 10000 }],
    );
    assert.ok(amendedWalkin.order_id, 'tahrirlangan walk-in buyurtma yaratildi');
    assert.notStrictEqual(
      amendedWalkin.order_id,
      originalWalkin.order_id,
      'tahrir yangi buyurtma yaratadi',
    );
    assert.strictEqual(
      stockQty(product.id),
      stockBeforeWalkin - 2,
      'walk-in tahrir: ombor ikki marta kamaymaydi (delta -2, -4 emas)',
    );

    const origRow = db
      .prepare(`SELECT status FROM orders WHERE id = ?`)
      .get(originalWalkin.order_id);
    assert.strictEqual(
      String(origRow.status).toLowerCase(),
      'amended',
      'walk-in tahrir: asl buyurtma "amended" holatiga o‘tadi',
    );
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

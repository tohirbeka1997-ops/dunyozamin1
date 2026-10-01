/* eslint-disable no-console */
/**
 * cartSaleReturn.smoke.test.cjs
 * POS savat: oddiy sotish, savat qaytarish (manfiy qator), aralash almashuv,
 * refund_cash / zero_settle to‘lovlari, stok yo‘nalishi.
 *
 * Ishga tushirish: npm run test:cart-smoke
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const WH = 'main-warehouse-001';
const ADMIN = 'default-admin-001';
const REFUND_CASH = 'refund_cash';
const REFUND_BALANCE = 'refund_balance';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-cart-smoke-'));
process.env.POS_SERVER_MODE = '1';
process.env.POS_DATA_DIR = tmpDir;
process.env.POS_VERBOSE_LOGS = '0';

const { open, close, getDb } = require('../db/open.cjs');
const { createServices } = require('./index.cjs');
const { setCurrentUserId } = require('../lib/currentUser.cjs');

function stockOf(inventory, productId) {
  return Number(inventory.getCurrentStock(productId, WH)) || 0;
}

function cartLine(product, { qtySale, unitPrice = 1000, discount = 0 }) {
  const lineTotal = unitPrice * qtySale - discount;
  return {
    product_id: product.id,
    product_name: product.name,
    quantity: qtySale,
    qty_sale: qtySale,
    qty_base: qtySale,
    unit_price: unitPrice,
    line_total: lineTotal,
    discount_amount: discount,
  };
}

function orderTotalFromItems(items) {
  return items.reduce((s, it) => s + Number(it.line_total || 0), 0);
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
  console.log('\n=== CART SALE / RETURN SMOKE TEST ===');
  console.log(`Temp DB: ${tmpDir}\n`);

  open();
  setCurrentUserId(ADMIN);
  const db = getDb();
  const { products, inventory, sales, shifts, customers, returns } = createServices(db);

  const skuA = `CART-A-${Date.now()}`;
  const skuB = `CART-B-${Date.now()}`;
  const productA = products.create({
    name: 'Cart Smoke A',
    sku: skuA,
    sale_price: 1000,
    track_stock: 1,
    current_stock: 0,
  });
  const productB = products.create({
    name: 'Cart Smoke B',
    sku: skuB,
    sale_price: 2000,
    track_stock: 1,
    current_stock: 0,
  });

  inventory.adjustStock({
    warehouse_id: WH,
    adjustment_type: 'set',
    reason: 'Cart smoke initial',
    created_by: ADMIN,
    items: [
      { product_id: productA.id, target_quantity: 10 },
      { product_id: productB.id, target_quantity: 5 },
    ],
  });
  ok('mahsulotlar + boshlang\'ich qoldiq (A=10, B=5)');

  const shift = shifts.openShift({ user_id: ADMIN });

  // --- 1) Oddiy sotish (musbat savat) ---
  const saleItems = [cartLine(productA, { qtySale: 3 })];
  const saleTotal = orderTotalFromItems(saleItems);
  assert.strictEqual(saleTotal, 3000);

  const saleRes = sales.completePOSOrder(
    { total_amount: saleTotal, shift_id: shift.id, user_id: ADMIN },
    saleItems,
    [{ payment_method: 'cash', amount: saleTotal }],
  );
  assert.ok(saleRes?.order_id);
  assert.strictEqual(stockOf(inventory, productA.id), 7);
  const saleOrder = db.prepare('SELECT total_amount, status FROM orders WHERE id = ?').get(saleRes.order_id);
  assert.strictEqual(saleOrder.status, 'completed');
  assert.ok(Number(saleOrder.total_amount) > 0);
  ok('sotish: savat +3 → jami musbat, naqd, qoldiq 7');

  // --- 2) Savat qaytarish (manfiy qator, F8 rejimi ekvivalenti) ---
  const returnItems = [cartLine(productA, { qtySale: -2 })];
  const returnTotal = orderTotalFromItems(returnItems);
  assert.strictEqual(returnTotal, -2000);

  const returnRes = sales.completePOSOrder(
    { total_amount: returnTotal, shift_id: shift.id, user_id: ADMIN },
    returnItems,
    [{ payment_method: REFUND_CASH, amount: 2000 }],
  );
  assert.ok(returnRes?.order_id);
  assert.strictEqual(stockOf(inventory, productA.id), 9);
  const retOrder = db.prepare('SELECT total_amount FROM orders WHERE id = ?').get(returnRes.order_id);
  assert.ok(Number(retOrder.total_amount) < 0);
  const retMove = db
    .prepare(
      `SELECT quantity, movement_type FROM inventory_movements WHERE reference_type = 'order' AND reference_id = ? AND product_id = ?`,
    )
    .get(returnRes.order_id, productA.id);
  assert.ok(retMove);
  assert.ok(Number(retMove.quantity) > 0, 'qaytarish harakati musbat (omborga kirim)');
  ok('savat qaytarish: -2 qator → refund_cash, qoldiq 9, stok oshdi');

  // --- 3) Manfiy jami + naqd (noto‘g‘ri) rad etilishi ---
  let badPay = false;
  try {
    sales.completePOSOrder(
      { total_amount: -1000, shift_id: shift.id, user_id: ADMIN },
      [cartLine(productA, { qtySale: -1 })],
      [{ payment_method: 'cash', amount: 1000 }],
    );
  } catch (e) {
    badPay =
      /refund_cash|Manfiy jami|kirim to‘lovi/i.test(String(e.message || '')) ||
      String(e.code || '').includes('VALIDATION');
  }
  assert.ok(badPay, 'manfiy jami + cash rad etilishi kerak');
  ok('validatsiya: manfiy jami faqat refund_cash bilan');

  // --- 4) Aralash almashuv (sotish + qaytarish bir chekda) ---
  const mixItems = [
    cartLine(productA, { qtySale: 2 }),
    cartLine(productB, { qtySale: -1, unitPrice: 2000 }),
  ];
  const mixTotal = orderTotalFromItems(mixItems); // 2000 - 2000 = 0
  assert.strictEqual(mixTotal, 0);

  const mixRes = sales.completePOSOrder(
    { total_amount: mixTotal, shift_id: shift.id, user_id: ADMIN },
    mixItems,
    [],
  );
  assert.ok(mixRes?.order_id);
  assert.strictEqual(stockOf(inventory, productA.id), 7); // 9 - 2
  assert.strictEqual(stockOf(inventory, productB.id), 6); // 5 + 1
  ok('almashuv: +2 A va -1 B → jami 0, zero_settle, stok A=7 B=6');

  // --- 5) Aralash, mijoz qo‘shimcha to‘laydi (net musbat) ---
  const mixPayItems = [
    cartLine(productA, { qtySale: 1 }),
    cartLine(productB, { qtySale: -1, unitPrice: 2000 }),
  ];
  const mixPayTotal = orderTotalFromItems(mixPayItems); // 1000 - 2000 = -1000
  assert.strictEqual(mixPayTotal, -1000);

  const mixPayRes = sales.completePOSOrder(
    { total_amount: mixPayTotal, shift_id: shift.id, user_id: ADMIN },
    mixPayItems,
    [{ payment_method: REFUND_CASH, amount: 1000 }],
  );
  assert.ok(mixPayRes?.order_id);
  assert.strictEqual(stockOf(inventory, productA.id), 6);
  assert.strictEqual(stockOf(inventory, productB.id), 7);
  ok('almashuv: +1 A, -1 B → mijozga 1000 qaytim, stok yangilandi');

  // --- 6) Aralash, mijoz to‘lov qiladi (net musbat) ---
  const netPosItems = [
    cartLine(productA, { qtySale: 3 }),
    cartLine(productB, { qtySale: -1, unitPrice: 2000 }),
  ];
  const netPosTotal = orderTotalFromItems(netPosItems); // 3000 - 2000 = 1000
  const netRes = sales.completePOSOrder(
    { total_amount: netPosTotal, shift_id: shift.id, user_id: ADMIN },
    netPosItems,
    [{ payment_method: 'cash', amount: netPosTotal }],
  );
  assert.ok(netRes?.order_id);
  assert.strictEqual(stockOf(inventory, productA.id), 3);
  assert.strictEqual(stockOf(inventory, productB.id), 8);
  ok('almashuv: +3 A, -1 B → jami +1000 naqd, stok A=3 B=8');

  // --- 7) Qaytarish qatorida stok tekshiruvi (musbat sotuvda yetarli emas) ---
  inventory.adjustStock({
    warehouse_id: WH,
    adjustment_type: 'set',
    reason: 'low stock',
    created_by: ADMIN,
    items: [{ product_id: productA.id, target_quantity: 1 }],
  });
  let oversellOnSale = false;
  try {
    sales.completePOSOrder(
      { total_amount: 5000, shift_id: shift.id, user_id: ADMIN },
      [cartLine(productA, { qtySale: 5, unitPrice: 1000 })],
      [{ payment_method: 'cash', amount: 5000 }],
    );
  } catch (e) {
    oversellOnSale = /Insufficient|INSUFFICIENT/i.test(String(e.message || e.code || ''));
  }
  assert.ok(oversellOnSale);
  assert.strictEqual(stockOf(inventory, productA.id), 1);
  ok('sotish: qoldiq yetarli emas → rad (qaytarish qatorlari bundan mustasno)');

  // --- 8) Aralash savat + nasiya (net musbat) ---
  inventory.adjustStock({
    warehouse_id: WH,
    adjustment_type: 'set',
    reason: 'mixed credit test stock',
    created_by: ADMIN,
    items: [{ product_id: productA.id, target_quantity: 10 }],
  });
  const creditCustomer = customers.create({
    name: 'Cart Smoke Nasiya',
    phone: '+998901234599',
    allow_credit: 1,
    allow_debt: 1,
    credit_limit: 50000000,
  });
  const mixCreditItems = [
    cartLine(productA, { qtySale: 3 }),
    cartLine(productA, { qtySale: -2 }),
  ];
  const mixCreditTotal = orderTotalFromItems(mixCreditItems); // 3000 - 2000 = 1000
  assert.strictEqual(mixCreditTotal, 1000);

  const mixCreditRes = sales.completePOSOrder(
    {
      total_amount: mixCreditTotal,
      customer_id: creditCustomer.id,
      shift_id: shift.id,
      user_id: ADMIN,
    },
    mixCreditItems,
    [{ payment_method: 'credit', amount: mixCreditTotal }],
  );
  assert.ok(mixCreditRes?.order_id);
  const mixCreditOrder = db
    .prepare('SELECT credit_amount, total_amount FROM orders WHERE id = ?')
    .get(mixCreditRes.order_id);
  assert.strictEqual(Number(mixCreditOrder.total_amount), 1000);
  assert.strictEqual(Number(mixCreditOrder.credit_amount), 1000);
  assert.strictEqual(stockOf(inventory, productA.id), 9); // 10 + 3 - 2 (return) - 2 (sale net +1)
  ok('almashuv + nasiya: +3/-2 A → jami +1000 qarz, stok A=9');

  // --- 9) Aralash savat + nasiya rad (net manfiy) ---
  let mixCreditRejected = false;
  try {
    sales.completePOSOrder(
      {
        total_amount: -1000,
        customer_id: creditCustomer.id,
        shift_id: shift.id,
        user_id: ADMIN,
      },
      [cartLine(productA, { qtySale: 1 }), cartLine(productB, { qtySale: -1, unitPrice: 2000 })],
      [{ payment_method: 'credit', amount: 1000 }],
    );
  } catch (e) {
    mixCreditRejected =
      /Manfiy jami|qarz sotuvi/i.test(String(e.message || '')) ||
      String(e.code || '').includes('VALIDATION');
  }
  assert.ok(mixCreditRejected, 'net manfiy + credit rad etilishi kerak');
  ok('validatsiya: net manfiy almashuvda nasiya rad');

  // --- 10) Manfiy jami + balansga qaytim (mijoz haqdor) ---
  const debtCustomer = customers.create({
    name: 'Cart Smoke Haqdor',
    phone: '+998901234588',
    allow_credit: 1,
    allow_debt: 1,
    credit_limit: 50000000,
  });
  db.prepare(
    `UPDATE customers SET balance = -5000, debt_uzs = 5000, advance_uzs = 0, updated_at = datetime('now') WHERE id = ?`
  ).run(debtCustomer.id);
  const balanceRefundItems = [cartLine(productA, { qtySale: -3 })];
  const balanceRefundTotal = orderTotalFromItems(balanceRefundItems); // -3000
  assert.strictEqual(balanceRefundTotal, -3000);

  const balanceRefundRes = sales.completePOSOrder(
    {
      total_amount: balanceRefundTotal,
      customer_id: debtCustomer.id,
      shift_id: shift.id,
      user_id: ADMIN,
    },
    balanceRefundItems,
    [{ payment_method: REFUND_BALANCE, amount: 3000 }],
  );
  assert.ok(balanceRefundRes?.order_id);
  const balAfter = db.prepare('SELECT balance FROM customers WHERE id = ?').get(debtCustomer.id);
  assert.strictEqual(Number(balAfter.balance), -2000);
  const ledgerRow = db
    .prepare(
      `SELECT type, amount FROM customer_ledger WHERE customer_id = ? AND ref_id = ? ORDER BY created_at DESC LIMIT 1`,
    )
    .get(debtCustomer.id, balanceRefundRes.order_id);
  assert.ok(ledgerRow);
  assert.strictEqual(ledgerRow.type, 'refund');
  assert.strictEqual(Number(ledgerRow.amount), 3000);
  const cashMoveCount = db
    .prepare(
      `SELECT COUNT(*) AS c FROM cash_movements WHERE reference_type = 'order' AND reference_id = ?`,
    )
    .get(balanceRefundRes.order_id);
  assert.strictEqual(Number(cashMoveCount.c), 0, 'balansga qaytimda cash_movement bo‘lmasin');
  ok('almashuv: refund_balance → qarz kamaydi, naqd harakati yo‘q');

  // --- 11) refund_balance mijozsiz rad ---
  let balanceNoCustomer = false;
  try {
    sales.completePOSOrder(
      { total_amount: -1000, shift_id: shift.id, user_id: ADMIN },
      [cartLine(productA, { qtySale: -1 })],
      [{ payment_method: REFUND_BALANCE, amount: 1000 }],
    );
  } catch (e) {
    balanceNoCustomer =
      /mijoz|customer|Balansga/i.test(String(e.message || '')) ||
      String(e.code || '').includes('VALIDATION');
  }
  assert.ok(balanceNoCustomer, 'refund_balance mijozsiz rad etilishi kerak');
  ok('validatsiya: refund_balance uchun mijoz majburiy');

  // --- 12) Katta qaytim → mijoz haqdor (musbat balans) ---
  db.prepare(
    `UPDATE customers SET balance = -5000, debt_uzs = 5000, advance_uzs = 0, updated_at = datetime('now') WHERE id = ?`
  ).run(debtCustomer.id);
  const surplusRefundItems = [cartLine(productA, { qtySale: -10, unitPrice: 1000 })];
  const surplusRefundTotal = -10000;
  sales.completePOSOrder(
    {
      total_amount: surplusRefundTotal,
      customer_id: debtCustomer.id,
      shift_id: shift.id,
      user_id: ADMIN,
    },
    surplusRefundItems,
    [{ payment_method: REFUND_BALANCE, amount: 10000 }],
  );
  const balSurplus = db.prepare('SELECT balance FROM customers WHERE id = ?').get(debtCustomer.id);
  // -5000 + 10000 = +5000 (do‘kon mijoz oldida qarzdor)
  assert.strictEqual(Number(balSurplus.balance), 5000);
  ok('almashuv: refund_balance → ortiqcha qaytim mijoz haqdorligi (musbat balans)');

  // --- 13) Ochiq nasiya buyurtmasi + refund_balance (qarz haqiqatan kamayadi) ---
  const openDebtCustomer = customers.create({
    name: 'Cart Smoke Open Nasiya',
    phone: '+998901234577',
    allow_credit: 1,
    allow_debt: 1,
    credit_limit: 50000000,
  });
  inventory.adjustStock({
    warehouse_id: WH,
    adjustment_type: 'set',
    reason: 'open debt refund stock',
    created_by: ADMIN,
    items: [{ product_id: productA.id, target_quantity: 20 }],
  });
  const priorCreditSale = sales.completePOSOrder(
    {
      total_amount: 10000,
      customer_id: openDebtCustomer.id,
      shift_id: shift.id,
      user_id: ADMIN,
    },
    [cartLine(productA, { qtySale: 10 })],
    [{ payment_method: 'credit', amount: 10000 }],
  );
  assert.ok(priorCreditSale?.order_id);
  const balBeforeOpen = db.prepare('SELECT balance, debt_uzs FROM customers WHERE id = ?').get(openDebtCustomer.id);
  assert.ok(Number(balBeforeOpen.balance) <= -9999.99, 'nasiya sotuvdan keyin qarz');
  const creditBefore = db
    .prepare('SELECT credit_amount FROM orders WHERE id = ?')
    .get(priorCreditSale.order_id);
  assert.strictEqual(Number(creditBefore.credit_amount), 10000);

  const openDebtRefundRes = sales.completePOSOrder(
    {
      total_amount: -4000,
      customer_id: openDebtCustomer.id,
      shift_id: shift.id,
      user_id: ADMIN,
    },
    [cartLine(productA, { qtySale: -4 })],
    [{ payment_method: REFUND_BALANCE, amount: 4000 }],
  );
  assert.ok(openDebtRefundRes?.order_id);
  const balAfterOpen = db.prepare('SELECT balance, debt_uzs FROM customers WHERE id = ?').get(openDebtCustomer.id);
  assert.strictEqual(Number(balAfterOpen.balance), -6000);
  assert.ok(
    Math.abs(Number(balAfterOpen.debt_uzs || 0) - 6000) < 0.02,
    `debt_uzs 6000 bo‘lishi kerak, actual=${balAfterOpen.debt_uzs}`,
  );
  const creditAfter = db
    .prepare('SELECT credit_amount, payment_status FROM orders WHERE id = ?')
    .get(priorCreditSale.order_id);
  assert.strictEqual(Number(creditAfter.credit_amount), 6000);
  ok('ochiq nasiya + refund_balance → buyurtma qarzı va mijoz balansi kamayadi');

  // --- 14) Ochiq nasiya + naqd qarz berildi + katta refund_balance → loan to‘liq yopiladi, ortiqcha qoladi ---
  const mixCustomer = customers.create({
    name: 'Cart Smoke Loan+Nasiya Return',
    phone: '+998901234578',
    allow_credit: 1,
    allow_debt: 1,
    credit_limit: 50000000,
  });
  inventory.adjustStock({
    warehouse_id: WH,
    adjustment_type: 'set',
    reason: 'loan+nasiya refund stock',
    created_by: ADMIN,
    items: [{ product_id: productA.id, target_quantity: 50 }],
  });
  const nasiyaSale = sales.completePOSOrder(
    {
      total_amount: 10000,
      customer_id: mixCustomer.id,
      shift_id: shift.id,
      user_id: ADMIN,
    },
    [cartLine(productA, { qtySale: 10 })],
    [{ payment_method: 'credit', amount: 10000 }],
  );
  assert.ok(nasiyaSale?.order_id);
  const lendRes = customers.receivePayment({
    customer_id: mixCustomer.id,
    amount: 5000,
    payment_method: 'cash',
    operation: 'payment_out',
    payment_out_kind: 'lend',
    notes: 'smoke lend',
    received_by: ADMIN,
    shift_id: shift.id,
  });
  assert.ok(lendRes);
  const mid = db
    .prepare('SELECT balance, debt_uzs, advance_uzs FROM customers WHERE id = ?')
    .get(mixCustomer.id);
  assert.ok(Math.abs(Number(mid.debt_uzs) - 15000) < 0.02, `debt mid=${mid.debt_uzs}`);
  assert.ok(Math.abs(Number(mid.balance) + 15000) < 0.02, `bal mid=${mid.balance}`);

  const bigRefund = sales.completePOSOrder(
    {
      total_amount: -18000,
      customer_id: mixCustomer.id,
      shift_id: shift.id,
      user_id: ADMIN,
    },
    [cartLine(productA, { qtySale: -18 })],
    [{ payment_method: REFUND_BALANCE, amount: 18000 }],
  );
  assert.ok(bigRefund?.order_id);
  const afterMix = db
    .prepare('SELECT balance, debt_uzs, advance_uzs FROM customers WHERE id = ?')
    .get(mixCustomer.id);
  // 15000 qarz − 18000 qaytarish = 3000 ortiqcha (balance +3000, debt 0)
  assert.ok(
    Math.abs(Number(afterMix.debt_uzs || 0)) < 0.02,
    `debt 0 bo‘lishi kerak, actual=${afterMix.debt_uzs}`,
  );
  assert.ok(
    Math.abs(Number(afterMix.advance_uzs || 0) - 3000) < 0.02,
    `advance 3000 bo‘lishi kerak, actual=${afterMix.advance_uzs}`,
  );
  assert.ok(
    Math.abs(Number(afterMix.balance) - 3000) < 0.02,
    `balance +3000 bo‘lishi kerak, actual=${afterMix.balance}`,
  );
  const loanRepaid = db
    .prepare(
      `SELECT COALESCE(SUM(ABS(amount)),0) AS s FROM customer_payments
       WHERE customer_id = ? AND op_type = 'CUSTOMER_LOAN_REPAID'`,
    )
    .get(mixCustomer.id);
  assert.ok(
    Math.abs(Number(loanRepaid.s) - 5000) < 0.02,
    `loan to‘liq qaytarilishi kerak (5000), actual=${loanRepaid.s}`,
  );
  ok('nasiya+loan + refund_balance → loan yopiladi, ortiqcha qoladi (double-count yo‘q)');

  // --- 15) Ghost open-order credit_amount must NOT inflate debt on new nasiya (100k+10k=110k) ---
  const ghostCust = customers.create({
    name: 'Cart Smoke Ghost Open Order',
    phone: '+998901234579',
    allow_credit: 1,
    allow_debt: 1,
    credit_limit: 50000000,
  });
  inventory.adjustStock({
    warehouse_id: WH,
    adjustment_type: 'set',
    reason: 'ghost open order stock',
    created_by: ADMIN,
    items: [{ product_id: productA.id, target_quantity: 200 }],
  });
  const realDebtSale = sales.completePOSOrder(
    {
      total_amount: 100000,
      customer_id: ghostCust.id,
      shift_id: shift.id,
      user_id: ADMIN,
    },
    [cartLine(productA, { qtySale: 100, unitPrice: 1000 })],
    [{ payment_method: 'credit', amount: 100000 }],
  );
  assert.ok(realDebtSale?.order_id);
  // Stale order row: payments reduced balance historically, but credit_amount left high.
  db.prepare(
    `INSERT INTO orders (
      id, order_number, customer_id, cashier_id, user_id, warehouse_id, shift_id,
      subtotal, discount_amount, tax_amount, total_amount, paid_amount, credit_amount,
      status, payment_status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 500000, 0, 0, 500000, 0, 500000, 'completed', 'on_credit', datetime('now'), datetime('now'))`,
  ).run(
    require('crypto').randomUUID(),
    `ORD-GHOST-${Date.now()}`,
    ghostCust.id,
    ADMIN,
    ADMIN,
    WH,
    shift.id,
  );
  db.prepare(
    `UPDATE customers SET balance = -100000, debt_uzs = 100000, advance_uzs = 0, updated_at = datetime('now') WHERE id = ?`,
  ).run(ghostCust.id);
  const beforeGhost = db
    .prepare('SELECT balance, debt_uzs FROM customers WHERE id = ?')
    .get(ghostCust.id);
  assert.strictEqual(Number(beforeGhost.debt_uzs), 100000);

  const addTen = sales.completePOSOrder(
    {
      total_amount: 10000,
      customer_id: ghostCust.id,
      shift_id: shift.id,
      user_id: ADMIN,
    },
    [cartLine(productA, { qtySale: 10, unitPrice: 1000 })],
    [{ payment_method: 'credit', amount: 10000 }],
  );
  assert.ok(addTen?.order_id);
  const afterGhost = db
    .prepare('SELECT balance, debt_uzs, advance_uzs FROM customers WHERE id = ?')
    .get(ghostCust.id);
  assert.ok(
    Math.abs(Number(afterGhost.debt_uzs) - 110000) < 0.02,
    `100k+10k=110k bo‘lishi kerak, actual debt=${afterGhost.debt_uzs} (ghost open-order sync?)`,
  );
  assert.ok(
    Math.abs(Number(afterGhost.balance) + 110000) < 0.02,
    `balance -110000 bo‘lishi kerak, actual=${afterGhost.balance}`,
  );
  ok('ghost open-order credit_amount → yangi nasiya faqat +10k (110k)');

  // --- 16) Klassik returns.createReturn (customer_account): 100k qarz − 40k qaytarish = 60k ---
  inventory.adjustStock({
    warehouse_id: WH,
    adjustment_type: 'set',
    reason: 'classic return stock',
    created_by: ADMIN,
    items: [{ product_id: productA.id, target_quantity: 200 }],
  });
  const classicCust = customers.create({
    name: 'Cart Smoke Classic Return',
    phone: '+998901234580',
    allow_credit: 1,
    allow_debt: 1,
    credit_limit: 50000000,
  });
  const classicSale = sales.completePOSOrder(
    {
      total_amount: 100000,
      customer_id: classicCust.id,
      shift_id: shift.id,
      user_id: ADMIN,
    },
    [cartLine(productA, { qtySale: 100, unitPrice: 1000 })],
    [{ payment_method: 'credit', amount: 100000 }],
  );
  assert.ok(classicSale?.order_id);
  const classicLine = db
    .prepare('SELECT id FROM order_items WHERE order_id = ? LIMIT 1')
    .get(classicSale.order_id);
  assert.ok(classicLine?.id);
  // Ghost open order — settle/returns sync shuni debt ga yozmasligi kerak
  db.prepare(
    `INSERT INTO orders (
      id, order_number, customer_id, cashier_id, user_id, warehouse_id, shift_id,
      subtotal, discount_amount, tax_amount, total_amount, paid_amount, credit_amount,
      status, payment_status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 700000, 0, 0, 700000, 0, 700000, 'completed', 'on_credit', datetime('now'), datetime('now'))`,
  ).run(
    require('crypto').randomUUID(),
    `ORD-GHOST-RET-${Date.now()}`,
    classicCust.id,
    ADMIN,
    ADMIN,
    WH,
    shift.id,
  );
  db.prepare(
    `UPDATE customers SET balance = -100000, debt_uzs = 100000, advance_uzs = 0, updated_at = datetime('now') WHERE id = ?`,
  ).run(classicCust.id);

  const classicRet = returns.createReturn({
    order_id: classicSale.order_id,
    return_reason: 'customer_request',
    refund_method: 'customer_account',
    cashier_id: ADMIN,
    items: [{ order_item_id: classicLine.id, quantity: 40 }],
    idempotency_key: `classic-ret-${classicSale.order_id}`,
  });
  assert.ok(classicRet?.id);
  const afterClassic = db
    .prepare('SELECT balance, debt_uzs, advance_uzs FROM customers WHERE id = ?')
    .get(classicCust.id);
  assert.ok(
    Math.abs(Number(afterClassic.debt_uzs) - 60000) < 0.02,
    `klassik qaytarish 100k-40k=60k, actual debt=${afterClassic.debt_uzs}`,
  );
  assert.ok(
    Math.abs(Number(afterClassic.balance) + 60000) < 0.02,
    `balance -60k, actual=${afterClassic.balance}`,
  );
  assert.ok(
    Number(afterClassic.debt_uzs) < 200000,
    `ghost 700k debt ga yozilmasin, actual=${afterClassic.debt_uzs}`,
  );
  ok('klassik returns.createReturn + ghost → 100k−40k=60k (inflatsiya yo‘q)');

  // --- 17) Klassik qaytarish: nasiya+loan, ortiqcha → loan yopiladi, ortiqcha qoladi ---
  inventory.adjustStock({
    warehouse_id: WH,
    adjustment_type: 'set',
    reason: 'classic loan return stock',
    created_by: ADMIN,
    items: [{ product_id: productA.id, target_quantity: 50 }],
  });
  const loanRetCust = customers.create({
    name: 'Cart Smoke Classic Loan Return',
    phone: '+998901234581',
    allow_credit: 1,
    allow_debt: 1,
    credit_limit: 50000000,
  });
  const loanNasiya = sales.completePOSOrder(
    {
      total_amount: 10000,
      customer_id: loanRetCust.id,
      shift_id: shift.id,
      user_id: ADMIN,
    },
    [cartLine(productA, { qtySale: 10, unitPrice: 1000 })],
    [{ payment_method: 'credit', amount: 10000 }],
  );
  assert.ok(loanNasiya?.order_id);
  customers.receivePayment({
    customer_id: loanRetCust.id,
    amount: 5000,
    payment_method: 'cash',
    operation: 'payment_out',
    payment_out_kind: 'lend',
    notes: 'smoke lend classic return',
    received_by: ADMIN,
    shift_id: shift.id,
  });
  const loanLine = db
    .prepare('SELECT id FROM order_items WHERE order_id = ? LIMIT 1')
    .get(loanNasiya.order_id);
  const loanRet = returns.createReturn({
    order_id: loanNasiya.order_id,
    return_reason: 'customer_request',
    refund_method: 'customer_account',
    cashier_id: ADMIN,
    items: [{ order_item_id: loanLine.id, quantity: 10 }],
    idempotency_key: `classic-loan-ret-${loanNasiya.order_id}`,
  });
  assert.ok(loanRet?.id);
  // Full return 10k on 10k nasiya + 5k loan: allocate 10k to order → debt left 5k loan,
  // remainder 0; settle does nothing with advance. Wait - full return amount is 10k,
  // debt was 15k. After allocate 10k to order, debt=5k, advance=0. Loan remains 5k.
  // User expectation for FULL return of merchandise: only the sale is returned (10k),
  // loan stays. That's correct for createReturn of the order.
  const afterLoanRet = db
    .prepare('SELECT balance, debt_uzs, advance_uzs FROM customers WHERE id = ?')
    .get(loanRetCust.id);
  assert.ok(
    Math.abs(Number(afterLoanRet.debt_uzs) - 5000) < 0.02,
    `to‘liq buyurtma qaytarishdan keyin loan 5k qolishi kerak, debt=${afterLoanRet.debt_uzs}`,
  );
  ok('klassik returns: to‘liq nasiya qaytarish → loan alohida qoladi (5k)');

  // --- 18) applyAdvanceToOrder + ghost open-order → debt shishmasin ---
  inventory.adjustStock({
    warehouse_id: WH,
    adjustment_type: 'set',
    reason: 'advance apply stock',
    created_by: ADMIN,
    items: [{ product_id: productA.id, target_quantity: 100 }],
  });
  const advCust = customers.create({
    name: 'Cart Smoke Advance Apply',
    phone: '+998901234582',
    allow_credit: 1,
    allow_debt: 1,
    credit_limit: 50000000,
  });
  const advSale2 = sales.completePOSOrder(
    {
      total_amount: 20000,
      customer_id: advCust.id,
      shift_id: shift.id,
      user_id: ADMIN,
    },
    [cartLine(productA, { qtySale: 20, unitPrice: 1000 })],
    [{ payment_method: 'credit', amount: 20000 }],
  );
  assert.ok(advSale2?.order_id);
  db.prepare(
    `INSERT INTO orders (
      id, order_number, customer_id, cashier_id, user_id, warehouse_id, shift_id,
      subtotal, discount_amount, tax_amount, total_amount, paid_amount, credit_amount,
      status, payment_status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 400000, 0, 0, 400000, 0, 400000, 'completed', 'on_credit', datetime('now'), datetime('now'))`,
  ).run(
    require('crypto').randomUUID(),
    `ORD-GHOST-ADV-${Date.now()}`,
    advCust.id,
    ADMIN,
    ADMIN,
    WH,
    shift.id,
  );
  // debt 20k (real) + advance 30k planted; ghost 400k open_order
  db.prepare(
    `UPDATE customers SET balance = 10000, debt_uzs = 20000, advance_uzs = 30000, updated_at = datetime('now') WHERE id = ?`,
  ).run(advCust.id);
  customers.applyAdvanceToOrder({
    customerId: advCust.id,
    orderId: advSale2.order_id,
    amount: 20000,
    receivedBy: ADMIN,
  });
  const afterAdv = db
    .prepare('SELECT debt_uzs, advance_uzs, balance FROM customers WHERE id = ?')
    .get(advCust.id);
  assert.ok(
    Math.abs(Number(afterAdv.debt_uzs || 0)) < 0.02,
    `avans qo‘llashdan keyin debt 0, actual=${afterAdv.debt_uzs} (ghost inflatsiya?)`,
  );
  assert.ok(
    Math.abs(Number(afterAdv.advance_uzs || 0) - 10000) < 0.02,
    `advance 10k qolishi kerak, actual=${afterAdv.advance_uzs}`,
  );
  ok('applyAdvanceToOrder + ghost → debt 0 / advance 10k (shishmaydi)');

  // --- 19) Lend + ghost → floor open_order dan oshirmasin ---
  const lendCust = customers.create({
    name: 'Cart Smoke Lend Ghost',
    phone: '+998901234583',
    allow_credit: 1,
    allow_debt: 1,
    credit_limit: 50000000,
  });
  db.prepare(
    `INSERT INTO orders (
      id, order_number, customer_id, cashier_id, user_id, warehouse_id, shift_id,
      subtotal, discount_amount, tax_amount, total_amount, paid_amount, credit_amount,
      status, payment_status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 900000, 0, 0, 900000, 0, 900000, 'completed', 'on_credit', datetime('now'), datetime('now'))`,
  ).run(
    require('crypto').randomUUID(),
    `ORD-GHOST-LEND-${Date.now()}`,
    lendCust.id,
    ADMIN,
    ADMIN,
    WH,
    shift.id,
  );
  db.prepare(
    `UPDATE customers SET balance = 0, debt_uzs = 0, advance_uzs = 0, updated_at = datetime('now') WHERE id = ?`,
  ).run(lendCust.id);
  customers.receivePayment({
    customer_id: lendCust.id,
    amount: 7000,
    payment_method: 'cash',
    operation: 'payment_out',
    payment_out_kind: 'lend',
    notes: 'lend ghost smoke',
    received_by: ADMIN,
    shift_id: shift.id,
  });
  const afterLend = db
    .prepare('SELECT debt_uzs, balance FROM customers WHERE id = ?')
    .get(lendCust.id);
  assert.ok(
    Math.abs(Number(afterLend.debt_uzs) - 7000) < 0.02,
    `lend faqat +7k, actual debt=${afterLend.debt_uzs}`,
  );
  ok('lend + ghost open-order → debt faqat +7k');

  // --- 20) cancelReturn: klassik account refund → debt/credit tiklanadi ---
  inventory.adjustStock({
    warehouse_id: WH,
    adjustment_type: 'set',
    reason: 'cancel return stock',
    created_by: ADMIN,
    items: [{ product_id: productA.id, target_quantity: 120 }],
  });
  const cancelCust = customers.create({
    name: 'Cart Smoke Cancel Return',
    phone: '+998901234584',
    allow_credit: 1,
    allow_debt: 1,
    credit_limit: 50000000,
  });
  const cancelSale = sales.completePOSOrder(
    {
      total_amount: 40000,
      customer_id: cancelCust.id,
      shift_id: shift.id,
      user_id: ADMIN,
    },
    [cartLine(productA, { qtySale: 40, unitPrice: 1000 })],
    [{ payment_method: 'credit', amount: 40000 }],
  );
  const cancelLine = db
    .prepare('SELECT id FROM order_items WHERE order_id = ? LIMIT 1')
    .get(cancelSale.order_id);
  const cancelRet = returns.createReturn({
    order_id: cancelSale.order_id,
    return_reason: 'mistake',
    refund_method: 'customer_account',
    cashier_id: ADMIN,
    items: [{ order_item_id: cancelLine.id, quantity: 15 }],
    idempotency_key: `cancel-ret-${cancelSale.order_id}`,
  });
  const midCancel = db
    .prepare('SELECT debt_uzs, balance FROM customers WHERE id = ?')
    .get(cancelCust.id);
  assert.ok(
    Math.abs(Number(midCancel.debt_uzs) - 25000) < 0.02,
    `return keyin 25k, actual=${midCancel.debt_uzs}`,
  );
  const ordMid = db
    .prepare('SELECT credit_amount FROM orders WHERE id = ?')
    .get(cancelSale.order_id);
  assert.ok(
    Math.abs(Number(ordMid.credit_amount) - 25000) < 0.02,
    `order credit 25k, actual=${ordMid.credit_amount}`,
  );
  returns.cancelReturn(cancelRet.id, {
    user_id: ADMIN,
    cancel_reason: 'Entered by mistake — smoke',
  });
  const afterCancel = db
    .prepare('SELECT debt_uzs, advance_uzs, balance FROM customers WHERE id = ?')
    .get(cancelCust.id);
  const ordAfter = db
    .prepare('SELECT credit_amount FROM orders WHERE id = ?')
    .get(cancelSale.order_id);
  assert.ok(
    Math.abs(Number(afterCancel.debt_uzs) - 40000) < 0.02,
    `cancel keyin debt 40k, actual=${afterCancel.debt_uzs}`,
  );
  assert.ok(
    Math.abs(Number(ordAfter.credit_amount) - 40000) < 0.02,
    `cancel keyin order credit 40k, actual=${ordAfter.credit_amount}`,
  );
  ok('cancelReturn → debt va order credit tiklanadi (40k)');

  // --- 21) To‘liq nasiya + naqd qaytarish → faqat AR, kassa yo‘q (ikkala foyda yo‘q) ---
  inventory.adjustStock({
    warehouse_id: WH,
    adjustment_type: 'set',
    reason: 'cash nasiya return stock',
    created_by: ADMIN,
    items: [{ product_id: productA.id, target_quantity: 100 }],
  });
  const cashNasiyaCust = customers.create({
    name: 'Cart Smoke Cash Nasiya Return',
    phone: '+998901234585',
    allow_credit: 1,
    allow_debt: 1,
    credit_limit: 50000000,
  });
  const cashNasiyaSale = sales.completePOSOrder(
    {
      total_amount: 30000,
      customer_id: cashNasiyaCust.id,
      shift_id: shift.id,
      user_id: ADMIN,
    },
    [cartLine(productA, { qtySale: 30, unitPrice: 1000 })],
    [{ payment_method: 'credit', amount: 30000 }],
  );
  const cashNasiyaLine = db
    .prepare('SELECT id FROM order_items WHERE order_id = ? LIMIT 1')
    .get(cashNasiyaSale.order_id);
  const cashNasiyaRet = returns.createReturn({
    order_id: cashNasiyaSale.order_id,
    return_reason: 'customer_request',
    refund_method: 'cash',
    cashier_id: ADMIN,
    method_mismatch_reason: 'smoke: nasiya order cash refund split',
    items: [{ order_item_id: cashNasiyaLine.id, quantity: 30 }],
    idempotency_key: `cash-nasiya-${cashNasiyaSale.order_id}`,
    shift_id: shift.id,
  });
  assert.ok(cashNasiyaRet?.id);
  const afterCashNasiya = db
    .prepare('SELECT debt_uzs, advance_uzs, balance FROM customers WHERE id = ?')
    .get(cashNasiyaCust.id);
  assert.ok(
    Math.abs(Number(afterCashNasiya.debt_uzs || 0)) < 0.02,
    `nasiya qaytarishdan keyin debt 0, actual=${afterCashNasiya.debt_uzs}`,
  );
  const cashMovNasiya = db
    .prepare(
      `SELECT COALESCE(SUM(ABS(amount)), 0) AS s FROM cash_movements WHERE reference_type='return' AND reference_id=?`,
    )
    .get(cashNasiyaRet.id);
  assert.ok(
    Math.abs(Number(cashMovNasiya?.s || 0)) < 0.02,
    `to‘liq nasiyada naqd chiqmasligi kerak, cash_mov=${cashMovNasiya?.s}`,
  );
  ok('to‘liq nasiya + naqd usul → faqat AR yopiladi, kassa 0');

  // --- 22) Qisman to‘lov: 40k naqd + 60k nasiya, to‘liq qaytarish naqd → AR 60k, kassa 40k ---
  // Oldingi smoke qaytarishlari kassani quritgan bo‘lishi mumkin — drawer ni to‘ldiramiz.
  try {
    db.prepare(
      `UPDATE shifts SET opening_cash = COALESCE(opening_cash, 0) + 100000 WHERE id = ?`,
    ).run(shift.id);
  } catch {
    /* ignore if column missing */
  }
  inventory.adjustStock({
    warehouse_id: WH,
    adjustment_type: 'set',
    reason: 'partial pay return stock',
    created_by: ADMIN,
    items: [{ product_id: productA.id, target_quantity: 150 }],
  });
  const partialCust = customers.create({
    name: 'Cart Smoke Partial Cash Return',
    phone: '+998901234586',
    allow_credit: 1,
    allow_debt: 1,
    credit_limit: 50000000,
  });
  const partialSale = sales.completePOSOrder(
    {
      total_amount: 100000,
      customer_id: partialCust.id,
      shift_id: shift.id,
      user_id: ADMIN,
    },
    [cartLine(productA, { qtySale: 100, unitPrice: 1000 })],
    [
      { payment_method: 'cash', amount: 40000 },
      { payment_method: 'credit', amount: 60000 },
    ],
  );
  const partialLine = db
    .prepare('SELECT id FROM order_items WHERE order_id = ? LIMIT 1')
    .get(partialSale.order_id);
  const beforePartialDebt = db
    .prepare('SELECT debt_uzs FROM customers WHERE id = ?')
    .get(partialCust.id);
  assert.ok(Math.abs(Number(beforePartialDebt.debt_uzs) - 60000) < 0.02);
  const partialRet = returns.createReturn({
    order_id: partialSale.order_id,
    return_reason: 'customer_request',
    refund_method: 'cash',
    cashier_id: ADMIN,
    method_mismatch_reason: 'smoke: partial credit cash split',
    items: [{ order_item_id: partialLine.id, quantity: 100 }],
    idempotency_key: `partial-cash-${partialSale.order_id}`,
    shift_id: shift.id,
  });
  const afterPartial = db
    .prepare('SELECT debt_uzs, advance_uzs FROM customers WHERE id = ?')
    .get(partialCust.id);
  assert.ok(
    Math.abs(Number(afterPartial.debt_uzs || 0)) < 0.02,
    `qarz yopilishi kerak, debt=${afterPartial.debt_uzs}`,
  );
  const cashMovPartial = db
    .prepare(
      `SELECT COALESCE(SUM(ABS(amount)), 0) AS s FROM cash_movements WHERE reference_type='return' AND reference_id=?`,
    )
    .get(partialRet.id);
  assert.ok(
    Math.abs(Number(cashMovPartial?.s || 0) - 40000) < 0.02,
    `kassa faqat to‘langan 40k, actual=${cashMovPartial?.s}`,
  );
  ok('qisman to‘lov + naqd qaytarish → AR 60k / kassa 40k');

  // --- Overpay on cash sale must reduce debt_uzs (not only order credit_amount) ---
  inventory.adjustStock({
    warehouse_id: WH,
    adjustment_type: 'set',
    reason: 'overpay debt bucket stock',
    created_by: ADMIN,
    items: [{ product_id: productA.id, target_quantity: 200 }],
  });
  const overpayCust = customers.create({
    name: 'Cart Smoke Overpay Debt',
    phone: '+998901234590',
    allow_credit: 1,
    allow_debt: 1,
    credit_limit: 50000000,
  });
  const priorNasiya = sales.completePOSOrder(
    {
      total_amount: 190000,
      customer_id: overpayCust.id,
      shift_id: shift.id,
      user_id: ADMIN,
    },
    [cartLine(productA, { qtySale: 190, unitPrice: 1000 })],
    [{ payment_method: 'credit', amount: 190000 }],
  );
  assert.ok(priorNasiya?.order_id);
  const beforeOverpay = db
    .prepare('SELECT debt_uzs, advance_uzs, balance FROM customers WHERE id = ?')
    .get(overpayCust.id);
  assert.ok(Math.abs(Number(beforeOverpay.debt_uzs) - 190000) < 0.02);

  const overpaySale = sales.completePOSOrder(
    {
      total_amount: 10000,
      customer_id: overpayCust.id,
      shift_id: shift.id,
      user_id: ADMIN,
      discount_amount: 5000,
    },
    [cartLine(productA, { qtySale: 1, unitPrice: 15000, discount: 5000 })],
    [{ payment_method: 'cash', amount: 20000 }],
  );
  assert.ok(overpaySale?.order_id);
  const afterOverpay = db
    .prepare('SELECT debt_uzs, advance_uzs, balance FROM customers WHERE id = ?')
    .get(overpayCust.id);
  assert.ok(
    Math.abs(Number(afterOverpay.debt_uzs) - 180000) < 0.02,
    `ortiqcha 10k qarzni kamaytirishi kerak (190→180), actual debt=${afterOverpay.debt_uzs}`,
  );
  assert.ok(
    Math.abs(Number(afterOverpay.advance_uzs || 0)) < 0.02,
    `avans 0, actual=${afterOverpay.advance_uzs}`,
  );
  assert.ok(
    Math.abs(Number(afterOverpay.balance) + 180000) < 0.02,
    `balance -180000, actual=${afterOverpay.balance}`,
  );
  const priorOpen = db
    .prepare('SELECT credit_amount, paid_amount FROM orders WHERE id = ?')
    .get(priorNasiya.order_id);
  assert.ok(
    Math.abs(Number(priorOpen.credit_amount) - 180000) < 0.02,
    `ochiq nasiya 180k, actual credit=${priorOpen.credit_amount}`,
  );
  ok('naqd ortiqcha to‘lov → debt_uzs 190k→180k (ghost yo‘q)');

  console.log(`\n=== NATIJA: ${passed} OK, ${failed} FAIL ===\n`);
  process.exit(failed > 0 ? 1 : 0);
} catch (e) {
  fail('cart sale/return suite', e);
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

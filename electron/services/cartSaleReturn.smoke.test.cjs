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
  const db = getDb();
  const { products, inventory, sales, shifts, customers } = createServices(db);

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
      `SELECT quantity, move_type FROM stock_moves WHERE reference_type = 'order' AND reference_id = ? AND product_id = ?`,
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
  db.prepare(`UPDATE customers SET balance = -5000, updated_at = datetime('now') WHERE id = ?`).run(
    debtCustomer.id
  );
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
  db.prepare(`UPDATE customers SET balance = -5000, updated_at = datetime('now') WHERE id = ?`).run(
    debtCustomer.id
  );
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

  console.log(`\n=== NATIJA: ${passed} OK, ${failed} FAIL ===\n`);
  if (failed > 0) process.exit(1);
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

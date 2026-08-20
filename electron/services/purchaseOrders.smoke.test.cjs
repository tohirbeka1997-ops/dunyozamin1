/* eslint-disable no-console */
/**
 * purchaseOrders.smoke.test.cjs
 * Xarid buyurtmalari: yaratish, tahrir, qisman/to‘liq qabul, to‘lov, xarajat;
 * hisobotlar (delivery, aging, purchase vs sold, latest costs) mosligi.
 *
 * Ishga tushirish: npm run test:purchase-smoke
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const WH = 'main-warehouse-001';
const ADMIN = 'default-admin-001';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-purchase-smoke-'));
process.env.POS_SERVER_MODE = '1';
process.env.POS_DATA_DIR = tmpDir;
process.env.POS_VERBOSE_LOGS = '0';

const { open, close, getDb } = require('../db/open.cjs');
const { createServices } = require('./index.cjs');
const { formatYmdInTimeZone } = require('../lib/timezone.cjs');

function stockOf(inventory, productId) {
  return Number(inventory.getCurrentStock(productId, WH)) || 0;
}

/** UI `aggregatePurchaseOrders` UZS qoidasi (currency.ts) */
function aggregatePoUzs(orders) {
  const active = (orders || []).filter((po) => String(po.status || '').toLowerCase() !== 'cancelled');
  let orderedUzs = 0;
  let paidUzs = 0;
  let receivedUzs = 0;
  for (const po of active) {
    const cur = String(po.currency || 'UZS').toUpperCase();
    if (cur === 'USD') continue;
    orderedUzs += Number(po.total_amount || 0);
    paidUzs += Number(po.paid_amount ?? po.paid_amount_uzs ?? po.computed_paid_amount ?? 0);
    for (const it of po.items || []) {
      receivedUzs += (Number(it.received_qty) || 0) * (Number(it.unit_cost) || 0);
    }
  }
  return {
    count: active.length,
    orderedUzs,
    paidUzs,
    receivedUzs,
    debtUzs: Math.max(0, receivedUzs - paidUzs),
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

console.log('\n=== XARID BUYURTMALARI SMOKE TEST ===');
console.log(`Temp DB: ${tmpDir}\n`);

try {
  open();
  const db = getDb();
  const { products, inventory, purchases, suppliers, reports, exchangeRates } = createServices(db);

  const supplier = suppliers.create({
    name: 'Smoke Xarid Ta\'minotchi',
    phone: '+998901555000',
    contact_person: 'Test',
  });
  const supplierId = supplier.id;

  const product = products.create({
    name: 'Purchase Smoke Product',
    sku: `PO-SMOKE-${Date.now()}`,
    sale_price: 8000,
    purchase_price: 4000,
    track_stock: 1,
    current_stock: 0,
  });
  const productId = product.id;
  ok('ta\'minotchi + mahsulot');

  const today = formatYmdInTimeZone(new Date());
  const filters = { date_from: today, date_to: today };

  const po1 = purchases.createOrder({
    supplier_id: supplierId,
    supplier_name: supplier.name,
    order_date: today,
    status: 'approved',
    created_by: ADMIN,
    items: [
      {
        product_id: productId,
        product_name: product.name,
        ordered_qty: 10,
        unit_cost: 5000,
        line_total: 50000,
      },
    ],
    initial_payment: {
      amount: 20000,
      payment_method: 'cash',
      currency: 'UZS',
    },
  });
  const po1Id = po1.id;
  const item1Id = po1.items[0].id;
  assert.strictEqual(Number(po1.total_amount), 50000);
  assert.strictEqual(po1.payment_status, 'PARTIALLY_PAID');
  assert.strictEqual(Number(po1.paid_amount), 20000);
  ok(`PO yaratish + avans to‘lov (jami 50000, to‘langan 20000)`);

  const partial = purchases.receiveGoods(po1Id, {
    items: [{ item_id: item1Id, product_id: productId, received_qty: 6 }],
    received_by: ADMIN,
  });
  assert.strictEqual(partial.status, 'partially_received');
  assert.strictEqual(Number(partial.items[0].received_qty), 6);
  assert.strictEqual(stockOf(inventory, productId), 6);
  ok('qisman qabul: 6 dona, status partially_received');

  const full = purchases.receiveGoods(po1Id, {
    items: [{ item_id: item1Id, product_id: productId, received_qty: 4 }],
    received_by: ADMIN,
  });
  assert.strictEqual(full.status, 'received');
  assert.strictEqual(Number(full.items[0].received_qty), 10);
  assert.strictEqual(stockOf(inventory, productId), 10);
  ok('to‘liq qabul: +4 dona, status received, ombor 10');

  const po2 = purchases.createOrder({
    supplier_id: supplierId,
    order_date: today,
    status: 'approved',
    created_by: ADMIN,
    items: [
      {
        product_id: productId,
        ordered_qty: 5,
        unit_cost: 6000,
        line_total: 30000,
      },
    ],
  });
  const po2Id = po2.id;
  let po2ItemId = po2.items[0].id;

  const edited = purchases.updateOrder(
    po2Id,
    { notes: 'Smoke tahrir: miqdor oshirildi' },
    [
      {
        product_id: productId,
        ordered_qty: 6,
        unit_cost: 6000,
        line_total: 36000,
      },
    ],
  );
  assert.strictEqual(Number(edited.total_amount), 36000);
  po2ItemId = edited.items[0].id;
  ok('tahrir: 5→6 dona, jami 36000');

  runStep('tahrir: mavjud qator narxini yangilash (id bo‘yicha)', () => {
    const priceEdit = purchases.updateOrder(
      po2Id,
      { notes: 'Smoke: narx yangilandi' },
      [
        {
          id: po2ItemId,
          product_id: productId,
          ordered_qty: 6,
          unit_cost: 7500,
          line_total: 45000,
        },
      ],
    );
    assert.strictEqual(Number(priceEdit.items[0].unit_cost), 7500);
    assert.strictEqual(Number(priceEdit.total_amount), 45000);
    assert.strictEqual(priceEdit.items[0].id, po2ItemId);
  });

  runStep('xarajat (landed cost) qo‘shish', () => {
    purchases.addExpense(po2Id, {
      title: 'Yetkazish',
      amount: 600,
      allocation_method: 'by_qty',
      created_by: ADMIN,
    });
    const ex = purchases.get(po2Id);
    assert.ok(ex.expenses && ex.expenses.length >= 1);
  });

  purchases.receiveGoods(po2Id, {
    items: [{ item_id: po2ItemId, product_id: productId, received_qty: 6 }],
    received_by: ADMIN,
  });
  const prodAfter = db.prepare('SELECT purchase_price FROM products WHERE id = ?').get(productId);
  assert.ok(Number(prodAfter.purchase_price) >= 6100 - 0.01);
  ok('qabul + xarajat: purchase_price yangilandi (≥6100)');

  runStep('to‘lov: qolgan qarz yopish', () => {
    suppliers.createPayment({
      supplier_id: supplierId,
      purchase_order_id: po1Id,
      amount: 30000,
      payment_method: 'transfer',
      currency: 'UZS',
      created_by: ADMIN,
    });
    const po1Paid = purchases.get(po1Id);
    assert.strictEqual(po1Paid.payment_status, 'PAID');
    assert.strictEqual(Number(po1Paid.paid_amount), 50000);
  });

  runStep('list + hisobot agregati (PurchaseOrderSummary UI)', () => {
    const list = purchases.list({
      supplier_id: supplierId,
      date_from: today,
      date_to: today,
      include_items: true,
    });
    assert.ok(list.length >= 2);
    const agg = aggregatePoUzs(list);
    assert.strictEqual(agg.count, 2);
    assert.strictEqual(agg.orderedUzs, 95000);
    assert.strictEqual(agg.paidUzs, 50000);
    assert.ok(agg.receivedUzs >= 95000, 'qabul qiymati landed cost bilan');
    assert.strictEqual(agg.debtUzs, agg.receivedUzs - agg.paidUzs);
    assert.strictEqual(agg.debtUzs, 45600);
  });

  runStep('hisobot: getDeliveryDetails', () => {
    const rows = reports.getDeliveryDetails(filters);
    const hit = rows.filter((r) => r.order_id === po1Id || r.order_id === po2Id);
    assert.ok(hit.length >= 2);
    const po1Row = hit.find((r) => r.order_id === po1Id);
    assert.strictEqual(Number(po1Row.received_items), 10);
    assert.strictEqual(Number(po1Row.ordered_items), 10);
  });

  runStep('hisobot: getSupplierAging (qarz)', () => {
    const legacyDebt = Number(
      db
        .prepare(
          `
        SELECT COALESCE(SUM(
          po.total_amount - COALESCE((SELECT SUM(amount) FROM supplier_payments WHERE purchase_order_id = po.id), 0)
        ), 0) AS d
        FROM purchase_orders po
        WHERE po.supplier_id = ?
          AND po.status IN ('received', 'partially_received')
      `,
        )
        .get(supplierId).d || 0,
    );
    assert.strictEqual(legacyDebt, 45000);

    const aging = reports.getSupplierAging();
    const row = aging.find((r) => r.id === supplierId);
    if (row) {
      assert.ok(Math.abs(Number(row.total_debt) - legacyDebt) < 1 || Number(row.total_debt) >= 45000);
    }
  });

  runStep('hisobot: getLatestPurchaseCosts', () => {
    const costs = reports.getLatestPurchaseCosts();
    assert.ok(costs && typeof costs === 'object');
    const cost = costs[productId] ?? costs[String(productId)];
    assert.ok(Number(cost) > 0);
  });

  runStep('hisobot: getPurchaseVsSold', () => {
    const r = reports.getPurchaseVsSold({ ...filters, warehouse_id: WH });
    assert.ok(r && typeof r === 'object');
    assert.ok(Array.isArray(r.rows) || Array.isArray(r.products) || Object.keys(r).length > 0);
  });

  runStep('hisobot: getSupplierProductSales', () => {
    const rows = reports.getSupplierProductSales({ ...filters, supplier_id: supplierId });
    assert.ok(Array.isArray(rows));
    const hit = rows.find((x) => String(x.product_id || x.id) === String(productId));
    assert.ok(hit || rows.length === 0, 'sotuv bo‘lmasa bo‘sh bo‘lishi mumkin');
  });

  runStep('qabul ortiqcha miqdor rad etiladi', () => {
    let threw = false;
    try {
      purchases.receiveGoods(po1Id, {
        items: [{ item_id: item1Id, product_id: productId, received_qty: 1 }],
      });
    } catch (e) {
      threw = /oshib|remaining|qolgan/i.test(String(e.message || e));
    }
    assert.ok(threw);
  });

  runStep('USD ta\'minotchi: PO, qabul, qarz va to\'lov', () => {
    const fxRate = 12800;
    exchangeRates.upsert({
      base_currency: 'USD',
      quote_currency: 'UZS',
      rate: fxRate,
      effective_date: today,
      source: 'smoke',
      created_by: ADMIN,
    });

    const usdSupplier = suppliers.create({
      name: 'USD Smoke Ta\'minotchi',
      phone: '+998901555001',
      settlement_currency: 'USD',
    });

    let rejectedUzsPo = false;
    try {
      purchases.createOrder({
        supplier_id: usdSupplier.id,
        order_date: today,
        status: 'approved',
        created_by: ADMIN,
        currency: 'UZS',
        items: [
          {
            product_id: productId,
            ordered_qty: 5,
            unit_cost: 5000,
            line_total: 25000,
          },
        ],
      });
    } catch (e) {
      rejectedUzsPo = /USD supplier requires purchase order in USD/i.test(String(e.message || e));
    }
    assert.ok(rejectedUzsPo, 'UZS PO on USD supplier must be rejected');

    const usdPo = purchases.createOrder({
      supplier_id: usdSupplier.id,
      order_date: today,
      status: 'approved',
      created_by: ADMIN,
      currency: 'USD',
      fx_rate: fxRate,
      items: [
        {
          product_id: productId,
          ordered_qty: 10,
          unit_cost_usd: 100,
          line_total_usd: 1000,
        },
      ],
    });
    assert.strictEqual(String(usdPo.currency).toUpperCase(), 'USD');
    assert.strictEqual(Number(usdPo.total_usd), 1000);
    assert.ok(Number(usdPo.total_amount) > 0);

    const usdItemId = usdPo.items[0].id;
    purchases.receiveGoods(usdPo.id, {
      items: [{ item_id: usdItemId, product_id: productId, received_qty: 10 }],
      received_by: ADMIN,
    });

    const supAfterReceive = suppliers.get(usdSupplier.id);
    assert.ok(
      Math.abs(Number(supAfterReceive.balance) - 1000) < 0.01,
      `USD balance after receive expected 1000, got ${supAfterReceive.balance}`
    );

    suppliers.createPayment({
      supplier_id: usdSupplier.id,
      purchase_order_id: usdPo.id,
      amount_usd: 400,
      currency: 'USD',
      payment_method: 'transfer',
      created_by: ADMIN,
    });
    const usdPoPartial = purchases.get(usdPo.id);
    assert.strictEqual(usdPoPartial.payment_status, 'PARTIALLY_PAID');
    assert.strictEqual(Number(usdPoPartial.paid_amount_usd), 400);

    suppliers.createPayment({
      supplier_id: usdSupplier.id,
      purchase_order_id: usdPo.id,
      amount_usd: 600,
      currency: 'USD',
      payment_method: 'transfer',
      created_by: ADMIN,
    });
    const usdPoPaid = purchases.get(usdPo.id);
    assert.strictEqual(usdPoPaid.payment_status, 'PAID');
    assert.strictEqual(Number(usdPoPaid.paid_amount_usd), 1000);

    const supPaid = suppliers.get(usdSupplier.id);
    assert.ok(Math.abs(Number(supPaid.balance)) < 0.01, `balance after pay expected ~0, got ${supPaid.balance}`);
  });

  runStep('UZS ta\'minotchi: to\'liq UZS oqim — PO, qabul, qarz va to\'lov', () => {
    const uzsSupplierFull = suppliers.create({
      name: 'UZS Full Flow Smoke',
      phone: '+998901555003',
      settlement_currency: 'UZS',
    });

    const uzsPo = purchases.createOrder({
      supplier_id: uzsSupplierFull.id,
      order_date: today,
      status: 'approved',
      created_by: ADMIN,
      currency: 'UZS',
      items: [
        {
          product_id: productId,
          ordered_qty: 8,
          unit_cost: 125000,
          line_total: 1_000_000,
        },
      ],
    });
    assert.strictEqual(String(uzsPo.currency).toUpperCase(), 'UZS');
    assert.strictEqual(Number(uzsPo.total_amount), 1_000_000);
    assert.ok(uzsPo.total_usd == null || Number(uzsPo.total_usd) === 0);

    const uzsItemId = uzsPo.items[0].id;
    purchases.receiveGoods(uzsPo.id, {
      items: [{ item_id: uzsItemId, product_id: productId, received_qty: 8 }],
      received_by: ADMIN,
    });

    const supAfterUzsReceive = suppliers.get(uzsSupplierFull.id);
    assert.ok(
      Math.abs(Number(supAfterUzsReceive.balance) - 1_000_000) < 1,
      `UZS balance after receive expected 1000000, got ${supAfterUzsReceive.balance}`
    );

    suppliers.createPayment({
      supplier_id: uzsSupplierFull.id,
      purchase_order_id: uzsPo.id,
      amount: 400_000,
      currency: 'UZS',
      payment_method: 'cash',
      created_by: ADMIN,
    });
    const uzsPoPartial = purchases.get(uzsPo.id);
    assert.strictEqual(uzsPoPartial.payment_status, 'PARTIALLY_PAID');
    assert.strictEqual(Number(uzsPoPartial.paid_amount), 400_000);

    suppliers.createPayment({
      supplier_id: uzsSupplierFull.id,
      purchase_order_id: uzsPo.id,
      amount: 600_000,
      currency: 'UZS',
      payment_method: 'transfer',
      created_by: ADMIN,
    });
    const uzsPoPaid = purchases.get(uzsPo.id);
    assert.strictEqual(uzsPoPaid.payment_status, 'PAID');
    assert.strictEqual(Number(uzsPoPaid.paid_amount), 1_000_000);

    const supUzsPaid = suppliers.get(uzsSupplierFull.id);
    assert.ok(
      Math.abs(Number(supUzsPaid.balance)) < 1,
      `UZS balance after pay expected ~0, got ${supUzsPaid.balance}`
    );
  });

  runStep('UZS ta\'minotchi: USD PO to\'lov paid_amount_usd yangilanadi', () => {
    const fxRate = 12100;
    const uzsSupplier = suppliers.create({
      name: 'UZS PO USD invoice Smoke',
      phone: '+998901555002',
      settlement_currency: 'UZS',
    });

    const mixedPo = purchases.createOrder({
      supplier_id: uzsSupplier.id,
      order_date: today,
      status: 'approved',
      created_by: ADMIN,
      currency: 'USD',
      fx_rate: fxRate,
      items: [
        {
          product_id: productId,
          ordered_qty: 2,
          unit_cost_usd: 110.91,
          line_total_usd: 221.82,
        },
      ],
    });
    assert.strictEqual(String(mixedPo.currency).toUpperCase(), 'USD');
    assert.strictEqual(Number(mixedPo.total_usd), 221.82);

    const mixedItemId = mixedPo.items[0].id;
    purchases.receiveGoods(mixedPo.id, {
      items: [{ item_id: mixedItemId, product_id: productId, received_qty: 2 }],
      received_by: ADMIN,
    });

    suppliers.createPayment({
      supplier_id: uzsSupplier.id,
      purchase_order_id: mixedPo.id,
      amount: 221.82 * fxRate,
      currency: 'UZS',
      fx_rate: fxRate,
      payment_method: 'cash',
      created_by: ADMIN,
    });

    const mixedPaid = purchases.get(mixedPo.id);
    assert.ok(
      Math.abs(Number(mixedPaid.paid_amount_usd ?? mixedPaid.paid_amount) - 221.82) < 0.01,
      `paid USD expected 221.82, got ${mixedPaid.paid_amount_usd ?? mixedPaid.paid_amount}`
    );
    assert.strictEqual(mixedPaid.payment_status, 'PAID');
  });

  runStep('tahrir + createReceipt: USD qoralama Saqlash va qabul (UI oqimi)', () => {
    const fxRate = 12100;
    const usdSupplier = suppliers.create({
      name: 'Edit Receive Smoke USD',
      phone: '+998901555004',
      settlement_currency: 'USD',
    });

    const draftPo = purchases.createOrder({
      supplier_id: usdSupplier.id,
      order_date: today,
      status: 'draft',
      created_by: ADMIN,
      currency: 'USD',
      fx_rate: fxRate,
      items: [
        {
          product_id: productId,
          product_name: 'Chint 2Pls 32A',
          ordered_qty: 1,
          unit_cost_usd: 2.7,
          line_total_usd: 2.7,
        },
      ],
    });
    const draftItemId = draftPo.items[0].id;

    const edited = purchases.updateOrder(
      draftPo.id,
      {
        supplier_id: usdSupplier.id,
        order_date: today,
        status: 'approved',
        currency: 'USD',
        fx_rate: fxRate,
      },
      [
        {
          id: draftItemId,
          product_id: productId,
          product_name: 'Chint 2Pls 32A',
          ordered_qty: 1,
          unit_cost: 2.7 * fxRate,
          line_total: 2.7 * fxRate,
          unit_cost_usd: 2.7,
          line_total_usd: 2.7,
        },
      ],
    );
    assert.strictEqual(edited.items.length, 1, 'tahrirdan keyin 1 qator bo‘lishi kerak');
    assert.strictEqual(edited.items[0].id, draftItemId, 'qator id saqlanishi kerak');

    const poLine = edited.items[0];
    const remaining = Number(poLine.ordered_qty) - Number(poLine.received_qty || 0);
    assert.ok(remaining > 0, 'qabul qilinadigan qoldiq bo‘lishi kerak');

    const stockBefore = stockOf(inventory, productId);
    purchases.createReceipt({
      purchase_order_id: draftPo.id,
      supplier_id: usdSupplier.id,
      currency: 'USD',
      exchange_rate: fxRate,
      status: 'received',
      received_at: today,
      created_by: ADMIN,
      items: [
        {
          purchase_order_item_id: poLine.id,
          product_id: productId,
          product_name: poLine.product_name,
          received_qty: remaining,
          unit_cost_usd: 2.7,
          line_total_usd: remaining * 2.7,
        },
      ],
    });

    const after = purchases.get(draftPo.id);
    assert.strictEqual(after.status, 'received');
    assert.strictEqual(Number(after.items[0].received_qty), 1);
    assert.strictEqual(stockOf(inventory, productId), stockBefore + 1);
  });

  runStep('qoralama: qabul qilingandan keyin ordered kamaytirish — omborga ta\'sir qilmaydi', () => {
    const stockBeforePartial = stockOf(inventory, productId);
    const po = purchases.createOrder({
      supplier_id: supplierId,
      order_date: today,
      status: 'approved',
      created_by: ADMIN,
      items: [
        {
          product_id: productId,
          ordered_qty: 5,
          unit_cost: 4000,
          line_total: 20000,
        },
      ],
    });
    const lineId = po.items[0].id;
    purchases.receiveGoods(po.id, {
      items: [{ item_id: lineId, product_id: productId, received_qty: 2 }],
      received_by: ADMIN,
    });

    const stockAfterPartial = stockOf(inventory, productId);
    assert.strictEqual(stockAfterPartial, stockBeforePartial + 2);

    const edited = purchases.updateOrder(
      po.id,
      { notes: 'ordered kamaytirildi' },
      [
        {
          id: lineId,
          product_id: productId,
          ordered_qty: 1,
          unit_cost: 4000,
          line_total: 4000,
        },
      ],
    );
    assert.strictEqual(Number(edited.items[0].ordered_qty), 1);
    assert.strictEqual(Number(edited.items[0].received_qty), 2);
    assert.strictEqual(stockOf(inventory, productId), stockAfterPartial, 'qoralama tahrir omborga ta\'sir qilmasligi kerak');

    let receiveFailed = false;
    try {
      purchases.receiveGoods(po.id, {
        items: [{ item_id: lineId, product_id: productId, received_qty: 1 }],
        received_by: ADMIN,
      });
    } catch (e) {
      receiveFailed = true;
      assert.match(String(e.message || e), /kam bo'lmasligi kerak|qolgan miqdordan/i);
    }
    assert.ok(receiveFailed, 'ordered < received bo\'lganda qabul bloklanishi kerak');
  });

  runStep('qoralama: qabul qilingan qator payload dan tushsa ham DB da qoladi', () => {
    const extraProduct = products.create({
      name: 'Smoke Keep Received Line',
      sku: `PO-KEEP-${Date.now()}`,
      sale_price: 5000,
      purchase_price: 2000,
      track_stock: 1,
      current_stock: 0,
    });
    const po = purchases.createOrder({
      supplier_id: supplierId,
      order_date: today,
      status: 'approved',
      created_by: ADMIN,
      items: [
        {
          product_id: productId,
          ordered_qty: 4,
          unit_cost: 4000,
          line_total: 16000,
        },
      ],
    });
    const receivedLineId = po.items[0].id;
    purchases.receiveGoods(po.id, {
      items: [{ item_id: receivedLineId, product_id: productId, received_qty: 2 }],
      received_by: ADMIN,
    });

    const edited = purchases.updateOrder(
      po.id,
      { notes: 'received qator payload dan olib tashlandi' },
      [
        {
          product_id: extraProduct.id,
          ordered_qty: 1,
          unit_cost: 2000,
          line_total: 2000,
        },
      ],
    );
    assert.strictEqual(edited.items.length, 2);
    const kept = edited.items.find((row) => row.id === receivedLineId);
    assert.ok(kept, 'qabul qilingan qator saqlanishi kerak');
    assert.strictEqual(Number(kept.received_qty), 2);
    assert.strictEqual(Number(kept.ordered_qty), 4);
  });

  runStep('tahrir: id siz qator almashtirish — received_qty 0 qoladi', () => {
    const po = purchases.createOrder({
      supplier_id: supplierId,
      order_date: today,
      status: 'draft',
      created_by: ADMIN,
      items: [
        {
          product_id: productId,
          ordered_qty: 3,
          unit_cost: 4000,
          line_total: 12000,
        },
      ],
    });
    const edited = purchases.updateOrder(
      po.id,
      { notes: 'id siz tahrir' },
      [
        {
          product_id: productId,
          ordered_qty: 3,
          unit_cost: 4000,
          line_total: 12000,
          received_qty: 3,
        },
      ],
    );
    assert.strictEqual(edited.items.length, 1);
    assert.strictEqual(Number(edited.items[0].received_qty), 0);
    const remaining = Number(edited.items[0].ordered_qty) - Number(edited.items[0].received_qty || 0);
    assert.strictEqual(remaining, 3);
  });

  runStep('hisobot: listSupplierPaymentsDue', () => {
    const dueToday = reports.listSupplierPaymentsDue({ filter: 'today' });
    assert.ok(Array.isArray(dueToday));
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

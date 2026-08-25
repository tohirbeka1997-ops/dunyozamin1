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

/** UI `aggregatePurchaseOrders` — invoice debt (not warehouse received − paid) */
function aggregatePoUzs(orders) {
  const active = (orders || []).filter((po) => String(po.status || '').toLowerCase() !== 'cancelled');
  let orderedUzs = 0;
  let paidUzs = 0;
  let receivedUzs = 0;
  let debtUzs = 0;
  for (const po of active) {
    const cur = String(po.currency || 'UZS').toUpperCase();
    for (const it of po.items || []) {
      receivedUzs += (Number(it.received_qty) || 0) * (Number(it.landed_unit_cost ?? it.unit_cost) || 0);
    }
    if (cur === 'USD') continue;
    orderedUzs += Number(po.total_amount || 0);
    const paid = Number(po.paid_amount ?? po.paid_amount_uzs ?? po.computed_paid_amount ?? 0);
    paidUzs += paid;
    const remaining =
      po.remaining_amount != null && Number.isFinite(Number(po.remaining_amount))
        ? Number(po.remaining_amount)
        : Number(po.total_amount || 0) - paid;
    if (remaining > 0) debtUzs += remaining;
  }
  return {
    count: active.length,
    orderedUzs,
    paidUzs,
    receivedUzs,
    debtUzs,
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
  const { products, inventory, purchases, suppliers, reports, exchangeRates, sales, shifts, customers } = createServices(db);

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
    // Qarz — hujjat (invoice) qoldig‘i, ombor landed cost emas
    assert.strictEqual(agg.debtUzs, Math.max(0, agg.orderedUzs - agg.paidUzs));
    assert.strictEqual(agg.debtUzs, 45000);
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

  runStep('USD createOrder: unit_cost (UZS) alone must NOT be treated as dollars', () => {
    const fxRate = 12500;
    const usdSupplier = suppliers.create({
      name: 'No Double FX Smoke',
      phone: '+998901555099',
      settlement_currency: 'USD',
    });
    let threw = false;
    try {
      purchases.createOrder({
        supplier_id: usdSupplier.id,
        order_date: today,
        status: 'draft',
        created_by: ADMIN,
        currency: 'USD',
        fx_rate: fxRate,
        items: [
          {
            product_id: productId,
            product_name: 'Phantom COGS bait',
            ordered_qty: 1,
            // Intentionally UZS-sized amount without unit_cost_usd — old bug × fx → ~74M
            unit_cost: 5928,
            line_total: 5928,
          },
        ],
      });
    } catch (e) {
      threw = true;
      assert.ok(
        /unit_cost_usd/i.test(String(e?.message || e)),
        `expected unit_cost_usd error, got ${e?.message || e}`,
      );
    }
    assert.ok(threw, 'createOrder must reject USD lines without unit_cost_usd');
  });

  runStep('USD createReceipt: bare unit_cost is UZS (÷ fx), not dollars (× fx)', () => {
    const fxRate = 12500;
    const uzsCost = 5928;
    const usdSupplier = suppliers.create({
      name: 'Receipt UZS-as-cost Smoke',
      phone: '+998901555098',
      settlement_currency: 'USD',
    });
    const p = products.create({
      name: `Receipt cost guard ${Date.now()}`,
      sku: `RCG-${Date.now()}`,
      sale_price: 214900,
      purchase_price: uzsCost,
      unit: 'pcs',
      track_stock: 1,
    });
    purchases.createReceipt({
      supplier_id: usdSupplier.id,
      currency: 'USD',
      exchange_rate: fxRate,
      status: 'received',
      received_at: today,
      created_by: ADMIN,
      items: [
        {
          product_id: p.id,
          product_name: p.name,
          received_qty: 1,
          // Only UZS unit_cost — must NOT become uzsCost * fxRate
          unit_cost: uzsCost,
        },
      ],
    });
    const prod = db.prepare('SELECT purchase_price FROM products WHERE id = ?').get(p.id);
    const stored = Number(prod?.purchase_price || 0);
    assert.ok(
      Math.abs(stored - uzsCost) < 1,
      `purchase_price should stay ~${uzsCost} UZS, got ${stored} (would be ${uzsCost * fxRate} if double-FX)`,
    );
    assert.ok(stored < 100_000, `stored cost ${stored} looks like FX-inflated phantom`);
  });

  runStep('daily sales flags cogs_anomaly when COGS >> revenue', () => {
    const badCost = 74_103_559;
    const salePrice = 214_900;
    const p = products.create({
      name: `Anomaly COGS ${Date.now()}`,
      sku: `ACG-${Date.now()}`,
      sale_price: salePrice,
      purchase_price: badCost,
      unit: 'pcs',
      track_stock: 1,
    });
    inventory.adjustStock({
      warehouse_id: WH,
      adjustment_type: 'set',
      reason: 'anomaly seed',
      created_by: ADMIN,
      items: [{ product_id: p.id, target_quantity: 5 }],
    });
    const shift = shifts.openShift({ user_id: ADMIN });
    const cust = customers.create({
      name: 'Credit anomaly',
      phone: `+99890${String(Date.now()).slice(-7)}`,
      allow_debt: 1,
      credit_limit: 10_000_000,
    });
    const sale = sales.completePOSOrder(
      {
        total_amount: salePrice,
        currency: 'UZS',
        shift_id: shift.id,
        user_id: ADMIN,
        warehouse_id: WH,
        sales_channel: 'pos',
        customer_id: cust.id,
      },
      [
        {
          product_id: p.id,
          product_name: p.name,
          quantity: 1,
          qty_sale: 1,
          qty_base: 1,
          unit_price: salePrice,
          line_total: salePrice,
          final_total: salePrice,
        },
      ],
      [],
    );
    const report = reports.getDailySalesReportSQL({
      date_from: today,
      date_to: today,
      warehouse_id: WH,
    });
    const row = (report.orders || []).find((o) => o.order_number === sale.order_number);
    assert.ok(row, 'sale in daily report');
    assert.ok(Number(row.profit) < -50_000_000, `expected huge loss, got ${row.profit}`);
    assert.strictEqual(row.cogs_anomaly, true, 'cogs_anomaly flag');
    assert.ok(report.warnings?.cogs_anomaly, 'summary warning');
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

  runStep('tahrir: qoralama qatordan mahsulot o‘chirish — saqlashdan keyin yo‘qoladi', () => {
    const keepProduct = products.create({
      name: 'Smoke Keep Draft Line',
      sku: `PO-KEEP-DRAFT-${Date.now()}`,
      sale_price: 8000,
      purchase_price: 4000,
      track_stock: 1,
      current_stock: 0,
    });
    const dropProduct = products.create({
      name: 'Smoke Drop Draft Line',
      sku: `PO-DROP-DRAFT-${Date.now()}`,
      sale_price: 5000,
      purchase_price: 2000,
      track_stock: 1,
      current_stock: 0,
    });
    const po = purchases.createOrder({
      supplier_id: supplierId,
      order_date: today,
      status: 'draft',
      created_by: ADMIN,
      items: [
        {
          product_id: keepProduct.id,
          ordered_qty: 2,
          unit_cost: 4000,
          line_total: 8000,
        },
        {
          product_id: dropProduct.id,
          ordered_qty: 3,
          unit_cost: 2000,
          line_total: 6000,
        },
      ],
    });
    assert.strictEqual(po.items.length, 2);
    const keepLine = po.items.find((row) => row.product_id === keepProduct.id);
    assert.ok(keepLine);

    const edited = purchases.updateOrder(
      po.id,
      { notes: 'UI: trash → saqlash' },
      [
        {
          id: keepLine.id,
          product_id: keepProduct.id,
          ordered_qty: 2,
          unit_cost: 4000,
          line_total: 8000,
        },
      ],
    );
    assert.strictEqual(edited.items.length, 1, 'o‘chirilgan qator DB dan ketishi kerak');
    assert.strictEqual(edited.items[0].product_id, keepProduct.id);

    const reloaded = purchases.get(po.id);
    assert.strictEqual(reloaded.items.length, 1);
    assert.strictEqual(reloaded.items[0].product_id, keepProduct.id);
    assert.ok(
      !reloaded.items.some((row) => row.product_id === dropProduct.id),
      'reload dan keyin o‘chirilgan mahsulot qaytmasligi kerak',
    );
  });

  runStep('qisman qabul: qabul qilinmagan qatorni o‘chirish mumkin', () => {
    const unreceivedProduct = products.create({
      name: 'Smoke Unreceived Drop',
      sku: `PO-UNRECV-${Date.now()}`,
      sale_price: 6000,
      purchase_price: 3000,
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
        {
          product_id: unreceivedProduct.id,
          ordered_qty: 2,
          unit_cost: 3000,
          line_total: 6000,
        },
      ],
    });
    const receivedLine = po.items.find((row) => row.product_id === productId);
    const dropLine = po.items.find((row) => row.product_id === unreceivedProduct.id);
    assert.ok(receivedLine && dropLine);
    purchases.receiveGoods(po.id, {
      items: [{ item_id: receivedLine.id, product_id: productId, received_qty: 2 }],
      received_by: ADMIN,
    });

    const edited = purchases.updateOrder(
      po.id,
      { notes: 'unreceived line removed' },
      [
        {
          id: receivedLine.id,
          product_id: productId,
          ordered_qty: 4,
          unit_cost: 4000,
          line_total: 16000,
        },
      ],
    );
    assert.strictEqual(edited.items.length, 1);
    assert.strictEqual(edited.items[0].id, receivedLine.id);
    assert.strictEqual(Number(edited.items[0].received_qty), 2);
  });

  runStep('qabul qilingan qator payload dan tushsa — xato (ombor himoyasi)', () => {
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

    let blocked = false;
    try {
      purchases.updateOrder(
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
    } catch (e) {
      blocked = true;
      assert.match(String(e.message || e), /Qabul qilingan mahsulotni o'chirib bo'lmaydi/i);
    }
    assert.ok(blocked, 'received qatorni o‘chirish bloklanishi kerak');

    const kept = purchases.get(po.id);
    assert.ok(
      kept.items.some((row) => row.id === receivedLineId && Number(row.received_qty) === 2),
      'qabul qilingan qator DB da qolishi kerak',
    );
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
    const openAll = reports.listSupplierPaymentsDue({ filter: 'open' });
    assert.ok(Array.isArray(openAll));
    // Smoke seed: po2 still has invoice remaining after partial payment on po1
    assert.ok(
      openAll.some((r) => Number(r.amount) > 0),
      'open filter should include document remaining debt'
    );
    for (const r of openAll) {
      assert.ok(['overdue', 'today', 'upcoming', 'no_due'].includes(String(r.due_status)));
    }
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

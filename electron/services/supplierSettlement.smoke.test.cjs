/* eslint-disable no-console */
/**
 * Dual-bucket supplier settlement TZ:
 *   debt vs advance, UZS/USD isolated, pay / advance / receive / refund cap.
 *
 * Ishga tushirish: npm run test:supplier-settlement-smoke
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const WH = 'main-warehouse-001';
const ADMIN = 'default-admin-001';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-supplier-settlement-'));
process.env.POS_SERVER_MODE = '1';
process.env.POS_DATA_DIR = tmpDir;
process.env.POS_VERBOSE_LOGS = '0';

const { open, close, getDb } = require('../db/open.cjs');
const { createServices } = require('./index.cjs');
const { previewSettlementMutation } = require('../lib/supplierSettlement.cjs');

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
function runStep(name, fn) {
  try {
    fn();
    ok(name);
  } catch (e) {
    fail(name, e);
  }
}

console.log('\n=== SUPPLIER SETTLEMENT SMOKE ===');
console.log(`Temp DB: ${tmpDir}\n`);

try {
  open();
  const db = getDb();
  const { products, purchases, suppliers, reports } = createServices(db);

  runStep('unit: preview pay / overpay / receive / refund cap', () => {
    const base = {
      debt_uzs: 1000,
      debt_usd: 0,
      advance_uzs: 0,
      advance_usd: 0,
      pending_refund_uzs: 0,
      pending_refund_usd: 0,
    };
    const pay = previewSettlementMutation(base, { op_kind: 'pay', amount: 1000, currency: 'UZS' });
    assert.strictEqual(pay.debt_after, 0);
    assert.strictEqual(pay.advance_after, 0);

    const over = previewSettlementMutation(base, { op_kind: 'pay', amount: 2000, currency: 'UZS' });
    assert.ok(over.blocked);

    const overOk = previewSettlementMutation(base, {
      op_kind: 'pay',
      amount: 2000,
      currency: 'UZS',
      accept_as_advance: true,
    });
    assert.strictEqual(overOk.debt_after, 0);
    assert.strictEqual(overOk.advance_after, 1000);

    const recv = previewSettlementMutation(
      { ...base, debt_uzs: 0, advance_uzs: 1000 },
      { op_kind: 'receive', amount: 1000, currency: 'UZS' },
    );
    assert.strictEqual(recv.advance_after, 0);

    const tooMuch = previewSettlementMutation(
      { ...base, debt_uzs: 0, advance_uzs: 1000 },
      { op_kind: 'receive', amount: 1001, currency: 'UZS' },
    );
    assert.ok(tooMuch.blocked);

    const usdPay = previewSettlementMutation(
      { ...base, debt_uzs: 1000, debt_usd: 50 },
      { op_kind: 'pay', amount: 50, currency: 'USD' },
    );
    assert.strictEqual(usdPay.debt_after, 0);
    assert.strictEqual(usdPay.currency, 'USD');
  });

  const supplier = suppliers.create({
    name: 'Settlement TZ Supplier',
    phone: '+998901111001',
    settlement_currency: 'UZS',
  });
  const supplierId = supplier.id;

  const product = products.create({
    name: 'Settlement Item',
    sku: `SET-${Date.now()}`,
    unit: 'dona',
    sale_price: 2000,
    purchase_price: 1000,
    track_stock: 1,
    created_by: ADMIN,
  });

  let poId = null;
  runStep('1000 so‘m xarid qabul → qarz 1000', () => {
    const po = purchases.createOrder({
      supplier_id: supplierId,
      warehouse_id: WH,
      order_date: '2026-09-03',
      status: 'approved',
      currency: 'UZS',
      created_by: ADMIN,
      items: [
        {
          product_id: product.id,
          product_name: product.name,
          product_sku: product.sku,
          ordered_qty: 1,
          unit_cost: 1000,
          line_total: 1000,
        },
      ],
    });
    poId = po.id;
    purchases.createReceipt({
      purchase_order_id: po.id,
      supplier_id: supplierId,
      status: 'received',
      currency: 'UZS',
      received_at: '2026-09-03 12:00:00',
      created_by: ADMIN,
      items: [
        {
          purchase_order_item_id: po.items[0].id,
          product_id: product.id,
          product_name: product.name,
          received_qty: 1,
          unit_cost: 1000,
          line_total: 1000,
        },
      ],
    });
    const s = suppliers.getSettlement(supplierId);
    assert.ok(Math.abs(Number(s.debt_uzs) - 1000) < 1, `debt_uzs=${s.debt_uzs}`);
    assert.ok(Number(s.advance_uzs) < 1, `advance_uzs=${s.advance_uzs}`);
  });

  runStep('1000 so‘m to‘lov → qarz 0', () => {
    suppliers.settleSupplier({
      supplier_id: supplierId,
      op_kind: 'pay',
      amount: 1000,
      currency: 'UZS',
      payment_method: 'cash',
      purchase_order_id: poId,
      created_by: ADMIN,
      idempotency_key: `tz-pay-${Date.now()}`,
    });
    const s = suppliers.getSettlement(supplierId);
    assert.ok(Number(s.debt_uzs) < 1, `debt after pay=${s.debt_uzs}`);
  });

  const supplier2 = suppliers.create({
    name: 'Settlement Overpay Supplier',
    phone: '+998901111002',
    settlement_currency: 'UZS',
  });
  const product2 = products.create({
    name: 'Settlement Item 2',
    sku: `SET2-${Date.now()}`,
    unit: 'dona',
    sale_price: 2000,
    purchase_price: 1000,
    track_stock: 1,
    created_by: ADMIN,
  });

  runStep('1000 so‘m ortiqcha to‘lov → avans 1000', () => {
    const po = purchases.createOrder({
      supplier_id: supplier2.id,
      warehouse_id: WH,
      order_date: '2026-09-03',
      status: 'approved',
      currency: 'UZS',
      created_by: ADMIN,
      items: [
        {
          product_id: product2.id,
          product_name: product2.name,
          product_sku: product2.sku,
          ordered_qty: 1,
          unit_cost: 1000,
          line_total: 1000,
        },
      ],
    });
    purchases.createReceipt({
      purchase_order_id: po.id,
      supplier_id: supplier2.id,
      status: 'received',
      currency: 'UZS',
      received_at: '2026-09-03 12:00:00',
      created_by: ADMIN,
      items: [
        {
          purchase_order_item_id: po.items[0].id,
          product_id: product2.id,
          product_name: product2.name,
          received_qty: 1,
          unit_cost: 1000,
          line_total: 1000,
        },
      ],
    });
    suppliers.settleSupplier({
      supplier_id: supplier2.id,
      op_kind: 'pay',
      amount: 2000,
      currency: 'UZS',
      payment_method: 'cash',
      purchase_order_id: po.id,
      accept_as_advance: true,
      created_by: ADMIN,
      idempotency_key: `tz-overpay-${Date.now()}`,
    });
    const s = suppliers.getSettlement(supplier2.id);
    assert.ok(Number(s.debt_uzs) < 1, `debt=${s.debt_uzs}`);
    assert.ok(Math.abs(Number(s.advance_uzs) - 1000) < 1, `advance=${s.advance_uzs}`);
  });

  runStep('1000 so‘m refund → avans 0 + kassa kirimi', () => {
    const beforePayCount = db
      .prepare(`SELECT COUNT(*) AS c FROM supplier_payments WHERE supplier_id = ? AND amount < 0`)
      .get(supplier2.id);
    suppliers.settleSupplier({
      supplier_id: supplier2.id,
      op_kind: 'receive',
      amount: 1000,
      currency: 'UZS',
      payment_method: 'cash',
      created_by: ADMIN,
      reason: 'Avans qaytarildi',
      idempotency_key: `tz-recv-${Date.now()}`,
    });
    const s = suppliers.getSettlement(supplier2.id);
    assert.ok(Number(s.advance_uzs) < 1, `advance after refund=${s.advance_uzs}`);
    const inflow = db
      .prepare(
        `SELECT COALESCE(SUM(amount), 0) AS s FROM supplier_payments WHERE supplier_id = ? AND amount < 0`,
      )
      .get(supplier2.id);
    assert.ok(Math.abs(Number(inflow.s) + 1000) < 1, `cash in=${inflow.s}`);
    assert.ok(Number(beforePayCount.c) === 0);
  });

  runStep('refund avansdan katta bo‘lsa bloklanadi', () => {
    assert.throws(
      () =>
        suppliers.settleSupplier({
          supplier_id: supplier2.id,
          op_kind: 'receive',
          amount: 1000,
          currency: 'UZS',
          payment_method: 'cash',
          created_by: ADMIN,
        }),
      /avansdan oshadi|Refund/i,
    );
  });

  runStep('UZS va USD qoldiqlari aralashmaydi', () => {
    const usdSupplier = suppliers.create({
      name: 'USD Settlement Supplier',
      phone: '+998901111003',
      settlement_currency: 'USD',
    });
    suppliers.settleSupplier({
      supplier_id: usdSupplier.id,
      op_kind: 'advance_out',
      amount: 25,
      currency: 'USD',
      payment_method: 'transfer',
      created_by: ADMIN,
      reason: 'USD avans',
    });
    const s = suppliers.getSettlement(usdSupplier.id);
    assert.ok(Math.abs(Number(s.advance_usd) - 25) < 0.02, `advance_usd=${s.advance_usd}`);
    assert.ok(Number(s.advance_uzs) < 1, `advance_uzs leaked=${s.advance_uzs}`);
    assert.throws(
      () =>
        suppliers.settleSupplier({
          supplier_id: usdSupplier.id,
          op_kind: 'receive',
          amount: 25,
          currency: 'UZS',
          payment_method: 'cash',
          created_by: ADMIN,
        }),
      /avansdan oshadi|Refund/i,
    );
  });

  runStep('akt-sverka barcha amallarni ko‘rsatadi', () => {
    const act = reports.getSupplierActSverka({ supplier_id: supplier2.id });
    const types = new Set((act.rows || []).map((r) => String(r.type)));
    assert.ok(types.has('purchase'), 'purchase row');
    assert.ok(types.has('payment') || types.has('advance_out'), `pay/advance types=${[...types]}`);
    assert.ok(types.has('receive'), `receive missing: ${[...types]}`);
    assert.ok(act.settlement, 'settlement snapshot');
  });

  runStep('idempotency: bir xil kalit ikki marta yozilmaydi', () => {
    const sid = suppliers.create({
      name: 'Idem Supplier',
      phone: '+998901111004',
    }).id;
    const key = `tz-idem-${Date.now()}`;
    const a = suppliers.settleSupplier({
      supplier_id: sid,
      op_kind: 'advance_out',
      amount: 500,
      currency: 'UZS',
      payment_method: 'cash',
      created_by: ADMIN,
      idempotency_key: key,
    });
    const b = suppliers.settleSupplier({
      supplier_id: sid,
      op_kind: 'advance_out',
      amount: 500,
      currency: 'UZS',
      payment_method: 'cash',
      created_by: ADMIN,
      idempotency_key: key,
    });
    assert.strictEqual(a.id, b.id);
    const s = suppliers.getSettlement(sid);
    assert.ok(Math.abs(Number(s.advance_uzs) - 500) < 1, `advance after replay=${s.advance_uzs}`);
  });

  console.log(`\n=== NATIJA: ${passed} OK, ${failed} FAIL ===\n`);
  process.exit(failed > 0 ? 1 : 0);
} catch (e) {
  fail('supplier settlement suite', e);
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

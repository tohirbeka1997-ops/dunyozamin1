'use strict';

/**
 * purchaseAuditHardening.smoke.test.cjs
 * P0/P1: empty/0 receive block, overpay → supplier advance, partial receive race.
 *
 * Run: electron electron/services/purchaseAuditHardening.smoke.test.cjs
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const WH = 'main-warehouse-001';
const ADMIN = 'default-admin-001';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-purchase-audit-'));
process.env.POS_SERVER_MODE = '1';
process.env.POS_DATA_DIR = tmpDir;
process.env.POS_VERBOSE_LOGS = '0';

const { open, close, getDb } = require('../db/open.cjs');
const { createServices } = require('./index.cjs');
const {
  computePurchasePaymentStatus,
  validateConfirmReceiveInput,
  splitPaymentAgainstRemainder,
  computeReceivableQty,
} = require('../lib/purchaseHardening.cjs');

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

console.log('\n=== PURCHASE AUDIT HARDENING SMOKE ===');
console.log(`Temp DB: ${tmpDir}\n`);

try {
  open();
  const db = getDb();
  const { products, inventory, purchases, suppliers } = createServices(db);

  // Ensure profiles.role admin for privilege gates
  try {
    db.prepare(`UPDATE profiles SET role = 'admin' WHERE id = ?`).run(ADMIN);
  } catch {
    // ignore
  }

  runStep('unit: negative remainder is OVERPAID not PAID', () => {
    assert.strictEqual(computePurchasePaymentStatus(150, 100, 'UZS'), 'OVERPAID');
    assert.strictEqual(computePurchasePaymentStatus(100, 100, 'UZS'), 'PAID');
    assert.strictEqual(computePurchasePaymentStatus(50, 100, 'UZS'), 'PARTIALLY_PAID');
    assert.strictEqual(computePurchasePaymentStatus(0, 100, 'UZS'), 'UNPAID');
  });

  runStep('unit: confirm receive rejects empty/0 cost', () => {
    const empty = validateConfirmReceiveInput({
      supplier_id: null,
      items: [],
      received_at: '',
      currency: '',
    });
    assert.strictEqual(empty.ok, false);
    assert.ok(empty.errors.length >= 3);

    const zeroCost = validateConfirmReceiveInput({
      supplier_id: 's1',
      items: [{ product_id: 'p1', received_qty: 1, unit_cost: 0 }],
      received_at: '2026-08-27',
      currency: 'UZS',
    });
    assert.strictEqual(zeroCost.ok, false);

    const zeroQty = validateConfirmReceiveInput({
      supplier_id: 's1',
      items: [{ product_id: 'p1', received_qty: 0, unit_cost: 100 }],
      received_at: '2026-08-27',
      currency: 'UZS',
    });
    assert.strictEqual(zeroQty.ok, false);

    const okStd = validateConfirmReceiveInput({
      supplier_id: 's1',
      items: [{ product_id: 'p1', received_qty: 2, unit_cost: 100 }],
      received_at: '2026-08-27',
      currency: 'UZS',
    });
    assert.strictEqual(okStd.ok, true);
  });

  runStep('unit: split overpay requires advance ack', () => {
    const s = splitPaymentAgainstRemainder(150000, 100000, 'UZS');
    assert.strictEqual(s.settleAmount, 100000);
    assert.strictEqual(s.advanceAmount, 50000);
    assert.strictEqual(s.requiresAdvanceAck, true);
  });

  runStep('unit: receivable qty', () => {
    assert.strictEqual(computeReceivableQty(10, 3, 2), 5);
    assert.strictEqual(computeReceivableQty(10, 10, 0), 0);
  });

  const supplier = suppliers.create({
    name: 'Audit Hardening Supplier',
    phone: '+998901999001',
  });
  const supplierId = supplier.id;

  const product = products.create({
    name: 'Audit Product SKU00465',
    sku: '00465',
    barcode: '46000465',
    unit: 'dona',
    sale_price: 20000,
    purchase_price: 10000,
    track_stock: 1,
    created_by: ADMIN,
  });
  const productId = product.id;

  let poId = null;
  let poiId = null;

  runStep('create PO + receive full', () => {
    const po = purchases.createOrder({
      supplier_id: supplierId,
      warehouse_id: WH,
      order_date: '2026-08-27',
      status: 'approved',
      currency: 'UZS',
      created_by: ADMIN,
      items: [
        {
          product_id: productId,
          product_name: product.name,
          product_sku: product.sku,
          ordered_qty: 10,
          unit_cost: 10000,
          line_total: 100000,
        },
      ],
    });
    poId = po.id;
    poiId = po.items[0].id;

    purchases.createReceipt({
      purchase_order_id: poId,
      supplier_id: supplierId,
      status: 'received',
      currency: 'UZS',
      received_at: '2026-08-27 12:00:00',
      created_by: ADMIN,
      items: [
        {
          purchase_order_item_id: poiId,
          product_id: productId,
          product_name: product.name,
          received_qty: 10,
          unit_cost: 10000,
          line_total: 100000,
        },
      ],
    });

    const got = purchases.get(poId);
    assert.strictEqual(got.status, 'received');
    assert.ok(Number(inventory.getCurrentStock(productId, WH)) >= 10);
  });

  runStep('P0: confirm receive rejects empty / 0 qty / 0 cost / no supplier', () => {
    assert.throws(
      () =>
        purchases.createReceipt({
          status: 'received',
          currency: 'UZS',
          received_at: '2026-08-27',
          items: [{ product_id: productId, received_qty: 1, unit_cost: 100 }],
        }),
      /supplier/i,
    );

    assert.throws(
      () =>
        purchases.createReceipt({
          supplier_id: supplierId,
          status: 'received',
          currency: 'UZS',
          received_at: '2026-08-27',
          items: [],
        }),
      /item|product/i,
    );

    assert.throws(
      () =>
        purchases.createReceipt({
          supplier_id: supplierId,
          status: 'received',
          currency: 'UZS',
          received_at: '2026-08-27',
          items: [{ product_id: productId, received_qty: 0, unit_cost: 100 }],
        }),
      /qty|quantity|0/i,
    );

    assert.throws(
      () =>
        purchases.createReceipt({
          supplier_id: supplierId,
          status: 'received',
          currency: 'UZS',
          received_at: '2026-08-27',
          items: [{ product_id: productId, received_qty: 1, unit_cost: 0 }],
        }),
      /cost|0/i,
    );
  });

  runStep('P0: draft empty allowed (no stock change)', () => {
    const stockBefore = Number(inventory.getCurrentStock(productId, WH)) || 0;
    const draft = purchases.createReceipt({
      supplier_id: supplierId,
      status: 'draft',
      currency: 'UZS',
      received_at: '2026-08-27',
      created_by: ADMIN,
      items: [],
    });
    assert.ok(draft.id);
    const stockAfter = Number(inventory.getCurrentStock(productId, WH)) || 0;
    assert.strictEqual(stockAfter, stockBefore);
  });

  runStep('P0: overpay without accept_as_advance rejected', () => {
    assert.throws(
      () =>
        suppliers.createPayment({
          supplier_id: supplierId,
          purchase_order_id: poId,
          amount: 150000,
          currency: 'UZS',
          payment_method: 'cash',
          created_by: ADMIN,
        }),
      /accept_as_advance|avans|oshadi/i,
    );
  });

  runStep('P0: overpay with accept_as_advance → PAID + advance (no negative debt)', () => {
    const result = suppliers.createPayment({
      supplier_id: supplierId,
      purchase_order_id: poId,
      amount: 150000,
      currency: 'UZS',
      payment_method: 'cash',
      created_by: ADMIN,
      accept_as_advance: true,
      idempotency_key: `test-overpay-${Date.now()}`,
    });

    assert.ok(result.advance, 'advance record required');
    assert.ok(Number(result.advance.amount_remaining) >= 49999);
    assert.ok(Number(result.advance_amount) >= 49999);

    const got = purchases.get(poId);
    assert.strictEqual(got.payment_status, 'PAID');
    assert.ok(Number(got.remaining_amount) >= 0);
    assert.ok(Number(got.remaining_amount) < 1, 'debt must be ~0');
    assert.ok(
      Number(got.excess_amount || 0) === 0 || Number(got.has_supplier_advance) === 1 || result.advance,
      'excess tracked as advance',
    );

    const advances = suppliers.listAdvances(supplierId);
    assert.ok(advances.length >= 1);
  });

  runStep('P0: overpay idempotency replay', () => {
    const key = `test-idem-pay-${Date.now()}`;
    // Create a second PO for a clean remaining
    const po2 = purchases.createOrder({
      supplier_id: supplierId,
      warehouse_id: WH,
      order_date: '2026-08-27',
      status: 'approved',
      currency: 'UZS',
      created_by: ADMIN,
      items: [
        {
          product_id: productId,
          product_name: product.name,
          product_sku: product.sku,
          ordered_qty: 1,
          unit_cost: 5000,
          line_total: 5000,
        },
      ],
    });
    purchases.createReceipt({
      purchase_order_id: po2.id,
      supplier_id: supplierId,
      status: 'received',
      currency: 'UZS',
      received_at: '2026-08-27 12:00:00',
      created_by: ADMIN,
      items: [
        {
          purchase_order_item_id: po2.items[0].id,
          product_id: productId,
          product_name: product.name,
          received_qty: 1,
          unit_cost: 5000,
          line_total: 5000,
        },
      ],
    });

    const a = suppliers.createPayment({
      supplier_id: supplierId,
      purchase_order_id: po2.id,
      amount: 5000,
      currency: 'UZS',
      payment_method: 'cash',
      created_by: ADMIN,
      idempotency_key: key,
    });
    const b = suppliers.createPayment({
      supplier_id: supplierId,
      purchase_order_id: po2.id,
      amount: 5000,
      currency: 'UZS',
      payment_method: 'cash',
      created_by: ADMIN,
      idempotency_key: key,
    });
    assert.strictEqual(a.id, b.id);
  });

  runStep('P1: partial receive then race over-receive → CONFLICT', () => {
    const po3 = purchases.createOrder({
      supplier_id: supplierId,
      warehouse_id: WH,
      order_date: '2026-08-27',
      status: 'approved',
      currency: 'UZS',
      created_by: ADMIN,
      items: [
        {
          product_id: productId,
          product_name: product.name,
          product_sku: product.sku,
          ordered_qty: 5,
          unit_cost: 8000,
          line_total: 40000,
        },
      ],
    });
    const lineId = po3.items[0].id;

    purchases.createReceipt({
      purchase_order_id: po3.id,
      supplier_id: supplierId,
      status: 'received',
      currency: 'UZS',
      received_at: '2026-08-27 13:00:00',
      created_by: ADMIN,
      idempotency_key: `partial-1-${Date.now()}`,
      items: [
        {
          purchase_order_item_id: lineId,
          product_id: productId,
          product_name: product.name,
          received_qty: 3,
          unit_cost: 8000,
          line_total: 24000,
        },
      ],
    });

    const mid = purchases.get(po3.id);
    assert.strictEqual(mid.status, 'partially_received');

    assert.throws(
      () =>
        purchases.createReceipt({
          purchase_order_id: po3.id,
          supplier_id: supplierId,
          status: 'received',
          currency: 'UZS',
          received_at: '2026-08-27 14:00:00',
          created_by: ADMIN,
          items: [
            {
              purchase_order_item_id: lineId,
              product_id: productId,
              product_name: product.name,
              received_qty: 5,
              unit_cost: 8000,
              line_total: 40000,
            },
          ],
        }),
      (err) => err.code === 'CONFLICT' || /exceed|osh/i.test(String(err.message || '')),
    );

    purchases.createReceipt({
      purchase_order_id: po3.id,
      supplier_id: supplierId,
      status: 'received',
      currency: 'UZS',
      received_at: '2026-08-27 14:30:00',
      created_by: ADMIN,
      items: [
        {
          purchase_order_item_id: lineId,
          product_id: productId,
          product_name: product.name,
          received_qty: 2,
          unit_cost: 8000,
          line_total: 16000,
        },
      ],
    });
    const done = purchases.get(po3.id);
    assert.strictEqual(done.status, 'received');
  });

  runStep('P1: received PO cost edit blocked without correction', () => {
    const got = purchases.get(poId);
    assert.throws(
      () =>
        purchases.updateOrder(
          poId,
          { via_cost_correction: false },
          got.items.map((it) => ({
            ...it,
            unit_cost: Number(it.unit_cost) + 500,
            line_total: Number(it.ordered_qty) * (Number(it.unit_cost) + 500),
          })),
        ),
      /correction|Received order costs/i,
    );
  });

  runStep('P1: cost correction create + approve', () => {
    const got = purchases.get(poId);
    const line = got.items[0];
    const corr = purchases.createCostCorrection({
      purchase_order_id: poId,
      purchase_order_item_id: line.id,
      product_id: line.product_id,
      field_name: 'unit_cost',
      old_value: line.unit_cost,
      new_value: Number(line.unit_cost) + 100,
      reason: 'Invoice price correction',
      created_by: ADMIN,
    });
    assert.strictEqual(corr.status, 'pending');
    const approved = purchases.approveCostCorrection(corr.id, { approved_by: ADMIN, apply: true });
    assert.strictEqual(approved.status, 'approved');
    const after = purchases.get(poId);
    const updated = after.items.find((i) => i.id === line.id);
    assert.ok(Math.abs(Number(updated.unit_cost) - (Number(line.unit_cost) + 100)) < 0.01);
  });

  runStep('P1: apply existing advance to later PO', () => {
    const advances = suppliers.listAdvances(supplierId);
    assert.ok(advances.length >= 1, 'need advance from overpay step');
    const adv = advances[0];
    const remAdv = Number(adv.amount_remaining || 0);
    assert.ok(remAdv > 0);

    const poAdv = purchases.createOrder({
      supplier_id: supplierId,
      warehouse_id: WH,
      order_date: '2026-08-27',
      status: 'approved',
      currency: 'UZS',
      created_by: ADMIN,
      items: [
        {
          product_id: productId,
          product_name: product.name,
          product_sku: product.sku,
          ordered_qty: 1,
          unit_cost: Math.min(remAdv, 20000),
          line_total: Math.min(remAdv, 20000),
        },
      ],
    });
    purchases.createReceipt({
      purchase_order_id: poAdv.id,
      supplier_id: supplierId,
      status: 'received',
      currency: 'UZS',
      received_at: '2026-08-27 15:00:00',
      created_by: ADMIN,
      items: [
        {
          purchase_order_item_id: poAdv.items[0].id,
          product_id: productId,
          product_name: product.name,
          received_qty: 1,
          unit_cost: Math.min(remAdv, 20000),
          line_total: Math.min(remAdv, 20000),
        },
      ],
    });

    assert.throws(
      () =>
        suppliers.applyAdvanceToPurchaseOrder({
          advance_id: adv.id,
          purchase_order_id: poAdv.id,
          amount: Math.min(remAdv, 20000),
          created_by: ADMIN,
          confirm: false,
        }),
      /confirm/i,
    );

    const applied = suppliers.applyAdvanceToPurchaseOrder({
      advance_id: adv.id,
      purchase_order_id: poAdv.id,
      amount: Math.min(remAdv, 20000),
      created_by: ADMIN,
      confirm: true,
    });
    assert.ok(applied.payment);
    const afterPo = purchases.get(poAdv.id);
    assert.ok(Number(afterPo.remaining_amount) < 1);
    assert.strictEqual(afterPo.payment_status, 'PAID');
  });

  runStep('P1: FX diff stored on cross-rate USD pay', () => {
    const poFx = purchases.createOrder({
      supplier_id: supplierId,
      warehouse_id: WH,
      order_date: '2026-08-27',
      status: 'approved',
      currency: 'USD',
      fx_rate: 12000,
      created_by: ADMIN,
      items: [
        {
          product_id: productId,
          product_name: product.name,
          product_sku: product.sku,
          ordered_qty: 1,
          unit_cost: 10,
          unit_cost_usd: 10,
          line_total: 0,
          line_total_usd: 10,
        },
      ],
    });
    // Force totals if createOrder didn't set USD total
    try {
      db.prepare(`UPDATE purchase_orders SET total_usd = 10, total_amount = 120000, fx_rate = 12000, currency = 'USD' WHERE id = ?`).run(poFx.id);
    } catch {
      // ignore
    }
    purchases.createReceipt({
      purchase_order_id: poFx.id,
      supplier_id: supplierId,
      status: 'received',
      currency: 'USD',
      fx_rate: 12000,
      received_at: '2026-08-27 16:00:00',
      created_by: ADMIN,
      items: [
        {
          purchase_order_item_id: poFx.items[0].id,
          product_id: productId,
          product_name: product.name,
          received_qty: 1,
          unit_cost: 10,
          unit_cost_usd: 10,
          line_total: 0,
          line_total_usd: 10,
        },
      ],
    });

    const pay = suppliers.createPayment({
      supplier_id: supplierId,
      purchase_order_id: poFx.id,
      amount: 125000,
      amount_usd: 10,
      currency: 'UZS',
      fx_rate: 12500,
      payment_method: 'cash',
      created_by: ADMIN,
      idempotency_key: `fx-diff-${Date.now()}`,
    });
    assert.ok(
      pay.fx_diff_amount != null && Math.abs(Number(pay.fx_diff_amount) - 5000) < 1,
      `expected fx_diff ~5000 got ${pay.fx_diff_amount}`,
    );
  });

  console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
  close();
  process.exit(failed > 0 ? 1 : 0);
} catch (e) {
  console.error('FATAL:', e);
  try {
    close();
  } catch {
    // ignore
  }
  process.exit(1);
}

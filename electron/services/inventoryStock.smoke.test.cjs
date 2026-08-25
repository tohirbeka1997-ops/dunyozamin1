/* eslint-disable no-console */
/**
 * inventoryStock.smoke.test.cjs
 * Ombor: kirim (adjustment), sotuv (completePOSOrder), qaytarish (createReturn),
 * balans ↔ stock_moves ↔ inventory_movements mosligi, 2-kassa (oxirgi dona) konflikti.
 *
 * Ishga tushirish: npm run test:inventory-smoke
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const WH = 'main-warehouse-001';
const ADMIN = 'default-admin-001';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-inv-smoke-'));
process.env.POS_SERVER_MODE = '1';
process.env.POS_DATA_DIR = tmpDir;
process.env.POS_VERBOSE_LOGS = '0';

const { open, close, getDb } = require('../db/open.cjs');
const { createServices } = require('./index.cjs');

function stockOf(inventory, productId) {
  return Number(inventory.getCurrentStock(productId, WH)) || 0;
}

function runConsistencyChecks(db, label) {
  const issues = [];

  const balanceVsIm = db
    .prepare(
      `
    SELECT sb.product_id, sb.quantity AS bal,
           COALESCE((SELECT SUM(im.quantity) FROM inventory_movements im
             WHERE im.product_id = sb.product_id AND im.warehouse_id = sb.warehouse_id), 0) AS im_sum
    FROM stock_balances sb
    WHERE sb.warehouse_id = ?
      AND ABS(sb.quantity - COALESCE((SELECT SUM(im.quantity) FROM inventory_movements im
             WHERE im.product_id = sb.product_id AND im.warehouse_id = sb.warehouse_id), 0)) > 0.001
  `,
    )
    .all(WH);
  if (balanceVsIm.length) {
    issues.push(`${label}: stock_balances vs inventory_movements (${balanceVsIm.length} rows)`);
  }

  const salesNoMove = db
    .prepare(
      `
    SELECT o.id, o.order_number
    FROM orders o
    JOIN order_items oi ON oi.order_id = o.id
    JOIN products p ON p.id = oi.product_id AND p.track_stock = 1
    LEFT JOIN inventory_movements im ON im.reference_type = 'order' AND im.reference_id = o.id AND im.product_id = oi.product_id
    WHERE o.status = 'completed'
    GROUP BY o.id
    HAVING COUNT(im.id) = 0
  `,
    )
    .all();
  if (salesNoMove.length) {
    issues.push(`${label}: completed orders without inventory_movements (${salesNoMove.length})`);
  }

  const signErrors = db
    .prepare(
      `
    SELECT id, movement_type, quantity FROM inventory_movements
    WHERE (movement_type = 'sale' AND quantity > 0)
       OR (movement_type = 'return' AND quantity < 0)
  `,
    )
    .all();
  if (signErrors.length) {
    issues.push(`${label}: movement quantity sign errors (${signErrors.length})`);
  }

  const productDrift = db
    .prepare(
      `
    SELECT p.id, p.current_stock,
           COALESCE((SELECT SUM(sb.quantity) FROM stock_balances sb WHERE sb.product_id = p.id), 0) AS sum_bal
    FROM products p
    WHERE p.track_stock = 1
      AND ABS(COALESCE(p.current_stock, 0) - COALESCE((SELECT SUM(sb.quantity) FROM stock_balances sb WHERE sb.product_id = p.id), 0)) > 0.001
  `,
    )
    .all();
  if (productDrift.length) {
    issues.push(`${label}: products.current_stock vs sum(stock_balances) (${productDrift.length})`);
  }

  return issues;
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
  if (err.stack) console.log(err.stack.split('\n').slice(1, 4).join('\n'));
}

try {
  console.log('\n=== INVENTORY STOCK SMOKE TEST ===');
  console.log(`Temp DB dir: ${tmpDir}\n`);

  open();
  const db = getDb();
  const services = createServices(db);
  const { products, inventory, sales, shifts, returns: returnsSvc } = services;

  const sku = `SMOKE-${Date.now()}`;
  const product = products.create({
    name: 'Smoke Test Product',
    sku,
    sale_price: 1000,
    purchase_price: 500,
    track_stock: 1,
    current_stock: 0,
  });
  const productId = product.id;
  ok('create product');

  inventory.adjustStock({
    warehouse_id: WH,
    reason: 'Smoke test: boshlang\'ich qoldiq',
    adjustment_type: 'set',
    created_by: ADMIN,
    items: [{ product_id: productId, target_quantity: 10 }],
  });
  assert.strictEqual(stockOf(inventory, productId), 10, 'initial stock should be 10');
  ok('kirim (adjustment set) → qoldiq 10');

  let shift = shifts.openShift({ user_id: ADMIN });
  ok('open shift');

  const saleQty = 3;
  const unitPrice = 1000;
  const saleTotal = saleQty * unitPrice;
  const orderResult = sales.completePOSOrder(
    { total_amount: saleTotal, shift_id: shift.id, user_id: ADMIN },
    [
      {
        product_id: productId,
        product_name: product.name,
        quantity: saleQty,
        qty_base: saleQty,
        unit_price: unitPrice,
        line_total: saleTotal,
      },
    ],
    [{ payment_method: 'cash', amount: saleTotal }],
  );
  const orderId = orderResult?.order_id || orderResult?.id || orderResult?.order?.id;
  assert.ok(orderId, 'order id missing');
  assert.strictEqual(stockOf(inventory, productId), 7, 'after sale 3 → stock 7');
  ok('chiqim (sotuv 3 dona) → qoldiq 7');

  inventory.adjustStock({
    warehouse_id: WH,
    reason: 'Smoke test: qo\'shimcha kirim',
    adjustment_type: 'increase',
    created_by: ADMIN,
    items: [{ product_id: productId, quantity: 5 }],
  });
  assert.strictEqual(stockOf(inventory, productId), 12, 'after +5 → stock 12');
  ok('kirim (adjustment +5) → qoldiq 12');

  const orderItem = db
    .prepare('SELECT id, quantity FROM order_items WHERE order_id = ? LIMIT 1')
    .get(orderId);
  assert.ok(orderItem?.id, 'order_item missing');

  returnsSvc.createReturn({
    order_id: orderId,
    return_reason: 'Smoke test return',
    refund_method: 'cash',
    user_id: ADMIN,
    items: [{ order_item_id: orderItem.id, quantity: 1 }],
  });
  assert.strictEqual(stockOf(inventory, productId), 13, 'after return 1 → stock 13');
  ok('kirim (qaytarish 1 dona) → qoldiq 13');

  let insufficient = false;
  try {
    sales.completePOSOrder(
      { total_amount: 13000, shift_id: shift.id, user_id: ADMIN },
      [
        {
          product_id: productId,
          product_name: product.name,
          quantity: 100,
          qty_base: 100,
          unit_price: unitPrice,
          line_total: 13000,
        },
      ],
      [{ payment_method: 'cash', amount: 13000 }],
    );
  } catch (e) {
    insufficient =
      String(e.message || '').includes('Insufficient') ||
      String(e.code || '').includes('INSUFFICIENT');
  }
  assert.ok(insufficient, 'oversell should throw INSUFFICIENT_STOCK');
  assert.strictEqual(stockOf(inventory, productId), 13, 'stock unchanged after failed sale');
  ok('chiqim bloklandi (qoldiq yetarli emas)');

  // 2-kassa: oxirgi 1 dona
  inventory.adjustStock({
    warehouse_id: WH,
    reason: 'Smoke 2-kassa',
    adjustment_type: 'set',
    created_by: ADMIN,
    items: [{ product_id: productId, target_quantity: 1 }],
  });
  const saleA = sales.completePOSOrder(
    { total_amount: unitPrice, shift_id: shift.id, user_id: ADMIN },
    [
      {
        product_id: productId,
        product_name: product.name,
        quantity: 1,
        qty_base: 1,
        unit_price: unitPrice,
        line_total: unitPrice,
      },
    ],
    [{ payment_method: 'cash', amount: unitPrice }],
  );
  assert.ok(saleA?.order_id || saleA?.id || saleA?.order?.id);
  assert.strictEqual(stockOf(inventory, productId), 0);
  let kassa2Blocked = false;
  try {
    sales.completePOSOrder(
      { total_amount: unitPrice, shift_id: shift.id, user_id: ADMIN },
      [
        {
          product_id: productId,
          product_name: product.name,
          quantity: 1,
          qty_base: 1,
          unit_price: unitPrice,
          line_total: unitPrice,
        },
      ],
      [{ payment_method: 'cash', amount: unitPrice }],
    );
  } catch (e2) {
    kassa2Blocked =
      String(e2.message || '').includes('Insufficient') ||
      String(e2.code || '').includes('INSUFFICIENT');
  }
  assert.ok(kassa2Blocked, 'second register should fail on last unit');
  ok('2-kassa: oxirgi dona — 1-sotuv OK, 2-sotuv rad');

  const consistencyIssues = runConsistencyChecks(db, 'final');
  if (consistencyIssues.length) {
    throw new Error(consistencyIssues.join('; '));
  }
  ok('balans ↔ harakatlar ↔ products.current_stock mos');

  console.log(`\n=== NATIJA: ${passed} OK, ${failed} FAIL ===\n`);
  process.exit(failed > 0 ? 1 : 0);
} catch (e) {
  fail('inventory smoke suite', e);
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

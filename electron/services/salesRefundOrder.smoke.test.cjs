/* eslint-disable no-console */
/**
 * salesRefundOrder.smoke.test.cjs
 * AUDIT #5 + #15: salesService.refundOrder() must route through the canonical
 * returns path so that:
 *   - stock is restocked via the inventory ledger (inventory_movements +
 *     stock_balances), NOT a raw stock_balances.quantity poke;
 *   - the customer balance / ledger is reversed for credit orders;
 *   - a double refund is rejected (idempotency / status guard).
 *
 * Ishga tushirish: npm run test:refund-smoke
 *   (electron electron/services/salesRefundOrder.smoke.test.cjs)
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const WH = 'main-warehouse-001';
const ADMIN = 'default-admin-001';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-refund-smoke-'));
process.env.POS_SERVER_MODE = '1';
process.env.POS_DATA_DIR = tmpDir;
process.env.POS_VERBOSE_LOGS = '0';

const { open, close, getDb } = require('../db/open.cjs');
const { createServices } = require('./index.cjs');
const { readBalanceInCurrency } = require('../lib/customerBalance.cjs');

function bal(db, customerId) {
  return readBalanceInCurrency(db, customerId, 'UZS');
}

function stockOf(inventory, productId) {
  return Number(inventory.getCurrentStock(productId, WH)) || 0;
}

function returnMovementsFor(db, productId) {
  return db
    .prepare(
      `SELECT quantity, movement_type, reference_type, reference_id
       FROM inventory_movements
       WHERE product_id = ? AND movement_type = 'return'
       ORDER BY rowid ASC`,
    )
    .all(productId);
}

function cartLine(product, qty, unitPrice = 5000) {
  return {
    product_id: product.id,
    product_name: product.name,
    quantity: qty,
    qty_sale: qty,
    qty_base: qty,
    unit_price: unitPrice,
    line_total: unitPrice * qty,
  };
}

let passed = 0;
let failed = 0;
function ok(name) { passed += 1; console.log(`  ✓ ${name}`); }
function fail(name, err) { failed += 1; console.log(`  ✗ ${name}`); console.log(`     ${err.message || err}`); }

(async function main() {
  console.log('\n=== SALES refundOrder SMOKE TEST ===');
  console.log(`Temp DB: ${tmpDir}\n`);

  try {
    open();
    const db = getDb();
    const { products, inventory, sales, shifts, customers } = createServices(db);

    const product = products.create({
      name: 'Refund Smoke Product',
      sku: `REF-SMOKE-${Date.now()}`,
      sale_price: 5000,
      purchase_price: 2000,
      track_stock: 1,
      current_stock: 0,
    });
    inventory.adjustStock({
      warehouse_id: WH,
      adjustment_type: 'set',
      reason: 'Refund smoke stock',
      created_by: ADMIN,
      items: [{ product_id: product.id, target_quantity: 20 }],
    });

    const customer = customers.create({
      name: 'Refund Smoke Mijoz',
      phone: '+998901239900',
      allow_credit: 1,
      allow_debt: 1,
      credit_limit: 50000000,
    });
    const customerId = customer.id;
    const shift = shifts.openShift({ user_id: ADMIN });
    ok('setup: mahsulot (stok 20), mijoz, smena');

    // --- Credit sale: 3 units @5000 = 15000 fully on credit ---
    const saleRes = sales.completePOSOrder(
      { total_amount: 15000, customer_id: customerId, shift_id: shift.id, user_id: ADMIN },
      [cartLine(product, 3, 5000)],
      [{ payment_method: 'credit', amount: 15000 }],
    );
    const orderId = saleRes.order_id;
    assert.strictEqual(stockOf(inventory, product.id), 17, 'stock 20-3=17 after sale');
    assert.strictEqual(bal(db, customerId), -15000, 'debt -15000 after credit sale');
    ok('nasiya sotuv: stok 17, balans -15000');

    // --- Refund (exercise the historical "non-array input" bug path) ---
    const refundRes = await sales.refundOrder(orderId, 'Qaytarish', ADMIN);
    assert.ok(refundRes?.success, 'refund returns success');
    assert.ok(refundRes?.returnId, 'refund returns returnId (preserved contract)');
    ok('refundOrder: { success, returnId } qaytdi');

    // 1) Stock restocked THROUGH the ledger (inventory_movements), not a raw poke.
    const moves = returnMovementsFor(db, product.id);
    assert.ok(moves.length >= 1, 'a return movement was recorded in inventory_movements');
    const totalReturned = moves.reduce((s, m) => s + Number(m.quantity || 0), 0);
    assert.strictEqual(totalReturned, 3, 'inventory_movements shows +3 returned');
    assert.strictEqual(moves[0].reference_id, refundRes.returnId, 'movement references the return');
    assert.strictEqual(stockOf(inventory, product.id), 20, 'stock back to 20 after refund');
    ok('refund: inventory_movements +3, stok 20 ga qaytdi');

    // 2) Customer balance/ledger reversed.
    assert.strictEqual(bal(db, customerId), 0, 'debt reversed to 0 after refund');
    const refundLedger = db
      .prepare(`SELECT type, amount FROM customer_ledger WHERE customer_id = ? AND type = 'refund' ORDER BY rowid DESC LIMIT 1`)
      .get(customerId);
    assert.ok(refundLedger, 'a refund ledger row exists');
    ok('refund: mijoz balansi 0 ga qaytdi, ledger yozildi');

    // 3) Order marked refunded; sales_return completed.
    const orderRow = db.prepare('SELECT status FROM orders WHERE id = ?').get(orderId);
    assert.strictEqual(orderRow.status, 'refunded', 'order status refunded');
    const srRow = db.prepare('SELECT status FROM sales_returns WHERE id = ?').get(refundRes.returnId);
    assert.strictEqual(String(srRow.status).toLowerCase(), 'completed', 'sales_return completed');
    ok('refund: order=refunded, sales_return=completed');

    // 4) Double refund must be rejected (no double restock / double reversal).
    let rejected = false;
    try {
      await sales.refundOrder(orderId, 'Qaytarish', ADMIN);
    } catch (e) {
      rejected = /already refunded|already cancelled|refund rejected/i.test(String(e.message || e.code || ''));
    }
    assert.ok(rejected, 'second refund of same order is rejected');
    assert.strictEqual(stockOf(inventory, product.id), 20, 'stock unchanged after rejected double refund');
    assert.strictEqual(bal(db, customerId), 0, 'balance unchanged after rejected double refund');
    ok('takroriy refund rad etildi; stok/balans o‘zgarmadi');

    close();
  } catch (e) {
    fail('refundOrder suite', e);
    try { close(); } catch { /* ignore */ }
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }

  console.log(`\n=== NATIJA: ${passed} OK, ${failed} FAIL ===\n`);
  process.exit(failed > 0 ? 1 : 0);
})();

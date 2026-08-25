/* eslint-disable no-console */
/**
 * dailySalesReturnsProfit.smoke.test.cjs
 * Daily sales report: returns must appear in Qaytarilganlar and net profit must be correct.
 *
 * Ishga tushirish: electron electron/services/dailySalesReturnsProfit.smoke.test.cjs
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { formatYmdInTimeZone } = require('../lib/timezone.cjs');
const { calculateNetProfit } = require('../lib/unifiedSalesSql.cjs');

const WH = 'main-warehouse-001';
const ADMIN = 'default-admin-001';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-daily-returns-'));
process.env.POS_SERVER_MODE = '1';
process.env.POS_DATA_DIR = tmpDir;
process.env.POS_VERBOSE_LOGS = '0';

const { open, close, getDb } = require('../db/open.cjs');
const { createServices } = require('./index.cjs');

let passed = 0;
let failed = 0;
function ok(name) {
  passed += 1;
  console.log(`  ✓ ${name}`);
}
function fail(name, err) {
  failed += 1;
  console.log(`  ✗ ${name}`);
  console.log(`     ${err?.message || err}`);
}
function runStep(name, fn) {
  try {
    fn();
    ok(name);
  } catch (e) {
    fail(name, e);
  }
}

function cartLine(product, qty, unitPrice) {
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

(async () => {
  console.log('\n=== DAILY SALES RETURNS PROFIT SMOKE ===\n');
  console.log(`Temp DB: ${tmpDir}\n`);

  try {
    open();
    const db = getDb();
    const { products, inventory, sales, shifts, returns, reports } = createServices(db);

    const today = formatYmdInTimeZone(new Date());
    const filters = { date_from: today, date_to: today, warehouse_id: WH };

    const product = products.create({
      name: 'Daily Returns Profit Product',
      sku: `DRP-${Date.now()}`,
      sale_price: 10000,
      purchase_price: 4000,
      track_stock: 1,
      current_stock: 0,
    });
    inventory.adjustStock({
      warehouse_id: WH,
      adjustment_type: 'set',
      reason: 'Daily returns profit smoke seed',
      created_by: ADMIN,
      items: [{ product_id: product.id, target_quantity: 50 }],
    });

    const shift = shifts.openShift({ user_id: ADMIN });
    const saleTotal = 30000;
    const saleRes = sales.completePOSOrder(
      { total_amount: saleTotal, shift_id: shift.id, user_id: ADMIN, sales_channel: 'pos' },
      [cartLine(product, 3, 10000)],
      [{ payment_method: 'cash', amount: saleTotal }],
    );
    ok(`seed POS sale ${saleTotal}`);

    const orderItem = db
      .prepare(`SELECT id FROM order_items WHERE order_id = ? LIMIT 1`)
      .get(saleRes.order_id);
    assert.ok(orderItem?.id, 'order item exists');

    const returnRes = returns.createReturn({
      order_id: saleRes.order_id,
      return_reason: 'Smoke partial return',
      refund_method: 'cash',
      items: [{ order_item_id: orderItem.id, quantity: 1 }],
      user_id: ADMIN,
      cashier_id: ADMIN,
      warehouse_id: WH,
      shift_id: shift.id,
    });
    assert.ok(returnRes?.id || returnRes?.returnId, 'return created');
    ok('partial return 1 unit');

    const sr = db.prepare(`SELECT total_amount, refund_amount FROM sales_returns ORDER BY created_at DESC LIMIT 1`).get();
    const expectedReturnAmt = Number(sr?.refund_amount ?? sr?.total_amount ?? 0) || 0;
    assert.ok(expectedReturnAmt > 0, `sales_returns amount should be > 0 (${expectedReturnAmt})`);

    const hasLegacy = db
      .prepare(`SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name='sale_returns' LIMIT 1`)
      .get()?.ok;
    const hasModern = db
      .prepare(`SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name='sales_returns' LIMIT 1`)
      .get()?.ok;
    runStep('both return table schemas may coexist', () => {
      assert.ok(hasModern, 'sales_returns should exist');
    });

    runStep('getDailySalesReportSQL shows returns total', () => {
      const report = reports.getDailySalesReportSQL(filters);
      const totalReturns = Number(report?.summary?.total_returns || 0) || 0;
      assert.ok(
        totalReturns >= expectedReturnAmt - 1,
        `total_returns ${totalReturns} expected ~${expectedReturnAmt} (legacy=${hasLegacy}, modern=${hasModern})`,
      );
      assert.ok(Array.isArray(report.returns) && report.returns.length >= 1, 'returns rows missing');
    });

    runStep('net profit stays non-negative for partial return', () => {
      const report = reports.getDailySalesReportSQL(filters);
      const grossProfit = Number(report?.summary?.total_profit || 0) || 0;
      const impact = Number(report?.summary?.returns_profit_impact || 0) || 0;
      const returnsTotal = Number(report?.summary?.total_returns || 0) || 0;
      const returnsCogs = Number(report?.summary?.returns_cogs || 0) || 0;
      const expenses = Number(report?.summary?.total_expenses || 0) || 0;
      const net = Number(report?.summary?.net_profit ?? 0) || 0;
      assert.ok(grossProfit > 0, `grossProfit ${grossProfit}`);
      assert.ok(impact > 0, `returns_profit_impact ${impact}`);
      assert.ok(impact < grossProfit, `impact ${impact} should be less than gross ${grossProfit}`);
      assert.ok(net > 0, `net profit ${net} should be positive`);
      assert.strictEqual(
        net,
        calculateNetProfit({
          grossProfit,
          returnsRevenue: returnsTotal,
          returnsCogs,
          expenses,
          commission: Number(report?.summary?.total_commission || 0) || 0,
        }),
        'net_profit uses unified formula with expenses',
      );
      assert.strictEqual(net, grossProfit - impact - expenses, 'net_profit equals total_profit - returns_profit_impact - expenses');
    });

    // POS savat qaytarish (manfiy jami order) — Qaytarilganlar kartasida, orders ro'yxatida emas
    const cartReturnItems = [
      {
        product_id: product.id,
        product_name: product.name,
        quantity: -1,
        qty_sale: -1,
        qty_base: -1,
        unit_price: 10000,
        line_total: -10000,
      },
    ];
    const cartReturnRes = sales.completePOSOrder(
      { total_amount: -10000, shift_id: shift.id, user_id: ADMIN, sales_channel: 'pos' },
      cartReturnItems,
      [{ payment_method: 'refund_cash', amount: 10000 }],
    );
    assert.ok(cartReturnRes?.order_id, 'POS cart return order created');
    ok('POS cart return (negative order) seeded');

    runStep('negative qty line_profit uses signed COGS after refresh', () => {
      const negRow = db
        .prepare(
          `SELECT id, qty_sale, quantity, cost_price, line_profit, line_total, final_total
           FROM order_items
           WHERE order_id = ? AND COALESCE(qty_sale, quantity, 0) < 0
           LIMIT 1`,
        )
        .get(cartReturnRes.order_id);
      assert.ok(negRow?.id, 'negative qty order_item exists');
      const unitCost = 4000;
      db.prepare(`UPDATE order_items SET cost_price = ? WHERE id = ?`).run(unitCost, negRow.id);
      sales._refreshOrderItemLineProfits(cartReturnRes.order_id);
      const refreshed = db
        .prepare(
          `SELECT qty_sale, quantity, cost_price, line_profit, line_total, final_total
           FROM order_items WHERE id = ?`,
        )
        .get(negRow.id);
      const qty = Number(refreshed.qty_sale ?? refreshed.quantity ?? 0);
      const revenue = Number(refreshed.final_total ?? refreshed.line_total ?? 0);
      const expected = revenue - unitCost * qty;
      const buggy = revenue - unitCost * Math.abs(qty);
      assert.ok(qty < 0, `qty should be negative (${qty})`);
      assert.notStrictEqual(Number(refreshed.line_profit), buggy, 'must not use Math.abs COGS');
      assert.ok(
        Math.abs(Number(refreshed.line_profit) - expected) < 0.02,
        `line_profit ${refreshed.line_profit} expected ${expected}`,
      );
    });

    runStep('POS cart return excluded from orders list, counted in Qaytarilganlar', () => {
      const report = reports.getDailySalesReportSQL(filters);
      const negativeOrdInList = (report.orders || []).some(
        (o) => Number(o.total_amount || 0) < 0 || Number(o.revenue || 0) < 0,
      );
      assert.ok(!negativeOrdInList, 'negative ORD rows should not appear in daily sales orders list');
      const totalReturns = Number(report?.summary?.total_returns || 0) || 0;
      assert.ok(totalReturns >= expectedReturnAmt + 10000 - 1, `total_returns ${totalReturns}`);
      const posCartRows = (report.returns || []).filter((r) => r.return_source === 'pos_cart');
      assert.ok(posCartRows.length >= 1, 'pos_cart return rows should appear in returns section');
    });

    // Almashuv: musbat jami + ichida manfiy qaytarish qatori
    const mixedItems = [
      cartLine(product, 3, 10000),
      {
        product_id: product.id,
        product_name: product.name,
        quantity: -1,
        qty_sale: -1,
        qty_base: -1,
        unit_price: 8000,
        line_total: -8000,
        final_total: -8000,
        is_price_overridden: true,
        price_source: 'manual',
      },
    ];
    const mixedRes = sales.completePOSOrder(
      { total_amount: 22000, shift_id: shift.id, user_id: ADMIN, sales_channel: 'pos' },
      mixedItems,
      [{ payment_method: 'cash', amount: 22000 }],
    );
    assert.ok(mixedRes?.order_id, 'mixed exchange order created');
    ok('mixed POS cart (sale+return lines) seeded');

    const mixedReturnAbs = Math.abs(
      Number(
        db
          .prepare(
            `SELECT COALESCE(SUM(COALESCE(NULLIF(final_total,0), NULLIF(line_total,0), 0)), 0) AS s
             FROM order_items
             WHERE order_id = ? AND COALESCE(qty_sale, quantity, 0) < 0`,
          )
          .get(mixedRes.order_id)?.s || 0,
      ),
    );
    assert.ok(mixedReturnAbs > 0, `mixed return line abs should be > 0 (got ${mixedReturnAbs})`);

    runStep('mixed cart return lines counted in Qaytarilganlar', () => {
      const report = reports.getDailySalesReportSQL(filters);
      const totalReturns = Number(report?.summary?.total_returns || 0) || 0;
      assert.ok(
        totalReturns >= expectedReturnAmt + 10000 + mixedReturnAbs - 1,
        `total_returns ${totalReturns} expected >= ${expectedReturnAmt + 10000 + mixedReturnAbs}`,
      );
      const lineRows = (report.returns || []).filter((r) => r.return_source === 'pos_cart_line');
      assert.ok(lineRows.length >= 1, `pos_cart_line rows missing; got returns=${JSON.stringify(report.returns)}`);
      assert.ok(
        lineRows.some((r) => Math.abs(Number(r.total_amount || 0) - mixedReturnAbs) < 1),
        `mixed return line amount ${mixedReturnAbs} missing; lineRows=${JSON.stringify(lineRows)}`,
      );
      const mixedOrd = (report.orders || []).find((o) => o.id === mixedRes.order_id);
      assert.ok(mixedOrd, 'mixed order should remain in sales list');
      const expectedSaleRev = 30000;
      assert.ok(
        Math.abs(Number(mixedOrd.revenue || 0) - expectedSaleRev) < 1,
        `mixed order sale revenue should be ${expectedSaleRev} (gross), got ${mixedOrd.revenue}`,
      );
      const net = Number(report?.summary?.net_profit ?? 0) || 0;
      const gross = Number(report?.summary?.total_profit || 0) || 0;
      const impact = Number(report?.summary?.returns_profit_impact || 0) || 0;
      const returnsTotal = Number(report?.summary?.total_returns || 0) || 0;
      const returnsCogs = Number(report?.summary?.returns_cogs || 0) || 0;
      const expenses = Number(report?.summary?.total_expenses || 0) || 0;
      assert.strictEqual(
        net,
        calculateNetProfit({
          grossProfit: gross,
          returnsRevenue: returnsTotal,
          returnsCogs,
          expenses,
          commission: Number(report?.summary?.total_commission || 0) || 0,
        }),
        'net_profit uses unified formula',
      );
      assert.strictEqual(net, gross - impact - expenses, 'net_profit = total_profit - returns_profit_impact - expenses');
    });

    close();
  } catch (e) {
    console.error(e);
    failed += 1;
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})();

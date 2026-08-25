/* eslint-disable no-console */
/**
 * dailySalesDiscountProfit.smoke.test.cjs
 * Profit must use post-discount sold price, not catalog unit_price.
 *
 * Ishga tushirish: node electron/services/dailySalesDiscountProfit.smoke.test.cjs
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { formatYmdInTimeZone } = require('../lib/timezone.cjs');

const WH = 'main-warehouse-001';
const ADMIN = 'default-admin-001';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-discount-profit-'));
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

(async () => {
  console.log('\n=== DAILY SALES DISCOUNT PROFIT SMOKE ===\n');

  try {
    open();
    const db = getDb();
    const { products, inventory, sales, shifts, reports } = createServices(db);

    const catalogPrice = 2_195_000;
    const soldPrice = 2_000_000;
    const unitCost = 1_996_000;
    const expectedProfit = soldPrice - unitCost;

    const product = products.create({
      name: 'Discount Profit Product',
      sku: `DPP-${Date.now()}`,
      sale_price: catalogPrice,
      purchase_price: unitCost,
      track_stock: 1,
      current_stock: 0,
    });
    inventory.adjustStock({
      warehouse_id: WH,
      adjustment_type: 'set',
      reason: 'Discount profit smoke seed',
      created_by: ADMIN,
      items: [{ product_id: product.id, target_quantity: 10 }],
    });

    const shift = shifts.openShift({ user_id: ADMIN });
    const saleRes = sales.completePOSOrder(
      { total_amount: soldPrice, shift_id: shift.id, user_id: ADMIN, sales_channel: 'pos' },
      [
        {
          product_id: product.id,
          product_name: product.name,
          quantity: 1,
          qty_sale: 1,
          qty_base: 1,
          unit_price: catalogPrice,
          discount_amount: catalogPrice - soldPrice,
          line_total: soldPrice,
          final_unit_price: soldPrice,
          final_total: soldPrice,
        },
      ],
      [{ payment_method: 'cash', amount: soldPrice }],
    );

    const row = db
      .prepare(
        `SELECT unit_price, line_total, final_total, cost_price, line_profit
         FROM order_items WHERE order_id = ? LIMIT 1`,
      )
      .get(saleRes.order_id);
    assert.ok(row, 'order item row');
    ok(`seed sale ORD with discount (${soldPrice} sold)`);

    runStep('order item stores post-discount line_total and line_profit', () => {
      assert.strictEqual(Number(row.line_total), soldPrice, 'line_total');
      assert.strictEqual(Number(row.final_total), soldPrice, 'final_total');
      assert.strictEqual(Number(row.line_profit), expectedProfit, 'line_profit');
    });

    const today = formatYmdInTimeZone(new Date());
    runStep('daily sales report profit matches post-discount formula', () => {
      const report = reports.getDailySalesReportSQL({
        date_from: today,
        date_to: today,
        warehouse_id: WH,
      });
      const order = (report.orders || []).find((o) => o.id === saleRes.order_id);
      assert.ok(order, 'order in daily report');
      const profit = Number(order.profit || 0);
      assert.strictEqual(profit, expectedProfit, `profit ${profit} expected ${expectedProfit}`);
      const totalProfit = Number(report?.summary?.total_profit || 0);
      assert.strictEqual(totalProfit, expectedProfit, 'Jami foyda equals row profit');
    });

    runStep('non-discounted sale profit unchanged', () => {
      const fullRes = sales.completePOSOrder(
        { total_amount: catalogPrice, shift_id: shift.id, user_id: ADMIN, sales_channel: 'pos' },
        [
          {
            product_id: product.id,
            product_name: product.name,
            quantity: 1,
            qty_sale: 1,
            qty_base: 1,
            unit_price: catalogPrice,
            line_total: catalogPrice,
            final_unit_price: catalogPrice,
            final_total: catalogPrice,
          },
        ],
        [{ payment_method: 'cash', amount: catalogPrice }],
      );
      const report = reports.getDailySalesReportSQL({
        date_from: today,
        date_to: today,
        warehouse_id: WH,
      });
      const order = (report.orders || []).find((o) => o.id === fullRes.order_id);
      assert.ok(order, 'full-price order in report');
      const profit = Number(order.profit || 0);
      assert.strictEqual(profit, catalogPrice - unitCost, 'full price profit');
    });

    const expectedFullProfit = catalogPrice - unitCost;
    const expectedTotalProfit = expectedProfit + expectedFullProfit;

    runStep('cashier performance uses post-discount profit', () => {
      const rows = reports.getCashierPerformance({ date_from: today, date_to: today });
      const row = rows.find((r) => r.employee_id === ADMIN);
      assert.ok(row, 'cashier row');
      const expectedTotalProfit = expectedProfit + (catalogPrice - unitCost);
      assert.strictEqual(Number(row.total_profit), expectedTotalProfit, 'cashier total_profit');
    });

    runStep('product sales report uses post-discount revenue', () => {
      const expectedTotalProfit = expectedProfit + (catalogPrice - unitCost);
      const rows = reports.getProductSalesReport({
        date_from: today,
        date_to: today,
        warehouse_id: WH,
      });
      const row = rows.find((r) => r.product_id === product.id);
      assert.ok(row, 'product row');
      assert.strictEqual(Number(row.revenue), soldPrice + catalogPrice, 'product revenue');
      assert.strictEqual(Number(row.profit), expectedTotalProfit, 'product profit');
    });

    runStep('order-level discount is allocated onto final_total and line_profit', () => {
      const orderDisc = 100_000;
      const lineGross = catalogPrice;
      const expectedNet = lineGross - orderDisc;
      const expectedLineProfit = expectedNet - unitCost;
      const res = sales.completePOSOrder(
        {
          total_amount: expectedNet,
          discount_amount: orderDisc,
          shift_id: shift.id,
          user_id: ADMIN,
          sales_channel: 'pos',
        },
        [
          {
            product_id: product.id,
            product_name: product.name,
            quantity: 1,
            qty_sale: 1,
            qty_base: 1,
            unit_price: catalogPrice,
            line_total: catalogPrice,
          },
        ],
        [{ payment_method: 'cash', amount: expectedNet }],
      );
      const item = db
        .prepare(`SELECT final_total, line_total, line_profit FROM order_items WHERE order_id = ?`)
        .get(res.order_id);
      assert.ok(Math.abs(Number(item.final_total) - expectedNet) < 0.02, 'final_total after order discount');
      assert.ok(Math.abs(Number(item.line_profit) - expectedLineProfit) < 0.02, 'line_profit after order discount');
      const pl = reports.getDailySalesReportSQL({ date_from: today, date_to: today, warehouse_id: WH });
      const order = (pl.orders || []).find((o) => o.id === res.order_id);
      assert.ok(order, 'order-level discount sale in daily report');
      assert.ok(Math.abs(Number(order.profit) - expectedLineProfit) < 0.02, 'daily profit uses allocated revenue');
    });

    const usdFx = 12500;
    const usdUnit = 8;
    const usdUzs = usdUnit * usdFx;
    const usdProfit = usdUzs - unitCost;
    sales.completePOSOrder(
      {
        total_amount: usdUnit,
        currency: 'USD',
        fx_rate: usdFx,
        shift_id: shift.id,
        user_id: ADMIN,
        sales_channel: 'pos',
      },
      [
        {
          product_id: product.id,
          product_name: product.name,
          quantity: 1,
          qty_sale: 1,
          qty_base: 1,
          unit_price: usdUnit,
          line_total: usdUnit,
          final_total: usdUnit,
        },
      ],
      [{ payment_method: 'cash', amount: usdUzs, currency: 'UZS' }],
    );
    ok(`seed USD sale ${usdUnit} @ ${usdFx}`);

    runStep('daily sales and cashier convert USD via fx_rate', () => {
      const daily = reports.getDailySales(today, WH);
      assert.ok(Number(daily.total_sales) >= usdUzs + soldPrice + catalogPrice - 1, `daily total_sales ${daily.total_sales}`);
      const report = reports.getDailySalesReportSQL({ date_from: today, date_to: today, warehouse_id: WH });
      const usdOrder = (report.orders || []).find((o) => Number(o.total_amount) === usdUnit || Number(o.revenue) === usdUzs);
      assert.ok(usdOrder, 'USD order in daily SQL report');
      assert.ok(Math.abs(Number(usdOrder.revenue) - usdUzs) < 1, `USD revenue ${usdOrder.revenue} != ${usdUzs}`);
      assert.ok(Math.abs(Number(usdOrder.profit) - usdProfit) < 1, `USD profit ${usdOrder.profit}`);
      const cashiers = reports.getCashierPerformance({ date_from: today, date_to: today, warehouse_id: WH });
      const cashier = cashiers.find((r) => r.employee_id === ADMIN);
      assert.ok(cashier, 'cashier row after USD');
      assert.ok(Number(cashier.total_revenue) >= usdUzs - 1, `cashier revenue ${cashier.total_revenue}`);
      assert.ok(Number(cashier.total_profit) >= usdProfit - 1, `cashier profit ${cashier.total_profit}`);
    });

    close();
  } catch (e) {
    console.error(e);
    failed += 1;
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})();

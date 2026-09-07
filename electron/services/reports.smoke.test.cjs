/* eslint-disable no-console */
/**
 * reports.smoke.test.cjs — barcha asosiy hisobot RPC metodlari (ReportsService).
 * Avval test savdo yaratiladi, keyin har bir hisobot chaqiriladi.
 *
 * Ishga tushirish: npm run test:reports-smoke
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { formatYmdInTimeZone } = require('../lib/timezone.cjs');

const WH = 'main-warehouse-001';
const ADMIN = 'default-admin-001';
const CUSTOMER = 'default-customer-001';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-reports-smoke-'));
process.env.POS_SERVER_MODE = '1';
process.env.POS_DATA_DIR = tmpDir;
process.env.POS_VERBOSE_LOGS = '0';

const { open, close, getDb } = require('../db/open.cjs');
const { createServices } = require('./index.cjs');

let passed = 0;
let failed = 0;
const failures = [];

function ok(name) {
  passed += 1;
  console.log(`  ✓ ${name}`);
}

function fail(name, err) {
  failed += 1;
  failures.push({ name, message: err?.message || String(err) });
  console.log(`  ✗ ${name}`);
  console.log(`     ${err?.message || err}`);
}

function assertDefined(result, label) {
  assert.notStrictEqual(result, undefined, `${label}: undefined`);
  assert.notStrictEqual(result, null, `${label}: null`);
}

function assertArray(result, label) {
  assertDefined(result, label);
  assert.ok(Array.isArray(result), `${label}: array emas`);
}

function assertObject(result, label) {
  assertDefined(result, label);
  assert.ok(typeof result === 'object' && !Array.isArray(result), `${label}: object emas`);
}

function runSync(name, fn, validate) {
  try {
    const result = fn();
    if (validate) validate(result);
    else assertDefined(result, name);
    ok(name);
  } catch (e) {
    fail(name, e);
  }
}

async function runAsync(name, fn, validate) {
  try {
    const result = await fn();
    if (validate) validate(result);
    else assertDefined(result, name);
    ok(name);
  } catch (e) {
    fail(name, e);
  }
}

(async () => {
  try {
    console.log('\n=== REPORTS SMOKE TEST ===');
    console.log(`Temp DB: ${tmpDir}\n`);

    open();
    const db = getDb();
    const { products, inventory, sales, shifts, reports, suppliers, customers } = createServices(db);

    let customerId =
      db.prepare('SELECT id FROM customers WHERE id = ?').get(CUSTOMER)?.id ||
      db.prepare('SELECT id FROM customers LIMIT 1').get()?.id;
    if (!customerId && customers?.create) {
      const c = customers.create({
        name: 'Reports Smoke Customer',
        phone: '+998901112233',
        type: 'individual',
      });
      customerId = c?.id;
    }
    if (!customerId) {
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO customers (id, name, phone, type, status, created_at, updated_at)
         VALUES (?, 'Yuruvchi mijoz', '998000000000', 'individual', 'active', ?, ?)`,
      ).run(CUSTOMER, now, now);
      customerId = CUSTOMER;
    }

    const today = formatYmdInTimeZone(new Date());
    const monthAgo = formatYmdInTimeZone(new Date(Date.now() - 30 * 86400000));
    const filters = { date_from: monthAgo, date_to: today, warehouse_id: WH };
    const filtersToday = { date_from: today, date_to: today, warehouse_id: WH };

    const product = products.create({
      name: 'Reports Smoke Product',
      sku: `RPT-${Date.now()}`,
      sale_price: 1000,
      track_stock: 1,
      current_stock: 0,
    });
    inventory.adjustStock({
      warehouse_id: WH,
      adjustment_type: 'set',
      reason: 'Reports smoke seed',
      created_by: ADMIN,
      items: [{ product_id: product.id, target_quantity: 20 }],
    });

    let supplierId = db.prepare('SELECT id FROM suppliers LIMIT 1').get()?.id;
    if (!supplierId && suppliers?.create) {
      const sup = suppliers.create({
        name: 'Reports Smoke Supplier',
        phone: '+998900000000',
        status: 'active',
      });
      supplierId = sup?.id || sup?.supplier?.id;
    }

    const shift = shifts.openShift({ user_id: ADMIN });
    const saleTotal = 3000;
    sales.completePOSOrder(
      { total_amount: saleTotal, shift_id: shift.id, user_id: ADMIN, customer_id: customerId },
      [
        {
          product_id: product.id,
          product_name: product.name,
          quantity: 3,
          qty_sale: 3,
          qty_base: 3,
          unit_price: 1000,
          line_total: saleTotal,
        },
      ],
      [{ payment_method: 'cash', amount: saleTotal }],
    );
    ok(`seed: savdo ${saleTotal} (${today})`);

    const creditCustomer = customers.create({
      name: 'Debt Ops Smoke Customer',
      phone: `+99890${String(Date.now()).slice(-7)}`,
      type: 'individual',
      allow_credit: 1,
      allow_debt: 1,
      credit_limit: 50000000,
    });
    const creditAmt = 1000;
    sales.completePOSOrder(
      {
        total_amount: creditAmt,
        shift_id: shift.id,
        user_id: ADMIN,
        customer_id: creditCustomer.id,
      },
      [
        {
          product_id: product.id,
          product_name: product.name,
          quantity: 1,
          qty_sale: 1,
          qty_base: 1,
          unit_price: creditAmt,
          line_total: creditAmt,
        },
      ],
      [{ payment_method: 'credit', amount: creditAmt }],
    );
    const debtPayAmt = 600;
    customers.receivePayment({
      customer_id: creditCustomer.id,
      amount: debtPayAmt,
      payment_method: 'cash',
      received_by: ADMIN,
      operation: 'payment_in',
      source: 'test',
    });
    ok(`seed: nasiya ${creditAmt} + qarz to‘lovi ${debtPayAmt}`);

    // --- Savdo ---
    runSync('dailySales', () => reports.getDailySales(today, WH), (r) => {
      assertObject(r, 'dailySales');
      assert.ok(Number(r.order_count) >= 1, 'order_count >= 1');
      assert.ok(Number(r.total_sales) >= saleTotal - 1, 'total_sales mos');
      assert.ok(Number.isFinite(Number(r.net_profit)), 'net_profit present');
    });
    runSync('dailySalesSQL', () => reports.getDailySalesReportSQL(filtersToday));
    runSync('dailySalesSummary', () => reports.getDailySalesSummary(filters), assertObject);
    runSync('customerDebtOperations', () => reports.getCustomerDebtOperations(filtersToday), (r) => {
      assertObject(r, 'customerDebtOperations');
      assertArray(r.rows, 'customerDebtOperations.rows');
      assertObject(r.summary, 'customerDebtOperations.summary');
      assert.ok(Number(r.summary.credit_issued) >= creditAmt - 1, 'credit_issued includes nasiya');
      assert.ok(Number(r.summary.debt_collected) >= debtPayAmt - 1, 'debt_collected includes receivePayment');
      const creditRow = r.rows.find((x) => String(x.kind) === 'credit_sale');
      const payRow = r.rows.find((x) => String(x.kind) === 'debt_payment');
      assert.ok(creditRow, 'nasiya savdo qatori');
      assert.ok(payRow, 'qarz to‘lovi qatori');
      assert.ok(String(payRow.customer_name || '').includes('Debt Ops'), 'customer name on payment');
    });
    runSync('topProducts', () => reports.getTopProducts({ ...filters, limit: 5 }), assertArray);
    runSync('productSales', () => reports.getProductSalesReport(filters), assertArray);
    runSync('customerSalesReport', () => reports.getCustomerSalesReport(filters), assertArray);
    runSync('promotionUsage', () => reports.getPromotionUsageReport(filters), assertArray);
    runSync('returnsReport', () => reports.getReturnsReport(filters), assertArray);
    runSync('paymentMethodsSummary', () => reports.getPaymentMethodsSummary(filters), (r) => {
      assertObject(r, 'paymentMethodsSummary');
    });
    runSync('bankCashReconciliation', () => reports.getBankCashReconciliation(filters), (r) => {
      assertObject(r, 'bankCashReconciliation');
      assert.ok(r.cash && r.bank, 'cash/bank buckets');
    });

    // --- Ombor ---
    runSync('stock', () => reports.getStockReport(WH), (r) => {
      assertArray(r, 'stock');
      const row = r.find((x) => x.product_id === product.id);
      assert.ok(row, 'seed mahsulot stock ro\'yxatida');
    });
    runSync('inventoryValuation', () => reports.getInventoryValuation({ warehouse_id: WH }), assertArray);
    runSync('inventoryValuationSummary', () => reports.getInventoryValuationSummary({ warehouse_id: WH }), assertObject);
    runSync('inventoryValuationReport', () => reports.getInventoryValuationReport({ warehouse_id: WH }), (r) => {
      assertObject(r, 'inventoryValuationReport');
      assert.ok(Array.isArray(r.rows), 'rows');
    });
    runSync('purchasePlanning', () => reports.getPurchasePlanning({ plan_days: 7, analysis_days: 7 }), (r) => {
      assertObject(r, 'purchasePlanning');
      assert.ok(Array.isArray(r.rows), 'purchasePlanning.rows');
      assert.ok(r.totals && typeof r.totals === 'object', 'purchasePlanning.totals');
      assert.ok(r.meta && typeof r.meta === 'object', 'purchasePlanning.meta');
    });
    runSync('abcAnalysis', () => reports.getAbcAnalysis(filters), (r) => {
      assertObject(r, 'abcAnalysis');
      assert.ok(Array.isArray(r.rows), 'abcAnalysis.rows');
      assert.ok(r.summary && typeof r.summary === 'object', 'abcAnalysis.summary');
      assert.ok(r.thresholds && r.thresholds.a === 80 && r.thresholds.b === 95, 'abc thresholds');
    });
    runSync('latestPurchaseCosts', () => reports.getLatestPurchaseCosts(), (r) => {
      assert.ok(r != null && typeof r === 'object', 'latestPurchaseCosts object/map');
    });
    runSync('actSverka', () => reports.getActSverka({}), assertArray);
    runSync('productTraceability', () => reports.getProductTraceability({ product_id: product.id, ...filters }), assertArray);

    // --- Moliya ---
    runSync('profitEstimate', () => reports.getProfitEstimate(filters), assertObject);
    runSync('profitAndLossSQL', () => reports.getProfitAndLossSQL(filters), (r) => {
      assertObject(r, 'profitAndLossSQL');
    });
    runSync('cashFlow', () => reports.getCashFlow(filters), (r) => {
      assertObject(r, 'cashFlow');
      assert.ok(Array.isArray(r.rows), 'cashFlow.rows');
      assert.ok(Array.isArray(r.by_source), 'cashFlow.by_source');
    });
    runSync('cashDiscrepancies', () => reports.getCashDiscrepancies(filters), assertArray);
    runSync('aging', () => reports.getAging({ as_of_date: today }), assertObject);
    runSync('purchaseSaleSpread', () => reports.getPurchaseSaleSpread(filters), assertArray);
    runSync('purchaseVsSold', () => reports.getPurchaseVsSold(filters), (r) => {
      assertObject(r, 'purchaseVsSold');
      assert.ok(Array.isArray(r.rows), 'rows');
    });
    runSync('spreadTimeSeries', () => reports.getSpreadTimeSeries(filters), assertArray);

    // --- Mijoz / CRM ---
    runSync('customerAging', () => reports.getCustomerAging(), assertArray);
    runSync('supplierAging', () => reports.getSupplierAging(), assertArray);
    runSync('vipCustomers', () => reports.getVIPCustomers(filters), assertArray);
    runSync('loyaltyPointsSummary', () => reports.getLoyaltyPointsSummary(filters), assertObject);
    runSync('lostCustomers', () => reports.getLostCustomers(filters), assertArray);
    runSync('customerProfitability', () => reports.getCustomerProfitability(filters), assertArray);
    runSync('customerActSverka', () =>
      reports.getCustomerActSverka({ customer_id: customerId, ...filters }), (r) => {
        assertObject(r, 'customerActSverka');
      });

    // --- Yetkazib beruvchi ---
    runSync('deliveryAccuracy', () => reports.getDeliveryAccuracy(filters), assertArray);
    runSync('deliveryDetails', () => reports.getDeliveryDetails(filters), assertArray);
    runSync('priceHistory', () => reports.getPriceHistory(filters), assertArray);
    runSync('productPriceSummary', () => reports.getProductPriceSummary(filters), assertArray);
    runSync('supplierProductSales', () => reports.getSupplierProductSales(filters), assertArray);
    if (supplierId) {
      runSync('supplierActSverka', () =>
        reports.getSupplierActSverka({ supplier_id: supplierId, ...filters }), (r) => {
          assertObject(r, 'supplierActSverka');
        });
    } else {
      console.log('  ⊘ supplierActSverka (supplier yo‘q, o‘tkazildi)');
    }

    // --- Xodim / operatsiya ---
    runSync('cashierPerformance', () => reports.getCashierPerformance(filters), assertArray);
    runSync('cashierErrors', () => reports.getCashierErrors(filters), assertArray);
    runSync('cashierErrorDetails', () => reports.getCashierErrorDetails(filters), assertArray);
    runSync('shiftProductivity', () => reports.getShiftProductivity(filters), assertArray);
    runSync('productivitySummary', () => reports.getProductivitySummary(filters), assertArray);
    runSync('fraudSignals', () => reports.getFraudSignals(filters), assertArray);
    runSync('fraudIncidents', () => reports.getFraudIncidents(filters), assertArray);

    // --- Tizim ---
    await runAsync('deviceHealth', () => reports.getDeviceHealth(), (r) => {
      assert.ok(r == null || Array.isArray(r) || typeof r === 'object', 'deviceHealth');
    });
    await runAsync('deviceIncidents', () => reports.getDeviceIncidents(), assertArray);
    runSync('auditLog', () => reports.getAuditLog(filters), assertArray);
    runSync('priceChangeHistory', () => reports.getPriceChangeHistory(filters), assertArray);

    // --- Boshqaruv ---
    runSync('executiveKPI', () => reports.getExecutiveKPI(filters), assertObject);
    runSync('executiveTrends', () => reports.getExecutiveTrends(filters), assertArray);

    // --- Akt-sverka / tarix ---
    runSync('batchReconciliation', () => reports.getBatchReconciliation(filters), assertArray);
    runSync('productActSverkaByPeriod', () =>
      reports.getProductActSverkaByPeriod({ product_id: product.id, ...filters }), (r) => {
        assertObject(r, 'productActSverkaByPeriod');
        assert.ok(Array.isArray(r.rows), 'rows array');
      });
    runSync('productDocumentHistory', () =>
      reports.getProductDocumentHistory({ product_id: product.id, ...filters }), (r) => {
        assertObject(r, 'productDocumentHistory');
        assert.ok(Array.isArray(r.rows), 'rows array');
      });

    console.log(`\n=== NATIJA: ${passed} OK, ${failed} FAIL ===`);
    if (failures.length) {
      console.log('\nXatolar:');
      for (const f of failures) console.log(`  - ${f.name}: ${f.message}`);
    }
    console.log('');
    process.exit(failed > 0 ? 1 : 0);
  } catch (e) {
    fail('reports smoke suite', e);
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
})();

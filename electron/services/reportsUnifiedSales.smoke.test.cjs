/* eslint-disable no-console */
/**
 * reportsUnifiedSales.smoke.test.cjs
 * Unified POS + online sales in financial reports and dashboard.
 *
 * Ishga tushirish: npm run test:reports-unified-smoke
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { formatYmdInTimeZone } = require('../lib/timezone.cjs');
const { calculateNetProfit } = require('../lib/unifiedSalesSql.cjs');
const { randomUUID } = require('crypto');
const { setCurrentUserId } = require('../lib/currentUser.cjs');

const WH = 'main-warehouse-001';
const ADMIN = 'default-admin-001';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-reports-unified-'));
process.env.POS_SERVER_MODE = '1';
process.env.POS_DATA_DIR = tmpDir;
process.env.POS_VERBOSE_LOGS = '0';

const { open, close, getDb } = require('../db/open.cjs');
const { createServices } = require('./index.cjs');
const WebOrdersService = require('./webOrdersService.cjs');
const { createOrder, parseCreateBody } = require('../../public-api/routes/orders.cjs');

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

function seedMarketplaceCustomer(db) {
  const now = new Date().toISOString();
  const r = db
    .prepare(
      `INSERT INTO marketplace_customers (telegram_id, first_name, phone, created_at)
       VALUES (?, ?, ?, ?)`,
    )
    .run(880001 + Math.floor(Math.random() * 100000), 'Reports', '+998901119900', now);
  return Number(r.lastInsertRowid);
}

(async () => {
  console.log('\n=== REPORTS UNIFIED SALES SMOKE ===\n');
  console.log(`Temp DB: ${tmpDir}\n`);

  try {
    open();
    const db = getDb();
    setCurrentUserId(ADMIN);
    try {
      const role = db.prepare(`SELECT id FROM roles WHERE code = 'admin' LIMIT 1`).get();
      if (role) {
        const has = db.prepare(`SELECT 1 AS ok FROM user_roles WHERE user_id = ? AND role_id = ?`).get(ADMIN, role.id);
        if (!has) {
          db.prepare(
            `INSERT INTO user_roles (id, user_id, role_id, assigned_at) VALUES (?, ?, ?, datetime('now'))`
          ).run(randomUUID(), ADMIN, role.id);
        }
      }
    } catch {
      /* best-effort */
    }
    const { products, inventory, sales, shifts, reports, dashboard, customers } = createServices(db);
    const webOrders = new WebOrdersService(db);

    const views = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='view' AND name LIKE 'v_unified%'`)
      .all()
      .map((r) => r.name);
    runStep('unified views exist', () => {
      assert(views.includes('v_unified_sales'), 'missing v_unified_sales');
      assert(views.includes('v_unified_sale_items'), 'missing v_unified_sale_items');
    });

    const today = formatYmdInTimeZone(new Date());
    const filters = { date_from: today, date_to: today, warehouse_id: WH };

    const product = products.create({
      name: 'Unified Reports Product',
      sku: `UNI-RPT-${Date.now()}`,
      sale_price: 10000,
      purchase_price: 4000,
      track_stock: 1,
      current_stock: 0,
    });
    inventory.adjustStock({
      warehouse_id: WH,
      adjustment_type: 'set',
      reason: 'Unified reports smoke seed',
      created_by: ADMIN,
      items: [{ product_id: product.id, target_quantity: 50 }],
    });

    const shift = shifts.openShift({ user_id: ADMIN });
    const posTotal = 20000;
    sales.completePOSOrder(
      { total_amount: posTotal, shift_id: shift.id, user_id: ADMIN, sales_channel: 'pos' },
      [
        {
          product_id: product.id,
          product_name: product.name,
          quantity: 2,
          qty_sale: 2,
          qty_base: 2,
          unit_price: 10000,
          line_total: posTotal,
        },
      ],
      [{ payment_method: 'cash', amount: posTotal }],
    );
    ok(`seed POS sale ${posTotal}`);

    runStep('POS sale freezes cost_price on order_items', () => {
      const oi = db
        .prepare(`SELECT cost_price FROM order_items WHERE product_id = ? ORDER BY created_at DESC LIMIT 1`)
        .get(product.id);
      assert.ok(Number(oi?.cost_price) > 0, `cost_price should be frozen (${oi?.cost_price})`);
    });

    runStep('Dashboard net_profit matches unified formula', () => {
      const analytics = dashboard.getAnalytics(filters);
      const expected = calculateNetProfit({
        grossProfit: analytics.total_profit,
        returnsRevenue: analytics.returns_amount,
        returnsCogs: analytics.returns_cogs,
        expenses: analytics.total_expenses,
        commission: analytics.total_commission,
      });
      assert.strictEqual(Number(analytics.net_profit), expected, 'dashboard net_profit formula');
    });

    const customerId = seedMarketplaceCustomer(db);
    const webQty = 3;
    const webUnit = 10000;
    const webTotal = webQty * webUnit;
    const body = parseCreateBody({
      items: [{ product_id: product.id, quantity: webQty }],
      payment_method: 'cash',
      delivery_method: 'pickup',
      delivery_address: "O'zi olib ketish",
      phone: '+998901119900',
      note: 'unified reports smoke',
    });
    const created = createOrder(db, customerId, body);
    const webOrderId = Number(created.order_id);
    db.prepare(`UPDATE web_orders SET sales_channel = 'telegram' WHERE id = ?`).run(webOrderId);

    webOrders.updateStatus(webOrderId, 'processing');
    webOrders.updateStatus(webOrderId, 'ready');
    webOrders.updateStatus(webOrderId, 'delivered');
    ok(`seed web order delivered ${webTotal}`);

    const webRow = db.prepare(`SELECT total_amount, status FROM web_orders WHERE id = ?`).get(webOrderId);
    assert.strictEqual(String(webRow.status).toLowerCase(), 'delivered');

    db.exec(`
      CREATE TABLE IF NOT EXISTS marketplace_promo_codes (
        code TEXT PRIMARY KEY,
        discount_pct INTEGER NULL,
        discount_amount INTEGER NULL,
        min_subtotal INTEGER NOT NULL DEFAULT 0,
        active INTEGER NOT NULL DEFAULT 1,
        valid_until TEXT NULL
      )
    `);
    db.prepare(
      `INSERT OR REPLACE INTO marketplace_promo_codes (code, discount_pct, min_subtotal, active)
       VALUES ('UNI10', 10, 0, 1)`,
    ).run();
    const discQty = 2;
    const discGross = discQty * webUnit;
    const discBody = parseCreateBody({
      items: [{ product_id: product.id, quantity: discQty }],
      payment_method: 'cash',
      delivery_method: 'pickup',
      delivery_address: "O'zi olib ketish",
      phone: '+998901119900',
      promo_code: 'UNI10',
      note: 'unified discount smoke',
    });
    const discCreated = createOrder(db, customerId, discBody);
    const discOrderId = Number(discCreated.order_id);
    const discNet = Number(discCreated.total_amount);
    const discAmt = Number(discCreated.discount_amount);
    db.prepare(`UPDATE web_orders SET sales_channel = 'telegram' WHERE id = ?`).run(discOrderId);
    webOrders.updateStatus(discOrderId, 'processing');
    webOrders.updateStatus(discOrderId, 'ready');
    webOrders.updateStatus(discOrderId, 'delivered');
    ok(`seed discounted web order net ${discNet} (gross ${discGross} disc ${discAmt})`);

    runStep('createOrder persists allocated web line discount', () => {
      assert.ok(discAmt > 0, `expected promo discount, got ${discAmt}`);
      assert.strictEqual(discNet, discGross - discAmt);
      const lines = db
        .prepare(`SELECT final_total, discount_amount FROM web_order_items WHERE order_id = ?`)
        .all(discOrderId);
      const lineSum = lines.reduce((s, r) => s + Number(r.final_total || 0), 0);
      const lineDisc = lines.reduce((s, r) => s + Number(r.discount_amount || 0), 0);
      assert.ok(Math.abs(lineSum - discNet) < 1, `persisted line sum ${lineSum} != net ${discNet}`);
      assert.ok(Math.abs(lineDisc - discAmt) < 1, `persisted line disc ${lineDisc} != ${discAmt}`);
    });

    runStep('v_unified_sale_items web lines match order total_amount after discount', () => {
      const header = db
        .prepare(`SELECT total_amount FROM v_unified_sales WHERE sale_source = 'web' AND source_id = ?`)
        .get(String(discOrderId));
      const items = db
        .prepare(
          `SELECT COALESCE(SUM(final_total), 0) AS line_sum FROM v_unified_sale_items
           WHERE sale_source = 'web' AND source_order_id = ?`,
        )
        .get(String(discOrderId));
      assert.ok(header, 'discounted web order missing from v_unified_sales');
      assert.strictEqual(Number(header.total_amount), discNet);
      assert.ok(
        Math.abs(Number(items.line_sum) - discNet) < 1,
        `line sum ${items.line_sum} exceeds/mismatches total ${discNet}`,
      );
    });

    const legacyGross = 20000;
    const legacyDisc = 5000;
    const legacyNet = legacyGross - legacyDisc;
    const nowIso = new Date().toISOString();
    const legacyIns = db
      .prepare(
        `INSERT INTO web_orders (order_number, customer_id, status, payment_method, payment_status, total_amount, discount_amount, sales_channel, created_at, updated_at)
         VALUES (?, ?, 'delivered', 'cash', 'paid', ?, ?, 'telegram', ?, ?)`,
      )
      .run(`LEGACY-DISC-${Date.now()}`, customerId, legacyNet, legacyDisc, nowIso, nowIso);
    const legacyOrderId = Number(legacyIns.lastInsertRowid);
    db.prepare(
      `INSERT INTO web_order_items (order_id, product_id, quantity, price_at_order)
       VALUES (?, ?, 2, ?)`,
    ).run(legacyOrderId, product.id, webUnit);
    runStep('unified view allocates discount when web line finals are NULL (legacy)', () => {
      const items = db
        .prepare(
          `SELECT COALESCE(SUM(final_total), 0) AS line_sum FROM v_unified_sale_items
           WHERE sale_source = 'web' AND source_order_id = ?`,
        )
        .get(String(legacyOrderId));
      assert.ok(
        Math.abs(Number(items.line_sum) - legacyNet) < 1,
        `legacy SQL allocation ${items.line_sum} != ${legacyNet}`,
      );
    });

    runStep('P&L web promo uses net lines not gross', () => {
      const pl = reports.getProfitAndLossSQL({ ...filters, sales_channel: 'telegram' });
      const gross = Number(pl.summary?.gross_revenue ?? pl.summary?.revenue ?? 0);
      const net = Number(pl.summary?.net_revenue ?? pl.summary?.net_sales ?? 0);
      const discounts = Number(pl.summary?.discounts ?? 0);
      const telegramNet = webTotal + discNet + legacyNet;
      const telegramGross = webTotal + discGross + legacyGross;
      assert.ok(gross >= telegramGross - 1, `telegram brutto ${gross}`);
      assert.ok(net >= telegramNet - 1, `telegram sof tushum ${net}`);
      assert.ok(net < telegramGross - 100, `telegram sof still using undiscounted lines (${net})`);
      assert.ok(discounts >= telegramGross - telegramNet - 1, `telegram chegirma ${discounts}`);
    });

    runStep('DailySales includes POS + web revenue', () => {
      const daily = reports.getDailySales(today, WH);
      const expectedMin = posTotal + webTotal - 1;
      assert.ok(Number(daily.total_sales) >= expectedMin, `total_sales ${daily.total_sales} < ${expectedMin}`);
      assert.ok(Number(daily.order_count) >= 2, 'order_count should include both channels');
    });

    runStep('ProfitLoss includes online revenue and profit', () => {
      const pl = reports.getProfitAndLossSQL(filters);
      const revenue = Number(pl.summary?.revenue ?? pl.revenue ?? 0);
      const grossProfit = Number(pl.summary?.gross_profit ?? pl.gross_profit ?? 0);
      assert.ok(revenue >= posTotal + webTotal - 1, `P&L revenue missing web (${revenue})`);
      assert.ok(grossProfit > 0, 'gross_profit should be positive');
    });

    runStep('Dashboard analytics includes unified sales', () => {
      const analytics = dashboard.getAnalytics(filters);
      assert.ok(Number(analytics.total_sales) >= posTotal + webTotal - 1, 'dashboard total_sales');
      assert.ok(Number(analytics.total_orders) >= 2, 'dashboard total_orders');
      assert.ok(Number(analytics.total_profit) > 0, 'dashboard total_profit');
    });

    runStep('channel filter telegram excludes POS', () => {
      const telegramOnly = reports.getProfitAndLossSQL({ ...filters, sales_channel: 'telegram' });
      const posOnly = reports.getProfitAndLossSQL({ ...filters, sales_channel: 'pos' });
      const telegramRevenue = Number(telegramOnly.summary?.revenue ?? telegramOnly.revenue ?? 0);
      const posRevenue = Number(posOnly.summary?.revenue ?? posOnly.revenue ?? 0);
      assert.ok(telegramRevenue >= webTotal + discNet + legacyNet - 1, `telegram filter revenue (${telegramRevenue})`);
      assert.ok(posRevenue >= posTotal - 1, `pos filter revenue (${posRevenue})`);
      assert.ok(telegramRevenue < posTotal + webTotal + discNet + legacyNet, 'telegram should exclude POS');
      assert.ok(posRevenue < posTotal + webTotal, 'pos should exclude web');
    });

    runStep('product sales report lists unified product qty', () => {
      const rows = reports.getProductSalesReport(filters);
      const row = rows.find((r) => r.product_id === product.id);
      assert.ok(row, 'product row missing');
      assert.ok(Number(row.quantity_sold) >= 5, `qty sold ${row.quantity_sold}`);
      assert.ok(Number(row.revenue) >= posTotal + webTotal - 1, 'product revenue');
    });

    runStep('executive KPI includes web orders', () => {
      const kpi = reports.getExecutiveKPI({ period: 'day' });
      assert.ok(Number(kpi.revenue) >= posTotal + webTotal - 1, 'executive revenue');
      assert.ok(Number(kpi.orders_count) >= 2, 'executive orders_count');
    });

    // --- Credit (nasiya) sale: must appear in unified view, dashboard, reports, shift ---
    const creditCustomer = customers.create({
      name: 'Credit Smoke Customer',
      phone: '+998901112233',
      allow_credit: 1,
      allow_debt: 1,
      credit_limit: 50000000,
    });
    const creditTotal = 10000;
    const creditRes = sales.completePOSOrder(
      {
        total_amount: creditTotal,
        customer_id: creditCustomer.id,
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
          unit_price: creditTotal,
          line_total: creditTotal,
        },
      ],
      [{ payment_method: 'credit', amount: creditTotal }],
    );
    ok(`seed credit sale ${creditTotal}`);

    const creditOrder = db
      .prepare(`SELECT payment_status, credit_amount, total_amount FROM orders WHERE id = ?`)
      .get(creditRes.order_id);
    runStep('credit order has on_credit status', () => {
      assert.strictEqual(String(creditOrder.payment_status).toLowerCase(), 'on_credit');
      assert.strictEqual(Number(creditOrder.credit_amount), creditTotal);
    });

    runStep('v_unified_sales includes on_credit order', () => {
      const row = db
        .prepare(`SELECT total_amount FROM v_unified_sales WHERE source_id = ? AND sale_source = 'pos'`)
        .get(creditRes.order_id);
      assert.ok(row, 'credit sale missing from v_unified_sales');
      assert.strictEqual(Number(row.total_amount), Number(creditOrder.total_amount));
    });

    const webCollected = webTotal + discNet + legacyNet;
    const expectedAllMin = posTotal + webCollected + creditTotal - 1;

    runStep('Dashboard analytics includes credit in total_sales', () => {
      const analytics = dashboard.getAnalytics(filters);
      assert.ok(Number(analytics.total_sales) >= expectedAllMin, `total_sales ${analytics.total_sales}`);
      assert.ok(Number(analytics.credit_issued) >= creditTotal - 1, `credit_issued ${analytics.credit_issued}`);
      assert.ok(Number(analytics.total_collected) >= posTotal + webCollected - 1, 'total_collected');
      assert.ok(Number(analytics.total_collected) < expectedAllMin, 'collected should exclude full credit');
    });

    runStep('DailySales includes credit sale turnover', () => {
      const daily = reports.getDailySales(today, WH);
      assert.ok(Number(daily.total_sales) >= expectedAllMin, `daily total_sales ${daily.total_sales}`);
      assert.ok(Number(daily.order_count) >= 3, 'order_count includes credit');
    });

    runStep('ProfitLoss includes credit sale revenue', () => {
      const pl = reports.getProfitAndLossSQL(filters);
      const revenue = Number(pl.summary?.revenue ?? pl.revenue ?? 0);
      assert.ok(revenue >= expectedAllMin, `P&L revenue missing credit (${revenue})`);
    });

    runStep('Shift summary shows nasiya line', () => {
      const summary = shifts.getShiftSummary(shift.id);
      assert.ok(Number(summary.creditDebtIssued) >= creditTotal - 1, 'creditDebtIssued');
      assert.ok(Number(summary.salesGross) >= posTotal + creditTotal - 1, 'salesGross turnover');
      assert.ok(Number(summary.totalSales) <= Number(summary.salesGross), 'tushum <= aylanma');
      assert.strictEqual(Number(summary.expectedCash), Number(summary.openingCash) + Number(summary.cashSales));
    });

    const usdFx = 12500;
    const usdUnit = 8;
    const profitBeforeUsd = Number(dashboard.getAnalytics(filters).total_profit || 0);
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
      [{ payment_method: 'cash', amount: usdUnit * usdFx, currency: 'UZS' }],
    );
    ok(`seed USD sale ${usdUnit} @ ${usdFx}`);

    runStep('Dashboard USD line revenue converts via fx_rate', () => {
      const analytics = dashboard.getAnalytics(filters);
      const expectedUzs = usdUnit * usdFx;
      const cogs = Number(product.purchase_price || 4000);
      assert.ok(
        Number(analytics.total_sales) >= posTotal + webTotal + creditTotal + expectedUzs - 1,
        `dashboard total_sales should include USD×fx (${analytics.total_sales})`,
      );
      const profitDelta = Number(analytics.total_profit) - profitBeforeUsd;
      assert.ok(
        profitDelta >= expectedUzs - cogs - 1,
        `sold_revenue must convert USD via fx_rate (profit delta ${profitDelta}, expected >= ${expectedUzs - cogs})`,
      );
      assert.ok(
        profitDelta < expectedUzs,
        'USD sale profit should not treat raw USD as UZS without subtracting COGS',
      );
    });

    runStep('cancelled paid web order is excluded from v_unified_sales', () => {
      const nowIso = new Date().toISOString();
      const ins = db
        .prepare(
          `INSERT INTO web_orders (order_number, customer_id, status, payment_method, payment_status, total_amount, sales_channel, created_at, updated_at)
           VALUES (?, ?, 'cancelled', 'payme', 'paid', 7777, 'telegram', ?, ?)`,
        )
        .run(`WEB-CANCEL-PAID-${Date.now()}`, customerId, nowIso, nowIso);
      const cancelPaidId = Number(ins.lastInsertRowid);
      db.prepare(`INSERT INTO web_order_items (order_id, product_id, quantity, price_at_order) VALUES (?, ?, 1, 7777)`).run(
        cancelPaidId,
        product.id,
      );
      const unified = db
        .prepare(`SELECT unified_id FROM v_unified_sales WHERE sale_source = 'web' AND source_id = ?`)
        .get(String(cancelPaidId));
      const items = db
        .prepare(`SELECT unified_item_id FROM v_unified_sale_items WHERE sale_source = 'web' AND source_order_id = ?`)
        .get(String(cancelPaidId));
      assert.ok(!unified, 'cancelled+paid web order must not stay in v_unified_sales');
      assert.ok(!items, 'cancelled+paid web lines must not stay in v_unified_sale_items');
    });

    runStep('refunded web order is excluded from v_unified_sales', () => {
      const nowIso = new Date().toISOString();
      const ins = db
        .prepare(
          `INSERT INTO web_orders (order_number, customer_id, status, payment_method, payment_status, total_amount, sales_channel, created_at, updated_at)
           VALUES (?, ?, 'cancelled', 'payme', 'refunded', 8888, 'telegram', ?, ?)`,
        )
        .run(`WEB-REFUND-${Date.now()}`, customerId, nowIso, nowIso);
      const refundId = Number(ins.lastInsertRowid);
      db.prepare(`INSERT INTO web_order_items (order_id, product_id, quantity, price_at_order) VALUES (?, ?, 1, 8888)`).run(
        refundId,
        product.id,
      );
      const unified = db
        .prepare(`SELECT unified_id FROM v_unified_sales WHERE sale_source = 'web' AND source_id = ?`)
        .get(String(refundId));
      assert.ok(!unified, 'refunded web order must not appear in v_unified_sales');
    });

    runStep('cancelled+refunded Click web order is excluded from v_unified_sales', () => {
      const nowIso = new Date().toISOString();
      const ins = db
        .prepare(
          `INSERT INTO web_orders (order_number, customer_id, status, payment_method, payment_status, total_amount, sales_channel, created_at, updated_at)
           VALUES (?, ?, 'cancelled', 'click', 'refunded', 6666, 'telegram', ?, ?)`,
        )
        .run(`WEB-CLICK-REFUND-${Date.now()}`, customerId, nowIso, nowIso);
      const clickRefundId = Number(ins.lastInsertRowid);
      db.prepare(`INSERT INTO web_order_items (order_id, product_id, quantity, price_at_order) VALUES (?, ?, 1, 6666)`).run(
        clickRefundId,
        product.id,
      );
      const unified = db
        .prepare(`SELECT unified_id FROM v_unified_sales WHERE sale_source = 'web' AND source_id = ?`)
        .get(String(clickRefundId));
      assert.ok(!unified, 'cancelled+refunded Click web order must not appear in v_unified_sales');
    });

    close();
  } catch (e) {
    console.error(e);
    failed += 1;
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})();

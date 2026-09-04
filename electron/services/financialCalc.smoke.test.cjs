/* eslint-disable no-console */
/**
 * Moliyaviy akt-sverka / P&L / pul oqimi TZ smoke.
 * Ishga tushirish: npm run test:financial-calc-smoke
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { randomUUID } = require('crypto');
const { formatYmdInTimeZone } = require('../lib/timezone.cjs');

const WH = 'main-warehouse-001';
const ADMIN = 'default-admin-001';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-financial-tz-'));
process.env.POS_SERVER_MODE = '1';
process.env.POS_DATA_DIR = tmpDir;
process.env.POS_VERBOSE_LOGS = '0';

const { open, close, getDb } = require('../db/open.cjs');
const { createServices } = require('./index.cjs');
const { setCurrentUserId } = require('../lib/currentUser.cjs');

function cartLine(product, qtySale, unitPrice, extras = {}) {
  const discount = Number(extras.discount_amount || 0);
  const lineTotal = unitPrice * qtySale - discount;
  return {
    product_id: product.id,
    product_name: product.name,
    quantity: qtySale,
    qty_sale: qtySale,
    qty_base: qtySale,
    unit_price: unitPrice,
    discount_amount: discount,
    line_total: lineTotal,
    final_unit_price: qtySale ? lineTotal / qtySale : unitPrice,
    final_total: lineTotal,
  };
}

function enableBatchMode(db, batches) {
  db.prepare(
    `INSERT INTO settings (id, key, value, type, category, is_public, created_at, updated_at)
     VALUES (lower(hex(randomblob(16))), 'inventory.batch_mode_enabled', '1', 'boolean', 'inventory', 0, datetime('now'), datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value='1', updated_at=datetime('now')`
  ).run();
  db.prepare(
    `INSERT INTO settings (id, key, value, type, category, is_public, created_at, updated_at)
     VALUES (lower(hex(randomblob(16))), 'inventory.batch_cutover_at', '2000-01-01 00:00:00', 'string', 'inventory', 0, datetime('now'), datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')`
  ).run();
  assert.ok(batches.isBatchModeEnabled(), 'batch mode should be enabled');
}

function receive(purchases, suppliers, product, qty, unitCost, tag) {
  const supplier = suppliers.create({
    name: `Fin Sup ${tag}-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
    phone: `+99890${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`,
    settlement_currency: 'UZS',
  });
  const po = purchases.createOrder({
    supplier_id: supplier.id,
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
        ordered_qty: qty,
        unit_cost: unitCost,
        line_total: qty * unitCost,
      },
    ],
  });
  purchases.createReceipt({
    purchase_order_id: po.id,
    supplier_id: supplier.id,
    status: 'received',
    currency: 'UZS',
    received_at: '2026-09-03 12:00:00',
    created_by: ADMIN,
    items: [
      {
        purchase_order_item_id: po.items[0].id,
        product_id: product.id,
        product_name: product.name,
        received_qty: qty,
        unit_cost: unitCost,
        line_total: qty * unitCost,
      },
    ],
  });
  return { supplier, po };
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

console.log('\n=== FINANCIAL CALC / P&L TZ SMOKE ===');
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
  const {
    products,
    inventory,
    sales,
    shifts,
    reports,
    dashboard,
    batches,
    purchases,
    suppliers,
    customers,
    expenses,
    returns,
  } = createServices(db);

  const today = formatYmdInTimeZone(new Date());
  const filters = { date_from: today, date_to: today, warehouse_id: WH };
  const shift = shifts.openShift({ user_id: ADMIN, opening_cash: 100000 });

  const formulaProduct = products.create({
    name: 'Financial TZ formula',
    sku: `FIN-F-${Date.now()}`,
    sale_price: 1289000,
    purchase_price: 1053496,
    track_stock: 1,
    current_stock: 0,
    unit: 'pcs',
  });
  inventory.adjustStock({
    warehouse_id: WH,
    adjustment_type: 'set',
    reason: 'financial tz formula stock',
    created_by: ADMIN,
    items: [{ product_id: formulaProduct.id, target_quantity: 20 }],
  });

  sales.completePOSOrder(
    { total_amount: 1264000, shift_id: shift.id, user_id: ADMIN, sales_channel: 'pos' },
    [cartLine(formulaProduct, 1, 1289000, { discount_amount: 25000 })],
    [{ payment_method: 'cash', amount: 1264000 }],
  );

  runStep('1. Chegirmali naqd sotuv — TZ formula', () => {
    const pl = reports.getProfitAndLossSQL(filters);
    const s = pl.summary;
    assert.strictEqual(Number(s.gross_revenue), 1289000, `brutto ${s.gross_revenue}`);
    assert.strictEqual(Number(s.discounts), 25000, `chegirma ${s.discounts}`);
    assert.strictEqual(Number(s.returns_revenue), 0, 'qaytarish');
    assert.strictEqual(Number(s.net_revenue), 1264000, `sof ${s.net_revenue}`);
    assert.strictEqual(Number(s.cogs), 1053496, `cogs ${s.cogs}`);
    assert.strictEqual(Number(s.gross_profit), 210504, `yalpi ${s.gross_profit}`);
    assert.strictEqual(Number(s.net_sales), 1264000, 'sof sotuv = sof tushum');
  });

  const nasiyaProduct = products.create({
    name: 'Financial TZ nasiya',
    sku: `FIN-N-${Date.now()}`,
    sale_price: 110000,
    purchase_price: 70000,
    track_stock: 1,
    current_stock: 0,
    unit: 'pcs',
  });
  inventory.adjustStock({
    warehouse_id: WH,
    adjustment_type: 'set',
    reason: 'financial tz nasiya stock',
    created_by: ADMIN,
    items: [{ product_id: nasiyaProduct.id, target_quantity: 10 }],
  });
  const debtor = customers.create({
    name: 'Fin TZ Debt',
    phone: '+998901239101',
    allow_credit: 1,
    allow_debt: 1,
    credit_limit: 50_000_000,
  });
  sales.completePOSOrder(
    {
      total_amount: 100000,
      customer_id: debtor.id,
      shift_id: shift.id,
      user_id: ADMIN,
      sales_channel: 'pos',
    },
    [cartLine(nasiyaProduct, 1, 110000, { discount_amount: 10000 })],
    [],
  );

  runStep('2. Chegirmali nasiya sotuv P&L ga kiradi', () => {
    const pl = reports.getProfitAndLossSQL(filters);
    assert.strictEqual(Number(pl.summary.gross_revenue), 1289000 + 110000);
    assert.strictEqual(Number(pl.summary.discounts), 25000 + 10000);
    assert.strictEqual(Number(pl.summary.net_revenue), 1264000 + 100000);
  });

  const retSale = sales.completePOSOrder(
    { total_amount: 50000, shift_id: shift.id, user_id: ADMIN, sales_channel: 'pos' },
    [cartLine(formulaProduct, 1, 50000)],
    [{ payment_method: 'cash', amount: 50000 }],
  );
  const retItem = db.prepare('SELECT id FROM order_items WHERE order_id = ?').get(retSale.order_id);
  const draft = returns.createReturn({
    order_id: retSale.order_id,
    cashier_id: ADMIN,
    user_id: ADMIN,
    return_reason: 'financial tz return',
    refund_method: 'cash',
    shift_id: shift.id,
    items: [
      {
        order_item_id: retItem.id,
        product_id: formulaProduct.id,
        quantity: 1,
        unit_price: 50000,
        line_total: 50000,
      },
    ],
  });
  try {
    returns.approveReturn(draft.id, { user_id: ADMIN, approval_reason: 'tz' });
  } catch {
    /* cashier may auto-complete */
  }
  try {
    if (String(draft.status).toLowerCase() !== 'completed') {
      returns.completeReturn(draft.id, { user_id: ADMIN });
    }
  } catch {
    /* already completed */
  }

  runStep('3. Sotuv qaytarishi sof tushum va COGS ni kamaytiradi', () => {
    const pl = reports.getProfitAndLossSQL(filters);
    assert.ok(Number(pl.summary.returns_revenue) >= 50000 - 1, `returns ${pl.summary.returns_revenue}`);
    assert.strictEqual(
      Number(pl.summary.net_revenue),
      Number(pl.summary.gross_revenue) - Number(pl.summary.discounts) - Number(pl.summary.returns_revenue),
    );
    assert.strictEqual(
      Number(pl.summary.gross_profit),
      Number(pl.summary.net_revenue) - Number(pl.summary.cogs),
    );
  });

  enableBatchMode(db, batches);
  const fifoProduct = products.create({
    name: 'Financial TZ FIFO',
    sku: `FIN-FIFO-${Date.now()}`,
    sale_price: 5000,
    purchase_price: 999,
    track_stock: 1,
    current_stock: 0,
    unit: 'pcs',
  });
  receive(purchases, suppliers, fifoProduct, 1, 1000, 'a');
  receive(purchases, suppliers, fifoProduct, 1, 2000, 'b');
  const fifoSale = sales.completePOSOrder(
    { total_amount: 10000, shift_id: shift.id, user_id: ADMIN, sales_channel: 'pos' },
    [cartLine(fifoProduct, 2, 5000)],
    [{ payment_method: 'cash', amount: 10000 }],
  );
  const fifoItem = db.prepare('SELECT id, cost_price FROM order_items WHERE order_id = ?').get(fifoSale.order_id);
  const allocCogs = db
    .prepare(
      `SELECT COALESCE(SUM(quantity * unit_cost), 0) AS cogs
       FROM inventory_batch_allocations
       WHERE reference_type = 'order_item' AND reference_id = ? AND direction = 'out'`
    )
    .get(fifoItem.id);

  runStep('4. FIFO ikki partiya COGS allocation yig‘indisiga teng', () => {
    const distinctCosts = db
      .prepare(
        `SELECT COUNT(DISTINCT unit_cost) AS n
         FROM inventory_batch_allocations
         WHERE reference_type = 'order_item' AND reference_id = ? AND direction = 'out'`
      )
      .get(fifoItem.id);
    assert.ok(Number(distinctCosts.n) >= 2, `ikki partiya ${distinctCosts.n}`);
    assert.strictEqual(Number(allocCogs.cogs), 1000 + 2000, `alloc ${allocCogs.cogs}`);
    const pl = reports.getProfitAndLossSQL(filters);
    assert.ok(Number(pl.summary.cogs) >= Number(allocCogs.cogs), 'P&L includes FIFO COGS');
    const act = reports.getFinancialActSverka(filters);
    assert.strictEqual(Number(act.pnl.cogs), Number(pl.summary.cogs));
  });

  const oldCogs = reports.getProfitAndLossSQL(filters).summary.cogs;
  products.update(fifoProduct.id, { purchase_price: 777 });
  runStep('4b. Katalog tannarxini tahrirlash yopilgan savdo COGS ini o‘zgartirmaydi', () => {
    const pl = reports.getProfitAndLossSQL(filters);
    assert.strictEqual(Number(pl.summary.cogs), Number(oldCogs));
  });

  runStep('5. Mijoz to‘lovi va qarz pul oqimida alohida', () => {
    customers.receivePayment({
      customer_id: debtor.id,
      amount: 30000,
      payment_method: 'cash',
      operation: 'payment_in',
      received_by: ADMIN,
      shift_id: shift.id,
      payment_uuid: randomUUID(),
    });
    customers.receivePayment({
      customer_id: debtor.id,
      amount: 15000,
      payment_method: 'cash',
      operation: 'payment_out',
      payment_out_kind: 'lend',
      lend_authorized: true,
      notes: 'TZ qarz berish',
      received_by: ADMIN,
      shift_id: shift.id,
      payment_uuid: randomUUID(),
    });
    const advCustomer = customers.create({
      name: 'Fin TZ Advance',
      phone: '+998901239103',
      allow_credit: 1,
      credit_limit: 50_000_000,
    });
    customers.receivePayment({
      customer_id: advCustomer.id,
      amount: 5000,
      payment_method: 'cash',
      operation: 'payment_in',
      received_by: ADMIN,
      shift_id: shift.id,
      payment_uuid: randomUUID(),
    });
    const flow = reports.getCashFlow(filters);
    const sources = Object.fromEntries((flow.by_source || []).map((r) => [r.source, r]));
    assert.ok(Number(sources.customer_payments?.inflow || 0) >= 30000 - 1, 'mijoz to‘lovi');
    assert.ok(Number(sources.customer_advances?.inflow || 0) >= 5000 - 1, 'mijoz avansi');
    assert.ok(Number(sources.customer_loans?.outflow || 0) >= 15000 - 1, 'qarz chiqimi');
  });

  runStep('6. Yetkazib beruvchi to‘lov va qaytish alohida', () => {
    const sup = suppliers.create({
      name: 'Fin TZ Supplier Pay',
      phone: '+998901239102',
      settlement_currency: 'UZS',
    });
    suppliers.createPayment({
      supplier_id: sup.id,
      amount: 8000,
      payment_method: 'cash',
      created_by: ADMIN,
      accept_as_advance: true,
    });
    suppliers.createPayment({
      supplier_id: sup.id,
      amount: -3000,
      payment_method: 'cash',
      created_by: ADMIN,
    });
    const flow = reports.getCashFlow(filters);
    const sources = Object.fromEntries((flow.by_source || []).map((r) => [r.source, r]));
    assert.ok(Number(sources.supplier_payments?.outflow || 0) >= 8000 - 1, 'supplier pay');
    assert.ok(Number(sources.supplier_refunds?.inflow || 0) >= 3000 - 1, 'supplier refund');
  });

  runStep('7. Tasdiqlangan xarajat sof foydadan ayiriladi', () => {
    let cat = db.prepare(`SELECT id FROM expense_categories LIMIT 1`).get();
    if (!cat) {
      cat = expenses.createCategory({ code: 'FIN-TZ', name: 'Financial TZ' });
    }
    expenses.create({
      category_id: cat.id,
      amount: 12000,
      payment_method: 'cash',
      expense_date: today,
      description: 'financial tz expense',
      status: 'approved',
      created_by: ADMIN,
      shift_id: shift.id,
    });
    const pl = reports.getProfitAndLossSQL(filters);
    assert.ok(Number(pl.summary.expenses) >= 12000 - 1, `exp ${pl.summary.expenses}`);
    assert.strictEqual(
      Number(pl.summary.net_profit),
      Number(pl.summary.gross_profit) - Number(pl.summary.expenses),
    );
  });

  runStep('8. Ochiq smenada actual closing 0 emas', () => {
    const beforeClose = shifts.getShiftSummary(shift.id);
    assert.strictEqual(beforeClose.actualClosingCash, null);
    assert.ok(beforeClose.closingIsProvisional);
    assert.ok(Number(beforeClose.expectedCash) > 100000, `expected ${beforeClose.expectedCash}`);
  });

  runStep('8b. Smena yopilganda farq 0', () => {
    const beforeClose = shifts.getShiftSummary(shift.id);
    const closed = shifts.closeShift(shift.id, {
      closing_cash: Number(beforeClose.expectedCash),
      notes: 'tz close',
    });
    const diff = Number(closed.cash_difference ?? closed.cashDifference ?? 0);
    assert.ok(Math.abs(diff) < 1, `diff ${diff}`);
    const flow = reports.getCashFlow(filters);
    assert.ok(flow.reconciliation);
    assert.ok(flow.reconciliation.closing_is_provisional === false);
  });

  runStep('9. Akt-sverka, P&L, dashboard bir xil', () => {
    const pl = reports.getProfitAndLossSQL(filters);
    const act = reports.getFinancialActSverka(filters);
    const dash = dashboard.getAnalytics(filters);
    assert.strictEqual(Number(act.pnl.net_revenue), Number(pl.summary.net_revenue));
    assert.strictEqual(Number(act.pnl.cogs), Number(pl.summary.cogs));
    assert.strictEqual(Number(act.pnl.gross_profit), Number(pl.summary.gross_profit));
    assert.strictEqual(Number(act.pnl.net_profit), Number(pl.summary.net_profit));
    assert.strictEqual(Number(dash.net_sales), Number(pl.summary.net_revenue));
    assert.strictEqual(Number(dash.total_cogs), Number(pl.summary.cogs));
    assert.strictEqual(Number(dash.net_profit), Number(pl.summary.net_profit));
    assert.strictEqual(Number(dash.gross_revenue ?? dash.total_sales), Number(pl.summary.gross_revenue));
    const lineNet = (act.lines || []).find((l) => l.key === 'net_revenue');
    assert.strictEqual(Number(lineNet.amount), Number(pl.summary.net_revenue));
  });

  runStep('10. Eksport P&L payload ekran bilan bir xil', () => {
    const pl = reports.getProfitAndLossSQL(filters);
    const s = pl.summary;
    assert.strictEqual(Number(s.net_sales), Number(s.net_revenue));
    assert.ok(s.cogs_source);
    assert.ok(pl.meta?.data_version);
    assert.ok(pl.meta?.timezone);
  });
} catch (e) {
  fail('setup', e);
} finally {
  try {
    close();
  } catch {
    /* ignore */
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

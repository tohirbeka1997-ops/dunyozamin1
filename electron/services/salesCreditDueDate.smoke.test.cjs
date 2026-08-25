/* eslint-disable no-console */
/**
 * Nasiya due_date capture smoke test:
 *   - completePOSOrder with due_date=today persists orders.due_date
 *   - Cash sale leaves due_date NULL
 *   - runCreditReminderTick finds due_today order
 *
 * Ishga tushirish: npm run test:credit-due-smoke
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const WH = 'main-warehouse-001';
const ADMIN = 'default-admin-001';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-credit-due-smoke-'));
process.env.POS_SERVER_MODE = '1';
process.env.POS_DATA_DIR = tmpDir;
process.env.POS_VERBOSE_LOGS = '0';
process.env.SMS_PROVIDER = 'off';
process.env.TELEGRAM_BOT_TOKEN = '';

const { open, close, getDb } = require('../db/open.cjs');
const { createServices } = require('./index.cjs');
const {
  findOrdersForReminder,
  runCreditReminderTick,
  listUnreadStaffCreditAlerts,
} = require('../../public-api/lib/creditReminder.cjs');

function cartLine(product, qtySale, unitPrice = 1000) {
  const lineTotal = unitPrice * qtySale;
  return {
    product_id: product.id,
    product_name: product.name,
    quantity: qtySale,
    qty_sale: qtySale,
    qty_base: qtySale,
    unit_price: unitPrice,
    line_total: lineTotal,
    discount_amount: 0,
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
  console.log(`     ${err && err.message ? err.message : err}`);
}

(async () => {
  try {
    console.log('\n=== CREDIT DUE DATE SMOKE TEST ===');
    console.log(`Temp DB: ${tmpDir}\n`);

    open();
    const db = getDb();
    const services = createServices(db);
    const { sales, shifts, products, inventory } = services;

    const product = products.create({
      name: 'Credit Due Smoke Product',
      sku: `CR-DUE-${Date.now()}`,
      sale_price: 5000,
      purchase_price: 2000,
      track_stock: 1,
      current_stock: 0,
    });
    inventory.adjustStock({
      warehouse_id: WH,
      adjustment_type: 'set',
      reason: 'Credit due smoke stock',
      created_by: ADMIN,
      items: [{ product_id: product.id, target_quantity: 50 }],
    });

    const customerId = 'cust-due-smoke-1';
    db.prepare(
      `INSERT OR IGNORE INTO customers (id, name, phone, type, status, balance, credit_limit, allow_debt, allow_credit, created_at, updated_at)
       VALUES (?, 'Due Smoke Customer', '+998901234567', 'individual', 'active', 0, 50000000, 1, 1, datetime('now'), datetime('now'))`,
    ).run(customerId);

    const shift = shifts.openShift({ user_id: ADMIN });
    const today = db.prepare(`SELECT date('now', 'localtime') AS d`).get().d;

    const creditRes = sales.completePOSOrder(
      {
        total_amount: 5000,
        customer_id: customerId,
        shift_id: shift.id,
        user_id: ADMIN,
        due_date: today,
        credit_reminder_note: 'Telefon qilib eslatish',
      },
      [cartLine(product, 1, 5000)],
      [],
    );

    const creditRow = db
      .prepare(`SELECT payment_status, credit_amount, due_date, credit_reminder_note FROM orders WHERE id = ?`)
      .get(creditRes.order_id);
    assert.strictEqual(String(creditRow.payment_status), 'on_credit');
    assert.strictEqual(Number(creditRow.credit_amount), 5000);
    assert.strictEqual(String(creditRow.due_date).slice(0, 10), today);
    assert.strictEqual(String(creditRow.credit_reminder_note), 'Telefon qilib eslatish');
    ok('nasiya sotuv due_date + credit_reminder_note saqlanadi');

    const found = findOrdersForReminder(db, 'due_today', today);
    assert.ok(found.some((o) => o.id === creditRes.order_id));
    ok('findOrdersForReminder due_today topadi');

    const cashCustomerId = 'cust-due-smoke-cash';
    db.prepare(
      `INSERT OR IGNORE INTO customers (id, name, phone, type, status, balance, created_at, updated_at)
       VALUES (?, 'Cash Smoke Customer', '+998901234568', 'individual', 'active', 0, datetime('now'), datetime('now'))`,
    ).run(cashCustomerId);

    const cashRes = sales.completePOSOrder(
      {
        total_amount: 5000,
        customer_id: cashCustomerId,
        shift_id: shift.id,
        user_id: ADMIN,
        due_date: today,
      },
      [cartLine(product, 1, 5000)],
      [{ payment_method: 'cash', amount: 5000 }],
    );
    const cashRow = db
      .prepare(`SELECT payment_status, credit_amount, due_date FROM orders WHERE id = ?`)
      .get(cashRes.order_id);
    assert.strictEqual(String(cashRow.payment_status), 'paid');
    assert.ok(cashRow.due_date == null || cashRow.due_date === '');
    ok('naqd sotuvda due_date NULL');

    const tickOut = await runCreditReminderTick(db, { force: true });
    assert.equal(tickOut.processed >= 1, true);
    assert.equal(tickOut.staffAlertsCreated >= 1, true);
    ok('runCreditReminderTick due_today orderni qayta ishlaydi');

    const staffAlerts = listUnreadStaffCreditAlerts(db);
    assert.ok(staffAlerts.some((a) => a.order_id === creditRes.order_id));
    ok('staff in-app alert yaratiladi');

    close();
    console.log(`\nPassed: ${passed}, Failed: ${failed}`);
    if (failed > 0) process.exit(1);
  } catch (e) {
    fail('unexpected', e);
    try {
      close();
    } catch {
      // ignore
    }
    process.exit(1);
  }
})();

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-supplier-reminder-'));
process.env.POS_SERVER_MODE = '1';
process.env.POS_DATA_DIR = tmpDir;
process.env.POS_VERBOSE_LOGS = '0';

const { formatYmdInTimeZone } = require('../../electron/lib/timezone.cjs');
const {
  findPosForReminder,
  runSupplierPaymentReminderTick,
  supplierReminderSchemaReady,
} = require('./supplierPaymentReminder.cjs');

function isBetterSqlite3AbiMismatch(err) {
  const msg = String((err && (err.stack || err.message)) || err || '');
  return (
    /better[-_]sqlite3/i.test(msg) &&
    (/NODE_MODULE_VERSION|was compiled against a different Node\.js version|MODULE_NOT_FOUND/i.test(msg) ||
      /Could not locate the bindings file/i.test(msg))
  );
}

let open;
let close;
let getDb;
let createServices;
try {
  ({ open, close, getDb } = require('../../electron/db/open.cjs'));
  ({ createServices } = require('../../electron/services/index.cjs'));
} catch (err) {
  if (isBetterSqlite3AbiMismatch(err)) {
    console.log('\n⚠ SKIP supplier reminder smoke: better-sqlite3 ABI mismatch in this environment.');
    console.log('   Reason: native module binary does not match current Node runtime.');
    console.log('   Action: rebuild/install dependencies for this Node version, then re-run this test.\n');
    process.exit(0);
  }
  throw err;
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
}

console.log('\n=== SUPPLIER PAYMENT REMINDER SMOKE ===\n');

(async () => {
  try {
    try {
      open();
    } catch (err) {
      if (isBetterSqlite3AbiMismatch(err)) {
        console.log('\n⚠ SKIP supplier reminder smoke: better-sqlite3 ABI mismatch in this environment.');
        console.log('   Reason: native module binary does not match current Node runtime.');
        console.log('   Action: rebuild/install dependencies for this Node version, then re-run this test.\n');
        process.exit(0);
      }
      throw err;
    }
    const db = getDb();
    assert.equal(supplierReminderSchemaReady(db), true);
    ok('schema ready');

    const { products, purchases, suppliers } = createServices(db);
    const supplier = suppliers.create({
      name: 'Reminder Smoke Supplier',
      phone: '+998901777000',
    });
    const product = products.create({
      name: 'Reminder Product',
      sku: `REM-${Date.now()}`,
      sale_price: 5000,
      purchase_price: 3000,
      track_stock: 1,
      current_stock: 0,
    });

    const today = formatYmdInTimeZone(new Date());
    const po = purchases.createOrder({
      supplier_id: supplier.id,
      order_date: today,
      status: 'approved',
      payment_scheme: 'partial',
      payment_due_date: today,
      items: [
        {
          product_id: product.id,
          ordered_qty: 4,
          unit_cost: 25000,
          line_total: 100000,
        },
      ],
      initial_payment: {
        amount: 40000,
        payment_method: 'cash',
        currency: 'UZS',
      },
    });
    assert.strictEqual(po.payment_scheme, 'partial');
    assert.strictEqual(String(po.payment_due_date).slice(0, 10), today);
    ok('partial PO + due_date yaratildi');

    const hits = findPosForReminder(db, 'due_today', today);
    assert.ok(hits.some((h) => h.id === po.id));
    ok('findPosForReminder due_today topadi');

    const tick1 = await runSupplierPaymentReminderTick(db, { force: true });
    assert.ok(tick1.processed >= 1);
    ok('runSupplierPaymentReminderTick birinchi marta ishlaydi');

    db.prepare(
      `INSERT OR IGNORE INTO supplier_payment_reminders (po_id, reminder_type, channel, status, sent_at)
       VALUES (?, 'due_today', 'telegram', 'sent', ?)`
    ).run(po.id, new Date().toISOString());
    const dup = findPosForReminder(db, 'due_today', today).filter((h) => h.id === po.id);
    assert.strictEqual(dup.length, 0);
    ok('idempotent: eslatma yozilgach qayta topilmaydi');

    const instPo = purchases.createOrder({
      supplier_id: supplier.id,
      order_date: today,
      status: 'approved',
      payment_scheme: 'installment',
      payment_schedule: [
        { seq: 1, due_date: today, amount: 60000 },
        { seq: 2, due_date: today, amount: 40000 },
      ],
      items: [
        {
          product_id: product.id,
          ordered_qty: 2,
          unit_cost: 50000,
          line_total: 100000,
        },
      ],
    });
    assert.strictEqual(instPo.payment_scheme, 'installment');
    assert.ok((instPo.payment_schedule || []).length === 2);
    ok('installment schedule saqlandi');

    let rejected = false;
    try {
      purchases.createOrder({
        supplier_id: supplier.id,
        order_date: today,
        status: 'approved',
        payment_scheme: 'installment',
        payment_schedule: [
          { seq: 1, due_date: today, amount: 30000 },
          { seq: 2, due_date: today, amount: 30000 },
        ],
        items: [
          {
            product_id: product.id,
            ordered_qty: 2,
            unit_cost: 50000,
            line_total: 100000,
          },
        ],
      });
    } catch (e) {
      rejected = /Bo'lib to'lash jami/i.test(String(e.message || e));
    }
    assert.ok(rejected, 'installment sum validation');
    ok('installment jami validatsiyasi');

    close();
  } catch (e) {
    fail('setup', e);
    try {
      close();
    } catch {
      /* ignore */
    }
  }

  console.log(`\n=== NATIJA: ${passed} OK, ${failed} FAIL ===\n`);
  process.exit(failed > 0 ? 1 : 0);
})();

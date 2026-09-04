/* eslint-disable no-console */
/**
 * Payout within advance vs lend (Pul berildi) smoke.
 * Dual-bucket: explicit lend never nets against advance.
 * Run: npx electron electron/services/customersPayoutLend.smoke.test.cjs
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { randomUUID } = require('crypto');

const ADMIN = 'default-admin-001';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-payout-lend-'));
process.env.POS_SERVER_MODE = '1';
process.env.POS_DATA_DIR = tmpDir;
process.env.POS_VERBOSE_LOGS = '0';

const { open, close, getDb } = require('../db/open.cjs');
const { createServices } = require('./index.cjs');
const {
  readBalanceInCurrency,
  readCustomerDebtAdvance,
} = require('../lib/customerBalance.cjs');
const { setCurrentUserId } = require('../lib/currentUser.cjs');

console.log('\n=== CUSTOMER payout vs lend SMOKE ===');
console.log(`Temp DB: ${tmpDir}\n`);

let failed = 0;

try {
  open();
  const db = getDb();
  const { customers, shifts } = createServices(db);
  setCurrentUserId(ADMIN);

  // Ensure admin has admin role for lend
  try {
    const role = db.prepare(`SELECT id FROM roles WHERE code = 'admin' LIMIT 1`).get();
    if (role) {
      const has = db
        .prepare(`SELECT 1 AS ok FROM user_roles WHERE user_id = ? AND role_id = ?`)
        .get(ADMIN, role.id);
      if (!has) {
        db.prepare(
          `INSERT INTO user_roles (id, user_id, role_id, assigned_at) VALUES (?, ?, ?, datetime('now'))`
        ).run(randomUUID(), ADMIN, role.id);
      }
    }
  } catch (_) {
    /* best-effort */
  }

  const customer = customers.create({
    name: 'Payout Lend Customer',
    phone: '+998901239902',
    allow_credit: 1,
    allow_debt: 1,
    credit_limit: 5_000_000,
  });
  const customerId = customer.id;
  const shift = shifts.openShift({ user_id: ADMIN });

  // Seed advance via payment_in
  customers.receivePayment({
    customer_id: customerId,
    amount: 10000,
    payment_method: 'cash',
    operation: 'payment_in',
    received_by: ADMIN,
    shift_id: shift.id,
    payment_uuid: randomUUID(),
  });
  assert.strictEqual(readBalanceInCurrency(db, customerId, 'UZS'), 10000);
  assert.strictEqual(readCustomerDebtAdvance(db, customerId, 'UZS').advance, 10000);
  assert.strictEqual(readCustomerDebtAdvance(db, customerId, 'UZS').debt, 0);
  console.log('  ✓ seed advance 10000');

  // Payout within advance
  const payout = customers.receivePayment({
    customer_id: customerId,
    amount: 4000,
    payment_method: 'cash',
    operation: 'payment_out',
    payment_out_kind: 'payout',
    notes: 'Avans qisman qaytarish',
    received_by: ADMIN,
    shift_id: shift.id,
    payment_uuid: randomUUID(),
  });
  assert.notStrictEqual(payout.duplicate, true);
  assert.strictEqual(payout.payment_out_kind, 'payout');
  assert.strictEqual(readBalanceInCurrency(db, customerId, 'UZS'), 6000);
  assert.strictEqual(readCustomerDebtAdvance(db, customerId, 'UZS').advance, 6000);
  console.log('  ✓ payout 4000 within advance → 6000');

  // Over-advance as payout must fail
  let blocked = false;
  try {
    customers.receivePayment({
      customer_id: customerId,
      amount: 20000,
      payment_method: 'cash',
      operation: 'payment_out',
      payment_out_kind: 'payout',
      notes: 'too much',
      received_by: ADMIN,
      shift_id: shift.id,
      payment_uuid: randomUUID(),
    });
  } catch (e) {
    blocked = true;
    assert.ok(
      String(e.message || '').includes('avansi') ||
        String(e.message || '').includes('advance') ||
        e.details?.code === 'PAYOUT_EXCEEDS_ADVANCE'
    );
  }
  assert.strictEqual(blocked, true);
  assert.strictEqual(readBalanceInCurrency(db, customerId, 'UZS'), 6000);
  console.log('  ✓ over-advance payout blocked');

  // Explicit lend while advance remains: advance unchanged, debt += amount
  // advance 6000 + lend 10000 → advance 6000, debt 10000, net -4000
  const lendUuid = randomUUID();
  const lend = customers.receivePayment({
    customer_id: customerId,
    amount: 10000,
    payment_method: 'cash',
    operation: 'payment_out',
    payment_out_kind: 'lend',
    notes: 'Approved emergency lend',
    received_by: ADMIN,
    shift_id: shift.id,
    payment_uuid: lendUuid,
  });
  assert.strictEqual(lend.payment_out_kind, 'lend');
  const afterLend = readCustomerDebtAdvance(db, customerId, 'UZS');
  assert.strictEqual(afterLend.advance, 6000);
  assert.strictEqual(afterLend.debt, 10000);
  assert.strictEqual(readBalanceInCurrency(db, customerId, 'UZS'), -4000);
  assert.strictEqual(Number(lend.new_advance), 6000);
  assert.strictEqual(Number(lend.new_debt), 10000);
  assert.strictEqual(Number(lend.debt_created), 10000);
  console.log('  ✓ lend 10000 with advance 6000 → debt 10000, advance stays 6000');

  // Idempotent lend retry
  const lendRetry = customers.receivePayment({
    customer_id: customerId,
    amount: 10000,
    payment_method: 'cash',
    operation: 'payment_out',
    payment_out_kind: 'lend',
    notes: 'Approved emergency lend',
    received_by: ADMIN,
    shift_id: shift.id,
    payment_uuid: lendUuid,
  });
  assert.strictEqual(lendRetry.duplicate, true);
  assert.strictEqual(readCustomerDebtAdvance(db, customerId, 'UZS').debt, 10000);
  assert.strictEqual(readCustomerDebtAdvance(db, customerId, 'UZS').advance, 6000);
  console.log('  ✓ lend idempotent (same payment_uuid)');

  // AC1: advance 1000, debt 0, loan 1000 → advance 1000, debt 1000
  const ac1 = customers.create({
    name: 'AC1 Advance+Lend',
    phone: '+998901239910',
    allow_credit: 1,
    allow_debt: 1,
    credit_limit: 100000,
  });
  customers.receivePayment({
    customer_id: ac1.id,
    amount: 1000,
    payment_method: 'cash',
    operation: 'payment_in',
    received_by: ADMIN,
    shift_id: shift.id,
    payment_uuid: randomUUID(),
  });
  customers.receivePayment({
    customer_id: ac1.id,
    amount: 1000,
    payment_method: 'cash',
    operation: 'payment_out',
    payment_out_kind: 'lend',
    notes: 'Pul berildi AC1',
    received_by: ADMIN,
    shift_id: shift.id,
    payment_uuid: randomUUID(),
  });
  const ac1b = readCustomerDebtAdvance(db, ac1.id, 'UZS');
  assert.strictEqual(ac1b.advance, 1000);
  assert.strictEqual(ac1b.debt, 1000);
  assert.strictEqual(readBalanceInCurrency(db, ac1.id, 'UZS'), 0);
  console.log('  ✓ AC1: advance 1000 + lend 1000 → advance 1000, debt 1000');

  // AC2: limit 10000, debt 9500 → 500 OK, 501 blocked
  const ac2 = customers.create({
    name: 'AC2 Limit',
    phone: '+998901239911',
    allow_credit: 1,
    allow_debt: 1,
    credit_limit: 10000,
  });
  customers.receivePayment({
    customer_id: ac2.id,
    amount: 9500,
    payment_method: 'cash',
    operation: 'payment_out',
    payment_out_kind: 'lend',
    notes: 'seed debt 9500',
    received_by: ADMIN,
    shift_id: shift.id,
    payment_uuid: randomUUID(),
  });
  customers.receivePayment({
    customer_id: ac2.id,
    amount: 500,
    payment_method: 'cash',
    operation: 'payment_out',
    payment_out_kind: 'lend',
    notes: 'at limit',
    received_by: ADMIN,
    shift_id: shift.id,
    payment_uuid: randomUUID(),
  });
  assert.strictEqual(readCustomerDebtAdvance(db, ac2.id, 'UZS').debt, 10000);
  let ac2Blocked = false;
  try {
    customers.receivePayment({
      customer_id: ac2.id,
      amount: 501,
      payment_method: 'cash',
      operation: 'payment_out',
      payment_out_kind: 'lend',
      notes: 'over limit',
      received_by: ADMIN,
      shift_id: shift.id,
      payment_uuid: randomUUID(),
    });
  } catch (e) {
    ac2Blocked = true;
    assert.ok(
      e.details?.code === 'CREDIT_LIMIT_EXCEEDED' ||
        String(e.message || '').includes('kredit limitidan oshadi')
    );
  }
  assert.strictEqual(ac2Blocked, true);
  assert.strictEqual(readCustomerDebtAdvance(db, ac2.id, 'UZS').debt, 10000);
  console.log('  ✓ AC2: limit 10000 debt 9500 → 500 OK, 501 blocked');

  // Zero / negative payment rejected
  let zeroBlocked = false;
  try {
    customers.receivePayment({
      customer_id: customerId,
      amount: 0,
      payment_method: 'cash',
      operation: 'payment_in',
      received_by: ADMIN,
      payment_uuid: randomUUID(),
    });
  } catch {
    zeroBlocked = true;
  }
  assert.strictEqual(zeroBlocked, true);
  console.log('  ✓ zero payment rejected');

  // credit_limit = 0 blocks lend
  const noLimitCustomer = customers.create({
    name: 'No Credit Limit',
    phone: '+998901239903',
    allow_credit: 1,
    allow_debt: 1,
    credit_limit: 0,
  });
  let limitBlocked = false;
  try {
    customers.receivePayment({
      customer_id: noLimitCustomer.id,
      amount: 10000,
      payment_method: 'cash',
      operation: 'payment_out',
      payment_out_kind: 'lend',
      notes: 'should fail',
      received_by: ADMIN,
      shift_id: shift.id,
      payment_uuid: randomUUID(),
    });
  } catch (e) {
    limitBlocked = true;
    assert.ok(
      e.details?.code === 'CREDIT_LIMIT_NOT_SET' ||
        String(e.message || '').includes('kredit limiti belgilanmagan')
    );
    assert.ok(!String(e.message || '').includes('Exceeds customer credit limit'));
  }
  assert.strictEqual(limitBlocked, true);
  console.log('  ✓ credit_limit=0 blocks lend (UZ message)');

  // Debt 59990 + lend 10000 → 69990
  const debtCustomer = customers.create({
    name: 'Debt Lend Customer',
    phone: '+998901239904',
    allow_credit: 1,
    allow_debt: 1,
    credit_limit: 200000,
  });
  customers.receivePayment({
    customer_id: debtCustomer.id,
    amount: 59990,
    payment_method: 'cash',
    operation: 'payment_out',
    payment_out_kind: 'lend',
    notes: 'seed debt',
    received_by: ADMIN,
    shift_id: shift.id,
    payment_uuid: randomUUID(),
  });
  assert.strictEqual(readCustomerDebtAdvance(db, debtCustomer.id, 'UZS').debt, 59990);
  customers.receivePayment({
    customer_id: debtCustomer.id,
    amount: 10000,
    payment_method: 'cash',
    operation: 'payment_out',
    payment_out_kind: 'lend',
    notes: 'add debt',
    received_by: ADMIN,
    shift_id: shift.id,
    payment_uuid: randomUUID(),
  });
  assert.strictEqual(readCustomerDebtAdvance(db, debtCustomer.id, 'UZS').debt, 69990);
  console.log('  ✓ debt 59990 + lend 10000 → 69990');

  // Payment in: debt 5000 + pay 10000 → debt 0, advance 5000
  const payInCustomer = customers.create({
    name: 'Pay In Split',
    phone: '+998901239905',
    allow_credit: 1,
    allow_debt: 1,
    credit_limit: 100000,
  });
  customers.receivePayment({
    customer_id: payInCustomer.id,
    amount: 5000,
    payment_method: 'cash',
    operation: 'payment_out',
    payment_out_kind: 'lend',
    notes: 'seed',
    received_by: ADMIN,
    shift_id: shift.id,
    payment_uuid: randomUUID(),
  });
  const payIn = customers.receivePayment({
    customer_id: payInCustomer.id,
    amount: 10000,
    payment_method: 'cash',
    operation: 'payment_in',
    received_by: ADMIN,
    shift_id: shift.id,
    payment_uuid: randomUUID(),
  });
  const payInBuckets = readCustomerDebtAdvance(db, payInCustomer.id, 'UZS');
  assert.strictEqual(payInBuckets.debt, 0);
  assert.strictEqual(payInBuckets.advance, 5000);
  assert.strictEqual(readBalanceInCurrency(db, payInCustomer.id, 'UZS'), 5000);
  assert.strictEqual(Number(payIn.debt_portion), 5000);
  assert.strictEqual(Number(payIn.advance_portion), 5000);
  console.log('  ✓ pay 10000 on debt 5000 → advance 5000');

  // Audit: lend writes Pul berildi with debt/advance before/after
  const audit = db
    .prepare(
      `SELECT action, old_values, new_values FROM audit_log
       WHERE entity_id = ? AND action = 'customer_lend'
       ORDER BY created_at DESC LIMIT 1`
    )
    .get(ac1.id);
  if (audit) {
    const oldV = typeof audit.old_values === 'string' ? JSON.parse(audit.old_values) : audit.old_values;
    const newV = typeof audit.new_values === 'string' ? JSON.parse(audit.new_values) : audit.new_values;
    assert.strictEqual(Number(oldV.advance), 1000);
    assert.strictEqual(Number(oldV.open_debt), 0);
    assert.strictEqual(Number(newV.open_debt), 1000);
    assert.strictEqual(Number(newV.advance), 1000);
    assert.strictEqual(Number(newV.expense), 1000);
    assert.ok(newV.operation_name === 'Pul berildi' || newV.kind === 'lend');
    console.log('  ✓ audit Pul berildi has before/after debt+advance');
  } else {
    console.log('  ⚠ audit_log row not found (schema optional) — skipped');
  }

  console.log('\n✅ payout/lend smoke passed\n');
} catch (e) {
  failed += 1;
  console.error('\n❌ FAIL:', e);
} finally {
  try {
    close();
  } catch (_) {
    /* ignore */
  }
}

process.exit(failed ? 1 : 0);

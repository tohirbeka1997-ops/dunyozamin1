'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  applyCustomerBalanceDelta,
  applyCustomerBalanceDeltaOnce,
  hasCustomerLedgerRef,
  readBalanceInCurrency,
  computeSaleCreditAmount,
} = require('./customerBalance.cjs');

function makeDb() {
  const customers = new Map([['c1', { balance: 0, balance_usd: 0, updated_at: null }]]);
  const ledger = [];

  return {
    ledger,
    prepare(sql) {
      return {
        get(...args) {
          if (/FROM sqlite_master.*customer_ledger/.test(sql)) return { name: 'customer_ledger' };
          if (/FROM customer_ledger WHERE ref_id/.test(sql)) {
            const refId = args[0];
            return ledger.some((row) => row.ref_id === refId) ? { ok: 1 } : undefined;
          }
          if (/FROM customers WHERE id = \?/.test(sql)) {
            const row = customers.get(args[0]);
            return row ? { balance: row.balance, balance_usd: row.balance_usd } : undefined;
          }
          return undefined;
        },
        run(...args) {
          if (/UPDATE customers SET balance = balance \+ \?/.test(sql)) {
            const [delta, updatedAt, id] = args;
            const row = customers.get(id);
            row.balance += Number(delta) || 0;
            row.updated_at = updatedAt;
          }
        },
      };
    },
  };
}

test('applyCustomerBalanceDeltaOnce applies delta once per ref_id', () => {
  const db = makeDb();
  const refId = 'order-abc';

  const first = applyCustomerBalanceDeltaOnce(db, 'c1', -5000, 'UZS', refId, '2026-01-01 00:00:00');
  assert.equal(first.applied, true);
  assert.equal(readBalanceInCurrency(db, 'c1', 'UZS'), -5000);

  db.ledger.push({ ref_id: refId, type: 'sale', amount: -5000, balance_after: -5000 });

  const second = applyCustomerBalanceDeltaOnce(db, 'c1', -5000, 'UZS', refId, '2026-01-01 00:00:01');
  assert.equal(second.applied, false);
  assert.equal(readBalanceInCurrency(db, 'c1', 'UZS'), -5000);
  assert.equal(hasCustomerLedgerRef(db, refId), true);
});

test('applyCustomerBalanceDelta still applies without ref guard', () => {
  const db = makeDb();
  applyCustomerBalanceDelta(db, 'c1', 1000, 'UZS', '2026-01-01 00:00:00');
  applyCustomerBalanceDelta(db, 'c1', 1000, 'UZS', '2026-01-01 00:00:01');
  assert.equal(readBalanceInCurrency(db, 'c1', 'UZS'), 2000);
});

test('paymentAmountInSaleCurrency converts mixed USD sale + UZS tender', () => {
  const { paymentAmountInSaleCurrency } = require('./customerBalance.cjs');
  assert.equal(paymentAmountInSaleCurrency({ amount: 121000, currency: 'UZS' }, 'USD', 12100), 10);
  assert.equal(paymentAmountInSaleCurrency({ amount: 10, currency: 'USD' }, 'USD', 12100), 10);
  assert.equal(paymentAmountInSaleCurrency({ amount: 10 }, 'USD', 12100), 10);
  assert.equal(paymentAmountInSaleCurrency({ amount: 10, currency: 'USD' }, 'UZS', 12100), 121000);
  assert.throws(
    () => paymentAmountInSaleCurrency({ amount: 121000, currency: 'UZS' }, 'USD', 0),
    /fx_rate/
  );
});

test('assertCreditAmountAligned matches total − paid', () => {
  const { assertCreditAmountAligned, computeSaleCreditAmount } = require('./customerBalance.cjs');
  assert.equal(computeSaleCreditAmount(10000, 4000), 6000);
  assert.equal(assertCreditAmountAligned(10000, 4000, 6000), 6000);
  assert.throws(() => assertCreditAmountAligned(10000, 4000, 5000), /credit_amount/);
});

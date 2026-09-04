'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  applyCustomerBalanceDelta,
  applyCustomerBalanceDeltaOnce,
  applyCustomerLendDelta,
  applyCustomerLendDeltaOnce,
  hasCustomerLedgerRef,
  readBalanceInCurrency,
  readCustomerDebtAdvance,
  computeSaleCreditAmount,
} = require('./customerBalance.cjs');

function makeDb(withBuckets = true) {
  const customers = new Map([
    [
      'c1',
      {
        balance: 0,
        balance_usd: 0,
        debt_uzs: 0,
        advance_uzs: 0,
        debt_usd: 0,
        advance_usd: 0,
        updated_at: null,
      },
    ],
  ]);
  const ledger = [];
  const cols = new Set([
    'balance',
    'balance_usd',
    ...(withBuckets ? ['debt_uzs', 'advance_uzs', 'debt_usd', 'advance_usd'] : []),
  ]);

  return {
    ledger,
    prepare(sql) {
      return {
        all() {
          if (/PRAGMA table_info\(customers\)/.test(sql)) {
            return [...cols].map((name) => ({ name }));
          }
          return [];
        },
        get(...args) {
          if (/FROM sqlite_master.*customer_ledger/.test(sql)) return { name: 'customer_ledger' };
          if (/FROM customer_ledger WHERE ref_id/.test(sql)) {
            const refId = args[0];
            return ledger.some((row) => row.ref_id === refId) ? { ok: 1 } : undefined;
          }
          if (/FROM customers WHERE id = \?/.test(sql)) {
            const row = customers.get(args[0]);
            if (!row) return undefined;
            return { ...row };
          }
          return undefined;
        },
        run(...args) {
          if (/UPDATE customers SET debt_uzs = \?/.test(sql) || /UPDATE customers SET debt_usd = \?/.test(sql)) {
            const [debt, advance, net, updatedAt, id] = args;
            const row = customers.get(id);
            if (/debt_usd/.test(sql)) {
              row.debt_usd = Number(debt) || 0;
              row.advance_usd = Number(advance) || 0;
              row.balance_usd = Number(net) || 0;
            } else {
              row.debt_uzs = Number(debt) || 0;
              row.advance_uzs = Number(advance) || 0;
              row.balance = Number(net) || 0;
            }
            row.updated_at = updatedAt;
            return;
          }
          if (/UPDATE customers SET balance = balance \+ \?/.test(sql)) {
            const [delta, updatedAt, id] = args;
            const row = customers.get(id);
            row.balance += Number(delta) || 0;
            row.updated_at = updatedAt;
          }
          if (/UPDATE customers SET balance = \?/.test(sql) && !/debt_uzs/.test(sql)) {
            const [net, updatedAt, id] = args;
            const row = customers.get(id);
            row.balance = Number(net) || 0;
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
  assert.equal(readCustomerDebtAdvance(db, 'c1', 'UZS').debt, 5000);

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
  assert.equal(readCustomerDebtAdvance(db, 'c1', 'UZS').advance, 2000);
});

test('applyCustomerLendDelta does not consume advance', () => {
  const db = makeDb();
  applyCustomerBalanceDelta(db, 'c1', 1000, 'UZS', '2026-01-01 00:00:00');
  applyCustomerLendDelta(db, 'c1', 1000, 'UZS', '2026-01-01 00:00:01');
  const buckets = readCustomerDebtAdvance(db, 'c1', 'UZS');
  assert.equal(buckets.advance, 1000);
  assert.equal(buckets.debt, 1000);
  assert.equal(readBalanceInCurrency(db, 'c1', 'UZS'), 0);
});

test('applyCustomerLendDeltaOnce is idempotent per ref_id', () => {
  const db = makeDb();
  applyCustomerBalanceDelta(db, 'c1', 1000, 'UZS', '2026-01-01 00:00:00');
  const refId = 'lend-1';
  const first = applyCustomerLendDeltaOnce(db, 'c1', 1000, 'UZS', refId, '2026-01-01 00:00:01');
  assert.equal(first.applied, true);
  assert.equal(first.debt, 1000);
  assert.equal(first.advance, 1000);
  db.ledger.push({ ref_id: refId });
  const second = applyCustomerLendDeltaOnce(db, 'c1', 1000, 'UZS', refId, '2026-01-01 00:00:02');
  assert.equal(second.applied, false);
  assert.equal(readCustomerDebtAdvance(db, 'c1', 'UZS').debt, 1000);
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

test('computeSaleCreditAmount subtracts prepaid', () => {
  assert.equal(computeSaleCreditAmount(10000, 3000, 2000), 5000);
});

test('FIFO plan applies oldest orders then remainder', () => {
  const { buildFifoAllocationPlan } = require('./customerPosition.cjs');
  const plan = buildFifoAllocationPlan(
    [
      { id: 'o1', remaining: 300, created_at: '2026-01-01' },
      { id: 'o2', remaining: 500, created_at: '2026-01-02' },
    ],
    400
  );
  assert.equal(plan.allocations.length, 2);
  assert.equal(plan.allocations[0].order_id, 'o1');
  assert.equal(plan.allocations[0].applied_amount, 300);
  assert.equal(plan.allocations[1].applied_amount, 100);
  assert.equal(plan.remainder, 0);
});

test('overpayment FIFO remainder goes to leftover', () => {
  const { buildFifoAllocationPlan } = require('./customerPosition.cjs');
  const plan = buildFifoAllocationPlan([{ id: 'o1', remaining: 100 }], 250);
  assert.equal(plan.applied_to_orders, 100);
  assert.equal(plan.remainder, 150);
});

test('credit exposure blocks when open order debt at limit', () => {
  const { assertCreditExposure } = require('./customerPosition.cjs');
  const blocked = assertCreditExposure({
    totalExposure: 10000,
    newDebtAmount: 1,
    creditLimit: 10000,
  });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.code, 'CREDIT_LIMIT_EXCEEDED');
  assert.equal(blocked.over_by, 1);
  const unset = assertCreditExposure({
    totalExposure: 0,
    newDebtAmount: 100,
    creditLimit: 0,
  });
  assert.equal(unset.code, 'CREDIT_LIMIT_NOT_SET');
  const okLimit = assertCreditExposure({
    totalExposure: 4000,
    newDebtAmount: 1000,
    creditLimit: 5000,
  });
  assert.equal(okLimit.ok, true);
});

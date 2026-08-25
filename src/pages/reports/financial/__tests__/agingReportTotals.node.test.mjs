/**
 * Aging report UI totals: cards must equal table column sums (per tab, per currency).
 * Run: npm run test:aging-ui
 */
import assert from 'node:assert/strict';
import test from 'node:test';

// Mirrors src/lib/agingReportTotals.ts (no TS in node smoke)
function emptyBuckets() {
  return { total: 0, current: 0, days_8_30: 0, days_31_60: 0, days_60_plus: 0 };
}

function addRowToBucket(bucket, row) {
  bucket.total += Number(row.total_debt || 0);
  bucket.current += Number(row.current || 0);
  bucket.days_8_30 += Number(row.days_8_30 || 0);
  bucket.days_31_60 += Number(row.days_31_60 || 0);
  bucket.days_60_plus += Number(row.days_60_plus || 0);
}

function rowBucketSum(row) {
  return (
    Number(row.current || 0) +
    Number(row.days_8_30 || 0) +
    Number(row.days_31_60 || 0) +
    Number(row.days_60_plus || 0)
  );
}

function sumCustomerBuckets(rows) {
  const uzs = emptyBuckets();
  const usd = emptyBuckets();
  for (const row of rows) {
    const cur = String(row.ledger_currency || 'UZS').toUpperCase() === 'USD' ? 'usd' : 'uzs';
    addRowToBucket(cur === 'usd' ? usd : uzs, row);
  }
  return { uzs, usd };
}

function sumSupplierBuckets(rows) {
  const uzs = emptyBuckets();
  const usd = emptyBuckets();
  for (const row of rows) {
    const cur = String(row.settlement_currency || 'UZS').toUpperCase() === 'USD' ? 'usd' : 'uzs';
    addRowToBucket(cur === 'usd' ? usd : uzs, row);
  }
  return { uzs, usd };
}

function cardTotalsForTab(activeTab, customerSplit, supplierSplit) {
  return activeTab === 'customers' ? customerSplit : supplierSplit;
}

function bucketPartsMatchTotal(totals, eps = 0.01) {
  const parts =
    totals.current + totals.days_8_30 + totals.days_31_60 + totals.days_60_plus;
  return Math.abs(parts - totals.total) < eps;
}

const sampleCustomers = [
  {
    id: 'c1::UZS',
    name: 'Ali',
    ledger_currency: 'UZS',
    total_debt: 10000,
    current: 3000,
    days_8_30: 4000,
    days_31_60: 2000,
    days_60_plus: 1000,
  },
  {
    id: 'c1::USD',
    name: 'Ali',
    ledger_currency: 'USD',
    total_debt: 50,
    current: 10,
    days_8_30: 20,
    days_31_60: 15,
    days_60_plus: 5,
  },
];

const sampleSuppliers = [
  {
    id: 's1',
    name: 'Supplier A',
    settlement_currency: 'UZS',
    total_debt: 8000,
    current: 1000,
    days_8_30: 2000,
    days_31_60: 3000,
    days_60_plus: 2000,
  },
];

test('per row: bucket parts sum to Jami qarz', () => {
  for (const row of [...sampleCustomers, ...sampleSuppliers]) {
    assert.ok(Math.abs(rowBucketSum(row) - row.total_debt) < 0.01);
  }
});

test('customers tab: card totals = table column sums (UZS)', () => {
  const split = sumCustomerBuckets(sampleCustomers);
  assert.equal(split.uzs.current, 3000);
  assert.equal(split.uzs.days_8_30, 4000);
  assert.equal(split.uzs.days_31_60, 2000);
  assert.equal(split.uzs.days_60_plus, 1000);
  assert.equal(split.uzs.total, 10000);
  assert.ok(bucketPartsMatchTotal(split.uzs));
});

test('customers tab: card totals = table column sums (USD)', () => {
  const split = sumCustomerBuckets(sampleCustomers);
  assert.equal(split.usd.total, 50);
  assert.ok(bucketPartsMatchTotal(split.usd));
});

test('suppliers tab: card totals = table column sums', () => {
  const customerSplit = sumCustomerBuckets(sampleCustomers);
  const supplierSplit = sumSupplierBuckets(sampleSuppliers);
  const cards = cardTotalsForTab('suppliers', customerSplit, supplierSplit);
  assert.equal(cards.uzs.total, 8000);
  assert.equal(cards.uzs.current, 1000);
  assert.equal(cards.uzs.days_8_30, 2000);
  assert.ok(bucketPartsMatchTotal(cards.uzs));
});

test('customer/supplier tabs never mix totals', () => {
  const customerSplit = sumCustomerBuckets(sampleCustomers);
  const supplierSplit = sumSupplierBuckets(sampleSuppliers);
  const customerCards = cardTotalsForTab('customers', customerSplit, supplierSplit);
  const supplierCards = cardTotalsForTab('suppliers', customerSplit, supplierSplit);
  assert.notEqual(customerCards.uzs.total, supplierCards.uzs.total);
  assert.equal(customerCards.uzs.total, 10000);
  assert.equal(supplierCards.uzs.total, 8000);
});

const test = require('node:test');
const assert = require('node:assert/strict');

// Mirror of supplierPaymentPayload.ts (pure JS for node:test)
function buildSupplierPaymentPayload(input) {
  const paid = Number(input.paid || 0);
  if (!paid || paid <= 0) throw new Error('invalid');
  const entry = input.entryCurrency;
  const settlement = input.settlementCurrency;
  const fx = Number(input.fxRate || 0);
  const fxOk = Number.isFinite(fx) && fx > 0;
  if (entry === settlement) {
    if (settlement === 'USD') return { currency: 'USD', amount: 0, amount_usd: paid };
    return { currency: 'UZS', amount: paid, amount_usd: null };
  }
  if (!fxOk) throw new Error('fx');
  if (entry === 'UZS' && settlement === 'USD') {
    return { currency: 'USD', amount: 0, amount_usd: paid / fx };
  }
  return { currency: 'UZS', amount: paid * fx, amount_usd: null };
}

test('UZS to USD settlement', () => {
  const p = buildSupplierPaymentPayload({
    paid: 12_800_000,
    entryCurrency: 'UZS',
    settlementCurrency: 'USD',
    fxRate: 12_800,
  });
  assert.equal(p.amount_usd, 1000);
});

test('UZS to UZS', () => {
  const p = buildSupplierPaymentPayload({
    paid: 500_000,
    entryCurrency: 'UZS',
    settlementCurrency: 'UZS',
    fxRate: null,
  });
  assert.equal(p.amount, 500_000);
});

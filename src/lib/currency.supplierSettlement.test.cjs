const test = require('node:test');
const assert = require('node:assert/strict');

function normalizeCurrency(value, fallback = 'UZS') {
  return String(value || fallback).trim().toUpperCase() === 'USD' ? 'USD' : 'UZS';
}

function getPoLedgerAmount(po) {
  const cur = normalizeCurrency(po?.currency, 'UZS');
  if (cur === 'USD') return Number(po?.total_usd ?? po?.total_amount ?? 0) || 0;
  return Number(po?.total_amount ?? 0) || 0;
}

function getSupplierPoSettlementAmount(po, settlementCurrency) {
  const settlement = normalizeCurrency(settlementCurrency, 'UZS');
  if (settlement === 'USD') {
    const usd = Number(po?.total_usd ?? NaN);
    if (Number.isFinite(usd) && usd > 0) return usd;
    const uzs = Number(po?.total_amount ?? 0) || 0;
    const fx = Number(po?.fx_rate ?? 0);
    if (uzs > 0 && fx > 0) return uzs / fx;
    if (normalizeCurrency(po?.currency, 'UZS') === 'USD') return getPoLedgerAmount(po);
    return 0;
  }
  return Number(po?.total_amount ?? 0) || 0;
}

function getSupplierPaymentSettlementAmount(payment, settlementCurrency) {
  const settlement = normalizeCurrency(settlementCurrency, 'UZS');
  const rawAmount = Number(payment?.amount ?? 0) || 0;
  const rawUsd = Number(payment?.amount_usd ?? NaN);
  if (settlement === 'USD') {
    if (Number.isFinite(rawUsd) && rawUsd !== 0) return rawUsd;
    const fx = Number(payment?.fx_rate ?? 0);
    if (rawAmount !== 0 && fx > 0 && normalizeCurrency(payment?.currency, 'UZS') === 'UZS') {
      return rawAmount / fx;
    }
    return rawAmount;
  }
  if (Number.isFinite(rawUsd) && rawUsd !== 0) {
    const fx = Number(payment?.fx_rate ?? 0);
    if (fx > 0) return rawUsd * fx;
  }
  return rawAmount;
}

test('USD settlement PO uses total_usd not UZS total_amount', () => {
  const po = {
    currency: 'USD',
    total_amount: 2_684_142,
    total_usd: 221.82,
    fx_rate: 12_100,
  };
  assert.equal(getSupplierPoSettlementAmount(po, 'USD'), 221.82);
  assert.notEqual(getSupplierPoSettlementAmount(po, 'USD'), po.total_amount);
});

test('USD settlement sums multiple POs in USD not UZS', () => {
  const pos = [
    { currency: 'USD', total_amount: 2_684_142, total_usd: 221.82, fx_rate: 12_100 },
    { currency: 'USD', total_amount: 2_970_550, total_usd: 245.5, fx_rate: 12_100 },
    { currency: 'USD', total_amount: 1_421_750, total_usd: 117.5, fx_rate: 12_100 },
  ];
  const total = pos.reduce((sum, po) => sum + getSupplierPoSettlementAmount(po, 'USD'), 0);
  assert.ok(Math.abs(total - 584.82) < 0.01, `expected ~584.82 USD, got ${total}`);
  const wrongTotal = pos.reduce((sum, po) => sum + Number(po.total_amount || 0), 0);
  assert.ok(wrongTotal > 1_000_000, 'raw total_amount sum should be millions of UZS');
});

test('legacy UZS row on USD settlement converts via fx_rate', () => {
  const po = {
    currency: 'UZS',
    total_amount: 1_210_000,
    total_usd: 0,
    fx_rate: 12_100,
  };
  assert.ok(Math.abs(getSupplierPoSettlementAmount(po, 'USD') - 100) < 0.01);
});

test('UZS settlement keeps total_amount', () => {
  const po = { currency: 'USD', total_amount: 500_000, total_usd: 41.32, fx_rate: 12_100 };
  assert.equal(getSupplierPoSettlementAmount(po, 'UZS'), 500_000);
});

test('USD settlement payment uses amount_usd', () => {
  const payment = { amount: 2_420_000, amount_usd: 200, currency: 'USD' };
  assert.equal(getSupplierPaymentSettlementAmount(payment, 'USD'), 200);
});

test('USD settlement payment converts UZS amount via fx_rate', () => {
  const payment = { amount: 1_210_000, amount_usd: null, currency: 'UZS', fx_rate: 12_100 };
  assert.ok(Math.abs(getSupplierPaymentSettlementAmount(payment, 'USD') - 100) < 0.01);
});

/**
 * productPricing USD display helpers (mirrors src/lib/productPricing.ts).
 * Run: node src/lib/__tests__/productPricing.node.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

function convertAtRate(amount, from, to, fxRate) {
  const value = Number(amount || 0);
  if (!value || from === to) return value;
  const fx = Number(fxRate || 0);
  if (!Number.isFinite(fx) || fx <= 0) return value;
  if (from === 'UZS' && to === 'USD') return value / fx;
  if (from === 'USD' && to === 'UZS') return value * fx;
  return value;
}

function isPlausibleUsdRetail(usd, uzs) {
  const u = usd != null ? Number(usd) : NaN;
  if (!Number.isFinite(u) || u <= 0) return false;
  const z = uzs != null ? Number(uzs) : NaN;
  if (!Number.isFinite(z) || z <= 0) return true;
  if (Math.abs(u - z) <= 0.01) return false;
  if (u >= z) return false;
  return true;
}

function resolveUsdRetailDisplay(uzsPrice, storedUsd, fxRate) {
  const uzs = Number(uzsPrice ?? 0) || 0;
  if (isPlausibleUsdRetail(storedUsd, uzs)) return Number(storedUsd);
  const fx = Number(fxRate || 0);
  if (fx > 0 && uzs > 0) return convertAtRate(uzs, 'UZS', 'USD', fx);
  return null;
}

test('corrupt UZS-as-USD is rejected; converts at FX', () => {
  const uzs = 220000;
  const fx = 12500;
  assert.equal(isPlausibleUsdRetail(220000, uzs), false);
  assert.equal(resolveUsdRetailDisplay(uzs, 220000, fx), 17.6);
  assert.equal(resolveUsdRetailDisplay(uzs, null, fx), 17.6);
});

test('real USD tier price is kept', () => {
  assert.equal(isPlausibleUsdRetail(17.6, 220000), true);
  assert.equal(resolveUsdRetailDisplay(220000, 17.6, 12500), 17.6);
});

test('no fx and no stored → null', () => {
  assert.equal(resolveUsdRetailDisplay(220000, null, null), null);
});

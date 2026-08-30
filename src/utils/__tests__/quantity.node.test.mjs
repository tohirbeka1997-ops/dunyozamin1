/**
 * Fractional quantity / unit ratio helpers.
 * Run: npm run test:quantity
 */
import assert from 'node:assert/strict';

// Mirrors src/utils/quantity.ts
const FRACTIONAL_UNITS = [
  'kg', 'кг', 'g', 'гр', 'г', 'mg', 'm', 'м', 'meter', 'metre', 'metr',
  'm2', 'm3', 'm²', 'm³', 'l', 'л', 'lt', 'liter', 'litre', 'litr', 'ml', 'мл',
];
const FRACTIONAL_UNIT_SET = new Set(FRACTIONAL_UNITS);
const FRACTIONAL_DECIMALS = 3;
const FRACTIONAL_MIN = 0.001;

const UNIT_ALIASES = {
  l: 'l',
  ml: 'ml',
  m: 'm',
  kg: 'kg',
  g: 'g',
  pcs: 'pcs',
  pack: 'pack',
  box: 'box',
  dozen: 'dozen',
};

function normalizeUnit(unit) {
  const trimmed = String(unit || '').trim();
  if (!trimmed) return '';
  const lower = trimmed.toLowerCase();
  if (UNIT_ALIASES[lower]) return UNIT_ALIASES[lower];
  return lower;
}

function roundTo(value, decimals) {
  if (!isFinite(value)) return 0;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function isFractionalUnit(unit) {
  return FRACTIONAL_UNIT_SET.has(normalizeUnit(unit));
}

function getQuantityMin(unit) {
  return isFractionalUnit(unit) ? FRACTIONAL_MIN : 1;
}

function clampQuantityForUnit(value, unit) {
  if (!isFinite(value)) return getQuantityMin(unit);
  if (isFractionalUnit(unit)) {
    const rounded = roundTo(value, FRACTIONAL_DECIMALS);
    return rounded < FRACTIONAL_MIN ? FRACTIONAL_MIN : rounded;
  }
  const rounded = Math.round(value);
  return rounded < 1 ? 1 : rounded;
}

function formatQuantity(value, unitOrPrecision) {
  if (!isFinite(value)) return '0';
  if (typeof unitOrPrecision === 'number') {
    const decimals = Math.max(0, Math.min(8, Math.floor(unitOrPrecision)));
    const rounded = roundTo(value, decimals);
    if (decimals === 0) return String(Math.round(rounded));
    return String(Number(rounded.toFixed(decimals)));
  }
  if (isFractionalUnit(unitOrPrecision)) {
    const rounded = roundTo(value, FRACTIONAL_DECIMALS);
    return String(Number(rounded.toFixed(FRACTIONAL_DECIMALS)));
  }
  return String(Math.round(value));
}

function normalizeQuantityInput(value) {
  return value.replace(',', '.');
}

function isValidDecimalInput(value, decimalPlaces = FRACTIONAL_DECIMALS) {
  if (value === '') return true;
  const normalized = normalizeQuantityInput(value);
  const match = normalized.match(/^\d*(?:\.(\d*))?$/);
  if (!match) return false;
  const decimals = match[1]?.length ?? 0;
  return decimals <= decimalPlaces;
}

function isValidQuantityInput(value, unit) {
  if (value === '') return true;
  const normalized = normalizeQuantityInput(value);
  if (isFractionalUnit(unit)) {
    return isValidDecimalInput(normalized, FRACTIONAL_DECIMALS);
  }
  return /^\d*$/.test(normalized);
}

function parseDecimalInput(value) {
  const normalized = normalizeQuantityInput(String(value || '').trim());
  if (normalized === '' || normalized === '.') return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function toBaseQty(qtySale, ratioToBase) {
  const qty = Number(qtySale || 0) || 0;
  const ratio = Number(ratioToBase || 0) || 1;
  return Number((qty * ratio).toFixed(6));
}

assert.equal(isFractionalUnit('kg'), true);
assert.equal(isFractionalUnit('KG'), true);
assert.equal(isFractionalUnit('m'), true);
assert.equal(isFractionalUnit('meter'), true);
assert.equal(isFractionalUnit('L'), true);
assert.equal(isFractionalUnit('mL'), true);
assert.equal(isFractionalUnit('pcs'), false);
assert.equal(isFractionalUnit('pack'), false);
assert.equal(isFractionalUnit('box'), false);
assert.equal(isFractionalUnit('dozen'), false);

assert.equal(getQuantityMin('kg'), 0.001);

assert.equal(clampQuantityForUnit(0.086, 'kg'), 0.086);
assert.equal(clampQuantityForUnit(0.0864, 'kg'), 0.086);
assert.equal(clampQuantityForUnit(0.0005, 'kg'), 0.001);
assert.equal(clampQuantityForUnit(2.4, 'pcs'), 2);

assert.equal(formatQuantity(0.086, 'kg'), '0.086');
assert.equal(formatQuantity(405.5, 'm'), '405.5');
assert.equal(formatQuantity(405.5, 'pcs'), '406');
assert.equal(formatQuantity(405.5, 3), '405.5');

assert.equal(isValidDecimalInput('0.086', 6), true);
assert.equal(isValidDecimalInput('0.', 6), true);
assert.equal(isValidDecimalInput('0.0861', 3), false);
assert.equal(isValidQuantityInput('0.086', 'kg'), true);
assert.equal(isValidQuantityInput('0.', 'kg'), true);
assert.equal(isValidQuantityInput('1.5', 'pcs'), false);

assert.equal(parseDecimalInput('0.086'), 0.086);
assert.equal(parseDecimalInput('0.'), 0);
assert.equal(parseDecimalInput(''), null);

assert.equal(toBaseQty(1, 0.086), 0.086);
assert.equal(toBaseQty(0.086, 1), 0.086);

const unitPriceKg = 50000;
const qtyKg = clampQuantityForUnit(0.086, 'kg');
assert.equal(unitPriceKg * qtyKg, 4300);

console.log('quantity.node.test.mjs: ok');

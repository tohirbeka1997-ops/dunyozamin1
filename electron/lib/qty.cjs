'use strict';

/**
 * Quantity precision for inventory math vs display.
 * SQLite has no DECIMAL type — we round on write and format on read.
 */

const FRACTIONAL_UNITS = new Set([
  'kg',
  'кг',
  'g',
  'гр',
  'г',
  'mg',
  'm',
  'м',
  'meter',
  'metre',
  'metr',
  'm2',
  'm3',
  'm²',
  'm³',
  'sqm',
  'l',
  'л',
  'lt',
  'liter',
  'litre',
  'litr',
  'ml',
  'мл',
]);

const UNIT_ALIASES = {
  l: 'l',
  ml: 'ml',
  m: 'm',
  kg: 'kg',
  g: 'g',
  pcs: 'pcs',
  dona: 'pcs',
  шт: 'pcs',
  pack: 'pack',
  box: 'box',
  dozen: 'dozen',
};

function normalizeUnit(unit) {
  const trimmed = String(unit || '').trim();
  if (!trimmed) return '';
  const lower = trimmed.toLowerCase();
  return UNIT_ALIASES[lower] || lower;
}

function isFractionalUnit(unit) {
  return FRACTIONAL_UNITS.has(normalizeUnit(unit));
}

function quantityDecimals(unit, settingsDecimals) {
  const norm = normalizeUnit(unit);
  if (norm === 'pcs' || norm === 'pack' || norm === 'box' || norm === 'dozen' || norm === '') {
    return 0;
  }
  if (isFractionalUnit(unit)) return 3;
  const n = Number(settingsDecimals);
  if (Number.isFinite(n) && n >= 0 && n <= 8) return Math.floor(n);
  return 3;
}

function roundTo(value, decimals) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const d = Math.max(0, Math.min(8, Math.floor(Number(decimals) || 0)));
  const factor = 10 ** d;
  return Math.round(n * factor) / factor;
}

function roundQuantity(value, unit, settingsDecimals) {
  return roundTo(value, quantityDecimals(unit, settingsDecimals));
}

function formatQuantity(value, unit, settingsDecimals) {
  const decimals = quantityDecimals(unit, settingsDecimals);
  const rounded = roundTo(value, decimals);
  if (decimals === 0) return String(Math.round(rounded));
  return String(Number(rounded.toFixed(decimals)));
}

function unitEpsilon(unit, settingsDecimals) {
  const decimals = quantityDecimals(unit, settingsDecimals);
  return decimals <= 0 ? 0.5 : 10 ** -decimals / 2;
}

/** Fixed-point qty: 1 unit = 1_000_000 scaled (6 decimal places). Avoid JS float math. */
const QTY_SCALE = 1_000_000;
const QTY_SCALE_BI = 1000000n;

function _stripQtyString(value) {
  if (value == null || value === '') return '0';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '0';
    return value.toFixed(6);
  }
  if (typeof value === 'bigint') return value.toString();
  return String(value).trim().replace(',', '.').replace(/\s/g, '') || '0';
}

function qtyToScaled(value) {
  const raw = _stripQtyString(value);
  const neg = raw.startsWith('-');
  const s = neg ? raw.slice(1) : raw;
  if (!/^\d*(\.\d*)?$/.test(s) || s === '.' || s === '') return 0;
  const [intPart, fracPart = ''] = s.split('.');
  const frac = `${fracPart}000000`.slice(0, 6);
  const scaled = Number(BigInt(intPart || '0') * QTY_SCALE_BI + BigInt(frac));
  return neg ? -scaled : scaled;
}

function scaledToString(scaled, maxDecimals = 6) {
  const n = Number(scaled || 0);
  const neg = n < 0;
  let abs = BigInt(Math.trunc(Math.abs(n)));
  const whole = abs / QTY_SCALE_BI;
  let frac = (abs % QTY_SCALE_BI).toString().padStart(6, '0');
  const d = Math.max(0, Math.min(6, Math.floor(Number(maxDecimals) || 0)));
  frac = frac.slice(0, d);
  if (d === 0) return `${neg ? '-' : ''}${whole.toString()}`;
  return `${neg ? '-' : ''}${whole.toString()}.${frac}`;
}

function scaledToNumber(scaled, maxDecimals = 6) {
  return Number(scaledToString(scaled, maxDecimals));
}

function mulDivScaled(aScaled, mul, div) {
  const d = Number(div);
  if (!d) return 0;
  const prod = BigInt(Math.trunc(Number(aScaled) || 0)) * BigInt(Math.trunc(Number(mul) || 0));
  return Number(prod / BigInt(Math.trunc(d)));
}

function ceilScaledToDecimals(scaled, decimals) {
  const n = Number(scaled || 0);
  if (n <= 0) return 0;
  const d = Math.max(0, Math.min(6, Math.floor(Number(decimals) || 0)));
  const unit = 10 ** (6 - d);
  const u = BigInt(unit);
  const s = BigInt(Math.trunc(n));
  return Number(((s + u - 1n) / u) * u);
}

function ceilScaledToMultiple(scaled, stepScaled) {
  const n = Number(scaled || 0);
  const step = Number(stepScaled || 0);
  if (n <= 0) return 0;
  if (step <= 0) return n;
  const s = BigInt(Math.trunc(n));
  const st = BigInt(Math.trunc(step));
  return Number(((s + st - 1n) / st) * st);
}

function mulQtyPriceInteger(qtyScaled, unitPriceInteger) {
  const price = BigInt(Math.round(Number(unitPriceInteger) || 0));
  const qty = BigInt(Math.trunc(Number(qtyScaled) || 0));
  if (price === 0n || qty === 0n) return 0;
  const half = QTY_SCALE_BI / 2n;
  const prod = qty * price;
  if (prod >= 0n) return Number((prod + half) / QTY_SCALE_BI);
  return -Number((-prod + half) / QTY_SCALE_BI);
}

module.exports = {
  normalizeUnit,
  isFractionalUnit,
  quantityDecimals,
  roundTo,
  roundQuantity,
  formatQuantity,
  unitEpsilon,
  QTY_SCALE,
  qtyToScaled,
  scaledToString,
  scaledToNumber,
  mulDivScaled,
  ceilScaledToDecimals,
  ceilScaledToMultiple,
  mulQtyPriceInteger,
};

/**
 * Money / number parse tests (UZ dot grouping + USD decimals).
 * Run: npm run test:money-parse
 */
import test from 'node:test';
import assert from 'node:assert/strict';

// Mirrors src/lib/money.ts (no TS in node smoke)
function parseMoneyUZS(input) {
  if (!input || typeof input !== 'string') return 0;
  const cleaned = input
    .replace(/\./g, '')
    .replace(/\s/g, '')
    .replace(/so'm/gi, '')
    .replace(/[^\d-]/g, '');
  if (!cleaned || cleaned === '-') return 0;
  const parsed = parseInt(cleaned, 10);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function parseMoneyFlexible(input, fractionDigits = 2) {
  if (!input || typeof input !== 'string') return 0;
  let s = input.trim().replace(/\s/g, '').replace(/so'm/gi, '');
  if (!s) return 0;
  const isNeg = s.startsWith('-');
  s = s.replace(/-/g, '');
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  const sepIndex = Math.max(lastComma, lastDot);
  const sepChar = sepIndex >= 0 ? s[sepIndex] : null;
  const hasComma = lastComma >= 0;
  const hasDot = lastDot >= 0;
  const treatAsDecimal = (() => {
    if (sepIndex < 0 || !sepChar) return false;
    if (hasComma && hasDot) return true;
    if (sepChar === ',') return true;
    const digitsAfter = s.slice(sepIndex + 1).replace(/[^\d]/g, '').length;
    return digitsAfter > 0 && digitsAfter <= Math.max(0, fractionDigits);
  })();
  let num = 0;
  if (treatAsDecimal && sepIndex >= 0) {
    const left = s.slice(0, sepIndex);
    const right = s.slice(sepIndex + 1);
    const intPart = left.replace(/[^\d]/g, '');
    const fracPart = right.replace(/[^\d]/g, '').slice(0, Math.max(0, fractionDigits));
    num = parseFloat(`${intPart || '0'}.${fracPart || '0'}`);
  } else {
    const digits = s.replace(/[^\d]/g, '');
    num = digits ? parseInt(digits, 10) : 0;
  }
  if (Number.isNaN(num) || !Number.isFinite(num)) return 0;
  return isNeg ? -num : num;
}

function formatNumberDots(amount) {
  if (amount === null || amount === undefined || Number.isNaN(amount) || !Number.isFinite(amount)) return '0';
  const rounded = Math.round(amount);
  const sign = rounded < 0 ? '-' : '';
  const formatted = Math.abs(rounded).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return sign + formatted;
}

function formatNumberDotsWithDecimals(amount, fractionDigits = 2) {
  if (amount === null || amount === undefined || Number.isNaN(amount) || !Number.isFinite(amount)) return '0';
  const sign = amount < 0 ? '-' : '';
  const abs = Math.abs(amount);
  const intFormatted = Math.floor(abs).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const fixed = abs.toFixed(Math.max(0, Math.min(6, fractionDigits)));
  const frac = (fixed.split('.')[1] || '').replace(/0+$/, '');
  if (!frac) return sign + intFormatted;
  return `${sign}${intFormatted},${frac}`;
}

test('parseMoneyUZS: 1.000 -> 1000', () => {
  assert.equal(parseMoneyUZS('1.000'), 1000);
});

test('parseMoneyUZS: 1.000.000 -> 1000000', () => {
  assert.equal(parseMoneyUZS('1.000.000'), 1_000_000);
});

test('parseMoneyUZS: strips spaces and so\'m suffix', () => {
  assert.equal(parseMoneyUZS('1.000.000 so\'m'), 1_000_000);
});

test('parseMoneyFlexible: USD decimal with comma', () => {
  assert.equal(parseMoneyFlexible('2,07', 2), 2.07);
});

test('parseMoneyFlexible: thousands dots + decimal comma', () => {
  assert.equal(parseMoneyFlexible('1.234,56', 2), 1234.56);
});

test('parseMoneyFlexible: integer dots only', () => {
  assert.equal(parseMoneyFlexible('10.000', 2), 10_000);
});

test('formatNumberDots round-trip', () => {
  assert.equal(formatNumberDots(1_000_000), '1.000.000');
  assert.equal(parseMoneyUZS(formatNumberDots(1_000_000)), 1_000_000);
});

test('formatNumberDotsWithDecimals USD style', () => {
  assert.equal(formatNumberDotsWithDecimals(2.07, 2), '2,07');
  assert.equal(formatNumberDotsWithDecimals(1234.5, 2), '1.234,5');
});

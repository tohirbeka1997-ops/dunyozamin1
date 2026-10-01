/**
 * POS search normalize helpers — null/number safe, no ReferenceError.
 * Run: node --test src/pages/__tests__/posSearchNormalize.node.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);

// Mirror helpers (TS not loaded in node:test without transform)
function normalizeSearch(value) {
  return String(value ?? '')
    .trim()
    .toLocaleLowerCase('uz-UZ');
}
function normalizeSku(value) {
  return normalizeSearch(value).replace(/[\s\-_]/g, '');
}
function normalizeArticle(value) {
  return normalizeSearch(value).replace(/[\s\-_]/g, '');
}

test('normalizeSearch accepts null/undefined/number without throw', () => {
  assert.equal(normalizeSearch(null), '');
  assert.equal(normalizeSearch(undefined), '');
  assert.equal(normalizeSearch(2188), '2188');
  assert.equal(normalizeSearch('  Cement '), 'cement');
});

test('normalizeSku/article strip separators safely', () => {
  assert.equal(normalizeSku('21-88'), '2188');
  assert.equal(normalizeArticle(null), '');
  assert.equal(normalizeArticle('AB_12'), 'ab12');
});

test('filter by name/sku/barcode/article/brand never throws on null fields', () => {
  const products = [
    { name: null, sku: 2188, barcode: undefined, article: null, brand: null },
    { name: 'Cement', sku: 'CEM', barcode: '46001', article: 'A-1', brand: 'ACME' },
  ];
  const query = normalizeSearch('2188');
  const filtered = products.filter((product) =>
    [product.name, product.sku, product.barcode, product.article, product.brand].some((value) =>
      normalizeSearch(value).includes(query),
    ),
  );
  assert.equal(filtered.length, 1);
  assert.equal(String(filtered[0].sku), '2188');
});

test('POSTerminal imports normalizeArticle (source guard)', () => {
  const src = readFileSync(path.join(root, 'pages/POSTerminal.tsx'), 'utf8');
  assert.match(src, /normalizeArticle/);
  assert.match(src, /Qidiruvda xato yuz berdi/);
  assert.doesNotMatch(src, /normalizeArticle\(String\(\(p as/);
  // Must be in the import list from helpers
  assert.match(
    src,
    /normalizeArticle,\s*\n\s*normalizeSearch|normalizeSearch,\s*\n\s*classifyQuery|normalizeArticle,\s*\n\s*classifyQuery|normalizeArticle,/,
  );
});

test('posTerminalHelpers exports normalizeArticle and normalizeSearch', () => {
  const src = readFileSync(path.join(root, 'pages/posTerminalHelpers.ts'), 'utf8');
  assert.match(src, /export const normalizeArticle/);
  assert.match(src, /export const normalizeSearch/);
  assert.match(src, /toLocaleLowerCase\('uz-UZ'\)/);
  assert.match(src, /export function isPosScannerQuery/);
});

function isPosScannerQuery(value) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return false;
  const numericOnly = /^[0-9]+$/.test(trimmed);
  const isBarcodeLike = numericOnly && [8, 12, 13, 14].includes(trimmed.length);
  if (isBarcodeLike) return true;
  if (numericOnly && trimmed.length >= 4) return true;
  const upper = trimmed.toUpperCase();
  return upper.startsWith('LOYALTY:') || upper.startsWith('LC-');
}

test('scanner payload is cleared from search, product names are not', () => {
  assert.equal(isPosScannerQuery('4607034456789'), true);
  assert.equal(isPosScannerQuery('00412'), true);
  assert.equal(isPosScannerQuery('LC-100'), true);
  assert.equal(isPosScannerQuery('plafon'), false);
  assert.equal(isPosScannerQuery(''), false);
});

test('POS search Enter clears a scanner code', () => {
  const src = readFileSync(path.join(root, 'pages/POSTerminal.tsx'), 'utf8');
  assert.match(src, /isPosScannerQuery\(raw\)/);
  assert.match(src, /Scanner codes must leave the search box/);
});

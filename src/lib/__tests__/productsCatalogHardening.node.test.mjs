/**
 * Products catalog hardening (search, price, qty format).
 * Run: node --test src/lib/__tests__/productsCatalogHardening.node.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'url';
import path from 'path';
import { readFileSync } from 'fs';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const hardening = require(path.join(root, 'electron/lib/posHardening.cjs'));

const {
  isProductPriceNotSet,
  isProductSalePriceSellable,
  isProductFreeSaleAllowed,
  assertProductSalePriceAllowed,
  assertProductCostPriceAllowed,
  bulkPriceChangeRequiresApproval,
  computeBulkNewPrice,
  assertBulkSaleFinalPrice,
  isBulkPercentDecreaseBlocked,
} = hardening;

// Mirror of productSearchMatch (no TS transform in node:test).
function normalizeProductCode(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s\-_./\\]+/g, '');
}

function productHasExactCodeMatch(product, rawTerm) {
  const termNorm = normalizeProductCode(rawTerm);
  if (!termNorm) return false;
  return (
    normalizeProductCode(product.sku) === termNorm ||
    normalizeProductCode(product.barcode) === termNorm
  );
}

function productMatchesSearchTermFuzzy(product, rawTerm) {
  const term = String(rawTerm || '').trim().toLowerCase();
  if (!term) return true;
  const termNorm = normalizeProductCode(term);
  const name = String(product.name || '').toLowerCase();
  const sku = String(product.sku || '').toLowerCase();
  const barcode = String(product.barcode || '').toLowerCase();
  const article = normalizeProductCode(product.article);
  const brand = String(product.brand || '').toLowerCase();
  return (
    name.includes(term) ||
    sku.includes(term) ||
    barcode.includes(term) ||
    (termNorm.length > 0 && article.includes(termNorm)) ||
    brand.includes(term) ||
    (termNorm.length > 0 && normalizeProductCode(product.sku).includes(termNorm)) ||
    (termNorm.length > 0 && normalizeProductCode(product.barcode).includes(termNorm))
  );
}

function filterProductsBySearchTerm(products, rawTerm) {
  const term = String(rawTerm || '').trim();
  if (!term) return products;
  const exact = products.filter((p) => productHasExactCodeMatch(p, term));
  if (exact.length > 0) return exact;
  return products.filter((p) => productMatchesSearchTermFuzzy(p, term));
}

function formatQuantity(value, unitOrPrecision) {
  const FRACTIONAL = new Set([
    'kg',
    'm',
    'л',
    'l',
    'g',
    'ml',
    'meter',
    'metre',
    'metr',
    'liter',
    'litre',
    'litr',
    'м',
  ]);
  const roundTo = (v, d) => {
    const f = Math.pow(10, d);
    return Math.round(v * f) / f;
  };
  if (!Number.isFinite(value)) return '0';
  if (typeof unitOrPrecision === 'number') {
    const decimals = Math.max(0, Math.min(8, Math.floor(unitOrPrecision)));
    const rounded = roundTo(value, decimals);
    if (decimals === 0) return String(Math.round(rounded));
    return String(Number(rounded.toFixed(decimals)));
  }
  const unit = String(unitOrPrecision || '').trim().toLowerCase();
  if (FRACTIONAL.has(unit)) {
    const rounded = roundTo(value, 3);
    return String(Number(rounded.toFixed(3)));
  }
  return String(Math.round(value));
}

test('exact SKU 2188 returns only that SKU (not substring noise)', () => {
  const rows = [
    { name: 'Pipe 2188mm', sku: 'PIPE-900', barcode: '100' },
    { name: 'Cable', sku: '2188', barcode: '200' },
    { name: 'Other', sku: '21880', barcode: '300' },
  ];
  const hits = filterProductsBySearchTerm(rows, '2188');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].sku, '2188');
});

test('leading-zero SKU 00465 kept distinct from 465', () => {
  const rows = [
    { name: 'A', sku: '00465', barcode: '1' },
    { name: 'B', sku: '465', barcode: '2' },
    { name: 'C', sku: '004650', barcode: '3' },
  ];
  const hits = filterProductsBySearchTerm(rows, '00465');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].sku, '00465');
  assert.equal(normalizeProductCode('00-465'), '00465');
  assert.notEqual(normalizeProductCode('00465'), normalizeProductCode('465'));
});

test('clear search term returns full list (URL/list restore contract)', () => {
  const rows = [
    { name: 'A', sku: '1' },
    { name: 'B', sku: '2' },
  ];
  assert.equal(filterProductsBySearchTerm(rows, '').length, 2);
  assert.equal(filterProductsBySearchTerm(rows, '   ').length, 2);
});

test('fractional qty formatQuantity keeps 405.5 for meters (not rounded to 406)', () => {
  assert.equal(formatQuantity(405.5, 'm'), '405.5');
  assert.equal(formatQuantity(405.5, 'pcs'), '406');
  assert.equal(formatQuantity(0.086, 'kg'), '0.086');
  assert.equal(formatQuantity(405.5, 3), '405.5');
});

test('zero price blocked without free_sale_allowed', () => {
  assert.equal(isProductPriceNotSet({ sale_price: 0 }), true);
  assert.equal(isProductSalePriceSellable({ sale_price: 0 }), false);
  assert.equal(isProductSalePriceSellable({ sale_price: 0, free_sale_allowed: 1 }), true);
  assert.equal(isProductFreeSaleAllowed({ free_sale_allowed: 1 }), true);
  const blocked = assertProductSalePriceAllowed(0, { freeSaleAllowed: false });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.code, 'ZERO_PRICE_BLOCKED');
  const ok = assertProductSalePriceAllowed(0, { freeSaleAllowed: true });
  assert.equal(ok.ok, true);
});

test('negative and empty prices blocked', () => {
  assert.equal(assertProductSalePriceAllowed(-1).ok, false);
  assert.equal(assertProductCostPriceAllowed(-5).ok, false);
  assert.equal(assertProductCostPriceAllowed(0).ok, true);
  assert.equal(assertProductSalePriceAllowed(null).ok, false);
});

test('bulk -100% / -150% blocked (final <= 0, Confirm must stay disabled)', () => {
  assert.equal(isBulkPercentDecreaseBlocked(-100), true);
  assert.equal(isBulkPercentDecreaseBlocked(-150), true);
  assert.equal(isBulkPercentDecreaseBlocked(-99), false);

  const zeroed = computeBulkNewPrice(10000, { mode: 'percent', percent: -100 });
  assert.equal(zeroed, 0);
  assert.equal(assertBulkSaleFinalPrice(zeroed, { sku: 'X' }).ok, false);

  const neg = computeBulkNewPrice(10000, { mode: 'percent', percent: -150 });
  assert.equal(neg, -5000);
  assert.equal(assertBulkSaleFinalPrice(neg, { sku: 'X' }).ok, false);

  // Must NOT clamp negatives to 0 silently (old bug path).
  assert.ok(neg < 0);
});

test('bulk price approval required for >20 or >30%', () => {
  assert.equal(
    bulkPriceChangeRequiresApproval({ productCount: 21, userRole: 'cashier' }).missing,
    true,
  );
  assert.equal(
    bulkPriceChangeRequiresApproval({
      productCount: 5,
      maxAbsPercentChange: 35,
      userRole: 'cashier',
    }).missing,
    true,
  );
  assert.equal(
    bulkPriceChangeRequiresApproval({
      productCount: 25,
      maxAbsPercentChange: 40,
      userRole: 'manager',
    }).missing,
    false,
  );
});

test('Products UI source guards: zero-price + bulk Confirm + exact search', () => {
  const productsPage = readFileSync(path.join(root, 'src/pages/Products.tsx'), 'utf8');
  assert.match(productsPage, /filterProductsBySearchTerm/);
  assert.match(productsPage, /clear_search/);
  assert.match(productsPage, /next\.delete\('search'\)/);
  assert.match(productsPage, /getProductDeleteImpact|hard_delete_confirm|deactivate_confirm/);
  assert.match(productsPage, /Sale price must be > 0/);

  const form = readFileSync(path.join(root, 'src/pages/ProductForm.tsx'), 'utf8');
  assert.match(form, /sale_price_required/);
  assert.match(form, /free_sale_reason/);
  assert.match(form, /allowZero=\{\!\!formData\.free_sale_allowed\}/);
  assert.match(form, /generate_sku/);
  assert.match(form, /generate_barcode/);

  const createModal = readFileSync(
    path.join(root, 'src/components/products/CreateProductModal.tsx'),
    'utf8',
  );
  assert.match(createModal, /!\(Number\(sale\) > 0\)/);
  assert.match(createModal, /allowZero=\{false\}/);

  const bulk = readFileSync(
    path.join(root, 'src/components/products/BulkPriceUpdateDialog.tsx'),
    'utf8',
  );
  assert.match(bulk, /filterProductsBySearchTerm/);
  assert.match(bulk, /confirmDisabled/);
  assert.match(bulk, /isBulkPercentDecreaseBlocked/);
  assert.match(bulk, /invalidRows\.length > 0/);
  assert.match(bulk, /disabled=\{confirmDisabled\}/);

  const table = readFileSync(
    path.join(root, 'src/components/products/VirtualizedProductsTable.tsx'),
    'utf8',
  );
  assert.match(table, /aria-label=\{t\('products\.actions\.view'\)\}/);
  assert.match(table, /formatQuantity/);
  assert.match(table, /base_unit/);
  assert.match(table, /price_not_set/);

  const searchSrc = readFileSync(path.join(root, 'src/lib/productSearchMatch.ts'), 'utf8');
  assert.match(searchSrc, /filterProductsBySearchTerm/);
  assert.match(searchSrc, /normalizeProductCode/);
  assert.match(searchSrc, /productHasExactCodeMatch/);

  const svc = readFileSync(path.join(root, 'electron/services/productsService.cjs'), 'utf8');
  assert.match(svc, /assertProductSalePriceAllowed\(defaultSale/);
  assert.match(svc, /isBulkPercentDecreaseBlocked/);
  assert.match(svc, /assertBulkSaleFinalPrice/);
  assert.match(svc, /_requireFreeSaleReason/);
  assert.match(svc, /getDeleteImpact/);
  assert.match(svc, /_normalizeProductCode/);
});

test('migration 126 free_sale_allowed exists', () => {
  const mig = readFileSync(
    path.join(root, 'electron/db/migrations/126_product_free_sale_allowed.sql'),
    'utf8',
  );
  assert.match(mig, /free_sale_allowed/);
});

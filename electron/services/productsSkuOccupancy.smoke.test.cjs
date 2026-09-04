/* eslint-disable no-console */
/**
 * SKU occupancy after regenerate / manual change.
 *
 * - Regenerating SKU A → B frees A for a new live product
 * - getNextSku reuses the released number (does not skip because of stale cache)
 * - Two live products cannot share B
 *
 * Ishga tushirish: npm run test:products-sku-smoke
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-products-sku-smoke-'));
process.env.POS_SERVER_MODE = '1';
process.env.POS_DATA_DIR = tmpDir;
process.env.POS_VERBOSE_LOGS = '0';

const { open, close, getDb } = require('../db/open.cjs');
const { createServices } = require('./index.cjs');
const { ERROR_CODES } = require('../lib/errors.cjs');

let passed = 0;
let failed = 0;

function ok(name) {
  passed += 1;
  console.log(`  ✓ ${name}`);
}

function fail(name, err) {
  failed += 1;
  console.log(`  ✗ ${name}`);
  console.log(`     ${err && err.message ? err.message : err}`);
}

function runStep(name, fn) {
  try {
    fn();
    ok(name);
  } catch (e) {
    fail(name, e);
  }
}

function makeProduct(products, sku, name) {
  return products.create({
    name,
    sku,
    sale_price: 1000,
    purchase_price: 400,
    track_stock: 1,
    product_units: [{ unit: 'pcs', ratio_to_base: 1, sale_price: 1000, is_default: true }],
  });
}

function lookupSku(products, sku) {
  try {
    return products.getBySku(sku);
  } catch (err) {
    if (err && err.code === ERROR_CODES.NOT_FOUND) return null;
    throw err;
  }
}

function assertConflict(fn) {
  try {
    fn();
  } catch (err) {
    if (err && err.code === ERROR_CODES.CONFLICT) return;
    throw err;
  }
  throw new Error('expected SKU conflict');
}

console.log('\n=== MAHSULOT SKU OCCUPANCY SMOKE TEST ===');
console.log(`Temp DB: ${tmpDir}\n`);

try {
  open();
  const db = getDb();
  const { products } = createServices(db);

  runStep('regenerate SKU A→B frees A for a new product', () => {
    const skuA = products.getNextSku();
    const original = makeProduct(products, skuA, 'SKU occupancy original');

    // Warm lookup cache the way the product form does (load + uniqueness pre-check).
    products.getById(original.id);
    assert.ok(lookupSku(products, skuA));
    const padded = String(skuA).padStart(5, '0');
    if (padded !== String(skuA)) lookupSku(products, padded);

    const skuB = products.getNextSku();
    assert.notStrictEqual(String(skuB), String(skuA));
    products.update(original.id, { sku: skuB });

    const after = products.getById(original.id);
    assert.strictEqual(String(after.sku), String(skuB));
    assert.equal(lookupSku(products, skuA), null);
    assert.equal(products.getNextSku(), skuA);

    const reused = makeProduct(products, skuA, 'SKU occupancy reuse');
    assert.strictEqual(String(reused.sku), String(skuA));
    assert.notStrictEqual(reused.id, original.id);

    assert.strictEqual(String(products.getById(original.id).sku), String(skuB));
    assertConflict(() => makeProduct(products, skuB, 'SKU occupancy duplicate B'));
  });

  runStep('manual SKU edit also releases the previous code', () => {
    const skuFrom = `MAN-${Date.now()}-A`;
    const skuTo = `MAN-${Date.now()}-B`;
    const row = makeProduct(products, skuFrom, 'Manual SKU change');
    products.getBySku(skuFrom);
    products.update(row.id, { sku: skuTo });
    assert.equal(lookupSku(products, skuFrom), null);
    const other = makeProduct(products, skuFrom, 'Manual SKU reused');
    assert.strictEqual(String(other.sku), String(skuFrom));
    assertConflict(() => makeProduct(products, skuTo, 'Manual SKU duplicate'));
  });

  runStep('padded SKU aliases do not keep the old number reserved', () => {
    const paddedA = '00077';
    const paddedB = '00078';
    const row = makeProduct(products, paddedA, 'Padded SKU original');
    products.getBySku(paddedA);
    products.getBySku('77');
    products.update(row.id, { sku: paddedB });
    assert.equal(lookupSku(products, paddedA), null);
    const reused = makeProduct(products, paddedA, 'Padded SKU reused');
    assert.strictEqual(String(reused.sku), paddedA);
    assert.strictEqual(String(products.getById(row.id).sku), paddedB);
  });

  runStep('inactive product does not block next SKU or live reuse', () => {
    const sku = products.getNextSku();
    const archived = makeProduct(products, sku, 'Inactive SKU holder');
    products.update(archived.id, { is_active: false });
    assert.equal(products.getNextSku(), sku);
    const live = makeProduct(products, sku, 'Live reuses inactive SKU');
    assert.strictEqual(String(live.sku), String(sku));
    assert.notStrictEqual(String(products.getById(archived.id).sku), String(sku));
  });

  close();
} catch (e) {
  fail('setup / teardown', e);
  try {
    close();
  } catch {
    /* ignore */
  }
}

console.log(`\n=== NATIJA: ${passed} OK, ${failed} FAIL ===\n`);
process.exit(failed > 0 ? 1 : 0);

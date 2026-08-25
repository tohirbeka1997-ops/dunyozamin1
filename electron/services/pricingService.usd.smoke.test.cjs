/**
 * pricingService USD vs UZS catalog isolation.
 * Run: node electron/services/pricingService.usd.smoke.test.cjs
 */
'use strict';

const assert = require('assert');
const Database = require('better-sqlite3');
const PricingService = require('./pricingService.cjs');

function makeDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE products (
      id TEXT PRIMARY KEY,
      sale_price REAL,
      master_price REAL,
      base_unit TEXT,
      unit TEXT
    );
    CREATE TABLE product_units (
      product_id TEXT,
      unit TEXT,
      ratio_to_base REAL,
      sale_price REAL,
      is_default INTEGER
    );
    CREATE TABLE price_tiers (
      id INTEGER PRIMARY KEY,
      code TEXT,
      name TEXT,
      priority INTEGER,
      is_active INTEGER
    );
    CREATE TABLE product_prices (
      product_id TEXT,
      tier_id INTEGER,
      unit TEXT,
      currency TEXT,
      price REAL,
      updated_at TEXT,
      UNIQUE(product_id, tier_id, currency, unit)
    );
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
    INSERT INTO price_tiers (id, code, name, priority, is_active)
    VALUES (1, 'retail', 'Retail', 1, 1);
  `);
  return db;
}

function run() {
  const db = makeDb();
  const pricing = new PricingService(db);
  const productId = 'p-usd-1';
  const uzs = 220000;

  db.prepare(
    `INSERT INTO products (id, sale_price, master_price, base_unit, unit)
     VALUES (?, ?, NULL, 'pcs', 'pcs')`
  ).run(productId, uzs);
  db.prepare(
    `INSERT INTO product_units (product_id, unit, ratio_to_base, sale_price, is_default)
     VALUES (?, 'pcs', 1, ?, 1)`
  ).run(productId, uzs);

  // Missing USD row → null (must NOT return live UZS 220000)
  assert.strictEqual(
    pricing.getPriceForProduct({
      product_id: productId,
      tier_code: 'retail',
      currency: 'USD',
      unit: 'pcs',
    }),
    null
  );
  console.log('✓ USD missing → null (no live UZS fallback)');

  // Intentional USD retail stays intact and is not overwritten by UZS reconcile
  pricing.setPrice({
    product_id: productId,
    tier_id: 1,
    currency: 'USD',
    unit: 'pcs',
    price: 17.6,
  });
  assert.strictEqual(
    pricing.getPriceForProduct({
      product_id: productId,
      tier_code: 'retail',
      currency: 'USD',
      unit: 'pcs',
    }),
    17.6
  );
  const afterGet = db
    .prepare(`SELECT price FROM product_prices WHERE product_id = ? AND currency = 'USD'`)
    .get(productId);
  assert.strictEqual(Number(afterGet.price), 17.6);
  console.log('✓ intentional USD retail preserved');

  // Corrupted row (USD = UZS catalog) cleared → null
  pricing.setPrice({
    product_id: productId,
    tier_id: 1,
    currency: 'USD',
    unit: 'pcs',
    price: uzs,
  });
  assert.strictEqual(
    pricing.getPriceForProduct({
      product_id: productId,
      tier_code: 'retail',
      currency: 'USD',
      unit: 'pcs',
    }),
    null
  );
  const cleared = db
    .prepare(`SELECT price FROM product_prices WHERE product_id = ? AND currency = 'USD'`)
    .get(productId);
  assert.ok(!cleared, 'corrupt USD row should be deleted');
  console.log('✓ corrupt USD=UZS row cleared on get');

  // UZS path still reconciles from live catalog
  pricing.setPrice({
    product_id: productId,
    tier_id: 1,
    currency: 'UZS',
    unit: 'pcs',
    price: 100000,
  });
  const uzsPrice = pricing.getPriceForProduct({
    product_id: productId,
    tier_code: 'retail',
    currency: 'UZS',
    unit: 'pcs',
  });
  assert.strictEqual(uzsPrice, uzs);
  console.log('✓ UZS still reconciles to live catalog');

  console.log('All pricingService USD smoke tests passed.');
}

run();
process.exit(0);

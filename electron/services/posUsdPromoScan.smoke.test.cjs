/* eslint-disable no-console */
/**
 * posUsdPromoScan.smoke.test.cjs
 * POS: USD sotuv (fx_rate), aksiya qo‘llash, SKU leading-zero skan fallback.
 *
 * Ishga tushirish: npm run test:pos-usd-smoke
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { randomUUID } = require('crypto');

const WH = 'main-warehouse-001';
const ADMIN = 'default-admin-001';
const FX_RATE = 12500;

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-usd-promo-scan-'));
process.env.POS_SERVER_MODE = '1';
process.env.POS_DATA_DIR = tmpDir;
process.env.POS_VERBOSE_LOGS = '0';

const { open, close, getDb } = require('../db/open.cjs');
const { createServices } = require('./index.cjs');

let passed = 0;
let failed = 0;

function ok(name) {
  passed += 1;
  console.log(`  ✓ ${name}`);
}

function fail(name, err) {
  failed += 1;
  console.log(`  ✗ ${name}`);
  console.log(`     ${err.message || err}`);
}

function runStep(name, fn) {
  try {
    fn();
    ok(name);
  } catch (e) {
    fail(name, e);
  }
}

try {
  console.log('\n=== POS USD / PROMO / SCAN SMOKE TEST ===');
  console.log(`Temp DB: ${tmpDir}\n`);

  open();
  const db = getDb();
  const { products, inventory, sales, shifts, pricing, promotions, exchangeRates } = createServices(db);

  const today = new Date().toISOString().slice(0, 10);
  exchangeRates.upsert({
    base_currency: 'USD',
    quote_currency: 'UZS',
    rate: FX_RATE,
    effective_date: today,
    source: 'smoke',
    created_by: ADMIN,
  });
  ok(`fx kursi: 1 USD = ${FX_RATE} UZS`);

  const skuPlain = String(Date.now() % 100000);
  const product = products.create({
    name: 'POS USD Scan Smoke',
    sku: skuPlain,
    sale_price: 100000,
    track_stock: 1,
    current_stock: 0,
    product_units: [{ unit: 'pcs', ratio_to_base: 1, sale_price: 100000, is_default: true }],
  });

  inventory.adjustStock({
    warehouse_id: WH,
    adjustment_type: 'set',
    reason: 'USD promo scan smoke',
    created_by: ADMIN,
    items: [{ product_id: product.id, target_quantity: 50 }],
  });

  const retailTierId = db.prepare(`SELECT id FROM price_tiers WHERE code = 'retail'`).get()?.id;
  assert.ok(retailTierId);
  pricing.setPrice({
    product_id: product.id,
    tier_id: retailTierId,
    currency: 'USD',
    unit: 'pcs',
    price: 10,
  });
  ok('USD retail narxi: $10');

  runStep('getBySku: leading-zero skan (000… → asl SKU)', () => {
    const padded = skuPlain.padStart(skuPlain.length + 3, '0');
    const found = products.getBySku(padded);
    assert.strictEqual(found.id, product.id);
  });

  const promoId = randomUUID();
  const startAt = new Date(Date.now() - 86400000).toISOString();
  const endAt = new Date(Date.now() + 86400000 * 30).toISOString();
  db.prepare(
    `INSERT INTO promotions (id, name, code, type, status, start_at, end_at, priority, combinable)
     VALUES (?, 'Smoke 10%', 'SMOKE10', 'percent_discount', 'active', ?, ?, 10, 0)`,
  ).run(promoId, startAt, endAt);
  db.prepare(
    `INSERT INTO promotion_scope (id, promotion_id, scope_type, scope_ids)
     VALUES (?, ?, 'products', ?)`,
  ).run(randomUUID(), promoId, JSON.stringify([product.id]));
  db.prepare(
    `INSERT INTO promotion_condition (id, promotion_id) VALUES (?, ?)`,
  ).run(randomUUID(), promoId);
  db.prepare(
    `INSERT INTO promotion_reward (id, promotion_id, discount_percent) VALUES (?, ?, ?)`,
  ).run(randomUUID(), promoId, 10);

  const cartLine = {
    product,
    quantity: 2,
    qty_sale: 2,
    qty_base: 2,
    unit_price: 100000,
    discount_amount: 0,
    subtotal: 200000,
    total: 200000,
  };
  const promoApplied = promotions.applyPromotions([cartLine], null, null);
  runStep('applyPromotions: 10% chegirma qo‘llandi', () => {
    assert.strictEqual(promoApplied.length, 1);
    assert.strictEqual(promoApplied[0].price_source, 'promo');
    assert.ok(Number(promoApplied[0].discount_amount) > 0);
    assert.ok(Number(promoApplied[0].total) < 200000);
  });

  const shift = shifts.openShift({ user_id: ADMIN });

  let rejected = false;
  try {
    sales.completePOSOrder(
      { total_amount: 10, shift_id: shift.id, user_id: ADMIN, currency: 'USD' },
      [
        {
          product_id: product.id,
          product_name: product.name,
          quantity: 1,
          qty_sale: 1,
          qty_base: 1,
          unit_price: 10,
          line_total: 10,
        },
      ],
      [{ payment_method: 'cash', amount: 10 }],
    );
  } catch (e) {
    rejected = /fx_rate|VALIDATION/i.test(String(e.message || e.code || ''));
  }
  runStep('USD sotuv: fx_rate yo‘q → rad', () => {
    assert.ok(rejected);
  });

  const usdRes = sales.completePOSOrder(
    {
      total_amount: 20,
      shift_id: shift.id,
      user_id: ADMIN,
      currency: 'USD',
      fx_rate: FX_RATE,
    },
    [
      {
        product_id: product.id,
        product_name: product.name,
        quantity: 2,
        qty_sale: 2,
        qty_base: 2,
        unit_price: 10,
        line_total: 20,
      },
    ],
    [{ payment_method: 'cash', amount: 20 }],
  );
  runStep('USD sotuv: $20 (2×$10) yakunlandi', () => {
    assert.ok(usdRes?.order_id);
    const order = db
      .prepare('SELECT currency, fx_rate, total_amount FROM orders WHERE id = ?')
      .get(usdRes.order_id);
    assert.strictEqual(String(order.currency).toUpperCase(), 'USD');
    assert.strictEqual(Number(order.fx_rate), FX_RATE);
    assert.strictEqual(Number(order.total_amount), 20);
  });

  console.log(`\n=== NATIJA: ${passed} OK, ${failed} FAIL ===\n`);
  if (failed > 0) process.exit(1);
} catch (e) {
  fail('pos usd/promo/scan suite', e);
  console.log(`\n=== NATIJA: ${passed} OK, ${failed} FAIL ===\n`);
  process.exit(1);
} finally {
  try {
    close();
  } catch {
    /* ignore */
  }
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

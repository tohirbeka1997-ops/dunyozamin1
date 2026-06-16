'use strict';

const test = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');

const { getPromoDiscount } = require('./lib/marketplacePromo.cjs');
const {
  ensureLoyaltySchema,
  getBalance,
  redeemPointsForOrder,
  refundOrderRedemption,
  getPointValueSums,
} = require('./lib/marketplaceLoyalty.cjs');

function freshDb() {
  const db = new Database(':memory:');
  ensureLoyaltySchema(db);
  return db;
}

function seedBalance(db, customerId, points) {
  db.prepare(
    `INSERT INTO marketplace_loyalty_accounts (customer_id, points_balance, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(customer_id) DO UPDATE SET points_balance = excluded.points_balance`,
  ).run(customerId, points);
}

function seedPromo(db, row) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS marketplace_promo_codes (
      code TEXT PRIMARY KEY,
      discount_pct INTEGER NULL,
      discount_amount INTEGER NULL,
      min_subtotal INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      valid_until TEXT NULL,
      note TEXT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  db.prepare(
    `INSERT INTO marketplace_promo_codes (code, discount_pct, discount_amount, min_subtotal, active, valid_until)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    row.code,
    row.discount_pct ?? null,
    row.discount_amount ?? null,
    row.min_subtotal ?? 0,
    row.active ?? 1,
    row.valid_until ?? null,
  );
}

test('getPromoDiscount: missing table returns zero', () => {
  const db = freshDb();
  const r = getPromoDiscount(db, 'SAVE10', 50000);
  assert.deepStrictEqual(r, { code: null, discount: 0 });
});

test('getPromoDiscount: percent discount clamped and floored', () => {
  const db = freshDb();
  seedPromo(db, { code: 'SAVE10', discount_pct: 10 });
  const r = getPromoDiscount(db, 'save10', 49999);
  assert.strictEqual(r.code, 'SAVE10');
  assert.strictEqual(r.discount, 4999); // floor(49999 * 10 / 100)
});

test('getPromoDiscount: amount discount and min_subtotal gate', () => {
  const db = freshDb();
  seedPromo(db, { code: 'MINUS5K', discount_amount: 5000, min_subtotal: 30000 });
  assert.strictEqual(getPromoDiscount(db, 'MINUS5K', 20000).discount, 0); // below min
  assert.strictEqual(getPromoDiscount(db, 'MINUS5K', 40000).discount, 5000);
});

test('getPromoDiscount: inactive / expired returns zero', () => {
  const db = freshDb();
  seedPromo(db, { code: 'OFF', discount_pct: 50, active: 0 });
  assert.strictEqual(getPromoDiscount(db, 'OFF', 10000).discount, 0);
  seedPromo(db, { code: 'OLD', discount_pct: 50, valid_until: '2000-01-01T00:00:00Z' });
  assert.strictEqual(getPromoDiscount(db, 'OLD', 10000).discount, 0);
});

test('getPointValueSums: disabled by default', () => {
  const prev = process.env.MARKETPLACE_LOYALTY_POINT_VALUE_SUMS;
  delete process.env.MARKETPLACE_LOYALTY_POINT_VALUE_SUMS;
  assert.strictEqual(getPointValueSums(), 0);
  process.env.MARKETPLACE_LOYALTY_POINT_VALUE_SUMS = '100';
  assert.strictEqual(getPointValueSums(), 100);
  if (prev == null) delete process.env.MARKETPLACE_LOYALTY_POINT_VALUE_SUMS;
  else process.env.MARKETPLACE_LOYALTY_POINT_VALUE_SUMS = prev;
});

test('redeemPointsForOrder: deducts, clamps to balance, idempotent', () => {
  const db = freshDb();
  seedBalance(db, 7, 30);

  const r1 = redeemPointsForOrder(db, { customerId: 7, orderId: 100, points: 20 });
  assert.strictEqual(r1.redeemed, 20);
  assert.strictEqual(getBalance(db, 7), 10);

  // Re-running for the same order must not double-spend.
  const r2 = redeemPointsForOrder(db, { customerId: 7, orderId: 100, points: 20 });
  assert.strictEqual(r2.redeemed, 20);
  assert.strictEqual(getBalance(db, 7), 10);

  // Clamp to available balance for a different order.
  const r3 = redeemPointsForOrder(db, { customerId: 7, orderId: 101, points: 999 });
  assert.strictEqual(r3.redeemed, 10);
  assert.strictEqual(getBalance(db, 7), 0);
});

test('refundOrderRedemption: restores points once', () => {
  const db = freshDb();
  seedBalance(db, 9, 50);
  redeemPointsForOrder(db, { customerId: 9, orderId: 200, points: 30 });
  assert.strictEqual(getBalance(db, 9), 20);

  const ref1 = refundOrderRedemption(db, 200);
  assert.strictEqual(ref1.refunded, 30);
  assert.strictEqual(getBalance(db, 9), 50);

  // Idempotent: second refund is a no-op.
  const ref2 = refundOrderRedemption(db, 200);
  assert.strictEqual(ref2.refunded, 0);
  assert.strictEqual(getBalance(db, 9), 50);
});

test('refundOrderRedemption: no redemption is a safe no-op', () => {
  const db = freshDb();
  const ref = refundOrderRedemption(db, 999);
  assert.strictEqual(ref.refunded, 0);
});

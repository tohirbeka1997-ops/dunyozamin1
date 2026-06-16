'use strict';

function ensureLoyaltySchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS marketplace_loyalty_accounts (
      customer_id INTEGER PRIMARY KEY,
      points_balance INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS marketplace_loyalty_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      points_delta INTEGER NOT NULL,
      order_id INTEGER NULL,
      note TEXT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(order_id, type)
    );

    CREATE INDEX IF NOT EXISTS idx_marketplace_loyalty_ledger_customer
      ON marketplace_loyalty_ledger(customer_id, created_at DESC);
  `);
}

function getPointsPerChunk() {
  const n = Number.parseInt(String(process.env.MARKETPLACE_LOYALTY_POINTS_PER_1000 || '1'), 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function getBalance(db, customerId) {
  ensureLoyaltySchema(db);
  const row = db
    .prepare('SELECT points_balance FROM marketplace_loyalty_accounts WHERE customer_id = ?')
    .get(customerId);
  return Number(row?.points_balance || 0);
}

function listLedger(db, customerId, limit = 20) {
  ensureLoyaltySchema(db);
  const n = Math.max(1, Math.min(100, Number.parseInt(String(limit), 10) || 20));
  return db
    .prepare(
      `
      SELECT type, points_delta, order_id, note, created_at
      FROM marketplace_loyalty_ledger
      WHERE customer_id = ?
      ORDER BY id DESC
      LIMIT ?
    `,
    )
    .all(customerId, n);
}

function awardPaidOrderPoints(db, { customerId, orderId, totalAmount }) {
  ensureLoyaltySchema(db);
  const sums = Math.max(0, Number(totalAmount) || 0);
  const pointsPerChunk = getPointsPerChunk();
  const earned = Math.floor(sums / 1000) * pointsPerChunk;
  if (earned <= 0) {
    return { earned_points: 0, balance: getBalance(db, customerId), inserted: false };
  }

  return db.transaction(() => {
    const exists = db
      .prepare(
        `
        SELECT id FROM marketplace_loyalty_ledger
        WHERE order_id = ? AND type = 'earn_paid_order'
      `,
      )
      .get(orderId);
    if (exists) {
      return { earned_points: 0, balance: getBalance(db, customerId), inserted: false };
    }

    const current = getBalance(db, customerId);
    const next = current + earned;
    db.prepare(
      `
      INSERT INTO marketplace_loyalty_accounts (customer_id, points_balance, updated_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(customer_id) DO UPDATE SET
        points_balance = excluded.points_balance,
        updated_at = excluded.updated_at
    `,
    ).run(customerId, next);

    db.prepare(
      `
      INSERT INTO marketplace_loyalty_ledger (customer_id, type, points_delta, order_id, note)
      VALUES (?, 'earn_paid_order', ?, ?, ?)
    `,
    ).run(customerId, earned, orderId, 'Order paid');

    return { earned_points: earned, balance: next, inserted: true };
  })();
}

/**
 * Sums value of one loyalty point when redeemed at checkout.
 * Redemption is DISABLED unless the operator sets a positive value, so no
 * surprise discounts appear in production before the business configures it.
 */
function getPointValueSums() {
  const n = Number.parseInt(String(process.env.MARKETPLACE_LOYALTY_POINT_VALUE_SUMS || '0'), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Redeem (spend) loyalty points against an order. Deducts from the balance and
 * writes a negative ledger row. MUST be called inside the caller's transaction
 * (uses plain statements, never opens a nested transaction). Idempotent per
 * order via UNIQUE(order_id, type). Clamps to the available balance.
 * @returns {{ redeemed: number }}
 */
function redeemPointsForOrder(db, { customerId, orderId, points }) {
  ensureLoyaltySchema(db);
  const want = Math.max(0, Math.floor(Number(points) || 0));
  if (want <= 0) return { redeemed: 0 };

  const existing = db
    .prepare(`SELECT points_delta FROM marketplace_loyalty_ledger WHERE order_id = ? AND type = 'redeem_order'`)
    .get(orderId);
  if (existing) return { redeemed: Math.abs(Number(existing.points_delta) || 0) };

  const current = getBalance(db, customerId);
  const redeem = Math.min(want, current);
  if (redeem <= 0) return { redeemed: 0 };

  db.prepare(
    `
    INSERT INTO marketplace_loyalty_accounts (customer_id, points_balance, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(customer_id) DO UPDATE SET
      points_balance = excluded.points_balance,
      updated_at = excluded.updated_at
  `,
  ).run(customerId, current - redeem);

  db.prepare(
    `
    INSERT INTO marketplace_loyalty_ledger (customer_id, type, points_delta, order_id, note)
    VALUES (?, 'redeem_order', ?, ?, ?)
  `,
  ).run(customerId, -redeem, orderId, 'Points redeemed at checkout');

  return { redeemed: redeem };
}

/**
 * Refund points that were redeemed for an order (on cancel/expiry). Idempotent:
 * only refunds once, guarded by a `refund_redeem` ledger row. Uses plain
 * statements so it is safe to call from inside or outside a transaction.
 * @returns {{ refunded: number }}
 */
function refundOrderRedemption(db, orderId) {
  ensureLoyaltySchema(db);
  const redeemRow = db
    .prepare(
      `SELECT customer_id, points_delta FROM marketplace_loyalty_ledger
       WHERE order_id = ? AND type = 'redeem_order'`,
    )
    .get(orderId);
  if (!redeemRow) return { refunded: 0 };

  const already = db
    .prepare(`SELECT id FROM marketplace_loyalty_ledger WHERE order_id = ? AND type = 'refund_redeem'`)
    .get(orderId);
  if (already) return { refunded: 0 };

  const pts = Math.abs(Number(redeemRow.points_delta) || 0);
  if (pts <= 0) return { refunded: 0 };

  const customerId = redeemRow.customer_id;
  const current = getBalance(db, customerId);
  db.prepare(
    `
    INSERT INTO marketplace_loyalty_accounts (customer_id, points_balance, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(customer_id) DO UPDATE SET
      points_balance = excluded.points_balance,
      updated_at = excluded.updated_at
  `,
  ).run(customerId, current + pts);

  db.prepare(
    `
    INSERT INTO marketplace_loyalty_ledger (customer_id, type, points_delta, order_id, note)
    VALUES (?, 'refund_redeem', ?, ?, ?)
  `,
  ).run(customerId, pts, orderId, 'Points refunded (order cancelled)');

  return { refunded: pts };
}

module.exports = {
  ensureLoyaltySchema,
  getBalance,
  listLedger,
  awardPaidOrderPoints,
  getPointValueSums,
  redeemPointsForOrder,
  refundOrderRedemption,
};

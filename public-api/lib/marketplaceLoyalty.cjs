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

module.exports = {
  ensureLoyaltySchema,
  getBalance,
  listLedger,
  awardPaidOrderPoints,
};

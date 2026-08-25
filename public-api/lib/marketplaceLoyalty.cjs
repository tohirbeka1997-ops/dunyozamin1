'use strict';

const { randomUUID } = require('crypto');

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

function hasTable(db, name) {
  try {
    return !!db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(name);
  } catch {
    return false;
  }
}

function hasCustomersCol(db, col) {
  try {
    if (!hasTable(db, 'customers')) return false;
    return db.prepare(`PRAGMA table_info(customers)`).all().some((c) => c.name === col);
  } catch {
    return false;
  }
}

/**
 * marketplace_customers.id → bound POS customers.id
 */
function resolvePosCustomerId(db, marketplaceCustomerId) {
  const mcId = Number.parseInt(String(marketplaceCustomerId), 10);
  if (!Number.isFinite(mcId) || mcId <= 0) return null;
  if (!hasTable(db, 'marketplace_customer_bindings')) return null;
  const row = db
    .prepare(
      `SELECT pos_customer_id FROM marketplace_customer_bindings WHERE marketplace_customer_id = ? LIMIT 1`,
    )
    .get(mcId);
  return row?.pos_customer_id || null;
}

function readPosBonusPoints(db, posCustomerId) {
  if (!posCustomerId || !hasCustomersCol(db, 'bonus_points')) return 0;
  const row = db.prepare('SELECT bonus_points FROM customers WHERE id = ?').get(posCustomerId);
  return Math.floor(Number(row?.bonus_points) || 0);
}

function writePosBonusPoints(db, posCustomerId, nextBalance) {
  if (!posCustomerId || !hasCustomersCol(db, 'bonus_points')) return;
  db.prepare(
    `UPDATE customers SET bonus_points = ?, updated_at = datetime('now') WHERE id = ?`,
  ).run(Math.floor(Number(nextBalance) || 0), posCustomerId);
}

function insertPosBonusLedger(db, { posCustomerId, type, points, orderId, note }) {
  if (!posCustomerId || !hasTable(db, 'customer_bonus_ledger')) return;
  try {
    db.prepare(
      `
      INSERT INTO customer_bonus_ledger (id, customer_id, type, points, order_id, note, created_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    `,
    ).run(randomUUID(), posCustomerId, type, points, orderId != null ? String(orderId) : null, note || null);
  } catch (e) {
    console.warn('[marketplaceLoyalty] customer_bonus_ledger insert skip:', e?.message || e);
  }
}

function getPointsPerChunk() {
  const n = Number.parseInt(String(process.env.MARKETPLACE_LOYALTY_POINTS_PER_1000 || '1'), 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/**
 * Unified balance: customers.bonus_points on the bound POS customer.
 * @param {object} db
 * @param {number} customerId marketplace_customers.id
 */
function getBalance(db, customerId) {
  ensureLoyaltySchema(db);
  const posId = resolvePosCustomerId(db, customerId);
  if (posId) return readPosBonusPoints(db, posId);

  // Legacy fallback before binding exists.
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
  const mcId = Number.parseInt(String(customerId), 10);
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

    const posId = resolvePosCustomerId(db, mcId);
    const current = posId ? readPosBonusPoints(db, posId) : getBalance(db, mcId);
    const next = current + earned;

    if (posId) {
      writePosBonusPoints(db, posId, next);
      insertPosBonusLedger(db, {
        posCustomerId: posId,
        type: 'earn',
        points: earned,
        orderId,
        note: `Onlayn buyurtma #${orderId}`,
      });
    } else {
      db.prepare(
        `
        INSERT INTO marketplace_loyalty_accounts (customer_id, points_balance, updated_at)
        VALUES (?, ?, datetime('now'))
        ON CONFLICT(customer_id) DO UPDATE SET
          points_balance = excluded.points_balance,
          updated_at = excluded.updated_at
      `,
      ).run(mcId, next);
    }

    db.prepare(
      `
      INSERT INTO marketplace_loyalty_ledger (customer_id, type, points_delta, order_id, note)
      VALUES (?, 'earn_paid_order', ?, ?, ?)
    `,
    ).run(mcId, earned, orderId, 'Order paid');

    return { earned_points: earned, balance: next, inserted: true };
  })();
}

function getPointValueSums() {
  const n = Number.parseInt(String(process.env.MARKETPLACE_LOYALTY_POINT_VALUE_SUMS || '0'), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function redeemPointsForOrder(db, { customerId, orderId, points }) {
  ensureLoyaltySchema(db);
  const mcId = Number.parseInt(String(customerId), 10);
  const want = Math.max(0, Math.floor(Number(points) || 0));
  if (want <= 0) return { redeemed: 0 };

  const existing = db
    .prepare(`SELECT points_delta FROM marketplace_loyalty_ledger WHERE order_id = ? AND type = 'redeem_order'`)
    .get(orderId);
  if (existing) return { redeemed: Math.abs(Number(existing.points_delta) || 0) };

  const posId = resolvePosCustomerId(db, mcId);
  const current = posId ? readPosBonusPoints(db, posId) : getBalance(db, mcId);
  const redeem = Math.min(want, current);
  if (redeem <= 0) return { redeemed: 0 };

  const next = current - redeem;
  if (posId) {
    writePosBonusPoints(db, posId, next);
    insertPosBonusLedger(db, {
      posCustomerId: posId,
      type: 'redeem',
      points: -redeem,
      orderId,
      note: `Onlayn buyurtma #${orderId} ball ishlatildi`,
    });
  } else {
    db.prepare(
      `
      INSERT INTO marketplace_loyalty_accounts (customer_id, points_balance, updated_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(customer_id) DO UPDATE SET
        points_balance = excluded.points_balance,
        updated_at = excluded.updated_at
    `,
    ).run(mcId, next);
  }

  db.prepare(
    `
    INSERT INTO marketplace_loyalty_ledger (customer_id, type, points_delta, order_id, note)
    VALUES (?, 'redeem_order', ?, ?, ?)
  `,
  ).run(mcId, -redeem, orderId, 'Points redeemed at checkout');

  return { redeemed: redeem };
}

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

  const mcId = redeemRow.customer_id;
  const posId = resolvePosCustomerId(db, mcId);
  const current = posId ? readPosBonusPoints(db, posId) : getBalance(db, mcId);
  const next = current + pts;

  if (posId) {
    writePosBonusPoints(db, posId, next);
    insertPosBonusLedger(db, {
      posCustomerId: posId,
      type: 'adjust',
      points: pts,
      orderId,
      note: `Onlayn buyurtma #${orderId} ball qaytarildi`,
    });
  } else {
    db.prepare(
      `
      INSERT INTO marketplace_loyalty_accounts (customer_id, points_balance, updated_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(customer_id) DO UPDATE SET
        points_balance = excluded.points_balance,
        updated_at = excluded.updated_at
    `,
    ).run(mcId, next);
  }

  db.prepare(
    `
    INSERT INTO marketplace_loyalty_ledger (customer_id, type, points_delta, order_id, note)
    VALUES (?, 'refund_redeem', ?, ?, ?)
  `,
  ).run(mcId, pts, orderId, 'Points refunded (order cancelled)');

  return { refunded: pts };
}

module.exports = {
  ensureLoyaltySchema,
  resolvePosCustomerId,
  getBalance,
  listLedger,
  awardPaidOrderPoints,
  getPointValueSums,
  redeemPointsForOrder,
  refundOrderRedemption,
};

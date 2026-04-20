'use strict';

/**
 * Public API bilan bir xil pos.db — faqat o'qish (bot buyurtmalar ro'yxati).
 * public-api/lib/db.cjs dan foydalanadi.
 */

function listRecentWebOrders(telegramUserId, limit = 5) {
  let db;
  try {
    db = require('../../public-api/lib/db.cjs').getDb();
  } catch (e) {
    return { ok: false, reason: e.message || String(e) };
  }
  try {
    const rows = db
      .prepare(
        `
      SELECT wo.order_number, wo.status, wo.total_amount, wo.created_at
      FROM web_orders wo
      INNER JOIN marketplace_customers mc ON mc.id = wo.customer_id
      WHERE mc.telegram_id = ?
      ORDER BY wo.created_at DESC
      LIMIT ?
    `
      )
      .all(telegramUserId, limit);
    return { ok: true, rows };
  } catch (e) {
    if (String(e.message || '').includes('no such table')) {
      return { ok: false, reason: 'migrations_pending' };
    }
    throw e;
  }
}

module.exports = { listRecentWebOrders };

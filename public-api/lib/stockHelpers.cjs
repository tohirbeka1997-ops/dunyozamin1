'use strict';

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} productId
 * @returns {number}
 */
function getAvailableStock(db, productId) {
  try {
    const row = db
      .prepare(
        `
      SELECT COALESCE(SUM(available_quantity), 0) AS q
      FROM stock_balances
      WHERE product_id = ?
    `
      )
      .get(productId);
    return Number(row?.q || 0);
  } catch (e) {
    if (String(e.message || '').includes('no such table')) return 0;
    throw e;
  }
}

module.exports = { getAvailableStock };

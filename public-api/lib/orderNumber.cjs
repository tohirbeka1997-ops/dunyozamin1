'use strict';

/**
 * @param {import('better-sqlite3').Database} db
 * @returns {string} WO-2026-00001
 */
function allocateOrderNumber(db) {
  const year = new Date().getFullYear();
  return db.transaction(() => {
    db.prepare(
      `
      INSERT INTO marketplace_order_seq (year, seq) VALUES (?, 0)
      ON CONFLICT(year) DO NOTHING
    `
    ).run(year);
    db.prepare(`UPDATE marketplace_order_seq SET seq = seq + 1 WHERE year = ?`).run(year);
    const row = db.prepare(`SELECT seq FROM marketplace_order_seq WHERE year = ?`).get(year);
    const seq = Number(row?.seq) || 1;
    return `WO-${year}-${String(seq).padStart(5, '0')}`;
  })();
}

module.exports = { allocateOrderNumber };

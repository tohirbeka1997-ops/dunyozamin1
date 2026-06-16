'use strict';

/** @param {import('better-sqlite3').Database} db @param {string} categoryId */
function getCategorySubtreeIds(db, categoryId) {
  const root = String(categoryId || '').trim();
  if (!root) return [];
  try {
    const rows = db
      .prepare(
        `
      WITH RECURSIVE sub AS (
        SELECT id FROM categories WHERE id = ?
        UNION ALL
        SELECT c.id FROM categories c
        INNER JOIN sub s ON c.parent_id = s.id
      )
      SELECT id FROM sub
    `
      )
      .all(root);
    const ids = rows.map((r) => String(r.id)).filter(Boolean);
    return ids.length > 0 ? ids : [root];
  } catch {
    return [root];
  }
}

module.exports = { getCategorySubtreeIds };

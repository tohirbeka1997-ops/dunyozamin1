'use strict';

/**
 * Kategoriya daraxti: marketplace va POS filtrlari uchun bolalar ID lari.
 */

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} categoryId
 * @returns {string[]}
 */
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

/**
 * Ro'yxatdan (xotirada) bolalar ID lari — renderer uchun.
 * @param {Array<{ id: string; parent_id?: string | null }>} categories
 * @param {string} categoryId
 */
function getSubtreeIdsFromList(categories, categoryId) {
  const root = String(categoryId || '').trim();
  if (!root) return [];
  const ids = new Set([root]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const c of categories) {
      if (c.parent_id && ids.has(String(c.parent_id)) && !ids.has(String(c.id))) {
        ids.add(String(c.id));
        changed = true;
      }
    }
  }
  return [...ids];
}

/**
 * Har bir kategoriya uchun mahsulot soni (to'g'ridan-to'g'ri + bolalar).
 * @param {Array<{ id: string; parent_id?: string | null; products_count?: number }>} categories
 */
function rollupProductCounts(categories) {
  const direct = new Map();
  for (const c of categories) {
    direct.set(String(c.id), Number(c.products_count) || 0);
  }
  const memo = new Map();
  const sum = (id) => {
    if (memo.has(id)) return memo.get(id);
    let total = direct.get(id) || 0;
    for (const c of categories) {
      if (String(c.parent_id || '') === id) {
        total += sum(String(c.id));
      }
    }
    memo.set(id, total);
    return total;
  };
  return categories.map((c) => ({
    ...c,
    products_count_direct: direct.get(String(c.id)) || 0,
    products_count: sum(String(c.id)),
  }));
}

module.exports = {
  getCategorySubtreeIds,
  getSubtreeIdsFromList,
  rollupProductCounts,
};

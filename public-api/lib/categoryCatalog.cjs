'use strict';

/** @type {WeakMap<import('better-sqlite3').Database, Set<string>>} */
const catColsCache = new WeakMap();

/**
 * @param {import('better-sqlite3').Database} db
 * @returns {Set<string>}
 */
function getCategoryColumnSet(db) {
  if (catColsCache.has(db)) return /** @type {Set<string>} */ (catColsCache.get(db));
  try {
    const rows = db.prepare(`PRAGMA table_info(categories)`).all();
    const set = new Set((rows || []).map((r) => (r && r.name ? String(r.name) : '')).filter(Boolean));
    catColsCache.set(db, set);
    return set;
  } catch {
    const empty = new Set();
    catColsCache.set(db, empty);
    return empty;
  }
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} name
 */
function hasCategoryColumn(db, name) {
  return getCategoryColumnSet(db).has(name);
}

module.exports = { getCategoryColumnSet, hasCategoryColumn };

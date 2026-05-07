'use strict';

/** @type {WeakMap<import('better-sqlite3').Database, Set<string>>} */
const productColsCache = new WeakMap();

/**
 * @param {import('better-sqlite3').Database} db
 * @returns {Set<string>}
 */
function getProductsColumnSet(db) {
  if (productColsCache.has(db)) return /** @type {Set<string>} */ (productColsCache.get(db));
  try {
    const rows = db.prepare(`PRAGMA table_info(products)`).all();
    const set = new Set((rows || []).map((r) => (r && r.name ? String(r.name) : '')).filter(Boolean));
    productColsCache.set(db, set);
    return set;
  } catch {
    const empty = new Set();
    productColsCache.set(db, empty);
    return empty;
  }
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} name
 */
function hasProductsColumn(db, name) {
  return getProductsColumnSet(db).has(name);
}

/**
 * @param {import('better-sqlite3').Database} db
 * @returns {boolean}
 */
function hasShowInMarketplaceColumn(db) {
  return hasProductsColumn(db, 'show_in_marketplace');
}

module.exports = { hasShowInMarketplaceColumn, hasProductsColumn, getProductsColumnSet };

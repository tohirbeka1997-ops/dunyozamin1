'use strict';

const express = require('express');

const router = express.Router();

function parseIntParam(v, fallback, min, max) {
  const n = Number.parseInt(String(v ?? ''), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function boolCol(v) {
  return v === 1 || v === true;
}

/**
 * Umumiy qoldiq: barcha omborlar bo'yicha available_quantity yig'indisi
 */
function stockSubquery() {
  return `
    SELECT product_id, COALESCE(SUM(available_quantity), 0) AS stock_qty
    FROM stock_balances
    GROUP BY product_id
  `;
}

/** @param {import('better-sqlite3').Database} db */
function listProducts(db, query) {
  const page = parseIntParam(query.page, 1, 1, 10_000);
  const limit = parseIntParam(query.limit, 20, 1, 100);
  const offset = (page - 1) * limit;
  const categoryId = query.category ? String(query.category).trim() : '';
  const q = query.q ? String(query.q).trim() : '';
  const sort = query.sort === 'price_desc' ? 'price_desc' : query.sort === 'name' ? 'name' : 'price_asc';

  const conditions = ['p.is_active = 1'];
  const params = [];

  if (categoryId) {
    conditions.push('p.category_id = ?');
    params.push(categoryId);
  }

  if (q) {
    const needle = String(q).toLowerCase();
    conditions.push(
      '(INSTR(LOWER(p.name), ?) > 0 OR INSTR(LOWER(p.sku), ?) > 0 OR INSTR(LOWER(IFNULL(p.barcode,\'\')), ?) > 0)'
    );
    params.push(needle, needle, needle);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  let orderBy = 'p.sale_price ASC';
  if (sort === 'price_desc') orderBy = 'p.sale_price DESC';
  else if (sort === 'name') orderBy = 'p.name COLLATE NOCASE ASC';

  const countSql = `
    SELECT COUNT(*) AS total
    FROM products p
    ${whereClause}
  `;
  const totalRow = db.prepare(countSql).get(...params);
  const total = Number(totalRow?.total || 0);

  const sql = `
    SELECT
      p.id,
      p.sku,
      p.name,
      p.description,
      p.sale_price,
      p.category_id,
      p.track_stock,
      p.image_url,
      COALESCE(sb.stock_qty, 0) AS stock_qty
    FROM products p
    LEFT JOIN (${stockSubquery()}) sb ON sb.product_id = p.id
    ${whereClause}
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?
  `;

  const rows = db.prepare(sql).all(...params, limit, offset);

  const items = rows.map((row) => {
    const track = boolCol(row.track_stock);
    const qty = Number(row.stock_qty) || 0;
    const priceUzs = Math.round(Number(row.sale_price) || 0);
    let isAvailable = true;
    let stockQuantity = Math.floor(qty);
    if (track) {
      isAvailable = stockQuantity > 0;
    } else {
      stockQuantity = null;
    }
    return {
      id: row.id,
      sku: row.sku,
      name: row.name,
      description: row.description,
      sale_price: Number(row.sale_price) || 0,
      price_uzs: priceUzs,
      category_id: row.category_id,
      track_stock: track,
      stock_quantity: stockQuantity,
      is_available: isAvailable,
      image_url: row.image_url || null,
    };
  });

  return {
    data: items,
    meta: {
      page,
      limit,
      total,
      total_pages: Math.max(1, Math.ceil(total / limit)),
    },
  };
}

/** @param {import('better-sqlite3').Database} db */
function getProductById(db, id) {
  const row = db
    .prepare(
      `
    SELECT
      p.id,
      p.sku,
      p.name,
      p.description,
      p.sale_price,
      p.category_id,
      p.track_stock,
      p.image_url,
      COALESCE(sb.stock_qty, 0) AS stock_qty
    FROM products p
    LEFT JOIN (${stockSubquery()}) sb ON sb.product_id = p.id
    WHERE p.id = ? AND p.is_active = 1
  `
    )
    .get(id);

  if (!row) return null;

  let images = [];
  try {
    images = db
      .prepare(
        `
      SELECT id, url, sort_order, is_primary
      FROM product_images
      WHERE product_id = ?
      ORDER BY is_primary DESC, sort_order ASC, created_at ASC
    `
      )
      .all(id);
  } catch (e) {
    if (!String(e.message || '').includes('no such table')) throw e;
  }

  const track = boolCol(row.track_stock);
  const qty = Number(row.stock_qty) || 0;
  const priceUzs = Math.round(Number(row.sale_price) || 0);
  let isAvailable = true;
  let stockQuantity = Math.floor(qty);
  if (track) {
    isAvailable = stockQuantity > 0;
  } else {
    stockQuantity = null;
  }

  const imageList = images.map((im) => ({
    id: im.id,
    url: im.url,
    sort_order: im.sort_order,
    is_primary: boolCol(im.is_primary),
  }));

  return {
    id: row.id,
    sku: row.sku,
    name: row.name,
    description: row.description,
    sale_price: Number(row.sale_price) || 0,
    price_uzs: priceUzs,
    category_id: row.category_id,
    track_stock: track,
    stock_quantity: stockQuantity,
    is_available: isAvailable,
    image_url: row.image_url || null,
    images: imageList,
  };
}

/** @param {import('better-sqlite3').Database} db */
function listCategories(db) {
  return db
    .prepare(
      `
    SELECT id, parent_id, name, description, color, icon, sort_order
    FROM categories
    WHERE is_active = 1
    ORDER BY sort_order ASC, name COLLATE NOCASE ASC
  `
    )
    .all();
}

function mountCatalogRoutes(dbGetter) {
  router.get('/products', (req, res) => {
    try {
      const db = dbGetter();
      const result = listProducts(db, req.query);
      res.json(result);
    } catch (e) {
      console.error('[catalog] GET /products', e);
      res.status(500).json({ error: 'internal_error' });
    }
  });

  router.get('/products/:id', (req, res) => {
    try {
      const db = dbGetter();
      const product = getProductById(db, req.params.id);
      if (!product) {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      res.json(product);
    } catch (e) {
      console.error('[catalog] GET /products/:id', e);
      res.status(500).json({ error: 'internal_error' });
    }
  });

  router.get('/categories', (req, res) => {
    try {
      const db = dbGetter();
      const rows = listCategories(db);
      res.json({ data: rows });
    } catch (e) {
      console.error('[catalog] GET /categories', e);
      res.status(500).json({ error: 'internal_error' });
    }
  });

  return router;
}

module.exports = { mountCatalogRoutes, listProducts, getProductById, listCategories };

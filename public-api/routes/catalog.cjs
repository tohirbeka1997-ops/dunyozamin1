'use strict';

const express = require('express');
const { hasShowInMarketplaceColumn, hasProductsColumn } = require('../lib/productVisibility.cjs');
const { hasCategoryColumn } = require('../lib/categoryCatalog.cjs');
const { resolveCatalogImageUrl } = require('../lib/productImageUrl.cjs');
const { getCategorySubtreeIds } = require('../lib/categoryTree.cjs');
const { rankProductForQuery, expandQueryTokens, normalizeText } = require('../lib/searchRank.cjs');
const { catalogStockSubquery } = require('../lib/authoritativeStock.cjs');
const { formatYmdInTimeZone } = require('../../electron/lib/timezone.cjs');

/**
 * DB: JSON [{ name, value }, ...]
 * @param {unknown} raw
 * @returns {{ name: string; value: string }[]}
 */
function parseVariantOptions(raw) {
  if (raw == null || raw === '') return [];
  let parsed;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [];
    }
  } else if (Array.isArray(raw)) {
    parsed = raw;
  } else {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out = [];
  for (const it of parsed) {
    if (!it || typeof it !== 'object') continue;
    const name = String(it.name ?? '').trim().slice(0, 40);
    const value = String(it.value ?? '').trim().slice(0, 120);
    if (!name || !value) continue;
    out.push({ name, value });
    if (out.length >= 16) break;
  }
  return out;
}

const router = express.Router();

/**
 * Trending products cache.
 *
 * Why bounded? Without a cap, every distinct combination of `limit / days
 * / recent_days` query params spawns a new entry that lives forever, so
 * a misbehaving client (or attacker) can pump the process RSS by
 * iterating values.
 *
 * We use a simple FIFO eviction backed by `Map` insertion order — when
 * the cache grows past `MAX` entries we delete the oldest one. This is
 * not strict LRU but is good enough for a trending list (typical
 * cardinality is <10 unique keys per deployment) and keeps the hot path
 * O(1) without a separate doubly-linked list.
 */
const TRENDING_CACHE_MAX = Number.parseInt(
  process.env.PUBLIC_API_TRENDING_CACHE_MAX || '64',
  10,
) || 64;
const trendingCache = new Map();

/** Maximum length of the catalog `?q=` search string. Protects the
 *  search-rank pipeline (regex tokenization, normalize, etc.) and the
 *  SQL LIKE planner from pathological inputs. Two hundred characters
 *  comfortably covers any real product name search. */
const MAX_SEARCH_QUERY_LEN = 200;

function parseIntParam(v, fallback, min, max) {
  const n = Number.parseInt(String(v ?? ''), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function getNumericSetting(db, key, fallback, min = -Infinity, max = Infinity) {
  try {
    const row = db.prepare('SELECT value, type FROM settings WHERE key = ?').get(key);
    if (!row) return fallback;
    let n = Number.parseFloat(String(row.value ?? ''));
    if (row.type === 'boolean') {
      n = String(row.value) === '1' || String(row.value).toLowerCase() === 'true' ? 1 : 0;
    }
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  } catch {
    return fallback;
  }
}

function boolCol(v) {
  return v === 1 || v === true;
}

/** Products in categories hidden from marketplace are excluded from catalog browse. */
function marketplaceVisibleCategorySql(db) {
  if (!hasCategoryColumn(db, 'show_in_marketplace')) return null;
  return `(
    p.category_id IS NULL
    OR EXISTS (
      SELECT 1 FROM categories c
      WHERE c.id = p.category_id
        AND c.is_active = 1
        AND COALESCE(c.show_in_marketplace, 1) = 1
    )
  )`;
}

/** @param {import('express').Request} req */
function rowToCatalogItem(row, req, voCol) {
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
    image_url: resolveCatalogImageUrl(row.image_url, req),
    options: voCol ? parseVariantOptions(row.variant_options) : [],
  };
}

/** @param {import('better-sqlite3').Database} db @param {string} categoryId */
function isCategoryVisibleInMarketplace(db, categoryId) {
  if (!categoryId) return true;
  if (!hasCategoryColumn(db, 'show_in_marketplace')) return true;
  const row = db
    .prepare(
      `SELECT is_active, show_in_marketplace FROM categories WHERE id = ? LIMIT 1`,
    )
    .get(categoryId);
  if (!row) return false;
  if (row.is_active !== 1 && row.is_active !== true) return false;
  return row.show_in_marketplace === undefined || row.show_in_marketplace === null
    ? true
    : row.show_in_marketplace === 1 || row.show_in_marketplace === true;
}

function parseEnvNumber(name, fallback, min = -Infinity, max = Infinity) {
  const raw = process.env[name];
  const n = Number.parseFloat(String(raw ?? ''));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function getTrendingCacheTtlMs() {
  return parseEnvNumber('PUBLIC_API_TRENDING_CACHE_MS', 60_000, 0, 10 * 60 * 1000);
}

/** Authoritative stock: v_product_stock (inventory_movements) minus active reserve. */
function stockSubquery(db) {
  return catalogStockSubquery(db);
}

/** @param {import('better-sqlite3').Database} db @param {import('express').Request} req */
function listProducts(db, query, req) {
  const page = parseIntParam(query.page, 1, 1, 10_000);
  const limit = parseIntParam(query.limit, 20, 1, 100);
  const offset = (page - 1) * limit;
  const categoryId = query.category ? String(query.category).trim() : '';
  // Cap incoming search strings before they hit ranking/SQL — see
  // MAX_SEARCH_QUERY_LEN comment.
  const q = query.q ? String(query.q).trim().slice(0, MAX_SEARCH_QUERY_LEN) : '';
  const sort = query.sort === 'price_desc' ? 'price_desc' : query.sort === 'name' ? 'name' : 'price_asc';

  const conditions = ['p.is_active = 1'];
  if (hasShowInMarketplaceColumn(db)) {
    conditions.push('p.show_in_marketplace = 1');
  }
  const catVisSql = marketplaceVisibleCategorySql(db);
  if (catVisSql) {
    conditions.push(catVisSql);
  }
  const params = [];

  if (categoryId) {
    const subtreeIds = getCategorySubtreeIds(db, categoryId);
    if (subtreeIds.length === 1) {
      conditions.push('p.category_id = ?');
      params.push(subtreeIds[0]);
    } else {
      conditions.push(`p.category_id IN (${subtreeIds.map(() => '?').join(', ')})`);
      params.push(...subtreeIds);
    }
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  let orderBy = 'p.sale_price ASC';
  if (sort === 'price_desc') orderBy = 'p.sale_price DESC';
  else if (sort === 'name') orderBy = 'p.name COLLATE NOCASE ASC';

  const voCol = hasProductsColumn(db, 'variant_options');
  const voSelect = voCol ? ', p.variant_options' : '';
  const baseSelectSql = `
    SELECT
      p.id,
      p.sku,
      p.name,
      p.description,
      p.sale_price,
      p.category_id,
      p.track_stock,
      p.image_url,
      p.barcode,
      COALESCE(sb.stock_qty, 0) AS stock_qty
      ${voSelect}
    FROM products p
    LEFT JOIN (${stockSubquery(db)}) sb ON sb.product_id = p.id
    ${whereClause}
  `;

  let rows = [];
  let total = 0;
  const normalizedQ = normalizeText(q);
  if (normalizedQ) {
    const prefilterDefault = Math.max(100, Number.parseInt(String(process.env.SEARCH_PREFILTER_LIMIT || '500'), 10) || 500);
    const prefilterLimit = Math.floor(
      getNumericSetting(db, 'marketplace.search_prefilter_limit', prefilterDefault, 100, 5000),
    );
    const expanded = expandQueryTokens(normalizedQ).slice(0, 10);
    const likeConditions = expanded.map(() => '(LOWER(p.name) LIKE ? OR LOWER(p.sku) LIKE ? OR LOWER(IFNULL(p.barcode, \'\')) LIKE ?)');
    const likeParams = [];
    for (const token of expanded) {
      const pattern = `%${token}%`;
      likeParams.push(pattern, pattern, pattern);
    }
    const prefilterSql = likeConditions.length
      ? `${baseSelectSql} AND (${likeConditions.join(' OR ')}) ORDER BY p.name COLLATE NOCASE ASC LIMIT ${prefilterLimit}`
      : `${baseSelectSql} ORDER BY p.name COLLATE NOCASE ASC LIMIT ${prefilterLimit}`;
    const prefiltered = db.prepare(prefilterSql).all(...params, ...likeParams);
    const scored = prefiltered
      .map((row) => ({ row, score: rankProductForQuery(row, normalizedQ) }))
      .filter((it) => it.score > 0);
    scored.sort((a, b) => {
      // qidiruvda default tartib: relevance, lekin explicit sort so'ralgan bo'lsa uni birinchi o'ringa qo'yamiz.
      if (sort === 'price_asc') {
        const ap = Number(a.row.sale_price || 0);
        const bp = Number(b.row.sale_price || 0);
        if (ap !== bp) return ap - bp;
      } else if (sort === 'price_desc') {
        const ap = Number(a.row.sale_price || 0);
        const bp = Number(b.row.sale_price || 0);
        if (ap !== bp) return bp - ap;
      } else if (b.score !== a.score) {
        return b.score - a.score;
      }
      if (b.score !== a.score) return b.score - a.score;
      return String(a.row.name || '').localeCompare(String(b.row.name || ''), 'uz');
    });
    total = scored.length;
    const searchPrefilterTruncated = prefiltered.length >= prefilterLimit;
    rows = scored.slice(offset, offset + limit).map((it) => it.row);
    return {
      data: rows.map((row) => rowToCatalogItem(row, req, voCol)),
      meta: {
        page,
        limit,
        total,
        total_pages: Math.max(1, Math.ceil(total / limit)),
        search_prefilter_limit: prefilterLimit,
        search_prefilter_truncated: searchPrefilterTruncated,
      },
    };
  } else {
    const countSql = `
      SELECT COUNT(*) AS total
      FROM products p
      ${whereClause}
    `;
    const totalRow = db.prepare(countSql).get(...params);
    total = Number(totalRow?.total || 0);
    const sql = `
      ${baseSelectSql}
      ORDER BY ${orderBy}
      LIMIT ? OFFSET ?
    `;
    rows = db.prepare(sql).all(...params, limit, offset);
  }

  const items = rows.map((row) => rowToCatalogItem(row, req, voCol));

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

/** @param {import('better-sqlite3').Database} db @param {import('express').Request} req */
function getProductById(db, id, req) {
  const mpVis = hasShowInMarketplaceColumn(db);
  const voCol = hasProductsColumn(db, 'variant_options');
  const voSelect = voCol ? ', p.variant_options' : '';
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
      ${voSelect}
    FROM products p
    LEFT JOIN (${stockSubquery(db)}) sb ON sb.product_id = p.id
    WHERE p.id = ? AND p.is_active = 1
      ${mpVis ? 'AND p.show_in_marketplace = 1' : ''}
  `
    )
    .get(id);

  if (!row) return null;
  if (!isCategoryVisibleInMarketplace(db, row.category_id)) return null;

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
    url: resolveCatalogImageUrl(im.url, req),
    sort_order: im.sort_order,
    is_primary: boolCol(im.is_primary),
  }));

  const primaryImage =
    resolveCatalogImageUrl(row.image_url, req) ||
    imageList.find((im) => im.url)?.url ||
    null;

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
    image_url: primaryImage,
    images: imageList,
    options: voCol ? parseVariantOptions(row.variant_options) : [],
  };
}

/**
 * Drop categories whose ancestor chain is not fully marketplace-visible.
 *
 * The query already filters to active + marketplace-visible rows, but that
 * can leave "orphans": a visible child whose parent was hidden (or made
 * inactive). The mini-app builds its drill-down tree from `parent_id`, so an
 * orphan would group under a parent id that isn't in the payload — making it
 * unreachable from the root (you can never tap the hidden parent to drill in).
 *
 * We treat marketplace visibility as cascading: hiding a branch root hides the
 * whole branch. We iteratively remove any row whose non-null `parent_id` is
 * absent from the visible set until the set is stable (handles multi-level
 * cascades, e.g. Santexnika hidden → Fitings dropped → Kran dropped …).
 *
 * @param {Array<{ id: string|number, parent_id: string|number|null }>} rows
 */
function pruneOrphanCategories(rows) {
  let kept = rows;
  const present = new Set(kept.map((r) => String(r.id)));
  let changed = true;
  while (changed) {
    changed = false;
    const next = kept.filter((r) => {
      const pid = r.parent_id == null ? '' : String(r.parent_id);
      // Root rows (no parent) always stay; children stay only if their
      // parent is still in the visible set.
      if (!pid) return true;
      return present.has(pid);
    });
    if (next.length !== kept.length) {
      kept = next;
      present.clear();
      for (const r of kept) present.add(String(r.id));
      changed = true;
    }
  }
  return kept;
}

/** @param {import('better-sqlite3').Database} db */
function listCategories(db) {
  const mp = hasCategoryColumn(db, 'show_in_marketplace');
  const img = hasCategoryColumn(db, 'image_url');
  const extra = [img ? 'c.image_url' : '', mp ? 'c.show_in_marketplace' : ''].filter(Boolean).join(', ');
  const extraSql = extra ? `, ${extra}` : '';
  const mpWhere = mp ? 'AND COALESCE(c.show_in_marketplace, 1) = 1' : '';
  const rows = db
    .prepare(
      `
    SELECT c.id, c.parent_id, c.name, c.description, c.color, c.icon, c.sort_order
      ${extraSql}
    FROM categories c
    WHERE c.is_active = 1
    ${mpWhere}
    ORDER BY c.sort_order ASC, c.name COLLATE NOCASE ASC
  `
    )
    .all();
  return pruneOrphanCategories(rows);
}

/** @param {import('better-sqlite3').Database} db @param {import('express').Request} req */
function listTrendingProducts(db, query, req) {
  const limit = parseIntParam(query.limit, 8, 1, 24);
  const days = parseIntParam(query.days, 30, 1, 120);
  const fromIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const recentDays = parseIntParam(query.recent_days, 7, 1, Math.min(30, days));
  const recentFromIso = new Date(Date.now() - recentDays * 24 * 60 * 60 * 1000).toISOString();
  const envRecentWeight = parseEnvNumber('TRENDING_RECENT_WEIGHT', 2, 0, 20);
  const envAvailBonus = parseEnvNumber('TRENDING_AVAILABILITY_BONUS', 8, 0, 100);
  const envMarginDivisor = parseEnvNumber('TRENDING_MARGIN_DIVISOR', 1000, 1, 1_000_000);
  const envMarginCap = parseEnvNumber('TRENDING_MARGIN_CAP', 80, 0, 10_000);
  const recentWeight = getNumericSetting(db, 'marketplace.trending_recent_weight', envRecentWeight, 0, 20);
  const availabilityBonusValue = getNumericSetting(db, 'marketplace.trending_availability_bonus', envAvailBonus, 0, 100);
  const marginDivisor = getNumericSetting(db, 'marketplace.trending_margin_divisor', envMarginDivisor, 1, 1_000_000);
  const marginCap = getNumericSetting(db, 'marketplace.trending_margin_cap', envMarginCap, 0, 10_000);
  const mpVis = hasShowInMarketplaceColumn(db);
  const voCol = hasProductsColumn(db, 'variant_options');
  const costCol = hasProductsColumn(db, 'cost_price');
  const voSelect = voCol ? ', p.variant_options' : '';
  const mpWhere = mpVis ? 'AND p.show_in_marketplace = 1' : '';
  const catVisSql = marketplaceVisibleCategorySql(db);
  const catWhere = catVisSql ? `AND ${catVisSql}` : '';
  const sql = `
    WITH web_sales AS (
      SELECT
        wi.product_id,
        SUM(COALESCE(wi.quantity, 0)) AS qty_total,
        SUM(CASE WHEN wo.created_at >= ? THEN COALESCE(wi.quantity, 0) ELSE 0 END) AS qty_recent
      FROM web_order_items wi
      INNER JOIN web_orders wo ON wo.id = wi.order_id
      WHERE wo.created_at >= ?
        AND wo.status IN ('new', 'paid', 'processing', 'ready', 'delivered')
      GROUP BY wi.product_id
    ),
    pos_sales AS (
      SELECT
        oi.product_id,
        SUM(COALESCE(oi.quantity, 0)) AS qty_total,
        SUM(CASE WHEN o.created_at >= ? THEN COALESCE(oi.quantity, 0) ELSE 0 END) AS qty_recent
      FROM order_items oi
      INNER JOIN orders o ON o.id = oi.order_id
      WHERE o.created_at >= ?
        AND o.status IN ('completed')
      GROUP BY oi.product_id
    ),
    ranked AS (
      SELECT
        product_id,
        SUM(qty_total) AS sold_qty,
        SUM(qty_recent) AS sold_recent_qty
      FROM (
        SELECT * FROM web_sales
        UNION ALL
        SELECT * FROM pos_sales
      )
      GROUP BY product_id
    )
    SELECT
      p.id,
      p.sku,
      p.name,
      p.description,
      p.sale_price,
      p.category_id,
      p.track_stock,
      p.image_url,
      ${costCol ? 'p.cost_price,' : ''}
      COALESCE(sb.stock_qty, 0) AS stock_qty,
      COALESCE(r.sold_qty, 0) AS sold_qty,
      COALESCE(r.sold_recent_qty, 0) AS sold_recent_qty
      ${voSelect}
    FROM products p
    LEFT JOIN ranked r ON r.product_id = p.id
    LEFT JOIN (${stockSubquery(db)}) sb ON sb.product_id = p.id
    WHERE p.is_active = 1
      ${mpWhere}
      ${catWhere}
    LIMIT 200
  `;
  const rows = db.prepare(sql).all(recentFromIso, fromIso, recentFromIso, fromIso);
  const scored = rows.map((row) => {
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
    const soldQty = Number(row.sold_qty) || 0;
    const soldRecentQty = Number(row.sold_recent_qty) || 0;
    const availabilityBonus = isAvailable ? availabilityBonusValue : 0;
    const marginBonus = costCol
      ? Math.min(
          marginCap,
          Math.max(0, ((Number(row.sale_price) || 0) - (Number(row.cost_price) || 0)) / marginDivisor),
        )
      : 0;
    const score = soldQty + soldRecentQty * recentWeight + availabilityBonus + marginBonus;
    return {
      score,
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
      image_url: resolveCatalogImageUrl(row.image_url, req),
      sold_qty: soldQty,
      sold_recent_qty: soldRecentQty,
      options: voCol ? parseVariantOptions(row.variant_options) : [],
    };
  });
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.sold_recent_qty !== a.sold_recent_qty) return b.sold_recent_qty - a.sold_recent_qty;
    return String(a.name || '').localeCompare(String(b.name || ''), 'uz');
  });
  const data = scored.slice(0, limit);
  return {
    data,
    meta: {
      limit,
      days,
      recent_days: recentDays,
      scoring: 'sold_total + sold_recent*recent_weight + availability + margin',
      scoring_params: {
        recent_weight: recentWeight,
        availability_bonus: availabilityBonusValue,
        margin_divisor: marginDivisor,
        margin_cap: marginCap,
      },
    },
  };
}

/**
 * Read the active promo banners. Optional schedule windows are honored
 * (NULL means "no bound"). Soft-fails to an empty array if the table
 * is missing — older DBs without the migration just see the legacy
 * hard-coded slides on the client.
 */
function listActivePromoBanners(db) {
  try {
    const now = new Date().toISOString();
    return db
      .prepare(
        `SELECT id, emoji, title, subtitle, cta_text, cta_link, theme, sort_order
           FROM marketplace_promo_banners
           WHERE is_active = 1
             AND (starts_at IS NULL OR starts_at <= ?)
             AND (ends_at IS NULL OR ends_at >= ?)
           ORDER BY sort_order ASC, id ASC`,
      )
      .all(now, now);
  } catch (e) {
    if (!String(e.message || '').includes('no such')) {
      console.error('[catalog] listActivePromoBanners', e);
    }
    return [];
  }
}

/**
 * Return today's pinned daily-deal product (if any) joined with the
 * full product row. Returns null when no override is set, in which case
 * the mini-app falls back to its deterministic trending pick.
 */
function getTodaysDailyDeal(db, req) {
  try {
    // "Today" in the shop timezone (Asia/Tashkent, UTC+5) — MUST match the
    // admin default in marketplaceContentService.getDailyDeal so both sides
    // agree on the calendar day around midnight.
    const today = formatYmdInTimeZone(new Date());
    const row = db
      .prepare(
        `SELECT d.product_id, d.badge_text
           FROM marketplace_daily_deals d
           WHERE d.featured_date = ?`,
      )
      .get(today);
    if (!row) return null;
    const product = getProductById(db, row.product_id, req);
    if (!product) return null;
    return {
      featured_date: today,
      badge_text: row.badge_text || null,
      product,
    };
  } catch (e) {
    if (!String(e.message || '').includes('no such')) {
      console.error('[catalog] getTodaysDailyDeal', e);
    }
    return null;
  }
}

function mountCatalogRoutes(dbGetter) {
  router.get('/products', (req, res) => {
    try {
      const db = dbGetter();
      const result = listProducts(db, req.query, req);
      res.json(result);
    } catch (e) {
      console.error('[catalog] GET /products', e);
      res.status(500).json({ error: 'internal_error' });
    }
  });

  router.get('/promo-banners', (_req, res) => {
    try {
      const db = dbGetter();
      const data = listActivePromoBanners(db);
      res.json({ data });
    } catch (e) {
      console.error('[catalog] GET /promo-banners', e);
      res.status(500).json({ error: 'internal_error' });
    }
  });

  router.get('/products/daily-deal', (req, res) => {
    try {
      const db = dbGetter();
      const data = getTodaysDailyDeal(db, req);
      res.json({ data });
    } catch (e) {
      console.error('[catalog] GET /products/daily-deal', e);
      res.status(500).json({ error: 'internal_error' });
    }
  });

  router.get('/products/trending', (req, res) => {
    try {
      const db = dbGetter();
      const ttlMs = getTrendingCacheTtlMs();
      const cacheKey = JSON.stringify({
        limit: String(req.query.limit ?? ''),
        days: String(req.query.days ?? ''),
        recent_days: String(req.query.recent_days ?? ''),
      });
      if (ttlMs > 0) {
        const cached = trendingCache.get(cacheKey);
        if (cached && cached.expiresAt > Date.now()) {
          res.set('X-Cache', 'HIT');
          res.json(cached.result);
          return;
        }
      }
      const result = listTrendingProducts(db, req.query, req);
      if (ttlMs > 0) {
        // Evict oldest entry when the cache is full. Map preserves
        // insertion order so the first key is the oldest. Without this
        // the Map could grow without bound across the lifetime of the
        // process (one entry per distinct limit/days/recent_days combo).
        if (trendingCache.size >= TRENDING_CACHE_MAX) {
          const oldest = trendingCache.keys().next().value;
          if (oldest !== undefined) trendingCache.delete(oldest);
        }
        trendingCache.set(cacheKey, {
          expiresAt: Date.now() + ttlMs,
          result,
        });
      }
      res.set('X-Cache', 'MISS');
      res.json(result);
    } catch (e) {
      const msg = String(e?.message || '');
      // Legacy DB bo'lsa fallback: oddiy mahsulot ro'yxatini qaytaramiz.
      if (msg.includes('no such table')) {
        try {
          const db = dbGetter();
          const fallback = listProducts(db, { ...req.query, page: 1, sort: 'name' }, req);
          res.json({ data: fallback.data, meta: { limit: fallback.meta.limit, fallback: true } });
          return;
        } catch {
          // handled below
        }
      }
      console.error('[catalog] GET /products/trending', e);
      res.status(500).json({ error: 'internal_error' });
    }
  });

  router.get('/products/:id', (req, res) => {
    try {
      const db = dbGetter();
      const product = getProductById(db, req.params.id, req);
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

  // Aggregated review/rating snapshot for a product. We sample ratings
  // from delivered orders that contained this product. Cheap to compute
  // and good enough for the "★ 4.7 (12 ta sharh)" line on the detail page.
  router.get('/products/:id/reviews', (req, res) => {
    try {
      const productId = String(req.params.id || '').trim();
      if (!productId) {
        res.status(400).json({ error: 'invalid_id' });
        return;
      }
      const db = dbGetter();
      const limit = Math.max(1, Math.min(20, Number.parseInt(String(req.query.limit || '5'), 10) || 5));

      let summary = { count: 0, avg: null, distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } };
      let recent = [];
      try {
        const rows = db
          .prepare(
            `SELECT wo.rating, wo.feedback, wo.created_at, mc.first_name
             FROM web_order_items wi
             JOIN web_orders wo ON wo.id = wi.order_id
             LEFT JOIN marketplace_customers mc ON mc.id = wo.customer_id
             WHERE wi.product_id = ?
               AND wo.rating IS NOT NULL
               AND wo.status = 'delivered'
             ORDER BY wo.created_at DESC`,
          )
          .all(productId);

        if (rows.length > 0) {
          let sum = 0;
          const dist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
          for (const r of rows) {
            const n = Math.max(1, Math.min(5, Math.round(Number(r.rating) || 0)));
            sum += n;
            dist[n] = (dist[n] || 0) + 1;
          }
          summary = {
            count: rows.length,
            avg: Math.round((sum / rows.length) * 10) / 10,
            distribution: dist,
          };
          recent = rows
            .filter((r) => r.feedback && String(r.feedback).trim())
            .slice(0, limit)
            .map((r) => ({
              rating: Math.max(1, Math.min(5, Math.round(Number(r.rating) || 0))),
              feedback: String(r.feedback || '').trim(),
              created_at: r.created_at,
              author: r.first_name ? String(r.first_name).slice(0, 24) : null,
            }));
        }
      } catch (e) {
        // Tables/columns might be missing on older DBs — leave empty
        if (!String(e.message || '').includes('no such')) throw e;
      }

      res.json({ ok: true, summary, recent });
    } catch (e) {
      console.error('[catalog] GET /products/:id/reviews', e);
      res.status(500).json({ error: 'internal_error' });
    }
  });

  router.get('/categories', (req, res) => {
    try {
      const db = dbGetter();
      const rows = listCategories(db).map((row) => ({
        ...row,
        image_url: row.image_url ? resolveCatalogImageUrl(row.image_url, req) : row.image_url,
      }));
      res.json({ data: rows });
    } catch (e) {
      console.error('[catalog] GET /categories', e);
      res.status(500).json({ error: 'internal_error' });
    }
  });

  return router;
}

module.exports = { mountCatalogRoutes, listProducts, getProductById, listCategories, pruneOrphanCategories };

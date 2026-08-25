const { ERROR_CODES, createError } = require('../lib/errors.cjs');
const { formatYmdInTimeZone } = require('../lib/timezone.cjs');

// Tracks DB handles whose schema bootstrap already ran. The canonical schema
// lives in migration 077_marketplace_content.sql; this lazy CREATE-IF-NOT-
// EXISTS is only a dev safety net, so we run it at most once per DB handle
// instead of on every `new MarketplaceContentService()` (the HTTP admin-panel
// path constructs one per request).
const SCHEMA_BOOTSTRAPPED = new WeakSet();

/**
 * Service for admin-managed marketing content shown in the customer-
 * facing mini-app:
 *   - Promo banner carousel (CRUD + reorder)
 *   - Daily Deal overrides (one product per calendar day)
 *
 * Public-api re-exposes the read paths over HTTP so the mini-app can
 * fetch them without requiring an Electron IPC bridge.
 */
class MarketplaceContentService {
  constructor(db) {
    this.db = db;
    this._ensureSchema();
  }

  /**
   * Lazy schema bootstrap — keeps the service usable on dev DBs that
   * haven't been migrated yet, mirroring `marketplaceLoyalty`'s pattern.
   * Production should always run migrations first; this is a safety net.
   */
  _ensureSchema() {
    if (!this.db || SCHEMA_BOOTSTRAPPED.has(this.db)) return;
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS marketplace_promo_banners (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          emoji TEXT,
          title TEXT NOT NULL,
          subtitle TEXT NOT NULL,
          cta_text TEXT,
          cta_link TEXT,
          theme TEXT NOT NULL DEFAULT 'primary',
          sort_order INTEGER NOT NULL DEFAULT 0,
          is_active INTEGER NOT NULL DEFAULT 1,
          starts_at TEXT NULL,
          ends_at TEXT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_marketplace_promo_banners_active
          ON marketplace_promo_banners(is_active, sort_order);

        CREATE TABLE IF NOT EXISTS marketplace_daily_deals (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          featured_date TEXT NOT NULL UNIQUE,
          product_id TEXT NOT NULL,
          badge_text TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_marketplace_daily_deals_date
          ON marketplace_daily_deals(featured_date);
      `);
      SCHEMA_BOOTSTRAPPED.add(this.db);
    } catch (e) {
      console.error('[marketplaceContent] schema bootstrap failed', e);
    }
  }

  // ─── PROMO BANNERS ────────────────────────────────────────────────────

  /**
   * @param {{ activeOnly?: boolean, atDate?: string }} opts
   *   atDate — filter banners whose schedule covers this ISO datetime.
   */
  listBanners(opts = {}) {
    const conds = [];
    const params = [];
    if (opts.activeOnly) conds.push('is_active = 1');
    if (opts.atDate) {
      conds.push('(starts_at IS NULL OR starts_at <= ?)');
      params.push(opts.atDate);
      conds.push('(ends_at IS NULL OR ends_at >= ?)');
      params.push(opts.atDate);
    }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    return this.db
      .prepare(
        `SELECT id, emoji, title, subtitle, cta_text, cta_link, theme,
                sort_order, is_active, starts_at, ends_at,
                created_at, updated_at
           FROM marketplace_promo_banners
           ${where}
           ORDER BY sort_order ASC, id ASC`,
      )
      .all(...params)
      .map((r) => ({
        ...r,
        is_active: !!r.is_active,
      }));
  }

  /**
   * Create or update a promo banner. Pass `id` to update, omit to insert.
   * Returns the saved row.
   */
  saveBanner(input) {
    const data = this._normalizeBannerInput(input);
    if (input?.id) {
      const exists = this.db
        .prepare('SELECT id FROM marketplace_promo_banners WHERE id = ?')
        .get(input.id);
      if (!exists) {
        throw createError(ERROR_CODES.NOT_FOUND, `Banner ${input.id} not found`);
      }
      this.db
        .prepare(
          `UPDATE marketplace_promo_banners
              SET emoji = ?, title = ?, subtitle = ?, cta_text = ?, cta_link = ?,
                  theme = ?, sort_order = ?, is_active = ?,
                  starts_at = ?, ends_at = ?, updated_at = datetime('now')
            WHERE id = ?`,
        )
        .run(
          data.emoji,
          data.title,
          data.subtitle,
          data.cta_text,
          data.cta_link,
          data.theme,
          data.sort_order,
          data.is_active ? 1 : 0,
          data.starts_at,
          data.ends_at,
          input.id,
        );
      return this.getBanner(input.id);
    }
    const info = this.db
      .prepare(
        `INSERT INTO marketplace_promo_banners
           (emoji, title, subtitle, cta_text, cta_link, theme,
            sort_order, is_active, starts_at, ends_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        data.emoji,
        data.title,
        data.subtitle,
        data.cta_text,
        data.cta_link,
        data.theme,
        data.sort_order,
        data.is_active ? 1 : 0,
        data.starts_at,
        data.ends_at,
      );
    return this.getBanner(info.lastInsertRowid);
  }

  getBanner(id) {
    if (!id) throw createError(ERROR_CODES.VALIDATION_ERROR, 'id is required');
    const row = this.db
      .prepare('SELECT * FROM marketplace_promo_banners WHERE id = ?')
      .get(id);
    if (!row) return null;
    return { ...row, is_active: !!row.is_active };
  }

  deleteBanner(id) {
    if (!id) throw createError(ERROR_CODES.VALIDATION_ERROR, 'id is required');
    this.db.prepare('DELETE FROM marketplace_promo_banners WHERE id = ?').run(id);
    return { ok: true };
  }

  /**
   * Bulk reorder. Accepts an array of { id, sort_order } pairs and
   * runs in a single transaction.
   */
  reorderBanners(items) {
    if (!Array.isArray(items)) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'items must be an array');
    }
    const stmt = this.db.prepare(
      `UPDATE marketplace_promo_banners
          SET sort_order = ?, updated_at = datetime('now')
        WHERE id = ?`,
    );
    const tx = this.db.transaction((rows) => {
      for (const r of rows) {
        if (!r || typeof r !== 'object') continue;
        const order = Number.parseInt(r.sort_order, 10);
        const id = Number.parseInt(r.id, 10);
        if (!Number.isFinite(order) || !Number.isFinite(id)) continue;
        stmt.run(order, id);
      }
    });
    tx(items);
    return { ok: true };
  }

  _normalizeBannerInput(input) {
    if (!input || typeof input !== 'object') {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'banner payload required');
    }
    const title = String(input.title || '').trim();
    const subtitle = String(input.subtitle || '').trim();
    if (!title || !subtitle) {
      throw createError(
        ERROR_CODES.VALIDATION_ERROR,
        'title and subtitle are required',
      );
    }
    const allowedThemes = new Set(['primary', 'cream', 'teal']);
    let theme = String(input.theme || 'primary');
    if (!allowedThemes.has(theme)) theme = 'primary';
    const sortOrder = Number.isFinite(Number(input.sort_order))
      ? Math.max(0, Math.min(9999, Math.floor(Number(input.sort_order))))
      : 0;
    return {
      emoji: input.emoji ? String(input.emoji).slice(0, 8) : null,
      title: title.slice(0, 80),
      subtitle: subtitle.slice(0, 120),
      cta_text: input.cta_text ? String(input.cta_text).slice(0, 40) : null,
      cta_link: this._sanitizeCtaLink(input.cta_link),
      theme,
      sort_order: sortOrder,
      is_active: input.is_active === undefined ? true : !!input.is_active,
      starts_at: input.starts_at ? String(input.starts_at) : null,
      ends_at: input.ends_at ? String(input.ends_at) : null,
    };
  }

  /**
   * Validate the banner CTA link. The mini-app renders it inside an
   * `<a href>`, so an arbitrary string risks `javascript:` / `data:` URIs and
   * open-redirects (XSS). Only allow:
   *   - an internal app path beginning with a single "/" (not "//host")
   *   - an absolute `https://` URL
   * Anything else is rejected. Empty/missing returns null.
   */
  _sanitizeCtaLink(raw) {
    if (raw === undefined || raw === null || raw === '') return null;
    const link = String(raw).trim().slice(0, 200);
    if (!link) return null;
    // Internal path: must start with a single slash (block protocol-relative "//").
    if (link.startsWith('/') && !link.startsWith('//')) return link;
    // Absolute https URL only.
    if (/^https:\/\/[^\s]+$/i.test(link)) return link;
    throw createError(
      ERROR_CODES.VALIDATION_ERROR,
      "cta_link faqat ichki yo'l (/...) yoki https:// havola bo'lishi mumkin",
    );
  }

  // ─── DAILY DEAL ───────────────────────────────────────────────────────

  /**
   * Get the daily-deal override for a specific date (defaults to today).
   * Joins to products so the caller has everything needed to render.
   * Returns null if no override is set.
   */
  getDailyDeal(dateISO) {
    // Default "today" in the shop's timezone (Asia/Tashkent, UTC+5) so the
    // admin and the public mini-app read the SAME calendar day near midnight.
    const date = dateISO ? String(dateISO).slice(0, 10) : formatYmdInTimeZone(new Date());
    const row = this.db
      .prepare(
        `SELECT d.id, d.featured_date, d.product_id, d.badge_text,
                p.name, p.sale_price, p.image_url, p.is_active
           FROM marketplace_daily_deals d
           LEFT JOIN products p ON p.id = d.product_id
           WHERE d.featured_date = ?`,
      )
      .get(date);
    if (!row) return null;
    return {
      id: row.id,
      featured_date: row.featured_date,
      product_id: row.product_id,
      badge_text: row.badge_text,
      product: row.name
        ? {
            id: row.product_id,
            name: row.name,
            price_uzs: Math.round(Number(row.sale_price) || 0),
            image_url: row.image_url || null,
            is_active: !!row.is_active,
          }
        : null,
    };
  }

  /**
   * Pin a product as the featured pick for `featured_date` (YYYY-MM-DD).
   * Pass `product_id = null` to clear the override.
   */
  setDailyDeal({ featured_date, product_id, badge_text } = {}) {
    const date = String(featured_date || formatYmdInTimeZone(new Date())).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'featured_date must be YYYY-MM-DD');
    }
    if (!product_id) {
      this.db
        .prepare('DELETE FROM marketplace_daily_deals WHERE featured_date = ?')
        .run(date);
      return { ok: true, cleared: true };
    }
    const productExists = this.db
      .prepare('SELECT id FROM products WHERE id = ?')
      .get(product_id);
    if (!productExists) {
      throw createError(ERROR_CODES.NOT_FOUND, `Product ${product_id} not found`);
    }
    const badge = badge_text ? String(badge_text).slice(0, 60) : null;
    this.db
      .prepare(
        `INSERT INTO marketplace_daily_deals (featured_date, product_id, badge_text)
         VALUES (?, ?, ?)
         ON CONFLICT(featured_date) DO UPDATE SET
            product_id = excluded.product_id,
            badge_text = excluded.badge_text,
            updated_at = datetime('now')`,
      )
      .run(date, product_id, badge);
    return this.getDailyDeal(date);
  }

  /**
   * Recent override history for the admin to scroll through.
   */
  listDailyDealHistory(limit = 30) {
    const rows = this.db
      .prepare(
        `SELECT d.id, d.featured_date, d.product_id, d.badge_text,
                p.name, p.image_url
           FROM marketplace_daily_deals d
           LEFT JOIN products p ON p.id = d.product_id
           ORDER BY d.featured_date DESC
           LIMIT ?`,
      )
      .all(Math.max(1, Math.min(200, Number(limit) || 30)));
    return rows.map((r) => ({
      id: r.id,
      featured_date: r.featured_date,
      product_id: r.product_id,
      badge_text: r.badge_text,
      product_name: r.name || null,
      product_image: r.image_url || null,
    }));
  }
}

module.exports = MarketplaceContentService;

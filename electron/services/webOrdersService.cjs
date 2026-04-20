'use strict';

const { createError, ERROR_CODES } = require('../lib/errors.cjs');

const VALID_STATUSES = new Set(['new', 'paid', 'processing', 'ready', 'delivered', 'cancelled']);

/**
 * Telegram / marketplace onlayn buyurtmalar (web_orders) — POS admin (TZ F-22, F-23).
 */
class WebOrdersService {
  constructor(db) {
    this.db = db;
  }

  _hasWebOrdersTable() {
    try {
      const r = this.db
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='web_orders'`)
        .get();
      return !!r;
    } catch {
      return false;
    }
  }

  list(filters = {}) {
    if (!this._hasWebOrdersTable()) {
      return { data: [], meta: { page: 1, limit: 50, total: 0, total_pages: 0 } };
    }
    const status = filters.status ? String(filters.status).trim() : '';
    const page = Math.max(1, Number.parseInt(String(filters.page || '1'), 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(String(filters.limit || '50'), 10) || 50));
    const offset = (page - 1) * limit;

    let where = '1=1';
    const params = [];
    if (status && VALID_STATUSES.has(status)) {
      where += ' AND wo.status = ?';
      params.push(status);
    }

    const total = Number(
      this.db.prepare(`SELECT COUNT(*) AS n FROM web_orders wo WHERE ${where}`).get(...params).n || 0,
    );

    const rows = this.db
      .prepare(
        `
      SELECT wo.*, mc.telegram_id, mc.first_name, mc.last_name, mc.phone
      FROM web_orders wo
      LEFT JOIN marketplace_customers mc ON mc.id = wo.customer_id
      WHERE ${where}
      ORDER BY datetime(wo.created_at) DESC
      LIMIT ? OFFSET ?
    `,
      )
      .all(...params, limit, offset);

    return {
      data: rows,
      meta: {
        page,
        limit,
        total,
        total_pages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  get(id) {
    if (!this._hasWebOrdersTable()) return null;
    const wid = Number.parseInt(String(id), 10);
    if (!Number.isFinite(wid)) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Invalid order id');
    }

    const wo = this.db
      .prepare(
        `
      SELECT
        wo.*,
        mc.telegram_id,
        mc.first_name,
        mc.last_name,
        mc.phone,
        mc.address AS customer_address
      FROM web_orders wo
      LEFT JOIN marketplace_customers mc ON mc.id = wo.customer_id
      WHERE wo.id = ?
    `,
      )
      .get(wid);

    if (!wo) return null;

    const items = this.db
      .prepare(
        `
      SELECT
        wi.id,
        wi.product_id,
        wi.quantity,
        wi.price_at_order,
        p.name AS product_name,
        p.sku
      FROM web_order_items wi
      LEFT JOIN products p ON p.id = wi.product_id
      WHERE wi.order_id = ?
      ORDER BY wi.id ASC
    `,
      )
      .all(wid);

    return { ...wo, items };
  }

  updateStatus(id, status) {
    if (!this._hasWebOrdersTable()) {
      throw createError(ERROR_CODES.NOT_FOUND, 'Onlayn buyurtmalar jadvali topilmadi (migratsiya?)');
    }
    const wid = Number.parseInt(String(id), 10);
    if (!Number.isFinite(wid)) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Invalid order id');
    }
    const next = String(status || '').trim();
    if (!VALID_STATUSES.has(next)) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, `Invalid status: ${status}`);
    }

    const row = this.db.prepare('SELECT id FROM web_orders WHERE id = ?').get(wid);
    if (!row) {
      throw createError(ERROR_CODES.NOT_FOUND, `Web order ${wid} not found`);
    }

    const now = new Date().toISOString();
    this.db.prepare(`UPDATE web_orders SET status = ?, updated_at = ? WHERE id = ?`).run(next, now, wid);
    return this.get(wid);
  }
}

module.exports = WebOrdersService;

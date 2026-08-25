'use strict';

const { createError, ERROR_CODES } = require('../lib/errors.cjs');

function requirePublicApiLib(modulePath, fallback) {
  try {
    return require(modulePath);
  } catch (error) {
    console.warn(
      `[WebOrdersService] ${modulePath} unavailable — web-order helpers disabled:`,
      error?.message || error,
    );
    return fallback;
  }
}

const statusFlowFallback = {
  allowedNextStatuses: () => [],
  isValidTransition: () => false,
  normalizeDeliveryMethod: (raw) => (String(raw || '').trim().toLowerCase() === 'pickup' ? 'pickup' : 'courier'),
};
const queueFallback = {
  WEB_ORDER_QUEUES: {},
  resolveQueueStatuses: () => [],
  normalizeSalesChannel: (raw) => String(raw || 'marketplace').trim().toLowerCase() || 'marketplace',
  VALID_SALES_CHANNELS: new Set(['telegram', 'website', 'uzum', 'yandex', 'other', 'marketplace']),
};
const stockFallback = {
  fulfillWebOrderStock: async () => ({ ok: false, reason: 'public_api_unavailable' }),
  handleWebOrderCancelled: async () => ({ ok: false, reason: 'public_api_unavailable' }),
  markCashPaymentOnDelivered: async () => ({ ok: false, reason: 'public_api_unavailable' }),
  isOrderStockFulfilled: () => false,
};
const customerFallback = {
  syncPosCustomerFromMarketplace: async () => null,
  recordWebOrderCustomerSale: async () => ({ ok: false, reason: 'public_api_unavailable' }),
};
const telegramFallback = {
  notifyOrderStatusChanged: async () => {},
  notifyCourierGroupOrder: async () => ({ ok: false, reason: 'not_loaded' }),
};

const {
  notifyOrderStatusChanged,
  notifyCourierGroupOrder,
} = requirePublicApiLib('../../public-api/lib/telegramNotify.cjs', telegramFallback);
const {
  allowedNextStatuses,
  isValidTransition,
  normalizeDeliveryMethod,
} = requirePublicApiLib('../../public-api/lib/webOrderStatusFlow.cjs', statusFlowFallback);
const {
  WEB_ORDER_QUEUES,
  resolveQueueStatuses,
  normalizeSalesChannel,
  VALID_SALES_CHANNELS,
} = requirePublicApiLib('../../public-api/lib/webOrderQueues.cjs', queueFallback);
const {
  fulfillWebOrderStock,
  handleWebOrderCancelled,
  markCashPaymentOnDelivered,
  isOrderStockFulfilled,
} = requirePublicApiLib('../../public-api/lib/webOrderStock.cjs', stockFallback);
const {
  syncPosCustomerFromMarketplace,
  recordWebOrderCustomerSale,
} = requirePublicApiLib('../../public-api/lib/marketplacePosCustomer.cjs', customerFallback);

const VALID_STATUSES = new Set(['new', 'paid', 'processing', 'ready', 'out_for_delivery', 'delivered', 'cancelled']);

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

  _hasMarketplaceBindingsTable() {
    try {
      const r = this.db
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='marketplace_customer_bindings'`)
        .get();
      return !!r;
    } catch {
      return false;
    }
  }

  _marketplaceCustomerJoinSelect(alias = 'mc') {
    if (!this._hasMarketplaceBindingsTable()) {
      return 'NULL AS pos_customer_id';
    }
    return 'b.pos_customer_id AS pos_customer_id';
  }

  _marketplaceCustomerJoinClause(woAlias = 'wo', mcAlias = 'mc') {
    if (!this._hasMarketplaceBindingsTable()) {
      return '';
    }
    return `LEFT JOIN marketplace_customer_bindings b ON b.marketplace_customer_id = ${woAlias}.customer_id`;
  }

  _hasColumn(tableName, columnName) {
    try {
      return this.db.prepare(`PRAGMA table_info(${tableName})`).all().some((c) => c.name === columnName);
    } catch {
      return false;
    }
  }

  _latestUsdUzsRate(onDate = null) {
    try {
      const hasTable = this.db
        .prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='exchange_rates'`)
        .get();
      if (!hasTable) return null;
      const params = ['USD', 'UZS'];
      let where = `WHERE UPPER(base_currency) = ? AND UPPER(quote_currency) = ?`;
      if (onDate) {
        where += ` AND date(effective_date) <= date(?)`;
        params.push(String(onDate).slice(0, 10));
      } else {
        where += ` AND date(effective_date) <= date('now')`;
      }
      const row = this.db
        .prepare(
          `SELECT rate FROM exchange_rates ${where}
           ORDER BY date(effective_date) DESC, datetime(updated_at) DESC LIMIT 1`
        )
        .get(...params);
      const rate = Number(row?.rate || 0);
      return rate > 0 ? rate : null;
    } catch {
      return null;
    }
  }

  _ensureWebOrderFxRate(orderId) {
    if (!this._hasColumn('web_orders', 'fx_rate')) return;
    const row = this.db
      .prepare(`SELECT fx_rate, created_at FROM web_orders WHERE id = ?`)
      .get(orderId);
    if (!row) return;
    if (Number(row.fx_rate || 0) > 0) return;
    const rate = this._latestUsdUzsRate(row.created_at);
    if (!(rate > 0)) return;
    this.db.prepare(`UPDATE web_orders SET fx_rate = ? WHERE id = ?`).run(rate, orderId);
  }

  _buildListWhere(filters = {}) {
    let where = '1=1';
    const params = [];

    const statuses = resolveQueueStatuses(filters).filter((s) => VALID_STATUSES.has(s));
    if (statuses.length === 1) {
      where += ' AND wo.status = ?';
      params.push(statuses[0]);
    } else if (statuses.length > 1) {
      where += ` AND wo.status IN (${statuses.map(() => '?').join(', ')})`;
      params.push(...statuses);
    }

    const deliveryMethod = filters.delivery_method ? normalizeDeliveryMethod(filters.delivery_method) : '';
    if (deliveryMethod && this._hasColumn('web_orders', 'delivery_method')) {
      where += ' AND wo.delivery_method = ?';
      params.push(deliveryMethod);
    }

    const salesChannel = filters.sales_channel ? String(filters.sales_channel).trim().toLowerCase() : '';
    if (salesChannel && VALID_SALES_CHANNELS.has(salesChannel) && this._hasColumn('web_orders', 'sales_channel')) {
      where += ' AND wo.sales_channel = ?';
      params.push(salesChannel);
    }

    const days = Number.parseInt(String(filters.days ?? filters.created_within_days ?? ''), 10);
    if (Number.isFinite(days) && days > 0) {
      where += ` AND datetime(wo.created_at) >= datetime('now', ?)`;
      params.push(`-${days} days`);
    }

    const search = filters.search ? String(filters.search).trim() : '';
    if (search.length >= 2) {
      where += ` AND (
        wo.order_number LIKE ? OR CAST(wo.id AS TEXT) LIKE ?
        OR mc.phone LIKE ? OR mc.first_name LIKE ? OR mc.last_name LIKE ?
      )`;
      const like = `%${search}%`;
      params.push(like, like, like, like, like);
    }

    return { where, params };
  }

  list(filters = {}) {
    if (!this._hasWebOrdersTable()) {
      return { data: [], meta: { page: 1, limit: 50, total: 0, total_pages: 0 } };
    }
    const page = Math.max(1, Number.parseInt(String(filters.page || '1'), 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(String(filters.limit || '50'), 10) || 50));
    const offset = (page - 1) * limit;

    const { where, params } = this._buildListWhere(filters);

    const total = Number(
      this.db.prepare(`SELECT COUNT(*) AS n FROM web_orders wo WHERE ${where}`).get(...params).n || 0,
    );

    const salesChannelCol = this._hasColumn('web_orders', 'sales_channel')
      ? 'wo.sales_channel'
      : "'telegram' AS sales_channel";

    const rows = this.db
      .prepare(
        `
      SELECT wo.*, ${salesChannelCol}, mc.telegram_id, mc.first_name, mc.last_name, mc.phone,
             ${this._marketplaceCustomerJoinSelect()}
      FROM web_orders wo
      LEFT JOIN marketplace_customers mc ON mc.id = wo.customer_id
      ${this._marketplaceCustomerJoinClause()}
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
        queue: filters.queue || null,
      },
    };
  }

  reportSummary(filters = {}) {
    if (!this._hasWebOrdersTable()) {
      return {
        days: 30,
        date_from: null,
        date_to: null,
        by_status: [],
        by_channel: [],
        by_payment: [],
        totals: { orders: 0, amount: 0, cancelled_orders: 0 },
      };
    }

    const { formatYmdInTimeZone, UZBEKISTAN_TZ_SQLITE_OFFSET } = require('../lib/timezone.cjs');
    const { webOrderAmountUzsSql } = require('../lib/orderAmount.cjs');

    const days = Math.min(365, Math.max(1, Number.parseInt(String(filters.days || '30'), 10) || 30));
    const ymd = (d) => {
      if (!d) return null;
      if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
      return formatYmdInTimeZone(d);
    };

    let dateFrom = filters.date_from ? ymd(filters.date_from) : null;
    let dateTo = filters.date_to ? ymd(filters.date_to) : null;
    if (!dateFrom && !dateTo) {
      dateTo = formatYmdInTimeZone(new Date());
      const from = new Date();
      from.setDate(from.getDate() - (days - 1));
      dateFrom = formatYmdInTimeZone(from);
    }
    if (dateFrom && dateTo && dateFrom > dateTo) {
      const tmp = dateFrom;
      dateFrom = dateTo;
      dateTo = tmp;
    }

    // Align to Uzbekistan business day (same as other sales reports)
    const tzDate = (col) =>
      `date(datetime(replace(replace(${col}, 'T', ' '), 'Z', ''), '${UZBEKISTAN_TZ_SQLITE_OFFSET}'))`;

    const channelRaw = filters.sales_channel ? String(filters.sales_channel).trim().toLowerCase() : '';
    const channel =
      channelRaw && channelRaw !== 'all' && VALID_SALES_CHANNELS.has(channelRaw) ? channelRaw : null;

    const params = [];
    let where = '1=1';
    if (dateFrom) {
      where += ` AND ${tzDate('wo.created_at')} >= date(?)`;
      params.push(dateFrom);
    }
    if (dateTo) {
      where += ` AND ${tzDate('wo.created_at')} <= date(?)`;
      params.push(dateTo);
    }
    if (channel && this._hasColumn('web_orders', 'sales_channel')) {
      where += ' AND LOWER(TRIM(COALESCE(wo.sales_channel, \'\'))) = ?';
      params.push(channel);
    }

    // Sales KPIs: exclude cancelled + refunded/failed payments (still listed in by_status)
    const salesWhere = `${where}
      AND LOWER(TRIM(COALESCE(wo.status, ''))) != 'cancelled'
      AND LOWER(TRIM(COALESCE(wo.payment_status, ''))) NOT IN ('refunded', 'failed')`;

    const amountUzs = webOrderAmountUzsSql(this.db, 'wo');

    const byStatus = this.db
      .prepare(
        `
      SELECT
        wo.status AS status,
        COUNT(*) AS count,
        COALESCE(SUM(${amountUzs}), 0) AS amount
      FROM web_orders wo
      WHERE ${where}
      GROUP BY wo.status
      ORDER BY count DESC
    `,
      )
      .all(...params)
      .map((r) => ({
        status: r.status,
        count: Number(r.count) || 0,
        amount: Number(r.amount) || 0,
      }));

    const byChannel = this._hasColumn('web_orders', 'sales_channel')
      ? this.db
          .prepare(
            `
      SELECT
        COALESCE(NULLIF(TRIM(wo.sales_channel), ''), 'telegram') AS channel,
        COUNT(*) AS count,
        COALESCE(SUM(${amountUzs}), 0) AS amount
      FROM web_orders wo
      WHERE ${salesWhere}
      GROUP BY COALESCE(NULLIF(TRIM(wo.sales_channel), ''), 'telegram')
      ORDER BY count DESC
    `,
          )
          .all(...params)
          .map((r) => ({
            channel: r.channel,
            count: Number(r.count) || 0,
            amount: Number(r.amount) || 0,
          }))
      : [];

    const byPayment = this._hasColumn('web_orders', 'payment_method')
      ? this.db
          .prepare(
            `
      SELECT
        COALESCE(NULLIF(TRIM(wo.payment_method), ''), 'other') AS method,
        COUNT(*) AS count,
        COALESCE(SUM(${amountUzs}), 0) AS amount
      FROM web_orders wo
      WHERE ${salesWhere}
      GROUP BY COALESCE(NULLIF(TRIM(wo.payment_method), ''), 'other')
      ORDER BY count DESC
    `,
          )
          .all(...params)
          .map((r) => ({
            method: r.method,
            count: Number(r.count) || 0,
            amount: Number(r.amount) || 0,
          }))
      : [];

    const totals = this.db
      .prepare(
        `
      SELECT
        COUNT(*) AS orders,
        COALESCE(SUM(${amountUzs}), 0) AS amount
      FROM web_orders wo
      WHERE ${salesWhere}
    `,
      )
      .get(...params);

    const cancelled = this.db
      .prepare(
        `
      SELECT COUNT(*) AS orders
      FROM web_orders wo
      WHERE ${where}
        AND (
          LOWER(TRIM(COALESCE(wo.status, ''))) = 'cancelled'
          OR LOWER(TRIM(COALESCE(wo.payment_status, ''))) IN ('refunded', 'failed')
        )
    `,
      )
      .get(...params);

    const orders = Number(totals?.orders || 0);
    const amount = Number(totals?.amount || 0);

    return {
      days,
      date_from: dateFrom,
      date_to: dateTo,
      by_status: byStatus,
      by_channel: byChannel,
      by_payment: byPayment,
      totals: {
        orders,
        amount,
        avg_order: orders > 0 ? amount / orders : 0,
        cancelled_orders: Number(cancelled?.orders || 0),
      },
    };
  }

  countsByQueue() {
    if (!this._hasWebOrdersTable()) {
      return { incoming: 0, preparing: 0, ready: 0, delivering: 0, delivered: 0 };
    }
    const out = {};
    for (const [queueId, cfg] of Object.entries(WEB_ORDER_QUEUES)) {
      const statuses = cfg.statuses.filter((s) => VALID_STATUSES.has(s));
      if (!statuses.length) {
        out[queueId] = 0;
        continue;
      }
      const placeholders = statuses.map(() => '?').join(', ');
      const n = Number(
        this.db
          .prepare(`SELECT COUNT(*) AS n FROM web_orders WHERE status IN (${placeholders})`)
          .get(...statuses).n || 0,
      );
      out[queueId] = n;
    }
    return out;
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
        mc.address AS customer_address,
        ${this._marketplaceCustomerJoinSelect()}
      FROM web_orders wo
      LEFT JOIN marketplace_customers mc ON mc.id = wo.customer_id
      ${this._marketplaceCustomerJoinClause()}
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

  _getWithItems(id) {
    return this.get(id);
  }

  _activeCourierChatIds() {
    try {
      const hasCourierTable = this.db
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='marketplace_couriers'`)
        .get();
      if (!hasCourierTable) return [];
      return this.db
        .prepare(
          `
          SELECT telegram_id
          FROM marketplace_couriers
          WHERE active = 1
            AND telegram_id IS NOT NULL
          ORDER BY id ASC
        `,
        )
        .all()
        .map((row) => row.telegram_id)
        .filter((id) => id != null);
    } catch {
      return [];
    }
  }

  async _notifyCourierOrderReady(order) {
    const botToken = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
    if (!botToken || !order || normalizeDeliveryMethod(order.delivery_method) !== 'courier') {
      return { ok: false, reason: 'no_token_or_not_courier' };
    }

    const groupId = String(process.env.TELEGRAM_COURIER_GROUP_ID || '').trim();
    if (groupId) {
      return notifyCourierGroupOrder({
        botToken,
        groupId,
        order,
        items: order.items || [],
      });
    }

    const courierIds = this._activeCourierChatIds();
    if (!courierIds.length) return { ok: false, reason: 'no_courier_recipients' };

    let sent = 0;
    let failed = 0;
    for (const telegramId of courierIds) {
      // eslint-disable-next-line no-await-in-loop
      const out = await notifyCourierGroupOrder({
        botToken,
        groupId: telegramId,
        order,
        items: order.items || [],
      });
      if (out?.ok) sent += 1;
      else failed += 1;
    }
    return { ok: sent > 0, sent, failed };
  }

  dispatchToCourier(id) {
    if (!this._hasWebOrdersTable()) {
      throw createError(ERROR_CODES.NOT_FOUND, 'Onlayn buyurtmalar jadvali topilmadi (migratsiya?)');
    }
    const wid = Number.parseInt(String(id), 10);
    if (!Number.isFinite(wid)) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Invalid order id');
    }

    const order = this._getWithItems(wid);
    if (!order) {
      throw createError(ERROR_CODES.NOT_FOUND, `Web order ${wid} not found`);
    }
    const currentStatus = String(order.status || '').toLowerCase();
    if (currentStatus !== 'ready') {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Only ready orders can be sent to courier');
    }
    if (normalizeDeliveryMethod(order.delivery_method) !== 'courier') {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Pickup orders cannot be sent to courier');
    }

    // Same transition as PATCH /status — Telegram xabarlari ixtiyoriy (best-effort).
    return this.updateStatus(wid, 'out_for_delivery');
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

    const row = this.db
      .prepare(
        `
        SELECT wo.id, wo.status, wo.order_number, wo.payment_method, wo.customer_id,
               ${this._hasColumn('web_orders', 'delivery_method') ? 'wo.delivery_method' : "'courier' AS delivery_method"},
               mc.telegram_id
        FROM web_orders wo
        LEFT JOIN marketplace_customers mc ON mc.id = wo.customer_id
        WHERE wo.id = ?
      `,
      )
      .get(wid);
    if (!row) {
      throw createError(ERROR_CODES.NOT_FOUND, `Web order ${wid} not found`);
    }
    const current = String(row.status || '').toLowerCase();
    if (current === next) return this.get(wid);

    const transitionContext = { deliveryMethod: row.delivery_method };
    if (!isValidTransition(current, next, transitionContext)) {
      const allowed = allowedNextStatuses(current, transitionContext);
      throw createError(
        ERROR_CODES.VALIDATION_ERROR,
        `Invalid status transition: ${current} → ${next}${allowed.length ? ` (allowed: ${allowed.join(', ')})` : ''}`,
      );
    }

    const now = new Date().toISOString();
    const applyStock = this.db.transaction(() => {
      if (next === 'cancelled') {
        const paymentRow = this.db
          .prepare(`SELECT payment_status FROM web_orders WHERE id = ?`)
          .get(wid);
        const currentPaymentStatus = String(paymentRow?.payment_status || 'pending');
        let nextPaymentStatus = currentPaymentStatus;
        if (currentPaymentStatus === 'paid') nextPaymentStatus = 'refunded';
        else if (currentPaymentStatus === 'pending') nextPaymentStatus = 'failed';

        this.db
          .prepare(
            `UPDATE web_orders SET status = 'cancelled', payment_status = ?, updated_at = ? WHERE id = ?`,
          )
          .run(nextPaymentStatus, now, wid);
        handleWebOrderCancelled(this.db, wid);
        return;
      }

      this.db.prepare(`UPDATE web_orders SET status = ?, updated_at = ? WHERE id = ?`).run(next, now, wid);

      if (next === 'processing') {
        if (row.customer_id) {
          try {
            syncPosCustomerFromMarketplace(this.db, row.customer_id);
          } catch {
            /* POS mijoz bog‘lanmasa ham buyurtma davom etadi */
          }
        }
        if (!isOrderStockFulfilled(this.db, wid)) {
          fulfillWebOrderStock(this.db, wid, {
            reason:
              String(row.payment_method) === 'cash'
                ? `Cash order accepted ${row.order_number}`
                : `Order accepted ${row.order_number}`,
          });
        }
      }

      if (next === 'delivered') {
        markCashPaymentOnDelivered(this.db, wid);
        if (!isOrderStockFulfilled(this.db, wid)) {
          fulfillWebOrderStock(this.db, wid, {
            reason: `Delivered ${row.order_number}`,
          });
        }
        try {
          recordWebOrderCustomerSale(this.db, wid);
        } catch {
          /* mijoz kartochkasi ixtiyoriy — yetkazish davom etadi */
        }
      }
    });
    applyStock();
    this._ensureWebOrderFxRate(wid);
    const token = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
    if (token && row?.telegram_id) {
      void notifyOrderStatusChanged({
        botToken: token,
        telegramId: row.telegram_id,
        orderNumber: row.order_number,
        status: next,
        deliveryMethod: row.delivery_method,
      }).catch(() => {});
    }
    if (['ready', 'out_for_delivery'].includes(next) && normalizeDeliveryMethod(row.delivery_method) === 'courier') {
      const orderForCourier = this.get(wid);
      void this._notifyCourierOrderReady(orderForCourier).catch(() => {});
    }
    return this.get(wid);
  }

  update(id, payload = {}) {
    if (!this._hasWebOrdersTable()) {
      throw createError(ERROR_CODES.NOT_FOUND, 'Onlayn buyurtmalar jadvali topilmadi (migratsiya?)');
    }
    const wid = Number.parseInt(String(id), 10);
    if (!Number.isFinite(wid)) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Invalid order id');
    }

    const current = this.db
      .prepare(
        `
        SELECT id, customer_id, status, delivery_address,
               ${this._hasColumn('web_orders', 'delivery_method') ? 'delivery_method' : "'courier' AS delivery_method"}
        FROM web_orders
        WHERE id = ?
      `,
      )
      .get(wid);
    if (!current) {
      throw createError(ERROR_CODES.NOT_FOUND, `Web order ${wid} not found`);
    }

    const sets = [];
    const vals = [];
    const customerSets = [];
    const customerVals = [];

    if (Object.prototype.hasOwnProperty.call(payload, 'first_name')) {
      const firstName = String(payload.first_name || '').trim();
      if (firstName.length > 100) {
        throw createError(ERROR_CODES.VALIDATION_ERROR, 'Customer first name is too long');
      }
      customerSets.push('first_name = ?');
      customerVals.push(firstName || null);
    }

    if (Object.prototype.hasOwnProperty.call(payload, 'last_name')) {
      const lastName = String(payload.last_name || '').trim();
      if (lastName.length > 100) {
        throw createError(ERROR_CODES.VALIDATION_ERROR, 'Customer last name is too long');
      }
      customerSets.push('last_name = ?');
      customerVals.push(lastName || null);
    }

    if (Object.prototype.hasOwnProperty.call(payload, 'phone')) {
      const phone = String(payload.phone || '').trim();
      if (phone.length > 64) {
        throw createError(ERROR_CODES.VALIDATION_ERROR, 'Customer phone is too long');
      }
      customerSets.push('phone = ?');
      customerVals.push(phone || null);
    }

    if (Object.prototype.hasOwnProperty.call(payload, 'delivery_address')) {
      const nextAddress = String(payload.delivery_address || '').trim();
      const method = normalizeDeliveryMethod(
        Object.prototype.hasOwnProperty.call(payload, 'delivery_method') ? payload.delivery_method : current.delivery_method,
      );
      if (method === 'courier' && (nextAddress.length < 3 || nextAddress.length > 500)) {
        throw createError(ERROR_CODES.VALIDATION_ERROR, 'Delivery address must be 3..500 chars');
      }
      sets.push('delivery_address = ?');
      vals.push(nextAddress || (method === 'pickup' ? "O'zi olib ketish" : ''));
    }

    if (Object.prototype.hasOwnProperty.call(payload, 'delivery_method')) {
      if (!this._hasColumn('web_orders', 'delivery_method')) {
        throw createError(ERROR_CODES.VALIDATION_ERROR, 'Delivery method column is not available');
      }
      const nextMethod = normalizeDeliveryMethod(payload.delivery_method);
      if (nextMethod === 'courier') {
        const addressSource = Object.prototype.hasOwnProperty.call(payload, 'delivery_address')
          ? payload.delivery_address
          : current.delivery_address;
        const courierAddress = String(addressSource || '').trim();
        if (courierAddress.length < 3 || courierAddress.length > 500 || courierAddress === "O'zi olib ketish") {
          throw createError(ERROR_CODES.VALIDATION_ERROR, 'Courier orders require a valid delivery address');
        }
      }
      sets.push('delivery_method = ?');
      vals.push(nextMethod);
    }

    if (Object.prototype.hasOwnProperty.call(payload, 'note')) {
      const nextNote = payload.note == null ? '' : String(payload.note).trim();
      if (nextNote.length > 2000) {
        throw createError(ERROR_CODES.VALIDATION_ERROR, 'Note is too long');
      }
      sets.push('note = ?');
      vals.push(nextNote || null);
    }

    if (!sets.length && !customerSets.length) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'No editable fields provided');
    }

    const updateTx = this.db.transaction(() => {
      if (sets.length) {
        vals.push(new Date().toISOString(), wid);
        this.db
          .prepare(`UPDATE web_orders SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`)
          .run(...vals);
      }

      if (customerSets.length && current.customer_id) {
        customerVals.push(current.customer_id);
        this.db
          .prepare(`UPDATE marketplace_customers SET ${customerSets.join(', ')} WHERE id = ?`)
          .run(...customerVals);
        try {
          syncPosCustomerFromMarketplace(this.db, current.customer_id);
        } catch {
          /* best-effort */
        }
      }
    });
    updateTx();
    this._ensureWebOrderFxRate(wid);

    return this.get(wid);
  }

  cancel(id) {
    if (!this._hasWebOrdersTable()) {
      throw createError(ERROR_CODES.NOT_FOUND, 'Onlayn buyurtmalar jadvali topilmadi (migratsiya?)');
    }
    const wid = Number.parseInt(String(id), 10);
    if (!Number.isFinite(wid)) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Invalid order id');
    }

    const row = this.db
      .prepare(
        `
        SELECT wo.id, wo.status, wo.payment_status, wo.order_number,
               ${this._hasColumn('web_orders', 'delivery_method') ? 'wo.delivery_method' : "'courier' AS delivery_method"},
               mc.telegram_id
        FROM web_orders wo
        LEFT JOIN marketplace_customers mc ON mc.id = wo.customer_id
        WHERE wo.id = ?
      `,
      )
      .get(wid);
    if (!row) {
      throw createError(ERROR_CODES.NOT_FOUND, `Web order ${wid} not found`);
    }
    const currentStatus = String(row.status || '');
    if (currentStatus === 'cancelled') return this.get(wid);
    if (currentStatus === 'delivered') {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Delivered order cannot be cancelled');
    }

    // Decide the post-cancel payment_status based on what we already
    // collected:
    //  - 'paid'    → 'refunded' (cash needs to go back to the customer)
    //  - 'pending' → 'failed'   (provider can clean up its side)
    //  - else (failed/refunded) → keep as-is
    const currentPaymentStatus = String(row.payment_status || 'pending');
    let nextPaymentStatus = currentPaymentStatus;
    if (currentPaymentStatus === 'paid') {
      nextPaymentStatus = 'refunded';
    } else if (currentPaymentStatus === 'pending') {
      nextPaymentStatus = 'failed';
    }

    const now = new Date().toISOString();
    this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE web_orders
         SET status = 'cancelled', payment_status = ?, updated_at = ?
         WHERE id = ?`,
        )
        .run(nextPaymentStatus, now, wid);
      handleWebOrderCancelled(this.db, wid);
    })();

    const token = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
    if (token && row?.telegram_id) {
      void notifyOrderStatusChanged({
        botToken: token,
        telegramId: row.telegram_id,
        orderNumber: row.order_number,
        status: 'cancelled',
        deliveryMethod: row.delivery_method,
      }).catch(() => {});
    }
    return this.get(wid);
  }
}

module.exports = WebOrdersService;

'use strict';

const { createError, ERROR_CODES } = require('../lib/errors.cjs');
let notifyOrderStatusChanged = async () => {};
let notifyCourierGroupOrder = async () => ({ ok: false, reason: 'not_loaded' });
try {
  ({ notifyOrderStatusChanged, notifyCourierGroupOrder } = require('../../public-api/lib/telegramNotify.cjs'));
} catch {
  // In containerized pos-server builds we may not ship public-api sources.
  // Keep web order status updates functional without hard-failing service load.
}
const {
  allowedNextStatuses,
  isValidTransition,
  normalizeDeliveryMethod,
} = require('../../public-api/lib/webOrderStatusFlow.cjs');

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

  _hasColumn(tableName, columnName) {
    try {
      return this.db.prepare(`PRAGMA table_info(${tableName})`).all().some((c) => c.name === columnName);
    } catch {
      return false;
    }
  }

  list(filters = {}) {
    if (!this._hasWebOrdersTable()) {
      return { data: [], meta: { page: 1, limit: 50, total: 0, total_pages: 0 } };
    }
    const status = filters.status ? String(filters.status).trim() : '';
    const deliveryMethod = filters.delivery_method ? normalizeDeliveryMethod(filters.delivery_method) : '';
    const page = Math.max(1, Number.parseInt(String(filters.page || '1'), 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(String(filters.limit || '50'), 10) || 50));
    const offset = (page - 1) * limit;

    let where = '1=1';
    const params = [];
    if (status && VALID_STATUSES.has(status)) {
      where += ' AND wo.status = ?';
      params.push(status);
    }
    if (deliveryMethod && this._hasColumn('web_orders', 'delivery_method')) {
      where += ' AND wo.delivery_method = ?';
      params.push(deliveryMethod);
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

    const botToken = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
    if (!botToken) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'TELEGRAM_BOT_TOKEN is not configured');
    }

    const now = new Date().toISOString();
    const claimed = this.db
      .prepare(`UPDATE web_orders SET status = 'out_for_delivery', updated_at = ? WHERE id = ? AND status = 'ready'`)
      .run(now, wid);
    if (!claimed.changes) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Order is no longer ready for courier dispatch');
    }

    return Promise.resolve(
      this._notifyCourierOrderReady(order),
    )
      .catch((err) => ({ ok: false, reason: err?.message || String(err) }))
      .then((out) => {
        if (!out?.ok) {
          this.db
            .prepare(`UPDATE web_orders SET status = 'ready', updated_at = ? WHERE id = ? AND status = 'out_for_delivery'`)
            .run(new Date().toISOString(), wid);
          throw createError(
            ERROR_CODES.INTERNAL_ERROR,
            `Telegram courier notification failed: ${out?.reason || 'unknown_error'}`,
          );
        }
        if (botToken && order?.telegram_id) {
          void notifyOrderStatusChanged({
            botToken,
            telegramId: order.telegram_id,
            orderNumber: order.order_number,
            status: 'out_for_delivery',
            deliveryMethod: order.delivery_method,
          }).catch(() => {});
        }
        return this.get(wid);
      });
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
        SELECT wo.id, wo.status, wo.order_number,
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
    const isWorkflowTransition = isValidTransition(current, next, { deliveryMethod: row.delivery_method });
    if (current === next) return this.get(wid);

    const now = new Date().toISOString();
    this.db.prepare(`UPDATE web_orders SET status = ?, updated_at = ? WHERE id = ?`).run(next, now, wid);
    const token = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
    if (isWorkflowTransition && token && row?.telegram_id) {
      void notifyOrderStatusChanged({
        botToken: token,
        telegramId: row.telegram_id,
        orderNumber: row.order_number,
        status: next,
        deliveryMethod: row.delivery_method,
      }).catch(() => {});
    }
    if (isWorkflowTransition && ['ready', 'out_for_delivery'].includes(next) && normalizeDeliveryMethod(row.delivery_method) === 'courier') {
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
      }
    });
    updateTx();

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
    this.db
      .prepare(
        `UPDATE web_orders
         SET status = 'cancelled', payment_status = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(nextPaymentStatus, now, wid);

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

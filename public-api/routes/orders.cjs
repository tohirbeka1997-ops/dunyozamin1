'use strict';

const express = require('express');
const { allocateOrderNumber } = require('../lib/orderNumber.cjs');
const { getAvailableStock } = require('../lib/stockHelpers.cjs');
const { buildPaymeCheckoutUrl, buildClickCheckoutUrl } = require('../lib/paymentLinks.cjs');
const { notifyAdminsNewOrder, notifyOrderCreated, notifyOrderStatusChanged } = require('../lib/telegramNotify.cjs');
const { hasShowInMarketplaceColumn } = require('../lib/productVisibility.cjs');
const { normalizeDeliveryMethod } = require('../lib/webOrderStatusFlow.cjs');
const { idempotency } = require('../lib/idempotency.cjs');

function parseIntParam(v, fallback, min, max) {
  const n = Number.parseInt(String(v ?? ''), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function boolCol(v) {
  return v === 1 || v === true;
}

function parsePaymentMethod(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (s === 'payme' || s === 'click' || s === 'cash') return s;
  return null;
}

function hasColumn(db, tableName, columnName) {
  try {
    return db.prepare(`PRAGMA table_info(${tableName})`).all().some((c) => c.name === columnName);
  } catch {
    return false;
  }
}

function normalizePhone(raw) {
  const v = raw != null ? String(raw).trim() : '';
  if (!v) return null;
  const compact = v.replace(/[\s()-]/g, '');
  if (!/^\+?\d{9,15}$/.test(compact)) {
    const err = new Error('invalid_phone');
    err.code = 'INVALID_PHONE';
    err.status = 400;
    throw err;
  }
  return compact;
}

function normalizeLocation(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const lat = Number(raw.latitude);
  const lng = Number(raw.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return {
    latitude: Number(lat.toFixed(6)),
    longitude: Number(lng.toFixed(6)),
  };
}

function composeNote(note, phone, location) {
  const parts = [];
  if (note) parts.push(String(note).trim());
  if (phone) parts.push(`Telefon: ${phone}`);
  if (location) {
    parts.push(`Lokatsiya: ${location.latitude}, ${location.longitude}`);
    parts.push(`Xarita: https://maps.google.com/?q=${location.latitude},${location.longitude}`);
  }
  return parts.join('\n').trim() || null;
}

function parseCreateBody(body) {
  if (!body || !Array.isArray(body.items) || body.items.length === 0) {
    const err = new Error('items_required');
    err.code = 'ITEMS_REQUIRED';
    err.status = 400;
    throw err;
  }
  const items = [];
  for (const it of body.items) {
    const pid = it.product_id != null ? String(it.product_id).trim() : '';
    const qty = Number.parseInt(String(it.quantity), 10);
    if (!pid || !Number.isFinite(qty) || qty <= 0) {
      const err = new Error('invalid_item');
      err.code = 'INVALID_ITEM';
      err.status = 400;
      throw err;
    }
    items.push({ product_id: pid, quantity: qty });
  }
  const pm = parsePaymentMethod(body.payment_method);
  if (!pm) {
    const err = new Error('invalid_payment_method');
    err.code = 'INVALID_PAYMENT_METHOD';
    err.status = 400;
    throw err;
  }
  const deliveryMethod = normalizeDeliveryMethod(body.delivery_method);
  const addr = body.delivery_address != null ? String(body.delivery_address).trim() : '';
  if (deliveryMethod === 'courier' && addr.length < 3) {
    const err = new Error('delivery_address_required');
    err.code = 'DELIVERY_ADDRESS_REQUIRED';
    err.status = 400;
    throw err;
  }
  const note = body.note != null ? String(body.note).trim() : '';
  const phone = normalizePhone(body.phone);
  const location = normalizeLocation(body.location);
  return {
    items,
    payment_method: pm,
    delivery_method: deliveryMethod,
    delivery_address: addr || (deliveryMethod === 'pickup' ? "O'zi olib ketish" : ''),
    note: composeNote(note, phone, location),
    phone,
    location,
  };
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {number} customerId
 * @param {ReturnType<typeof parseCreateBody>} data
 */
function createOrder(db, customerId, data) {
  const mpCol = hasShowInMarketplaceColumn(db);
  const productSelect = mpCol
    ? `SELECT id, sale_price, track_stock, is_active, show_in_marketplace FROM products WHERE id = ?`
    : `SELECT id, sale_price, track_stock, is_active FROM products WHERE id = ?`;
  const productStmt = db.prepare(productSelect);

  const payExpiresAt =
    data.payment_method === 'payme' || data.payment_method === 'click'
      ? new Date(Date.now() + Number(process.env.PAYMENT_EXPIRE_MINUTES || 15) * 60 * 1000).toISOString()
      : null;

  // Use IMMEDIATE so the write lock is acquired at BEGIN, eliminating
  // the TOCTOU window between stock check and order insert. Validation
  // runs INSIDE the transaction so two concurrent buyers competing for
  // the last unit cannot both pass the availability check.
  const tx = db.transaction(() => {
    const lines = [];

    for (const it of data.items) {
      const p = productStmt.get(it.product_id);

      if (!p || !boolCol(p.is_active)) {
        const err = new Error('product_not_found');
        err.code = 'PRODUCT_NOT_FOUND';
        err.status = 400;
        err.meta = { product_id: it.product_id };
        throw err;
      }

      if (mpCol && !boolCol(p.show_in_marketplace)) {
        const err = new Error('product_not_on_marketplace');
        err.code = 'PRODUCT_NOT_ON_MARKETPLACE';
        err.status = 400;
        err.meta = { product_id: it.product_id };
        throw err;
      }

      const track = boolCol(p.track_stock);
      if (track) {
        const avail = getAvailableStock(db, it.product_id);
        if (avail + 1e-9 < it.quantity) {
          const err = new Error('insufficient_stock');
          err.code = 'INSUFFICIENT_STOCK';
          err.status = 400;
          err.meta = {
            product_id: it.product_id,
            available: Math.floor(avail),
            requested: it.quantity,
          };
          throw err;
        }
      }

      const priceAt = Math.round(Number(p.sale_price) || 0);
      lines.push({
        product_id: it.product_id,
        quantity: it.quantity,
        price_at_order: priceAt,
        line_total: priceAt * it.quantity,
      });
    }

    const totalAmount = lines.reduce((s, l) => s + l.line_total, 0);

    const orderNumber = allocateOrderNumber(db);
    const now = new Date().toISOString();

    const payStatus = 'pending';
    const status = 'new';

    const columns = [
      'order_number',
      'customer_id',
      'status',
      'payment_method',
      'payment_status',
      'total_amount',
      'delivery_address',
      'note',
      'created_at',
      'updated_at',
    ];
    const values = [
      orderNumber,
      customerId,
      status,
      data.payment_method,
      payStatus,
      totalAmount,
      data.delivery_address,
      data.note,
      now,
      now,
    ];
    if (hasColumn(db, 'web_orders', 'payment_expires_at')) {
      columns.push('payment_expires_at');
      values.push(payExpiresAt);
    }
    if (hasColumn(db, 'web_orders', 'delivery_method')) {
      columns.push('delivery_method');
      values.push(data.delivery_method);
    }

    const placeholders = columns.map(() => '?').join(', ');
    const r = db
      .prepare(`INSERT INTO web_orders (${columns.join(', ')}) VALUES (${placeholders})`)
      .run(...values);

    const orderId = r.lastInsertRowid;

    const insItem = db.prepare(`
      INSERT INTO web_order_items (order_id, product_id, quantity, price_at_order)
      VALUES (?, ?, ?, ?)
    `);
    for (const l of lines) {
      insItem.run(orderId, l.product_id, l.quantity, l.price_at_order);
    }

    const returnUrl = String(process.env.PAYME_RETURN_URL || process.env.PUBLIC_APP_RETURN_URL || '').trim();
    let paymentUrl = null;
    if (data.payment_method === 'payme' && process.env.PAYME_MERCHANT_ID) {
      paymentUrl = buildPaymeCheckoutUrl({
        merchantId: process.env.PAYME_MERCHANT_ID,
        orderId,
        totalSums: totalAmount,
        returnUrl,
      });
    } else if (data.payment_method === 'click' && process.env.CLICK_SERVICE_ID && process.env.CLICK_MERCHANT_ID) {
      paymentUrl = buildClickCheckoutUrl({
        serviceId: process.env.CLICK_SERVICE_ID,
        merchantId: process.env.CLICK_MERCHANT_ID,
        orderId,
        totalSums: totalAmount,
        returnUrl,
      });
    }

    return {
      order_id: orderId,
      order_number: orderNumber,
      status,
      delivery_method: data.delivery_method,
      payment_status: payStatus,
      total_amount: totalAmount,
      payment_url: paymentUrl,
    };
  });

  return tx.immediate();
}

function mountOrdersRoutes(dbGetter) {
  const router = express.Router();

  function notifyCreatedAsync(orderId) {
    try {
      const db = dbGetter();
      const deliverySelect = hasColumn(db, 'web_orders', 'delivery_method')
        ? "wo.delivery_method AS delivery_method"
        : "'courier' AS delivery_method";
      const row = db
        .prepare(
          `
          SELECT wo.id, wo.status, wo.order_number, wo.total_amount, wo.payment_method,
                 ${deliverySelect},
                 mc.telegram_id, mc.first_name, mc.last_name, mc.phone
          FROM web_orders wo
          INNER JOIN marketplace_customers mc ON mc.id = wo.customer_id
          WHERE wo.id = ?
        `,
        )
        .get(orderId);
      const token = process.env.TELEGRAM_BOT_TOKEN;
      if (!row || !token) return;
      if (row?.telegram_id) {
        void notifyOrderCreated({
          botToken: token,
          telegramId: row.telegram_id,
          orderNumber: row.order_number,
          totalSums: row.total_amount,
          paymentMethod: row.payment_method,
          deliveryMethod: row.delivery_method,
        });
      }
      const items = db
        .prepare(
          `
          SELECT wi.product_id, wi.quantity, p.name AS product_name
          FROM web_order_items wi
          LEFT JOIN products p ON p.id = wi.product_id
          WHERE wi.order_id = ?
          ORDER BY wi.id ASC
        `,
        )
        .all(orderId);
      const customerName = [row.first_name, row.last_name].filter(Boolean).join(' ').trim() || null;
      void notifyAdminsNewOrder({
        botToken: token,
        orderId,
        status: row.status,
        orderNumber: row.order_number,
        totalSums: row.total_amount,
        paymentMethod: row.payment_method,
        deliveryMethod: row.delivery_method,
        customerName,
        customerPhone: row.phone || null,
        items,
      });
    } catch (e) {
      console.warn('[orders] create notify failed:', e.message || String(e));
    }
  }

  function notifyStatusAsync(orderId, status) {
    try {
      const db = dbGetter();
      const deliverySelect = hasColumn(db, 'web_orders', 'delivery_method')
        ? "wo.delivery_method AS delivery_method"
        : "'courier' AS delivery_method";
      const row = db
        .prepare(
          `
          SELECT wo.order_number, ${deliverySelect}, mc.telegram_id
          FROM web_orders wo
          INNER JOIN marketplace_customers mc ON mc.id = wo.customer_id
          WHERE wo.id = ?
        `,
        )
        .get(orderId);
      const token = process.env.TELEGRAM_BOT_TOKEN;
      if (!row?.telegram_id || !token) return;
      void notifyOrderStatusChanged({
        botToken: token,
        telegramId: row.telegram_id,
        orderNumber: row.order_number,
        status,
        deliveryMethod: row.delivery_method,
      });
    } catch (e) {
      console.warn('[orders] status notify failed:', e.message || String(e));
    }
  }

  router.post(
    '/',
    idempotency('orders', (req) => req.customerId),
    (req, res) => {
      try {
        const customerId = req.customerId;
        const data = parseCreateBody(req.body);
        const db = dbGetter();
        const result = createOrder(db, customerId, data);
        if (result?.order_id != null) {
          notifyCreatedAsync(result.order_id);
        }
        res.status(201).json(result);
      } catch (e) {
        if (e.status && e.code) {
          res.status(e.status).json({ error: e.code, meta: e.meta });
          return;
        }
        console.error('[orders] POST /', e);
        res.status(500).json({ error: 'internal_error' });
      }
    },
  );

  router.get('/', (req, res) => {
    try {
      const customerId = req.customerId;
      const page = parseIntParam(req.query.page, 1, 1, 10_000);
      const limit = parseIntParam(req.query.limit, 20, 1, 100);
      const offset = (page - 1) * limit;

      const db = dbGetter();
      const hasDelivery = hasColumn(db, 'web_orders', 'delivery_method');
      const hasRating = hasColumn(db, 'web_orders', 'rating');
      const optionalColumns = [
        hasDelivery ? 'delivery_method' : "'courier' AS delivery_method",
        hasRating ? 'rating' : 'NULL AS rating',
        hasRating ? 'feedback' : 'NULL AS feedback',
        hasRating ? 'rated_at' : 'NULL AS rated_at',
      ].join(', ');
      const totalRow = db
        .prepare(
          `
        SELECT COUNT(*) AS n FROM web_orders WHERE customer_id = ?
      `
        )
        .get(customerId);
      const total = Number(totalRow?.n || 0);

      let rows;
      try {
        rows = db
          .prepare(
            `
          SELECT id, order_number, status, payment_method, payment_status, total_amount,
                 delivery_address, note, ${optionalColumns}, created_at, updated_at,
                 payment_expires_at, payment_provider
          FROM web_orders
          WHERE customer_id = ?
          ORDER BY created_at DESC
          LIMIT ? OFFSET ?
        `
          )
          .all(customerId, limit, offset);
      } catch (e) {
        if (!String(e.message || '').includes('no such column')) throw e;
        rows = db
          .prepare(
            `
          SELECT id, order_number, status, payment_method, payment_status, total_amount,
                 delivery_address, note, ${optionalColumns}, created_at, updated_at
          FROM web_orders
          WHERE customer_id = ?
          ORDER BY created_at DESC
          LIMIT ? OFFSET ?
        `
          )
          .all(customerId, limit, offset);
      }

      res.json({
        data: rows,
        meta: { page, limit, total, total_pages: Math.max(1, Math.ceil(total / limit)) },
      });
    } catch (e) {
      console.error('[orders] GET /', e);
      res.status(500).json({ error: 'internal_error' });
    }
  });

  router.post('/:id/reorder', (req, res) => {
    try {
      const customerId = req.customerId;
      const id = Number.parseInt(String(req.params.id), 10);
      if (!Number.isFinite(id)) {
        res.status(400).json({ error: 'invalid_id' });
        return;
      }

      const db = dbGetter();
      const deliverySelect = hasColumn(db, 'web_orders', 'delivery_method')
        ? 'delivery_method'
        : "'courier' AS delivery_method";
      const prev = db
        .prepare(
          `
        SELECT id, payment_method, delivery_address, note, ${deliverySelect}
        FROM web_orders
        WHERE id = ? AND customer_id = ?
      `,
        )
        .get(id, customerId);
      if (!prev) {
        res.status(404).json({ error: 'not_found' });
        return;
      }

      const prevItems = db
        .prepare(
          `
        SELECT product_id, quantity
        FROM web_order_items
        WHERE order_id = ?
        ORDER BY id ASC
      `,
        )
        .all(id);
      if (!Array.isArray(prevItems) || prevItems.length === 0) {
        res.status(400).json({ error: 'order_items_empty' });
        return;
      }

      const data = {
        items: prevItems.map((it) => ({
          product_id: String(it.product_id),
          quantity: Number.parseInt(String(it.quantity), 10) || 1,
        })),
        payment_method: parsePaymentMethod(prev.payment_method) || 'cash',
        delivery_method: normalizeDeliveryMethod(prev.delivery_method),
        delivery_address: String(prev.delivery_address || '').trim() || 'Manzil ko‘rsatilmagan',
        note: prev.note ? String(prev.note) : null,
        phone: null,
        location: null,
      };

      const result = createOrder(db, customerId, data);
      if (result?.order_id != null) {
        notifyCreatedAsync(result.order_id);
      }
      res.status(201).json({ ok: true, source_order_id: id, ...result });
    } catch (e) {
      if (e.status && e.code) {
        res.status(e.status).json({ error: e.code, meta: e.meta });
        return;
      }
      console.error('[orders] POST /:id/reorder', e);
      res.status(500).json({ error: 'internal_error' });
    }
  });

  router.post('/:id/cancel', (req, res) => {
    try {
      const customerId = req.customerId;
      const id = Number.parseInt(String(req.params.id), 10);
      if (!Number.isFinite(id)) {
        res.status(400).json({ error: 'invalid_id' });
        return;
      }

      const db = dbGetter();
      const row = db
        .prepare(
          `
        SELECT id, status FROM web_orders WHERE id = ? AND customer_id = ?
      `
        )
        .get(id, customerId);

      if (!row) {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      if (row.status !== 'new') {
        res.status(400).json({ error: 'cannot_cancel', message: 'Only new orders can be cancelled' });
        return;
      }

      // Only orders with status='new' reach this point (see check above), so
      // payment_status is 'pending'. Flip both fields atomically so the
      // expired-payment sweeper and any in-flight provider callbacks see
      // the order as terminally failed rather than still-pending.
      const now = new Date().toISOString();
      db.prepare(
        `
        UPDATE web_orders
        SET status = 'cancelled', payment_status = 'failed', updated_at = ?
        WHERE id = ?
      `
      ).run(now, id);
      notifyStatusAsync(id, 'cancelled');

      res.json({ ok: true, id, status: 'cancelled' });
    } catch (e) {
      console.error('[orders] POST /:id/cancel', e);
      res.status(500).json({ error: 'internal_error' });
    }
  });

  router.post('/:id/rating', (req, res) => {
    try {
      const customerId = req.customerId;
      const id = Number.parseInt(String(req.params.id), 10);
      const rating = Number.parseInt(String(req.body?.rating), 10);
      const feedback = req.body?.feedback == null ? '' : String(req.body.feedback).trim();
      if (!Number.isFinite(id)) {
        res.status(400).json({ error: 'invalid_id' });
        return;
      }
      if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
        res.status(400).json({ error: 'invalid_rating' });
        return;
      }
      if (feedback.length > 1000) {
        res.status(400).json({ error: 'feedback_too_long' });
        return;
      }

      const db = dbGetter();
      if (!hasColumn(db, 'web_orders', 'rating')) {
        res.status(503).json({ error: 'rating_not_available' });
        return;
      }
      const row = db
        .prepare(`SELECT id, status, rating, rated_at FROM web_orders WHERE id = ? AND customer_id = ?`)
        .get(id, customerId);
      if (!row) {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      if (String(row.status || '').toLowerCase() !== 'delivered') {
        res.status(400).json({ error: 'order_not_delivered' });
        return;
      }
      if (row.rating != null || row.rated_at != null) {
        res.status(409).json({ error: 'already_rated' });
        return;
      }
      const now = new Date().toISOString();
      const updated = db.prepare(
        `
        UPDATE web_orders
        SET rating = ?, feedback = ?, rated_at = ?, updated_at = ?
        WHERE id = ? AND customer_id = ?
          AND rating IS NULL
          AND rated_at IS NULL
      `,
      ).run(rating, feedback || null, now, now, id, customerId);
      if (!updated.changes) {
        res.status(409).json({ error: 'already_rated' });
        return;
      }
      res.json({ ok: true, id, rating, feedback: feedback || null, rated_at: now });
    } catch (e) {
      console.error('[orders] POST /:id/rating', e);
      res.status(500).json({ error: 'internal_error' });
    }
  });

  router.get('/:id', (req, res) => {
    try {
      const customerId = req.customerId;
      const id = Number.parseInt(String(req.params.id), 10);
      if (!Number.isFinite(id)) {
        res.status(400).json({ error: 'invalid_id' });
        return;
      }

      const db = dbGetter();
      const hasDelivery = hasColumn(db, 'web_orders', 'delivery_method');
      const hasRating = hasColumn(db, 'web_orders', 'rating');
      const optionalColumns = [
        hasDelivery ? 'delivery_method' : "'courier' AS delivery_method",
        hasRating ? 'rating' : 'NULL AS rating',
        hasRating ? 'feedback' : 'NULL AS feedback',
        hasRating ? 'rated_at' : 'NULL AS rated_at',
      ].join(', ');
      let order;
      try {
        order = db
          .prepare(
            `
          SELECT id, order_number, status, payment_method, payment_status, payment_id,
                 total_amount, delivery_address, note, ${optionalColumns}, created_at, updated_at,
                 payment_expires_at, payment_provider
          FROM web_orders
          WHERE id = ? AND customer_id = ?
        `
          )
          .get(id, customerId);
      } catch (e) {
        if (!String(e.message || '').includes('no such column')) throw e;
        order = db
          .prepare(
            `
          SELECT id, order_number, status, payment_method, payment_status, payment_id,
                 total_amount, delivery_address, note, ${optionalColumns}, created_at, updated_at
          FROM web_orders
          WHERE id = ? AND customer_id = ?
        `
          )
          .get(id, customerId);
      }

      if (!order) {
        res.status(404).json({ error: 'not_found' });
        return;
      }

      const items = db
        .prepare(
          `
        SELECT id, product_id, quantity, price_at_order
        FROM web_order_items
        WHERE order_id = ?
        ORDER BY id ASC
      `
        )
        .all(id);

      res.json({ ...order, items });
    } catch (e) {
      console.error('[orders] GET /:id', e);
      res.status(500).json({ error: 'internal_error' });
    }
  });

  return router;
}

module.exports = { mountOrdersRoutes, createOrder, parseCreateBody };

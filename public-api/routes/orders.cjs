'use strict';

const express = require('express');
const { allocateOrderNumber } = require('../lib/orderNumber.cjs');
const { getAvailableStock } = require('../lib/stockHelpers.cjs');
const { buildPaymeCheckoutUrl, buildClickCheckoutUrl } = require('../lib/paymentLinks.cjs');

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
  const addr = body.delivery_address != null ? String(body.delivery_address).trim() : '';
  if (addr.length < 3) {
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
    delivery_address: addr,
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
  const lines = [];
  for (const it of data.items) {
    const p = db
      .prepare(
        `
      SELECT id, sale_price, track_stock, is_active
      FROM products
      WHERE id = ?
    `
      )
      .get(it.product_id);

    if (!p || !boolCol(p.is_active)) {
      const err = new Error('product_not_found');
      err.code = 'PRODUCT_NOT_FOUND';
      err.status = 400;
      err.meta = { product_id: it.product_id };
      throw err;
    }

    const track = boolCol(p.track_stock);
    let stockOk = true;
    if (track) {
      const avail = getAvailableStock(db, it.product_id);
      if (avail + 1e-9 < it.quantity) {
        const err = new Error('insufficient_stock');
        err.code = 'INSUFFICIENT_STOCK';
        err.status = 400;
        err.meta = { product_id: it.product_id, available: Math.floor(avail), requested: it.quantity };
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

  const payExpiresAt =
    data.payment_method === 'payme' || data.payment_method === 'click'
      ? new Date(Date.now() + Number(process.env.PAYMENT_EXPIRE_MINUTES || 15) * 60 * 1000).toISOString()
      : null;

  return db.transaction(() => {
    const orderNumber = allocateOrderNumber(db);
    const now = new Date().toISOString();

    const payStatus = 'pending';
    const status = 'new';

    let hasExpiry = false;
    try {
      const cols = db.prepare('PRAGMA table_info(web_orders)').all();
      hasExpiry = cols.some((c) => c.name === 'payment_expires_at');
    } catch {
      hasExpiry = false;
    }

    let r;
    if (hasExpiry) {
      r = db
        .prepare(
          `
        INSERT INTO web_orders (
          order_number, customer_id, status, payment_method, payment_status,
          total_amount, delivery_address, note, created_at, updated_at, payment_expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
        )
        .run(
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
          payExpiresAt,
        );
    } else {
      r = db
        .prepare(
          `
        INSERT INTO web_orders (
          order_number, customer_id, status, payment_method, payment_status,
          total_amount, delivery_address, note, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
        )
        .run(
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
        );
    }

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
      payment_status: payStatus,
      total_amount: totalAmount,
      payment_url: paymentUrl,
    };
  })();
}

function mountOrdersRoutes(dbGetter) {
  const router = express.Router();

  router.post('/', (req, res) => {
    try {
      const customerId = req.customerId;
      const data = parseCreateBody(req.body);
      const db = dbGetter();
      const result = createOrder(db, customerId, data);
      res.status(201).json(result);
    } catch (e) {
      if (e.status && e.code) {
        res.status(e.status).json({ error: e.code, meta: e.meta });
        return;
      }
      console.error('[orders] POST /', e);
      res.status(500).json({ error: 'internal_error' });
    }
  });

  router.get('/', (req, res) => {
    try {
      const customerId = req.customerId;
      const page = parseIntParam(req.query.page, 1, 1, 10_000);
      const limit = parseIntParam(req.query.limit, 20, 1, 100);
      const offset = (page - 1) * limit;

      const db = dbGetter();
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
                 delivery_address, note, created_at, updated_at, payment_expires_at, payment_provider
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
                 delivery_address, note, created_at, updated_at
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

      const now = new Date().toISOString();
      db.prepare(
        `
        UPDATE web_orders SET status = 'cancelled', updated_at = ? WHERE id = ?
      `
      ).run(now, id);

      res.json({ ok: true, id, status: 'cancelled' });
    } catch (e) {
      console.error('[orders] POST /:id/cancel', e);
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
      let order;
      try {
        order = db
          .prepare(
            `
          SELECT id, order_number, status, payment_method, payment_status, payment_id,
                 total_amount, delivery_address, note, created_at, updated_at,
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
                 total_amount, delivery_address, note, created_at, updated_at
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

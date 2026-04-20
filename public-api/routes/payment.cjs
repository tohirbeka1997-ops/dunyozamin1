'use strict';

const express = require('express');
const { createBearerAuth } = require('../middleware/bearerAuth.cjs');
const { handlePaycomRpc } = require('../lib/payme.cjs');
const { handleClickCallback } = require('../lib/click.cjs');
const { buildPaymeCheckoutUrl, buildClickCheckoutUrl } = require('../lib/paymentLinks.cjs');
const { notifyOrderPaid } = require('../lib/telegramNotify.cjs');

function logPaymentSafe(db, orderId, provider, event, payload) {
  try {
    if (!orderId) return;
    db.prepare(
      `
      INSERT INTO payment_logs (order_id, provider, event, payload, created_at)
      VALUES (?, ?, ?, ?, datetime('now'))
    `
    ).run(orderId, provider, event, JSON.stringify(payload));
  } catch (e) {
    console.warn('[payment] payment_logs:', e.message);
  }
}

async function notifyAfterPaid(dbGetter, orderId) {
  const db = dbGetter();
  const row = db
    .prepare(
      `
    SELECT wo.order_number, wo.total_amount, mc.telegram_id
    FROM web_orders wo
    INNER JOIN marketplace_customers mc ON mc.id = wo.customer_id
    WHERE wo.id = ?
  `
    )
    .get(orderId);
  if (!row?.telegram_id) return;
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  await notifyOrderPaid({
    botToken: token,
    telegramId: row.telegram_id,
    orderNumber: row.order_number,
    totalSums: row.total_amount,
  });
}

function mountPaymentRoutes(dbGetter) {
  const router = express.Router();
  const bearerAuth = createBearerAuth();
  const jsonBody = express.json({ limit: '512kb' });

  router.post('/payme/callback', express.json({ limit: '2mb' }), (req, res) => {
    try {
      const db = dbGetter();
      const mid = process.env.PAYME_MERCHANT_ID;
      const key = process.env.PAYME_SECRET_KEY;
      if (!mid || !key) {
        res.status(503).json({ error: 'payme_not_configured' });
        return;
      }

      const out = handlePaycomRpc(db, req, req.body, { merchantId: mid, apiKey: key });
      const oid = req.body?.params?.account?.order_id;
      const orderId =
        oid != null ? Number.parseInt(String(oid), 10) : Number.NaN;
      if (Number.isFinite(orderId)) {
        logPaymentSafe(db, orderId, 'payme', 'callback', req.body);
      }

      if (out.notifyOrderId != null) {
        void notifyAfterPaid(dbGetter, out.notifyOrderId);
      }

      res.json(out.body);
    } catch (e) {
      console.error('[payment] payme callback', e);
      res.status(500).json({ error: 'internal_error' });
    }
  });

  router.post('/click/callback', express.urlencoded({ extended: true }), (req, res) => {
    try {
      const db = dbGetter();
      const serviceId = process.env.CLICK_SERVICE_ID;
      const secretKey = process.env.CLICK_SECRET_KEY;
      if (!serviceId || !secretKey) {
        res.status(503).json({ error: 'click_not_configured' });
        return;
      }

      const params = req.body || {};
      const orderId = Number.parseInt(String(params.merchant_trans_id ?? ''), 10);
      if (Number.isFinite(orderId)) {
        logPaymentSafe(db, orderId, 'click', 'callback', params);
      }

      const result = handleClickCallback(
        db,
        params,
        { serviceId, secretKey },
        (id) => notifyAfterPaid(dbGetter, id),
      );

      res.json(result);
    } catch (e) {
      console.error('[payment] click callback', e);
      res.status(500).json({ error: 'internal_error' });
    }
  });

  router.get('/status/:orderId', bearerAuth, (req, res) => {
    try {
      const oid = Number.parseInt(String(req.params.orderId), 10);
      if (!Number.isFinite(oid)) {
        res.status(400).json({ error: 'invalid_id' });
        return;
      }
      const db = dbGetter();
      const row = db
        .prepare(
          `
        SELECT id, order_number, status, payment_method, payment_status, payment_id,
               total_amount, payment_expires_at, payment_provider, created_at, updated_at
        FROM web_orders
        WHERE id = ? AND customer_id = ?
      `
        )
        .get(oid, req.customerId);

      if (!row) {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      res.json(row);
    } catch (e) {
      if (String(e.message || '').includes('no such column')) {
        const db = dbGetter();
        const row = db
          .prepare(
            `
          SELECT id, order_number, status, payment_method, payment_status, payment_id,
                 total_amount, created_at, updated_at
          FROM web_orders
          WHERE id = ? AND customer_id = ?
        `
          )
          .get(Number.parseInt(String(req.params.orderId), 10), req.customerId);
        if (!row) {
          res.status(404).json({ error: 'not_found' });
          return;
        }
        res.json(row);
        return;
      }
      console.error('[payment] GET status', e);
      res.status(500).json({ error: 'internal_error' });
    }
  });

  router.post('/payme/create', jsonBody, bearerAuth, (req, res) => {
    try {
      const orderId = Number.parseInt(String(req.body?.order_id ?? ''), 10);
      if (!Number.isFinite(orderId)) {
        res.status(400).json({ error: 'order_id_required' });
        return;
      }
      const mid = process.env.PAYME_MERCHANT_ID;
      if (!mid) {
        res.status(503).json({ error: 'payme_not_configured' });
        return;
      }

      const db = dbGetter();
      const row = db
        .prepare(
          `
        SELECT id, customer_id, total_amount, status, payment_status, payment_method
        FROM web_orders
        WHERE id = ?
      `
        )
        .get(orderId);

      if (!row || row.customer_id !== req.customerId) {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      if (row.status !== 'new' || row.payment_status !== 'pending') {
        res.status(400).json({ error: 'invalid_order_state' });
        return;
      }
      if (String(row.payment_method) !== 'payme') {
        res.status(400).json({ error: 'payment_method_mismatch' });
        return;
      }

      const returnUrl = String(
        req.body?.return_url || process.env.PAYME_RETURN_URL || process.env.PUBLIC_APP_RETURN_URL || '',
      ).trim();
      const paymentUrl = buildPaymeCheckoutUrl({
        merchantId: mid,
        orderId,
        totalSums: row.total_amount,
        returnUrl,
      });

      if (!paymentUrl) {
        res.status(500).json({ error: 'payment_url_failed' });
        return;
      }

      res.json({ payment_url: paymentUrl, order_id: orderId });
    } catch (e) {
      console.error('[payment] payme create', e);
      res.status(500).json({ error: 'internal_error' });
    }
  });

  router.post('/click/create', jsonBody, bearerAuth, (req, res) => {
    try {
      const orderId = Number.parseInt(String(req.body?.order_id ?? ''), 10);
      if (!Number.isFinite(orderId)) {
        res.status(400).json({ error: 'order_id_required' });
        return;
      }
      const serviceId = process.env.CLICK_SERVICE_ID;
      const merchantId = process.env.CLICK_MERCHANT_ID;
      if (!serviceId || !merchantId) {
        res.status(503).json({ error: 'click_not_configured' });
        return;
      }

      const db = dbGetter();
      const row = db
        .prepare(
          `
        SELECT id, customer_id, total_amount, status, payment_status, payment_method
        FROM web_orders
        WHERE id = ?
      `
        )
        .get(orderId);

      if (!row || row.customer_id !== req.customerId) {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      if (row.status !== 'new' || row.payment_status !== 'pending') {
        res.status(400).json({ error: 'invalid_order_state' });
        return;
      }
      if (String(row.payment_method) !== 'click') {
        res.status(400).json({ error: 'payment_method_mismatch' });
        return;
      }

      const returnUrl = String(
        req.body?.return_url || process.env.CLICK_RETURN_URL || process.env.PUBLIC_APP_RETURN_URL || '',
      ).trim();
      const paymentUrl = buildClickCheckoutUrl({
        serviceId,
        merchantId,
        orderId,
        totalSums: row.total_amount,
        returnUrl,
      });

      if (!paymentUrl) {
        res.status(500).json({ error: 'payment_url_failed' });
        return;
      }

      res.json({ payment_url: paymentUrl, order_id: orderId });
    } catch (e) {
      console.error('[payment] click create', e);
      res.status(500).json({ error: 'internal_error' });
    }
  });

  return router;
}

module.exports = { mountPaymentRoutes, notifyAfterPaid };

'use strict';

const express = require('express');
const { openTenantDatabase } = require('../../lib/staffDb.cjs');
const { getPosBundle } = require('../../lib/staffPos.cjs');
const { mapStaffServiceError } = require('../../lib/staffErrorMap.cjs');
const { validate } = require('../../middleware/validate.cjs');
const { staffReturnCreateBodySchema } = require('../../schemas/staff.schema.cjs');

const ALLOWED_REFUND_METHODS = new Set(['cash', 'card', 'credit']);

function mapServiceError(e, res) {
  mapStaffServiceError(e, res, { logTag: '[staff/returns]' });
}

function normalizeRefundMethod(raw) {
  const m = String(raw || 'cash')
    .trim()
    .toLowerCase();
  if (m === 'card') return 'card';
  if (m === 'credit' || m === 'customer_account' || m === 'balance') return 'credit';
  return 'cash';
}

function mountStaffReturnsRoutes() {
  const router = express.Router();

  function ctxForReq(req) {
    const db = openTenantDatabase(req.staffUser.tenant);
    return { db, bundle: getPosBundle(db) };
  }

  // POST /v1/staff/returns — create and complete an order return (same path as desktop POS)
  router.post('/', validate({ body: staffReturnCreateBodySchema }), (req, res) => {
    try {
      const body = req.body || {};
      const orderId = body.order_id != null ? String(body.order_id).trim() : '';
      if (!orderId) {
        res.status(400).json({ error: 'validation_error', message: 'order_id required' });
        return;
      }

      const rawItems = Array.isArray(body.items) ? body.items : [];
      if (rawItems.length === 0) {
        res.status(400).json({ error: 'validation_error', message: 'Kamida bitta qaytariladigan mahsulot kerak' });
        return;
      }

      const items = [];
      for (const raw of rawItems) {
        const orderItemId = raw?.order_item_id != null ? String(raw.order_item_id).trim() : '';
        const quantity = Number(raw?.quantity);
        if (!orderItemId || !Number.isFinite(quantity) || quantity <= 0) {
          res.status(400).json({
            error: 'validation_error',
            message: 'Har bir qator uchun order_item_id va quantity > 0 kerak',
          });
          return;
        }
        items.push({ order_item_id: orderItemId, quantity });
      }

      const refundMethod = normalizeRefundMethod(body.refund_method);
      if (!ALLOWED_REFUND_METHODS.has(refundMethod)) {
        res.status(400).json({
          error: 'validation_error',
          message: "refund_method must be 'cash', 'card', or 'credit'",
        });
        return;
      }

      const { db, bundle } = ctxForReq(req);
      const order = db.prepare('SELECT id, status, customer_id FROM orders WHERE id = ?').get(orderId);
      if (!order) {
        res.status(404).json({ error: 'not_found', message: 'Buyurtma topilmadi' });
        return;
      }

      const orderStatus = String(order.status || '').toLowerCase();
      if (orderStatus !== 'completed') {
        res.status(400).json({
          error: 'validation_error',
          message: 'Faqat yakunlangan sotuvlarni qaytarish mumkin',
        });
        return;
      }

      if (refundMethod === 'credit') {
        const customerId = order.customer_id != null ? String(order.customer_id) : '';
        if (!customerId || customerId === 'default-customer-001') {
          res.status(400).json({
            error: 'validation_error',
            message: 'Mijoz balansiga qaytarish uchun buyurtmada mijoz bo‘lishi kerak',
          });
          return;
        }
      }

      const reasonRaw = body.reason != null ? String(body.reason).trim() : '';
      const returnReason = reasonRaw || 'Mobil qaytarish';

      const result = bundle.returns.createReturn({
        order_id: orderId,
        items,
        return_reason: returnReason,
        refund_method: refundMethod,
        user_id: req.staffUser.id,
        cashier_id: req.staffUser.id,
        notes: body.notes != null ? String(body.notes).slice(0, 500) : null,
      });

      res.status(201).json({ data: result });
    } catch (e) {
      mapServiceError(e, res);
    }
  });

  return router;
}

module.exports = { mountStaffReturnsRoutes };

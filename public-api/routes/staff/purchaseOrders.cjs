'use strict';

const express = require('express');
const { ERROR_CODES } = require('../../../electron/lib/errors.cjs');
const { openTenantDatabase } = require('../../lib/staffDb.cjs');
const { getPosBundle } = require('../../lib/staffPos.cjs');
const { mapStaffServiceError } = require('../../lib/staffErrorMap.cjs');

function mapServiceError(e, res) {
  mapStaffServiceError(e, res, { logTag: '[staff/purchase-orders]' });
}

function mountStaffPurchaseOrdersRoutes() {
  const router = express.Router();

  function bundleForReq(req) {
    return getPosBundle(openTenantDatabase(req.staffUser.tenant));
  }

  // GET /v1/staff/purchase-orders?status=&q=&limit=
  router.get('/', (req, res) => {
    try {
      const filters = { include_items: true };
      if (req.query.status) filters.status = String(req.query.status);
      if (req.query.q) filters.search = String(req.query.q);
      const limitRaw = Number(req.query.limit);
      if (Number.isFinite(limitRaw) && limitRaw > 0) {
        filters.limit = Math.min(limitRaw, 100);
      } else {
        filters.limit = 50;
      }
      const { purchases } = bundleForReq(req);
      const rows = purchases.list(filters);
      res.json({ data: rows, meta: { total: rows.length, limit: filters.limit } });
    } catch (e) {
      mapServiceError(e, res);
    }
  });

  // GET /v1/staff/purchase-orders/:id
  router.get('/:id', (req, res) => {
    try {
      const { purchases } = bundleForReq(req);
      const po = purchases.get(req.params.id);
      res.json({ data: po });
    } catch (e) {
      mapServiceError(e, res);
    }
  });

  // POST /v1/staff/purchase-orders
  router.post('/', (req, res) => {
    try {
      const body = req.body || {};
      const supplierId = body.supplier_id != null ? String(body.supplier_id).trim() : '';
      if (!supplierId) {
        res.status(400).json({
          error: 'validation_error',
          message: 'Yetkazib beruvchi tanlanishi shart',
        });
        return;
      }

      const rawItems = Array.isArray(body.items) ? body.items : [];
      if (rawItems.length === 0) {
        res.status(400).json({
          error: 'validation_error',
          message: 'Kamida bitta mahsulot qatori kerak',
        });
        return;
      }

      const bundle = bundleForReq(req);
      const { purchases, suppliers, exchangeRates } = bundle;

      let supplier;
      try {
        supplier = suppliers.get(supplierId);
      } catch (e) {
        mapServiceError(e, res);
        return;
      }

      const settlement = String(supplier?.settlement_currency || 'UZS').toUpperCase();
      let currency = body.currency != null ? String(body.currency).toUpperCase() : 'UZS';
      let fxRate = body.fx_rate != null ? Number(body.fx_rate) : null;

      if (settlement === 'USD') {
        currency = 'USD';
        if (!Number.isFinite(fxRate) || fxRate <= 0) {
          const row = exchangeRates.getLatest({ base_currency: 'USD', quote_currency: 'UZS' });
          fxRate = row?.rate != null ? Number(row.rate) : null;
        }
        if (!Number.isFinite(fxRate) || fxRate <= 0) {
          res.status(400).json({
            error: 'validation_error',
            message:
              'USD ta\'minotchi uchun valyuta kursi topilmadi. POS sozlamalarida USD/UZS kursini kiriting.',
          });
          return;
        }
      }

      const items = rawItems.map((it) => {
        const productId = it?.product_id != null ? String(it.product_id) : '';
        const orderedQty = Number(it?.ordered_qty ?? it?.quantity);
        const unitCostUzs = Number(it?.unit_cost ?? it?.unit_price ?? 0);
        if (!productId || !Number.isFinite(orderedQty) || orderedQty <= 0) {
          throw Object.assign(
            new Error('Har bir qatorda mahsulot va miqdor (0 dan katta) bo\'lishi kerak'),
            { code: ERROR_CODES.VALIDATION_ERROR },
          );
        }

        const row = {
          product_id: productId,
          ordered_qty: orderedQty,
          unit_cost: unitCostUzs,
        };

        if (currency === 'USD') {
          const unitCostUsdRaw = it?.unit_cost_usd ?? it?.unit_price_usd;
          const unitCostUsd =
            unitCostUsdRaw != null && Number.isFinite(Number(unitCostUsdRaw))
              ? Number(unitCostUsdRaw)
              : unitCostUzs > 0
                ? unitCostUzs / fxRate
                : 0;
          row.unit_cost_usd = unitCostUsd;
          row.unit_cost = unitCostUsd * fxRate;
        }

        return row;
      });

      const po = purchases.createOrder({
        supplier_id: supplierId,
        supplier_name: supplier?.name || null,
        items,
        notes: body.notes != null ? String(body.notes).slice(0, 500) : null,
        created_by: req.staffUser.id,
        currency,
        fx_rate: currency === 'USD' ? fxRate : null,
      });
      res.status(201).json({ data: po });
    } catch (e) {
      mapServiceError(e, res);
    }
  });

  // POST /v1/staff/purchase-orders/:id/receive
  router.post('/:id/receive', (req, res) => {
    try {
      const body = req.body || {};
      const rawItems = Array.isArray(body.items) ? body.items : [];
      if (rawItems.length === 0) {
        res.status(400).json({ error: 'validation_error', message: 'items required' });
        return;
      }
      const items = rawItems.map((it) => {
        const itemId = it?.item_id != null ? String(it.item_id) : '';
        const receivedQty = Number(it?.received_qty ?? it?.quantity);
        if (!itemId || !Number.isFinite(receivedQty) || receivedQty <= 0) {
          throw Object.assign(new Error('each item needs item_id and received_qty > 0'), {
            code: ERROR_CODES.VALIDATION_ERROR,
          });
        }
        return {
          item_id: itemId,
          received_qty: receivedQty,
          product_id: it?.product_id != null ? String(it.product_id) : undefined,
        };
      });

      const { purchases } = bundleForReq(req);
      const po = purchases.receiveGoods(req.params.id, {
        items,
        received_at: body.received_at != null ? String(body.received_at) : null,
        received_by: req.staffUser.id,
      });
      res.json({ data: po });
    } catch (e) {
      mapServiceError(e, res);
    }
  });

  return router;
}

module.exports = { mountStaffPurchaseOrdersRoutes };

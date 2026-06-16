'use strict';

const express = require('express');
const { openTenantDatabase } = require('../../lib/staffDb.cjs');
const { getPosBundle } = require('../../lib/staffPos.cjs');
const { mapStaffServiceError } = require('../../lib/staffErrorMap.cjs');

function mapServiceError(e, res) {
  mapStaffServiceError(e, res, { logTag: '[staff/suppliers]' });
}

function mountStaffSuppliersRoutes() {
  const router = express.Router();

  function bundleForReq(req) {
    return getPosBundle(openTenantDatabase(req.staffUser.tenant));
  }

  // GET /v1/staff/suppliers/search?q=&limit=
  router.get('/search', (req, res) => {
    try {
      const q = req.query.q != null ? String(req.query.q).trim() : '';
      const limitRaw = Number(req.query.limit);
      const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 100) : 50;
      const { suppliers } = bundleForReq(req);
      const rows = suppliers.list({
        search: q || undefined,
        includeInactive: false,
        limit,
      });
      res.json({ data: rows, meta: { total: rows.length, limit } });
    } catch (e) {
      mapServiceError(e, res);
    }
  });

  // GET /v1/staff/suppliers/:id/ledger?limit=50
  router.get('/:id/ledger', (req, res) => {
    try {
      const limitRaw = Number(req.query.limit);
      const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 200) : 50;
      const { suppliers } = bundleForReq(req);
      let ledger = suppliers.getLedger(req.params.id, {});
      ledger = ledger.slice().reverse().slice(0, limit);
      res.json({ data: ledger, meta: { limit, total: ledger.length } });
    } catch (e) {
      mapServiceError(e, res);
    }
  });

  // GET /v1/staff/suppliers/:id
  router.get('/:id', (req, res) => {
    try {
      const { suppliers } = bundleForReq(req);
      const supplier = suppliers.get(req.params.id);
      res.json({ data: supplier });
    } catch (e) {
      mapServiceError(e, res);
    }
  });

  // POST /v1/staff/suppliers/:id/pay — record payment to supplier (reduces balance)
  router.post('/:id/pay', (req, res) => {
    try {
      const body = req.body || {};
      const amount = Number(body.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        res.status(400).json({ error: 'validation_error', message: 'amount must be > 0' });
        return;
      }
      const rawMethod = String(body.method || body.payment_method || 'cash').trim().toLowerCase();
      const allowed = new Set(['cash', 'card', 'transfer']);
      const paymentMethod = allowed.has(rawMethod) ? rawMethod : 'cash';
      const { suppliers } = bundleForReq(req);
      const payment = suppliers.createPayment({
        supplier_id: req.params.id,
        amount,
        payment_method: paymentMethod,
        notes: body.notes != null ? String(body.notes).slice(0, 500) : null,
        created_by: req.staffUser.id,
      });
      const supplier = suppliers.get(req.params.id);
      res.status(201).json({ data: { payment, supplier } });
    } catch (e) {
      mapServiceError(e, res);
    }
  });

  return router;
}

module.exports = { mountStaffSuppliersRoutes };

'use strict';

const express = require('express');
const { readCustomerBalances } = require('../../../electron/lib/customerBalance.cjs');
const { openTenantDatabase } = require('../../lib/staffDb.cjs');
const { getPosBundle } = require('../../lib/staffPos.cjs');
const { mapStaffServiceError } = require('../../lib/staffErrorMap.cjs');

function mapServiceError(e, res) {
  mapStaffServiceError(e, res, { logTag: '[staff/customers]' });
}

function enrichCustomer(db, customer) {
  const balances = readCustomerBalances(db, customer.id);
  return {
    ...customer,
    balance_uzs: balances.uzs,
    balance_usd: balances.usd,
  };
}

function mountStaffCustomersRoutes() {
  const router = express.Router();

  function ctxForReq(req) {
    const db = openTenantDatabase(req.staffUser.tenant);
    return { db, bundle: getPosBundle(db) };
  }

  // POST /v1/staff/customers — create (name required, phone optional)
  router.post('/', (req, res) => {
    try {
      const body = req.body || {};
      const name = body.name != null ? String(body.name).trim() : '';
      if (!name) {
        res.status(400).json({ error: 'validation_error', message: 'Customer name is required' });
        return;
      }
      const { db, bundle } = ctxForReq(req);
      const customer = bundle.customers.create({
        name,
        phone: body.phone != null ? String(body.phone).trim() : null,
        notes: body.notes != null ? String(body.notes).slice(0, 500) : null,
      });
      res.status(201).json({ data: enrichCustomer(db, customer) });
    } catch (e) {
      mapServiceError(e, res);
    }
  });

  // GET /v1/staff/customers/search?q=&limit=
  router.get('/search', (req, res) => {
    try {
      const q = req.query.q != null ? String(req.query.q).trim() : '';
      const limitRaw = Number(req.query.limit);
      const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 100) : 50;
      const { db, bundle } = ctxForReq(req);
      const rows = bundle.customers.list({ search: q || undefined, status: 'active' });
      const data = rows.slice(0, limit).map((c) => enrichCustomer(db, c));
      res.json({ data, meta: { total: rows.length, limit } });
    } catch (e) {
      mapServiceError(e, res);
    }
  });

  // GET /v1/staff/customers/:id
  router.get('/:id', (req, res) => {
    try {
      const { db, bundle } = ctxForReq(req);
      const customer = bundle.customers.getById(req.params.id);
      res.json({ data: enrichCustomer(db, customer) });
    } catch (e) {
      mapServiceError(e, res);
    }
  });

  // PATCH /v1/staff/customers/:id — update name/phone/notes
  router.patch('/:id', (req, res) => {
    try {
      const body = req.body || {};
      const patch = {};
      if (body.name !== undefined) patch.name = String(body.name);
      if (body.phone !== undefined) patch.phone = body.phone == null ? null : String(body.phone);
      if (body.notes !== undefined) patch.notes = body.notes == null ? null : String(body.notes);
      if (!Object.keys(patch).length) {
        res.status(400).json({ error: 'validation_error', message: 'No fields to update' });
        return;
      }
      const { db, bundle } = ctxForReq(req);
      const customer = bundle.customers.update(req.params.id, patch);
      res.json({ data: enrichCustomer(db, customer) });
    } catch (e) {
      mapServiceError(e, res);
    }
  });

  // GET /v1/staff/customers/:id/ledger
  router.get('/:id/ledger', (req, res) => {
    try {
      const { bundle } = ctxForReq(req);
      const limitRaw = Number(req.query.limit);
      const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 200) : 100;
      const offsetRaw = Number(req.query.offset);
      const offset = Number.isFinite(offsetRaw) && offsetRaw >= 0 ? offsetRaw : 0;
      const filters = { limit, offset };
      if (req.query.type) filters.type = String(req.query.type);
      const data = bundle.customers.getLedger(req.params.id, filters);
      res.json({ data });
    } catch (e) {
      mapServiceError(e, res);
    }
  });

  // POST /v1/staff/customers/:id/receive-payment
  router.post('/:id/receive-payment', (req, res) => {
    try {
      const body = req.body || {};
      const amount = Number(body.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        res.status(400).json({ error: 'validation_error', message: 'amount must be > 0' });
        return;
      }
      const paymentMethod = String(body.payment_method || 'cash').trim().toLowerCase();
      const { bundle } = ctxForReq(req);
      const result = bundle.customers.receivePayment({
        customer_id: req.params.id,
        amount,
        payment_method: paymentMethod,
        notes: body.notes != null ? String(body.notes).slice(0, 500) : null,
        received_by: req.staffUser.id,
        source: 'staff_mobile',
        operation: 'payment_in',
        shift_id: body.shift_id != null ? String(body.shift_id) : null,
        currency: body.currency != null ? String(body.currency) : 'UZS',
        fx_rate: body.fx_rate != null ? Number(body.fx_rate) : null,
      });
      res.status(201).json({ data: result });
    } catch (e) {
      mapServiceError(e, res);
    }
  });

  return router;
}

module.exports = { mountStaffCustomersRoutes };

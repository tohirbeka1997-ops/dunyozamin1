'use strict';

const express = require('express');
const CustomersService = require('../../../electron/services/customersService.cjs');

function fail(e, res, tag) {
  console.error(tag, e);
  res.status(500).json({ error: 'internal_error', message: e?.message || 'Internal error' });
}

function mountAdminCustomersRoutes(dbGetter) {
  const router = express.Router();
  const svc = () => new CustomersService(dbGetter());

  router.get('/', (req, res) => {
    try {
      const filters = {};
      if (req.query.q) filters.search = String(req.query.q);
      if (req.query.sortBy) filters.sortBy = String(req.query.sortBy);
      if (req.query.sortOrder) filters.sortOrder = String(req.query.sortOrder);
      const rows = svc(req).list(filters);
      const limit = Math.min(Number(req.query.limit) || 100, 500);
      res.json({ data: rows.slice(0, limit), meta: { total: rows.length, limit } });
    } catch (e) {
      fail(e, res, '[admin/customers] GET /');
    }
  });

  router.get('/:id', (req, res) => {
    try {
      const c = svc(req).getById(req.params.id);
      if (!c) return res.status(404).json({ error: 'not_found' });
      res.json({ data: c });
    } catch (e) {
      fail(e, res, '[admin/customers] GET /:id');
    }
  });

  router.get('/:id/ledger', (req, res) => {
    try {
      res.json({ data: svc(req).getLedger(req.params.id, {}) });
    } catch (e) {
      fail(e, res, '[admin/customers] GET /:id/ledger');
    }
  });

  return router;
}

module.exports = { mountAdminCustomersRoutes };

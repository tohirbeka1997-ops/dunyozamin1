'use strict';

const express = require('express');
const WebOrdersService = require('../../../electron/services/webOrdersService.cjs');
const { ERROR_CODES } = require('../../../electron/lib/errors.cjs');
const { allowedNextStatuses } = require('../../lib/webOrderStatusFlow.cjs');
const { normalizeQueueId } = require('../../lib/webOrderQueues.cjs');
const { validate } = require('../../middleware/validate.cjs');
const { adminOrderStatusPatchBodySchema } = require('../../schemas/admin.schema.cjs');
const { logger } = require('../../lib/logger.cjs');

function mapErr(e, res) {
  const code = e?.code || e?.name;
  const message = e?.message || 'Request failed';
  if (code === ERROR_CODES.NOT_FOUND) return res.status(404).json({ error: 'not_found', message });
  if (code === ERROR_CODES.VALIDATION_ERROR) return res.status(400).json({ error: 'validation_error', message });
  if (code === ERROR_CODES.PERMISSION_DENIED) return res.status(403).json({ error: 'forbidden', message });
  logger.error({ err: e }, '[admin/orders]');
  return res.status(500).json({ error: 'internal_error', message: 'Internal error' });
}

function enrich(order) {
  if (!order) return order;
  return { ...order, allowed_next_statuses: allowedNextStatuses(order.status, { deliveryMethod: order.delivery_method }) };
}

function mountAdminOrdersRoutes(dbGetter) {
  const router = express.Router();
  const dbFor = () => dbGetter();

  router.get('/queues', (req, res) => {
    try {
      res.json({ data: new WebOrdersService(dbFor(req)).countsByQueue() });
    } catch (e) {
      mapErr(e, res);
    }
  });

  router.get('/', (req, res) => {
    try {
      const queue = req.query.queue != null ? String(req.query.queue) : '';
      const page = req.query.page != null ? String(req.query.page) : '1';
      const q = req.query.q != null ? String(req.query.q) : '';
      const filters = { page, limit: 50 };
      if (queue && normalizeQueueId(queue)) filters.queue = queue;
      if (q.trim().length >= 2) filters.search = q.trim();
      const result = new WebOrdersService(dbFor(req)).list(filters);
      res.json({ data: result.data, meta: result.meta });
    } catch (e) {
      mapErr(e, res);
    }
  });

  router.get('/:id', (req, res) => {
    try {
      const order = new WebOrdersService(dbFor(req)).get(req.params.id);
      if (!order) return res.status(404).json({ error: 'not_found', message: 'Order not found' });
      res.json({ data: enrich(order) });
    } catch (e) {
      mapErr(e, res);
    }
  });

  router.patch('/:id/status', validate({ body: adminOrderStatusPatchBodySchema }), (req, res) => {
    try {
      const status = String(req.body.status).trim();
      const updated = new WebOrdersService(dbFor(req)).updateStatus(req.params.id, status);
      res.json({ data: enrich(updated) });
    } catch (e) {
      mapErr(e, res);
    }
  });

  router.post('/:id/dispatch-courier', (req, res) => {
    try {
      Promise.resolve(new WebOrdersService(dbFor(req)).dispatchToCourier(req.params.id))
        .then((u) => res.json({ data: enrich(u) }))
        .catch((e) => mapErr(e, res));
    } catch (e) {
      mapErr(e, res);
    }
  });

  return router;
}

module.exports = { mountAdminOrdersRoutes };

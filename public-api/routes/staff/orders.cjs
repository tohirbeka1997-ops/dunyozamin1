'use strict';

const express = require('express');
const WebOrdersService = require('../../../electron/services/webOrdersService.cjs');
const { allowedNextStatuses } = require('../../lib/webOrderStatusFlow.cjs');
const { normalizeQueueId } = require('../../lib/webOrderQueues.cjs');
const { openTenantDatabase } = require('../../lib/staffDb.cjs');
const { mapStaffServiceError } = require('../../lib/staffErrorMap.cjs');

function mapServiceError(e, res) {
  mapStaffServiceError(e, res, { logTag: '[staff/orders]' });
}

function enrichOrder(order) {
  if (!order) return order;
  const deliveryMethod = order.delivery_method;
  return {
    ...order,
    allowed_next_statuses: allowedNextStatuses(order.status, { deliveryMethod }),
  };
}

function mountStaffOrdersRoutes() {
  const router = express.Router();

  function dbForReq(req) {
    return openTenantDatabase(req.staffUser.tenant);
  }

  router.get('/queues', (req, res) => {
    try {
      const svc = new WebOrdersService(dbForReq(req));
      res.json({ data: svc.countsByQueue() });
    } catch (e) {
      mapServiceError(e, res);
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

      const svc = new WebOrdersService(dbForReq(req));
      const result = svc.list(filters);
      res.json({
        data: result.data,
        meta: result.meta,
      });
    } catch (e) {
      mapServiceError(e, res);
    }
  });

  router.get('/:id', (req, res) => {
    try {
      const svc = new WebOrdersService(dbForReq(req));
      const order = svc.get(req.params.id);
      if (!order) {
        res.status(404).json({ error: 'not_found', message: 'Order not found' });
        return;
      }
      res.json({ data: enrichOrder(order) });
    } catch (e) {
      mapServiceError(e, res);
    }
  });

  router.patch('/:id/status', express.json({ limit: '16kb' }), (req, res) => {
    try {
      const status = req.body?.status != null ? String(req.body.status).trim() : '';
      if (!status) {
        res.status(400).json({ error: 'validation_error', message: 'status required' });
        return;
      }

      const svc = new WebOrdersService(dbForReq(req));
      const updated = svc.updateStatus(req.params.id, status);
      res.json({ data: enrichOrder(updated) });
    } catch (e) {
      mapServiceError(e, res);
    }
  });

  router.post('/:id/dispatch-courier', express.json({ limit: '8kb' }), (req, res) => {
    try {
      const svc = new WebOrdersService(dbForReq(req));
      Promise.resolve(svc.dispatchToCourier(req.params.id))
        .then((updated) => {
          res.json({ data: enrichOrder(updated) });
        })
        .catch((e) => mapServiceError(e, res));
    } catch (e) {
      mapServiceError(e, res);
    }
  });

  return router;
}

module.exports = { mountStaffOrdersRoutes };

'use strict';

const express = require('express');
const DashboardService = require('../../../electron/services/dashboardService.cjs');
const WebOrdersService = require('../../../electron/services/webOrdersService.cjs');

function mountAdminDashboardRoutes(dbGetter) {
  const router = express.Router();

  router.get('/stats', (_req, res) => {
    try {
      const db = dbGetter();
      const dashboard = new DashboardService(db);
      const webOrders = new WebOrdersService(db);
      let stats = {};
      let analytics = {};
      let queues = {};
      try {
        stats = dashboard.getStats({}) || {};
      } catch (e) {
        console.error('[admin/dashboard] getStats', e.message);
      }
      try {
        analytics = dashboard.getAnalytics({ period: 'week' }) || {};
      } catch (e) {
        console.error('[admin/dashboard] getAnalytics', e.message);
      }
      try {
        queues = webOrders.countsByQueue() || {};
      } catch (e) {
        console.error('[admin/dashboard] countsByQueue', e.message);
      }
      res.json({ data: { stats, analytics, web_order_queues: queues } });
    } catch (e) {
      console.error('[admin/dashboard] GET /stats', e);
      res.status(500).json({ error: 'internal_error', message: e?.message || 'Internal error' });
    }
  });

  return router;
}

module.exports = { mountAdminDashboardRoutes };

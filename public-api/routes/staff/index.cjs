'use strict';

const express = require('express');
const { mountStaffAuthRoutes } = require('./auth.cjs');
const { mountStaffOrdersRoutes } = require('./orders.cjs');
const { mountStaffProductsRoutes } = require('./products.cjs');
const { mountStaffShiftsRoutes } = require('./shifts.cjs');
const { mountStaffSalesRoutes } = require('./sales.cjs');
const { mountStaffCustomersRoutes } = require('./customers.cjs');
const { mountStaffSuppliersRoutes } = require('./suppliers.cjs');
const { mountStaffPurchaseOrdersRoutes } = require('./purchaseOrders.cjs');
const { mountStaffReportsRoutes } = require('./reports.cjs');
const { mountStaffReturnsRoutes } = require('./returns.cjs');
const { mountStaffDevicesRoutes } = require('./devices.cjs');
const { mountStaffExpensesRoutes } = require('./expenses.cjs');
const { createStaffAuth } = require('../../middleware/staffAuth.cjs');
const { openTenantDatabase } = require('../../lib/staffDb.cjs');
const { requireStaffArea } = require('../../lib/staffRoles.cjs');

function mountStaffRoutes() {
  const router = express.Router();
  const staffAuth = createStaffAuth();
  const jsonBody = express.json({ limit: '512kb' });

  router.use('/auth', mountStaffAuthRoutes());

  router.get('/me', staffAuth, (req, res) => {
    try {
      const db = openTenantDatabase(req.staffUser.tenant);
      const user = db
        .prepare('SELECT id, username, full_name, email, is_active FROM users WHERE id = ?')
        .get(req.staffUser.id);
      if (!user || !user.is_active) {
        res.status(401).json({ error: 'user_inactive' });
        return;
      }
      res.json({
        data: {
          id: user.id,
          username: user.username,
          full_name: user.full_name,
          email: user.email,
          role: req.staffUser.role,
          tenant: req.staffUser.tenant,
        },
      });
    } catch (e) {
      console.error('[staff] GET /me', e);
      res.status(500).json({ error: 'internal_error', message: 'Profil maʼlumotini olishda xato' });
    }
  });

  // Cashier: no web-order ops (same as Electron POS floor operator matrix).
  router.use('/orders', jsonBody, staffAuth, requireStaffArea('orders'), mountStaffOrdersRoutes());

  // Real point-of-sale selling (v2 "Tez savdo / quick sale").
  router.use('/products', staffAuth, mountStaffProductsRoutes());
  router.use('/shifts', jsonBody, staffAuth, mountStaffShiftsRoutes());
  router.use('/sales', jsonBody, staffAuth, mountStaffSalesRoutes());
  router.use('/returns', jsonBody, staffAuth, mountStaffReturnsRoutes());
  router.use('/customers', jsonBody, staffAuth, mountStaffCustomersRoutes());
  router.use('/suppliers', jsonBody, staffAuth, requireStaffArea('suppliers'), mountStaffSuppliersRoutes());
  router.use('/devices', jsonBody, staffAuth, mountStaffDevicesRoutes());
  router.use(
    '/purchase-orders',
    jsonBody,
    staffAuth,
    requireStaffArea('purchaseOrders'),
    mountStaffPurchaseOrdersRoutes(),
  );
  router.use('/reports', staffAuth, mountStaffReportsRoutes());
  router.use('/expenses', jsonBody, staffAuth, requireStaffArea('expenses'), mountStaffExpensesRoutes());

  // GET /v1/staff/exchange-rates/latest?base_currency=USD&quote_currency=UZS
  // Used by purchase-order create (USD suppliers) — same gate as purchasing.
  router.get('/exchange-rates/latest', staffAuth, requireStaffArea('purchaseOrders'), (req, res) => {
    try {
      const { getPosBundle } = require('../../lib/staffPos.cjs');
      const { exchangeRates } = getPosBundle(openTenantDatabase(req.staffUser.tenant));
      const row = exchangeRates.getLatest({
        base_currency: req.query.base_currency != null ? String(req.query.base_currency) : 'USD',
        quote_currency: req.query.quote_currency != null ? String(req.query.quote_currency) : 'UZS',
        on_date: req.query.on_date != null ? String(req.query.on_date) : undefined,
      });
      res.json({ data: row });
    } catch (e) {
      console.error('[staff] GET /exchange-rates/latest', e);
      res.status(400).json({ error: 'validation_error', message: e?.message || 'Invalid request' });
    }
  });

  return router;
}

module.exports = { mountStaffRoutes };

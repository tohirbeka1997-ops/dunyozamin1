'use strict';

const express = require('express');
const { mountAdminAuthRoutes } = require('./auth.cjs');
const { mountAdminOrdersRoutes } = require('./orders.cjs');
const { mountAdminProductsRoutes } = require('./products.cjs');
const { mountAdminPromotionsRoutes } = require('./promotions.cjs');
const { mountAdminCustomersRoutes } = require('./customers.cjs');
const { mountAdminDashboardRoutes } = require('./dashboard.cjs');
const { createAdminAuth } = require('../../middleware/adminAuth.cjs');

// Mini-app admin paneli uchun barcha route'lar: /v1/admin/*
// dbGetter — public-api'ning YAGONA bazasi (getDb). Staff/tenant emas,
// qolgan route'lar bilan bir xil baza ishlatiladi.
function mountAdminRoutes(dbGetter) {
  const router = express.Router();
  const adminAuth = createAdminAuth();
  const jsonBody = express.json({ limit: '1mb' });

  // Auth ochiq (login/refresh), qolgani himoyalangan
  router.use('/auth', mountAdminAuthRoutes(dbGetter));

  // Joriy admin foydalanuvchi (sessiyani tekshirish uchun)
  router.get('/me', adminAuth, (req, res) => {
    try {
      const db = dbGetter();
      const user = db
        .prepare('SELECT id, username, full_name, email, is_active FROM users WHERE id = ?')
        .get(req.adminUser.id);
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
          role: req.adminUser.role,
          tenant: req.adminUser.tenant,
        },
      });
    } catch (e) {
      console.error('[admin] GET /me', e);
      res.status(500).json({ error: 'internal_error', message: e?.message || 'Internal error' });
    }
  });

  router.use('/dashboard', adminAuth, mountAdminDashboardRoutes(dbGetter));
  router.use('/orders', jsonBody, adminAuth, mountAdminOrdersRoutes(dbGetter));
  router.use('/products', jsonBody, adminAuth, mountAdminProductsRoutes(dbGetter));
  router.use('/promotions', jsonBody, adminAuth, mountAdminPromotionsRoutes(dbGetter));
  router.use('/customers', adminAuth, mountAdminCustomersRoutes(dbGetter));

  return router;
}

module.exports = { mountAdminRoutes };

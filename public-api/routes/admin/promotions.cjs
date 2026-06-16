'use strict';

const express = require('express');
const PromotionService = require('../../../electron/services/promotionService.cjs');
const MarketplaceContentService = require('../../../electron/services/marketplaceContentService.cjs');

function fail(e, res, tag) {
  const message = e?.message || 'Request failed';
  if (e?.code === 'VALIDATION_ERROR') return res.status(400).json({ error: 'validation_error', message });
  if (e?.code === 'NOT_FOUND') return res.status(404).json({ error: 'not_found', message });
  console.error(tag, e);
  return res.status(500).json({ error: 'internal_error', message: 'Internal error' });
}

function mountAdminPromotionsRoutes(dbGetter) {
  const router = express.Router();
  const promo = () => new PromotionService(dbGetter());
  const content = () => new MarketplaceContentService(dbGetter());

  // ---- Aksiyalar (promotions) ----
  router.get('/', (req, res) => {
    try {
      const params = {};
      if (req.query.status) params.status = String(req.query.status);
      if (req.query.type) params.type = String(req.query.type);
      res.json({ data: promo(req).listPromotionsWithStats(params) });
    } catch (e) {
      fail(e, res, '[admin/promotions] GET /');
    }
  });

  router.get('/:id', (req, res) => {
    try {
      const p = promo(req).getPromotionById(req.params.id);
      if (!p) return res.status(404).json({ error: 'not_found' });
      res.json({
        data: {
          ...p,
          scope: promo(req).getPromotionScope(req.params.id),
          condition: promo(req).getPromotionCondition(req.params.id),
          reward: promo(req).getPromotionReward(req.params.id),
        },
      });
    } catch (e) {
      fail(e, res, '[admin/promotions] GET /:id');
    }
  });

  router.post('/', (req, res) => {
    try {
      const created = promo(req).createPromotion({ ...(req.body || {}), createdBy: req.adminUser.id });
      res.status(201).json({ data: created });
    } catch (e) {
      fail(e, res, '[admin/promotions] POST /');
    }
  });

  router.patch('/:id', (req, res) => {
    try {
      const updated = promo(req).updatePromotion({ ...(req.body || {}), id: req.params.id });
      res.json({ data: updated });
    } catch (e) {
      fail(e, res, '[admin/promotions] PATCH /:id');
    }
  });

  router.patch('/:id/status', (req, res) => {
    try {
      const status = String(req.body?.status || '').trim();
      if (!status) return res.status(400).json({ error: 'validation_error', message: 'status required' });
      res.json({ data: promo(req).setStatus(req.params.id, status, req.adminUser.id) });
    } catch (e) {
      fail(e, res, '[admin/promotions] PATCH /:id/status');
    }
  });

  router.delete('/:id', (req, res) => {
    try {
      promo(req).deletePromotion(req.params.id);
      res.json({ ok: true });
    } catch (e) {
      fail(e, res, '[admin/promotions] DELETE /:id');
    }
  });

  // ---- Promo-bannerlar (carousel) ----
  router.get('/content/banners', (req, res) => {
    try {
      res.json({ data: content(req).listBanners({ includeInactive: true }) });
    } catch (e) {
      fail(e, res, '[admin/promotions] GET banners');
    }
  });

  router.post('/content/banners', (req, res) => {
    try {
      res.status(201).json({ data: content(req).saveBanner(req.body || {}) });
    } catch (e) {
      fail(e, res, '[admin/promotions] POST banner');
    }
  });

  router.delete('/content/banners/:id', (req, res) => {
    try {
      content(req).deleteBanner(req.params.id);
      res.json({ ok: true });
    } catch (e) {
      fail(e, res, '[admin/promotions] DELETE banner');
    }
  });

  // ---- Daily deal ----
  router.get('/content/daily-deal', (req, res) => {
    try {
      const dateISO = req.query.date ? String(req.query.date) : new Date().toISOString().slice(0, 10);
      res.json({ data: content(req).getDailyDeal(dateISO) });
    } catch (e) {
      fail(e, res, '[admin/promotions] GET daily-deal');
    }
  });

  router.post('/content/daily-deal', (req, res) => {
    try {
      res.json({ data: content(req).setDailyDeal(req.body || {}) });
    } catch (e) {
      fail(e, res, '[admin/promotions] POST daily-deal');
    }
  });

  return router;
}

module.exports = { mountAdminPromotionsRoutes };

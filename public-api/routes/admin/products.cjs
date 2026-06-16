'use strict';

const express = require('express');
const ProductsService = require('../../../electron/services/productsService.cjs');
const CategoriesService = require('../../../electron/services/categoriesService.cjs');

function mapErr(e, res, tag) {
  const code = e?.code || e?.name;
  const message = e?.message || 'Request failed';
  if (code === 'NOT_FOUND') return res.status(404).json({ error: 'not_found', message });
  if (code === 'VALIDATION_ERROR') return res.status(400).json({ error: 'validation_error', message });
  console.error(tag, e);
  return res.status(500).json({ error: 'internal_error', message: 'Internal error' });
}

function mountAdminProductsRoutes(dbGetter) {
  const router = express.Router();
  const products = () => new ProductsService(dbGetter());
  const categories = () => new CategoriesService(dbGetter());

  // GET /products?q=&category=&marketplace=visible|hidden&page=
  router.get('/', (req, res) => {
    try {
      const filters = { page: Number(req.query.page) || 1, limit: Number(req.query.limit) || 50 };
      if (req.query.q && String(req.query.q).trim()) filters.search = String(req.query.q).trim();
      if (req.query.category) filters.categoryId = String(req.query.category);
      if (req.query.marketplace === 'visible') filters.showInMarketplace = true;
      else if (req.query.marketplace === 'hidden') filters.showInMarketplace = false;
      const result = products(req).list(filters);
      res.json(result?.data ? result : { data: result });
    } catch (e) {
      mapErr(e, res, '[admin/products] GET /');
    }
  });

  router.get('/:id', (req, res) => {
    try {
      const p = products(req).getById(req.params.id);
      if (!p) return res.status(404).json({ error: 'not_found', message: 'Product not found' });
      res.json({ data: p });
    } catch (e) {
      mapErr(e, res, '[admin/products] GET /:id');
    }
  });

  // PATCH /products/:id  — narx, ko'rinish, nom va h.k.
  router.patch('/:id', (req, res) => {
    try {
      const payload = req.body || {};
      const updated = products(req).update(req.params.id, payload, { changedBy: req.adminUser.id });
      res.json({ data: updated });
    } catch (e) {
      mapErr(e, res, '[admin/products] PATCH /:id');
    }
  });

  // PATCH /products/:id/visibility  { visible: true|false }
  router.patch('/:id/visibility', (req, res) => {
    try {
      const visible = req.body?.visible === true || req.body?.visible === 'true' || req.body?.visible === 1;
      const updated = products(req).update(
        req.params.id,
        { show_in_marketplace: visible },
        { changedBy: req.adminUser.id },
      );
      res.json({ data: updated });
    } catch (e) {
      mapErr(e, res, '[admin/products] PATCH /:id/visibility');
    }
  });

  // Kategoriyalar
  router.get('/meta/categories', (req, res) => {
    try {
      res.json({ data: categories(req).list({}) });
    } catch (e) {
      mapErr(e, res, '[admin/products] GET categories');
    }
  });

  return router;
}

module.exports = { mountAdminProductsRoutes };

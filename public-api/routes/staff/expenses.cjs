'use strict';

const express = require('express');
const { formatYmdInTimeZone } = require('../../../electron/lib/timezone.cjs');
const { openTenantDatabase } = require('../../lib/staffDb.cjs');
const { getPosBundle } = require('../../lib/staffPos.cjs');
const { mapStaffServiceError } = require('../../lib/staffErrorMap.cjs');

function mapServiceError(e, res) {
  mapStaffServiceError(e, res, { logTag: '[staff/expenses]' });
}

function isYmd(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '').trim());
}

function mountStaffExpensesRoutes() {
  const router = express.Router();

  function bundleForReq(req) {
    return getPosBundle(openTenantDatabase(req.staffUser.tenant));
  }

  // GET /v1/staff/expenses/categories
  router.get('/categories', (req, res) => {
    try {
      const { expenses } = bundleForReq(req);
      const rows = expenses.listCategories({ is_active: true });
      res.json({ data: rows });
    } catch (e) {
      mapServiceError(e, res);
    }
  });

  // GET /v1/staff/expenses?date=YYYY-MM-DD
  router.get('/', (req, res) => {
    try {
      const rawDate = req.query.date != null ? String(req.query.date).trim() : '';
      const date = isYmd(rawDate) ? rawDate : formatYmdInTimeZone(new Date());
      const { expenses } = bundleForReq(req);
      const rows = expenses.list({ date_from: date, date_to: date, limit: 200 });
      res.json({ data: rows, meta: { date } });
    } catch (e) {
      mapServiceError(e, res);
    }
  });

  // POST /v1/staff/expenses
  router.post('/', (req, res) => {
    try {
      const body = req.body || {};
      const categoryId = String(body.category_id || '').trim();
      const amount = Number(body.amount);
      const description = String(body.description || body.notes || '').trim();
      if (!categoryId) {
        res.status(400).json({ error: 'validation_error', message: 'category_id is required' });
        return;
      }
      if (!Number.isFinite(amount) || amount <= 0) {
        res.status(400).json({ error: 'validation_error', message: 'amount must be > 0' });
        return;
      }
      if (!description) {
        res.status(400).json({ error: 'validation_error', message: 'description is required' });
        return;
      }
      const rawDate = body.expense_date != null ? String(body.expense_date).trim() : '';
      const expenseDate = isYmd(rawDate) ? rawDate : formatYmdInTimeZone(new Date());
      const rawMethod = String(body.payment_method || 'cash').trim().toLowerCase();
      const paymentMethod = ['cash', 'card', 'transfer'].includes(rawMethod) ? rawMethod : 'cash';

      const { expenses } = bundleForReq(req);
      const row = expenses.create({
        category_id: categoryId,
        amount,
        payment_method: paymentMethod,
        expense_date: expenseDate,
        description,
        notes: body.notes != null ? String(body.notes).slice(0, 500) : null,
        created_by: req.staffUser.id,
      });
      res.status(201).json({ data: row });
    } catch (e) {
      mapServiceError(e, res);
    }
  });

  return router;
}

module.exports = { mountStaffExpensesRoutes };

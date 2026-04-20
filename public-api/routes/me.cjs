'use strict';

const express = require('express');

function mountMeRoutes(dbGetter) {
  const router = express.Router();

  router.get('/', (req, res) => {
    try {
      const db = dbGetter();
      const row = db
        .prepare(
          `
        SELECT id, telegram_id, first_name, last_name, phone, address, created_at
        FROM marketplace_customers
        WHERE id = ?
      `
        )
        .get(req.customerId);

      if (!row) {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      res.json(row);
    } catch (e) {
      console.error('[me] GET /', e);
      res.status(500).json({ error: 'internal_error' });
    }
  });

  router.put('/', (req, res) => {
    try {
      const body = req.body || {};

      const db = dbGetter();
      const cur = db.prepare('SELECT id FROM marketplace_customers WHERE id = ?').get(req.customerId);
      if (!cur) {
        res.status(404).json({ error: 'not_found' });
        return;
      }

      const sets = [];
      const vals = [];
      if ('first_name' in body) {
        sets.push('first_name = ?');
        vals.push(body.first_name != null ? String(body.first_name).trim() : null);
      }
      if ('last_name' in body) {
        sets.push('last_name = ?');
        vals.push(body.last_name != null ? String(body.last_name).trim() : null);
      }
      if ('phone' in body) {
        sets.push('phone = ?');
        vals.push(body.phone != null ? String(body.phone).trim() : null);
      }
      if ('address' in body) {
        sets.push('address = ?');
        vals.push(body.address != null ? String(body.address).trim() : null);
      }

      if (sets.length > 0) {
        vals.push(req.customerId);
        db.prepare(`UPDATE marketplace_customers SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
      }

      const row = db
        .prepare(
          `
        SELECT id, telegram_id, first_name, last_name, phone, address, created_at
        FROM marketplace_customers
        WHERE id = ?
      `
        )
        .get(req.customerId);

      res.json(row);
    } catch (e) {
      console.error('[me] PUT /', e);
      res.status(500).json({ error: 'internal_error' });
    }
  });

  return router;
}

module.exports = { mountMeRoutes };

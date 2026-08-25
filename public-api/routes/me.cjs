'use strict';

const express = require('express');
const { ensureLoyaltySchema, getBalance, listLedger, resolvePosCustomerId } = require('../lib/marketplaceLoyalty.cjs');
const {
  formatPhoneUz,
  syncPosCustomerFromMarketplace,
} = require('../lib/marketplacePosCustomer.cjs');

const TIERS = [
  { key: 'bronze', name: 'Bronza', emoji: '🥉', min: 0, max: 499, color: '#cd7f32' },
  { key: 'silver', name: 'Kumush', emoji: '🥈', min: 500, max: 1999, color: '#9ca3af' },
  { key: 'gold', name: 'Oltin', emoji: '🥇', min: 2000, max: 4999, color: '#d4a017' },
  { key: 'platinum', name: 'Platina', emoji: '💎', min: 5000, max: Number.POSITIVE_INFINITY, color: '#0a3625' },
];

function tierFromPoints(points) {
  const safe = Math.max(0, Number(points) || 0);
  const cur = TIERS.find((t) => safe >= t.min && safe <= t.max) || TIERS[0];
  const idx = TIERS.indexOf(cur);
  const next = idx + 1 < TIERS.length ? TIERS[idx + 1] : null;
  const progressTotal = next ? next.min - cur.min : 1;
  const progressDone = next ? safe - cur.min : 1;
  return {
    current: { key: cur.key, name: cur.name, emoji: cur.emoji, color: cur.color, min: cur.min },
    next: next
      ? { key: next.key, name: next.name, emoji: next.emoji, color: next.color, min: next.min }
      : null,
    points_to_next: next ? Math.max(0, next.min - safe) : 0,
    progress_pct: next ? Math.max(0, Math.min(100, Math.round((progressDone / progressTotal) * 100))) : 100,
  };
}

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

  router.get('/loyalty', (req, res) => {
    try {
      const db = dbGetter();
      ensureLoyaltySchema(db);

      const customer = db
        .prepare('SELECT id FROM marketplace_customers WHERE id = ?')
        .get(req.customerId);
      if (!customer) {
        res.status(404).json({ error: 'not_found' });
        return;
      }

      const points = getBalance(db, customer.id);
      const ledger = listLedger(db, customer.id, 20);
      const tier = tierFromPoints(points);

      let binding = null;
      let cardCode = null;
      let qrPayload = null;
      try {
        binding = db
          .prepare(
            `
            SELECT loyalty_card_code, qr_payload, pos_customer_id
            FROM marketplace_customer_bindings
            WHERE marketplace_customer_id = ?
          `,
          )
          .get(customer.id) || null;
        if (binding?.pos_customer_id) {
          const posCols = db.prepare(`PRAGMA table_info(customers)`).all().map((c) => c.name);
          if (posCols.includes('loyalty_card_code')) {
            const posCard = db
              .prepare(
                `SELECT loyalty_card_code, loyalty_qr_payload FROM customers WHERE id = ?`,
              )
              .get(binding.pos_customer_id);
            cardCode = posCard?.loyalty_card_code || binding.loyalty_card_code || null;
            qrPayload =
              posCard?.loyalty_qr_payload ||
              binding.qr_payload ||
              (cardCode ? `LOYALTY:${cardCode}` : null);
          } else {
            cardCode = binding.loyalty_card_code || null;
            qrPayload = binding.qr_payload || null;
          }
        }
      } catch (e) {
        binding = null;
      }

      const earned = db
        .prepare(
          `SELECT COALESCE(SUM(points_delta), 0) AS s
           FROM marketplace_loyalty_ledger
           WHERE customer_id = ? AND points_delta > 0`,
        )
        .get(customer.id);
      const earnedThisMonth = db
        .prepare(
          `SELECT COALESCE(SUM(points_delta), 0) AS s
           FROM marketplace_loyalty_ledger
           WHERE customer_id = ? AND points_delta > 0
             AND created_at >= datetime('now','start of month')`,
        )
        .get(customer.id);

      // Order aggregates for the profile screen ("badges" & lifetime
      // value). Soft-failing — older DBs may not have the table.
      let orderStats = { total_orders: 0, total_spent: 0, first_order_date: null };
      try {
        const row = db
          .prepare(
            `SELECT
                COUNT(*) AS total_orders,
                COALESCE(SUM(total_amount), 0) AS total_spent,
                MIN(created_at) AS first_order_date
             FROM web_orders
             WHERE customer_id = ?
               AND status NOT IN ('cancelled')`,
          )
          .get(customer.id);
        if (row) {
          orderStats = {
            total_orders: Number(row.total_orders || 0),
            total_spent: Number(row.total_spent || 0),
            first_order_date: row.first_order_date || null,
          };
        }
      } catch {
        // table missing — leave defaults
      }

      res.json({
        ok: true,
        points_balance: points,
        card_code: cardCode,
        qr_payload: qrPayload,
        pos_customer_id: binding?.pos_customer_id || resolvePosCustomerId(db, customer.id) || null,
        tier,
        stats: {
          earned_total: Number(earned?.s || 0),
          earned_this_month: Number(earnedThisMonth?.s || 0),
          ...orderStats,
        },
        ledger,
      });
    } catch (e) {
      console.error('[me] GET /loyalty', e);
      res.status(500).json({ error: 'internal_error' });
    }
  });

  // Back-in-stock subscription. Records customer interest so a future
  // bot/cron job can fan out a "X is back!" message via Telegram.
  function ensureBackInStockSchema(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS marketplace_back_in_stock (
        customer_id INTEGER NOT NULL,
        product_id TEXT NOT NULL,
        notified_at TEXT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (customer_id, product_id)
      );
      CREATE INDEX IF NOT EXISTS idx_marketplace_back_in_stock_product
        ON marketplace_back_in_stock(product_id);
    `);
  }

  router.post('/back-in-stock/:productId', (req, res) => {
    try {
      const productId = String(req.params.productId || '').trim();
      if (!productId) {
        res.status(400).json({ error: 'invalid_product_id' });
        return;
      }
      const db = dbGetter();
      ensureBackInStockSchema(db);
      // Fail open: silently ignore if the product no longer exists.
      const product = db.prepare('SELECT id FROM products WHERE id = ?').get(productId);
      if (!product) {
        res.status(404).json({ error: 'product_not_found' });
        return;
      }
      db.prepare(
        `INSERT OR IGNORE INTO marketplace_back_in_stock (customer_id, product_id)
         VALUES (?, ?)`,
      ).run(req.customerId, productId);
      res.json({ ok: true, subscribed: true });
    } catch (e) {
      console.error('[me] POST /back-in-stock', e);
      res.status(500).json({ error: 'internal_error' });
    }
  });

  router.delete('/back-in-stock/:productId', (req, res) => {
    try {
      const productId = String(req.params.productId || '').trim();
      if (!productId) {
        res.status(400).json({ error: 'invalid_product_id' });
        return;
      }
      const db = dbGetter();
      ensureBackInStockSchema(db);
      db.prepare(
        `DELETE FROM marketplace_back_in_stock WHERE customer_id = ? AND product_id = ?`,
      ).run(req.customerId, productId);
      res.json({ ok: true, subscribed: false });
    } catch (e) {
      console.error('[me] DELETE /back-in-stock', e);
      res.status(500).json({ error: 'internal_error' });
    }
  });

  router.get('/back-in-stock/:productId', (req, res) => {
    try {
      const productId = String(req.params.productId || '').trim();
      if (!productId) {
        res.status(400).json({ error: 'invalid_product_id' });
        return;
      }
      const db = dbGetter();
      ensureBackInStockSchema(db);
      const row = db
        .prepare(
          `SELECT created_at FROM marketplace_back_in_stock
           WHERE customer_id = ? AND product_id = ?`,
        )
        .get(req.customerId, productId);
      res.json({ ok: true, subscribed: !!row, since: row?.created_at || null });
    } catch (e) {
      console.error('[me] GET /back-in-stock', e);
      res.status(500).json({ error: 'internal_error' });
    }
  });

  // Promo-code lookup. Soft-failing: if the table doesn't exist or the
  // code is unknown we return 404 so the client can show a friendly
  // "promokod topilmadi" message rather than a hard 500.
  router.post('/promo/preview', (req, res) => {
    try {
      const code = String((req.body && req.body.code) || '').trim().toUpperCase();
      const subtotal = Math.max(0, Number((req.body && req.body.subtotal) || 0));
      if (!code) {
        res.status(400).json({ error: 'invalid_code' });
        return;
      }

      const db = dbGetter();
      // Lazily create a minimal promo schema so code-redemption can roll
      // out independently of a heavy migration. Any richer admin UI can
      // extend the columns later; the API only reads what's listed here.
      db.exec(`
        CREATE TABLE IF NOT EXISTS marketplace_promo_codes (
          code TEXT PRIMARY KEY,
          discount_pct INTEGER NULL,
          discount_amount INTEGER NULL,
          min_subtotal INTEGER NOT NULL DEFAULT 0,
          active INTEGER NOT NULL DEFAULT 1,
          valid_until TEXT NULL,
          note TEXT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);

      const row = db
        .prepare(
          `SELECT code, discount_pct, discount_amount, min_subtotal, active, valid_until
           FROM marketplace_promo_codes
           WHERE code = ?`,
        )
        .get(code);

      if (!row || !row.active) {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      if (row.valid_until) {
        const exp = new Date(row.valid_until);
        if (Number.isFinite(exp.getTime()) && exp.getTime() < Date.now()) {
          res.status(410).json({ error: 'expired' });
          return;
        }
      }
      if (subtotal < Number(row.min_subtotal || 0)) {
        res.status(409).json({
          error: 'min_subtotal_not_met',
          min_subtotal: Number(row.min_subtotal || 0),
        });
        return;
      }

      let discount = 0;
      if (Number.isFinite(Number(row.discount_pct)) && row.discount_pct > 0) {
        discount = Math.floor((subtotal * Number(row.discount_pct)) / 100);
      } else if (Number.isFinite(Number(row.discount_amount)) && row.discount_amount > 0) {
        discount = Number(row.discount_amount);
      }
      discount = Math.max(0, Math.min(subtotal, discount));

      res.json({
        ok: true,
        code: row.code,
        discount,
        type: row.discount_pct ? 'percent' : 'amount',
        percent: row.discount_pct || null,
        amount: row.discount_amount || null,
        new_total: Math.max(0, subtotal - discount),
      });
    } catch (e) {
      console.error('[me] POST /promo/preview', e);
      res.status(500).json({ error: 'internal_error' });
    }
  });

  router.put('/', (req, res) => {
    try {
      const body = req.body || {};

      const db = dbGetter();
      const cur = db
        .prepare('SELECT id, phone FROM marketplace_customers WHERE id = ?')
        .get(req.customerId);
      if (!cur) {
        res.status(404).json({ error: 'not_found' });
        return;
      }

      const sets = [];
      const vals = [];
      let phoneChanged = false;
      if ('first_name' in body) {
        sets.push('first_name = ?');
        vals.push(body.first_name != null ? String(body.first_name).trim() : null);
      }
      if ('last_name' in body) {
        sets.push('last_name = ?');
        vals.push(body.last_name != null ? String(body.last_name).trim() : null);
      }
      if ('phone' in body) {
        const formatted =
          body.phone != null && String(body.phone).trim() !== ''
            ? formatPhoneUz(body.phone)
            : null;
        if (body.phone != null && String(body.phone).trim() !== '' && !formatted) {
          res.status(400).json({ error: 'invalid_phone' });
          return;
        }
        const prevNorm = cur.phone != null ? formatPhoneUz(cur.phone) : null;
        phoneChanged = formatted !== prevNorm;
        sets.push('phone = ?');
        vals.push(formatted);
      }
      if ('address' in body) {
        sets.push('address = ?');
        vals.push(body.address != null ? String(body.address).trim() : null);
      }

      if (sets.length > 0) {
        vals.push(req.customerId);
        db.prepare(`UPDATE marketplace_customers SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
      }

      if (phoneChanged) {
        try {
          syncPosCustomerFromMarketplace(db, req.customerId);
        } catch (syncErr) {
          console.warn('[me] PUT / syncPosCustomerFromMarketplace failed:', syncErr?.message || syncErr);
        }
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

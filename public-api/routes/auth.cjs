'use strict';

const express = require('express');
const { assertInitDataFresh, parseTelegramUser } = require('../lib/telegramAuth.cjs');
const {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  newJti,
} = require('../lib/jwtUtil.cjs');

function mountAuthRoutes(dbGetter) {
  const router = express.Router();

  function upsertCustomer(db, tgUser) {
    const telegramId = Number(tgUser.id);
    if (!Number.isFinite(telegramId)) {
      const err = new Error('INVALID_USER_ID');
      err.code = 'INVALID_USER_ID';
      throw err;
    }
    const first = tgUser.first_name ? String(tgUser.first_name) : null;
    const last = tgUser.last_name ? String(tgUser.last_name) : null;

    const stmt = db.prepare(`
      INSERT INTO marketplace_customers (telegram_id, first_name, last_name, created_at)
      VALUES (?, ?, ?, datetime('now'))
      ON CONFLICT(telegram_id) DO UPDATE SET
        first_name = COALESCE(excluded.first_name, marketplace_customers.first_name),
        last_name = COALESCE(excluded.last_name, marketplace_customers.last_name)
    `);
    stmt.run(telegramId, first, last);

    const row = db.prepare('SELECT id FROM marketplace_customers WHERE telegram_id = ?').get(telegramId);
    return row.id;
  }

  router.post('/telegram', express.json({ limit: '32kb' }), (req, res) => {
    try {
      const initData = req.body && req.body.initData != null ? String(req.body.initData) : '';
      if (!initData.trim()) {
        res.status(400).json({ error: 'initData_required' });
        return;
      }

      const botToken = process.env.TELEGRAM_BOT_TOKEN;
      assertInitDataFresh(initData, botToken);

      const tgUser = parseTelegramUser(initData);
      if (!tgUser || tgUser.id == null) {
        res.status(400).json({ error: 'user_missing_in_init_data' });
        return;
      }

      const db = dbGetter();
      const customerId = upsertCustomer(db, tgUser);
      const jti = newJti();
      const refreshExpires = new Date();
      refreshExpires.setDate(refreshExpires.getDate() + 30);

      db.prepare(
        `
        INSERT INTO marketplace_refresh_tokens (customer_id, jti, expires_at)
        VALUES (?, ?, ?)
      `
      ).run(customerId, jti, refreshExpires.toISOString());

      const accessToken = signAccessToken(customerId);
      const refreshToken = signRefreshToken(customerId, jti);

      res.json({
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_in: 86400,
        token_type: 'Bearer',
      });
    } catch (e) {
      const code = e.code || e.message;
      if (code === 'INVALID_INIT_DATA' || code === 'INIT_DATA_EXPIRED' || code === 'MISSING_AUTH_DATE') {
        res.status(401).json({ error: 'unauthorized', code: String(code) });
        return;
      }
      if (code === 'BOT_TOKEN_MISSING' || code === 'JWT_CONFIG') {
        res.status(500).json({ error: 'server_misconfigured' });
        return;
      }
      console.error('[auth] POST /telegram', e);
      res.status(500).json({ error: 'internal_error' });
    }
  });

  router.post('/refresh', express.json({ limit: '16kb' }), (req, res) => {
    try {
      const refreshToken =
        (req.body && req.body.refresh_token) ||
        (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')
          ? req.headers.authorization.slice(7)
          : null);
      if (!refreshToken) {
        res.status(400).json({ error: 'refresh_token_required' });
        return;
      }

      const payload = verifyRefreshToken(refreshToken);
      const customerId = Number(payload.sub);
      const jti = payload.jti;

      const db = dbGetter();
      const row = db
        .prepare(
          `
        SELECT id, expires_at FROM marketplace_refresh_tokens WHERE jti = ? AND customer_id = ?
      `
        )
        .get(jti, customerId);

      if (!row) {
        res.status(401).json({ error: 'refresh_revoked_or_invalid' });
        return;
      }
      const exp = new Date(row.expires_at).getTime();
      if (exp < Date.now()) {
        db.prepare('DELETE FROM marketplace_refresh_tokens WHERE jti = ?').run(jti);
        res.status(401).json({ error: 'refresh_expired' });
        return;
      }

      const newJ = newJti();
      const refreshExpires = new Date();
      refreshExpires.setDate(refreshExpires.getDate() + 30);

      db.transaction(() => {
        db.prepare('DELETE FROM marketplace_refresh_tokens WHERE jti = ?').run(jti);
        db.prepare(
          `
          INSERT INTO marketplace_refresh_tokens (customer_id, jti, expires_at)
          VALUES (?, ?, ?)
        `
        ).run(customerId, newJ, refreshExpires.toISOString());
      })();

      const accessToken = signAccessToken(customerId);
      const nextRefresh = signRefreshToken(customerId, newJ);

      res.json({
        access_token: accessToken,
        refresh_token: nextRefresh,
        expires_in: 86400,
        token_type: 'Bearer',
      });
    } catch (e) {
      if (e.name === 'JsonWebTokenError' || e.name === 'TokenExpiredError') {
        res.status(401).json({ error: 'invalid_token' });
        return;
      }
      console.error('[auth] POST /refresh', e);
      res.status(500).json({ error: 'internal_error' });
    }
  });

  router.post('/logout', express.json({ limit: '16kb' }), (req, res) => {
    try {
      const header = req.headers.authorization || '';
      const token = header.startsWith('Bearer ') ? header.slice(7) : null;
      if (!token) {
        res.status(401).json({ error: 'bearer_required' });
        return;
      }

      let customerId;
      try {
        const payload = verifyAccessToken(token);
        customerId = Number(payload.sub);
      } catch {
        res.status(401).json({ error: 'invalid_access_token' });
        return;
      }

      const db = dbGetter();
      const bodyRefresh = req.body && req.body.refresh_token ? String(req.body.refresh_token) : null;

      if (bodyRefresh) {
        try {
          const rp = verifyRefreshToken(bodyRefresh);
          if (Number(rp.sub) === customerId && rp.jti) {
            db.prepare('DELETE FROM marketplace_refresh_tokens WHERE jti = ?').run(rp.jti);
          }
        } catch {
          /* ignore bad refresh */
        }
      } else {
        db.prepare('DELETE FROM marketplace_refresh_tokens WHERE customer_id = ?').run(customerId);
      }

      res.json({ ok: true });
    } catch (e) {
      console.error('[auth] POST /logout', e);
      res.status(500).json({ error: 'internal_error' });
    }
  });

  return router;
}

module.exports = { mountAuthRoutes };

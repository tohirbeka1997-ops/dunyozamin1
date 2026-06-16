'use strict';

const express = require('express');
const AuthService = require('../../../electron/services/authService.cjs');
const {
  signStaffAccessToken,
  signStaffRefreshToken,
  verifyStaffAccessToken,
  verifyStaffRefreshToken,
  staffAccessExpiresInSeconds,
  newJti,
} = require('../../lib/staffJwt.cjs');
const { ensureStaffSchema } = require('../../lib/staffDb.cjs');
const { isAdminRoleAllowed } = require('../../lib/adminRoles.cjs');

// Admin panel auth. Public-api'ning YAGONA bazasini (dbGetter) ishlatadi —
// mini-app/POS bilan bir xil baza. Tokenlar staff_refresh_tokens jadvalida
// saqlanadi. Tenant endi shunchaki yorliq ('default').
const ADMIN_TENANT = 'default';

function mountAdminAuthRoutes(dbGetter) {
  const router = express.Router();

  // Bazani olish + staff_refresh_tokens jadvali borligini ta'minlash.
  function getDb() {
    const db = dbGetter();
    try {
      ensureStaffSchema(db);
    } catch (e) {
      console.error('[admin/auth] ensureStaffSchema', e.message);
    }
    return db;
  }

  router.post('/login', express.json({ limit: '32kb' }), (req, res) => {
    try {
      const username = req.body?.username != null ? String(req.body.username).trim() : '';
      const password = req.body?.password != null ? String(req.body.password) : '';

      if (!username || !password) {
        res.status(400).json({ error: 'validation_error', message: 'username and password required' });
        return;
      }

      const db = getDb();
      const auth = new AuthService(db);
      const result = auth.login(username, password);
      if (!result.success) {
        res.status(401).json({ error: 'invalid_credentials', message: result.error || 'Invalid credentials' });
        return;
      }

      const role = String(result.user?.role || '').toLowerCase();
      if (!isAdminRoleAllowed(role)) {
        res.status(403).json({
          error: 'forbidden',
          message: 'Bu akkaunt admin paneliga kira olmaydi (faqat admin yoki manager)',
        });
        return;
      }

      const jti = newJti();
      const refreshExpires = new Date();
      refreshExpires.setDate(refreshExpires.getDate() + 30);

      db.prepare(
        `INSERT INTO staff_refresh_tokens (user_id, jti, device_id, platform, expires_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(result.user.id, jti, 'admin-panel', 'web', refreshExpires.toISOString());

      res.json({
        access_token: signStaffAccessToken(result.user.id, role, ADMIN_TENANT),
        refresh_token: signStaffRefreshToken(result.user.id, jti, ADMIN_TENANT),
        expires_in: staffAccessExpiresInSeconds(),
        token_type: 'Bearer',
        user: {
          id: result.user.id,
          username: result.user.username,
          full_name: result.user.full_name,
          role,
          tenant: ADMIN_TENANT,
        },
      });
    } catch (e) {
      if (e.code === 'JWT_CONFIG') {
        res.status(500).json({ error: 'server_misconfigured', message: e.message });
        return;
      }
      console.error('[admin/auth] POST /login', e);
      res.status(500).json({ error: 'internal_error', message: e?.message || 'Internal error' });
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

      const payload = verifyStaffRefreshToken(refreshToken);
      const userId = String(payload.sub);
      const jti = payload.jti;
      const db = getDb();

      const row = db
        .prepare(`SELECT id, expires_at FROM staff_refresh_tokens WHERE jti = ? AND user_id = ?`)
        .get(jti, userId);
      if (!row) {
        res.status(401).json({ error: 'refresh_revoked_or_invalid' });
        return;
      }
      if (new Date(row.expires_at).getTime() < Date.now()) {
        db.prepare('DELETE FROM staff_refresh_tokens WHERE jti = ?').run(jti);
        res.status(401).json({ error: 'refresh_expired' });
        return;
      }

      const user = db.prepare('SELECT id, is_active FROM users WHERE id = ?').get(userId);
      if (!user || !user.is_active) {
        res.status(401).json({ error: 'user_inactive' });
        return;
      }

      let role = '';
      try {
        const roleResult = db
          .prepare(
            `SELECT r.code FROM user_roles ur
             INNER JOIN roles r ON ur.role_id = r.id
             WHERE ur.user_id = ? AND r.is_active = 1
             ORDER BY ur.assigned_at DESC LIMIT 1`,
          )
          .get(userId);
        if (roleResult?.code) role = roleResult.code;
      } catch {
        /* ignore */
      }

      if (!isAdminRoleAllowed(role)) {
        db.prepare('DELETE FROM staff_refresh_tokens WHERE jti = ?').run(jti);
        res.status(403).json({ error: 'forbidden', message: 'Role no longer allowed for admin panel' });
        return;
      }

      const newJ = newJti();
      const refreshExpires = new Date();
      refreshExpires.setDate(refreshExpires.getDate() + 30);

      db.transaction(() => {
        db.prepare('DELETE FROM staff_refresh_tokens WHERE jti = ?').run(jti);
        db.prepare(
          `INSERT INTO staff_refresh_tokens (user_id, jti, device_id, platform, expires_at)
           VALUES (?, ?, 'admin-panel', 'web', ?)`,
        ).run(userId, newJ, refreshExpires.toISOString());
      })();

      res.json({
        access_token: signStaffAccessToken(userId, role, ADMIN_TENANT),
        refresh_token: signStaffRefreshToken(userId, newJ, ADMIN_TENANT),
        expires_in: staffAccessExpiresInSeconds(),
        token_type: 'Bearer',
      });
    } catch (e) {
      if (e.name === 'JsonWebTokenError' || e.name === 'TokenExpiredError') {
        res.status(401).json({ error: 'invalid_token' });
        return;
      }
      if (e.code === 'JWT_CONFIG') {
        res.status(500).json({ error: 'server_misconfigured', message: e.message });
        return;
      }
      console.error('[admin/auth] POST /refresh', e);
      res.status(500).json({ error: 'internal_error', message: e?.message || 'Internal error' });
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
      let userId;
      try {
        userId = String(verifyStaffAccessToken(token).sub);
      } catch {
        res.status(401).json({ error: 'invalid_access_token' });
        return;
      }
      const db = getDb();
      const bodyRefresh = req.body?.refresh_token ? String(req.body.refresh_token) : null;
      if (bodyRefresh) {
        try {
          const rp = verifyStaffRefreshToken(bodyRefresh);
          if (String(rp.sub) === userId && rp.jti) {
            db.prepare('DELETE FROM staff_refresh_tokens WHERE jti = ?').run(rp.jti);
          }
        } catch {
          /* ignore */
        }
      } else {
        db.prepare("DELETE FROM staff_refresh_tokens WHERE user_id = ? AND device_id = 'admin-panel'").run(userId);
      }
      res.json({ ok: true });
    } catch (e) {
      console.error('[admin/auth] POST /logout', e);
      res.status(500).json({ error: 'internal_error', message: e?.message || 'Internal error' });
    }
  });

  return router;
}

module.exports = { mountAdminAuthRoutes };

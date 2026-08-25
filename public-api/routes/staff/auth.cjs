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
const { openTenantDatabase, normalizeTenantSlug } = require('../../lib/staffDb.cjs');
const { isStaffRoleAllowed } = require('../../lib/staffRoles.cjs');
const { validate } = require('../../middleware/validate.cjs');
const {
  staffLoginBodySchema,
  staffRefreshBodySchema,
  staffLogoutBodySchema,
} = require('../../schemas/staff.schema.cjs');
const { logger } = require('../../lib/logger.cjs');

function mountStaffAuthRoutes() {
  const router = express.Router();

  router.post('/login', express.json({ limit: '32kb' }), validate({ body: staffLoginBodySchema }), (req, res) => {
    try {
      const tenant = normalizeTenantSlug(req.body?.tenant);
      const username = req.body?.username != null ? String(req.body.username).trim() : '';
      const password = req.body?.password != null ? String(req.body.password) : '';
      const deviceId = req.body?.device_id != null ? String(req.body.device_id).slice(0, 128) : null;
      const platform = req.body?.platform != null ? String(req.body.platform).slice(0, 32) : null;

      if (!username || !password) {
        res.status(400).json({ error: 'validation_error', message: 'username and password required' });
        return;
      }

      let db;
      try {
        db = openTenantDatabase(tenant);
      } catch (e) {
        if (e.code === 'TENANT_NOT_FOUND') {
          res.status(404).json({ error: 'tenant_not_found', message: `Tenant "${tenant}" not found` });
          return;
        }
        throw e;
      }

      const auth = new AuthService(db);
      const result = auth.login(username, password);
      if (!result.success) {
        const credMsg =
          result.error === 'Invalid credentials' || result.error === 'Username is required' || result.error === 'Password is required'
            ? "Noto'g'ri login yoki parol"
            : result.error || "Noto'g'ri login yoki parol";
        res.status(401).json({ error: 'invalid_credentials', message: credMsg });
        return;
      }

      const role = String(result.user?.role || '').toLowerCase();
      if (!isStaffRoleAllowed(role)) {
        res.status(403).json({
          error: 'forbidden',
          message: 'Account role cannot access staff app (admin, manager, sales, cashier)',
        });
        return;
      }

      const jti = newJti();
      const refreshExpires = new Date();
      refreshExpires.setDate(refreshExpires.getDate() + 30);

      db.prepare(
        `
        INSERT INTO staff_refresh_tokens (user_id, jti, device_id, platform, expires_at)
        VALUES (?, ?, ?, ?, ?)
      `,
      ).run(result.user.id, jti, deviceId, platform, refreshExpires.toISOString());

      const accessToken = signStaffAccessToken(result.user.id, role, tenant);
      const refreshToken = signStaffRefreshToken(result.user.id, jti, tenant);

      res.json({
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_in: staffAccessExpiresInSeconds(),
        token_type: 'Bearer',
        user: {
          id: result.user.id,
          username: result.user.username,
          full_name: result.user.full_name,
          role,
          tenant,
        },
      });
    } catch (e) {
      if (e.code === 'JWT_CONFIG') {
        res.status(500).json({ error: 'server_misconfigured' });
        return;
      }
      logger.error({ err: e }, '[staff/auth] POST /login');
      res.status(500).json({ error: 'internal_error' });
    }
  });

  router.post('/refresh', express.json({ limit: '16kb' }), validate({ body: staffRefreshBodySchema }), (req, res) => {
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
      const tenant = normalizeTenantSlug(payload.tenant);
      const jti = payload.jti;

      let db;
      try {
        db = openTenantDatabase(tenant);
      } catch (e) {
        if (e.code === 'TENANT_NOT_FOUND') {
          res.status(404).json({ error: 'tenant_not_found' });
          return;
        }
        throw e;
      }

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

      const user = db.prepare('SELECT id, username, full_name, is_active FROM users WHERE id = ?').get(userId);
      if (!user || !user.is_active) {
        res.status(401).json({ error: 'user_inactive' });
        return;
      }

      let role = 'cashier';
      try {
        const roleResult = db
          .prepare(
            `
          SELECT r.code FROM user_roles ur
          INNER JOIN roles r ON ur.role_id = r.id
          WHERE ur.user_id = ? AND r.is_active = 1
          ORDER BY ur.assigned_at DESC LIMIT 1
        `,
          )
          .get(userId);
        if (roleResult?.code) role = roleResult.code;
      } catch {
        /* ignore */
      }

      if (!isStaffRoleAllowed(role)) {
        db.prepare('DELETE FROM staff_refresh_tokens WHERE jti = ?').run(jti);
        res.status(403).json({ error: 'forbidden', message: 'Role no longer allowed for staff app' });
        return;
      }

      const newJ = newJti();
      const refreshExpires = new Date();
      refreshExpires.setDate(refreshExpires.getDate() + 30);

      db.transaction(() => {
        db.prepare('DELETE FROM staff_refresh_tokens WHERE jti = ?').run(jti);
        db.prepare(
          `
          INSERT INTO staff_refresh_tokens (user_id, jti, expires_at)
          VALUES (?, ?, ?)
        `,
        ).run(userId, newJ, refreshExpires.toISOString());
      })();

      res.json({
        access_token: signStaffAccessToken(userId, role, tenant),
        refresh_token: signStaffRefreshToken(userId, newJ, tenant),
        expires_in: staffAccessExpiresInSeconds(),
        token_type: 'Bearer',
      });
    } catch (e) {
      if (e.name === 'JsonWebTokenError' || e.name === 'TokenExpiredError') {
        res.status(401).json({ error: 'invalid_token' });
        return;
      }
      if (e.code === 'JWT_CONFIG') {
        res.status(500).json({ error: 'server_misconfigured' });
        return;
      }
      logger.error({ err: e }, '[staff/auth] POST /refresh');
      res.status(500).json({ error: 'internal_error' });
    }
  });

  router.post('/logout', express.json({ limit: '16kb' }), validate({ body: staffLogoutBodySchema }), (req, res) => {
    try {
      const header = req.headers.authorization || '';
      const token = header.startsWith('Bearer ') ? header.slice(7) : null;
      if (!token) {
        res.status(401).json({ error: 'bearer_required' });
        return;
      }

      let userId;
      let tenant;
      try {
        const payload = verifyStaffAccessToken(token);
        userId = String(payload.sub);
        tenant = normalizeTenantSlug(payload.tenant);
      } catch {
        res.status(401).json({ error: 'invalid_access_token' });
        return;
      }

      let db;
      try {
        db = openTenantDatabase(tenant);
      } catch {
        res.json({ ok: true });
        return;
      }

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
        db.prepare('DELETE FROM staff_refresh_tokens WHERE user_id = ?').run(userId);
      }

      res.json({ ok: true });
    } catch (e) {
      logger.error({ err: e }, '[staff/auth] POST /logout');
      res.status(500).json({ error: 'internal_error' });
    }
  });

  return router;
}

module.exports = { mountStaffAuthRoutes };

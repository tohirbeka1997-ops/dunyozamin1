'use strict';

const express = require('express');
const { randomUUID } = require('crypto');
const { openTenantDatabase } = require('../../lib/staffDb.cjs');
const { mapStaffServiceError } = require('../../lib/staffErrorMap.cjs');

function mapServiceError(e, res) {
  mapStaffServiceError(e, res, { logTag: '[staff/devices]' });
}

function mountStaffDevicesRoutes() {
  const router = express.Router();

  // POST /v1/staff/devices/register — store FCM token for push (foundation)
  router.post('/register', (req, res) => {
    try {
      const body = req.body || {};
      const fcmToken = body.fcm_token != null ? String(body.fcm_token).trim() : '';
      if (!fcmToken) {
        res.status(400).json({ error: 'validation_error', message: 'fcm_token is required' });
        return;
      }
      const platform = body.platform != null ? String(body.platform).trim().slice(0, 32) : null;
      const deviceId =
        body.device_id != null && String(body.device_id).trim()
          ? String(body.device_id).trim().slice(0, 128)
          : null;

      const db = openTenantDatabase(req.staffUser.tenant);
      const now = new Date().toISOString().replace('T', ' ').replace('Z', '').substring(0, 19);
      const userId = req.staffUser.id;

      const existing = deviceId
        ? db
            .prepare(
              `SELECT id FROM staff_devices WHERE user_id = ? AND device_id = ? LIMIT 1`,
            )
            .get(userId, deviceId)
        : db
            .prepare(`SELECT id FROM staff_devices WHERE user_id = ? AND fcm_token = ? LIMIT 1`)
            .get(userId, fcmToken);

      if (existing) {
        db.prepare(
          `UPDATE staff_devices
           SET fcm_token = ?, platform = ?, updated_at = ?
           WHERE id = ?`,
        ).run(fcmToken, platform, now, existing.id);
        res.json({ data: { id: existing.id, registered: true, updated: true } });
        return;
      }

      const id = randomUUID();
      db.prepare(
        `INSERT INTO staff_devices (id, user_id, device_id, fcm_token, platform, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, userId, deviceId, fcmToken, platform, now, now);

      res.status(201).json({ data: { id, registered: true, updated: false } });
    } catch (e) {
      mapServiceError(e, res);
    }
  });

  return router;
}

module.exports = { mountStaffDevicesRoutes };

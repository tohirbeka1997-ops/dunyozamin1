const { ipcMain } = require('electron');
const { wrapHandler } = require('../lib/errors.cjs');
const { readConfig, writeConfig, resetConfig, getConfigPath } = require('../config/appConfig.cjs');
const {
  resolveActorRole,
  assertAppConfigPatchAllowed,
  requireAdmin,
} = require('../lib/ipcAuth.cjs');
const { getDb } = require('../db/open.cjs');

/**
 * App-local configuration (stored in userData/pos-config.json)
 * Channels: pos:appConfig:*
 *
 * NOTE:
 * - This is intentionally NOT stored in SQLite DB.
 * - Needed for CLIENT mode (no local DB connection).
 */
function registerAppConfigHandlers(app) {
  ipcMain.removeHandler('pos:appConfig:get');
  ipcMain.handle(
    'pos:appConfig:get',
    wrapHandler(async () => {
      const cfg = readConfig(app);
      let localDbPath = null;
      if (cfg.mode !== 'client') {
        try {
          const { getDbPath } = require('../db/dbPath.cjs');
          localDbPath = getDbPath(app);
        } catch {
          // DB not opened yet (early startup) — path omitted
        }
      }
      return { ...cfg, configPath: getConfigPath(app), localDbPath };
    })
  );

  ipcMain.removeHandler('pos:appConfig:set');
  ipcMain.handle(
    'pos:appConfig:set',
    wrapHandler(async (_event, patch) => {
      // Anybody can call appConfig:set for non-sensitive keys (UI prefs,
      // printer configuration, etc.). Sensitive keys (host.secret, host.bind,
      // ...) require an authenticated admin — anything less would let a
      // manager-level account rotate the master adminBypass key.
      const existing = readConfig(app);
      let db;
      if (existing.mode !== 'client') {
        try { db = getDb(); } catch { db = null; }
      } else {
        db = null;
      }
      assertAppConfigPatchAllowed(patch || {}, resolveActorRole(db));

      const next = { ...(patch || {}) };
      const nextMode = String(next.mode ?? existing.mode ?? 'host').toLowerCase();
      if (nextMode === 'client') {
        const hostUrl = String(next.client?.hostUrl ?? existing.client?.hostUrl ?? '')
          .trim()
          .replace(/\/+$/, '');
        if (!hostUrl) {
          const { createError, ERROR_CODES } = require('../lib/errors.cjs');
          throw createError(
            ERROR_CODES.VALIDATION_ERROR,
            'CLIENT rejim uchun HOST URL majburiy (masalan http://192.168.1.10:3333). Yoki mahalliy HOST rejimini tanlang.'
          );
        }
      }

      return writeConfig(next, app);
    })
  );

  ipcMain.removeHandler('pos:appConfig:reset');
  ipcMain.handle(
    'pos:appConfig:reset',
    wrapHandler(async () => {
      const existing = readConfig(app);
      if (existing.mode !== 'client') {
        requireAdmin(getDb());
      }
      // CLIENT has no local DB. Reset is its recovery escape hatch and must
      // never create/open a local pos.db merely to authorize this operation.
      return resetConfig(app);
    })
  );

  ipcMain.removeHandler('pos:appConfig:testConnection');
  ipcMain.handle(
    'pos:appConfig:testConnection',
    wrapHandler(async (_event, input) => {
      const hostUrl = String(input?.hostUrl || '').trim().replace(/\/+$/, '');
      const secret = String(input?.secret || '').trim();
      if (!/^https?:\/\//i.test(hostUrl) || !secret) {
        const { createError, ERROR_CODES } = require('../lib/errors.cjs');
        throw createError(ERROR_CODES.VALIDATION_ERROR, 'HOST URL and secret are required');
      }
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15_000);
      try {
        const response = await fetch(`${hostUrl}/rpc`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${secret}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ channel: 'pos:health', args: [] }),
          signal: controller.signal,
        });
        const body = await response.json().catch(() => null);
        return {
          ok: response.ok && body?.ok === true && body?.data?.success === true,
          status: response.status,
          message: body?.error?.message || null,
        };
      } finally {
        clearTimeout(timeout);
      }
    })
  );
}

module.exports = { registerAppConfigHandlers };







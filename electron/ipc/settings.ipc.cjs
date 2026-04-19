const { ipcMain } = require('electron');
const { app } = require('electron');
const { wrapHandler } = require('../lib/errors.cjs');
const fs = require('fs');
const path = require('path');
const { getDbPath, assertDbPathSafe, getUserDataPath, listDatabaseCandidates } = require('../db/dbPath.cjs');
const { scheduleDbReset } = require('../scripts/db-reset-pending.cjs');

// Defensive check: ensure wrapHandler is imported correctly
if (typeof wrapHandler !== 'function') {
  throw new Error(
    `wrapHandler import is invalid: check electron/lib/errors.cjs export.\n` +
    `  Expected: function\n` +
    `  Actual: ${typeof wrapHandler}\n` +
    `  Ensure errors.cjs exports: module.exports = { wrapHandler, ... };`
  );
}

/**
 * Settings IPC Handlers
 * Channels: pos:settings:*
 */
function registerSettingsHandlers(services) {
  const { settings } = services;

  // Remove existing handlers to prevent conflicts with fallback handlers
  ipcMain.removeHandler('pos:settings:get');
  ipcMain.handle('pos:settings:get', wrapHandler(async (_event, key) => {
    return settings.get(key);
  }));

  ipcMain.removeHandler('pos:settings:set');
  ipcMain.handle('pos:settings:set', wrapHandler(async (_event, key, value, type, updatedBy) => {
    return settings.set(key, value, type, updatedBy);
  }));

  ipcMain.removeHandler('pos:settings:getAll');
  ipcMain.handle('pos:settings:getAll', wrapHandler(async (_event, filters) => {
    return settings.getAll(filters || {});
  }));

  ipcMain.removeHandler('pos:settings:delete');
  ipcMain.handle('pos:settings:delete', wrapHandler(async (_event, key) => {
    return settings.delete(key);
  }));

  // Reset local SQLite database (HOST only)
  ipcMain.removeHandler('pos:settings:resetDatabase');
  ipcMain.handle(
    'pos:settings:resetDatabase',
    wrapHandler(async (_event, payload) => {
      const confirmText = String(payload?.confirmText || '').trim();
      if (confirmText !== 'DELETE') {
        throw new Error('You must type "DELETE" to confirm');
      }

      const dbPath = getDbPath(app);
      assertDbPathSafe(dbPath, app);

      // Schedule reset for next app start (Windows-safe).
      // Deleting pos.db while the app is running can fail with EBUSY/EPERM even after close().
      try {
        scheduleDbReset(app, { source: 'ipc', requestedAt: new Date().toISOString() });
      } catch (e) {
        const msg = e?.message || String(e);
        throw new Error(`Reset flag yozilmadi: ${msg}`);
      }

      // SECURITY: allow deleting ONLY files inside userData (but permit legacy DB filenames too)
      const userDataPath = getUserDataPath(app);
      const assertPathInsideUserData = (filePath) => {
        const resolvedFile = path.resolve(filePath);
        const resolvedUserData = path.resolve(userDataPath);
        const rel = path.relative(resolvedUserData, resolvedFile);
        if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
          throw new Error(`SECURITY: Refusing to delete file outside userData: ${filePath}`);
        }
      };

      // Close DB connection (best-effort)
      try {
        const { close } = require('../db/open.cjs');
        close();
      } catch {}

      // Relaunch app so DB is recreated cleanly
      setTimeout(() => {
        try {
          // add a hint arg so boot-time hook can run even if flag file couldn't be read for some reason
          app.relaunch({ args: [...process.argv.slice(1), '--reset-db'] });
        } finally {
          app.exit(0);
        }
      }, 300);

      // NOTE: actual deletion happens on next app start (before DB opens).
      return { success: true, scheduled: true };
    })
  );
}

module.exports = { registerSettingsHandlers };





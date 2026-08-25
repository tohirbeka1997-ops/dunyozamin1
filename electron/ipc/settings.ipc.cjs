const { ipcMain } = require('electron');
const { app } = require('electron');
const { wrapHandler } = require('../lib/errors.cjs');
const { requireAdmin } = require('../lib/ipcAuth.cjs');
const { getDb } = require('../db/open.cjs');
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

  // Telegram business reports — test send (admin)
  ipcMain.removeHandler('pos:settings:testTelegramReport');
  ipcMain.handle(
    'pos:settings:testTelegramReport',
    wrapHandler(async () => {
      requireAdmin(getDb());
      const db = getDb();
      const { sendTestReport } = require('../../public-api/lib/reportNotify.cjs');
      return sendTestReport(db, {});
    }),
  );

  // Telegram AI store analysis — on-demand send (admin)
  ipcMain.removeHandler('pos:settings:testTelegramAiAnalysis');
  ipcMain.handle(
    'pos:settings:testTelegramAiAnalysis',
    wrapHandler(async () => {
      requireAdmin(getDb());
      const db = getDb();
      // Re-read root `.env` so OPENAI_* edits apply without full OS relaunch
      try {
        require('../config/loadRootEnv.cjs').loadRootEnv();
      } catch {
        // ignore
      }
      const {
        sendAiAnalysisNow,
        resolveOpenAiConfig,
        resolveGeminiTextConfig,
      } = require('../../public-api/lib/storeAiAnalysis.cjs');
      const openai = resolveOpenAiConfig({});
      const gemini = resolveGeminiTextConfig({});
      return sendAiAnalysisNow(db, {
        apiKey: openai.apiKey,
        model: openai.model,
        geminiApiKey: gemini.apiKey,
        geminiTextModel: gemini.model,
      });
    }),
  );

  // Telegram daily marketing poster — on-demand send (admin)
  ipcMain.removeHandler('pos:settings:testTelegramDailyPoster');
  ipcMain.handle(
    'pos:settings:testTelegramDailyPoster',
    wrapHandler(async () => {
      requireAdmin(getDb());
      const db = getDb();
      try {
        require('../config/loadRootEnv.cjs').loadRootEnv();
      } catch {
        // ignore
      }
      const { sendDailyPosterNow } = require('../../public-api/lib/dailyStorePoster.cjs');
      return sendDailyPosterNow(db, {});
    }),
  );

  // OPENAI / GEMINI keys loaded? (yes/no only — never return the key)
  ipcMain.removeHandler('pos:settings:openaiStatus');
  ipcMain.handle(
    'pos:settings:openaiStatus',
    wrapHandler(async () => {
      requireAdmin(getDb());
      try {
        require('../config/loadRootEnv.cjs').loadRootEnv();
      } catch {
        // ignore
      }
      const {
        resolveOpenAiConfig,
        resolveGeminiTextConfig,
      } = require('../../public-api/lib/storeAiAnalysis.cjs');
      const openai = resolveOpenAiConfig({});
      const gemini = resolveGeminiTextConfig({});
      const hasOpenAi = Boolean(openai.hasApiKey);
      const hasGemini = Boolean(gemini.hasApiKey);
      const provider = hasOpenAi ? 'openai' : hasGemini ? 'gemini' : null;
      return {
        hasApiKey: hasOpenAi || hasGemini,
        hasOpenAi,
        hasGemini,
        provider,
        model: hasOpenAi
          ? String(openai.model || '')
          : hasGemini
            ? String(gemini.model || '')
            : null,
      };
    }),
  );

  // Reset local SQLite database (HOST only) — admin-only
  ipcMain.removeHandler('pos:settings:resetDatabase');
  ipcMain.handle(
    'pos:settings:resetDatabase',
    wrapHandler(async (_event, payload) => {
      requireAdmin(getDb());
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





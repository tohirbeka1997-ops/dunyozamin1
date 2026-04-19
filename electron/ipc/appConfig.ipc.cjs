const { ipcMain } = require('electron');
const { wrapHandler } = require('../lib/errors.cjs');
const { readConfig, writeConfig, resetConfig, getConfigPath } = require('../config/appConfig.cjs');

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
      return { ...cfg, configPath: getConfigPath(app) };
    })
  );

  ipcMain.removeHandler('pos:appConfig:set');
  ipcMain.handle(
    'pos:appConfig:set',
    wrapHandler(async (_event, patch) => {
      return writeConfig(patch || {}, app);
    })
  );

  ipcMain.removeHandler('pos:appConfig:reset');
  ipcMain.handle(
    'pos:appConfig:reset',
    wrapHandler(async () => {
      return resetConfig(app);
    })
  );
}

module.exports = { registerAppConfigHandlers };







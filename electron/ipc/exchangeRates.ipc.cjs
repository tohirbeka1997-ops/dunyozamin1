const { ipcMain } = require('electron');
const { wrapHandler } = require('../lib/errors.cjs');

/**
 * Exchange Rates IPC Handlers
 * Channels: pos:exchangeRates:*
 */
function registerExchangeRatesHandlers(services) {
  const { exchangeRates } = services;

  ipcMain.removeHandler('pos:exchangeRates:getLatest');
  ipcMain.handle(
    'pos:exchangeRates:getLatest',
    wrapHandler(async (_event, filters) => {
      return exchangeRates.getLatest(filters || {});
    })
  );

  ipcMain.removeHandler('pos:exchangeRates:list');
  ipcMain.handle(
    'pos:exchangeRates:list',
    wrapHandler(async (_event, filters) => {
      return exchangeRates.list(filters || {});
    })
  );

  ipcMain.removeHandler('pos:exchangeRates:upsert');
  ipcMain.handle(
    'pos:exchangeRates:upsert',
    wrapHandler(async (_event, payload) => {
      return exchangeRates.upsert(payload || {});
    })
  );
}

module.exports = { registerExchangeRatesHandlers };


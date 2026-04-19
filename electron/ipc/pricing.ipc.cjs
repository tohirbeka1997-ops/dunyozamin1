const { ipcMain } = require('electron');
const { wrapHandler } = require('../lib/errors.cjs');

function registerPricingHandlers(services) {
  const { pricing } = services;
  if (!pricing) throw new Error('PricingService not available');

  ipcMain.removeHandler('pos:pricing:getTiers');
  ipcMain.handle('pos:pricing:getTiers', wrapHandler(async () => {
    return pricing.getTiers();
  }));

  ipcMain.removeHandler('pos:pricing:getPrice');
  ipcMain.handle('pos:pricing:getPrice', wrapHandler(async (_event, payload) => {
    return pricing.getPriceForProduct(payload || {});
  }));

  ipcMain.removeHandler('pos:pricing:setPrice');
  ipcMain.handle('pos:pricing:setPrice', wrapHandler(async (_event, payload) => {
    return pricing.setPrice(payload || {});
  }));
}

module.exports = { registerPricingHandlers };

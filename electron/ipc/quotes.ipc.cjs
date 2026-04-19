const { ipcMain } = require('electron');
const { wrapHandler } = require('../lib/errors.cjs');

function registerQuotesHandlers(services) {
  if (!services?.quotes) return;

  const quotes = services.quotes;

  ipcMain.removeHandler('pos:quotes:list');
  ipcMain.handle('pos:quotes:list', wrapHandler(async (_event, filters) => {
    return quotes.list(filters || {});
  }));

  ipcMain.removeHandler('pos:quotes:get');
  ipcMain.handle('pos:quotes:get', wrapHandler(async (_event, id) => {
    return quotes.get(id);
  }));

  ipcMain.removeHandler('pos:quotes:create');
  ipcMain.handle('pos:quotes:create', wrapHandler(async (_event, data) => {
    return quotes.create(data);
  }));

  ipcMain.removeHandler('pos:quotes:update');
  ipcMain.handle('pos:quotes:update', wrapHandler(async (_event, id, data) => {
    return quotes.update(id, data);
  }));

  ipcMain.removeHandler('pos:quotes:delete');
  ipcMain.handle('pos:quotes:delete', wrapHandler(async (_event, id) => {
    return quotes.delete(id);
  }));

  ipcMain.removeHandler('pos:quotes:generateNumber');
  ipcMain.handle('pos:quotes:generateNumber', wrapHandler(async () => {
    return quotes.generateQuoteNumber();
  }));

  ipcMain.removeHandler('pos:quotes:convertToSale');
  ipcMain.handle('pos:quotes:convertToSale', wrapHandler(async (_event, quoteId, orderData) => {
    return quotes.convertToSale(quoteId, orderData || {});
  }));

  console.log('Quotes IPC handlers registered');
}

module.exports = { registerQuotesHandlers };

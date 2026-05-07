'use strict';

const { ipcMain } = require('electron');
const { wrapHandler } = require('../lib/errors.cjs');

function registerWebOrdersHandlers(services) {
  const svc = services.webOrders;
  if (!svc) {
    console.warn('[ipc] webOrders service missing');
    return;
  }

  ipcMain.removeHandler('pos:webOrders:list');
  ipcMain.handle('pos:webOrders:list', wrapHandler(async (_event, filters) => svc.list(filters || {})));

  ipcMain.removeHandler('pos:webOrders:get');
  ipcMain.handle('pos:webOrders:get', wrapHandler(async (_event, id) => svc.get(id)));

  ipcMain.removeHandler('pos:webOrders:updateStatus');
  ipcMain.handle(
    'pos:webOrders:updateStatus',
    wrapHandler(async (_event, id, status) => svc.updateStatus(id, status)),
  );

  ipcMain.removeHandler('pos:webOrders:update');
  ipcMain.handle(
    'pos:webOrders:update',
    wrapHandler(async (_event, id, payload) => svc.update(id, payload || {})),
  );

  ipcMain.removeHandler('pos:webOrders:cancel');
  ipcMain.handle('pos:webOrders:cancel', wrapHandler(async (_event, id) => svc.cancel(id)));

  ipcMain.removeHandler('pos:webOrders:dispatchToCourier');
  ipcMain.handle('pos:webOrders:dispatchToCourier', wrapHandler(async (_event, id) => svc.dispatchToCourier(id)));
}

module.exports = { registerWebOrdersHandlers };

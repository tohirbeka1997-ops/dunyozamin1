'use strict';

const { ipcMain } = require('electron');
const { wrapHandler } = require('../lib/errors.cjs');

function registerCouriersHandlers(services) {
  const svc = services.couriers;
  if (!svc) {
    console.warn('[ipc] couriers service missing');
    return;
  }

  ipcMain.removeHandler('pos:couriers:list');
  ipcMain.handle('pos:couriers:list', wrapHandler(async (_event, filters) => svc.list(filters || {})));

  ipcMain.removeHandler('pos:couriers:upsert');
  ipcMain.handle('pos:couriers:upsert', wrapHandler(async (_event, payload) => svc.upsert(payload || {})));

  ipcMain.removeHandler('pos:couriers:setActive');
  ipcMain.handle('pos:couriers:setActive', wrapHandler(async (_event, id, active) => svc.setActive(id, !!active)));
}

module.exports = { registerCouriersHandlers };

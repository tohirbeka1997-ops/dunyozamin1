'use strict';

const { ipcMain } = require('electron');
const { wrapHandler, createError, ERROR_CODES } = require('../lib/errors.cjs');

function resolveCouriersService(getServices) {
  const bag = typeof getServices === 'function' ? getServices() : null;
  return bag?.couriers || null;
}

function registerCouriersHandlers(getServices) {
  const requireSvc = () => {
    const svc = resolveCouriersService(getServices);
    if (!svc) {
      throw createError(ERROR_CODES.NOT_FOUND, 'Couriers service unavailable');
    }
    return svc;
  };

  ipcMain.removeHandler('pos:couriers:list');
  ipcMain.handle('pos:couriers:list', wrapHandler(async (_event, filters) => requireSvc().list(filters || {})));

  ipcMain.removeHandler('pos:couriers:upsert');
  ipcMain.handle('pos:couriers:upsert', wrapHandler(async (_event, payload) => requireSvc().upsert(payload || {})));

  ipcMain.removeHandler('pos:couriers:setActive');
  ipcMain.handle('pos:couriers:setActive', wrapHandler(async (_event, id, active) => requireSvc().setActive(id, !!active)));
}

module.exports = { registerCouriersHandlers };

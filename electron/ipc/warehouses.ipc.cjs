const { ipcMain } = require('electron');
const { wrapHandler } = require('../lib/errors.cjs');

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
 * Warehouses IPC Handlers
 * Channels: pos:warehouses:*
 */
function registerWarehousesHandlers(services) {
  const { warehouses } = services;

  // Remove fallback handlers before registering real ones
  ipcMain.removeHandler('pos:warehouses:list');
  ipcMain.handle('pos:warehouses:list', wrapHandler(async (_event, filters) => {
    return warehouses.list(filters || {});
  }));

  ipcMain.removeHandler('pos:warehouses:get');
  ipcMain.handle('pos:warehouses:get', wrapHandler(async (_event, id) => {
    return warehouses.getById(id);
  }));

  ipcMain.removeHandler('pos:warehouses:create');
  ipcMain.handle('pos:warehouses:create', wrapHandler(async (_event, data) => {
    return warehouses.create(data);
  }));

  ipcMain.removeHandler('pos:warehouses:update');
  ipcMain.handle('pos:warehouses:update', wrapHandler(async (_event, id, data) => {
    return warehouses.update(id, data);
  }));

  ipcMain.removeHandler('pos:warehouses:delete');
  ipcMain.handle('pos:warehouses:delete', wrapHandler(async (_event, id) => {
    return warehouses.delete(id);
  }));
  
  console.log('✅ Warehouses handlers registered (real DB)');
}

module.exports = { registerWarehousesHandlers };




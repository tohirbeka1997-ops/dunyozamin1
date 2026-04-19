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
 * Shifts IPC Handlers
 * Channels: pos:shifts:*
 */
function registerShiftsHandlers(services) {
  const { shifts } = services;

  // Remove existing handlers to prevent conflicts with fallback handlers
  ipcMain.removeHandler('pos:shifts:open');
  ipcMain.handle('pos:shifts:open', wrapHandler(async (_event, data) => {
    return shifts.openShift(data);
  }));

  ipcMain.removeHandler('pos:shifts:close');
  ipcMain.handle('pos:shifts:close', wrapHandler(async (_event, shiftId, data) => {
    return shifts.closeShift(shiftId, data);
  }));

  ipcMain.removeHandler('pos:shifts:get');
  ipcMain.handle('pos:shifts:get', wrapHandler(async (_event, id) => {
    return shifts.getById(id);
  }));

  ipcMain.removeHandler('pos:shifts:getActive');
  ipcMain.handle('pos:shifts:getActive', wrapHandler(async (_event, userId) => {
    // If userId is provided, use the user-specific method
    // Otherwise, get any active shift (for shift persistence)
    if (userId) {
      return shifts.getActiveShift(userId);
    }
    // Call the no-parameter version to get any active shift
    return shifts.getActiveShift();
  }));

  ipcMain.removeHandler('pos:shifts:getCurrent');
  ipcMain.handle('pos:shifts:getCurrent', wrapHandler(async (_event, cashierId) => {
    // Get current open shift for cashier (for shift persistence)
    return shifts.getOpenShiftForCashier(cashierId);
  }));

  ipcMain.removeHandler('pos:shifts:getStatus');
  ipcMain.handle('pos:shifts:getStatus', wrapHandler(async (_event, userId, warehouseId) => {
    return shifts.getStatus(userId, warehouseId);
  }));

  ipcMain.removeHandler('pos:shifts:require');
  ipcMain.handle('pos:shifts:require', wrapHandler(async (_event, userId, warehouseId) => {
    return shifts.requireShift(userId, warehouseId);
  }));

  ipcMain.removeHandler('pos:shifts:list');
  ipcMain.handle('pos:shifts:list', wrapHandler(async (_event, filters) => {
    return shifts.list(filters || {});
  }));

  ipcMain.removeHandler('pos:shifts:getSummary');
  ipcMain.handle('pos:shifts:getSummary', wrapHandler(async (_event, { shiftId }) => {
    return shifts.getShiftSummary(shiftId);
  }));
}

module.exports = { registerShiftsHandlers };





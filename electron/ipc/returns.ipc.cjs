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
 * Returns IPC Handlers
 * Channels: pos:returns:*
 */
function registerReturnsHandlers(services) {
  const { returns } = services;

  // Remove existing handlers to prevent conflicts with fallback handlers
  ipcMain.removeHandler('pos:returns:create');
  ipcMain.handle('pos:returns:create', wrapHandler(async (_event, data) => {
    return returns.createReturn(data);
  }));

  ipcMain.removeHandler('pos:returns:get');
  ipcMain.handle('pos:returns:get', wrapHandler(async (_event, id) => {
    return returns.getById(id);
  }));

  ipcMain.removeHandler('pos:returns:list');
  ipcMain.handle('pos:returns:list', wrapHandler(async (_event, filters) => {
    return returns.list(filters || {});
  }));

  // Get order details for return creation
  // CRITICAL: Uses orders + order_items (NOT sales + sale_items)
  ipcMain.removeHandler('pos:returns:getOrderDetails');
  ipcMain.handle('pos:returns:getOrderDetails', wrapHandler(async (_event, payload) => {
    // Backward/Preload compatibility:
    // - Some callers send { orderId }
    // - Some callers send orderId directly
    const orderId = (payload && typeof payload === 'object' && 'orderId' in payload) ? payload.orderId : payload;
    console.log('[IPC] pos:returns:getOrderDetails called with orderId:', orderId);
    if (!orderId) {
      throw new Error('orderId is required');
    }
    return returns.getOrderDetails(orderId);
  }));

  // Update return with new item quantities
  ipcMain.removeHandler('pos:returns:update');
  ipcMain.handle('pos:returns:update', wrapHandler(async (_event, a, b) => {
    // Backward/Preload compatibility:
    // - Some callers send { returnId, data }
    // - preload sends (returnId, payload)
    let returnId;
    let data;
    if (a && typeof a === 'object' && 'returnId' in a) {
      returnId = a.returnId;
      data = a.data;
    } else {
      returnId = a;
      data = b?.data ?? b;
    }
    console.log('[IPC] pos:returns:update called with returnId:', returnId);
    if (!returnId) {
      throw new Error('returnId is required');
    }
    return returns.updateReturn(returnId, data);
  }));
}

module.exports = { registerReturnsHandlers };





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
 * Sales (POS) IPC Handlers
 * Channels: pos:sales:*
 */
function registerSalesHandlers(services) {
  const { sales } = services;

  // Remove existing handlers to prevent conflicts with fallback handlers
  ipcMain.removeHandler('pos:sales:createDraftOrder');
  ipcMain.handle('pos:sales:createDraftOrder', wrapHandler(async (_event, data) => {
    return sales.createDraftOrder(data);
  }));

  ipcMain.removeHandler('pos:sales:addItem');
  ipcMain.handle('pos:sales:addItem', wrapHandler(async (_event, orderId, itemData) => {
    return sales.addItem(orderId, itemData);
  }));

  ipcMain.removeHandler('pos:sales:removeItem');
  ipcMain.handle('pos:sales:removeItem', wrapHandler(async (_event, orderId, itemId) => {
    return sales.removeItem(orderId, itemId);
  }));

  ipcMain.removeHandler('pos:sales:updateItemQuantity');
  ipcMain.handle('pos:sales:updateItemQuantity', wrapHandler(async (_event, orderId, itemId, quantity) => {
    return sales.updateItemQuantity(orderId, itemId, quantity);
  }));

  ipcMain.removeHandler('pos:sales:setCustomer');
  ipcMain.handle('pos:sales:setCustomer', wrapHandler(async (_event, orderId, customerId) => {
    return sales.setCustomer(orderId, customerId);
  }));

  ipcMain.removeHandler('pos:sales:finalizeOrder');
  ipcMain.handle('pos:sales:finalizeOrder', wrapHandler(async (_event, orderId, paymentData) => {
    return sales.finalizeOrder(orderId, paymentData);
  }));

  ipcMain.removeHandler('pos:sales:getOrder');
  ipcMain.handle('pos:sales:getOrder', wrapHandler(async (_event, orderId) => {
    return sales._getOrderWithDetails(orderId);
  }));

  // Complete POS order (atomic - matches frontend createOrder API)
  ipcMain.removeHandler('pos:sales:completePOSOrder');
  ipcMain.handle('pos:sales:completePOSOrder', wrapHandler(async (_event, orderData, itemsData, paymentsData) => {
    return sales.completePOSOrder(orderData, itemsData, paymentsData);
  }));

  // List all orders
  ipcMain.removeHandler('pos:sales:list');
  ipcMain.handle('pos:sales:list', wrapHandler(async (_event, filters) => {
    return sales.list(filters);
  }));

  // Get single order by ID
  ipcMain.removeHandler('pos:sales:get');
  ipcMain.handle('pos:sales:get', wrapHandler(async (_event, orderId) => {
    return sales._getOrderWithDetails(orderId);
  }));

  // Refund order - restores stock and reverses customer debt
  ipcMain.removeHandler('pos:sales:refund');
  ipcMain.handle('pos:sales:refund', wrapHandler(async (_event, orderId, reason, itemsToReturn = null) => {
    console.log('🔄 pos:sales:refund called (real handler)', orderId, reason, itemsToReturn);
    return sales.refundOrder(orderId, reason, itemsToReturn);
  }));
}

module.exports = { registerSalesHandlers };



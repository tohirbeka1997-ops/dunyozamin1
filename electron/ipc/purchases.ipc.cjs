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
 * Purchases IPC Handlers
 * Channels: pos:purchases:*
 */
function registerPurchasesHandlers(services) {
  if (!services) {
    throw new Error('Services object is required for registerPurchasesHandlers');
  }

  const { purchases } = services;
  
  if (!purchases) {
    throw new Error('Purchases service is not available in services object');
  }

  // Remove any existing handlers before registering
  console.log('Registering pos:purchases:list handler...');
  ipcMain.removeHandler('pos:purchases:list');
  ipcMain.handle('pos:purchases:list', wrapHandler(async (_event, filters) => {
    return purchases.list(filters || {});
  }));

  console.log('Registering pos:purchases:get handler...');
  ipcMain.removeHandler('pos:purchases:get');
  ipcMain.handle('pos:purchases:get', wrapHandler(async (_event, id) => {
    return purchases.get(id);
  }));

  console.log('Registering pos:purchases:createOrder handler...');
  ipcMain.removeHandler('pos:purchases:createOrder');
  ipcMain.handle('pos:purchases:createOrder', wrapHandler(async (_event, data) => {
    return purchases.createOrder(data);
  }));

  console.log('Registering pos:purchases:updateOrder handler...');
  ipcMain.removeHandler('pos:purchases:updateOrder');
  ipcMain.handle('pos:purchases:updateOrder', wrapHandler(async (_event, purchaseOrderId, data, items) => {
    return purchases.updateOrder(purchaseOrderId, data, items);
  }));

  console.log('Registering pos:purchases:approve handler...');
  ipcMain.removeHandler('pos:purchases:approve');
  ipcMain.handle('pos:purchases:approve', wrapHandler(async (_event, purchaseOrderId, approvedBy) => {
    return purchases.approveOrder(purchaseOrderId, approvedBy);
  }));

  console.log('Registering pos:purchases:receiveGoods handler...');
  ipcMain.removeHandler('pos:purchases:receiveGoods');
  ipcMain.handle('pos:purchases:receiveGoods', wrapHandler(async (_event, purchaseOrderId, receiptData) => {
    return purchases.receiveGoods(purchaseOrderId, receiptData);
  }));

  console.log('Registering pos:purchases:createReceipt handler...');
  ipcMain.removeHandler('pos:purchases:createReceipt');
  ipcMain.handle('pos:purchases:createReceipt', wrapHandler(async (_event, payload) => {
    return purchases.createReceipt(payload || {});
  }));

  console.log('Registering pos:purchases:deleteOrder handler...');
  ipcMain.removeHandler('pos:purchases:deleteOrder');
  ipcMain.handle('pos:purchases:deleteOrder', wrapHandler(async (_event, purchaseOrderId) => {
    return purchases.deleteOrder(purchaseOrderId);
  }));

  // Purchase order expenses (landed cost)
  console.log('Registering pos:purchases:listExpenses handler...');
  ipcMain.removeHandler('pos:purchases:listExpenses');
  ipcMain.handle('pos:purchases:listExpenses', wrapHandler(async (_event, purchaseOrderId) => {
    return purchases.listExpenses(purchaseOrderId);
  }));

  console.log('Registering pos:purchases:addExpense handler...');
  ipcMain.removeHandler('pos:purchases:addExpense');
  ipcMain.handle('pos:purchases:addExpense', wrapHandler(async (_event, purchaseOrderId, payload) => {
    return purchases.addExpense(purchaseOrderId, payload || {});
  }));

  console.log('Registering pos:purchases:deleteExpense handler...');
  ipcMain.removeHandler('pos:purchases:deleteExpense');
  ipcMain.handle('pos:purchases:deleteExpense', wrapHandler(async (_event, purchaseOrderId, expenseId) => {
    return purchases.deleteExpense(purchaseOrderId, expenseId);
  }));

  console.log('All purchases handlers registered successfully');
}

module.exports = { registerPurchasesHandlers };

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
 * Suppliers IPC Handlers
 * Channels: pos:suppliers:*
 */
function registerSuppliersHandlers(services) {
  if (!services) {
    throw new Error('Services object is required for registerSuppliersHandlers');
  }

  const { suppliers } = services;
  const supplierReturns = services?.supplierReturns;
  
  if (!suppliers) {
    throw new Error('Suppliers service is not available in services object');
  }

  // Remove any existing handlers before registering
  console.log('Registering pos:suppliers:list handler...');
  ipcMain.removeHandler('pos:suppliers:list');
  ipcMain.handle('pos:suppliers:list', wrapHandler(async (_event, filters) => {
    return suppliers.list(filters || {});
  }));

  console.log('Registering pos:suppliers:get handler...');
  ipcMain.removeHandler('pos:suppliers:get');
  ipcMain.handle('pos:suppliers:get', wrapHandler(async (_event, id) => {
    return suppliers.get(id);
  }));

  console.log('Registering pos:suppliers:create handler...');
  ipcMain.removeHandler('pos:suppliers:create');
  ipcMain.handle('pos:suppliers:create', wrapHandler(async (_event, data) => {
    return suppliers.create(data);
  }));

  console.log('Registering pos:suppliers:update handler...');
  ipcMain.removeHandler('pos:suppliers:update');
  ipcMain.handle('pos:suppliers:update', wrapHandler(async (_event, id, data) => {
    return suppliers.update(id, data);
  }));

  console.log('Registering pos:suppliers:delete handler...');
  ipcMain.removeHandler('pos:suppliers:delete');
  ipcMain.handle('pos:suppliers:delete', wrapHandler(async (_event, id) => {
    return suppliers.delete(id);
  }));

  console.log('Registering pos:suppliers:getLedger handler...');
  ipcMain.removeHandler('pos:suppliers:getLedger');
  ipcMain.handle('pos:suppliers:getLedger', wrapHandler(async (_event, supplierId, filters) => {
    return suppliers.getLedger(supplierId, filters || {});
  }));

  console.log('Registering pos:suppliers:createPayment handler...');
  ipcMain.removeHandler('pos:suppliers:createPayment');
  ipcMain.handle('pos:suppliers:createPayment', wrapHandler(async (_event, data) => {
    return suppliers.createPayment(data);
  }));

  console.log('Registering pos:suppliers:deletePayment handler...');
  ipcMain.removeHandler('pos:suppliers:deletePayment');
  ipcMain.handle('pos:suppliers:deletePayment', wrapHandler(async (_event, paymentId) => {
    return suppliers.deletePayment(paymentId);
  }));

  console.log('Registering pos:suppliers:getPayments handler...');
  ipcMain.removeHandler('pos:suppliers:getPayments');
  ipcMain.handle('pos:suppliers:getPayments', wrapHandler(async (_event, supplierId) => {
    return suppliers.getPayments(supplierId);
  }));

  console.log('Registering pos:suppliers:getPurchaseSummary handler...');
  ipcMain.removeHandler('pos:suppliers:getPurchaseSummary');
  ipcMain.handle('pos:suppliers:getPurchaseSummary', wrapHandler(async (_event, supplierId, filters) => {
    return suppliers.getPurchaseSummary(supplierId, filters || {});
  }));

  // Supplier Returns (credit notes)
  if (supplierReturns) {
    console.log('Registering pos:suppliers:createReturn handler...');
    ipcMain.removeHandler('pos:suppliers:createReturn');
    ipcMain.handle('pos:suppliers:createReturn', wrapHandler(async (_event, payload) => {
      return supplierReturns.create(payload || {});
    }));

    console.log('Registering pos:suppliers:getReturn handler...');
    ipcMain.removeHandler('pos:suppliers:getReturn');
    ipcMain.handle('pos:suppliers:getReturn', wrapHandler(async (_event, id) => {
      return supplierReturns.get(id);
    }));

    console.log('Registering pos:suppliers:listReturns handler...');
    ipcMain.removeHandler('pos:suppliers:listReturns');
    ipcMain.handle('pos:suppliers:listReturns', wrapHandler(async (_event, filters) => {
      return supplierReturns.list(filters || {});
    }));
  } else {
    console.warn('[Suppliers IPC] supplierReturns service not available; return handlers not registered');
  }

  console.log('All suppliers handlers registered successfully');
}

module.exports = { registerSuppliersHandlers };

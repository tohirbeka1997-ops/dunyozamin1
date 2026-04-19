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
 * Customers IPC Handlers
 * Channels: pos:customers:*
 */
function registerCustomersHandlers(services) {
  const { customers } = services;

  // Remove fallback handlers before registering real ones
  console.log('Registering pos:customers:list handler...');
  ipcMain.removeHandler('pos:customers:list');
  ipcMain.handle('pos:customers:list', wrapHandler(async (_event, filters) => {
    return customers.list(filters || {});
  }));

  console.log('Registering pos:customers:get handler...');
  ipcMain.removeHandler('pos:customers:get');
  ipcMain.handle('pos:customers:get', wrapHandler(async (_event, id) => {
    return customers.getById(id);
  }));

  console.log('Registering pos:customers:create handler...');
  ipcMain.removeHandler('pos:customers:create');
  ipcMain.handle('pos:customers:create', wrapHandler(async (_event, data) => {
    return customers.create(data);
  }));

  console.log('Registering pos:customers:update handler...');
  ipcMain.removeHandler('pos:customers:update');
  ipcMain.handle('pos:customers:update', wrapHandler(async (_event, id, data) => {
    return customers.update(id, data);
  }));

  console.log('Registering pos:customers:delete handler...');
  ipcMain.removeHandler('pos:customers:delete');
  ipcMain.handle('pos:customers:delete', wrapHandler(async (_event, id) => {
    return customers.delete(id);
  }));

  console.log('Registering pos:customers:updateBalance handler...');
  ipcMain.removeHandler('pos:customers:updateBalance');
  ipcMain.handle('pos:customers:updateBalance', wrapHandler(async (_event, customerId, amount, type) => {
    return customers.updateBalance(customerId, amount, type);
  }));

  console.log('Registering pos:customers:receivePayment handler...');
  ipcMain.removeHandler('pos:customers:receivePayment');
  ipcMain.handle('pos:customers:receivePayment', wrapHandler(async (_event, payload) => {
    // Accept payload object (backward-compatible):
    // - New UI: { customer_id, amount, operation, payment_method, notes, received_by, order_id, source }
    // - Old UI: { customer_id, amount, method, notes, received_by, order_id, source }
    const customer_id = payload?.customer_id;
    const amount = payload?.amount;
    const operation = payload?.operation || 'payment_in';
    const method = payload?.method || payload?.payment_method;
    const notes = payload?.notes ?? payload?.note ?? null;
    const received_by = payload?.received_by ?? payload?.receivedBy ?? null;
    const order_id = payload?.order_id ?? payload?.orderId ?? null;
    const source = payload?.source ?? null;

    if (!operation || (operation !== 'payment_in' && operation !== 'payment_out')) {
      throw new Error('Invalid operation type. Must be "payment_in" or "payment_out"');
    }

    return customers.receivePayment(
      customer_id,
      amount,
      method,
      notes || null,
      received_by || null,
      order_id || null,
      source || null,
      operation
    );
  }));

  console.log('Registering pos:customers:getPayments handler...');
  ipcMain.removeHandler('pos:customers:getPayments');
  ipcMain.handle('pos:customers:getPayments', wrapHandler(async (_event, customerId, filters) => {
    return customers.getPayments(customerId, filters || {});
  }));

  console.log('Registering pos:customers:getLedger handler...');
  ipcMain.removeHandler('pos:customers:getLedger');
  ipcMain.handle('pos:customers:getLedger', wrapHandler(async (_event, customerId, filters) => {
    // Frontend calls: getLedger(customerId, filters)
    // Handle both formats for compatibility
    if (typeof customerId === 'object' && customerId !== null && !filters) {
      // Payload object format: { customerId, limit, offset, from, to, type }
      const payload = customerId;
      return customers.getLedger(payload.customerId, {
        limit: payload.limit || 50,
        offset: payload.offset || 0,
        from: payload.from,
        to: payload.to,
        type: payload.type
      });
    } else {
      // Separate parameters format: (customerId, filters)
      return customers.getLedger(customerId, filters || {});
    }
  }));

  console.log('Registering pos:customers:getLedgerCount handler...');
  ipcMain.removeHandler('pos:customers:getLedgerCount');
  ipcMain.handle('pos:customers:getLedgerCount', wrapHandler(async (_event, payload) => {
    // Accept either customerId string or payload object
    const customerId = typeof payload === 'string' ? payload : payload?.customerId;
    return customers.getLedgerCount(customerId);
  }));

  console.log('Registering pos:customers:exportCsv handler...');
  ipcMain.removeHandler('pos:customers:exportCsv');
  ipcMain.handle('pos:customers:exportCsv', wrapHandler(async (event, filters) => {
    // Get BrowserWindow from event for dialog
    // event.sender is the WebContents, get its BrowserWindow
    const { BrowserWindow } = require('electron');
    const browserWindow = BrowserWindow.fromWebContents(event.sender);
    return customers.exportCsv(filters || {}, browserWindow || null);
  }));

  ipcMain.removeHandler('pos:customers:getBonusLedger');
  ipcMain.handle(
    'pos:customers:getBonusLedger',
    wrapHandler(async (_event, customerId, filters) => {
      return customers.getBonusLedger(customerId, filters || {});
    })
  );

  ipcMain.removeHandler('pos:customers:adjustBonusPoints');
  ipcMain.handle(
    'pos:customers:adjustBonusPoints',
    wrapHandler(async (_event, payload) => {
      const p = payload || {};
      return customers.adjustBonusPoints(p.actorUserId, p.customerId, p.deltaPoints, p.note);
    })
  );

  console.log('✅ Customers handlers registered (real DB)');
}

module.exports = { registerCustomersHandlers };





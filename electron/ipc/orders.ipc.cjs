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
 * Orders IPC Handlers
 * Channels: pos:orders:*
 */
function registerOrdersHandlers(services) {
  const { sales } = services;

  // Remove existing handlers to prevent conflicts with fallback handlers
  ipcMain.removeHandler('pos:orders:list');
  ipcMain.handle('pos:orders:list', wrapHandler(async (_event, filters) => {
    console.log('📋 pos:orders:list called (real handler) with filters:', filters);
    const f = filters || {};
    const withDetails = f.with_details !== false; // default true

    const orders = sales.list(f);
    console.log(`✅ pos:orders:list returning ${orders.length} orders (withDetails=${withDetails})`);

    if (!withDetails) return orders;

    // Enrich each order with items/payments so Orders UI can render correctly
    const detailed = orders
      .map((o) => sales._getOrderWithDetails(o.id))
      .filter(Boolean);
    return detailed;
  }));

  ipcMain.removeHandler('pos:orders:get');
  ipcMain.handle('pos:orders:get', wrapHandler(async (_event, orderId) => {
    console.log('📋 pos:orders:get called for order:', orderId);
    return sales._getOrderWithDetails(orderId);
  }));

  // Optional: get by order_number (used by preload API)
  ipcMain.removeHandler('pos:orders:getByNumber');
  ipcMain.handle('pos:orders:getByNumber', wrapHandler(async (_event, orderNumber) => {
    console.log('📋 pos:orders:getByNumber called for order:', orderNumber);
    // Resolve id by order_number then return full details
    const row = sales.db?.prepare?.('SELECT id FROM orders WHERE order_number = ?')?.get(orderNumber);
    if (!row?.id) return null;
    return sales._getOrderWithDetails(row.id);
  }));

  ipcMain.removeHandler('pos:orders:getByCustomer');
  ipcMain.handle('pos:orders:getByCustomer', wrapHandler(async (_event, customerId) => {
    console.log('📋 pos:orders:getByCustomer called for customer:', customerId);
    return sales.getByCustomer(customerId);
  }));
}

module.exports = { registerOrdersHandlers };













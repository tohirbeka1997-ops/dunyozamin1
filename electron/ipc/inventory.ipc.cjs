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
 * Inventory IPC Handlers
 * Channels: pos:inventory:*
 */
function registerInventoryHandlers(services) {
  const { inventory, batches } = services;

  // Remove fallback handlers before registering real ones
  ipcMain.removeHandler('pos:inventory:getBalances');
  ipcMain.handle('pos:inventory:getBalances', wrapHandler(async (_event, filters) => {
    console.log('pos:inventory:getBalances called (real handler)');
    return inventory.getBalances(filters || {});
  }));

  ipcMain.removeHandler('pos:inventory:getMoves');
  ipcMain.handle('pos:inventory:getMoves', wrapHandler(async (_event, filters) => {
    console.log('pos:inventory:getMoves called (real handler)');
    return inventory.getMoves(filters || {});
  }));

  ipcMain.removeHandler('pos:inventory:getProductLedger');
  ipcMain.handle('pos:inventory:getProductLedger', wrapHandler(async (_event, filters) => {
    console.log('pos:inventory:getProductLedger called (real handler)');
    return inventory.getProductLedger(filters || {});
  }));

  ipcMain.removeHandler('pos:inventory:adjustStock');
  ipcMain.handle('pos:inventory:adjustStock', wrapHandler(async (_event, adjustmentData) => {
    console.log('pos:inventory:adjustStock called (real handler)');
    return inventory.adjustStock(adjustmentData);
  }));

  console.log('Registering pos:inventory:getProductPurchaseHistory handler...');
  ipcMain.removeHandler('pos:inventory:getProductPurchaseHistory');
  ipcMain.handle('pos:inventory:getProductPurchaseHistory', wrapHandler(async (_event, productId) => {
    console.log('pos:inventory:getProductPurchaseHistory called for product:', productId);
    return inventory.getProductPurchaseHistory(productId);
  }));

  console.log('Registering pos:inventory:getProductSalesHistory handler...');
  ipcMain.removeHandler('pos:inventory:getProductSalesHistory');
  ipcMain.handle('pos:inventory:getProductSalesHistory', wrapHandler(async (_event, productId) => {
    console.log('pos:inventory:getProductSalesHistory called for product:', productId);
    return inventory.getProductSalesHistory(productId);
  }));

  console.log('Registering pos:inventory:getProductDetail handler...');
  ipcMain.removeHandler('pos:inventory:getProductDetail');
  ipcMain.handle('pos:inventory:getProductDetail', wrapHandler(async (_event, productId) => {
    console.log('pos:inventory:getProductDetail called for product:', productId);
    return inventory.getProductDetail(productId);
  }));

  console.log('Registering pos:inventory:getCurrentStock handler...');
  ipcMain.removeHandler('pos:inventory:getCurrentStock');
  ipcMain.handle('pos:inventory:getCurrentStock', wrapHandler(async (_event, productId, warehouseId) => {
    console.log('pos:inventory:getCurrentStock called for product:', productId, 'warehouse:', warehouseId);
    return inventory.getCurrentStock(productId, warehouseId || null);
  }));

  // Advanced analytics
  ipcMain.removeHandler('pos:inventory:getDeadStock');
  ipcMain.handle('pos:inventory:getDeadStock', wrapHandler(async (_event, payload) => {
    const p = payload || {};
    return inventory.getDeadStock({ days: p.days });
  }));

  ipcMain.removeHandler('pos:inventory:getStockTurnover');
  ipcMain.handle('pos:inventory:getStockTurnover', wrapHandler(async (_event, payload) => {
    const p = payload || {};
    return inventory.getStockTurnover({ days: p.days });
  }));

  ipcMain.removeHandler('pos:inventory:getReorderSuggestions');
  ipcMain.handle('pos:inventory:getReorderSuggestions', wrapHandler(async (_event) => {
    return inventory.getReorderSuggestions();
  }));

  // Batch mode (partiya) helpers
  ipcMain.removeHandler('pos:inventory:getBatchesByProduct');
  ipcMain.handle('pos:inventory:getBatchesByProduct', wrapHandler(async (_event, productId, warehouseId) => {
    if (!batches) throw new Error('BatchService not available');
    return batches.listBatchesByProduct(productId, warehouseId);
  }));

  ipcMain.removeHandler('pos:inventory:getBatchReconcile');
  ipcMain.handle('pos:inventory:getBatchReconcile', wrapHandler(async (_event, productId, warehouseId) => {
    if (!batches) throw new Error('BatchService not available');
    return batches.reconcile(productId || null, warehouseId || null);
  }));

  ipcMain.removeHandler('pos:inventory:runBatchCutoverSnapshot');
  ipcMain.handle('pos:inventory:runBatchCutoverSnapshot', wrapHandler(async (_event, payload) => {
    if (!batches) throw new Error('BatchService not available');
    const p = payload || {};
    return batches.runCutoverSnapshot({
      cutoverAt: p.cutoverAt,
      warehouseId: p.warehouseId,
      costMode: p.costMode || 'last_received_po_cost',
      updatedBy: p.updatedBy || null,
    });
  }));
  
  console.log('✅ Inventory handlers registered (real DB)');
}

module.exports = { registerInventoryHandlers };




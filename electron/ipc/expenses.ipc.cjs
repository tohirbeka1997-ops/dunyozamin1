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
 * Expenses IPC Handlers
 * Channels: pos:expenses:*
 */
function registerExpensesHandlers(services) {
  const { expenses } = services;

  // Remove existing handlers to prevent conflicts with fallback handlers
  // Categories
  ipcMain.removeHandler('pos:expenses:listCategories');
  ipcMain.handle('pos:expenses:listCategories', wrapHandler(async (_event, filters) => {
    return expenses.listCategories(filters || {});
  }));

  ipcMain.removeHandler('pos:expenses:createCategory');
  ipcMain.handle('pos:expenses:createCategory', wrapHandler(async (_event, data) => {
    return expenses.createCategory(data);
  }));

  ipcMain.removeHandler('pos:expenses:updateCategory');
  ipcMain.handle('pos:expenses:updateCategory', wrapHandler(async (_event, id, data) => {
    return expenses.updateCategory(id, data);
  }));

  ipcMain.removeHandler('pos:expenses:deleteCategory');
  ipcMain.handle('pos:expenses:deleteCategory', wrapHandler(async (_event, id) => {
    return expenses.deleteCategory(id);
  }));

  // Expenses
  ipcMain.removeHandler('pos:expenses:list');
  ipcMain.handle('pos:expenses:list', wrapHandler(async (_event, filters) => {
    return expenses.list(filters || {});
  }));

  ipcMain.removeHandler('pos:expenses:create');
  ipcMain.handle('pos:expenses:create', wrapHandler(async (_event, data) => {
    return expenses.create(data);
  }));

  ipcMain.removeHandler('pos:expenses:update');
  ipcMain.handle('pos:expenses:update', wrapHandler(async (_event, id, data) => {
    return expenses.update(id, data);
  }));

  ipcMain.removeHandler('pos:expenses:delete');
  ipcMain.handle('pos:expenses:delete', wrapHandler(async (_event, id) => {
    return expenses.delete(id);
  }));
}

module.exports = { registerExpensesHandlers };





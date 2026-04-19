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
 * Categories IPC Handlers
 * Channels: pos:categories:*
 */
function registerCategoriesHandlers(services) {
  if (!services) {
    throw new Error('Services object is required for registerCategoriesHandlers');
  }

  const { categories } = services;
  
  if (!categories) {
    throw new Error('Categories service is not available in services object');
  }

  console.log('Registering pos:categories:list handler...');
  ipcMain.removeHandler('pos:categories:list'); // Remove any existing handler first
  ipcMain.handle('pos:categories:list', wrapHandler(async (_event, filters) => {
    console.log('pos:categories:list called with filters:', JSON.stringify(filters || {}, null, 2));
    try {
      const result = await categories.list(filters || {});
      console.log(`pos:categories:list succeeded, returning ${result.length} categories`);
      return result;
    } catch (error) {
      console.error('pos:categories:list error:', error);
      throw error;
    }
  }));

  console.log('Registering pos:categories:get handler...');
  ipcMain.removeHandler('pos:categories:get');
  ipcMain.handle('pos:categories:get', wrapHandler(async (_event, id) => {
    return categories.getById(id);
  }));

  console.log('Registering pos:categories:create handler...');
  ipcMain.removeHandler('pos:categories:create');
  ipcMain.handle('pos:categories:create', wrapHandler(async (event, data) => {
    console.log('pos:categories:create called with data:', JSON.stringify(data, null, 2));
    try {
      const result = await categories.create(data);
      console.log('pos:categories:create succeeded, returning category:', result.id);
      // Emit cache invalidation event
      if (event && event.sender) {
        event.sender.send('cache:invalidate', { type: 'categories' });
      }
      return result;
    } catch (error) {
      console.error('pos:categories:create error:', error);
      throw error;
    }
  }));

  console.log('Registering pos:categories:update handler...');
  ipcMain.removeHandler('pos:categories:update');
  ipcMain.handle('pos:categories:update', wrapHandler(async (event, id, data) => {
    const result = await categories.update(id, data);
    // Emit cache invalidation event
    if (event && event.sender) {
      event.sender.send('cache:invalidate', { type: 'categories' });
    }
    return result;
  }));

  console.log('Registering pos:categories:delete handler...');
  ipcMain.removeHandler('pos:categories:delete');
  ipcMain.handle('pos:categories:delete', wrapHandler(async (event, id) => {
    const result = await categories.delete(id);
    // Emit cache invalidation event
    if (event && event.sender) {
      event.sender.send('cache:invalidate', { type: 'categories' });
    }
    return result;
  }));

  console.log('All categories handlers registered successfully');
}

module.exports = { registerCategoriesHandlers };




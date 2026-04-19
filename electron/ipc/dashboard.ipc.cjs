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
 * Dashboard IPC Handlers
 * Channels: pos:dashboard:*
 */
function registerDashboardHandlers(services) {
  if (!services) {
    throw new Error('Services object is required for registerDashboardHandlers');
  }

  const { dashboard } = services;
  
  if (!dashboard) {
    throw new Error('Dashboard service is not available in services object');
  }

  // Remove any existing handlers before registering
  console.log('Registering pos:dashboard:getStats handler...');
  ipcMain.removeHandler('pos:dashboard:getStats');
  ipcMain.handle('pos:dashboard:getStats', wrapHandler(async (_event, filters) => {
    return dashboard.getStats(filters || {});
  }));

  console.log('Registering pos:dashboard:getAnalytics handler...');
  ipcMain.removeHandler('pos:dashboard:getAnalytics');
  ipcMain.handle('pos:dashboard:getAnalytics', wrapHandler(async (_event, filters) => {
    console.log('📊 [IPC] pos:dashboard:getAnalytics called with filters:', JSON.stringify(filters || {}, null, 2));
    return dashboard.getAnalytics(filters || {});
  }));

  console.log('All dashboard handlers registered successfully');
}

module.exports = { registerDashboardHandlers };

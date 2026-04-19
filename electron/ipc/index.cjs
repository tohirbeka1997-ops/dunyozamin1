const { ipcMain } = require('electron');
const { getDb } = require('../db/open.cjs');
const { createServices } = require('../services/index.cjs');
const { wrapHandler } = require('../lib/errors.cjs');

// IPC timing instrumentation (main process)
const IPC_PERF_SAMPLES = 5;
const IPC_BUDGETS_MS = {
  'pos:products:searchScreen': 300,
  'pos:products:getByBarcode': 150,
  'pos:products:getBySku': 150,
  'pos:sales:completePOSOrder': 500,
};

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '0B';
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function safeSize(val) {
  try {
    const raw = JSON.stringify(val ?? null);
    return Buffer.byteLength(raw, 'utf8');
  } catch {
    return 0;
  }
}

function installIpcTiming() {
  if (ipcMain.__perfWrapped) return;
  ipcMain.__perfWrapped = true;
  const stats = new Map();
  const originalHandle = ipcMain.handle.bind(ipcMain);

  ipcMain.handle = (channel, handler) => {
    return originalHandle(channel, async (...args) => {
      const start = process.hrtime.bigint();
      const payloadBytes = safeSize(args.slice(1));
      try {
        const result = await handler(...args);
        const end = process.hrtime.bigint();
        const ms = Number(end - start) / 1e6;
        const respBytes = safeSize(result);
        const items = Array.isArray(result) ? result.length : result && typeof result === 'object' ? 1 : 0;
        const stat = stats.get(channel) || { samples: [], max: 0 };
        stat.samples.push(ms);
        if (stat.samples.length > IPC_PERF_SAMPLES) stat.samples.shift();
        stat.max = Math.max(stat.max, ms);
        const avg = stat.samples.reduce((a, b) => a + b, 0) / stat.samples.length;
        stats.set(channel, stat);
        const budget = IPC_BUDGETS_MS[channel];
        const warn = budget && ms > budget ? ' ⚠️' : '';
        console.log(
          `[IPC] ${channel} took ${Math.round(ms)}ms | args=${formatBytes(payloadBytes)} | resp=${formatBytes(respBytes)} | items=${items} | avg=${Math.round(avg)}ms | max=${Math.round(stat.max)}ms${warn}`
        );
        return result;
      } catch (error) {
        const end = process.hrtime.bigint();
        const ms = Number(end - start) / 1e6;
        console.log(`[IPC] ${channel} failed in ${Math.round(ms)}ms | args=${formatBytes(payloadBytes)}`);
        throw error;
      }
    });
  };
}

// Import all IPC handler modules
const { registerProductsHandlers } = require('./products.ipc.cjs');
const { registerPricingHandlers } = require('./pricing.ipc.cjs');
const { registerCategoriesHandlers } = require('./categories.ipc.cjs');
const { registerWarehousesHandlers } = require('./warehouses.ipc.cjs');
const { registerCustomersHandlers } = require('./customers.ipc.cjs');
const { registerSuppliersHandlers } = require('./suppliers.ipc.cjs');
const { registerInventoryHandlers } = require('./inventory.ipc.cjs');
const { registerSalesHandlers } = require('./sales.ipc.cjs');
const { registerReturnsHandlers } = require('./returns.ipc.cjs');
const { registerPurchasesHandlers } = require('./purchases.ipc.cjs');
const { registerExpensesHandlers } = require('./expenses.ipc.cjs');
const { registerShiftsHandlers } = require('./shifts.ipc.cjs');
const { registerReportsHandlers } = require('./reports.ipc.cjs');
const { registerDashboardHandlers } = require('./dashboard.ipc.cjs');
const { registerSettingsHandlers } = require('./settings.ipc.cjs');
const { registerExchangeRatesHandlers } = require('./exchangeRates.ipc.cjs');
const { registerAuthHandlers } = require('./auth.ipc.cjs');
const { registerOrdersHandlers } = require('./orders.ipc.cjs');
const { registerUsersHandlers } = require('./users.ipc.cjs');
const { registerFilesHandlers } = require('./files.ipc.cjs');
const { registerAppConfigHandlers } = require('./appConfig.ipc.cjs');
const { registerPrintHandlers } = require('./print.ipc.cjs');
const { registerQuotesHandlers } = require('./quotes.ipc.cjs');
const { registerPromotionsHandlers } = require('./promotions.ipc.cjs');

let handlersRegistered = false;
let services = null;
let dbInstance = null;

/**
 * Register all IPC handlers
 * Safe to call multiple times (idempotent)
 */
function registerAllHandlers() {
  if (handlersRegistered) {
    console.log('IPC handlers already registered');
    return;
  }

  console.log('Registering IPC handlers...');
  installIpcTiming();

  // App-local config handlers (must always exist, even in CLIENT mode)
  try {
    const { app } = require('electron');
    registerAppConfigHandlers(app);
  } catch (e) {
    console.warn('Failed to register app config handlers:', e?.message || e);
  }

  // Initialize services
  let db;
  try {
    db = getDb();
    dbInstance = db;
    services = createServices(db);
    console.log('Services initialized successfully');
  } catch (serviceError) {
    console.error('Failed to initialize services:', serviceError);
    throw serviceError; // Re-throw so fallback handlers can be registered
  }

  // Register all handler modules
  try {
    console.log('Registering products handlers...');
    registerProductsHandlers(services);
  registerPricingHandlers(services);
    console.log('Registering categories handlers...');
    registerCategoriesHandlers(services);
  } catch (handlerError) {
    console.error('Failed to register handlers:', handlerError);
    throw handlerError; // Re-throw so fallback handlers can be registered
  }
  console.log('Registering warehouses handlers...');
  registerWarehousesHandlers(services);
  console.log('Registering customers handlers...');
  registerCustomersHandlers(services);
  console.log('Registering suppliers handlers...');
  try {
    registerSuppliersHandlers(services);
    console.log('✅ Suppliers handlers registered successfully');
    
    // Verify create handler is registered
    const { ipcMain } = require('electron');
    // Note: ipcMain doesn't expose listenerCount for handlers, but we can check if it's in the internal handlers map
    console.log('✅ Supplier handlers registration completed');
  } catch (error) {
    console.error('❌ Failed to register suppliers handlers:', error);
    console.error('Error details:', {
      message: error.message,
      stack: error.stack,
      servicesAvailable: !!services,
      suppliersServiceAvailable: !!services?.suppliers,
      createMethodAvailable: !!services?.suppliers?.create,
    });
    throw error;
  }
  console.log('Registering inventory handlers...');
  registerInventoryHandlers(services);
  console.log('Registering sales handlers...');
  registerSalesHandlers(services);
  console.log('Registering returns handlers...');
  registerReturnsHandlers(services);
  console.log('Registering purchases handlers...');
  registerPurchasesHandlers(services);
  console.log('Registering expenses handlers...');
  registerExpensesHandlers(services);
  console.log('Registering shifts handlers...');
  registerShiftsHandlers(services);
  console.log('Registering reports handlers...');
  registerReportsHandlers(services);
  console.log('Registering dashboard handlers...');
  registerDashboardHandlers(services);
  console.log('Registering settings handlers...');
  registerSettingsHandlers(services);
  console.log('Registering exchange rates handlers...');
  registerExchangeRatesHandlers(services);
  console.log('Registering auth handlers...');
  registerAuthHandlers(services, db);
  console.log('Registering users handlers...');
  registerUsersHandlers(services);
  console.log('Registering orders handlers...');
  registerOrdersHandlers(services);

  console.log('Registering files handlers...');
  registerFilesHandlers();
  console.log('Registering print handlers...');
  registerPrintHandlers(services);
  console.log('Registering quotes handlers...');
  registerQuotesHandlers(services);
  console.log('Registering promotions handlers...');
  registerPromotionsHandlers(services);

  // Health check endpoint
  ipcMain.handle('pos:health', async () => {
    try {
      const { isOpen } = require('../db/open.cjs');
      return { success: true, dbOpen: isOpen() };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Debug endpoint: Get DB table counts
  ipcMain.handle('pos:debug:tableCounts', async () => {
    try {
      const db = require('../db/open.cjs').getDb();
      const counts = {
        products: db.prepare('SELECT COUNT(*) as count FROM products').get().count,
        categories: db.prepare('SELECT COUNT(*) as count FROM categories').get().count,
        suppliers: db.prepare('SELECT COUNT(*) as count FROM suppliers').get().count,
        customers: db.prepare('SELECT COUNT(*) as count FROM customers').get().count,
        inventory_movements: db.prepare('SELECT COUNT(*) as count FROM inventory_movements').get().count,
        warehouses: db.prepare('SELECT COUNT(*) as count FROM warehouses').get().count,
        active_products: db.prepare('SELECT COUNT(*) as count FROM products WHERE is_active = 1').get().count,
      };
      console.log('[DEBUG] Table counts:', counts);
      return { success: true, counts };
    } catch (error) {
      console.error('[DEBUG] Error getting table counts:', error);
      return { success: false, error: error.message };
    }
  });

  // Data-only wipe endpoint - Preserves main warehouse and admin user
  ipcMain.handle('pos:database:wipeDataOnly', wrapHandler(async (event) => {
    console.log('🗑️  [IPC] pos:database:wipeDataOnly called - DATA-ONLY WIPE');
    try {
      if (!services || !services.database) {
        throw new Error('Database service not available');
      }
      
      const result = await services.database.wipeDataOnly();
      console.log('✅ [IPC] Data-only wipe completed:', result);
      
      // Emit cache invalidation event to all windows
      const { BrowserWindow } = require('electron');
      BrowserWindow.getAllWindows().forEach(win => {
        win.webContents.send('cache:invalidate', { type: 'all' });
        win.webContents.send('database:wipe:complete');
      });
      
      // Also emit to main process for window reload
      ipcMain.emit('database:wipe:complete');
      
      return result;
    } catch (error) {
      console.error('❌ [IPC] Data-only wipe error:', error);
      console.error('❌ [IPC] Error details:', {
        message: error.message,
        code: error.code,
        stack: error.stack,
      });
      throw error;
    }
  }));

  // Database wipe endpoint - DESTRUCTIVE OPERATION
  ipcMain.handle('pos:database:wipeAllData', wrapHandler(async (event) => {
    console.log('🗑️  [IPC] pos:database:wipeAllData called - DESTRUCTIVE OPERATION');
    try {
      if (!services || !services.database) {
        throw new Error('Database service not available');
      }
      
      const result = await services.database.wipeAllData();
      console.log('✅ [IPC] Database wipe completed:', result);
      
      // Emit cache invalidation event to all windows
      const { BrowserWindow } = require('electron');
      BrowserWindow.getAllWindows().forEach(win => {
        win.webContents.send('cache:invalidate', { type: 'all' });
        win.webContents.send('database:wipe:complete');
      });
      
      // Also emit to main process for window reload
      ipcMain.emit('database:wipe:complete');
      
      return result;
    } catch (error) {
      console.error('❌ [IPC] Database wipe error:', error);
      console.error('❌ [IPC] Error details:', {
        message: error.message,
        code: error.code,
        stack: error.stack,
      });
      throw error;
    }
  }));

  handlersRegistered = true;
  console.log('IPC handlers registration completed');
}

function getServices() {
  return services;
}

function getDbInstance() {
  return dbInstance;
}

module.exports = {
  registerAllHandlers,
  getServices,
  getDbInstance,
};


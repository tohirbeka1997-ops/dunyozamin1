const { contextBridge, ipcRenderer } = require('electron');

/**
 * Safe IPC wrapper: returns a consistent Response<T> shape.
 * Response<T> =
 *   | { success: true, data: T }
 *   | { success: false, error: { code: string, message: string, details?: any } }
 */
async function invoke(channel, ...args) {
  try {
    const result = await ipcRenderer.invoke(channel, ...args);
    // wrapHandler already returns { success: false, error } for IPC errors —
    // pass it through as-is so handleIpcResponse can detect and throw properly.
    if (result && typeof result === 'object' && result.success === false && result.error) {
      return result;
    }
    return { success: true, data: result };
  } catch (error) {
    // `wrapHandler` in main process throws structured objects, preserve them if present.
    if (error && typeof error === 'object' && 'code' in error && 'message' in error) {
      return { success: false, error };
    }
    return {
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: error?.message || String(error),
        details: error?.stack || null,
      },
    };
  }
}

// Forward renderer errors to main process log file
function sendRendererLog(payload) {
  try {
    ipcRenderer.send('pos:renderer:log', payload);
  } catch (_e) {
    // ignore
  }
}

try {
  window.addEventListener('error', (event) => {
    sendRendererLog({
      type: 'error',
      message: event?.message,
      filename: event?.filename,
      lineno: event?.lineno,
      colno: event?.colno,
      stack: event?.error?.stack,
      time: new Date().toISOString(),
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    sendRendererLog({
      type: 'unhandledrejection',
      reason: event?.reason?.message || String(event?.reason),
      stack: event?.reason?.stack,
      time: new Date().toISOString(),
    });
  });
} catch (_e) {
  // ignore
}

// Expose `window.posApi` (contract documented in electron/ipc/WINDOW_API_SHAPE.md)
contextBridge.exposeInMainWorld('posApi', {
  // App-local config (HOST/CLIENT) stored in userData/pos-config.json
  appConfig: {
    get: () => invoke('pos:appConfig:get'),
    set: (patch) => invoke('pos:appConfig:set', patch),
    reset: () => invoke('pos:appConfig:reset'),
  },

  // Products
  products: {
    list: (filters) => invoke('pos:products:list', filters),
    searchScreen: (filters) => invoke('pos:products:searchScreen', filters),
    count: (filters) => invoke('pos:products:count', filters),
    get: (id) => invoke('pos:products:get', id),
    getBySku: (sku) => invoke('pos:products:getBySku', sku),
    getByBarcode: (barcode) => invoke('pos:products:getByBarcode', barcode),
    getNextSku: () => invoke('pos:products:getNextSku'),
    getNextBarcode: () => invoke('pos:products:getNextBarcode'),
    getNextBarcodeForUnit: (unit) => invoke('pos:products:getNextBarcodeForUnit', unit),
    create: (data) => invoke('pos:products:create', data),
    update: (id, data) => invoke('pos:products:update', id, data),
    delete: (id) => invoke('pos:products:delete', id),
    exportScaleRongtaTxt: (opts) => invoke('pos:products:exportScaleRongtaTxt', opts),
    exportScaleSharqTxt: (opts) => invoke('pos:products:exportScaleSharqTxt', opts),
    exportScaleCsv3: (opts) => invoke('pos:products:exportScaleCsv3', opts),
    exportScaleLegacyTxt: (opts) => invoke('pos:products:exportScaleLegacyTxt', opts),
    getImages: (productId) => invoke('pos:products:getImages', productId),
    addImage: (productId, url, sortOrder, isPrimary) =>
      invoke('pos:products:addImage', productId, url, sortOrder, isPrimary),
    removeImage: (imageId, productId) => invoke('pos:products:removeImage', imageId, productId),
    setImages: (productId, images) => invoke('pos:products:setImages', productId, images),
  },

  // Categories
  categories: {
    list: (filters) => invoke('pos:categories:list', filters),
    get: (id) => invoke('pos:categories:get', id),
    create: (data) => invoke('pos:categories:create', data),
    update: (id, data) => invoke('pos:categories:update', id, data),
    delete: (id) => invoke('pos:categories:delete', id),
  },

  // Warehouses
  warehouses: {
    list: (filters) => invoke('pos:warehouses:list', filters),
    get: (id) => invoke('pos:warehouses:get', id),
    create: (data) => invoke('pos:warehouses:create', data),
    update: (id, data) => invoke('pos:warehouses:update', id, data),
    delete: (id) => invoke('pos:warehouses:delete', id),
  },

  // Customers
  customers: {
    list: (filters) => invoke('pos:customers:list', filters),
    get: (id) => invoke('pos:customers:get', id),
    create: (data) => invoke('pos:customers:create', data),
    update: (id, data) => invoke('pos:customers:update', id, data),
    delete: (id) => invoke('pos:customers:delete', id),
    updateBalance: (customerId, amount, type) => invoke('pos:customers:updateBalance', customerId, amount, type),
    receivePayment: (payload) => invoke('pos:customers:receivePayment', payload),
    getPayments: (customerId, filters) => invoke('pos:customers:getPayments', customerId, filters),
    getLedger: (customerId, filters) => invoke('pos:customers:getLedger', customerId, filters),
    getLedgerCount: (payload) => invoke('pos:customers:getLedgerCount', payload),
    exportCsv: (filters) => invoke('pos:customers:exportCsv', filters),
    getBonusLedger: (customerId, filters) => invoke('pos:customers:getBonusLedger', customerId, filters),
    adjustBonusPoints: (payload) => invoke('pos:customers:adjustBonusPoints', payload),
  },

  // Suppliers
  suppliers: {
    list: (filters) => invoke('pos:suppliers:list', filters),
    get: (id) => invoke('pos:suppliers:get', id),
    create: (data) => invoke('pos:suppliers:create', data),
    update: (id, data) => invoke('pos:suppliers:update', id, data),
    delete: (id) => invoke('pos:suppliers:delete', id),
    getLedger: (supplierId, filters) => invoke('pos:suppliers:getLedger', supplierId, filters),
    createPayment: (payload) => invoke('pos:suppliers:createPayment', payload),
    deletePayment: (paymentId) => invoke('pos:suppliers:deletePayment', paymentId),
    getPayments: (supplierId, filters) => invoke('pos:suppliers:getPayments', supplierId, filters),
    getPurchaseSummary: (supplierId, filters) => invoke('pos:suppliers:getPurchaseSummary', supplierId, filters),
    // Supplier Returns (credit notes)
    createReturn: (payload) => invoke('pos:suppliers:createReturn', payload),
    getReturn: (id) => invoke('pos:suppliers:getReturn', id),
    listReturns: (filters) => invoke('pos:suppliers:listReturns', filters),
  },

  // Pricing
  pricing: {
    getTiers: () => invoke('pos:pricing:getTiers'),
    getPrice: (payload) => invoke('pos:pricing:getPrice', payload),
    setPrice: (payload) => invoke('pos:pricing:setPrice', payload),
  },

  // Promotions (Aksiya)
  promotions: {
    list: (filters) => invoke('pos:promotions:list', filters),
    get: (id) => invoke('pos:promotions:get', id),
    create: (data) => invoke('pos:promotions:create', data),
    update: (id, data) => invoke('pos:promotions:update', id, data),
    delete: (id) => invoke('pos:promotions:delete', id),
    activate: (id, userId) => invoke('pos:promotions:activate', id, userId),
    pause: (id, userId) => invoke('pos:promotions:pause', id, userId),
    applyToCart: (cartItems, customerId, promoCode) => invoke('pos:promotions:applyToCart', cartItems, customerId, promoCode),
  },

  // Inventory
  inventory: {
    getBalances: (filters) => invoke('pos:inventory:getBalances', filters),
    getMoves: (filters) => invoke('pos:inventory:getMoves', filters),
    getProductLedger: (filters) => invoke('pos:inventory:getProductLedger', filters),
    adjustStock: (data) => invoke('pos:inventory:adjustStock', data),
    getProductPurchaseHistory: (productId) => invoke('pos:inventory:getProductPurchaseHistory', productId),
    getProductSalesHistory: (productId) => invoke('pos:inventory:getProductSalesHistory', productId),
    getProductDetail: (productId) => invoke('pos:inventory:getProductDetail', productId),
    getCurrentStock: (productId, warehouseId) => invoke('pos:inventory:getCurrentStock', productId, warehouseId),
    // Advanced analytics
    getDeadStock: (payload) => invoke('pos:inventory:getDeadStock', payload),
    getStockTurnover: (payload) => invoke('pos:inventory:getStockTurnover', payload),
    getReorderSuggestions: () => invoke('pos:inventory:getReorderSuggestions'),
    // Batch mode (partiya)
    getBatchesByProduct: (productId, warehouseId) => invoke('pos:inventory:getBatchesByProduct', productId, warehouseId),
    getBatchReconcile: (productId, warehouseId) => invoke('pos:inventory:getBatchReconcile', productId, warehouseId),
    runBatchCutoverSnapshot: (payload) => invoke('pos:inventory:runBatchCutoverSnapshot', payload),
  },

  // Sales
  sales: {
    createDraftOrder: (data) => invoke('pos:sales:createDraftOrder', data),
    addItem: (orderId, itemData) => invoke('pos:sales:addItem', orderId, itemData),
    removeItem: (orderId, itemId) => invoke('pos:sales:removeItem', orderId, itemId),
    updateItemQuantity: (orderId, itemId, quantity) =>
      invoke('pos:sales:updateItemQuantity', orderId, itemId, quantity),
    setCustomer: (orderId, customerId) => invoke('pos:sales:setCustomer', orderId, customerId),
    finalizeOrder: (orderId, paymentData) => invoke('pos:sales:finalizeOrder', orderId, paymentData),
    getOrder: (orderId) => invoke('pos:sales:getOrder', orderId),
    completePOSOrder: (orderData, itemsData, paymentsData) =>
      invoke('pos:sales:completePOSOrder', orderData, itemsData, paymentsData),
    refund: (orderId, reason, itemsToReturn) => invoke('pos:sales:refund', orderId, reason, itemsToReturn),
    list: (filters) => invoke('pos:sales:list', filters),
  },

  // Returns
  returns: {
    create: (data) => invoke('pos:returns:create', data),
    get: (id) => invoke('pos:returns:get', id),
    list: (filters) => invoke('pos:returns:list', filters),
    getOrderDetails: (orderId) => invoke('pos:returns:getOrderDetails', orderId),
    update: (returnId, payload) => invoke('pos:returns:update', returnId, payload),
  },

  // Purchases
  purchases: {
    createOrder: (data) => invoke('pos:purchases:createOrder', data),
    updateOrder: (purchaseOrderId, data, items) => invoke('pos:purchases:updateOrder', purchaseOrderId, data, items),
    approve: (purchaseOrderId, approvedBy) => invoke('pos:purchases:approve', purchaseOrderId, approvedBy),
    receiveGoods: (purchaseOrderId, receiptData) => invoke('pos:purchases:receiveGoods', purchaseOrderId, receiptData),
    createReceipt: (payload) => invoke('pos:purchases:createReceipt', payload),
    deleteOrder: (purchaseOrderId) => invoke('pos:purchases:deleteOrder', purchaseOrderId),
    get: (id) => invoke('pos:purchases:get', id),
    list: (filters) => invoke('pos:purchases:list', filters),
    // Landed cost / PO expenses
    listExpenses: (purchaseOrderId) => invoke('pos:purchases:listExpenses', purchaseOrderId),
    addExpense: (purchaseOrderId, payload) => invoke('pos:purchases:addExpense', purchaseOrderId, payload),
    deleteExpense: (purchaseOrderId, expenseId) => invoke('pos:purchases:deleteExpense', purchaseOrderId, expenseId),
  },

  // Expenses
  expenses: {
    listCategories: (filters) => invoke('pos:expenses:listCategories', filters),
    createCategory: (data) => invoke('pos:expenses:createCategory', data),
    updateCategory: (id, data) => invoke('pos:expenses:updateCategory', id, data),
    deleteCategory: (id) => invoke('pos:expenses:deleteCategory', id),
    list: (filters) => invoke('pos:expenses:list', filters),
    create: (data) => invoke('pos:expenses:create', data),
    update: (id, data) => invoke('pos:expenses:update', id, data),
    delete: (id) => invoke('pos:expenses:delete', id),
  },

  // Shifts
  shifts: {
    open: (data) => invoke('pos:shifts:open', data),
    close: (shiftId, data) => invoke('pos:shifts:close', shiftId, data),
    get: (id) => invoke('pos:shifts:get', id),
    // Extra shift helpers used by UI
    getActive: (userId) => invoke('pos:shifts:getActive', userId),
    getCurrent: (cashierId) => invoke('pos:shifts:getCurrent', cashierId),
    getSummary: ({ shiftId }) => invoke('pos:shifts:getSummary', { shiftId }),
    getStatus: (userId, warehouseId) => invoke('pos:shifts:getStatus', userId, warehouseId),
    require: (userId, warehouseId) => invoke('pos:shifts:require', userId, warehouseId),
    list: (filters) => invoke('pos:shifts:list', filters),
  },

  // Reports
  reports: {
    // Existing reports
    dailySales: (date, warehouseId) => invoke('pos:reports:dailySales', date, warehouseId),
    dailySalesSQL: (filters) => invoke('pos:reports:dailySalesSQL', filters),
    topProducts: (filters) => invoke('pos:reports:topProducts', filters),
    productSales: (filters) => invoke('pos:reports:productSales', filters),
    promotionUsage: (filters) => invoke('pos:reports:promotionUsage', filters),
    stock: (warehouseId) => invoke('pos:reports:stock', warehouseId),
    returns: (filters) => invoke('pos:reports:returns', filters),
    profit: (filters) => invoke('pos:reports:profit', filters),
    profitAndLossSQL: (filters) => invoke('pos:reports:profitAndLossSQL', filters),
    inventoryValuation: (filters) => invoke('pos:reports:inventoryValuation', filters),
    inventoryValuationSummary: (filters) => invoke('pos:reports:inventoryValuationSummary', filters),
    batchReconciliation: (filters) => invoke('pos:reports:batchReconciliation', filters),
    actSverka: (filters) => invoke('pos:reports:actSverka', filters),
    customerActSverka: (filters) => invoke('pos:reports:customerActSverka', filters),
    supplierActSverka: (filters) => invoke('pos:reports:supplierActSverka', filters),
    productTraceability: (filters) => invoke('pos:reports:productTraceability', filters),
    supplierProductSales: (filters) => invoke('pos:reports:supplierProductSales', filters),
    
    // Financial Reports
    cashFlow: (filters) => invoke('pos:reports:cashFlow', filters),
    cashDiscrepancies: (filters) => invoke('pos:reports:cashDiscrepancies', filters),
    aging: (filters) => invoke('pos:reports:aging', filters),
    customerAging: () => invoke('pos:reports:customerAging'),
    supplierAging: () => invoke('pos:reports:supplierAging'),
    
    // CRM Reports
    vipCustomers: (filters) => invoke('pos:reports:vipCustomers', filters),
    loyaltyPointsSummary: (filters) => invoke('pos:reports:loyaltyPointsSummary', filters),
    lostCustomers: (filters) => invoke('pos:reports:lostCustomers', filters),
    customerProfitability: (filters) => invoke('pos:reports:customerProfitability', filters),
    
    // Supplier/Purchase Advanced Reports
    deliveryAccuracy: (filters) => invoke('pos:reports:deliveryAccuracy', filters),
    deliveryDetails: (filters) => invoke('pos:reports:deliveryDetails', filters),
    priceHistory: (filters) => invoke('pos:reports:priceHistory', filters),
    productPriceSummary: (filters) => invoke('pos:reports:productPriceSummary', filters),
    purchasePlanning: (filters) => invoke('pos:reports:purchasePlanning', filters),
    purchaseSaleSpread: (filters) => invoke('pos:reports:purchaseSaleSpread', filters),
    spreadTimeSeries: (filters) => invoke('pos:reports:spreadTimeSeries', filters),

    latestPurchaseCosts: () => invoke('pos:reports:getLatestPurchaseCosts'),
    
    // Employee/Operations Reports
    cashierErrors: (filters) => invoke('pos:reports:cashierErrors', filters),
    cashierErrorDetails: (filters) => invoke('pos:reports:cashierErrorDetails', filters),
    shiftProductivity: (filters) => invoke('pos:reports:shiftProductivity', filters),
    productivitySummary: (filters) => invoke('pos:reports:productivitySummary', filters),
    fraudSignals: (filters) => invoke('pos:reports:fraudSignals', filters),
    fraudIncidents: (filters) => invoke('pos:reports:fraudIncidents', filters),
    
    // System & Technical Reports
    deviceHealth: () => invoke('pos:reports:deviceHealth'),
    deviceIncidents: () => invoke('pos:reports:deviceIncidents'),
    auditLog: (filters) => invoke('pos:reports:auditLog', filters),
    priceChangeHistory: (filters) => invoke('pos:reports:priceChangeHistory', filters),
    
    // Executive Dashboard
    executiveKPI: (filters) => invoke('pos:reports:executiveKPI', filters),
    executiveTrends: (filters) => invoke('pos:reports:executiveTrends', filters),
  },

  // Dashboard
  dashboard: {
    getStats: (filters) => invoke('pos:dashboard:getStats', filters),
    getAnalytics: (filters) => invoke('pos:dashboard:getAnalytics', filters),
    getLowStock: (filters) => invoke('pos:dashboard:getLowStock', filters),
  },

  // Settings
  settings: {
    get: (key) => invoke('pos:settings:get', key),
    set: (key, value, type, updatedBy) => invoke('pos:settings:set', key, value, type, updatedBy),
    getAll: (filters) => invoke('pos:settings:getAll', filters),
    delete: (key) => invoke('pos:settings:delete', key),
    resetDatabase: (payload) => invoke('pos:settings:resetDatabase', payload),
  },

  // Exchange Rates
  exchangeRates: {
    getLatest: (filters) => invoke('pos:exchangeRates:getLatest', filters),
    list: (filters) => invoke('pos:exchangeRates:list', filters),
    upsert: (payload) => invoke('pos:exchangeRates:upsert', payload),
  },

  // Auth
  auth: {
    login: (username, password) => invoke('pos:auth:login', username, password),
    logout: () => invoke('pos:auth:logout'),
    me: () => invoke('pos:auth:me'),
    getUser: (userId) => invoke('pos:auth:getUser', userId),
    checkPermission: (userId, permission) => invoke('pos:auth:checkPermission', userId, permission),
    requestPasswordReset: (identifier) => invoke('pos:auth:requestPasswordReset', identifier),
    confirmPasswordReset: (payload) => invoke('pos:auth:confirmPasswordReset', payload),
  },

  // Users
  users: {
    list: (filters) => invoke('pos:users:list', filters),
    get: (id) => invoke('pos:users:get', id),
    create: (data) => invoke('pos:users:create', data),
    update: (id, data) => invoke('pos:users:update', id, data),
    delete: (id) => invoke('pos:users:delete', id),
    resetPassword: (userId, newPassword) => invoke('pos:users:resetPassword', userId, newPassword),
  },

  // Quotes (Smeta / Estimate)
  quotes: {
    list: (filters) => invoke('pos:quotes:list', filters),
    get: (id) => invoke('pos:quotes:get', id),
    create: (data) => invoke('pos:quotes:create', data),
    update: (id, data) => invoke('pos:quotes:update', id, data),
    delete: (id) => invoke('pos:quotes:delete', id),
    generateNumber: () => invoke('pos:quotes:generateNumber'),
    convertToSale: (quoteId, orderData) => invoke('pos:quotes:convertToSale', quoteId, orderData),
  },

  // Orders
  orders: {
    list: (filters) => invoke('pos:orders:list', filters),
    get: (id) => invoke('pos:orders:get', id),
    getByNumber: (orderNumber) => invoke('pos:orders:getByNumber', orderNumber),
    getByCustomer: (customerId) => invoke('pos:orders:getByCustomer', customerId),
    cancel: (id) => invoke('pos:orders:cancel', id),
  },

  webOrders: {
    list: (filters) => invoke('pos:webOrders:list', filters),
    get: (id) => invoke('pos:webOrders:get', id),
    updateStatus: (id, status) => invoke('pos:webOrders:updateStatus', id, status),
  },

  // Files (export/backups/import)
  files: {
    selectSavePath: (defaultName) => invoke('pos:files:selectSavePath', defaultName),
    writeFile: (filePath, data, encoding) => invoke('pos:files:writeFile', filePath, data, encoding),
    readFile: (filePath, encoding) => invoke('pos:files:readFile', filePath, encoding),
    exists: (filePath) => invoke('pos:files:exists', filePath),
    saveTextFile: (opts) => invoke('pos:files:saveTextFile', opts),
    openTextFile: (opts) => invoke('pos:files:openTextFile', opts),
    selectImageFile: () => invoke('pos:files:selectImageFile'),
    saveProductImage: (sourcePath, productIdOrTempId, index) =>
      invoke('pos:files:saveProductImage', sourcePath, productIdOrTempId, index),
    pathToFileUrl: (filePath) => invoke('pos:files:pathToFileUrl', filePath),
  },

  // Printing (ESC/POS)
  print: {
    receipt: (payload) => invoke('pos:print:receipt', payload),
  },

  // Health
  health: () => invoke('pos:health'),

  // Debug helpers (dev only)
  debug: {
    tableCounts: () => invoke('pos:debug:tableCounts'),
  },
});


/**
 * Canonical list of POS IPC channels that can be forwarded in CLIENT mode.
 *
 * Notes:
 * - We intentionally DO NOT include:
 *   - pos:files:* (should run on the local CLIENT machine for OS dialogs)
 *   - pos:appConfig:* (local config stored in userData)
 */
module.exports = {
  POS_CHANNELS: [
    // Products
    'pos:products:list',
    'pos:products:searchScreen',
    'pos:products:get',
    'pos:products:getBySku',
    'pos:products:getByBarcode',
    'pos:products:getNextSku',
    'pos:products:getNextBarcode',
    'pos:products:getNextBarcodeForUnit',
    'pos:products:create',
    'pos:products:update',
    'pos:products:delete',
    // Scale exports (forwardable in CLIENT mode; file save stays local via pos:files:*)
    'pos:products:exportScaleRongtaTxt',
    'pos:products:exportScaleSharqTxt',
    'pos:products:exportScaleCsv3',
    'pos:products:exportScaleLegacyTxt',

    // Pricing
    'pos:pricing:getTiers',
    'pos:pricing:getPrice',
    'pos:pricing:setPrice',

    // Categories
    'pos:categories:list',
    'pos:categories:get',
    'pos:categories:create',
    'pos:categories:update',
    'pos:categories:delete',

    // Warehouses
    'pos:warehouses:list',
    'pos:warehouses:get',
    'pos:warehouses:create',
    'pos:warehouses:update',
    'pos:warehouses:delete',

    // Customers
    'pos:customers:list',
    'pos:customers:get',
    'pos:customers:create',
    'pos:customers:update',
    'pos:customers:delete',
    'pos:customers:updateBalance',
    'pos:customers:receivePayment',
    'pos:customers:getPayments',
    'pos:customers:getLedger',
    'pos:customers:getLedgerCount',
    'pos:customers:exportCsv',
    'pos:customers:getBonusLedger',
    'pos:customers:adjustBonusPoints',

    // Suppliers
    'pos:suppliers:list',
    'pos:suppliers:get',
    'pos:suppliers:create',
    'pos:suppliers:update',
    'pos:suppliers:delete',
    'pos:suppliers:getLedger',
    'pos:suppliers:createPayment',
    'pos:suppliers:deletePayment',
    'pos:suppliers:getPayments',
    'pos:suppliers:getPurchaseSummary',
    'pos:suppliers:createReturn',
    'pos:suppliers:getReturn',
    'pos:suppliers:listReturns',

    // Inventory
    'pos:inventory:getBalances',
    'pos:inventory:getMoves',
    'pos:inventory:getProductLedger',
    'pos:inventory:adjustStock',
    'pos:inventory:getProductPurchaseHistory',
    'pos:inventory:getProductSalesHistory',
    'pos:inventory:getProductDetail',
    'pos:inventory:getCurrentStock',
    'pos:inventory:getBatchesByProduct',
    'pos:inventory:getBatchReconcile',
    'pos:inventory:runBatchCutoverSnapshot',

    // Sales
    'pos:sales:createDraftOrder',
    'pos:sales:addItem',
    'pos:sales:removeItem',
    'pos:sales:updateItemQuantity',
    'pos:sales:setCustomer',
    'pos:sales:finalizeOrder',
    'pos:sales:getOrder',
    'pos:sales:completePOSOrder',
    'pos:sales:list',
    'pos:sales:get',
    'pos:sales:refund',

    // Returns
    'pos:returns:create',
    'pos:returns:get',
    'pos:returns:list',
    'pos:returns:getOrderDetails',
    'pos:returns:update',

    // Purchases
    'pos:purchases:list',
    'pos:purchases:get',
    'pos:purchases:createOrder',
    'pos:purchases:updateOrder',
    'pos:purchases:approve',
    'pos:purchases:receiveGoods',
    'pos:purchases:createReceipt',
    'pos:purchases:deleteOrder',
    'pos:purchases:listExpenses',
    'pos:purchases:addExpense',
    'pos:purchases:deleteExpense',

    // Expenses
    'pos:expenses:listCategories',
    'pos:expenses:createCategory',
    'pos:expenses:updateCategory',
    'pos:expenses:deleteCategory',
    'pos:expenses:list',
    'pos:expenses:create',
    'pos:expenses:update',
    'pos:expenses:delete',

    // Shifts
    'pos:shifts:open',
    'pos:shifts:close',
    'pos:shifts:get',
    'pos:shifts:getActive',
    'pos:shifts:getCurrent',
    'pos:shifts:getStatus',
    'pos:shifts:require',
    'pos:shifts:list',
    'pos:shifts:getSummary',

    // Reports
    'pos:reports:dailySales',
    'pos:reports:dailySalesSQL',
    'pos:reports:topProducts',
    'pos:reports:productSales',
    'pos:reports:stock',
    'pos:reports:returns',
    'pos:reports:profit',
    'pos:reports:profitAndLossSQL',
    'pos:reports:inventoryValuation',
    'pos:reports:inventoryValuationSummary',
    'pos:reports:batchReconciliation',
    'pos:reports:actSverka',
    'pos:reports:customerActSverka',
    'pos:reports:supplierActSverka',
    'pos:reports:productTraceability',
    'pos:reports:purchasePlanning',
    'pos:reports:getLatestPurchaseCosts',

    // Dashboard
    'pos:dashboard:getStats',
    'pos:dashboard:getAnalytics',

    // Settings (DB-backed)
    'pos:settings:get',
    'pos:settings:set',
    'pos:settings:getAll',
    'pos:settings:delete',
    'pos:settings:resetDatabase',

    // Exchange Rates
    'pos:exchangeRates:getLatest',
    'pos:exchangeRates:list',
    'pos:exchangeRates:upsert',

    // Auth
    'pos:auth:login',
    'pos:auth:logout',
    'pos:auth:me',
    'pos:auth:getUser',
    'pos:auth:checkPermission',
    'pos:auth:requestPasswordReset',
    'pos:auth:confirmPasswordReset',

    // Orders
    'pos:orders:list',
    'pos:orders:get',

    // Users
    'pos:users:list',
    'pos:users:get',
    'pos:users:create',
    'pos:users:update',
    'pos:users:delete',

    // Print
    'pos:print:receipt',

    // System / Debug
    'pos:health',
    'pos:debug:tableCounts',
    'pos:database:wipeDataOnly',
    'pos:database:wipeAllData',
  ],
};




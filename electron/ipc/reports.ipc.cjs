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
 * Reports IPC Handlers
 * Channels: pos:reports:*
 */
function registerReportsHandlers(services) {
  if (!services) {
    throw new Error('Services object is required for registerReportsHandlers');
  }

  const { reports } = services;
  if (!reports) {
    throw new Error('Reports service is not available in services object');
  }

  console.log('Registering pos:reports:dailySales handler...');
  ipcMain.removeHandler('pos:reports:dailySales');
  ipcMain.handle(
    'pos:reports:dailySales',
    wrapHandler(async (_event, date, warehouseId) => {
      return reports.getDailySales(date, warehouseId);
    })
  );

  console.log('Registering pos:reports:topProducts handler...');
  ipcMain.removeHandler('pos:reports:topProducts');
  ipcMain.handle(
    'pos:reports:topProducts',
    wrapHandler(async (_event, filters) => {
      return reports.getTopProducts(filters || {});
    })
  );

  console.log('Registering pos:reports:promotionUsage handler...');
  ipcMain.removeHandler('pos:reports:promotionUsage');
  ipcMain.handle(
    'pos:reports:promotionUsage',
    wrapHandler(async (_event, filters) => {
      return reports.getPromotionUsageReport(filters || {});
    })
  );

  console.log('Registering pos:reports:productSales handler...');
  ipcMain.removeHandler('pos:reports:productSales');
  ipcMain.handle(
    'pos:reports:productSales',
    wrapHandler(async (_event, filters) => {
      return reports.getProductSalesReport(filters || {});
    })
  );

  console.log('Registering pos:reports:stock handler...');
  ipcMain.removeHandler('pos:reports:stock');
  ipcMain.handle(
    'pos:reports:stock',
    wrapHandler(async (_event, warehouseId) => {
      return reports.getStockReport(warehouseId);
    })
  );

  console.log('Registering pos:reports:returns handler...');
  ipcMain.removeHandler('pos:reports:returns');
  ipcMain.handle(
    'pos:reports:returns',
    wrapHandler(async (_event, filters) => {
      return reports.getReturnsReport(filters || {});
    })
  );

  console.log('Registering pos:reports:profit handler...');
  ipcMain.removeHandler('pos:reports:profit');
  ipcMain.handle(
    'pos:reports:profit',
    wrapHandler(async (_event, filters) => {
      return reports.getProfitEstimate(filters || {});
    })
  );

  console.log('Registering pos:reports:profitAndLossSQL handler...');
  ipcMain.removeHandler('pos:reports:profitAndLossSQL');
  ipcMain.handle(
    'pos:reports:profitAndLossSQL',
    wrapHandler(async (_event, filters) => {
      return reports.getProfitAndLossSQL(filters || {});
    })
  );

  console.log('Registering pos:reports:dailySalesSQL handler...');
  ipcMain.removeHandler('pos:reports:dailySalesSQL');
  ipcMain.handle(
    'pos:reports:dailySalesSQL',
    wrapHandler(async (_event, filters) => {
      return reports.getDailySalesReportSQL(filters || {});
    })
  );

  console.log('Registering pos:reports:inventoryValuation handler...');
  ipcMain.removeHandler('pos:reports:inventoryValuation');
  ipcMain.handle(
    'pos:reports:inventoryValuation',
    wrapHandler(async (_event, filters) => {
      return reports.getInventoryValuationReport(filters || {});
    })
  );

  console.log('Registering pos:reports:inventoryValuationSummary handler...');
  ipcMain.removeHandler('pos:reports:inventoryValuationSummary');
  ipcMain.handle(
    'pos:reports:inventoryValuationSummary',
    wrapHandler(async (_event, filters) => {
      return reports.getInventoryValuationSummary(filters || {});
    })
  );

  console.log('Registering pos:reports:batchReconciliation handler...');
  ipcMain.removeHandler('pos:reports:batchReconciliation');
  ipcMain.handle(
    'pos:reports:batchReconciliation',
    wrapHandler(async (_event, filters) => {
      return reports.getBatchReconciliation(filters || {});
    })
  );

  console.log('Registering pos:reports:actSverka handler...');
  ipcMain.removeHandler('pos:reports:actSverka');
  ipcMain.handle(
    'pos:reports:actSverka',
    wrapHandler(async (_event, filters) => {
      return reports.getActSverka(filters || {});
    })
  );

  console.log('Registering pos:reports:customerActSverka handler...');
  ipcMain.removeHandler('pos:reports:customerActSverka');
  ipcMain.handle(
    'pos:reports:customerActSverka',
    wrapHandler(async (_event, filters) => {
      return reports.getCustomerActSverka(filters || {});
    })
  );

  console.log('Registering pos:reports:supplierActSverka handler...');
  ipcMain.removeHandler('pos:reports:supplierActSverka');
  ipcMain.handle(
    'pos:reports:supplierActSverka',
    wrapHandler(async (_event, filters) => {
      return reports.getSupplierActSverka(filters || {});
    })
  );

  console.log('Registering pos:reports:productTraceability handler...');
  ipcMain.removeHandler('pos:reports:productTraceability');
  ipcMain.handle(
    'pos:reports:productTraceability',
    wrapHandler(async (_event, filters) => {
      return reports.getProductTraceability(filters || {});
    })
  );

  console.log('Registering pos:reports:supplierProductSales handler...');
  ipcMain.removeHandler('pos:reports:supplierProductSales');
  ipcMain.handle(
    'pos:reports:supplierProductSales',
    wrapHandler(async (_event, filters) => {
      return reports.getSupplierProductSales(filters || {});
    })
  );

  console.log('Registering pos:reports:cashFlow handler...');
  ipcMain.removeHandler('pos:reports:cashFlow');
  ipcMain.handle(
    'pos:reports:cashFlow',
    wrapHandler(async (_event, filters) => {
      return reports.getCashFlow(filters || {});
    })
  );

  console.log('Registering pos:reports:cashDiscrepancies handler...');
  ipcMain.removeHandler('pos:reports:cashDiscrepancies');
  ipcMain.handle(
    'pos:reports:cashDiscrepancies',
    wrapHandler(async (_event, filters) => {
      return reports.getCashDiscrepancies(filters || {});
    })
  );

  console.log('Registering pos:reports:aging handler...');
  ipcMain.removeHandler('pos:reports:aging');
  ipcMain.handle(
    'pos:reports:aging',
    wrapHandler(async (_event, filters) => {
      return reports.getAging(filters || {});
    })
  );

  console.log('Registering pos:reports:getLatestPurchaseCosts handler...');
  ipcMain.removeHandler('pos:reports:getLatestPurchaseCosts');
  ipcMain.handle(
    'pos:reports:getLatestPurchaseCosts',
    wrapHandler(async () => {
      return reports.getLatestPurchaseCosts();
    })
  );

  // Customer Aging & Supplier Aging
  console.log('Registering pos:reports:customerAging handler...');
  ipcMain.removeHandler('pos:reports:customerAging');
  ipcMain.handle(
    'pos:reports:customerAging',
    wrapHandler(async (_event) => {
      return reports.getCustomerAging();
    })
  );

  console.log('Registering pos:reports:supplierAging handler...');
  ipcMain.removeHandler('pos:reports:supplierAging');
  ipcMain.handle(
    'pos:reports:supplierAging',
    wrapHandler(async (_event) => {
      return reports.getSupplierAging();
    })
  );

  // CRM Reports
  console.log('Registering pos:reports:vipCustomers handler...');
  ipcMain.removeHandler('pos:reports:vipCustomers');
  ipcMain.handle(
    'pos:reports:vipCustomers',
    wrapHandler(async (_event, filters) => {
      return reports.getVIPCustomers(filters || {});
    })
  );

  ipcMain.removeHandler('pos:reports:loyaltyPointsSummary');
  ipcMain.handle(
    'pos:reports:loyaltyPointsSummary',
    wrapHandler(async (_event, filters) => {
      return reports.getLoyaltyPointsSummary(filters || {});
    })
  );

  console.log('Registering pos:reports:lostCustomers handler...');
  ipcMain.removeHandler('pos:reports:lostCustomers');
  ipcMain.handle(
    'pos:reports:lostCustomers',
    wrapHandler(async (_event, filters) => {
      return reports.getLostCustomers(filters || {});
    })
  );

  console.log('Registering pos:reports:customerProfitability handler...');
  ipcMain.removeHandler('pos:reports:customerProfitability');
  ipcMain.handle(
    'pos:reports:customerProfitability',
    wrapHandler(async (_event, filters) => {
      return reports.getCustomerProfitability(filters || {});
    })
  );

  // Supplier/Purchase Advanced Reports
  console.log('Registering pos:reports:deliveryAccuracy handler...');
  ipcMain.removeHandler('pos:reports:deliveryAccuracy');
  ipcMain.handle(
    'pos:reports:deliveryAccuracy',
    wrapHandler(async (_event, filters) => {
      return reports.getDeliveryAccuracy(filters || {});
    })
  );

  console.log('Registering pos:reports:deliveryDetails handler...');
  ipcMain.removeHandler('pos:reports:deliveryDetails');
  ipcMain.handle(
    'pos:reports:deliveryDetails',
    wrapHandler(async (_event, filters) => {
      return reports.getDeliveryDetails(filters || {});
    })
  );

  console.log('Registering pos:reports:priceHistory handler...');
  ipcMain.removeHandler('pos:reports:priceHistory');
  ipcMain.handle(
    'pos:reports:priceHistory',
    wrapHandler(async (_event, filters) => {
      return reports.getPriceHistory(filters || {});
    })
  );

  console.log('Registering pos:reports:productPriceSummary handler...');
  ipcMain.removeHandler('pos:reports:productPriceSummary');
  ipcMain.handle(
    'pos:reports:productPriceSummary',
    wrapHandler(async (_event, filters) => {
      return reports.getProductPriceSummary(filters || {});
    })
  );

  console.log('Registering pos:reports:purchasePlanning handler...');
  ipcMain.removeHandler('pos:reports:purchasePlanning');
  ipcMain.handle(
    'pos:reports:purchasePlanning',
    wrapHandler(async (_event, filters) => {
      return reports.getPurchasePlanning(filters || {});
    })
  );

  console.log('Registering pos:reports:purchaseSaleSpread handler...');
  ipcMain.removeHandler('pos:reports:purchaseSaleSpread');
  ipcMain.handle(
    'pos:reports:purchaseSaleSpread',
    wrapHandler(async (_event, filters) => {
      return reports.getPurchaseSaleSpread(filters || {});
    })
  );

  console.log('Registering pos:reports:spreadTimeSeries handler...');
  ipcMain.removeHandler('pos:reports:spreadTimeSeries');
  ipcMain.handle(
    'pos:reports:spreadTimeSeries',
    wrapHandler(async (_event, filters) => {
      return reports.getSpreadTimeSeries(filters || {});
    })
  );

  // Employee/Operations Reports
  console.log('Registering pos:reports:cashierErrors handler...');
  ipcMain.removeHandler('pos:reports:cashierErrors');
  ipcMain.handle(
    'pos:reports:cashierErrors',
    wrapHandler(async (_event, filters) => {
      return reports.getCashierErrors(filters || {});
    })
  );

  console.log('Registering pos:reports:cashierErrorDetails handler...');
  ipcMain.removeHandler('pos:reports:cashierErrorDetails');
  ipcMain.handle(
    'pos:reports:cashierErrorDetails',
    wrapHandler(async (_event, filters) => {
      return reports.getCashierErrorDetails(filters || {});
    })
  );

  console.log('Registering pos:reports:shiftProductivity handler...');
  ipcMain.removeHandler('pos:reports:shiftProductivity');
  ipcMain.handle(
    'pos:reports:shiftProductivity',
    wrapHandler(async (_event, filters) => {
      return reports.getShiftProductivity(filters || {});
    })
  );

  console.log('Registering pos:reports:productivitySummary handler...');
  ipcMain.removeHandler('pos:reports:productivitySummary');
  ipcMain.handle(
    'pos:reports:productivitySummary',
    wrapHandler(async (_event, filters) => {
      return reports.getProductivitySummary(filters || {});
    })
  );

  console.log('Registering pos:reports:fraudSignals handler...');
  ipcMain.removeHandler('pos:reports:fraudSignals');
  ipcMain.handle(
    'pos:reports:fraudSignals',
    wrapHandler(async (_event, filters) => {
      return reports.getFraudSignals(filters || {});
    })
  );

  console.log('Registering pos:reports:fraudIncidents handler...');
  ipcMain.removeHandler('pos:reports:fraudIncidents');
  ipcMain.handle(
    'pos:reports:fraudIncidents',
    wrapHandler(async (_event, filters) => {
      return reports.getFraudIncidents(filters || {});
    })
  );

  // System & Technical Reports
  console.log('Registering pos:reports:deviceHealth handler...');
  ipcMain.removeHandler('pos:reports:deviceHealth');
  ipcMain.handle(
    'pos:reports:deviceHealth',
    wrapHandler(async (_event) => {
      return reports.getDeviceHealth();
    })
  );

  console.log('Registering pos:reports:deviceIncidents handler...');
  ipcMain.removeHandler('pos:reports:deviceIncidents');
  ipcMain.handle(
    'pos:reports:deviceIncidents',
    wrapHandler(async (_event) => {
      return reports.getDeviceIncidents();
    })
  );

  console.log('Registering pos:reports:auditLog handler...');
  ipcMain.removeHandler('pos:reports:auditLog');
  ipcMain.handle(
    'pos:reports:auditLog',
    wrapHandler(async (_event, filters) => {
      return reports.getAuditLog(filters || {});
    })
  );

  console.log('Registering pos:reports:priceChangeHistory handler...');
  ipcMain.removeHandler('pos:reports:priceChangeHistory');
  ipcMain.handle(
    'pos:reports:priceChangeHistory',
    wrapHandler(async (_event, filters) => {
      return reports.getPriceChangeHistory(filters || {});
    })
  );

  // Executive Dashboard
  console.log('Registering pos:reports:executiveKPI handler...');
  ipcMain.removeHandler('pos:reports:executiveKPI');
  ipcMain.handle(
    'pos:reports:executiveKPI',
    wrapHandler(async (_event, filters) => {
      return reports.getExecutiveKPI(filters || {});
    })
  );

  console.log('Registering pos:reports:executiveTrends handler...');
  ipcMain.removeHandler('pos:reports:executiveTrends');
  ipcMain.handle(
    'pos:reports:executiveTrends',
    wrapHandler(async (_event, filters) => {
      return reports.getExecutiveTrends(filters || {});
    })
  );

  console.log('All reports handlers registered successfully (33 total)');
}

module.exports = { registerReportsHandlers };

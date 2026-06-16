'use strict';

/**
 * POS service bundle for the staff REST app.
 *
 * Mirrors the subset of `electron/services/index.cjs` (createServices) needed for
 * real point-of-sale selling from the mobile app, so we reuse the EXACT same
 * business logic (stock, totals, payments, shifts) instead of re-implementing it.
 *
 * Bundles are cached per tenant DB instance (same lifetime as the better-sqlite3
 * handle cached by staffDb), so repeated requests don't rebuild the service graph.
 */

const InventoryService = require('../../electron/services/inventoryService.cjs');
const BatchService = require('../../electron/services/batchService.cjs');
const CostService = require('../../electron/services/costService.cjs');
const PricingService = require('../../electron/services/pricingService.cjs');
const PromotionService = require('../../electron/services/promotionService.cjs');
const SalesService = require('../../electron/services/salesService.cjs');
const ProductsService = require('../../electron/services/productsService.cjs');
const ShiftsService = require('../../electron/services/shiftsService.cjs');
const CacheService = require('../../electron/services/cacheService.cjs');
const CustomersService = require('../../electron/services/customersService.cjs');
const SupplierService = require('../../electron/services/supplierService.cjs');
const PurchaseService = require('../../electron/services/purchaseService.cjs');
const ExchangeRatesService = require('../../electron/services/exchangeRatesService.cjs');
const ReportsService = require('../../electron/services/reportsService.cjs');
const ReturnsService = require('../../electron/services/returnsService.cjs');
const ExpensesService = require('../../electron/services/expensesService.cjs');

// WeakMap keyed by the better-sqlite3 db handle → bundle. The db handles are
// cached for the process lifetime by staffDb, so this avoids per-request rebuilds
// without leaking when caches are cleared.
const bundleCache = new WeakMap();

function buildPosBundle(db) {
  const cacheService = new CacheService();
  const inventoryService = new InventoryService(db);
  const batchService = new BatchService(db, inventoryService);
  // Back-reference (optional) so InventoryService can use batch helpers when needed.
  inventoryService.batchService = batchService;

  const costService = new CostService(db, batchService);
  const pricingService = new PricingService(db, cacheService);
  const promotionService = new PromotionService(db);
  const salesService = new SalesService(
    db,
    inventoryService,
    batchService,
    costService,
    pricingService,
    promotionService,
  );
  const productsService = new ProductsService(db, cacheService, pricingService);
  productsService.bindSalesService(salesService);
  const shiftsService = new ShiftsService(db);
  const customersService = new CustomersService(db);
  const suppliersService = new SupplierService(db);
  const purchaseService = new PurchaseService(db, inventoryService, batchService, cacheService);
  const exchangeRatesService = new ExchangeRatesService(db);
  const reportsService = new ReportsService(db);
  const returnsService = new ReturnsService(db, inventoryService, batchService);
  salesService.returnsService = returnsService;
  const expensesService = new ExpensesService(db);

  return {
    inventory: inventoryService,
    pricing: pricingService,
    sales: salesService,
    products: productsService,
    shifts: shiftsService,
    customers: customersService,
    suppliers: suppliersService,
    purchases: purchaseService,
    exchangeRates: exchangeRatesService,
    reports: reportsService,
    // Exposed for the staff "Mahsulotlar" (Products) cost/batch screens. Reusing
    // the same BatchService/CostService keeps FIFO cost math in one place.
    batch: batchService,
    cost: costService,
    returns: returnsService,
    expenses: expensesService,
  };
}

/**
 * Get (or lazily build + cache) the POS service bundle for a tenant database.
 * @param {import('better-sqlite3').Database} db
 */
function getPosBundle(db) {
  let bundle = bundleCache.get(db);
  if (!bundle) {
    bundle = buildPosBundle(db);
    bundleCache.set(db, bundle);
  }
  return bundle;
}

module.exports = { getPosBundle };

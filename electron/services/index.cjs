/**
 * Services Index
 * Central export point for all services
 */

/**
 * Resolve constructor from module exports
 * Handles all CommonJS export styles:
 *   1. module.exports = ServiceClass (direct export)
 *   2. module.exports = { ServiceClassName: ServiceClass } (named export)
 *   3. module.exports = { default: ServiceClass } (default in object)
 *   4. module.exports = { ServiceName: Class } (any named export)
 *   5. Auto-detects single function export in object
 */
function resolveCtor(mod, expectedName) {
  // Case a: Direct function export - module.exports = ServiceClass
  if (typeof mod === 'function') {
    console.log(`[Service Loader] ✓ Resolved ${expectedName} from direct export`);
    return mod;
  }
  
  // Case b: Default export in object - module.exports = { default: ServiceClass }
  if (mod && typeof mod.default === 'function') {
    console.log(`[Service Loader] ✓ Resolved ${expectedName} from default export`);
    return mod.default;
  }
  
  // Case c: Named export - module.exports = { ServiceName: ServiceClass }
  if (mod && typeof mod[expectedName] === 'function') {
    console.log(`[Service Loader] ✓ Resolved ${expectedName} from named export: ${expectedName}`);
    return mod[expectedName];
  }
  
  // Case d: Lowercase variant - module.exports = { serviceName: ServiceClass }
  const lowerName = expectedName.charAt(0).toLowerCase() + expectedName.slice(1);
  if (mod && typeof mod[lowerName] === 'function') {
    console.log(`[Service Loader] ✓ Resolved ${expectedName} from lowercase variant: ${lowerName}`);
    return mod[lowerName];
  }
  
  // Case e: Auto-detect single function export (if object has exactly one function)
  if (mod && typeof mod === 'object' && mod !== null) {
    const exportedKeys = Object.keys(mod);
    const functionKeys = exportedKeys.filter(key => typeof mod[key] === 'function');
    
    if (functionKeys.length === 1) {
      const autoResolved = mod[functionKeys[0]];
      console.log(`[Service Loader] ⚠ Auto-resolved ${expectedName} from single function export: ${functionKeys[0]}`);
      return autoResolved;
    }
    
    // Error: multiple or no functions found
    throw new Error(
      `Service import mismatch: ${expectedName} is not a constructor function.\n` +
      `  File: ./${expectedName.toLowerCase().replace('service', 'Service')}.cjs\n` +
      `  Expected: function (constructor) or object with ${expectedName} property\n` +
      `  Actual: object with ${functionKeys.length} function(s): ${functionKeys.join(', ')}\n` +
      `  All exported keys: ${exportedKeys.join(', ')}\n` +
      `  Hint: Export as:\n` +
      `    - Direct: module.exports = ${expectedName};\n` +
      `    - Named: module.exports = { ${expectedName} };\n` +
      `    - Default: module.exports = { default: ${expectedName} };`
    );
  }
  
  // Error: not a function and not an object
  const actualType = typeof mod;
  throw new Error(
    `Service import mismatch: ${expectedName} is not a constructor function.\n` +
    `  File: ./${expectedName.toLowerCase().replace('service', 'Service')}.cjs\n` +
    `  Expected: function (constructor) or object with ${expectedName} property\n` +
    `  Actual: ${actualType}\n` +
    `  Hint: Export as: module.exports = ${expectedName};`
  );
}

// Helper function to safely require a service and validate it's a constructor
function requireService(modulePath, serviceName) {
  try {
    const moduleExports = require(modulePath);
    const ServiceClass = resolveCtor(moduleExports, serviceName);
    
    // Final validation
    if (typeof ServiceClass !== 'function') {
      throw new Error(`Resolved value is not a function: ${typeof ServiceClass}`);
    }
    
    return ServiceClass;
  } catch (error) {
    if (error.message.includes('Service import mismatch') || error.message.includes('Failed to load service')) {
      throw error;
    }
    throw new Error(
      `Failed to load service ${serviceName} from ${modulePath}:\n` +
      `  ${error.message}`
    );
  }
}

const CategoriesService = requireService('./categoriesService.cjs', 'CategoriesService');
const ProductsService = requireService('./productsService.cjs', 'ProductsService');
const WarehousesService = requireService('./warehousesService.cjs', 'WarehousesService');
const CustomersService = requireService('./customersService.cjs', 'CustomersService');
const InventoryService = requireService('./inventoryService.cjs', 'InventoryService');
const BatchService = requireService('./batchService.cjs', 'BatchService');
const SalesService = requireService('./salesService.cjs', 'SalesService');
const CostService = requireService('./costService.cjs', 'CostService');
const ReturnsService = requireService('./returnsService.cjs', 'ReturnsService');
const ExpensesService = requireService('./expensesService.cjs', 'ExpensesService');
const PurchaseService = requireService('./purchaseService.cjs', 'PurchaseService');
const ShiftsService = requireService('./shiftsService.cjs', 'ShiftsService');
const SettingsService = requireService('./settingsService.cjs', 'SettingsService');
const ExchangeRatesService = requireService('./exchangeRatesService.cjs', 'ExchangeRatesService');
const SupplierReturnsService = requireService('./supplierReturnsService.cjs', 'SupplierReturnsService');
const AuditService = requireService('./auditService.cjs', 'AuditService');
const ReportsService = requireService('./reportsService.cjs', 'ReportsService');
const DashboardService = requireService('./dashboardService.cjs', 'DashboardService');
const AuthService = requireService('./authService.cjs', 'AuthService');
const SupplierService = requireService('./supplierService.cjs', 'SupplierService');
const DatabaseService = requireService('./databaseService.cjs', 'DatabaseService');
const UsersService = requireService('./usersService.cjs', 'UsersService');
const PrintService = requireService('./printService.cjs', 'PrintService');
const QuotesService = requireService('./quotesService.cjs', 'QuotesService');
const PricingService = requireService('./pricingService.cjs', 'PricingService');
const CacheService = requireService('./cacheService.cjs', 'CacheService');
const PromotionService = requireService('./promotionService.cjs', 'PromotionService');
const WebOrdersService = requireService('./webOrdersService.cjs', 'WebOrdersService');

/**
 * Initialize all services with database instance
 * @param {Database} db - SQLite database instance
 * @returns {Object} Object containing all service instances
 */
function createServices(db) {
  const cacheService = new CacheService();
  const inventoryService = new InventoryService(db);
  const batchService = new BatchService(db, inventoryService);
  // Back-reference (optional) so InventoryService can use batch helper methods when needed.
  inventoryService.batchService = batchService;

  const costService = new CostService(db, batchService);
  const pricingService = new PricingService(db, cacheService);
  const promotionService = new PromotionService(db);
  const salesService = new SalesService(db, inventoryService, batchService, costService, pricingService, promotionService);
  const returnsService = new ReturnsService(db, inventoryService, batchService);
  const purchaseService = new PurchaseService(db, inventoryService, batchService, cacheService);

  const services = {
    categories: new CategoriesService(db),
    products: new ProductsService(db, cacheService),
    warehouses: new WarehousesService(db),
    customers: new CustomersService(db),
    suppliers: new SupplierService(db),
    supplierReturns: new SupplierReturnsService(db, inventoryService),
    inventory: inventoryService,
    batches: batchService,
    sales: salesService,
    returns: returnsService,
    purchases: purchaseService,
    expenses: new ExpensesService(db),
    shifts: new ShiftsService(db),
    settings: new SettingsService(db),
    exchangeRates: new ExchangeRatesService(db),
    audit: new AuditService(db),
    reports: new ReportsService(db),
    dashboard: new DashboardService(db),
    auth: new AuthService(db),
    users: new UsersService(db),
    database: new DatabaseService(db),
    print: new PrintService(db),
    pricing: pricingService,
    cache: cacheService,
    promotions: promotionService,
  };
  services.quotes = new QuotesService(db, salesService);
  services.webOrders = new WebOrdersService(db);
  return services;
}

module.exports = {
  CategoriesService,
  ProductsService,
  WarehousesService,
  CustomersService,
  InventoryService,
  BatchService,
  SalesService,
  CostService,
  ReturnsService,
  ExpensesService,
  PurchaseService,
  ShiftsService,
  SettingsService,
  ExchangeRatesService,
  SupplierReturnsService,
  AuditService,
  ReportsService,
  DashboardService,
  AuthService,
  UsersService,
  DatabaseService,
  PrintService,
  QuotesService,
  PricingService,
  CacheService,
  PromotionService,
  WebOrdersService,
  createServices,
};


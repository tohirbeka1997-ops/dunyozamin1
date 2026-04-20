const { wrapHandler, ERROR_CODES, createError } = require('../lib/errors.cjs');
const appConfigModule = require('../config/appConfig.cjs');
// Metrics are optional — `metrics.cjs` pulls in prom-client. If the module
// is missing (e.g. dependency not yet installed), fall back to no-ops so the
// dispatcher keeps working.
let metrics = null;
let startTimer = () => () => 0;
try {
  ({ metrics, startTimer } = require('./metrics.cjs'));
} catch { /* metrics disabled */ }

/**
 * Dispatch a POS channel to the underlying services/db (HOST mode).
 *
 * This mirrors the behavior of the existing ipcMain handlers, but is usable
 * from a LAN RPC server (HTTP).
 *
 * Signature (new): dispatch(channel, args, meta?)
 *   meta = {
 *     authContext: { userId, username, role, expiresAtMs } | null,
 *     adminBypass: boolean,
 *     ip: string,
 *     userAgent: string,
 *   }
 * The dispatcher is also backward compatible with the old 2-arg form.
 */
function createRpcDispatcher({ services, db, sessions }) {
  if (!services) throw new Error('services is required');
  if (!db) throw new Error('db is required');

  // ------------------------------------------------------------------
  // Role matrix — which roles may invoke a given channel prefix / channel.
  //
  //   admin    : everything (wildcard)
  //   manager  : everything except admin-only channels
  //   cashier  : sales, returns, shifts, customers, pricing/promotions read,
  //              products (read), dashboard, health
  //
  // Legacy desktop/Electron clients bypass this (no meta).
  // Shared-secret callers also bypass (adminBypass=true).
  // ------------------------------------------------------------------
  const ROLE_RULES = {
    admin: () => true,
    manager: (ch) =>
      ch !== 'pos:settings:resetDatabase' &&
      !ch.startsWith('pos:database:'),
    cashier: (ch) =>
      // explicit allow list — safest for POS floor operators
      ch === 'pos:health' ||
      ch === 'pos:appConfig:get' ||
      ch === 'pos:auth:login' ||
      ch === 'pos:auth:logout' ||
      ch === 'pos:auth:me' ||
      ch.startsWith('pos:products:') && !ch.includes(':create') && !ch.includes(':update') && !ch.includes(':delete') ||
      ch.startsWith('pos:categories:') && ch.endsWith(':list') ||
      ch.startsWith('pos:warehouses:') && ch.endsWith(':list') ||
      ch.startsWith('pos:customers:') ||
      ch.startsWith('pos:pricing:get') ||
      ch.startsWith('pos:promotions:') && (ch.endsWith(':list') || ch.endsWith(':applyToCart')) ||
      ch.startsWith('pos:inventory:getBalances') ||
      ch.startsWith('pos:inventory:getCurrentStock') ||
      ch.startsWith('pos:sales:') ||
      ch.startsWith('pos:returns:') ||
      ch.startsWith('pos:shifts:') ||
      ch.startsWith('pos:reports:dailySales') ||
      ch.startsWith('pos:reports:cashFlow') ||
      ch === 'pos:dashboard:getStats' ||
      ch === 'pos:debug:tableCounts',
  };

  function checkRoleAccess(channel, role) {
    if (!role) return false;
    const rule = ROLE_RULES[String(role).toLowerCase()];
    if (!rule) {
      // Unknown role — deny by default. Use admin secret if you need access.
      return false;
    }
    return rule(channel);
  }

  // meta is passed by hostServer; in legacy Electron IPC path meta is undefined.
  const exec = wrapHandler(async (_event, channel, args, meta) => {
    const a = Array.isArray(args) ? args : [];
    const authContext = meta?.authContext || null;
    const adminBypass = !!meta?.adminBypass;
    const requestIp = meta?.ip || null;
    const requestUserAgent = meta?.userAgent || null;

    // Public channels are always allowed (login, health, appConfig:get, reset).
    const PUBLIC = (
      channel === 'pos:auth:login' ||
      channel === 'pos:auth:requestPasswordReset' ||
      channel === 'pos:auth:confirmPasswordReset' ||
      channel === 'pos:health' ||
      channel === 'pos:appConfig:get'
    );

    // Role check — only when a session is in play AND not admin-bypass AND
    // this is not a legacy Electron IPC call (meta === undefined).
    if (meta && !adminBypass && authContext && !PUBLIC) {
      if (!checkRoleAccess(channel, authContext.role)) {
        throw createError(
          ERROR_CODES.PERMISSION_DENIED,
          `Role "${authContext.role || 'unknown'}" may not call ${channel}`,
        );
      }
    }
    // Unused vars — reserved for upcoming audit-log handler.
    void requestIp; void requestUserAgent;

    // Helpers shared by scale export handlers
    const isWeight = (p) => {
      const unit = (p?.unit ?? '').toString().toLowerCase();
      const unitCode = (p?.unit_code ?? '').toString().toLowerCase();
      const unitSymbol = (p?.unit_symbol ?? '').toString().toLowerCase();
      return unit === 'kg' || unitCode === 'kg' || unitSymbol === 'kg';
    };

    const extractPlu = (skuRaw) => {
      const digits = String(skuRaw ?? '').match(/\d+/g)?.join('') ?? '';
      if (!digits) return null;
      const normalized = digits.length > 5 ? digits.slice(-5) : digits;
      const n = Number.parseInt(normalized, 10);
      if (!Number.isFinite(n) || n <= 0) return null;
      return n;
    };

    switch (channel) {
      // Products
      case 'pos:products:list':
        return services.products.list(a[0] || {});
      case 'pos:products:searchScreen':
        return services.products.searchScreen(a[0] || {});
      case 'pos:products:count':
        return services.products.count(a[0] || {});
      case 'pos:products:get':
        return (services.products.getById || services.products.get).call(services.products, a[0]);
      case 'pos:products:getBySku':
        try {
          return services.products.getBySku(a[0]);
        } catch (err) {
          if (err && typeof err === 'object' && err.code === ERROR_CODES.NOT_FOUND) {
            return null;
          }
          throw err;
        }
      case 'pos:products:getByBarcode':
        try {
          return services.products.getByBarcode(a[0]);
        } catch (err) {
          if (err && typeof err === 'object' && err.code === ERROR_CODES.NOT_FOUND) {
            return null;
          }
          throw err;
        }
      case 'pos:products:getNextSku':
        return services.products.getNextSku();
      case 'pos:products:getNextBarcode':
        return services.products.getNextBarcode();
      case 'pos:products:getNextBarcodeForUnit':
        return services.products.getNextBarcodeForUnit(a[0]);
      case 'pos:products:create':
        return services.products.create(a[0], { event: _event });
      case 'pos:products:update':
        return services.products.update(a[0], a[1], { event: _event });
      case 'pos:products:delete':
        return services.products.delete(a[0], { event: _event });
      case 'pos:products:exportScaleRongtaTxt': {
        const opts = a[0] || {};
        const department = Number.isFinite(Number(opts?.department)) ? Number(opts.department) : 7;
        const prefix = Number.isFinite(Number(opts?.prefix)) ? Number(opts.prefix) : 20;
        const rows = services.products.list({ status: 'active', limit: 100000, offset: 0 }) || [];

        const sanitize = (s) =>
          String(s ?? '')
            .replaceAll('\r', ' ')
            .replaceAll('\n', ' ')
            .replaceAll(';', ',')
            .trim();

        const lines = [];
        const stats = { total: rows.length, exported: 0, skippedNotWeight: 0, skippedNoPlu: 0, skippedInvalid: 0 };

        for (const p of rows) {
          if (!isWeight(p)) {
            stats.skippedNotWeight++;
            continue;
          }
          const plu = extractPlu(p.sku);
          if (!plu) {
            stats.skippedNoPlu++;
            continue;
          }
          const name = sanitize(p.name);
          const sku = sanitize(p.sku);
          const priceRaw = Number(p.sale_price);
          const price = Number.isFinite(priceRaw) && priceRaw > 0 ? Math.round(priceRaw) : 1;
          const typeWeight = 4;
          const line = `${name};${plu};${sku};${price};${department};${typeWeight};0;${prefix}`;
          if (!line || line.startsWith(';')) {
            stats.skippedInvalid++;
            continue;
          }
          lines.push(line);
          stats.exported++;
        }

        const content = lines.join('\r\n') + (lines.length ? '\r\n' : '');
        return { content, stats };
      }
      case 'pos:products:exportScaleSharqTxt': {
        const opts = a[0] || {};
        const department = Number.isFinite(Number(opts?.department)) ? Number(opts.department) : 7;
        const prefix = Number.isFinite(Number(opts?.prefix)) ? Number(opts.prefix) : 29;
        const group = Number.isFinite(Number(opts?.group)) ? Number(opts.group) : 19;
        const brand = String(opts?.brand ?? '@SHARQUZB').trim() || '@SHARQUZB';
        const rows = services.products.list({ status: 'active', limit: 100000, offset: 0 }) || [];

        const sanitizeName = (s) =>
          String(s ?? '')
            .replaceAll('\r', ' ')
            .replaceAll('\n', ' ')
            .replaceAll(';', ' ')
            .trim();

        const lines = [];
        const stats = { total: rows.length, exported: 0, skippedNotWeight: 0, skippedNoPlu: 0, skippedInvalid: 0 };

        for (const p of rows) {
          if (!isWeight(p)) {
            stats.skippedNotWeight++;
            continue;
          }
          const plu = extractPlu(p.sku);
          if (!plu) {
            stats.skippedNoPlu++;
            continue;
          }
          let name = sanitizeName(p.name);
          if (!/\bkg\b/i.test(name)) name = `${name} KG`;
          const priceRaw = Number(p.sale_price);
          const price = Number.isFinite(priceRaw) && priceRaw > 0 ? Math.round(priceRaw) : 1;
          const productCode = plu;
          const typeWeight = 4;
          const line = `${brand} ${name} #${plu};${productCode};${group};${price};${department};${typeWeight};0;${prefix}`;
          if (!line || !line.includes('#') || line.startsWith(' #')) {
            stats.skippedInvalid++;
            continue;
          }
          lines.push(line);
          stats.exported++;
        }

        const content = lines.join('\r\n') + (lines.length ? '\r\n' : '');
        return { content, stats };
      }
      case 'pos:products:exportScaleCsv3': {
        const rows = services.products.list({ status: 'active', limit: 100000, offset: 0 }) || [];

        const sanitizeCsv = (s) =>
          String(s ?? '')
            .replaceAll('\r', ' ')
            .replaceAll('\n', ' ')
            .replaceAll(',', ' ')
            .trim();

        const pad5 = (n) => String(n).padStart(5, '0');

        const lines = [];
        const stats = { total: rows.length, exported: 0, skippedNotWeight: 0, skippedNoPlu: 0, skippedInvalid: 0 };

        for (const p of rows) {
          if (!isWeight(p)) {
            stats.skippedNotWeight++;
            continue;
          }
          const pluNum = extractPlu(p.sku);
          if (!pluNum) {
            stats.skippedNoPlu++;
            continue;
          }
          const plu = pad5(pluNum);
          const name = sanitizeCsv(p.name);
          const priceRaw = Number(p.sale_price);
          const price = Number.isFinite(priceRaw) && priceRaw > 0 ? Math.round(priceRaw) : 1;
          const line = `${plu},${name},${price}`;
          if (!line || line.startsWith(',')) {
            stats.skippedInvalid++;
            continue;
          }
          lines.push(line);
          stats.exported++;
        }

        const content = lines.join('\r\n') + (lines.length ? '\r\n' : '');
        return { content, stats };
      }
      case 'pos:products:exportScaleLegacyTxt': {
        const opts = a[0] || {};
        const department = Number.isFinite(Number(opts?.department)) ? Number(opts.department) : 7;
        const prefix = Number.isFinite(Number(opts?.prefix)) ? Number(opts.prefix) : 20;
        const rows = services.products.list({ status: 'active', limit: 100000, offset: 0 }) || [];

        const sanitize = (s) =>
          String(s ?? '')
            .replaceAll('\r', ' ')
            .replaceAll('\n', ' ')
            .replaceAll(';', ',')
            .trim();

        const pad5 = (n) => String(n).padStart(5, '0');

        const lines = [];
        const stats = { total: rows.length, exported: 0, skippedNotWeight: 0, skippedNoPlu: 0, skippedInvalid: 0 };

        for (const p of rows) {
          if (!isWeight(p)) {
            stats.skippedNotWeight++;
            continue;
          }
          const pluNum = extractPlu(p.sku);
          if (!pluNum) {
            stats.skippedNoPlu++;
            continue;
          }
          const name = sanitize(p.name);
          const priceRaw = Number(p.sale_price);
          const price = Number.isFinite(priceRaw) && priceRaw > 0 ? Math.round(priceRaw) : 1;
          const plu = String(pluNum);
          const plu5 = pad5(pluNum);
          const typeWeight = 4;
          const line = `${name};${plu};${plu5};${price};${department};${typeWeight};0;${prefix}`;
          if (!line || line.startsWith(';')) {
            stats.skippedInvalid++;
            continue;
          }
          lines.push(line);
          stats.exported++;
        }

        const content = lines.join('\r\n') + (lines.length ? '\r\n' : '');
        return { content, stats };
      }

      // Categories
      case 'pos:categories:list':
        return services.categories.list(a[0] || {});
      case 'pos:categories:get':
        return services.categories.get(a[0]);
      case 'pos:categories:create':
        return services.categories.create(a[0], { event: _event });
      case 'pos:categories:update':
        return services.categories.update(a[0], a[1], { event: _event });
      case 'pos:categories:delete':
        return services.categories.delete(a[0], { event: _event });

      // Warehouses
      case 'pos:warehouses:list':
        return services.warehouses.list(a[0] || {});
      case 'pos:warehouses:get':
        return services.warehouses.get(a[0]);
      case 'pos:warehouses:create':
        return services.warehouses.create(a[0] || {});
      case 'pos:warehouses:update':
        return services.warehouses.update(a[0], a[1] || {});
      case 'pos:warehouses:delete':
        return services.warehouses.delete(a[0]);

      // Customers
      case 'pos:customers:list':
        return services.customers.list(a[0] || {});
      case 'pos:customers:get':
        return services.customers.get(a[0]);
      case 'pos:customers:create':
        return services.customers.create(a[0] || {});
      case 'pos:customers:update':
        return services.customers.update(a[0], a[1] || {});
      case 'pos:customers:delete':
        return services.customers.delete(a[0]);
      case 'pos:customers:updateBalance':
        return services.customers.updateBalance(a[0], a[1], a[2]);
      case 'pos:customers:receivePayment':
        return services.customers.receivePayment(a[0] || {});
      case 'pos:customers:getPayments':
        return services.customers.getPayments(a[0], a[1] || {});
      case 'pos:customers:getLedger':
        return services.customers.getLedger(a[0], a[1] || {});
      case 'pos:customers:getLedgerCount':
        return services.customers.getLedgerCount(a[0] || {});
      case 'pos:customers:exportCsv':
        return services.customers.exportCsv(a[0] || {});
      case 'pos:customers:getBonusLedger':
        return services.customers.getBonusLedger(a[0], a[1] || {});
      case 'pos:customers:adjustBonusPoints':
        return services.customers.adjustBonusPoints(
          a[0]?.actorUserId,
          a[0]?.customerId,
          a[0]?.deltaPoints,
          a[0]?.note
        );

      // Suppliers
      case 'pos:suppliers:list':
        return services.suppliers.list(a[0] || {});
      case 'pos:suppliers:get':
        return services.suppliers.get(a[0]);
      case 'pos:suppliers:create':
        return services.suppliers.create(a[0] || {});
      case 'pos:suppliers:update':
        return services.suppliers.update(a[0], a[1] || {});
      case 'pos:suppliers:delete':
        return services.suppliers.delete(a[0]);
      case 'pos:suppliers:getLedger':
        return services.suppliers.getLedger(a[0], a[1] || {});
      case 'pos:suppliers:createPayment':
        return services.suppliers.createPayment(a[0] || {});
      case 'pos:suppliers:getPayments':
        return services.suppliers.getPayments(a[0]);
      case 'pos:suppliers:getPurchaseSummary':
        return services.suppliers.getPurchaseSummary(a[0], a[1] || {});
      case 'pos:suppliers:createReturn':
        return services.supplierReturns.create(a[0] || {});
      case 'pos:suppliers:getReturn':
        return services.supplierReturns.get(a[0]);
      case 'pos:suppliers:listReturns':
        return services.supplierReturns.list(a[0] || {});

      // Inventory
      case 'pos:inventory:getBalances':
        return services.inventory.getBalances(a[0] || {});
      case 'pos:inventory:getMoves':
        return services.inventory.getMoves(a[0] || {});
      case 'pos:inventory:adjustStock':
        return services.inventory.adjustStock(a[0] || {});
      case 'pos:inventory:getProductPurchaseHistory':
        return services.inventory.getProductPurchaseHistory(a[0]);
      case 'pos:inventory:getProductSalesHistory':
        return services.inventory.getProductSalesHistory(a[0]);
      case 'pos:inventory:getProductDetail':
        return services.inventory.getProductDetail(a[0]);
      case 'pos:inventory:getCurrentStock':
        return services.inventory.getCurrentStock(a[0], a[1]);
      case 'pos:inventory:getDeadStock':
        return services.inventory.getDeadStock(a[0] || {});
      case 'pos:inventory:getStockTurnover':
        return services.inventory.getStockTurnover(a[0] || {});
      case 'pos:inventory:getReorderSuggestions':
        return services.inventory.getReorderSuggestions();

      // Sales
      case 'pos:sales:createDraftOrder':
        return services.sales.createDraftOrder(a[0] || {});
      case 'pos:sales:addItem':
        return services.sales.addItem(a[0], a[1] || {});
      case 'pos:sales:removeItem':
        return services.sales.removeItem(a[0], a[1]);
      case 'pos:sales:updateItemQuantity':
        return services.sales.updateItemQuantity(a[0], a[1], a[2]);
      case 'pos:sales:setCustomer':
        return services.sales.setCustomer(a[0], a[1]);
      case 'pos:sales:finalizeOrder':
        return services.sales.finalizeOrder(a[0], a[1] || {});
      case 'pos:sales:getOrder':
        return services.sales._getOrderWithDetails(a[0]);
      case 'pos:sales:completePOSOrder':
        console.log('[RPC] pos:sales:completePOSOrder', {
          order_uuid: a?.[0]?.order_uuid,
          device_id: a?.[0]?.device_id,
          items_count: Array.isArray(a?.[1]) ? a[1].length : 0,
          payments_count: Array.isArray(a?.[2]) ? a[2].length : 0,
        });
        return services.sales.completePOSOrder(a[0] || {}, a[1] || [], a[2] || []);
      case 'pos:sales:list':
        return services.sales.list(a[0] || {});
      case 'pos:sales:get':
        return services.sales._getOrderWithDetails(a[0]);
      case 'pos:sales:refund':
        return services.sales.refundOrder(a[0], a[1], a[2] ?? null);

      // Returns
      case 'pos:returns:create':
        return services.returns.create(a[0] || {});
      case 'pos:returns:get':
        return services.returns.get(a[0]);
      case 'pos:returns:list':
        return services.returns.list(a[0] || {});
      case 'pos:returns:getOrderDetails':
        return services.returns.getOrderDetails(a[0] || {});
      case 'pos:returns:update':
        return services.returns.update(a[0] || {});

      // Purchases
      case 'pos:purchases:list':
        return services.purchases.list(a[0] || {});
      case 'pos:purchases:get':
        return services.purchases.get(a[0]);
      case 'pos:purchases:createOrder':
        return services.purchases.createOrder(a[0] || {});
      case 'pos:purchases:updateOrder':
        return services.purchases.updateOrder(a[0], a[1] || {}, a[2] || []);
      case 'pos:purchases:approve':
        return services.purchases.approve(a[0], a[1]);
      case 'pos:purchases:receiveGoods':
        return services.purchases.receiveGoods(a[0], a[1] || {});
      case 'pos:purchases:listExpenses':
        return services.purchases.listExpenses(a[0]);
      case 'pos:purchases:addExpense':
        return services.purchases.addExpense(a[0], a[1] || {});
      case 'pos:purchases:deleteExpense':
        return services.purchases.deleteExpense(a[0], a[1]);

      // Expenses
      case 'pos:expenses:listCategories':
        return services.expenses.listCategories(a[0] || {});
      case 'pos:expenses:createCategory':
        return services.expenses.createCategory(a[0] || {});
      case 'pos:expenses:updateCategory':
        return services.expenses.updateCategory(a[0], a[1] || {});
      case 'pos:expenses:deleteCategory':
        return services.expenses.deleteCategory(a[0]);
      case 'pos:expenses:list':
        return services.expenses.list(a[0] || {});
      case 'pos:expenses:create':
        return services.expenses.create(a[0] || {});
      case 'pos:expenses:update':
        return services.expenses.update(a[0], a[1] || {});
      case 'pos:expenses:delete':
        return services.expenses.delete(a[0]);

      // Shifts
      case 'pos:shifts:open':
        return (services.shifts.openShift || services.shifts.open).call(services.shifts, a[0] || {});
      case 'pos:shifts:close':
        return (services.shifts.closeShift || services.shifts.close).call(services.shifts, a[0], a[1] || {});
      case 'pos:shifts:get':
        return (services.shifts.getById || services.shifts.get).call(services.shifts, a[0]);
      case 'pos:shifts:getActive':
        return (services.shifts.getActiveShift || services.shifts.getActive).call(services.shifts, a[0]);
      case 'pos:shifts:getCurrent':
        return (services.shifts.getActiveShift || services.shifts.getCurrent).call(services.shifts, a[0]);
      case 'pos:shifts:getStatus':
        return services.shifts.getStatus(a[0], a[1]);
      case 'pos:shifts:require':
        return (services.shifts.requireShift || services.shifts.require).call(services.shifts, a[0], a[1]);
      case 'pos:shifts:list':
        return services.shifts.list(a[0] || {});
      case 'pos:shifts:getSummary':
        return (services.shifts.getShiftSummary || services.shifts.getSummary).call(services.shifts, a[0] || {});

      // Reports
      case 'pos:reports:dailySales':
        return services.reports.dailySales(a[0], a[1]);
      case 'pos:reports:topProducts':
        return services.reports.topProducts(a[0] || {});
      case 'pos:reports:productSales':
        return services.reports.getProductSalesReport(a[0] || {});
      case 'pos:reports:stock':
        return services.reports.stock(a[0]);
      case 'pos:reports:returns':
        return services.reports.returns(a[0] || {});
      case 'pos:reports:profit':
        return services.reports.profit(a[0] || {});
      case 'pos:reports:batchReconciliation':
        return services.reports.getBatchReconciliation(a[0] || {});
      case 'pos:reports:actSverka':
        return services.reports.getActSverka(a[0] || {});
      case 'pos:reports:customerActSverka':
        return services.reports.getCustomerActSverka(a[0] || {});
      case 'pos:reports:supplierActSverka':
        return services.reports.getSupplierActSverka(a[0] || {});
      case 'pos:reports:productTraceability':
        return services.reports.getProductTraceability(a[0] || {});
      case 'pos:reports:supplierProductSales':
        return services.reports.getSupplierProductSales(a[0] || {});
      case 'pos:reports:purchasePlanning':
        return services.reports.getPurchasePlanning(a[0] || {});
      case 'pos:reports:getLatestPurchaseCosts':
        return services.reports.getLatestPurchaseCosts();
      case 'pos:reports:cashFlow':
        return services.reports.cashFlow(a[0] || {});
      case 'pos:reports:cashDiscrepancies':
        return services.reports.cashDiscrepancies(a[0] || {});
      case 'pos:reports:aging':
        return services.reports.aging(a[0] || {});

      // Dashboard
      case 'pos:dashboard:getStats':
        return services.dashboard.getStats(a[0] || {});
      case 'pos:dashboard:getAnalytics':
        return services.dashboard.getAnalytics(a[0] || {});

      // Settings (DB-backed)
      case 'pos:settings:get':
        return services.settings.get(a[0]);
      case 'pos:settings:set':
        return services.settings.set(a[0], a[1], a[2], a[3]);
      case 'pos:settings:getAll':
        return services.settings.getAll(a[0] || {});
      case 'pos:settings:delete':
        return services.settings.delete(a[0]);

      // Exchange Rates
      case 'pos:exchangeRates:getLatest':
        return services.exchangeRates.getLatest(a[0] || {});
      case 'pos:exchangeRates:list':
        return services.exchangeRates.list(a[0] || {});
      case 'pos:exchangeRates:upsert':
        return services.exchangeRates.upsert(a[0] || {});

      // ======================================================================
      // Auth — login/logout/me
      // ======================================================================
      case 'pos:auth:login': {
        const username = a[0];
        const password = a[1];
        // services.auth.login returns { success, user, message } (does not throw).
        const result = services.auth.login(username, password);
        if (!result?.success || !result.user) {
          return result;
        }
        // Always bump last_login (both local Electron IPC and remote RPC).
        try {
          db.prepare(`UPDATE users SET last_login = datetime('now') WHERE id = ?`)
            .run(result.user.id);
        } catch { /* non-fatal */ }

        // Issue a session token ONLY in HOST/server mode where `sessions` was
        // provided by hostServer.cjs. In pure Electron IPC there is no session
        // store — the desktop process trusts the local window implicitly.
        if (sessions && typeof sessions.create === 'function') {
          try {
            const s = sessions.create({
              user: result.user,
              ip: requestIp,
              userAgent: requestUserAgent,
            });
            return {
              ...result,
              token: s.token,
              expiresAt: s.expiresAt,
              userId: s.userId,
              role: s.role,
            };
          } catch (e) {
            // Fall through — login still succeeded, just no session.
            return { ...result, sessionError: String(e?.message || e) };
          }
        }
        return result;
      }
      case 'pos:auth:logout': {
        // Called with the bearer token that was used to authenticate this
        // request. Frontend should then discard its local copy.
        if (sessions && authContext) {
          // We don't see the raw token here (hostServer consumed it), but the
          // client can still hit destroyAllForUser or the server will expire.
          // Safer route: destroy ALL sessions for this user on logout.
          sessions.destroyAllForUser(authContext.userId);
        }
        return { success: true };
      }
      case 'pos:auth:me': {
        if (!authContext) {
          // Allowed to be called with admin-secret too; return minimal info.
          if (adminBypass) return { adminBypass: true };
          throw createError(ERROR_CODES.AUTH_ERROR, 'No active session');
        }
        const user = db.prepare('SELECT id, username, role, email, full_name, is_active FROM users WHERE id = ?')
          .get(authContext.userId);
        if (!user) throw createError(ERROR_CODES.NOT_FOUND, 'User not found');
        return {
          ...user,
          expiresAt: new Date(authContext.expiresAtMs).toISOString(),
        };
      }
      case 'pos:auth:getUser': {
        const userId = a[0];
        const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
        if (!user) throw createError(ERROR_CODES.NOT_FOUND, 'User not found');
        const roles = db
          .prepare(
            `
            SELECT r.* 
            FROM user_roles ur
            INNER JOIN roles r ON ur.role_id = r.id
            WHERE ur.user_id = ?
          `
          )
          .all(user.id);
        const { password_hash, ...userWithoutPassword } = user;
        return { ...userWithoutPassword, roles };
      }
      case 'pos:auth:checkPermission': {
        const userId = a[0];
        const permission = a[1];
        const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
        if (!user) throw createError(ERROR_CODES.NOT_FOUND, 'User not found');
        const roles = db
          .prepare(
            `
            SELECT r.code
            FROM user_roles ur
            INNER JOIN roles r ON ur.role_id = r.id
            WHERE ur.user_id = ?
          `
          )
          .all(user.id)
          .map((r) => r.code);
        const hasPermission = roles.includes('admin') || roles.includes(permission);
        return { hasPermission, roles };
      }
      case 'pos:auth:requestPasswordReset':
        return services.auth.requestPasswordReset(a[0]);
      case 'pos:auth:confirmPasswordReset':
        return services.auth.confirmPasswordReset(a[0] || {});

      // Orders
      case 'pos:orders:list':
        {
          const ordersService = services.orders || services.sales;
          if (!ordersService) {
            throw createError(ERROR_CODES.INTERNAL_ERROR, 'Orders service not available');
          }
          const filters = a[0] || {};
          const withDetails = filters.with_details !== false;
          const orders = ordersService.list(filters);
          if (!withDetails) return orders;
          if (typeof ordersService._getOrderWithDetails !== 'function') return orders;
          return orders.map((o) => ordersService._getOrderWithDetails(o.id)).filter(Boolean);
        }
      case 'pos:orders:get':
        {
          const ordersService = services.orders || services.sales;
          if (!ordersService) {
            throw createError(ERROR_CODES.INTERNAL_ERROR, 'Orders service not available');
          }
          const orderId = a[0];
          if (typeof ordersService.get === 'function') {
            return ordersService.get(orderId);
          }
          if (typeof ordersService._getOrderWithDetails === 'function') {
            return ordersService._getOrderWithDetails(orderId);
          }
          throw createError(ERROR_CODES.INTERNAL_ERROR, 'Orders service does not support get');
        }

      // Users
      case 'pos:users:list':
        return services.users.list(a[0] || {});
      case 'pos:users:get':
        return services.users.get(a[0]);
      case 'pos:users:create':
        return services.users.create(a[0] || {});
      case 'pos:users:update':
        return services.users.update(a[0], a[1] || {});
      case 'pos:users:delete':
        return services.users.delete(a[0]);

      // System/Debug
      case 'pos:health': {
        const { isOpen } = require('../db/open.cjs');
        // multi_tenant=false so the browser shows a single-tenant login
        // form without a tenant field. In MT mode the mtDispatch wrapper
        // answers this channel before we get here.
        return { success: true, dbOpen: isOpen(), multi_tenant: false };
      }
      case 'pos:debug:tableCounts': {
        const counts = {
          products: db.prepare('SELECT COUNT(*) as count FROM products').get().count,
          categories: db.prepare('SELECT COUNT(*) as count FROM categories').get().count,
          suppliers: db.prepare('SELECT COUNT(*) as count FROM suppliers').get().count,
          customers: db.prepare('SELECT COUNT(*) as count FROM customers').get().count,
          inventory_movements: db.prepare('SELECT COUNT(*) as count FROM inventory_movements').get().count,
          warehouses: db.prepare('SELECT COUNT(*) as count FROM warehouses').get().count,
          active_products: db.prepare('SELECT COUNT(*) as count FROM products WHERE is_active = 1').get().count,
        };
        return { success: true, counts };
      }

      // Dangerous endpoints - only host-local usage, do not expose remotely by default
      case 'pos:database:wipeDataOnly':
      case 'pos:database:wipeAllData':
        throw createError(ERROR_CODES.PERMISSION_DENIED, 'Operation not allowed via network');

      // On-demand backup — invoked by the off-site sync script before pushing
      // snapshots to the remote. Admin-only (requires shared secret or admin
      // session), never callable by cashiers/managers.
      case 'pos:database:backup': {
        if (!adminBypass && (!authContext || authContext.role !== 'admin')) {
          throw createError(ERROR_CODES.PERMISSION_DENIED, 'Admin only');
        }
        if (!services.backup || typeof services.backup.backupOnce !== 'function') {
          throw createError(ERROR_CODES.NOT_FOUND, 'Backup service not available');
        }
        return services.backup.backupOnce(a[0] || 'manual');
      }

      // ======================================================================
      // App local config (pos-config.json) — HOST/CLIENT mode, printer settings
      // ======================================================================
      case 'pos:appConfig:get':
        return appConfigModule.readConfig();
      case 'pos:appConfig:set':
        return appConfigModule.writeConfig(a[0] || {});
      case 'pos:appConfig:reset':
        return appConfigModule.resetConfig();

      // ======================================================================
      // Pricing
      // ======================================================================
      case 'pos:pricing:getTiers':
        return services.pricing.getTiers();
      case 'pos:pricing:getPrice':
        return services.pricing.getPriceForProduct(a[0] || {});
      case 'pos:pricing:setPrice':
        return services.pricing.setPrice(a[0] || {});

      // ======================================================================
      // Promotions (Aksiya)
      // ======================================================================
      case 'pos:promotions:list':
        return services.promotions.listPromotionsWithStats(a[0] || {});
      case 'pos:promotions:get': {
        const id = a[0];
        const promo = services.promotions.getPromotionById(id);
        if (!promo) throw createError(ERROR_CODES.NOT_FOUND, `Promotion ${id} not found`);
        return {
          ...promo,
          scope: services.promotions.getPromotionScope(id),
          condition: services.promotions.getPromotionCondition(id),
          reward: services.promotions.getPromotionReward(id),
          usage_count: services.promotions.getPromotionUsageCount(id),
          total_discount: services.promotions.getPromotionTotalDiscount(id),
        };
      }
      case 'pos:promotions:create':
        return services.promotions.createPromotion(a[0] || {});
      case 'pos:promotions:update':
        return services.promotions.updatePromotion({ ...(a[1] || {}), id: a[0] });
      case 'pos:promotions:delete':
        services.promotions.deletePromotion(a[0]);
        return { success: true };
      case 'pos:promotions:activate': {
        const id = a[0];
        const userId = a[1];
        const before = services.promotions.getPromotionById(id);
        services.promotions.setStatus(id, 'active', userId);
        services.promotions.audit(
          id,
          'activate',
          before ? JSON.stringify({ status: before.status }) : null,
          JSON.stringify({ status: 'active' }),
          userId,
        );
        return services.promotions.getPromotionById(id);
      }
      case 'pos:promotions:pause': {
        const id = a[0];
        const userId = a[1];
        const before = services.promotions.getPromotionById(id);
        services.promotions.setStatus(id, 'paused', userId);
        services.promotions.audit(
          id,
          'pause',
          before ? JSON.stringify({ status: before.status }) : null,
          JSON.stringify({ status: 'paused' }),
          userId,
        );
        return services.promotions.getPromotionById(id);
      }
      case 'pos:promotions:applyToCart':
        return services.promotions.applyPromotions(a[0] || [], a[1], a[2]);

      // ======================================================================
      // Quotes (Smeta)
      // ======================================================================
      case 'pos:quotes:list':
        return services.quotes.list(a[0] || {});
      case 'pos:quotes:get':
        return services.quotes.get(a[0]);
      case 'pos:quotes:create':
        return services.quotes.create(a[0] || {});
      case 'pos:quotes:update':
        return services.quotes.update(a[0], a[1] || {});
      case 'pos:quotes:delete':
        return services.quotes.delete(a[0]);
      case 'pos:quotes:generateNumber':
        return services.quotes.generateQuoteNumber();
      case 'pos:quotes:convertToSale':
        return services.quotes.convertToSale(a[0], a[1] || {});

      // ======================================================================
      // Products — image management
      // ======================================================================
      case 'pos:products:getImages':
        return services.products.getProductImages(a[0]);
      case 'pos:products:addImage':
        return services.products.addProductImage(a[0], a[1], a[2] ?? 0, a[3] ? 1 : 0);
      case 'pos:products:removeImage':
        return services.products.removeProductImage(a[0], a[1]);
      case 'pos:products:setImages':
        return services.products.setProductImages(a[0], a[1] || []);

      // ======================================================================
      // Inventory — product ledger + batch helpers
      // ======================================================================
      case 'pos:inventory:getProductLedger':
        return services.inventory.getProductLedger(a[0] || {});
      case 'pos:inventory:getBatchesByProduct':
        if (!services.batches) {
          throw createError(ERROR_CODES.INTERNAL_ERROR, 'BatchService not available');
        }
        return services.batches.listBatchesByProduct(a[0], a[1]);
      case 'pos:inventory:getBatchReconcile':
        if (!services.batches) {
          throw createError(ERROR_CODES.INTERNAL_ERROR, 'BatchService not available');
        }
        return services.batches.reconcile(a[0] || null, a[1] || null);
      case 'pos:inventory:runBatchCutoverSnapshot': {
        if (!services.batches) {
          throw createError(ERROR_CODES.INTERNAL_ERROR, 'BatchService not available');
        }
        const p = a[0] || {};
        return services.batches.runCutoverSnapshot({
          cutoverAt: p.cutoverAt,
          warehouseId: p.warehouseId,
          costMode: p.costMode || 'last_received_po_cost',
          updatedBy: p.updatedBy || null,
        });
      }

      // ======================================================================
      // Orders — helpers
      // ======================================================================
      case 'pos:orders:getByNumber': {
        const orderNumber = a[0];
        const row = db.prepare('SELECT id FROM orders WHERE order_number = ?').get(orderNumber);
        if (!row?.id) return null;
        const ordersService = services.orders || services.sales;
        return ordersService._getOrderWithDetails(row.id);
      }
      case 'pos:orders:getByCustomer': {
        const ordersService = services.orders || services.sales;
        if (typeof ordersService.getByCustomer === 'function') {
          return ordersService.getByCustomer(a[0]);
        }
        return ordersService.list({ customer_id: a[0] });
      }
      case 'pos:orders:cancel': {
        // Minimal, safe cancel: only 'draft' or 'pending' orders (never completed).
        const orderId = a[0];
        const order = db.prepare('SELECT id, status FROM orders WHERE id = ?').get(orderId);
        if (!order) throw createError(ERROR_CODES.NOT_FOUND, `Order ${orderId} not found`);
        if (!['draft', 'pending', 'on_hold'].includes(String(order.status))) {
          throw createError(
            ERROR_CODES.VALIDATION_ERROR,
            `Cannot cancel order in status "${order.status}". Use refund for completed orders.`,
          );
        }
        db.prepare(
          "UPDATE orders SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?",
        ).run(orderId);
        return { success: true, id: orderId, status: 'cancelled' };
      }

      // Onlayn buyurtmalar (Telegram / marketplace) — admin/manager
      case 'pos:webOrders:list':
        return services.webOrders.list(a[0] || {});
      case 'pos:webOrders:get':
        return services.webOrders.get(a[0]);
      case 'pos:webOrders:updateStatus':
        return services.webOrders.updateStatus(a[0], a[1]);

      // ======================================================================
      // Suppliers — extra
      // ======================================================================
      case 'pos:suppliers:deletePayment':
        return services.suppliers.deletePayment(a[0]);

      // ======================================================================
      // Purchases — extra
      // ======================================================================
      case 'pos:purchases:createReceipt':
        return services.purchases.createReceipt(a[0] || {});
      case 'pos:purchases:deleteOrder':
        return services.purchases.deleteOrder(a[0]);

      // ======================================================================
      // Users — extra
      // ======================================================================
      case 'pos:users:resetPassword': {
        const userId = a[0];
        const newPassword = a[1];
        if (!newPassword || String(newPassword).length < 6) {
          throw createError(ERROR_CODES.VALIDATION_ERROR, 'Password must be at least 6 characters');
        }
        return services.users.update(userId, { password: String(newPassword) });
      }

      // ======================================================================
      // Dashboard — low stock
      // ======================================================================
      case 'pos:dashboard:getLowStock': {
        const f = a[0] || {};
        const warehouseId = f.warehouseId || f.warehouse_id || null;
        const limit = Number.isFinite(Number(f.limit)) ? Math.max(1, Math.min(500, Number(f.limit))) : 50;
        const params = [];
        let where = "WHERE p.is_active = 1 AND sb.balance <= COALESCE(p.min_stock, 0)";
        if (warehouseId) {
          where += ' AND sb.warehouse_id = ?';
          params.push(warehouseId);
        }
        const rows = db
          .prepare(
            `
            SELECT p.id, p.sku, p.name, p.min_stock,
                   sb.warehouse_id,
                   SUM(sb.balance) as current_stock
            FROM products p
            INNER JOIN stock_balances sb ON p.id = sb.product_id
            ${where}
            GROUP BY p.id, sb.warehouse_id
            ORDER BY current_stock ASC
            LIMIT ?
          `,
          )
          .all(...params, limit);
        return rows;
      }

      // ======================================================================
      // Settings — resetDatabase (server mode: not allowed via network)
      // ======================================================================
      case 'pos:settings:resetDatabase':
        throw createError(
          ERROR_CODES.PERMISSION_DENIED,
          'Database reset is not allowed via RPC. Run server-side maintenance script instead.',
        );

      // ======================================================================
      // Advanced Reports (33+ channels mirroring reports.ipc.cjs)
      // ======================================================================
      case 'pos:reports:dailySalesSQL':
        return services.reports.getDailySalesReportSQL(a[0] || {});
      case 'pos:reports:profitAndLossSQL':
        return services.reports.getProfitAndLossSQL(a[0] || {});
      case 'pos:reports:promotionUsage':
        return services.reports.getPromotionUsageReport(a[0] || {});
      case 'pos:reports:inventoryValuation':
        return services.reports.getInventoryValuationReport(a[0] || {});
      case 'pos:reports:inventoryValuationSummary':
        return services.reports.getInventoryValuationSummary(a[0] || {});
      case 'pos:reports:customerAging':
        return services.reports.getCustomerAging();
      case 'pos:reports:supplierAging':
        return services.reports.getSupplierAging();
      case 'pos:reports:vipCustomers':
        return services.reports.getVIPCustomers(a[0] || {});
      case 'pos:reports:loyaltyPointsSummary':
        return services.reports.getLoyaltyPointsSummary(a[0] || {});
      case 'pos:reports:lostCustomers':
        return services.reports.getLostCustomers(a[0] || {});
      case 'pos:reports:customerProfitability':
        return services.reports.getCustomerProfitability(a[0] || {});
      case 'pos:reports:deliveryAccuracy':
        return services.reports.getDeliveryAccuracy(a[0] || {});
      case 'pos:reports:deliveryDetails':
        return services.reports.getDeliveryDetails(a[0] || {});
      case 'pos:reports:priceHistory':
        return services.reports.getPriceHistory(a[0] || {});
      case 'pos:reports:productPriceSummary':
        return services.reports.getProductPriceSummary(a[0] || {});
      case 'pos:reports:purchaseSaleSpread':
        return services.reports.getPurchaseSaleSpread(a[0] || {});
      case 'pos:reports:spreadTimeSeries':
        return services.reports.getSpreadTimeSeries(a[0] || {});
      case 'pos:reports:cashierErrors':
        return services.reports.getCashierErrors(a[0] || {});
      case 'pos:reports:cashierErrorDetails':
        return services.reports.getCashierErrorDetails(a[0] || {});
      case 'pos:reports:shiftProductivity':
        return services.reports.getShiftProductivity(a[0] || {});
      case 'pos:reports:productivitySummary':
        return services.reports.getProductivitySummary(a[0] || {});
      case 'pos:reports:fraudSignals':
        return services.reports.getFraudSignals(a[0] || {});
      case 'pos:reports:fraudIncidents':
        return services.reports.getFraudIncidents(a[0] || {});
      case 'pos:reports:deviceHealth':
        return services.reports.getDeviceHealth();
      case 'pos:reports:deviceIncidents':
        return services.reports.getDeviceIncidents();
      case 'pos:reports:auditLog':
        return services.reports.getAuditLog(a[0] || {});
      case 'pos:reports:priceChangeHistory':
        return services.reports.getPriceChangeHistory(a[0] || {});
      case 'pos:reports:executiveKPI':
        return services.reports.getExecutiveKPI(a[0] || {});
      case 'pos:reports:executiveTrends':
        return services.reports.getExecutiveTrends(a[0] || {});

      // ======================================================================
      // Files — mostly OS-native in Electron; in server mode we expose
      // HTTP-friendly alternatives and return clear errors for dialog-based
      // channels (they have no meaning without a desktop window).
      // ======================================================================
      case 'pos:files:selectSavePath':
      case 'pos:files:selectImageFile':
      case 'pos:files:saveTextFile':
      case 'pos:files:openTextFile':
      case 'pos:files:writeFile':
      case 'pos:files:readFile':
      case 'pos:files:exists':
      case 'pos:files:saveProductImage':
      case 'pos:files:pathToFileUrl':
        throw createError(
          ERROR_CODES.PERMISSION_DENIED,
          `Channel "${channel}" requires local OS access and is not available over RPC. ` +
            'Use HTTP upload/download endpoints or the Electron desktop client instead.',
        );

      // ======================================================================
      // Print (ESC/POS thermal) — requires local USB/spooler access.
      // Not exposed over the network. Use a "Print Agent" on the cashier PC.
      // ======================================================================
      case 'pos:print:receipt':
        throw createError(
          ERROR_CODES.PERMISSION_DENIED,
          'Thermal printing requires a local device. Run a print agent on the cashier PC ' +
            'and forward receipt payloads to it via LAN.',
        );

      default:
        throw createError(ERROR_CODES.NOT_FOUND, `Unknown channel: ${channel}`);
    }
  });

  // Backward compatible:
  //   dispatch(channel, args)               — legacy
  //   dispatch(channel, args, meta)         — new (hostServer passes meta)
  return async function dispatch(channel, args, metaOrEvent = null) {
    // Heuristic: hostServer passes { authContext/adminBypass/ip/userAgent };
    // legacy callers passed an Electron IpcEvent-like object or null.
    const looksLikeMeta =
      metaOrEvent &&
      typeof metaOrEvent === 'object' &&
      ('authContext' in metaOrEvent ||
        'adminBypass' in metaOrEvent ||
        'ip' in metaOrEvent);

    const stop = startTimer();
    const authLabel = looksLikeMeta && metaOrEvent.adminBypass
      ? 'admin'
      : looksLikeMeta && metaOrEvent.authContext
        ? 'session'
        : 'none';

    try {
      const result = looksLikeMeta
        ? await exec(null, channel, args, metaOrEvent)
        : await exec(metaOrEvent, channel, args);
      if (metrics) {
        metrics.rpcCallsTotal.inc({ channel, outcome: 'ok', auth: authLabel });
        metrics.rpcCallDurationSeconds.observe({ channel }, stop());
      }
      return result;
    } catch (err) {
      if (metrics) {
        // `wrapHandler` rethrows structured `{ code, message }` errors. Treat
        // PERMISSION_DENIED specially so alerts don't fire on every denied op.
        const code = err?.code || 'UNKNOWN';
        const outcome = code === 'PERMISSION_DENIED' ? 'denied' : 'error';
        metrics.rpcCallsTotal.inc({ channel, outcome, auth: authLabel });
        metrics.rpcCallDurationSeconds.observe({ channel }, stop());
        if (outcome === 'error' && /SQLITE|database|no such table|column/i.test(String(err?.message || ''))) {
          metrics.dbQueryErrorsTotal.inc({ channel });
        }
      }
      throw err;
    }
  };
}

module.exports = { createRpcDispatcher };







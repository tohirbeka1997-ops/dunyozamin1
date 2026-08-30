const { ERROR_CODES, createError } = require('../lib/errors.cjs');
const {
  formatYmdInTimeZone,
  UZBEKISTAN_TZ_SQLITE_OFFSET,
  UZBEKISTAN_TZ_ISO_OFFSET,
} = require('../lib/timezone.cjs');
const { createCurrencyLedger, supplierPaymentCashUzsSql } = require('../lib/currencyLedger.cjs');
const { expenseAmountUzsSql } = require('../lib/expenseAmount.cjs');
const {
  orderAmountUzsSql,
  orderFieldUzsSql,
  orderLinkedFieldUzsSql,
  orderSalesSplitExpressions,
  returnRefundUzsSql,
  customerPaymentAmountUzsSql,
  webOrderAmountUzsSql,
  paymentAmountUzsSql,
} = require('../lib/orderAmount.cjs');
const { orderIsUsdExpr, hasCustomerBalanceUsd, reconcileCustomerLedgerVsBalance } = require('../lib/customerBalance.cjs');
const {
  useUnifiedSales,
  salesFrom,
  saleItemsFrom,
  saleItemsOrderJoin,
  completedStatusWhere,
  unifiedAmountUzsSql,
  unifiedFieldUzsSql,
  unifiedSalesSplitExpressions,
  cogsLineSql,
  returnCogsLineSql,
  calculateNetProfit,
  soldLineRevenueSql,
  soldLineRevenueUzsSql,
  soldUnitPriceSql,
  profitLineSql,
  salesChannelWhere,
  isPosCartReturnAmount,
  posCartReturnExcludeWhere,
} = require('../lib/unifiedSalesSql.cjs');
const { movementBalanceCteSql } = require('../lib/inventorySnapshot.cjs');
const { sumPaymentFeesForPeriod, classifyPaymentMethodGroup } = require('../lib/paymentFee.cjs');
const { classifyAbcRows } = require('../lib/abcAnalysis.cjs');
const {
  DEFAULT_WALK_IN_CUSTOMER,
  bucketAgeDays,
  initBuckets,
  addToBuckets,
  bucketSum,
  allocateFifoPool,
} = require('../lib/agingCalc.cjs');

/**
 * Reports Service
 * Provides aggregated reporting queries for dashboard and reporting pages.
 */
class ReportsService {
  constructor(db) {
    this.db = db;
    this._tables = null;
    /** @type {{ at: number, payload: { devices: any[], incidents: any[] } } | null} */
    this._deviceHealthCache = null;
  }

  // DO NOT USE products.purchase_price for accounting reports

  _getTables() {
    if (this._tables) return this._tables;
    const rows = this.db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() || [];
    this._tables = new Set(rows.map((r) => r.name));
    return this._tables;
  }

  _hasTable(name) {
    return this._getTables().has(name);
  }

  _hasView(name) {
    try {
      const row = this.db
        .prepare(`SELECT 1 AS ok FROM sqlite_master WHERE type='view' AND name = ? LIMIT 1`)
        .get(String(name));
      return !!row?.ok;
    } catch {
      return false;
    }
  }

  _useUnifiedSales() {
    return useUnifiedSales(this.db);
  }

  _salesTable() {
    return salesFrom(this.db);
  }

  _saleItemsTable() {
    return saleItemsFrom(this.db);
  }

  _cogsLineSql(itemAlias = 'oi', qtyExpr = null) {
    return cogsLineSql(itemAlias, qtyExpr);
  }

  _soldLineRevenueSql(itemAlias = 'oi') {
    return soldLineRevenueSql(itemAlias);
  }

  _soldLineRevenueUzsSql(itemAlias = 'oi') {
    return soldLineRevenueUzsSql(this.db, 'o', itemAlias);
  }

  _soldUnitPriceSql(itemAlias = 'oi') {
    return soldUnitPriceSql(itemAlias);
  }

  _profitLineSql(itemAlias = 'oi', qtyExpr = null) {
    return profitLineSql(itemAlias, qtyExpr);
  }

  _returnCogsLineSql(orderItemAlias = 'oi', returnQtyExpr) {
    return returnCogsLineSql(orderItemAlias, returnQtyExpr);
  }

  _calculateNetProfit(components) {
    return calculateNetProfit(components);
  }

  _sumPeriodCommissions(dateFrom, dateTo, warehouseId) {
    return sumPaymentFeesForPeriod(this.db, {
      dateFrom,
      dateTo,
      warehouseId,
      tzDateExpr: (col) => this._tzDateExpr(col),
    });
  }

  _accountingWarnings(filters = {}) {
    const base = this.validateAccountingConsistency(filters) || {};
    const missing = Number(base.missing_cost_count || 0) || 0;
    return {
      ...base,
      cogs_missing: missing > 0,
      accounting_cogs_missing: missing > 0,
    };
  }

  _hasSaleSource() {
    if (this._useUnifiedSales()) {
      return this._hasView('v_unified_sales') && this._hasView('v_unified_sale_items');
    }
    return this._hasTable('orders') && this._hasTable('order_items');
  }

  _hasSaleItemsSource() {
    if (this._useUnifiedSales()) return this._hasView('v_unified_sale_items');
    return this._hasTable('order_items');
  }

  /** Akt sverka / tarix: asl sxema `sales_returns`, baʼzi arxiv DBlarda `sale_*`. */
  _salesReturnTableNames() {
    if (this._hasTable('sales_returns') && this._hasTable('return_items')) {
      return { table: 'sales_returns', items: 'return_items' };
    }
    if (this._hasTable('sale_returns') && this._hasTable('sale_return_items')) {
      return { table: 'sale_returns', items: 'sale_return_items' };
    }
    return { table: null, items: null };
  }

  /** POS savat qaytarishi: manfiy jami `orders` qatori (sales_returns emas). */
  _isPosCartReturnOrder(row) {
    const revenue = Number(row?.revenue ?? 0);
    const total = Number(row?.total_amount ?? 0);
    return isPosCartReturnAmount(revenue) || isPosCartReturnAmount(total);
  }

  /** Almashuv savati: jami musbat, lekin ichida manfiy (qaytarish) qatorlar bor. */
  _hasPosCartReturnLines(row) {
    return Number(row?.return_revenue_abs || 0) > 0.009;
  }

  _posCartReturnTotals(rows) {
    let total = 0;
    let profitImpact = 0;
    for (const o of rows || []) {
      const rev = Math.abs(Number(o.revenue ?? o.total_amount ?? 0));
      const profit = Math.abs(Number(o.profit ?? 0));
      total += rev;
      profitImpact += profit;
    }
    return { total, profitImpact, cogs: total - profitImpact };
  }

  _posCartReturnLineTotals(rows) {
    let total = 0;
    let profitImpact = 0;
    for (const o of rows || []) {
      const rev = Math.abs(Number(o.return_revenue_abs || 0));
      const profit = Math.abs(Number(o.return_profit_abs || 0));
      total += rev;
      profitImpact += profit;
    }
    return { total, profitImpact, cogs: total - profitImpact };
  }

  _posCartReturnRowsFromOrders(posCartReturns) {
    return (posCartReturns || []).map((o) => ({
      id: o.id,
      return_number: o.order_number,
      order_id: null,
      order_number: null,
      total_amount: Math.abs(Number(o.revenue ?? o.total_amount ?? 0)),
      refund_amount: Math.abs(Number(o.revenue ?? o.total_amount ?? 0)),
      refund_method:
        String(o.payment_method || '').toLowerCase() === 'refund_cash'
          ? 'refund_cash'
          : String(o.payment_method || '').toLowerCase() === 'refund_balance'
            ? 'refund_balance'
            : 'pos_cart',
      status: 'completed',
      cashier_id: o.cashier_id,
      user_id: o.user_id,
      created_at: o.created_at,
      return_source: 'pos_cart',
    }));
  }

  /** Almashuv ichidagi qaytarish qatorlari — alohida Qaytarilganlar yozuvi. */
  _posCartReturnLineRowsFromOrders(mixedOrders) {
    return (mixedOrders || [])
      .filter((o) => this._hasPosCartReturnLines(o))
      .map((o) => {
        const amt = Math.abs(Number(o.return_revenue_abs || 0));
        return {
          id: `${o.id}:cart_lines`,
          return_number: `${o.order_number || o.id}-RET`,
          order_id: o.id,
          order_number: o.order_number,
          total_amount: amt,
          refund_amount: amt,
          refund_method: 'pos_cart_line',
          status: 'completed',
          cashier_id: o.cashier_id,
          user_id: o.user_id,
          created_at: o.created_at,
          return_source: 'pos_cart_line',
        };
      });
  }

  _getSettingValue(key) {
    try {
      const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
      return row?.value ?? null;
    } catch {
      return null;
    }
  }

  _isTruthySetting(key) {
    const v = String(this._getSettingValue(key) ?? '').trim().toLowerCase();
    return v === '1' || v === 'true' || v === 'yes' || v === 'on';
  }

  _logMissingCostPrice(whereClause, params, context) {
    const itemsTable = this._saleItemsTable();
    const salesTable = this._salesTable();
    const orderJoinCol = this._useUnifiedSales() ? 'unified_order_id' : 'order_id';
    const salesJoinCol = this._useUnifiedSales() ? 'unified_id' : 'id';
    if (!this._hasSaleItemsSource() || (!this._hasView(salesTable) && !this._hasTable(salesTable))) return;
    try {
      const referencesProducts = /\bp\.[a-z_]/i.test(whereClause);
      const referencesCategories = /\bc\.[a-z_]/i.test(whereClause);
      const productJoin = referencesProducts && this._hasTable('products')
        ? 'LEFT JOIN products p ON p.id = oi.product_id'
        : '';
      const categoryJoin = referencesCategories && this._hasTable('categories')
        ? 'LEFT JOIN categories c ON c.id = p.category_id'
        : '';

      const countRow = this.db
        .prepare(
          `
          SELECT COUNT(*) AS missing_count
          FROM ${itemsTable} oi
          INNER JOIN ${salesTable} o ON o.${salesJoinCol} = oi.${orderJoinCol}
          ${productJoin}
          ${categoryJoin}
          ${whereClause}
            AND (oi.cost_price IS NULL OR oi.cost_price = 0)
        `
        )
        .get(params);
      const missingCount = Number(countRow?.missing_count || 0) || 0;
      if (missingCount > 0) {
        const sample = this.db
          .prepare(
            `
            SELECT oi.source_item_id AS id, oi.source_order_id AS order_id
            FROM ${itemsTable} oi
            INNER JOIN ${salesTable} o ON o.${salesJoinCol} = oi.${orderJoinCol}
            ${productJoin}
            ${categoryJoin}
            ${whereClause}
              AND (oi.cost_price IS NULL OR oi.cost_price = 0)
            LIMIT 5
          `
          )
          .all(params);
        console.warn('⚠️ ACCOUNTING_COGS_MISSING', {
          context,
          missing_count: missingCount,
          sample_items: sample,
        });
      }
    } catch (error) {
      console.warn('⚠️ ACCOUNTING_COGS_MISSING log failed:', error?.message || error);
    }
  }

  _ymd(date) {
    if (!date) return formatYmdInTimeZone(new Date());
    // Accept 'YYYY-MM-DD' or ISO-ish strings
    if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
    const ymd = formatYmdInTimeZone(date);
    if (!ymd) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, `Invalid date: ${date}`);
    }
    return ymd;
  }

  _tzDateExpr(columnExpr) {
    // DB timestamps are stored in UTC-like strings (ISO or "YYYY-MM-DD HH:mm:ss" without timezone).
    // For report day filters we align to Uzbekistan business day.
    return `date(datetime(replace(replace(${columnExpr}, 'T', ' '), 'Z', ''), '${UZBEKISTAN_TZ_SQLITE_OFFSET}'))`;
  }

  /** Soat:min:sek (Tashkent) — jadvalda `time(UTC)` o‘rniga */
  _tzTimeExpr(columnExpr) {
    return `time(datetime(replace(replace(${columnExpr}, 'T', ' '), 'Z', ''), '${UZBEKISTAN_TZ_SQLITE_OFFSET}'))`;
  }

  _bucketAgeDays(ageDays) {
    return bucketAgeDays(ageDays);
  }

  _initBuckets() {
    return initBuckets();
  }

  _addToBuckets(buckets, ageKey, amount) {
    return addToBuckets(buckets, ageKey, amount);
  }

  /** Calendar-day age in server (Tashkent) timezone: asOf YMD minus anchor date. */
  _ageDaysBetween(asOfYmd, anchor) {
    const asOf = this._ymd(asOfYmd);
    const anchorStr = String(anchor || '').trim();
    if (!anchorStr) return 0;
    let row;
    if (/^\d{4}-\d{2}-\d{2}$/.test(anchorStr.slice(0, 10))) {
      row = this.db
        .prepare(`SELECT CAST((julianday(?) - julianday(?)) AS INTEGER) AS age_days`)
        .get(asOf, anchorStr.slice(0, 10));
    } else {
      row = this.db
        .prepare(
          `
          SELECT CAST((
            julianday(?) - julianday(date(datetime(replace(replace(?, 'T', ' '), 'Z', ''), '${UZBEKISTAN_TZ_SQLITE_OFFSET}')))
          ) AS INTEGER) AS age_days
        `
        )
        .get(asOf, anchorStr);
    }
    const days = Number(row?.age_days || 0) || 0;
    return days < 0 ? 0 : days;
  }

  _agingAnchorDate(order) {
    if (order?.due_date) return String(order.due_date).slice(0, 10);
    return order?.created_at || order?.order_date || null;
  }

  _customerBalanceUsdSelect(alias = '') {
    const prefix = alias ? `${alias}.` : '';
    return hasCustomerBalanceUsd(this.db)
      ? `COALESCE(${prefix}balance_usd, 0) AS balance_usd`
      : '0 AS balance_usd';
  }

  _logAgingReconciliationDiffs(diffs) {
    if (!Array.isArray(diffs) || diffs.length === 0) return;
    console.warn('[reportsService.getAging] reconciliation diffs:', diffs.length);
    for (const d of diffs.slice(0, 20)) {
      console.warn(
        `[aging-reconcile] ${d.customer_id || d.supplier_id} ${d.customer_name || d.supplier_name || ''}: stored=${d.stored ?? d.stored_uzs} computed=${d.computed ?? d.computed_uzs} diff=${d.diff ?? d.diff_uzs}`
      );
    }
    if (diffs.length > 20) {
      console.warn(`[aging-reconcile] ... and ${diffs.length - 20} more`);
    }
  }

  /**
   * Daily sales summary for a specific date.
   * @param {string} date - YYYY-MM-DD
   * @param {string=} warehouseId
   */
  getDailySales(date, warehouseId, filters = {}) {
    const ymd = this._ymd(date);
    const params = [ymd];
    const salesTable = this._salesTable();
    const orderDateExpr = this._tzDateExpr('o.created_at');
    let where = `WHERE ${completedStatusWhere(this.db, 'o')} AND ${orderDateExpr} = date(?)`;
    if (warehouseId) {
      where += ` AND o.warehouse_id = ?`;
      params.push(warehouseId);
    }
    where += salesChannelWhere('o', filters.sales_channel, params);
    where += ` AND ${posCartReturnExcludeWhere(this.db, 'o')}`;

    const salesAmtUzs = unifiedAmountUzsSql(this.db, 'o');
    const salesSplit = unifiedSalesSplitExpressions(this.db, 'o');
    const discUzs = unifiedFieldUzsSql(this.db, 'o', 'o', 'o.discount_amount');
    const summary = this.db
      .prepare(
        `
        SELECT
          COUNT(*) AS order_count,
          COALESCE(SUM(${salesAmtUzs}), 0) AS total_sales,
          ${salesSplit.uzsSum} AS total_sales_uzs,
          ${salesSplit.usdSum} AS total_sales_usd,
          COALESCE(SUM(${discUzs}), 0) AS total_discount,
          COALESCE(SUM(o.tax_amount), 0) AS total_tax
        FROM ${salesTable} o
        ${where}
      `
      )
      .get(...params);

    // Payment breakdown: POS via payments table; web via web_orders when unified.
    const payUzs = paymentAmountUzsSql(this.db, 'p', 'o');
    const payParams = [ymd];
    let payWhere = `WHERE o.status = 'completed' AND ${orderDateExpr} = date(?)`;
    if (warehouseId) {
      payWhere += ` AND o.warehouse_id = ?`;
      payParams.push(warehouseId);
    }
    payWhere += salesChannelWhere('o', filters.sales_channel, payParams);

    const paymentBreakdown = this._hasTable('payments')
      ? this.db
          .prepare(
            `
            SELECT
              p.payment_method,
              COALESCE(SUM(${payUzs}), 0) AS amount
            FROM payments p
            INNER JOIN orders o ON o.id = p.order_id
            ${payWhere}
            GROUP BY p.payment_method
          `
          )
          .all(...payParams)
      : [];

    if (this._useUnifiedSales() && this._hasTable('web_orders')) {
      const webParams = [ymd];
      let webWhere = `WHERE (wo.status = 'delivered' OR wo.payment_status = 'paid')
        AND ${this._tzDateExpr('wo.created_at')} = date(?)`;
      webWhere += salesChannelWhere('wo', filters.sales_channel, webParams);
      try {
        const webRows = this.db
          .prepare(
            `
            SELECT COALESCE(wo.payment_method, 'other') AS payment_method,
                   COALESCE(SUM(${webOrderAmountUzsSql(this.db, 'wo')}), 0) AS amount
            FROM web_orders wo
            ${webWhere}
            GROUP BY COALESCE(wo.payment_method, 'other')
          `
          )
          .all(...webParams);
        paymentBreakdown.push(...webRows);
      } catch {
        // web_orders schema may be partial in some test DBs
      }
    }

    const buckets = { cash: 0, card: 0, credit: 0, other: 0 };
    for (const row of paymentBreakdown) {
      const amt = Number(row.amount || 0) || 0;
      const method = String(row.payment_method || '').toLowerCase().trim();
      if (method === 'cash' || method === 'naqd') {
        buckets.cash += amt;
      } else if (/(card|humo|uzcard|visa|master|payme|click|atm)/i.test(method)) {
        buckets.card += amt;
      } else if (/(credit|debt|nasiya|qarz|loan|balance)/i.test(method)) {
        buckets.credit += amt;
      } else {
        buckets.other += amt;
      }
    }

    const totalCommission = this._sumPeriodCommissions(ymd, ymd, warehouseId);

    let soldRevenue = 0;
    let soldCogs = 0;
    if (this._hasSaleItemsSource()) {
      try {
        const itemsTable = this._saleItemsTable();
        const orderJoinCol = this._useUnifiedSales() ? 'unified_order_id' : 'order_id';
        const salesJoinCol = this._useUnifiedSales() ? 'unified_id' : 'id';
        const soldRevExpr = this._soldLineRevenueUzsSql('oi');
        const cogsExpr = this._cogsLineSql('oi');
        const profitRow = this.db
          .prepare(
            `
            SELECT
              COALESCE(SUM(${soldRevExpr}), 0) AS sold_revenue,
              COALESCE(SUM(${cogsExpr}), 0) AS total_cogs
            FROM ${itemsTable} oi
            INNER JOIN ${salesTable} o ON o.${salesJoinCol} = oi.${orderJoinCol}
            ${where}
          `
          )
          .get(...params);
        soldRevenue = Number(profitRow?.sold_revenue || 0) || 0;
        soldCogs = Number(profitRow?.total_cogs || 0) || 0;
      } catch {
        /* schema partial in some test DBs */
      }
    }
    const netProfit = calculateNetProfit({
      grossProfit: soldRevenue - soldCogs,
      commission: totalCommission,
    });

    return {
      date: ymd,
      warehouse_id: warehouseId || null,
      total_sales: Number(summary?.total_sales || 0) || 0,
      order_count: Number(summary?.order_count || 0) || 0,
      total_discount: Number(summary?.total_discount || 0) || 0,
      total_tax: Number(summary?.total_tax || 0) || 0,
      payments: paymentBreakdown,
      cash_total: buckets.cash,
      card_total: buckets.card,
      credit_total: buckets.credit,
      other_payments_total: buckets.other,
      total_commission: totalCommission,
      payment_fees: totalCommission,
      net_profit: netProfit,
    };
  }

  /** Preload/RPC nomi bilan mos alias (`posApi.reports.dailySales`). */
  dailySales(date, warehouseId) {
    return this.getDailySales(date, warehouseId);
  }

  /**
   * Top products by revenue within a date range.
   * filters: { date_from?, date_to?, warehouse_id?, limit? }
   */
  getTopProducts(filters = {}) {
    const dateFrom = filters.date_from ? this._ymd(filters.date_from) : null;
    const dateTo = filters.date_to ? this._ymd(filters.date_to) : null;
    const limit = Number.isFinite(Number(filters.limit)) ? Number(filters.limit) : 10;
    const salesTable = this._salesTable();
    const itemsTable = this._saleItemsTable();
    const orderJoinCol = this._useUnifiedSales() ? 'unified_order_id' : 'order_id';
    const salesJoinCol = this._useUnifiedSales() ? 'unified_id' : 'id';

    const params = [];
    let where = `WHERE ${completedStatusWhere(this.db, 'o')}`;
    const orderDateExpr = this._tzDateExpr('o.created_at');
    if (filters.warehouse_id) {
      where += ` AND o.warehouse_id = ?`;
      params.push(filters.warehouse_id);
    }
    if (dateFrom) {
      where += ` AND ${orderDateExpr} >= date(?)`;
      params.push(dateFrom);
    }
    if (dateTo) {
      where += ` AND ${orderDateExpr} <= date(?)`;
      params.push(dateTo);
    }
    where += salesChannelWhere('o', filters.sales_channel, params);

    const rows = this.db
      .prepare(
        `
        SELECT
          oi.product_id,
          oi.product_name,
          COALESCE(SUM(oi.quantity), 0) AS quantity_sold,
          COALESCE(SUM(oi.line_total), 0) AS total_amount
        FROM ${itemsTable} oi
        INNER JOIN ${salesTable} o ON o.${salesJoinCol} = oi.${orderJoinCol}
        ${where}
        GROUP BY oi.product_id, oi.product_name
        ORDER BY total_amount DESC
        LIMIT ?
      `
      )
      .all([...params, limit]);

    return rows.map((r) => ({
      product_id: r.product_id,
      product_name: r.product_name,
      quantity_sold: Number(r.quantity_sold || 0) || 0,
      total_amount: Number(r.total_amount || 0) || 0,
    }));
  }

  /**
   * Preload/RPC nomi bilan mos alias (`posApi.reports.topProducts`).
   * - `topProducts({ date_from, date_to, warehouse_id, limit })`
   * - `topProducts(startDate, endDate, limit?)` — pozitsion chaqiruvlar uchun
   */
  topProducts(a, b, c) {
    if (a != null && typeof a === 'object' && !Array.isArray(a) && b === undefined && c === undefined) {
      return this.getTopProducts(a);
    }
    const lim = c != null && Number.isFinite(Number(c)) ? Number(c) : 10;
    return this.getTopProducts({
      date_from: a ?? undefined,
      date_to: b ?? undefined,
      limit: lim,
    });
  }

  /**
   * Product Sales Report (by product) within a date range.
   * filters: { date_from?, date_to?, category_id?, warehouse_id? }
   *
   * Returns rows shaped for UI:
   * {
   *   product_id, product_name, sku, category_name,
   *   quantity_sold, revenue, cost, profit, profit_margin
   * }
   */
  getPromotionUsageReport(filters = {}) {
    if (!this._hasTable('promotion_usage')) return [];
    let dateFrom = filters.date_from ? this._ymd(filters.date_from) : null;
    let dateTo = filters.date_to ? this._ymd(filters.date_to) : null;
    // Invalid range (from > to) → swap so the query never silently returns empty forever
    if (dateFrom && dateTo && dateFrom > dateTo) {
      const tmp = dateFrom;
      dateFrom = dateTo;
      dateTo = tmp;
    }
    const promotionId = filters.promotion_id || null;
    const warehouseId = filters.warehouse_id || null;
    const isAllWarehouses = String(filters.warehouse_id || '').toUpperCase() === 'ALL';

    const hasOrders = this._hasTable('orders');
    const params = [];
    let where = '1=1';
    const promoDateExpr = this._tzDateExpr('pu.applied_at');
    if (dateFrom) {
      where += ` AND ${promoDateExpr} >= date(?)`;
      params.push(dateFrom);
    }
    if (dateTo) {
      where += ` AND ${promoDateExpr} <= date(?)`;
      params.push(dateTo);
    }
    if (promotionId) {
      where += ' AND pu.promotion_id = ?';
      params.push(promotionId);
    }

    // Prefer usages tied to completed POS orders; exclude cart-return (negative) orders.
    let orderJoin = '';
    let discountSumExpr = `COALESCE(SUM(pu.discount_amount), 0)`;
    if (hasOrders) {
      orderJoin = `INNER JOIN orders o ON o.id = pu.order_id`;
      // Always filter raw orders.status (not unified-sales completedStatusWhere).
      where += ` AND o.status = 'completed'`;
      where += ` AND ${posCartReturnExcludeWhere(this.db, 'o')}`;
      if (warehouseId && !isAllWarehouses) {
        where += ' AND o.warehouse_id = ?';
        params.push(warehouseId);
      }
      // Discount in UZS equivalent when order currency is USD
      discountSumExpr = `COALESCE(SUM(${orderLinkedFieldUzsSql(this.db, 'o', 'pu.discount_amount')}), 0)`;
    }

    const rows = this.db
      .prepare(
        `
      SELECT
        pu.promotion_id,
        MAX(p.name) AS promotion_name,
        MAX(p.type) AS promotion_type,
        COUNT(*) AS usage_count,
        ${discountSumExpr} AS total_discount
      FROM promotion_usage pu
      ${orderJoin}
      LEFT JOIN promotions p ON p.id = pu.promotion_id
      WHERE ${where}
      GROUP BY pu.promotion_id
      ORDER BY total_discount DESC
    `
      )
      .all(...params);

    return (rows || []).map((r) => ({
      promotion_id: r.promotion_id,
      promotion_name: r.promotion_name || null,
      promotion_type: r.promotion_type || null,
      usage_count: Number(r.usage_count) || 0,
      total_discount: Number(r.total_discount) || 0,
    }));
  }

  /**
   * Product sales by product for a period.
   * filters: { date_from?, date_to?, warehouse_id?, category_id?, price_tier?, sales_channel? }
   *
   * Gross completed sales (UZS equiv. + USD split), excluding POS cart-return
   * orders (same `posCartReturnExcludeWhere` as daily sales / ABC). Formal
   * `sales_returns` are not netted — see UI scope note.
   */
  getProductSalesReport(filters = {}) {
    const dateFrom = filters.date_from ? this._ymd(filters.date_from) : null;
    const dateTo = filters.date_to ? this._ymd(filters.date_to) : null;
    const categoryId = filters.category_id || null;
    const priceTier = filters.price_tier || null;

    // Schema safety: missing core tables → empty (rather than SqliteError)
    const salesTable = this._salesTable();
    const itemsTable = this._saleItemsTable();
    if (!this._hasSaleSource()) return [];

    const orderJoinCol = this._useUnifiedSales() ? 'unified_order_id' : 'order_id';
    const salesJoinCol = this._useUnifiedSales() ? 'unified_id' : 'id';

    const hasOrderItemsPriceTier = !this._useUnifiedSales() && (() => {
      try {
        return !!this.db
          .prepare(`SELECT 1 AS ok FROM pragma_table_info('order_items') WHERE name = 'price_tier' LIMIT 1`)
          .get()?.ok;
      } catch {
        return false;
      }
    })();

    const params = [];
    let where = `WHERE ${completedStatusWhere(this.db, 'o')}`;
    const orderDateExpr = this._tzDateExpr('o.created_at');

    if (filters.warehouse_id) {
      where += ` AND o.warehouse_id = ?`;
      params.push(filters.warehouse_id);
    }
    if (dateFrom) {
      where += ` AND ${orderDateExpr} >= date(?)`;
      params.push(dateFrom);
    }
    if (dateTo) {
      where += ` AND ${orderDateExpr} <= date(?)`;
      params.push(dateTo);
    }
    if (categoryId) {
      where += ` AND p.category_id = ?`;
      params.push(categoryId);
    }
    if (priceTier && hasOrderItemsPriceTier) {
      where += ` AND COALESCE(oi.price_tier, 'retail') = ?`;
      params.push(priceTier);
    }
    where += salesChannelWhere('o', filters.sales_channel, params);
    where += ` AND ${posCartReturnExcludeWhere(this.db, 'o')}`;

    const lineUzs = unifiedFieldUzsSql(this.db, 'o', 'oi', this._soldLineRevenueSql('oi'));
    const cogsExpr = this._cogsLineSql('oi');
    const rows = this.db
      .prepare(
        `
        SELECT
          oi.product_id,
          COALESCE(p.name, oi.product_name, '') AS product_name,
          COALESCE(p.sku, '') AS sku,
          COALESCE(c.name, '') AS category_name,
          COALESCE(SUM(oi.quantity), 0) AS quantity_sold,
          COALESCE(SUM(${lineUzs}), 0) AS revenue,
          COALESCE(SUM(CASE
            WHEN UPPER(TRIM(COALESCE(o.currency, 'UZS'))) = 'USD' THEN 0
            ELSE ${this._soldLineRevenueSql('oi')}
          END), 0) AS revenue_uzs,
          COALESCE(SUM(CASE
            WHEN UPPER(TRIM(COALESCE(o.currency, 'UZS'))) = 'USD'
            THEN ${this._soldLineRevenueSql('oi')}
            ELSE 0
          END), 0) AS revenue_usd,
          ${
            hasOrderItemsPriceTier
              ? `COALESCE(SUM(CASE WHEN COALESCE(oi.price_tier, 'retail') = 'master' THEN ${lineUzs} ELSE 0 END), 0) AS master_revenue,`
              : `0 AS master_revenue,`
          }
          ${
            hasOrderItemsPriceTier
              ? `COALESCE(SUM(CASE WHEN COALESCE(oi.price_tier, 'retail') != 'master' THEN ${lineUzs} ELSE 0 END), 0) AS retail_revenue,`
              : `COALESCE(SUM(${lineUzs}), 0) AS retail_revenue,`
          }
          COALESCE(SUM(${cogsExpr}), 0) AS cost
        FROM ${itemsTable} oi
        INNER JOIN ${salesTable} o ON o.${salesJoinCol} = oi.${orderJoinCol}
        LEFT JOIN products p ON p.id = oi.product_id
        LEFT JOIN categories c ON c.id = p.category_id
        ${where}
        GROUP BY oi.product_id, product_name, sku, category_name
        ORDER BY revenue DESC, quantity_sold DESC
      `
      )
      .all(params);

    this._logMissingCostPrice(where, params, 'product_sales_report');

    // Formal sales_returns (completed) by product for net revenue column.
    const returnByProduct = new Map();
    try {
      const hasSr = !!this.db
        .prepare(`SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name='sales_returns' LIMIT 1`)
        .get()?.ok;
      const hasRi = !!this.db
        .prepare(`SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name='return_items' LIMIT 1`)
        .get()?.ok;
      if (hasSr && hasRi) {
        const rParams = [];
        let rWhere = `WHERE LOWER(TRIM(COALESCE(sr.status,''))) = 'completed'`;
        const retDateExpr = this._tzDateExpr
          ? this._tzDateExpr('sr.created_at')
          : `DATE(sr.created_at)`;
        if (dateFrom) {
          rWhere += ` AND ${retDateExpr} >= date(?)`;
          rParams.push(dateFrom);
        }
        if (dateTo) {
          rWhere += ` AND ${retDateExpr} <= date(?)`;
          rParams.push(dateTo);
        }
        const rRows = this.db
          .prepare(
            `
            SELECT
              ri.product_id,
              COALESCE(SUM(ri.quantity), 0) AS return_qty,
              COALESCE(SUM(ri.line_total), 0) AS return_amount
            FROM return_items ri
            INNER JOIN sales_returns sr ON sr.id = ri.return_id
            ${rWhere}
            GROUP BY ri.product_id
          `,
          )
          .all(rParams);
        for (const rr of rRows || []) {
          if (!rr?.product_id) continue;
          returnByProduct.set(String(rr.product_id), {
            return_qty: Number(rr.return_qty || 0) || 0,
            return_amount: Number(rr.return_amount || 0) || 0,
          });
        }
      }
    } catch {
      /* keep gross-only if returns schema unavailable */
    }

    return (rows || []).map((r) => {
      const revenue = Number(r.revenue || 0) || 0;
      const retailRevenue = Number(r.retail_revenue || 0) || 0;
      const masterRevenue = Number(r.master_revenue || 0) || 0;
      const cost = Number(r.cost || 0) || 0;
      const ret = returnByProduct.get(String(r.product_id)) || { return_qty: 0, return_amount: 0 };
      const returnAmount = Number(ret.return_amount || 0) || 0;
      const returnQty = Number(ret.return_qty || 0) || 0;
      const netRevenue = revenue - returnAmount;
      const profit = netRevenue - cost;
      const profitMargin = netRevenue > 0 ? (profit / netRevenue) * 100 : 0;
      return {
        product_id: r.product_id,
        product_name: r.product_name,
        sku: r.sku,
        category_name: r.category_name,
        quantity_sold: Number(r.quantity_sold || 0) || 0,
        return_qty: returnQty,
        return_amount: returnAmount,
        revenue,
        net_revenue: netRevenue,
        revenue_uzs: Number(r.revenue_uzs || 0) || 0,
        revenue_usd: Number(r.revenue_usd || 0) || 0,
        retail_revenue: retailRevenue,
        master_revenue: masterRevenue,
        cost,
        profit,
        profit_margin: profitMargin,
      };
    });
  }

  /**
   * ABC analysis: products ranked by sales revenue in a period, classified A/B/C.
   * filters: { date_from?, date_to?, warehouse_id?, category_id?, sales_channel? }
   *
   * Gross completed sales (UZS equiv.), excluding POS cart-return orders
   * (same `posCartReturnExcludeWhere` as daily sales). Formal `sales_returns`
   * are not netted — see UI scope note.
   *
   * Returns { rows, summary, thresholds, date_from, date_to }
   */
  getAbcAnalysis(filters = {}) {
    const dateFrom = filters.date_from ? this._ymd(filters.date_from) : null;
    const dateTo = filters.date_to ? this._ymd(filters.date_to) : null;
    const categoryId = filters.category_id || null;

    if (!this._hasSaleSource()) {
      return {
        rows: [],
        summary: {
          total_revenue: 0,
          a: { count: 0, revenue: 0, revenue_share_pct: 0 },
          b: { count: 0, revenue: 0, revenue_share_pct: 0 },
          c: { count: 0, revenue: 0, revenue_share_pct: 0 },
        },
        thresholds: { a: 80, b: 95 },
        date_from: dateFrom,
        date_to: dateTo,
      };
    }

    const salesTable = this._salesTable();
    const itemsTable = this._saleItemsTable();
    const orderJoinCol = this._useUnifiedSales() ? 'unified_order_id' : 'order_id';
    const salesJoinCol = this._useUnifiedSales() ? 'unified_id' : 'id';

    const params = [];
    let where = `WHERE ${completedStatusWhere(this.db, 'o')}`;
    const orderDateExpr = this._tzDateExpr('o.created_at');

    if (filters.warehouse_id) {
      where += ` AND o.warehouse_id = ?`;
      params.push(filters.warehouse_id);
    }
    if (dateFrom) {
      where += ` AND ${orderDateExpr} >= date(?)`;
      params.push(dateFrom);
    }
    if (dateTo) {
      where += ` AND ${orderDateExpr} <= date(?)`;
      params.push(dateTo);
    }
    if (categoryId) {
      where += ` AND p.category_id = ?`;
      params.push(categoryId);
    }
    where += salesChannelWhere('o', filters.sales_channel, params);
    where += ` AND ${posCartReturnExcludeWhere(this.db, 'o')}`;

    const lineUzs = unifiedFieldUzsSql(this.db, 'o', 'oi', this._soldLineRevenueSql('oi'));
    const salesRows = this.db
      .prepare(
        `
        SELECT
          oi.product_id,
          MAX(COALESCE(p.name, oi.product_name, '')) AS product_name,
          MAX(COALESCE(p.sku, '')) AS sku,
          MAX(COALESCE(c.name, '')) AS category_name,
          COALESCE(SUM(oi.quantity), 0) AS quantity_sold,
          COALESCE(SUM(${lineUzs}), 0) AS sales_amount
        FROM ${itemsTable} oi
        INNER JOIN ${salesTable} o ON o.${salesJoinCol} = oi.${orderJoinCol}
        LEFT JOIN products p ON p.id = oi.product_id
        LEFT JOIN categories c ON c.id = p.category_id
        ${where}
        GROUP BY oi.product_id
        HAVING COALESCE(SUM(${lineUzs}), 0) > 0
        ORDER BY sales_amount DESC
      `
      )
      .all(params);

    const productIds = (salesRows || []).map((r) => r.product_id).filter(Boolean);
    const stockByProduct = new Map();

    const loadStockForIds = (ids, runChunk) => {
      const CHUNK = 400;
      for (let i = 0; i < ids.length; i += CHUNK) {
        const chunk = ids.slice(i, i + CHUNK);
        const rows = runChunk(chunk);
        for (const s of rows || []) {
          stockByProduct.set(s.product_id, Number(s.qty || 0) || 0);
        }
      }
    };

    if (productIds.length && this._hasTable('stock_balances')) {
      try {
        if (filters.warehouse_id) {
          loadStockForIds(productIds, (chunk) => {
            const placeholders = chunk.map(() => '?').join(',');
            return this.db
              .prepare(
                `
                SELECT product_id, COALESCE(SUM(quantity), 0) AS qty
                FROM stock_balances
                WHERE warehouse_id = ? AND product_id IN (${placeholders})
                GROUP BY product_id
              `
              )
              .all(filters.warehouse_id, ...chunk);
          });
        } else {
          loadStockForIds(productIds, (chunk) => {
            const placeholders = chunk.map(() => '?').join(',');
            return this.db
              .prepare(
                `
                SELECT product_id, COALESCE(SUM(quantity), 0) AS qty
                FROM stock_balances
                WHERE product_id IN (${placeholders})
                GROUP BY product_id
              `
              )
              .all(...chunk);
          });
        }
      } catch {
        // stock optional
      }
    } else if (productIds.length && this._hasTable('products')) {
      try {
        const hasCurrent = !!this.db
          .prepare(`SELECT 1 AS ok FROM pragma_table_info('products') WHERE name = 'current_stock' LIMIT 1`)
          .get()?.ok;
        if (hasCurrent) {
          loadStockForIds(productIds, (chunk) => {
            const placeholders = chunk.map(() => '?').join(',');
            return this.db
              .prepare(
                `
                SELECT id AS product_id, COALESCE(current_stock, 0) AS qty
                FROM products
                WHERE id IN (${placeholders})
              `
              )
              .all(...chunk);
          });
        }
      } catch {
        // stock optional
      }
    }

    const classified = classifyAbcRows(
      (salesRows || []).map((r) => ({
        product_id: r.product_id,
        product_name: r.product_name,
        sku: r.sku,
        category_name: r.category_name,
        quantity_sold: Number(r.quantity_sold || 0) || 0,
        sales_amount: Number(r.sales_amount || 0) || 0,
        current_stock: stockByProduct.has(r.product_id)
          ? stockByProduct.get(r.product_id)
          : null,
      }))
    );

    return {
      ...classified,
      date_from: dateFrom,
      date_to: dateTo,
    };
  }

  /**
   * Latest purchase receipt cost per product.
   * Returns map: { [product_id]: unit_cost }
   */
  getLatestPurchaseCosts() {
    if (!this._hasTable('purchase_receipts') || !this._hasTable('purchase_receipt_items')) {
      return {};
    }
    const rows = this.db
      .prepare(
        `
        SELECT pri.product_id, pri.unit_cost
        FROM purchase_receipt_items pri
        INNER JOIN purchase_receipts pr ON pr.id = pri.receipt_id
        WHERE pri.id = (
          SELECT pri2.id
          FROM purchase_receipt_items pri2
          INNER JOIN purchase_receipts pr2 ON pr2.id = pri2.receipt_id
          WHERE pri2.product_id = pri.product_id
          ORDER BY
            COALESCE(pr2.received_at, pr2.created_at) DESC,
            COALESCE(pr2.created_at, pr2.received_at) DESC,
            pri2.id DESC
          LIMIT 1
        )
      `
      )
      .all();

    const map = {};
    for (const r of rows || []) {
      if (!r?.product_id) continue;
      map[r.product_id] = Number(r.unit_cost || 0) || 0;
    }
    return map;
  }

  /**
   * Stock report (per warehouse if provided, else all warehouses).
   */
  getStockReport(warehouseId) {
    const params = [];
    let where = `WHERE p.track_stock = 1`;

    if (warehouseId) {
      where += ` AND sb.warehouse_id = ?`;
      params.push(warehouseId);
    }

    const rows = this.db
      .prepare(
        `
        SELECT
          sb.product_id,
          p.name AS product_name,
          p.sku,
          sb.warehouse_id,
          w.name AS warehouse_name,
          sb.quantity AS current_stock,
          COALESCE(p.min_stock_level, 0) AS min_stock_level,
          CASE
            WHEN sb.quantity <= 0 THEN 'out_of_stock'
            WHEN sb.quantity <= COALESCE(p.min_stock_level, 0) THEN 'low_stock'
            ELSE 'in_stock'
          END AS stock_status
        FROM stock_balances sb
        INNER JOIN products p ON p.id = sb.product_id
        INNER JOIN warehouses w ON w.id = sb.warehouse_id
        ${where}
        ORDER BY p.name ASC
      `
      )
      .all(params);

    return rows.map((r) => ({
      ...r,
      current_stock: Number(r.current_stock || 0) || 0,
      min_stock_level: Number(r.min_stock_level || 0) || 0,
    }));
  }

  /**
   * Inventory valuation (accounting-safe).
   * filters: { warehouse_id?: string|'ALL', status?: 'active'|'inactive'|'all' }
   */
  getInventoryValuation(filters = {}) {
    const warehouseIdRaw = filters.warehouse_id;
    const isAllWarehouses = !warehouseIdRaw || String(warehouseIdRaw).toUpperCase() === 'ALL';
    const warehouseId = isAllWarehouses ? null : warehouseIdRaw;
    if (!this._hasTable('products') || !this._hasTable('stock_balances')) {
      return [];
    }

    const fifoEnabled =
      this._isTruthySetting('inventory.fifo_enabled') ||
      this._isTruthySetting('inventory.batch_mode_enabled') ||
      this._isTruthySetting('batch_mode_enabled');
    const hasBatches = this._hasTable('inventory_batches');
    const useFifo = fifoEnabled && hasBatches;
    let batchCostExpr = 'COALESCE(unit_cost, 0)';
    if (useFifo) {
      try {
        const batchCols = new Set(
          (this.db.prepare(`PRAGMA table_info(inventory_batches)`).all() || []).map((c) => c.name)
        );
        if (batchCols.has('cost_price_uzs')) {
          batchCostExpr = 'COALESCE(cost_price_uzs, unit_cost, 0)';
        }
      } catch {
        /* keep unit_cost */
      }
    }

    const statusFilter = filters.status || 'active';
    const statusWhere =
      statusFilter === 'inactive'
        ? `AND p.is_active = 0`
        : statusFilter === 'all'
          ? `AND 1=1`
          : `AND p.is_active = 1`;

    if (useFifo) {
      if (isAllWarehouses) {
        return this.db
          .prepare(
            `
            WITH batch_costs AS (
              SELECT
                product_id,
                SUM(remaining_qty) AS remaining_qty,
                SUM(remaining_qty * ${batchCostExpr}) AS remaining_value
              FROM inventory_batches
              GROUP BY product_id
            ),
            stock_totals AS (
              SELECT product_id, SUM(quantity) AS quantity
              FROM stock_balances
              GROUP BY product_id
            )
            SELECT
              p.id AS product_id,
              p.name AS product_name,
              p.sku AS product_sku,
              p.category_id,
              c.name AS category_name,
              COALESCE(p.min_stock_level, 0) AS min_stock_level,
              COALESCE(st.quantity, 0) AS current_stock,
              CASE
                WHEN COALESCE(st.quantity, 0) > 0 THEN (
                  COALESCE(bc.remaining_value, 0)
                  + MAX(0, COALESCE(st.quantity, 0) - COALESCE(bc.remaining_qty, 0)) * COALESCE(p.purchase_price, 0)
                ) / st.quantity
                ELSE COALESCE(NULLIF(p.purchase_price, 0), 0)
              END AS unit_cost,
              (
                COALESCE(bc.remaining_value, 0)
                + MAX(0, COALESCE(st.quantity, 0) - COALESCE(bc.remaining_qty, 0)) * COALESCE(p.purchase_price, 0)
              ) AS stock_value
            FROM products p
            LEFT JOIN categories c ON c.id = p.category_id
            LEFT JOIN stock_totals st ON st.product_id = p.id
            LEFT JOIN batch_costs bc ON bc.product_id = p.id
            WHERE 1=1
              ${statusWhere}
            ORDER BY p.name ASC
          `
          )
          .all();
      }
      return this.db
        .prepare(
          `
          WITH batch_costs AS (
            SELECT
              product_id,
              warehouse_id,
              SUM(remaining_qty) AS remaining_qty,
              SUM(remaining_qty * ${batchCostExpr}) AS remaining_value
            FROM inventory_batches
            WHERE warehouse_id = ?
            GROUP BY product_id, warehouse_id
          )
          SELECT
            p.id AS product_id,
            p.name AS product_name,
            p.sku AS product_sku,
            p.category_id,
            c.name AS category_name,
            COALESCE(p.min_stock_level, 0) AS min_stock_level,
            COALESCE(sb.quantity, 0) AS current_stock,
            CASE
              WHEN COALESCE(sb.quantity, 0) > 0 THEN (
                COALESCE(bc.remaining_value, 0)
                + MAX(0, COALESCE(sb.quantity, 0) - COALESCE(bc.remaining_qty, 0)) * COALESCE(p.purchase_price, 0)
              ) / sb.quantity
              ELSE COALESCE(NULLIF(p.purchase_price, 0), 0)
            END AS unit_cost,
            (
              COALESCE(bc.remaining_value, 0)
              + MAX(0, COALESCE(sb.quantity, 0) - COALESCE(bc.remaining_qty, 0)) * COALESCE(p.purchase_price, 0)
            ) AS stock_value
          FROM products p
          LEFT JOIN categories c ON c.id = p.category_id
          LEFT JOIN stock_balances sb ON sb.product_id = p.id AND sb.warehouse_id = ?
          LEFT JOIN batch_costs bc ON bc.product_id = p.id AND bc.warehouse_id = ?
          WHERE 1=1
            ${statusWhere}
          ORDER BY p.name ASC
        `
        )
        .all(warehouseId, warehouseId, warehouseId);
    }

    if (isAllWarehouses) {
      return this.db
        .prepare(
          `
          WITH stock_totals AS (
            SELECT product_id, SUM(quantity) AS quantity
            FROM stock_balances
            GROUP BY product_id
          )
          SELECT
            p.id AS product_id,
            p.name AS product_name,
            p.sku AS product_sku,
            p.category_id,
            c.name AS category_name,
            COALESCE(p.min_stock_level, 0) AS min_stock_level,
            COALESCE(st.quantity, 0) AS current_stock,
            COALESCE(NULLIF(p.purchase_price, 0), 0) AS unit_cost,
            COALESCE(st.quantity, 0) * COALESCE(p.purchase_price, 0) AS stock_value
          FROM products p
          LEFT JOIN categories c ON c.id = p.category_id
          LEFT JOIN stock_totals st ON st.product_id = p.id
          WHERE 1=1
            ${statusWhere}
          ORDER BY p.name ASC
        `
        )
        .all();
    }

    return this.db
      .prepare(
        `
        SELECT
          p.id AS product_id,
          p.name AS product_name,
          p.sku AS product_sku,
          p.category_id,
          c.name AS category_name,
          COALESCE(p.min_stock_level, 0) AS min_stock_level,
          COALESCE(sb.quantity, 0) AS current_stock,
          COALESCE(NULLIF(p.purchase_price, 0), 0) AS unit_cost,
          COALESCE(sb.quantity, 0) * COALESCE(p.purchase_price, 0) AS stock_value
        FROM products p
        LEFT JOIN categories c ON c.id = p.category_id
        LEFT JOIN stock_balances sb ON sb.product_id = p.id AND sb.warehouse_id = ?
        WHERE 1=1
          ${statusWhere}
        ORDER BY p.name ASC
      `
      )
      .all(warehouseId);
  }

  getInventoryValuationSummary(filters = {}) {
    const rows = this.getInventoryValuation(filters);
    const total_value = rows.reduce((sum, r) => sum + Number(r.stock_value || 0), 0);
    const total_quantity = rows.reduce((sum, r) => sum + Number(r.current_stock || 0), 0);
    const products_count = rows.length;
    const out_of_stock_count = rows.filter((r) => Number(r.current_stock || 0) === 0).length;
    const low_stock_count = rows.filter((r) => {
      const stock = Number(r.current_stock || 0);
      const min = Number(r.min_stock_level || 0);
      return stock > 0 && stock <= min;
    }).length;
    return {
      total_value,
      total_quantity,
      products_count,
      out_of_stock_count,
      low_stock_count,
    };
  }

  getInventoryValuationReport(filters = {}) {
    const rows = this.getInventoryValuation(filters);
    const summary = this.getInventoryValuationSummary(filters);
    const warnings = this._accountingWarnings({ warehouse_id: filters.warehouse_id });
    return { rows, summary, warnings };
  }

  /**
   * Returns report.
   * filters: { date_from?, date_to?, warehouse_id?, limit?, offset? }
   */
  getReturnsReport(filters = {}) {
    const returnsTable = this._hasTable('sales_returns')
      ? 'sales_returns'
      : this._hasTable('sale_returns')
        ? 'sale_returns'
        : null;

    if (!returnsTable) {
      return [];
    }

    const dateFrom = filters.date_from ? this._ymd(filters.date_from) : null;
    const dateTo = filters.date_to ? this._ymd(filters.date_to) : null;
    const limit = Number.isFinite(Number(filters.limit)) ? Number(filters.limit) : 100;
    const offset = Number.isFinite(Number(filters.offset)) ? Number(filters.offset) : 0;

    const params = [];
    let where = `WHERE 1=1`;
    const returnDateExpr = this._tzDateExpr('r.created_at');
    if (filters.warehouse_id) {
      where += ` AND r.warehouse_id = ?`;
      params.push(filters.warehouse_id);
    }
    if (dateFrom) {
      where += ` AND ${returnDateExpr} >= date(?)`;
      params.push(dateFrom);
    }
    if (dateTo) {
      where += ` AND ${returnDateExpr} <= date(?)`;
      params.push(dateTo);
    }

    const rows = this.db
      .prepare(
        `
        SELECT
          r.*,
          o.order_number
        FROM ${returnsTable} r
        LEFT JOIN orders o ON o.id = r.order_id
        ${where}
        ORDER BY r.created_at DESC
        LIMIT ? OFFSET ?
      `
      )
      .all([...params, limit, offset]);

    return rows.map((r) => ({
      ...r,
      total_amount: Number(r.total_amount || 0) || 0,
      refund_amount: Number(r.refund_amount || 0) || 0,
    }));
  }

  /**
   * Profit estimate (revenue - COGS) from completed orders in a date range.
   * filters: { date_from?, date_to?, warehouse_id? }
   */
  getProfitEstimate(filters = {}) {
    const dateFrom = filters.date_from ? this._ymd(filters.date_from) : null;
    const dateTo = filters.date_to ? this._ymd(filters.date_to) : null;
    const salesTable = this._salesTable();
    const itemsTable = this._saleItemsTable();
    const orderJoinCol = this._useUnifiedSales() ? 'unified_order_id' : 'order_id';
    const salesJoinCol = this._useUnifiedSales() ? 'unified_id' : 'id';

    const params = [];
    let where = `WHERE ${completedStatusWhere(this.db, 'o')}`;
    const orderDateExpr = this._tzDateExpr('o.created_at');
    if (filters.warehouse_id) {
      where += ` AND o.warehouse_id = ?`;
      params.push(filters.warehouse_id);
    }
    if (dateFrom) {
      where += ` AND ${orderDateExpr} >= date(?)`;
      params.push(dateFrom);
    }
    if (dateTo) {
      where += ` AND ${orderDateExpr} <= date(?)`;
      params.push(dateTo);
    }
    where += salesChannelWhere('o', filters.sales_channel, params);

    const soldRevExpr = this._soldLineRevenueUzsSql('oi');
    const revenueRow = this.db
      .prepare(
        `
        SELECT
          COALESCE(SUM(${soldRevExpr}), 0) AS revenue
        FROM ${itemsTable} oi
        INNER JOIN ${salesTable} o ON o.${salesJoinCol} = oi.${orderJoinCol}
        ${where}
      `
      )
      .get(params);

    const revenue = Number(revenueRow?.revenue || 0) || 0;

    const cogsRow = this.db
      .prepare(
        `
        SELECT
          COALESCE(SUM(${this._cogsLineSql('oi')}), 0) AS cogs
        FROM ${itemsTable} oi
        INNER JOIN ${salesTable} o ON o.${salesJoinCol} = oi.${orderJoinCol}
        ${where}
      `
      )
      .get(params);
    const cogs = Number(cogsRow?.cogs || 0) || 0;
    this._logMissingCostPrice(where, params, 'profit_estimate');

    return {
      warehouse_id: filters.warehouse_id || null,
      date_from: dateFrom,
      date_to: dateTo,
      revenue,
      cogs,
      profit: revenue - cogs,
      warnings: this._accountingWarnings({
        warehouse_id: filters.warehouse_id,
        date_from: dateFrom,
        date_to: dateTo,
        sales_channel: filters.sales_channel,
      }),
    };
  }

  /**
   * Profit & Loss (SQL-driven).
   * filters: { date_from?, date_to?, warehouse_id?, price_tier_id? }
   */
  getProfitAndLossSQL(filters = {}) {
    const salesTable = this._salesTable();
    const itemsTable = this._saleItemsTable();
    // Schema safety — return zero P&L if base tables are missing
    if (!this._hasSaleSource()) {
      return {
        revenue: 0, cogs: 0, gross_profit: 0,
        discount: 0, orders_count: 0,
        returns_revenue: 0, returns_cogs: 0,
        net_revenue: 0, net_cogs: 0, net_gross_profit: 0,
        total_expenses: 0, total_commission: 0, net_profit: 0,
        gross_profit_margin: 0, net_profit_margin: 0,
        period: { date_from: filters.date_from || null, date_to: filters.date_to || null },
      };
    }

    const dateFrom = filters.date_from ? this._ymd(filters.date_from) : null;
    const dateTo = filters.date_to ? this._ymd(filters.date_to) : null;
    const warehouseId = filters.warehouse_id || null;
    const priceTierId = filters.price_tier_id ?? null;

    const hasPriceTierId = (() => {
      try {
        return !!this.db
          .prepare(`SELECT 1 AS ok FROM pragma_table_info('orders') WHERE name = 'price_tier_id' LIMIT 1`)
          .get()?.ok;
      } catch {
        return false;
      }
    })();
    const hasPaymentType = (() => {
      try {
        return !!this.db
          .prepare(`SELECT 1 AS ok FROM pragma_table_info('orders') WHERE name = 'payment_type' LIMIT 1`)
          .get()?.ok;
      } catch {
        return false;
      }
    })();

    const params = [];
    let where = `WHERE ${completedStatusWhere(this.db, 'o')}`;
    const orderDateExpr = this._tzDateExpr('o.created_at');
    const orderJoinCol = this._useUnifiedSales() ? 'unified_order_id' : 'order_id';
    const salesJoinCol = this._useUnifiedSales() ? 'unified_id' : 'id';
    if (warehouseId) {
      where += ` AND o.warehouse_id = ?`;
      params.push(warehouseId);
    }
    if (dateFrom) {
      where += ` AND ${orderDateExpr} >= date(?)`;
      params.push(dateFrom);
    }
    if (dateTo) {
      where += ` AND ${orderDateExpr} <= date(?)`;
      params.push(dateTo);
    }
    if (priceTierId != null && hasPriceTierId && !this._useUnifiedSales()) {
      where += ` AND o.price_tier_id = ?`;
      params.push(priceTierId);
    }
    where += salesChannelWhere('o', filters.sales_channel, params);
    where += ` AND ${posCartReturnExcludeWhere(this.db, 'o')}`;

    const summaryParams = params.concat(params);
    const revUzs = `CASE
      WHEN UPPER(TRIM(COALESCE(o.currency, 'UZS'))) = 'USD'
        THEN COALESCE(a.revenue, 0) * COALESCE(o.fx_rate, 0)
      ELSE COALESCE(a.revenue, 0)
    END`;
    const discUzs = this._useUnifiedSales()
      ? `CASE WHEN UPPER(TRIM(COALESCE(o.currency, 'UZS'))) = 'USD' THEN COALESCE(o.discount_amount, 0) * COALESCE(o.fx_rate, 0) ELSE COALESCE(o.discount_amount, 0) END`
      : orderFieldUzsSql(this.db, 'o', 'discount_amount');
    const cogsItemExpr = this._cogsLineSql('oi');
    const soldRevExpr = this._soldLineRevenueSql('oi');
    const summary = this.db
      .prepare(
        `
        WITH order_items_agg AS (
          SELECT
            oi.${orderJoinCol} AS order_key,
            SUM(${soldRevExpr}) AS revenue,
            SUM(${cogsItemExpr}) AS cogs
          FROM ${itemsTable} oi
          INNER JOIN ${salesTable} o ON o.${salesJoinCol} = oi.${orderJoinCol}
          ${where}
          GROUP BY oi.${orderJoinCol}
        )
        SELECT
          COALESCE(SUM(${revUzs}), 0) AS revenue,
          COALESCE(SUM(CASE
            WHEN UPPER(TRIM(COALESCE(o.currency, 'UZS'))) = 'USD' THEN 0
            ELSE COALESCE(a.revenue, 0)
          END), 0) AS revenue_uzs,
          COALESCE(SUM(CASE
            WHEN UPPER(TRIM(COALESCE(o.currency, 'UZS'))) = 'USD' THEN COALESCE(a.revenue, 0)
            ELSE 0
          END), 0) AS revenue_usd,
          COALESCE(SUM(a.cogs), 0) AS cogs,
          COALESCE(SUM(${discUzs}), 0) AS discount,
          COALESCE(SUM(CASE
            WHEN UPPER(TRIM(COALESCE(o.currency, 'UZS'))) = 'USD' THEN 0
            ELSE COALESCE(o.discount_amount, 0)
          END), 0) AS discount_uzs,
          COALESCE(SUM(CASE
            WHEN UPPER(TRIM(COALESCE(o.currency, 'UZS'))) = 'USD' THEN COALESCE(o.discount_amount, 0)
            ELSE 0
          END), 0) AS discount_usd,
          COUNT(DISTINCT o.${salesJoinCol}) AS orders_count
        FROM ${salesTable} o
        LEFT JOIN order_items_agg a ON a.order_key = o.${salesJoinCol}
        ${where}
      `
      )
      .get(summaryParams);

    const returnsTable = this._hasTable('sales_returns')
      ? 'sales_returns'
      : this._hasTable('sale_returns')
        ? 'sale_returns'
        : null;

    let returnsRevenue = 0;
    let returnsRevenueUzs = 0;
    let returnsRevenueUsd = 0;
    let returnsCogs = 0;
    if (returnsTable) {
      // Schema introspection — return tables vary across migrations
      const _retCols = (() => {
        try {
          return new Set(
            (this.db.prepare(`PRAGMA table_info(${returnsTable})`).all() || []).map((c) => c.name)
          );
        } catch {
          return new Set();
        }
      })();
      const _retHasRefundAmount = _retCols.has('refund_amount');
      const _retHasWarehouseId = _retCols.has('warehouse_id');

      const returnsParams = [];
      let returnsWhere = `WHERE LOWER(COALESCE(r.status, '')) = 'completed'`;
      const returnDateExpr = this._tzDateExpr('r.created_at');
      if (warehouseId && _retHasWarehouseId) {
        returnsWhere += ` AND r.warehouse_id = ?`;
        returnsParams.push(warehouseId);
      }
      if (dateFrom) {
        returnsWhere += ` AND ${returnDateExpr} >= date(?)`;
        returnsParams.push(dateFrom);
      }
      if (dateTo) {
        returnsWhere += ` AND ${returnDateExpr} <= date(?)`;
        returnsParams.push(dateTo);
      }
      if (priceTierId != null && hasPriceTierId) {
        returnsWhere += ` AND o.price_tier_id = ?`;
        returnsParams.push(priceTierId);
      }

      const _revAmountExpr = _retHasRefundAmount
        ? `COALESCE(r.refund_amount, r.total_amount, 0)`
        : `COALESCE(r.total_amount, 0)`;
      const _revUzsExpr = returnRefundUzsSql(this.db, 'r', 'o', _revAmountExpr);
      const revRow = this.db
        .prepare(
          `
          SELECT
            COALESCE(SUM(${_revUzsExpr}), 0) AS returns_revenue,
            COALESCE(SUM(CASE
              WHEN o.id IS NOT NULL AND UPPER(TRIM(COALESCE(o.currency, 'UZS'))) = 'USD' THEN 0
              ELSE (${_revAmountExpr})
            END), 0) AS returns_revenue_uzs,
            COALESCE(SUM(CASE
              WHEN o.id IS NOT NULL AND UPPER(TRIM(COALESCE(o.currency, 'UZS'))) = 'USD'
              THEN (${_revAmountExpr})
              ELSE 0
            END), 0) AS returns_revenue_usd
          FROM ${returnsTable} r
          LEFT JOIN orders o ON o.id = r.order_id
          ${returnsWhere}
        `
        )
        .get(returnsParams);
      returnsRevenue = Number(revRow?.returns_revenue || 0) || 0;
      returnsRevenueUzs = Number(revRow?.returns_revenue_uzs || 0) || 0;
      returnsRevenueUsd = Number(revRow?.returns_revenue_usd || 0) || 0;

      // Items table varies by schema generation
      const returnItemsTable = returnsTable === 'sale_returns' ? 'sale_return_items' : 'return_items';
      if (this._hasTable(returnItemsTable)) {
        const _hasQtyBase = (() => {
          try {
            return !!this.db
              .prepare(`SELECT 1 AS ok FROM pragma_table_info(?) WHERE name = 'qty_base' LIMIT 1`)
              .get(returnItemsTable)?.ok;
          } catch {
            return false;
          }
        })();
        const _hasOrderItemId = (() => {
          try {
            return !!this.db
              .prepare(`SELECT 1 AS ok FROM pragma_table_info(?) WHERE name = 'order_item_id' LIMIT 1`)
              .get(returnItemsTable)?.ok;
          } catch {
            return false;
          }
        })();
        const _hasProductId = (() => {
          try {
            return !!this.db
              .prepare(`SELECT 1 AS ok FROM pragma_table_info(?) WHERE name = 'product_id' LIMIT 1`)
              .get(returnItemsTable)?.ok;
          } catch {
            return false;
          }
        })();
        const _qty = _hasQtyBase ? `COALESCE(ri.qty_base, ri.quantity, 0)` : `COALESCE(ri.quantity, 0)`;
        const _retCogsExpr = this._returnCogsLineSql('oi', _qty);

        let cogsSql = null;
        if (_hasOrderItemId) {
          cogsSql = `
            SELECT COALESCE(SUM(${_retCogsExpr}), 0) AS returns_cogs
            FROM ${returnItemsTable} ri
            INNER JOIN ${returnsTable} r ON r.id = ri.return_id
            LEFT JOIN order_items oi ON oi.id = ri.order_item_id
            LEFT JOIN orders o ON o.id = r.order_id
            ${returnsWhere}
          `;
        } else if (_hasProductId) {
          cogsSql = `
            SELECT COALESCE(SUM(${_qty} * COALESCE((
              SELECT purchase_price FROM products WHERE id = ri.product_id LIMIT 1
            ), 0)), 0) AS returns_cogs
            FROM ${returnItemsTable} ri
            INNER JOIN ${returnsTable} r ON r.id = ri.return_id
            LEFT JOIN orders o ON o.id = r.order_id
            ${returnsWhere}
          `;
        }

        if (cogsSql) {
          const cogsRow = this.db.prepare(cogsSql).get(returnsParams);
          returnsCogs = Number(cogsRow?.returns_cogs || 0) || 0;
        }
      }
    }

    if (this._hasTable('orders') && this._hasTable('order_items')) {
      try {
        const posParams = [];
        let posWhere = `WHERE o.status = 'completed' AND ${unifiedAmountUzsSql(this.db, 'o')} < -0.009`;
        const posDateExpr = this._tzDateExpr('o.created_at');
        if (warehouseId) {
          posWhere += ` AND o.warehouse_id = ?`;
          posParams.push(warehouseId);
        }
        if (dateFrom) {
          posWhere += ` AND ${posDateExpr} >= date(?)`;
          posParams.push(dateFrom);
        }
        if (dateTo) {
          posWhere += ` AND ${posDateExpr} <= date(?)`;
          posParams.push(dateTo);
        }
        posWhere += salesChannelWhere('o', filters.sales_channel, posParams);
        const posAmtUzs = unifiedAmountUzsSql(this.db, 'o');
        const posCogsExpr = this._cogsLineSql('oi');
        const posRow = this.db
          .prepare(
            `
            SELECT
              COALESCE(SUM(ABS(${posAmtUzs})), 0) AS returns_revenue,
              COALESCE(SUM(ABS(item_cogs.cogs)), 0) AS returns_cogs
            FROM orders o
            LEFT JOIN (
              SELECT oi.order_id, SUM(${posCogsExpr}) AS cogs
              FROM order_items oi
              GROUP BY oi.order_id
            ) item_cogs ON item_cogs.order_id = o.id
            ${posWhere}
          `
          )
          .get(...posParams);
        returnsRevenue += Number(posRow?.returns_revenue || 0) || 0;
        returnsCogs += Number(posRow?.returns_cogs || 0) || 0;
      } catch {
        /* orders schema partial */
      }
    }

    const hasExpenseWh = (() => {
      if (!warehouseId || !this._hasTable('expenses')) return false;
      try {
        return !!this.db.prepare(`SELECT 1 AS ok FROM pragma_table_info('expenses') WHERE name = 'warehouse_id' LIMIT 1`).get()?.ok;
      } catch {
        return false;
      }
    })();
    const expenseDateExpr = this._tzDateExpr('COALESCE(e.expense_date, e.created_at)');
    const expenseParams = [...(!dateFrom ? [] : [dateFrom]), ...(!dateTo ? [] : [dateTo])];
    if (hasExpenseWh && warehouseId) expenseParams.push(warehouseId);
    const expensesRow = this._hasTable('expenses')
      ? this.db
          .prepare(
            `
            SELECT COALESCE(SUM(${expenseAmountUzsSql(this.db, 'e')}), 0) AS total_expenses
            FROM expenses e
            WHERE COALESCE(LOWER(e.status), 'approved') = 'approved'
              ${dateFrom ? `AND ${expenseDateExpr} >= date(?)` : ''}
              ${dateTo ? `AND ${expenseDateExpr} <= date(?)` : ''}
              ${hasExpenseWh && warehouseId ? `AND e.warehouse_id = ?` : ''}
          `
          )
          .get(expenseParams)
      : { total_expenses: 0 };

    const warnings = this._accountingWarnings({
      warehouse_id: warehouseId,
      date_from: dateFrom,
      date_to: dateTo,
      sales_channel: filters.sales_channel,
    });

    const revenue = Number(summary?.revenue || 0) || 0;
    const revenueUzs = Number(summary?.revenue_uzs ?? revenue) || 0;
    const revenueUsd = Number(summary?.revenue_usd || 0) || 0;
    const discount = Number(summary?.discount || 0) || 0;
    const discountUzs = Number(summary?.discount_uzs ?? discount) || 0;
    const discountUsd = Number(summary?.discount_usd || 0) || 0;
    const cogs = Number(summary?.cogs || 0) || 0;
    const ordersCount = Number(summary?.orders_count || 0) || 0;
    const netSales = revenue;
    const grossProfit = netSales - cogs;
    const totalExpenses = Number(expensesRow?.total_expenses || 0) || 0;
    const totalCommission = this._sumPeriodCommissions(dateFrom, dateTo, warehouseId);
    const netProfit = this._calculateNetProfit({
      grossProfit,
      returnsRevenue,
      returnsCogs,
      expenses: totalExpenses,
      commission: totalCommission,
    });
    const profitMargin = netSales > 0 ? (grossProfit / netSales) * 100 : 0;
    const returnRate = revenue > 0 ? (returnsRevenue / revenue) * 100 : 0;
    const avgOrderValue = ordersCount > 0 ? netSales / ordersCount : 0;

    const dailyRows = this.db
      .prepare(
        `
        WITH orders_in_range AS (
          SELECT o.${salesJoinCol} AS order_key, o.created_at, o.discount_amount, o.currency, o.fx_rate
          FROM ${salesTable} o
          ${where}
        ),
        items_agg AS (
          SELECT
            oi.${orderJoinCol} AS order_key,
            SUM(${soldRevExpr}) AS revenue,
            SUM(${cogsItemExpr}) AS cogs
          FROM ${itemsTable} oi
          INNER JOIN orders_in_range o ON o.order_key = oi.${orderJoinCol}
          GROUP BY oi.${orderJoinCol}
        )
        SELECT
          ${this._tzDateExpr('o.created_at')} AS day,
          COALESCE(SUM(CASE
            WHEN UPPER(TRIM(COALESCE(o.currency, 'UZS'))) = 'USD'
              THEN COALESCE(a.revenue, 0) * COALESCE(o.fx_rate, 0)
            ELSE COALESCE(a.revenue, 0)
          END), 0) AS revenue,
          COALESCE(SUM(a.cogs), 0) AS cogs,
          COALESCE(SUM(CASE
            WHEN UPPER(TRIM(COALESCE(o.currency, 'UZS'))) = 'USD'
              THEN COALESCE(o.discount_amount, 0) * COALESCE(o.fx_rate, 0)
            ELSE COALESCE(o.discount_amount, 0)
          END), 0) AS discount
        FROM orders_in_range o
        LEFT JOIN items_agg a ON a.order_key = o.order_key
        GROUP BY ${this._tzDateExpr('o.created_at')}
        ORDER BY day ASC
      `
      )
      .all(params);

    const series = (dailyRows || []).map((r) => {
      const dayRevenue = Number(r.revenue || 0) || 0;
      const dayDiscount = Number(r.discount || 0) || 0;
      const dayCogs = Number(r.cogs || 0) || 0;
      const dayNetSales = dayRevenue;
      return {
        day: r.day,
        revenue: dayRevenue,
        discount: dayDiscount,
        net_sales: dayNetSales,
        cogs: dayCogs,
        gross_profit: dayNetSales - dayCogs,
      };
    });

    return {
      filters: { date_from: dateFrom, date_to: dateTo, warehouse_id: warehouseId, price_tier_id: priceTierId },
      summary: {
        revenue,
        revenue_uzs: revenueUzs,
        revenue_usd: revenueUsd,
        discount,
        discount_uzs: discountUzs,
        discount_usd: discountUsd,
        net_sales: netSales,
        net_sales_uzs: Math.max(0, revenueUzs - discountUzs),
        net_sales_usd: Math.max(0, revenueUsd - discountUsd),
        cogs,
        gross_profit: grossProfit,
        returns_revenue: returnsRevenue,
        returns_revenue_uzs: returnsRevenueUzs,
        returns_revenue_usd: returnsRevenueUsd,
        returns_cogs: returnsCogs,
        expenses: totalExpenses,
        total_commission: totalCommission,
        payment_fees: totalCommission,
        net_profit: netProfit,
        profit_margin: profitMargin,
        return_rate: returnRate,
        orders_count: ordersCount,
        avg_order_value: avgOrderValue,
      },
      series,
      warnings,
    };
  }

  /**
   * Daily sales report (SQL-driven).
   * filters: { date_from?, date_to?, cashier_id?, payment_method?, status?, warehouse_id?, price_tier_id? }
   */
  getDailySalesReportSQL(filters = {}) {
    const dateFrom = filters.date_from ? this._ymd(filters.date_from) : null;
    const dateTo = filters.date_to ? this._ymd(filters.date_to) : null;
    const cashierId = filters.cashier_id || null;
    const paymentMethod = filters.payment_method || null;
    const status = filters.status || null;
    const isAllWarehouses = String(filters.warehouse_id || '').toUpperCase() === 'ALL';
    let warehouseId = isAllWarehouses ? null : (filters.warehouse_id || null);
    const priceTierId = filters.price_tier_id ?? null;
    const warnings = {};
    const salesTable = this._salesTable();
    const itemsTable = this._saleItemsTable();
    const orderJoinCol = this._useUnifiedSales() ? 'unified_order_id' : 'order_id';
    const salesJoinCol = this._useUnifiedSales() ? 'unified_id' : 'id';
    const cogsItemExpr = this._cogsLineSql('oi');
    const soldRevExpr = this._soldLineRevenueUzsSql('oi');
    const profitItemExpr = `(${soldRevExpr}) - (${cogsItemExpr})`;

    const hasPriceTierId = (() => {
      try {
        return !!this.db
          .prepare(`SELECT 1 AS ok FROM pragma_table_info('orders') WHERE name = 'price_tier_id' LIMIT 1`)
          .get()?.ok;
      } catch {
        return false;
      }
    })();
    const hasPaymentType = (() => {
      try {
        return !!this.db
          .prepare(`SELECT 1 AS ok FROM pragma_table_info('orders') WHERE name = 'payment_type' LIMIT 1`)
          .get()?.ok;
      } catch {
        return false;
      }
    })();

    const params = [];
    let where = `WHERE 1=1`;
    const orderDateExpr = this._tzDateExpr('o.created_at');
    if (dateFrom) {
      where += ` AND ${orderDateExpr} >= date(?)`;
      params.push(dateFrom);
    }
    if (dateTo) {
      where += ` AND ${orderDateExpr} <= date(?)`;
      params.push(dateTo);
    }
    if (cashierId) {
      where += ` AND COALESCE(o.user_id, o.cashier_id) = ?`;
      params.push(cashierId);
    }
    if (status) {
      where += ` AND o.status = ?`;
      params.push(status);
    } else if (!this._useUnifiedSales()) {
      where += ` AND o.status = 'completed'`;
    }
    if (!warehouseId && !isAllWarehouses && this._hasTable('warehouses')) {
      const def = this.db.prepare(`SELECT id FROM warehouses WHERE is_default = 1 LIMIT 1`).get();
      warehouseId = def?.id || null;
      if (!warehouseId) {
        warnings.warehouse_not_set = true;
      }
    }
    if (warehouseId) {
      where += ` AND o.warehouse_id = ?`;
      params.push(warehouseId);
    }
    if (priceTierId != null && hasPriceTierId && !this._useUnifiedSales()) {
      where += ` AND o.price_tier_id = ?`;
      params.push(priceTierId);
    }
    where += salesChannelWhere('o', filters.sales_channel, params);

    const paymentExpr = hasPaymentType && !this._useUnifiedSales()
      ? `COALESCE(pm.payment_method, o.payment_type, 'n/a')`
      : this._useUnifiedSales()
        ? `COALESCE(o.payment_status, 'n/a')`
        : `COALESCE(pm.payment_method, 'n/a')`;

    const orders = this.db
      .prepare(
        `
        WITH items_agg AS (
          SELECT
            oi.${orderJoinCol} AS order_key,
            SUM(${soldRevExpr}) AS revenue,
            SUM(${cogsItemExpr}) AS cogs,
            SUM(${profitItemExpr}) AS profit,
            SUM(CASE
              WHEN COALESCE(oi.qty_sale, oi.quantity, 0) < -0.009
              THEN ABS(${soldRevExpr})
              ELSE 0
            END) AS return_revenue_abs,
            SUM(CASE
              WHEN COALESCE(oi.qty_sale, oi.quantity, 0) < -0.009
              THEN ABS(${profitItemExpr})
              ELSE 0
            END) AS return_profit_abs,
            SUM(CASE
              WHEN COALESCE(oi.qty_sale, oi.quantity, 0) >= -0.009
              THEN ${soldRevExpr}
              ELSE 0
            END) AS sale_revenue,
            SUM(CASE
              WHEN COALESCE(oi.qty_sale, oi.quantity, 0) >= -0.009
              THEN ${profitItemExpr}
              ELSE 0
            END) AS sale_profit
          FROM ${itemsTable} oi
          INNER JOIN ${salesTable} o ON o.${salesJoinCol} = oi.${orderJoinCol}
          GROUP BY oi.${orderJoinCol}
        ),
        pay_methods AS (
          SELECT
            p.order_id,
            CASE
              WHEN COUNT(DISTINCT p.payment_method) > 1 THEN 'mixed'
              WHEN COUNT(DISTINCT p.payment_method) = 1 THEN MIN(p.payment_method)
              ELSE NULL
            END AS payment_method
          FROM payments p
          GROUP BY p.order_id
        )
        SELECT
          o.source_id AS id,
          o.order_number,
          o.created_at,
          o.status,
          o.total_amount,
          o.currency,
          o.fx_rate,
          NULL AS total_usd,
          o.cashier_id,
          o.user_id,
          o.customer_id,
          o.warehouse_id,
          NULL AS price_tier_id,
          COALESCE(u.full_name, u.username, p.full_name, p.username, o.cashier_id) AS cashier_name,
          ${paymentExpr} AS payment_method,
          o.sales_channel,
          o.sale_source AS order_source,
          COALESCE(a.revenue, 0) AS revenue,
          COALESCE(a.cogs, 0) AS cogs,
          COALESCE(a.profit, COALESCE(a.revenue, 0) - COALESCE(a.cogs, 0)) AS profit,
          COALESCE(a.return_revenue_abs, 0) AS return_revenue_abs,
          COALESCE(a.return_profit_abs, 0) AS return_profit_abs,
          COALESCE(a.sale_revenue, COALESCE(a.revenue, 0)) AS sale_revenue,
          COALESCE(a.sale_profit, COALESCE(a.profit, 0)) AS sale_profit
        FROM ${salesTable} o
        LEFT JOIN items_agg a ON a.order_key = o.${salesJoinCol}
        LEFT JOIN pay_methods pm ON pm.order_id = o.source_id AND o.sale_source = 'pos'
        LEFT JOIN users u ON u.id = COALESCE(o.user_id, o.cashier_id)
        LEFT JOIN profiles p ON p.id = COALESCE(o.user_id, o.cashier_id)
        ${where}
        ORDER BY o.created_at DESC
      `
      )
      .all(params)
      .filter((row) => {
        if (!paymentMethod || paymentMethod === 'all') return true;
        if (paymentMethod === 'mixed') return String(row.payment_method || '').toLowerCase() === 'mixed';
        return String(row.payment_method || '').toLowerCase() === String(paymentMethod).toLowerCase();
      });

    const completed = orders.filter((o) =>
      this._useUnifiedSales()
        ? ['completed', 'delivered', 'paid'].includes(String(o.status || '').toLowerCase())
        : String(o.status || '') === 'completed',
    );
    const posCartReturns = completed.filter((o) => this._isPosCartReturnOrder(o));
    const salesOrders = completed
      .filter((o) => !this._isPosCartReturnOrder(o))
      .map((o) => {
        // Almashuv: sotuv kartasida faqat musbat qatorlar; qaytarish alohida.
        if (this._hasPosCartReturnLines(o)) {
          return {
            ...o,
            revenue: Number(o.sale_revenue || 0),
            profit: Number(o.sale_profit || 0),
          };
        }
        return o;
      });
    const mixedCartReturns = salesOrders.filter((o) => this._hasPosCartReturnLines(o));
    const displayOrders = orders
      .filter((o) => !this._isPosCartReturnOrder(o))
      .map((o) => {
        if (this._hasPosCartReturnLines(o)) {
          return {
            ...o,
            revenue: Number(o.sale_revenue || 0),
            profit: Number(o.sale_profit || 0),
          };
        }
        return o;
      });
    const totalSales = salesOrders.reduce((sum, o) => sum + Number(o.revenue || 0), 0);
    const totalProfit = salesOrders.reduce((sum, o) => sum + Number(o.profit || 0), 0);
    const avgOrderValue = salesOrders.length > 0 ? totalSales / salesOrders.length : 0;

    /** Flag lines where COGS dwarfs revenue — usually UZS cost entered as USD × fx. */
    const markCogsAnomaly = (rows) =>
      (rows || []).map((o) => {
        const revenue = Number(o.revenue || 0) || 0;
        const cogs = Number(o.cogs || 0) || 0;
        const profit = Number(o.profit || 0) || 0;
        const absRev = Math.abs(revenue);
        const cogs_anomaly =
          cogs > 0 &&
          ((absRev > 0 && cogs > absRev * 20) ||
            (absRev <= 0.009 && cogs > 1_000_000) ||
            profit < -1_000_000 && absRev > 0 && Math.abs(profit) > absRev * 10);
        return { ...o, cogs_anomaly: !!cogs_anomaly };
      });

    const displayOrdersMarked = markCogsAnomaly(displayOrders);
    const cogsAnomalyCount = displayOrdersMarked.filter((o) => o.cogs_anomaly).length;

    const rtMeta = this._salesReturnTableNames();
    const returnsTable = rtMeta.table;
    const returnItemsTable = rtMeta.items;

    let returnsTotal = 0;
    let returnsProfitImpact = 0;
    let returnsCogsTotal = 0;
    let returnRows = [];
    if (returnsTable && returnItemsTable) {
      const returnCols = (() => {
        try {
          const cols = this.db.prepare(`PRAGMA table_info(${returnsTable})`).all() || [];
          return new Set(cols.map((c) => c.name));
        } catch {
          return new Set();
        }
      })();
      const hasReturnCashierId = returnCols.has('cashier_id');
      const hasReturnUserId = returnCols.has('user_id');
      const hasReturnWarehouseId = returnCols.has('warehouse_id');
      const hasReturnRefundAmount = returnCols.has('refund_amount');
      const returnCashierExpr =
        hasReturnCashierId && hasReturnUserId
          ? `COALESCE(r.user_id, r.cashier_id)`
          : hasReturnCashierId
            ? `r.cashier_id`
            : hasReturnUserId
              ? `r.user_id`
              : null;
      const returnCashierSelect =
        hasReturnCashierId ? `r.cashier_id` : `NULL`;
      const returnUserSelect =
        hasReturnUserId ? `r.user_id` : `NULL`;

      const returnsParams = [];
      let returnsWhere = `WHERE LOWER(COALESCE(r.status, '')) = 'completed'`;
      const returnDateExpr = this._tzDateExpr('r.created_at');
      if (dateFrom) {
        returnsWhere += ` AND ${returnDateExpr} >= date(?)`;
        returnsParams.push(dateFrom);
      }
      if (dateTo) {
        returnsWhere += ` AND ${returnDateExpr} <= date(?)`;
        returnsParams.push(dateTo);
      }
      if (cashierId && returnCashierExpr) {
        returnsWhere += ` AND ${returnCashierExpr} = ?`;
        returnsParams.push(cashierId);
      }
      if (warehouseId && hasReturnWarehouseId) {
        returnsWhere += ` AND r.warehouse_id = ?`;
        returnsParams.push(warehouseId);
      }
      if (priceTierId != null && hasPriceTierId) {
        returnsWhere += ` AND o.price_tier_id = ?`;
        returnsParams.push(priceTierId);
      }

      const refundAmountExpr = hasReturnRefundAmount
        ? `COALESCE(r.refund_amount, r.total_amount, 0)`
        : `COALESCE(r.total_amount, 0)`;

      const returnsRow = this.db
        .prepare(
          `
          SELECT COALESCE(SUM(${returnRefundUzsSql(this.db, 'r', 'o', refundAmountExpr)}), 0) AS total_returns
          FROM ${returnsTable} r
          LEFT JOIN orders o ON o.id = r.order_id
          ${returnsWhere}
        `
        )
        .get(returnsParams);
      returnsTotal = Number(returnsRow?.total_returns || 0) || 0;

      const hasReturnQtyBase = (() => {
        try {
          return !!this.db
            .prepare(`SELECT 1 AS ok FROM pragma_table_info(?) WHERE name = 'qty_base' LIMIT 1`)
            .get(returnItemsTable)?.ok;
        } catch {
          return false;
        }
      })();
      const returnQtyExpr = hasReturnQtyBase
        ? `COALESCE(ri.qty_base, ri.quantity, 0)`
        : `COALESCE(ri.quantity, 0)`;
      const returnCogsExpr = this._returnCogsLineSql('oi', returnQtyExpr);
      const returnRevenueUzs = orderLinkedFieldUzsSql(this.db, 'o', 'ri.line_total');
      const returnProfitExpr = `(${returnRevenueUzs}) - (${returnCogsExpr})`;

      const returnsCogsRow = this.db
        .prepare(
          `
          SELECT COALESCE(SUM(${returnCogsExpr}), 0) AS returns_cogs
          FROM ${returnItemsTable} ri
          INNER JOIN ${returnsTable} r ON r.id = ri.return_id
          INNER JOIN order_items oi ON oi.id = ri.order_item_id
          LEFT JOIN orders o ON o.id = r.order_id
          ${returnsWhere}
        `,
        )
        .get(returnsParams);

      const impactRow = this.db
        .prepare(
          `
          SELECT
            COALESCE(SUM(${returnProfitExpr}), 0) AS profit_impact
          FROM ${returnItemsTable} ri
          INNER JOIN ${returnsTable} r ON r.id = ri.return_id
          INNER JOIN order_items oi ON oi.id = ri.order_item_id
          LEFT JOIN orders o ON o.id = r.order_id
          ${returnsWhere}
        `
        )
        .get(returnsParams);
      returnsProfitImpact = Number(impactRow?.profit_impact || 0) || 0;
      returnsCogsTotal = Number(returnsCogsRow?.returns_cogs || 0) || 0;

      returnRows = this.db
        .prepare(
          `
          SELECT
            r.id,
            r.return_number,
            r.order_id,
            o.order_number,
            r.total_amount,
            r.refund_method,
            r.status,
            ${returnCashierSelect} AS cashier_id,
            ${returnUserSelect} AS user_id,
            r.created_at
          FROM ${returnsTable} r
          LEFT JOIN orders o ON o.id = r.order_id
          ${returnsWhere}
          ORDER BY r.created_at DESC
        `
        )
        .all(returnsParams);
    }

    const posCartMeta = this._posCartReturnTotals(posCartReturns);
    const mixedCartMeta = this._posCartReturnLineTotals(mixedCartReturns);
    returnsTotal += posCartMeta.total + mixedCartMeta.total;
    returnsProfitImpact += posCartMeta.profitImpact + mixedCartMeta.profitImpact;
    returnsCogsTotal += posCartMeta.cogs + mixedCartMeta.cogs;

    const hasExpenseWh = (() => {
      if (!warehouseId || !this._hasTable('expenses')) return false;
      try {
        return !!this.db
          .prepare(`SELECT 1 AS ok FROM pragma_table_info('expenses') WHERE name = 'warehouse_id' LIMIT 1`)
          .get()?.ok;
      } catch {
        return false;
      }
    })();
    const expenseDateExpr = this._tzDateExpr('COALESCE(e.expense_date, e.created_at)');
    const expenseParams = [];
    if (dateFrom) expenseParams.push(dateFrom);
    if (dateTo) expenseParams.push(dateTo);
    if (hasExpenseWh && warehouseId) expenseParams.push(warehouseId);
    const totalExpenses = this._hasTable('expenses')
      ? Number(
          this.db
            .prepare(
              `
            SELECT COALESCE(SUM(${expenseAmountUzsSql(this.db, 'e')}), 0) AS total_expenses
            FROM expenses e
            WHERE COALESCE(LOWER(e.status), 'approved') = 'approved'
              ${dateFrom ? `AND ${expenseDateExpr} >= date(?)` : ''}
              ${dateTo ? `AND ${expenseDateExpr} <= date(?)` : ''}
              ${hasExpenseWh && warehouseId ? `AND e.warehouse_id = ?` : ''}
          `,
            )
            .get(...expenseParams)?.total_expenses || 0,
        ) || 0
      : 0;

    const totalCommission = this._sumPeriodCommissions(dateFrom, dateTo, warehouseId);
    const netProfit = this._calculateNetProfit({
      grossProfit: totalProfit,
      returnsRevenue: returnsTotal,
      returnsCogs: returnsCogsTotal,
      expenses: totalExpenses,
      commission: totalCommission,
    });
    const posCartReturnRows = [
      ...this._posCartReturnRowsFromOrders(posCartReturns),
      ...this._posCartReturnLineRowsFromOrders(mixedCartReturns),
    ];
    returnRows = [...returnRows, ...posCartReturnRows].sort(
      (a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')),
    );

    return {
      filters: { date_from: dateFrom, date_to: dateTo, cashier_id: cashierId, payment_method: paymentMethod, status, warehouse_id: warehouseId, price_tier_id: priceTierId, sales_channel: filters.sales_channel || null },
      orders: displayOrdersMarked,
      summary: {
        total_sales: totalSales,
        total_profit: totalProfit,
        total_returns: returnsTotal,
        returns_cogs: returnsCogsTotal,
        returns_profit_impact: returnsProfitImpact,
        total_expenses: totalExpenses,
        total_commission: totalCommission,
        payment_fees: totalCommission,
        net_profit: netProfit,
        avg_order_value: avgOrderValue,
        cogs_anomaly_count: cogsAnomalyCount,
      },
      returns: returnRows,
      warnings: {
        ...warnings,
        ...(cogsAnomalyCount > 0
          ? {
              cogs_anomaly: true,
              cogs_anomaly_count: cogsAnomalyCount,
              cogs_anomaly_hint:
                'Baʼzi sotuvlarda tannarx daromaddan ancha katta (ko‘pincha USD maydoniga UZS kiritib kursga ko‘paytirish). Mahsulot/partiya unit_cost va order_items.cost_price ni tekshiring.',
            }
          : {}),
        ...this._accountingWarnings({
          warehouse_id: warehouseId,
          date_from: dateFrom,
          date_to: dateTo,
          sales_channel: filters.sales_channel,
        }),
      },
    };
  }

  getDailySalesSummary(filters = {}) {
    const report = this.getDailySalesReportSQL(filters);
    return { filters: report.filters, summary: report.summary };
  }

  /**
   * Per-customer sales aggregation for a date range.
   * Gross completed sales (UZS equiv.), excluding POS cart-return orders
   * (same `posCartReturnExcludeWhere` as daily / product sales). Uses
   * `customers.balance` / `balance_usd` as live ledger saldo — NOT sum(credit_amount).
   *
   * Returns:
   *   [{
   *     customer_id, customer_name, customer_phone,
   *     total_purchases, order_count, average_order_value,
   *     balance, balance_usd  // signed: < 0 = debt, > 0 = prepaid
   *   }, ...]
   */
  getCustomerSalesReport(filters = {}) {
    const dateFrom = filters.date_from ? this._ymd(filters.date_from) : null;
    const dateTo = filters.date_to ? this._ymd(filters.date_to) : null;
    const warehouseId = filters.warehouse_id || null;
    const isAllWarehouses = String(filters.warehouse_id || '').toUpperCase() === 'ALL';

    if (!this._hasSaleSource()) return [];

    const salesTable = this._salesTable();
    const params = [];
    let where = `WHERE ${completedStatusWhere(this.db, 'o')}`;
    const orderDateExpr = this._tzDateExpr('o.created_at');
    if (dateFrom) {
      where += ` AND ${orderDateExpr} >= date(?)`;
      params.push(dateFrom);
    }
    if (dateTo) {
      where += ` AND ${orderDateExpr} <= date(?)`;
      params.push(dateTo);
    }
    if (warehouseId && !isAllWarehouses) {
      where += ` AND o.warehouse_id = ?`;
      params.push(warehouseId);
    }
    where += salesChannelWhere('o', filters.sales_channel, params);
    where += ` AND ${posCartReturnExcludeWhere(this.db, 'o')}`;

    const hasCustomers = this._hasTable('customers');
    const hasUsdBal = hasCustomers && hasCustomerBalanceUsd(this.db);
    const hasOrderCustomerName =
      !this._useUnifiedSales() &&
      (() => {
        try {
          return !!this.db
            .prepare(`SELECT 1 AS ok FROM pragma_table_info('orders') WHERE name = 'customer_name' LIMIT 1`)
            .get()?.ok;
        } catch {
          return false;
        }
      })();
    const customerJoin = hasCustomers
      ? `LEFT JOIN customers c ON c.id = o.customer_id`
      : '';
    const customerNameExpr = hasCustomers
      ? hasOrderCustomerName
        ? `MAX(COALESCE(c.name, o.customer_name))`
        : `MAX(c.name)`
      : hasOrderCustomerName
        ? `MAX(o.customer_name)`
        : `NULL`;
    const customerPhoneExpr = hasCustomers ? `MAX(c.phone)` : `NULL`;
    const customerBalanceExpr = hasCustomers ? `MAX(COALESCE(c.balance, 0))` : `0`;
    const customerBalanceUsdExpr = hasUsdBal ? `MAX(COALESCE(c.balance_usd, 0))` : `0`;
    const amountUzs = unifiedAmountUzsSql(this.db, 'o');

    const rows = this.db
      .prepare(
        `
        SELECT
          COALESCE(o.customer_id, '__walkin__') AS customer_id,
          ${customerNameExpr} AS customer_name,
          ${customerPhoneExpr} AS customer_phone,
          COUNT(*) AS order_count,
          COALESCE(SUM(${amountUzs}), 0) AS total_purchases,
          ${customerBalanceExpr} AS balance,
          ${customerBalanceUsdExpr} AS balance_usd
        FROM ${salesTable} o
        ${customerJoin}
        ${where}
        GROUP BY COALESCE(o.customer_id, '__walkin__')
        ORDER BY total_purchases DESC
      `
      )
      .all(params);

    return (rows || []).map((r) => {
      const orders = Number(r.order_count) || 0;
      const total = Number(r.total_purchases) || 0;
      const isWalkin =
        !r.customer_id ||
        r.customer_id === '__walkin__' ||
        r.customer_id === 'default-customer-001';
      return {
        customer_id: isWalkin ? 'walk-in' : r.customer_id,
        customer_name: r.customer_name || (isWalkin ? 'Yangi mijoz' : "Noma'lum mijoz"),
        customer_phone: r.customer_phone || null,
        order_count: orders,
        total_purchases: total,
        average_order_value: orders > 0 ? total / orders : 0,
        // Live customers.balance / balance_usd (walk-in / placeholder → 0)
        balance: isWalkin ? 0 : Number(r.balance) || 0,
        balance_usd: isWalkin ? 0 : Number(r.balance_usd) || 0,
      };
    });
  }

  /**
   * Batch reconciliation (Act Sverka): compare stock from inventory_movements vs sum(batches.remaining_qty).
   * filters: { product_id?, warehouse_id? }
   */
  getBatchReconciliation(filters = {}) {
    if (!this._hasTable('inventory_movements') || !this._hasTable('inventory_batches')) {
      return [];
    }

    const params = [];
    let where = `WHERE 1=1`;
    if (filters.warehouse_id) {
      where += ` AND u.warehouse_id = ?`;
      params.push(filters.warehouse_id);
    }
    if (filters.product_id) {
      where += ` AND u.product_id = ?`;
      params.push(filters.product_id);
    }

    const movementCte = movementBalanceCteSql(this.db);
    const cteParams = movementCte.cteParams || [];

    const rows = this.db
      .prepare(
        `
        WITH
          ${movementCte.cteSql},
          b AS (
            SELECT product_id, warehouse_id, COALESCE(SUM(remaining_qty), 0) AS stock_from_batches
            FROM inventory_batches
            GROUP BY product_id, warehouse_id
          ),
          u AS (
            SELECT
              m.product_id,
              m.warehouse_id,
              m.stock_from_movements,
              COALESCE(b.stock_from_batches, 0) AS stock_from_batches
            FROM m
            LEFT JOIN b ON b.product_id = m.product_id AND b.warehouse_id = m.warehouse_id
            UNION ALL
            SELECT
              b.product_id,
              b.warehouse_id,
              COALESCE(m.stock_from_movements, 0) AS stock_from_movements,
              b.stock_from_batches
            FROM b
            LEFT JOIN m ON m.product_id = b.product_id AND m.warehouse_id = b.warehouse_id
            WHERE m.product_id IS NULL
          )
        SELECT
          u.product_id,
          p.name AS product_name,
          u.warehouse_id,
          w.name AS warehouse_name,
          u.stock_from_movements,
          u.stock_from_batches,
          (u.stock_from_batches - u.stock_from_movements) AS difference
        FROM u
        LEFT JOIN products p ON p.id = u.product_id
        LEFT JOIN warehouses w ON w.id = u.warehouse_id
        ${where}
        ORDER BY ABS(difference) DESC, p.name ASC
      `
      )
      .all([...cteParams, ...params]);

    return rows.map((r) => ({
      product_id: r.product_id,
      product_name: r.product_name || null,
      warehouse_id: r.warehouse_id,
      warehouse_name: r.warehouse_name || null,
      stock_from_movements: Number(r.stock_from_movements || 0) || 0,
      stock_from_batches: Number(r.stock_from_batches || 0) || 0,
      difference: Number(r.difference || 0) || 0,
    }));
  }

  /**
   * Act Sverka (FIFO costing summary by product)
   * Requires batch mode tables.
   * filters: { category_id? }
   */
  getActSverka(filters = {}) {
    if (
      !this._hasTable('inventory_batches') ||
      !this._hasTable('inventory_batch_allocations') ||
      !this._hasTable('products')
    ) {
      return [];
    }
    const hasCategories = this._hasTable('categories');
    const hasOrders = this._hasTable('orders') && this._hasTable('order_items');

    const params = [];
    let where = `WHERE p.is_active = 1`;
    if (filters.category_id) {
      where += ` AND p.category_id = ?`;
      params.push(filters.category_id);
    }

    // The "fallback" sold_orders + revenue CTEs only make sense when orders/order_items exist.
    // Otherwise we serve a batches-only view (FIFO ledger) without sales data.
    const ordersCte = hasOrders
      ? `,
          sold_orders AS (
            SELECT
              oi.product_id,
              COALESCE(SUM(oi.quantity), 0) AS total_sold_qty,
              COALESCE(SUM(
                oi.quantity * CASE
                  WHEN COALESCE(oi.cost_price, 0) > 0 THEN oi.cost_price
                  ELSE COALESCE(pr.purchase_price, 0)
                END
              ), 0) AS total_cogs
            FROM order_items oi
            INNER JOIN orders o ON o.id = oi.order_id
            LEFT JOIN products pr ON pr.id = oi.product_id
            WHERE o.status = 'completed'
            GROUP BY oi.product_id
          ),
          revenue AS (
            SELECT
              oi.product_id,
              COALESCE(SUM(oi.line_total), 0) AS total_sold_revenue
            FROM order_items oi
            INNER JOIN orders o ON o.id = oi.order_id
            WHERE o.status = 'completed'
            GROUP BY oi.product_id
          )`
      : '';
    const ordersJoins = hasOrders
      ? `
        LEFT JOIN sold_orders so ON so.product_id = p.id
        LEFT JOIN revenue r ON r.product_id = p.id`
      : '';
    const soldQtyExpr = hasOrders
      ? `COALESCE(CASE WHEN COALESCE(sb.total_sold_qty, 0) > 0 THEN sb.total_sold_qty ELSE so.total_sold_qty END, 0)`
      : `COALESCE(sb.total_sold_qty, 0)`;
    const cogsExpr = hasOrders
      ? `COALESCE(CASE WHEN COALESCE(sb.total_cogs, 0) > 0 THEN sb.total_cogs ELSE so.total_cogs END, 0)`
      : `COALESCE(sb.total_cogs, 0)`;
    const revenueExpr = hasOrders ? `COALESCE(r.total_sold_revenue, 0)` : `0`;
    const categoryJoin = hasCategories
      ? 'LEFT JOIN categories c ON c.id = p.category_id'
      : '';
    const categoryNameExpr = hasCategories ? `COALESCE(c.name, '')` : `''`;

    const rows = this.db
      .prepare(
        `
        WITH
          purchased AS (
            SELECT
              b.product_id,
              COALESCE(SUM(b.initial_qty), 0) AS total_purchased_qty,
              COALESCE(SUM(b.initial_qty * b.unit_cost), 0) AS total_purchased_cost,
              COALESCE(SUM(b.remaining_qty), 0) AS remaining_qty
            FROM inventory_batches b
            GROUP BY b.product_id
          ),
          sold_batch AS (
            SELECT
              a.product_id,
              COALESCE(SUM(CASE WHEN a.direction = 'out' AND a.reference_type = 'order_item' THEN a.quantity ELSE 0 END), 0) AS total_sold_qty,
              COALESCE(SUM(CASE WHEN a.direction = 'out' AND a.reference_type = 'order_item' THEN a.quantity * a.unit_cost ELSE 0 END), 0) AS total_cogs
            FROM inventory_batch_allocations a
            GROUP BY a.product_id
          )${ordersCte}
        SELECT
          p.id AS product_id,
          p.name AS product_name,
          p.sku AS product_sku,
          ${categoryNameExpr} AS category_name,
          COALESCE(pu.total_purchased_qty, 0) AS total_purchased_qty,
          ${soldQtyExpr} AS total_sold_qty,
          COALESCE(pu.remaining_qty, 0) AS remaining_qty,
          COALESCE(pu.total_purchased_cost, 0) AS total_purchased_cost,
          ${revenueExpr} AS total_sold_revenue,
          (${revenueExpr} - ${cogsExpr}) AS total_profit,
          CASE
            WHEN ${revenueExpr} > 0
            THEN ((${revenueExpr} - ${cogsExpr}) / ${revenueExpr}) * 100
            ELSE 0
          END AS profit_margin
        FROM products p
        ${categoryJoin}
        LEFT JOIN purchased pu ON pu.product_id = p.id
        LEFT JOIN sold_batch sb ON sb.product_id = p.id${ordersJoins}
        ${where}
        ORDER BY total_profit DESC, p.name ASC
        LIMIT 2000
      `
      )
      .all(params);

    return rows.map((row) => ({
      ...row,
      total_purchased_qty: Number(row.total_purchased_qty || 0) || 0,
      total_sold_qty: Number(row.total_sold_qty || 0) || 0,
      remaining_qty: Number(row.remaining_qty || 0) || 0,
      total_purchased_cost: Number(row.total_purchased_cost || 0) || 0,
      total_sold_revenue: Number(row.total_sold_revenue || 0) || 0,
      total_profit: Number(row.total_profit || 0) || 0,
      profit_margin: Number(row.profit_margin || 0) || 0,
    }));
  }

  /**
   * Mahsulot bo'yicha akt sverka (davr) — kirim (qabul), sotuv, qaytarishlar, foyda.
   * FIFO partiyalar shart emas; qabul va sotuv real operatsiyalar bo'yicha.
   * warehouse_id: qaytarishlar `sales_returns.warehouse_id` (ustun bo‘lsa) orqali ham filtrlanadi.
   * Qaytarish jadvali: asl `sales_returns` + `return_items`, bo‘lmasa arxiv `sale_*`.
   *
   * filters: {
   *   date_from, date_to (YYYY-MM-DD, majburiy),
   *   category_id?, product_id?, warehouse_id?
   * }
   */
  getProductActSverkaByPeriod(filters = {}) {
    const dateFrom = filters.date_from ? this._ymd(filters.date_from) : null;
    const dateTo = filters.date_to ? this._ymd(filters.date_to) : null;
    if (!dateFrom || !dateTo) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'date_from va date_to majburiy (YYYY-MM-DD)');
    }

    const categoryId = filters.category_id || null;
    const productId = filters.product_id || null;
    const warehouseId = filters.warehouse_id || null;
    const orderDateExpr = this._tzDateExpr('o.created_at');
    const receiptDateExpr = this._tzDateExpr('COALESCE(pr.received_at, pr.created_at)');
    const returnDateExpr = this._tzDateExpr('sr.created_at');

    const hasPR = this._hasTable('purchase_receipts') && this._hasTable('purchase_receipt_items');
    const rtSverka = this._salesReturnTableNames();
    const hasReturns = Boolean(rtSverka.table);

    const hasQtyBase = (() => {
      try {
        return !!this.db
          .prepare(`SELECT 1 AS ok FROM pragma_table_info('order_items') WHERE name = 'qty_base' LIMIT 1`)
          .get()?.ok;
      } catch {
        return false;
      }
    })();
    const orderQtyExpr = hasQtyBase ? `COALESCE(oi.qty_base, oi.quantity, 0)` : `COALESCE(oi.quantity, 0)`;

    // return_items.qty_base is added in migration 041 — guard against older schemas where it's absent
    const hasReturnItemsQtyBase = hasReturns
      ? (() => {
          try {
            return !!this.db
              .prepare(`SELECT 1 AS ok FROM pragma_table_info(?) WHERE name = 'qty_base' LIMIT 1`)
              .get(rtSverka.items)?.ok;
          } catch {
            return false;
          }
        })()
      : false;
    const returnQtyExpr = hasReturnItemsQtyBase
      ? `COALESCE(ri.qty_base, ri.quantity, 0)`
      : `COALESCE(ri.quantity, 0)`;

    const salesParams = [];
    let salesWhere = `o.status = 'completed' AND ${orderDateExpr} BETWEEN date(?) AND date(?)`;
    salesParams.push(dateFrom, dateTo);
    if (warehouseId) {
      salesWhere += ` AND o.warehouse_id = ?`;
      salesParams.push(warehouseId);
    }
    if (productId) {
      salesWhere += ` AND oi.product_id = ?`;
      salesParams.push(productId);
    }
    if (categoryId) {
      salesWhere += ` AND p.category_id = ?`;
      salesParams.push(categoryId);
    }

    const purchParams = [];
    let purchWhere = `${receiptDateExpr} BETWEEN date(?) AND date(?)`;
    purchParams.push(dateFrom, dateTo);
    if (warehouseId) {
      purchWhere += ` AND pr.warehouse_id = ?`;
      purchParams.push(warehouseId);
    }
    if (productId) {
      purchWhere += ` AND pri.product_id = ?`;
      purchParams.push(productId);
    }
    if (categoryId) {
      purchWhere += ` AND p2.category_id = ?`;
      purchParams.push(categoryId);
    }

    const returnParams = [];
    let returnWhere = `LOWER(COALESCE(sr.status, 'completed')) = 'completed' AND ${returnDateExpr} BETWEEN date(?) AND date(?)`;
    returnParams.push(dateFrom, dateTo);
    if (productId) {
      returnWhere += ` AND ri.product_id = ?`;
      returnParams.push(productId);
    }
    if (categoryId) {
      returnWhere += ` AND p3.category_id = ?`;
      returnParams.push(categoryId);
    }
    if (warehouseId && hasReturns) {
      try {
        const hasWh = (this.db.prepare(`PRAGMA table_info(${rtSverka.table})`).all() || []).some(
          (c) => c.name === 'warehouse_id',
        );
        if (hasWh) {
          returnWhere += ` AND sr.warehouse_id = ?`;
          returnParams.push(warehouseId);
        }
      } catch {
        // ignore
      }
    }

    const purchCte = hasPR
      ? `
        purchased AS (
          SELECT
            pri.product_id,
            COALESCE(SUM(pri.received_qty), 0) AS purchase_qty,
            COALESCE(SUM(CASE
              WHEN COALESCE(pri.line_total, 0) > 0 THEN pri.line_total
              ELSE pri.received_qty * pri.unit_cost
            END), 0) AS purchase_amount
          FROM purchase_receipt_items pri
          INNER JOIN purchase_receipts pr ON pr.id = pri.receipt_id
          LEFT JOIN products p2 ON p2.id = pri.product_id
          WHERE ${purchWhere}
          GROUP BY pri.product_id
        ),
      `
      : `
        purchased AS (
          SELECT CAST(NULL AS TEXT) AS product_id, 0.0 AS purchase_qty, 0.0 AS purchase_amount
          WHERE 0
        ),
      `;

    const retCte = hasReturns
      ? `
        returned AS (
          SELECT
            ri.product_id,
            COALESCE(SUM(ri.quantity), 0) AS return_qty,
            COALESCE(SUM(ri.line_total), 0) AS return_amount,
            COALESCE(SUM(${returnQtyExpr} * COALESCE(p3.purchase_price, 0)), 0) AS return_cogs
          FROM ${rtSverka.items} ri
          INNER JOIN ${rtSverka.table} sr ON sr.id = ri.return_id
          LEFT JOIN products p3 ON p3.id = ri.product_id
          WHERE ${returnWhere}
          GROUP BY ri.product_id
        ),
      `
      : `
        returned AS (
          SELECT CAST(NULL AS TEXT) AS product_id, 0.0 AS return_qty, 0.0 AS return_amount, 0.0 AS return_cogs
          WHERE 0
        ),
      `;

    const salesCte = `
      sales AS (
        SELECT
          oi.product_id,
          COALESCE(SUM(${orderQtyExpr}), 0) AS sold_qty,
          COALESCE(SUM(oi.line_total), 0) AS sold_revenue,
          COALESCE(SUM(
            CASE
              WHEN COALESCE(oi.cost_price, 0) > 0 THEN oi.cost_price * ${orderQtyExpr}
              ELSE COALESCE(p.purchase_price, 0) * ${orderQtyExpr}
            END
          ), 0) AS sold_cogs
        FROM order_items oi
        INNER JOIN orders o ON o.id = oi.order_id
        LEFT JOIN products p ON p.id = oi.product_id
        WHERE ${salesWhere}
        GROUP BY oi.product_id
      ),
    `;

    const sql = `
      WITH
      ${purchCte}
      ${retCte}
      ${salesCte}
      combined AS (
        SELECT product_id FROM purchased WHERE purchase_qty > 0 OR purchase_amount > 0
        UNION
        SELECT product_id FROM sales WHERE sold_qty > 0 OR sold_revenue > 0
        UNION
        SELECT product_id FROM returned WHERE return_qty > 0 OR return_amount > 0
      )
      SELECT
        p.id AS product_id,
        p.name AS product_name,
        p.sku AS product_sku,
        COALESCE(c.name, '') AS category_name,
        COALESCE(pu.purchase_qty, 0) AS purchase_qty,
        COALESCE(pu.purchase_amount, 0) AS purchase_amount,
        COALESCE(s.sold_qty, 0) AS sold_qty,
        COALESCE(s.sold_revenue, 0) AS sold_revenue,
        COALESCE(s.sold_cogs, 0) AS sold_cogs,
        COALESCE(rt.return_qty, 0) AS return_qty,
        COALESCE(rt.return_amount, 0) AS return_amount,
        COALESCE(rt.return_cogs, 0) AS return_cogs,
        (COALESCE(s.sold_qty, 0) - COALESCE(rt.return_qty, 0)) AS net_sold_qty,
        (COALESCE(s.sold_revenue, 0) - COALESCE(rt.return_amount, 0)) AS net_revenue,
        (COALESCE(s.sold_cogs, 0) - COALESCE(rt.return_cogs, 0)) AS net_cogs,
        (
          (COALESCE(s.sold_revenue, 0) - COALESCE(rt.return_amount, 0)) -
          (COALESCE(s.sold_cogs, 0) - COALESCE(rt.return_cogs, 0))
        ) AS net_profit
      FROM combined cb
      INNER JOIN products p ON p.id = cb.product_id
      LEFT JOIN categories c ON c.id = p.category_id
      LEFT JOIN purchased pu ON pu.product_id = p.id
      LEFT JOIN sales s ON s.product_id = p.id
      LEFT JOIN returned rt ON rt.product_id = p.id
      WHERE p.is_active = 1
      ${
        productId
          ? 'AND p.id = ?'
          : categoryId
            ? 'AND p.category_id = ?'
            : ''
      }
      ORDER BY net_revenue DESC, p.name ASC
      LIMIT 5000
    `;

    const endParams = [];
    if (productId) endParams.push(productId);
    else if (categoryId) endParams.push(categoryId);

    const allParams = [...(hasPR ? purchParams : []), ...(hasReturns ? returnParams : []), ...salesParams, ...endParams];

    const logParams = [dateFrom, dateTo];
    let logWhere = `o.status = 'completed' AND ${orderDateExpr} BETWEEN date(?) AND date(?)`;
    if (warehouseId) {
      logWhere += ` AND o.warehouse_id = ?`;
      logParams.push(warehouseId);
    }
    if (productId) {
      logWhere += ` AND oi.product_id = ?`;
      logParams.push(productId);
    }
    this._logMissingCostPrice(`WHERE ${logWhere}`, logParams, 'product_act_sverka');

    const rows = this.db.prepare(sql).all(...allParams) || [];

    const mapped = (rows || []).map((r) => {
      const netRev = Number(r.net_revenue || 0) || 0;
      const netP = Number(r.net_profit || 0) || 0;
      return {
        product_id: r.product_id,
        product_name: r.product_name,
        product_sku: r.product_sku,
        category_name: r.category_name,
        purchase_qty: Number(r.purchase_qty || 0) || 0,
        purchase_amount: Number(r.purchase_amount || 0) || 0,
        sold_qty: Number(r.sold_qty || 0) || 0,
        sold_revenue: Number(r.sold_revenue || 0) || 0,
        sold_cogs: Number(r.sold_cogs || 0) || 0,
        return_qty: Number(r.return_qty || 0) || 0,
        return_amount: Number(r.return_amount || 0) || 0,
        return_cogs: Number(r.return_cogs || 0) || 0,
        net_sold_qty: Number(r.net_sold_qty || 0) || 0,
        net_revenue: netRev,
        net_cogs: Number(r.net_cogs || 0) || 0,
        net_profit: netP,
        profit_margin_percent: netRev > 0 ? (netP / netRev) * 100 : 0,
      };
    });

    const totals = mapped.reduce(
      (acc, row) => ({
        purchase_qty: acc.purchase_qty + row.purchase_qty,
        purchase_amount: acc.purchase_amount + row.purchase_amount,
        sold_qty: acc.sold_qty + row.sold_qty,
        sold_revenue: acc.sold_revenue + row.sold_revenue,
        return_qty: acc.return_qty + row.return_qty,
        return_amount: acc.return_amount + row.return_amount,
        net_revenue: acc.net_revenue + row.net_revenue,
        net_profit: acc.net_profit + row.net_profit,
      }),
      {
        purchase_qty: 0,
        purchase_amount: 0,
        sold_qty: 0,
        sold_revenue: 0,
        return_qty: 0,
        return_amount: 0,
        net_revenue: 0,
        net_profit: 0,
      }
    );

    return {
      period: { date_from: dateFrom, date_to: dateTo, timezone: 'Asia/Tashkent' },
      rows: mapped,
      totals: {
        ...totals,
        product_count: mapped.length,
        profit_margin_percent: totals.net_revenue > 0 ? (totals.net_profit / totals.net_revenue) * 100 : 0,
      },
    };
  }

  /**
   * Bitta mahsulot: qabul / sotuv / mijoz qaytishi — batafsil qatorlar (chronologiya + qoldiq miqdor).
   * Jadval: hujjatlar, counterparty; inventory_movements shart emas.
   * Davr oldi: birinchi qatorda (event_kind: opening_balance) ombor qoldig‘i — Tashkent sana < date_from bo‘lgan
   * qabul / sotuv / qaytarish bo‘yicha hujjatlardan hisoblanadi, keyin har bir qatordagi qoldiq shu zanjir bo‘yicha.
   * filters: { product_id, date_from, date_to, warehouse_id? }
   */
  getProductDocumentHistory(filters = {}) {
    const productId = filters.product_id;
    if (!productId) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'product_id majburiy');
    }
    const dateFrom = this._ymd(filters.date_from);
    const dateTo = this._ymd(filters.date_to);
    if (!filters.date_from || !filters.date_to) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'date_from va date_to majburiy (YYYY-MM-DD)');
    }
    const warehouseId = filters.warehouse_id || null;
    const prD = this._tzDateExpr('COALESCE(pr.received_at, pr.created_at)');
    const oD = this._tzDateExpr('o.created_at');

    const hasQtyBase = (() => {
      try {
        return !!this.db
          .prepare(`SELECT 1 AS ok FROM pragma_table_info('order_items') WHERE name = 'qty_base' LIMIT 1`)
          .get()?.ok;
      } catch {
        return false;
      }
    })();
    const qo = hasQtyBase ? 'COALESCE(oi.qty_base, oi.quantity, 0)' : 'COALESCE(oi.quantity, 0)';
    const hasPayments = this._hasTable('payments');
    const salePaymentJoin = hasPayments
      ? `
        LEFT JOIN (
          SELECT
            p.order_id,
            CASE
              WHEN COUNT(DISTINCT LOWER(COALESCE(p.payment_method, ''))) > 1 THEN 'Aralash'
              WHEN COUNT(DISTINCT LOWER(COALESCE(p.payment_method, ''))) = 1 THEN
                CASE LOWER(MIN(COALESCE(p.payment_method, '')))
                  WHEN 'cash' THEN 'Naqd'
                  WHEN 'card' THEN 'Karta'
                  WHEN 'transfer' THEN 'O‘tkazma'
                  WHEN 'credit' THEN 'Nasiya'
                  WHEN 'on_credit' THEN 'Nasiya'
                  WHEN 'debt' THEN 'Nasiya'
                  ELSE MIN(COALESCE(p.payment_method, ''))
                END
              ELSE NULL
            END AS method_label
          FROM payments p
          GROUP BY p.order_id
        ) pm ON pm.order_id = o.id
      `
      : '';

    const rt = this._salesReturnTableNames();
    const returnsTable = rt.table;
    const returnItemsTable = rt.items;
    const hasReturns = Boolean(returnsTable && returnItemsTable);
    const srD = hasReturns ? this._tzDateExpr('sr.created_at') : null;

    const parts = [];

    if (this._hasTable('purchase_receipts') && this._hasTable('purchase_receipt_items')) {
      let w = `pri.product_id = ? AND ${prD} BETWEEN date(?) AND date(?)`;
      const p = [productId, dateFrom, dateTo];
      if (warehouseId) {
        w += ` AND pr.warehouse_id = ?`;
        p.push(warehouseId);
      }
      parts.push({ sql: `
        SELECT
          COALESCE(pr.received_at, pr.created_at) AS event_at,
          'receipt' AS event_kind,
          'Ombor kirimi' AS event_label,
          pr.receipt_number AS doc_no,
          pr.id AS doc_id,
          'purchase_receipt' AS doc_type,
          COALESCE(s.name, 'Yetkazib beruvchi') AS counterparty,
          NULL AS payment_label,
          pri.received_qty AS qty_in,
          0.0 AS qty_out,
          COALESCE(NULLIF(pri.line_total, 0), pri.received_qty * pri.unit_cost, 0) AS amount_uzs,
          pri.id AS line_id
        FROM purchase_receipt_items pri
        INNER JOIN purchase_receipts pr ON pr.id = pri.receipt_id
        LEFT JOIN suppliers s ON s.id = pr.supplier_id
        WHERE ${w}
      `, p });
    }

    let wSale = `oi.product_id = ? AND o.status = 'completed' AND ${oD} BETWEEN date(?) AND date(?)`;
    const pSale = [productId, dateFrom, dateTo];
    if (warehouseId) {
      wSale += ` AND o.warehouse_id = ?`;
      pSale.push(warehouseId);
    }
    parts.push({ sql: `
        SELECT
          o.created_at AS event_at,
          'sale' AS event_kind,
          'Sotuv' AS event_label,
          o.order_number AS doc_no,
          o.id AS doc_id,
          'order' AS doc_type,
          CASE
            WHEN TRIM(COALESCE(c.name, '')) != '' THEN c.name
            WHEN TRIM(COALESCE(o.customer_id, '')) != '' THEN ('Mijoz #' || o.customer_id)
            ELSE 'Naqd / yuritma'
          END AS counterparty,
          CASE
            WHEN LOWER(COALESCE(o.payment_status, '')) = 'on_credit' THEN 'Nasiya'
            WHEN LOWER(COALESCE(o.payment_status, '')) = 'partial' THEN 'Qisman to‘langan'
            WHEN LOWER(COALESCE(o.payment_status, '')) = 'pending' THEN 'Qisman to‘langan'
            WHEN TRIM(COALESCE(pm.method_label, '')) != '' THEN pm.method_label
            ELSE 'Naqd'
          END AS payment_label,
          0.0 AS qty_in,
          ${qo} AS qty_out,
          COALESCE(oi.line_total, 0) AS amount_uzs,
          oi.id AS line_id
        FROM order_items oi
        INNER JOIN orders o ON o.id = oi.order_id
        LEFT JOIN customers c ON c.id = o.customer_id
        ${salePaymentJoin}
        WHERE ${wSale}
      `, p: pSale });

    if (hasReturns && srD) {
      let wR = `ri.product_id = ? AND LOWER(COALESCE(sr.status, 'completed')) = 'completed' AND ${srD} BETWEEN date(?) AND date(?)`;
      const pR = [productId, dateFrom, dateTo];
      if (warehouseId) {
        const hasWh = (() => {
          try {
            return (this.db.prepare(`PRAGMA table_info(${returnsTable})`).all() || []).some(
              (c) => c.name === 'warehouse_id',
            );
          } catch {
            return false;
          }
        })();
        if (hasWh) {
          wR += ` AND sr.warehouse_id = ?`;
          pR.push(warehouseId);
        }
      }
      parts.push({
        sql: `
        SELECT
          sr.created_at AS event_at,
          'return' AS event_kind,
          'Mijoz qaytishi' AS event_label,
          sr.return_number AS doc_no,
          sr.id AS doc_id,
          'sales_return' AS doc_type,
          CASE
            WHEN TRIM(COALESCE(c.name, '')) != '' THEN c.name
            WHEN TRIM(COALESCE(c2.name, '')) != '' THEN c2.name
            WHEN TRIM(COALESCE(sr.customer_id, '')) != '' THEN ('Mijoz #' || sr.customer_id)
            WHEN TRIM(COALESCE(o2.customer_id, '')) != '' THEN ('Mijoz #' || o2.customer_id)
            ELSE 'Mijoz'
          END AS counterparty,
          NULL AS payment_label,
          ri.quantity AS qty_in,
          0.0 AS qty_out,
          COALESCE(ri.line_total, 0) AS amount_uzs,
          ri.id AS line_id
        FROM ${returnItemsTable} ri
        INNER JOIN ${returnsTable} sr ON sr.id = ri.return_id
        LEFT JOIN customers c ON c.id = sr.customer_id
        LEFT JOIN orders o2 ON o2.id = sr.order_id
        LEFT JOIN customers c2 ON c2.id = o2.customer_id
        WHERE ${wR}
      `,
        p: pR,
      });
    }

    if (parts.length === 0) {
      return { period: { date_from: dateFrom, date_to: dateTo, timezone: 'Asia/Tashkent' }, rows: [] };
    }

    // Ombordagi qoldiq — tanlangan davr (Tashkent kuni) BOSHLANGANDAN OLDIN, xuddi yuqoridagi hujjatlardagidek
    let openingQty = 0;
    if (this._hasTable('purchase_receipts') && this._hasTable('purchase_receipt_items')) {
      let oW = `pri.product_id = ? AND ${prD} < date(?)`;
      const oP = [productId, dateFrom];
      if (warehouseId) {
        oW += ` AND pr.warehouse_id = ?`;
        oP.push(warehouseId);
      }
      const rOpen = this.db
        .prepare(
          `SELECT COALESCE(SUM(pri.received_qty),0) AS v
           FROM purchase_receipt_items pri
           INNER JOIN purchase_receipts pr ON pr.id = pri.receipt_id
           WHERE ${oW}`
        )
        .get(...oP);
      openingQty += Number(rOpen?.v || 0) || 0;
    }
    let oSaleW = `oi.product_id = ? AND o.status = 'completed' AND ${oD} < date(?)`;
    const oSaleP = [productId, dateFrom];
    if (warehouseId) {
      oSaleW += ` AND o.warehouse_id = ?`;
      oSaleP.push(warehouseId);
    }
    const sOpen = this.db
      .prepare(
        `SELECT COALESCE(SUM(${qo}),0) AS v
         FROM order_items oi
         INNER JOIN orders o ON o.id = oi.order_id
         WHERE ${oSaleW}`
      )
      .get(...oSaleP);
    openingQty -= Number(sOpen?.v || 0) || 0;
    if (hasReturns && returnsTable && returnItemsTable && srD) {
      let oRw = `ri.product_id = ? AND LOWER(COALESCE(sr.status, 'completed')) = 'completed' AND ${srD} < date(?)`;
      const oRP = [productId, dateFrom];
      if (warehouseId) {
        const oHasWh = (() => {
          try {
            return (this.db.prepare(`PRAGMA table_info(${returnsTable})`).all() || []).some(
              (c) => c.name === 'warehouse_id',
            );
          } catch {
            return false;
          }
        })();
        if (oHasWh) {
          oRw += ` AND sr.warehouse_id = ?`;
          oRP.push(warehouseId);
        }
      }
      const retOpen = this.db
        .prepare(
          `SELECT COALESCE(SUM(ri.quantity),0) AS v
           FROM ${returnItemsTable} ri
           INNER JOIN ${returnsTable} sr ON sr.id = ri.return_id
           WHERE ${oRw}`
        )
        .get(...oRP);
      openingQty += Number(retOpen?.v || 0) || 0;
    }

    // Do not wrap each branch in (...): some SQLite / driver builds misparenthesize (?, ?, ?) (?) UNION
    // and error with "near UNION: syntax error". A flat UNION ALL compiles reliably.
    const innerUnion = parts.map((x) => x.sql.trim()).join('\nUNION ALL\n');
    const sql = `
      SELECT * FROM (
${innerUnion}
      ) u
      ORDER BY datetime(event_at) ASC, line_id ASC
    `;
    const allParams = parts.flatMap((x) => x.p);
    const raw = this.db.prepare(sql).all(...allParams) || [];

    const includeOpening = (raw || []).length > 0 || openingQty !== 0;
    const openingRow = includeOpening
      ? {
          event_at: `${dateFrom}T00:00:00${UZBEKISTAN_TZ_ISO_OFFSET}`,
          event_kind: 'opening_balance',
          event_label: 'Davr oldi qoldiq',
          doc_no: null,
          doc_id: null,
          doc_type: 'period_opening',
          counterparty: '—',
          payment_label: null,
          qty_in: 0,
          qty_out: 0,
          amount_uzs: 0,
          line_id: '__period_opening__',
          running_qty: openingQty,
        }
      : null;

    let run = includeOpening && openingRow ? openingQty : 0;
    const combined = includeOpening && openingRow ? [openingRow, ...raw] : raw;
    const rows = (combined || []).map((r) => {
      if (r.event_kind === 'opening_balance') {
        return {
          event_at: r.event_at,
          event_kind: r.event_kind,
          event_label: r.event_label,
          doc_no: r.doc_no,
          doc_id: r.doc_id,
          doc_type: r.doc_type,
          counterparty: r.counterparty,
          payment_label: r.payment_label ?? null,
          qty_in: r.qty_in,
          qty_out: r.qty_out,
          amount_uzs: r.amount_uzs,
          line_id: r.line_id,
          running_qty: r.running_qty,
        };
      }
      const qin = Number(r.qty_in || 0) || 0;
      const qout = Number(r.qty_out || 0) || 0;
      run += qin - qout;
      return {
        event_at: r.event_at,
        event_kind: r.event_kind,
        event_label: r.event_label,
        doc_no: r.doc_no,
        doc_id: r.doc_id,
        doc_type: r.doc_type,
        counterparty: r.counterparty,
        payment_label: r.payment_label ?? null,
        qty_in: qin,
        qty_out: qout,
        amount_uzs: Number(r.amount_uzs || 0) || 0,
        line_id: r.line_id,
        running_qty: run,
      };
    });

    return { period: { date_from: dateFrom, date_to: dateTo, timezone: 'Asia/Tashkent' }, rows };
  }

  getCustomerActSverka(filters = {}) {
    const customerId = filters.customer_id;
    if (!customerId) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'customer_id is required');
    }

    const dateFrom = filters.date_from ? this._ymd(filters.date_from) : null;
    const dateTo = filters.date_to ? this._ymd(filters.date_to) : null;

    const customer = this.db
      .prepare(`SELECT id, name, phone, balance FROM customers WHERE id = ?`)
      .get(customerId);
    if (!customer) {
      throw createError(ERROR_CODES.NOT_FOUND, 'Customer not found');
    }

    // Preferred source of truth: customer_ledger
    if (this._hasTable('customer_ledger')) {
      const cols = this.db.prepare(`PRAGMA table_info(customer_ledger)`).all().map((c) => c.name);
      const hasMethod = cols.includes('method');
      const methodSelect = hasMethod ? ', cl.method' : `, NULL as method`;

      // Opening balance = last balance_after before date_from (or 0 if none)
      let openingBalance = 0;
      if (dateFrom) {
        const ob = this.db
          .prepare(
            `
            SELECT balance_after
            FROM customer_ledger
            WHERE customer_id = ?
              AND ${this._tzDateExpr('created_at')} < date(?)
            ORDER BY datetime(replace(replace(created_at, 'T', ' '), 'Z', '')) DESC
            LIMIT 1
          `
          )
          .get(customerId, dateFrom);
        openingBalance = Number(ob?.balance_after ?? 0) || 0;
      }

      const params = [customerId];
      let where = `WHERE cl.customer_id = ?`;
      if (dateFrom) {
        where += ` AND ${this._tzDateExpr('cl.created_at')} >= date(?)`;
        params.push(dateFrom);
      }
      if (dateTo) {
        where += ` AND ${this._tzDateExpr('cl.created_at')} <= date(?)`;
        params.push(dateTo);
      }

      const rows = this.db
        .prepare(
          `
          SELECT
            cl.id,
            cl.created_at,
            cl.type,
            cl.ref_id,
            cl.ref_no,
            cl.amount,
            cl.balance_after,
            cl.note
            ${methodSelect},
            cl.created_by,
            u.full_name as created_by_name
          FROM customer_ledger cl
          LEFT JOIN users u ON u.id = cl.created_by
          ${where}
          ORDER BY datetime(cl.created_at) ASC
        `
        )
        .all(params);

      const normalized = (rows || []).map((r) => {
        const amt = Number(r.amount ?? 0) || 0;
        return {
          id: r.id,
          created_at: r.created_at,
          type: r.type,
          ref_id: r.ref_id ?? null,
          ref_no: r.ref_no ?? null,
          amount: amt,
          // For readability:
          // - in_amount: balance increased (positive delta)
          // - out_amount: balance decreased (negative delta)
          in_amount: amt > 0 ? amt : 0,
          out_amount: amt < 0 ? Math.abs(amt) : 0,
          balance_after: Number(r.balance_after ?? 0) || 0,
          method: r.method ?? null,
          note: r.note ?? null,
          created_by: r.created_by ?? null,
          created_by_name: r.created_by_name ?? null,
        };
      });

      const totals = normalized.reduce(
        (acc, r) => {
          acc.in_amount += Number(r.in_amount || 0) || 0;
          acc.out_amount += Number(r.out_amount || 0) || 0;
          return acc;
        },
        { in_amount: 0, out_amount: 0 }
      );

      const closingBalance =
        normalized.length > 0 ? Number(normalized[normalized.length - 1].balance_after ?? 0) || 0 : openingBalance;

      return {
        customer,
        period: { date_from: dateFrom, date_to: dateTo },
        opening_balance: openingBalance,
        closing_balance: closingBalance,
        totals: { ...totals, net_amount: totals.in_amount - totals.out_amount },
        rows: normalized,
      };
    }

    // Fallback (older DBs): return minimal structure
    return {
      customer,
      period: { date_from: dateFrom, date_to: dateTo },
      opening_balance: 0,
      closing_balance: Number(customer.balance ?? 0) || 0,
      totals: { in_amount: 0, out_amount: 0, net_amount: 0 },
      rows: [],
    };
  }

  /**
   * Supplier Act Sverka (full supplier account statement)
   * Answers: bitta yetkazib beruvchi bo‘yicha nima/qancha/qachon/qanday (xarid + to‘lov + credit_note).
   *
   * filters: { supplier_id: string, date_from?: YYYY-MM-DD, date_to?: YYYY-MM-DD }
   *
   * Semantics (running balance):
   * - Purchase order (received/partially_received): increases debt (delta +total_amount)
   * - Supplier payment: decreases debt (delta -amount). If amount is negative (supplier paid us back), delta becomes positive.
   */
  getSupplierActSverka(filters = {}) {
    const supplierId = filters.supplier_id;
    if (!supplierId) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'supplier_id is required');
    }

    const dateFrom = filters.date_from ? this._ymd(filters.date_from) : null;
    const dateTo = filters.date_to ? this._ymd(filters.date_to) : null;

    const supplier = this.db
      .prepare(`SELECT id, name, phone, email, status, settlement_currency FROM suppliers WHERE id = ?`)
      .get(supplierId);
    if (!supplier) {
      throw createError(ERROR_CODES.NOT_FOUND, 'Supplier not found');
    }

    const settlementCurrency =
      String(supplier.settlement_currency || 'UZS').toUpperCase() === 'USD' ? 'USD' : 'UZS';
    const hasPoTotalUsd = (() => {
      try {
        return this.db.prepare(`PRAGMA table_info(purchase_orders)`).all().some((c) => c.name === 'total_usd');
      } catch {
        return false;
      }
    })();
    const hasPayAmountUsd = (() => {
      try {
        return this.db.prepare(`PRAGMA table_info(supplier_payments)`).all().some((c) => c.name === 'amount_usd');
      } catch {
        return false;
      }
    })();
    const poAmountCol = settlementCurrency === 'USD' && hasPoTotalUsd ? 'total_usd' : 'total_amount';
    const payAmountCol = settlementCurrency === 'USD' && hasPayAmountUsd ? 'amount_usd' : 'amount';

    // Opening balance = (sum purchases - sum payments) before date_from
    let openingBalance = 0;
    if (dateFrom) {
      const poSum = this.db
        .prepare(
          `
          SELECT COALESCE(SUM(${poAmountCol}), 0) as s
          FROM purchase_orders
          WHERE supplier_id = ?
            AND (status = 'received' OR status = 'partially_received')
            AND date(order_date) < date(?)
        `
        )
        .get(supplierId, dateFrom);
      const paySum = this.db
        .prepare(
          `
          SELECT COALESCE(SUM(${payAmountCol}), 0) as s
          FROM supplier_payments
          WHERE supplier_id = ?
            AND ${this._tzDateExpr('paid_at')} < date(?)
        `
        )
        .get(supplierId, dateFrom);
      openingBalance = (Number(poSum?.s || 0) || 0) - (Number(paySum?.s || 0) || 0);
    }

    const params = [supplierId];
    const poDateWhere = [];
    const payDateWhere = [];
    if (dateFrom) {
      poDateWhere.push(`date(po.order_date) >= date(?)`);
      payDateWhere.push(`${this._tzDateExpr('sp.paid_at')} >= date(?)`);
      params.push(dateFrom);
    }
    if (dateTo) {
      poDateWhere.push(`date(po.order_date) <= date(?)`);
      payDateWhere.push(`${this._tzDateExpr('sp.paid_at')} <= date(?)`);
      params.push(dateTo);
    }

    const poWhereExtra = poDateWhere.length ? ` AND ${poDateWhere.join(' AND ')}` : '';
    const payWhereExtra = payDateWhere.length ? ` AND ${payDateWhere.join(' AND ')}` : '';

    const rows = this.db
      .prepare(
        `
        SELECT *
        FROM (
          SELECT
            po.id as id,
            (po.order_date || ' 00:00:00') as created_at,
            'purchase' as type,
            po.id as ref_id,
            po.po_number as ref_no,
            CAST(po.${poAmountCol} as REAL) as amount,
            CAST(
              CASE
                WHEN po.status IN ('received', 'partially_received') THEN po.${poAmountCol}
                ELSE 0
              END
              as REAL
            ) as delta,
            po.status as po_status,
            NULL as method,
            po.notes as note,
            po.created_by as created_by,
            u.full_name as created_by_name
          FROM purchase_orders po
          LEFT JOIN users u ON u.id = po.created_by
          WHERE po.supplier_id = ?
            ${poWhereExtra}
          UNION ALL
          SELECT
            sp.id as id,
            sp.paid_at as created_at,
            CASE WHEN sp.payment_method = 'credit_note' THEN 'credit_note' ELSE 'payment' END as type,
            sp.purchase_order_id as ref_id,
            sp.payment_number as ref_no,
            CAST(sp.${payAmountCol} as REAL) as amount,
            CAST(-sp.${payAmountCol} as REAL) as delta,
            NULL as po_status,
            sp.payment_method as method,
            COALESCE(sp.notes, NULL) as note,
            sp.created_by as created_by,
            u2.full_name as created_by_name
          FROM supplier_payments sp
          LEFT JOIN users u2 ON u2.id = sp.created_by
          WHERE sp.supplier_id = ?
            ${payWhereExtra}
        )
        ORDER BY datetime(created_at) ASC
      `
      )
      // params contains [supplierId, (dateFrom?), (dateTo?)] for PO and same for payments
      // We need to pass supplierId twice, plus date params twice if present.
      .all(...(() => {
        const base = [supplierId];
        const dateParams = [];
        if (dateFrom) dateParams.push(dateFrom);
        if (dateTo) dateParams.push(dateTo);
        // purchase_orders: supplierId + dateParams
        // supplier_payments: supplierId + dateParams
        return [...base, ...dateParams, supplierId, ...dateParams];
      })());

    let running = openingBalance;
    const normalized = (rows || []).map((r) => {
      const delta = Number(r.delta ?? 0) || 0;
      running += delta;
      const inAmt = delta > 0 ? delta : 0;
      const outAmt = delta < 0 ? Math.abs(delta) : 0;
      return {
        id: r.id,
        created_at: r.created_at,
        type: r.type,
        ref_id: r.ref_id ?? null,
        ref_no: r.ref_no ?? null,
        amount: delta,
        in_amount: inAmt,
        out_amount: outAmt,
        balance_after: running,
        method: r.method ?? null,
        note: r.note ?? null,
        created_by: r.created_by ?? null,
        created_by_name: r.created_by_name ?? null,
      };
    });

    const totals = normalized.reduce(
      (acc, r) => {
        acc.in_amount += Number(r.in_amount || 0) || 0;
        acc.out_amount += Number(r.out_amount || 0) || 0;
        return acc;
      },
      { in_amount: 0, out_amount: 0 }
    );

    const closingBalance = normalized.length > 0 ? Number(normalized[normalized.length - 1].balance_after ?? 0) || 0 : openingBalance;

    return {
      supplier: { ...supplier, settlement_currency: settlementCurrency },
      period: { date_from: dateFrom, date_to: dateTo },
      opening_balance: openingBalance,
      closing_balance: closingBalance,
      totals: { ...totals, net_amount: totals.in_amount - totals.out_amount },
      rows: normalized,
    };
  }

  /**
   * Product Traceability (Unified timeline)
   * Answers: qachon, qancha, qanchadan, kimdan-kimga (supplier/customer/warehouse/system)
   *
   * filters: {
   *   product_id: string,
   *   date_from?: YYYY-MM-DD,
   *   date_to?: YYYY-MM-DD
   * }
   */
  getProductTraceability(filters = {}) {
    const productId = filters.product_id;
    if (!productId) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'product_id is required');
    }

    const dateFrom = filters.date_from ? this._ymd(filters.date_from) : null;
    const dateTo = filters.date_to ? this._ymd(filters.date_to) : null;

    const params = [productId];
    const dateWhere = (() => {
      if (dateFrom && dateTo) {
        params.push(dateFrom, dateTo);
        return `AND date(event_at) BETWEEN date(?) AND date(?)`;
      }
      if (dateFrom) {
        params.push(dateFrom);
        return `AND date(event_at) >= date(?)`;
      }
      if (dateTo) {
        params.push(dateTo);
        return `AND date(event_at) <= date(?)`;
      }
      return '';
    })();

    const hasSupplierReturns = this._hasTable('supplier_returns') && this._hasTable('supplier_return_items');
    // Support BOTH modern (`sales_returns`/`return_items`) and legacy (`sale_returns`/`sale_return_items`) schemas
    const modernReturnsTable = this._hasTable('sales_returns') && this._hasTable('return_items')
      ? { ret: 'sales_returns', items: 'return_items' }
      : null;
    const legacyReturnsTable = this._hasTable('sale_returns') && this._hasTable('sale_return_items')
      ? { ret: 'sale_returns', items: 'sale_return_items' }
      : null;
    const returnsSchema = modernReturnsTable || legacyReturnsTable;
    const hasReturns = !!returnsSchema;
    const hasAdjustments = this._hasTable('inventory_adjustments') && this._hasTable('inventory_adjustment_items');

    // Base warehouse label: in single-warehouse mode it's enough; later we can add warehouse_name join.
    const whLabel = `Warehouse`;

    const unions = [];

    // Purchases (supplier -> warehouse)
    unions.push(`
      SELECT
        po.order_date AS event_at,
        'purchase' AS event_type,
        po.po_number AS doc_number,
        s.name AS from_name,
        '${whLabel}' AS to_name,
        COALESCE(poi.received_qty, poi.ordered_qty, 0) AS quantity,
        poi.unit_cost AS unit_cost,
        NULL AS unit_price,
        NULL AS customer_id,
        po.supplier_id AS supplier_id,
        po.id AS reference_id
      FROM purchase_order_items poi
      INNER JOIN purchase_orders po ON po.id = poi.purchase_order_id
      LEFT JOIN suppliers s ON s.id = po.supplier_id
      WHERE poi.product_id = ?
    `);

    // Sales (warehouse -> customer)
    unions.push(`
      SELECT
        o.created_at AS event_at,
        'sale' AS event_type,
        o.order_number AS doc_number,
        '${whLabel}' AS from_name,
        COALESCE(c.name, 'Walk-in') AS to_name,
        oi.quantity AS quantity,
        NULL AS unit_cost,
        oi.unit_price AS unit_price,
        o.customer_id AS customer_id,
        NULL AS supplier_id,
        o.id AS reference_id
      FROM order_items oi
      INNER JOIN orders o ON o.id = oi.order_id
      LEFT JOIN customers c ON c.id = o.customer_id
      WHERE oi.product_id = ?
        AND o.status = 'completed'
    `);

    // Sales returns (customer -> warehouse) — works on modern OR legacy schema
    if (hasReturns) {
      unions.push(`
        SELECT
          sr.created_at AS event_at,
          'return' AS event_type,
          sr.return_number AS doc_number,
          COALESCE(c.name, 'Walk-in') AS from_name,
          '${whLabel}' AS to_name,
          sri.quantity AS quantity,
          NULL AS unit_cost,
          sri.unit_price AS unit_price,
          sr.customer_id AS customer_id,
          NULL AS supplier_id,
          sr.id AS reference_id
        FROM ${returnsSchema.items} sri
        INNER JOIN ${returnsSchema.ret} sr ON sr.id = sri.return_id
        LEFT JOIN customers c ON c.id = sr.customer_id
        WHERE sri.product_id = ?
          AND IFNULL(LOWER(sr.status), 'completed') = 'completed'
      `);
    }

    // Adjustments (system <-> warehouse)
    if (hasAdjustments) {
      unions.push(`
        SELECT
          ia.created_at AS event_at,
          'adjustment' AS event_type,
          ia.adjustment_number AS doc_number,
          CASE WHEN iai.adjustment_quantity < 0 THEN '${whLabel}' ELSE 'System' END AS from_name,
          CASE WHEN iai.adjustment_quantity < 0 THEN 'System' ELSE '${whLabel}' END AS to_name,
          ABS(iai.adjustment_quantity) AS quantity,
          NULL AS unit_cost,
          NULL AS unit_price,
          NULL AS customer_id,
          NULL AS supplier_id,
          ia.id AS reference_id
        FROM inventory_adjustment_items iai
        INNER JOIN inventory_adjustments ia ON ia.id = iai.adjustment_id
        WHERE iai.product_id = ?
          AND ia.status = 'completed'
      `);
    }

    // Supplier returns (warehouse -> supplier)
    if (hasSupplierReturns) {
      unions.push(`
        SELECT
          sr.created_at AS event_at,
          'supplier_return' AS event_type,
          sr.return_number AS doc_number,
          '${whLabel}' AS from_name,
          s.name AS to_name,
          sri.quantity AS quantity,
          sri.unit_cost AS unit_cost,
          NULL AS unit_price,
          NULL AS customer_id,
          sr.supplier_id AS supplier_id,
          sr.id AS reference_id
        FROM supplier_return_items sri
        INNER JOIN supplier_returns sr ON sr.id = sri.return_id
        LEFT JOIN suppliers s ON s.id = sr.supplier_id
        WHERE sri.product_id = ?
          AND sr.status = 'completed'
      `);
    }

    // Each union needs the product_id param. We passed it once; duplicate for each UNION block.
    // Build params array accordingly: productId repeated N times, then date filters.
    const unionCount = unions.length;
    const baseParams = [];
    for (let i = 0; i < unionCount; i++) baseParams.push(productId);

    const finalParams = [...baseParams, ...params.slice(1)]; // params[0] already productId

    const rows = this.db
      .prepare(
        `
        WITH timeline AS (
          ${unions.join('\nUNION ALL\n')}
        )
        SELECT *
        FROM timeline
        WHERE 1=1
        ${dateWhere}
        ORDER BY datetime(event_at) DESC
        LIMIT 2000
      `
      )
      .all(finalParams);

    return rows.map((r) => ({
      ...r,
      quantity: Number(r.quantity || 0) || 0,
      unit_cost: r.unit_cost == null ? null : Number(r.unit_cost || 0) || 0,
      unit_price: r.unit_price == null ? null : Number(r.unit_price || 0) || 0,
    }));
  }

  /**
   * Cash flow report (all payment methods).
   * filters: { date_from?, date_to?, granularity?: 'day'|'week' }
   *
   * Returns rows grouped by (period_start, method):
   *   { period_start, period_key, method, inflow, outflow, net, sources: { ... } }
   */
  /**
   * Cashier performance summary for a date range.
   *
   * For each cashier (orders.user_id or orders.cashier_id) returns:
   *   - order_count       (completed orders only)
   *   - total_revenue     (SUM(o.total_amount) on completed orders)
   *   - total_profit      (revenue - COGS, COGS estimated from oi.cost_price w/ products.purchase_price fallback)
   *   - cancelled_count   (orders with status='cancelled' in same period)
   *   - cancelled_value   (SUM(o.total_amount) on cancelled orders)
   *
   * Replaces the legacy client-side aggregation in CashierPerformanceReport.tsx
   * which had THREE bugs:
   *   1. Used getOrders() default limit=100 (silent data loss for >100 orders)
   *   2. Filtered by status='completed' THEN counted cancelled inside (always 0)
   *   3. Skipped orders where cashier_id is NULL (no fallback to user_id)
   */
  getCashierPerformance(filters = {}) {
    const dateFrom = filters.date_from ? this._ymd(filters.date_from) : null;
    const dateTo = filters.date_to ? this._ymd(filters.date_to) : null;
    const warehouseId = filters.warehouse_id || null;
    const isAllWarehouses = String(filters.warehouse_id || '').toUpperCase() === 'ALL';

    if (!this._hasTable('orders')) return [];

    const params = [];
    let whereCommon = `WHERE 1=1`;
    const orderDateExpr = this._tzDateExpr('o.created_at');
    if (dateFrom) {
      whereCommon += ` AND ${orderDateExpr} >= date(?)`;
      params.push(dateFrom);
    }
    if (dateTo) {
      whereCommon += ` AND ${orderDateExpr} <= date(?)`;
      params.push(dateTo);
    }
    if (warehouseId && !isAllWarehouses) {
      whereCommon += ` AND o.warehouse_id = ?`;
      params.push(warehouseId);
    }

    const hasUsers = this._hasTable('users');
    const hasProfiles = this._hasTable('profiles');
    const hasOrderItems = this._hasTable('order_items');

    // Cashier identity is the union of user_id and cashier_id
    const cashierIdExpr = `COALESCE(o.user_id, o.cashier_id)`;

    const salesSplit = unifiedSalesSplitExpressions(this.db, 'o');

    // Aggregate orders by cashier — completed and cancelled separately
    const completedQuery = `
      SELECT
        ${cashierIdExpr} AS employee_id,
        COUNT(*) AS order_count,
        COALESCE(SUM(${unifiedAmountUzsSql(this.db, 'o')}), 0) AS total_revenue,
        ${salesSplit.uzsSum} AS revenue_uzs,
        ${salesSplit.usdSum} AS revenue_usd
      FROM ${this._salesTable()} o
      ${whereCommon}
        AND ${completedStatusWhere(this.db, 'o')}
        AND ${cashierIdExpr} IS NOT NULL
      GROUP BY ${cashierIdExpr}
    `;
    const cancelledQuery = `
      SELECT
        ${cashierIdExpr} AS employee_id,
        COUNT(*) AS cancelled_count,
        COALESCE(SUM(${orderFieldUzsSql(this.db, 'o', 'total_amount')}), 0) AS cancelled_value
      FROM orders o
      ${whereCommon}
        AND o.status = 'cancelled'
        AND ${cashierIdExpr} IS NOT NULL
      GROUP BY ${cashierIdExpr}
    `;

    const completedRows = this.db.prepare(completedQuery).all(params);
    const cancelledRows = this.db.prepare(cancelledQuery).all(params);

    // COGS + profit per cashier (completed orders, post-discount sold revenue)
    let cogsRows = [];
    let profitRows = [];
    if (hasOrderItems || this._hasSaleItemsSource()) {
      const soldRevExpr = this._soldLineRevenueUzsSql('oi');
      const cogsExpr = this._cogsLineSql('oi');
      const itemsTable = this._saleItemsTable();
      const orderJoinCol = this._useUnifiedSales() ? 'unified_order_id' : 'order_id';
      const salesJoinCol = this._useUnifiedSales() ? 'unified_id' : 'id';
      const salesTable = this._salesTable();
      const cogsQuery = `
        SELECT
          ${cashierIdExpr} AS employee_id,
          COALESCE(SUM(${cogsExpr}), 0) AS total_cogs,
          COALESCE(SUM(${soldRevExpr}), 0) AS sold_revenue,
          COALESCE(SUM(${soldRevExpr}) - SUM(${cogsExpr}), 0) AS total_profit
        FROM ${itemsTable} oi
        INNER JOIN ${salesTable} o ON o.${salesJoinCol} = oi.${orderJoinCol}
        ${whereCommon}
          AND ${completedStatusWhere(this.db, 'o')}
          AND ${cashierIdExpr} IS NOT NULL
        GROUP BY ${cashierIdExpr}
      `;
      cogsRows = this.db.prepare(cogsQuery).all(params);
    }
    const cogsByEmployee = new Map();
    const profitByEmployee = new Map();
    const soldRevenueByEmployee = new Map();
    for (const r of cogsRows || []) {
      cogsByEmployee.set(r.employee_id, Number(r.total_cogs) || 0);
      profitByEmployee.set(r.employee_id, Number(r.total_profit) || 0);
      soldRevenueByEmployee.set(r.employee_id, Number(r.sold_revenue) || 0);
    }

    const cancelledByEmployee = new Map();
    for (const r of cancelledRows || []) {
      cancelledByEmployee.set(r.employee_id, {
        count: Number(r.cancelled_count) || 0,
        value: Number(r.cancelled_value) || 0,
      });
    }

    // Resolve names from users / profiles
    const nameByEmployee = new Map();
    const employeeIds = new Set([
      ...completedRows.map((r) => r.employee_id),
      ...cancelledRows.map((r) => r.employee_id),
    ]);
    if (employeeIds.size > 0) {
      const ids = Array.from(employeeIds).filter(Boolean);
      if (ids.length > 0) {
        const placeholders = ids.map(() => '?').join(',');
        if (hasUsers) {
          try {
            const rows = this.db
              .prepare(`SELECT id, full_name, username FROM users WHERE id IN (${placeholders})`)
              .all(ids);
            for (const r of rows || []) {
              nameByEmployee.set(r.id, r.full_name || r.username || r.id);
            }
          } catch { /* ignore */ }
        }
        if (hasProfiles) {
          try {
            const rows = this.db
              .prepare(`SELECT id, full_name, username FROM profiles WHERE id IN (${placeholders})`)
              .all(ids);
            for (const r of rows || []) {
              if (!nameByEmployee.has(r.id)) {
                nameByEmployee.set(r.id, r.full_name || r.username || r.id);
              }
            }
          } catch { /* ignore */ }
        }
      }
    }

    // Build result
    const result = [];
    const seen = new Set();
    for (const r of completedRows || []) {
      const empId = r.employee_id;
      seen.add(empId);
      const revenue = Number(r.total_revenue) || 0;
      const cogs = cogsByEmployee.get(empId) || 0;
      const profit = profitByEmployee.get(empId) ?? revenue - cogs;
      const cancelled = cancelledByEmployee.get(empId) || { count: 0, value: 0 };
      result.push({
        employee_id: empId,
        employee_name: nameByEmployee.get(empId) || empId,
        order_count: Number(r.order_count) || 0,
        total_revenue: revenue,
        revenue_uzs: Number(r.revenue_uzs || 0) || 0,
        revenue_usd: Number(r.revenue_usd || 0) || 0,
        total_profit: profit,
        cancelled_count: cancelled.count,
        cancelled_value: cancelled.value,
      });
    }
    // Cashiers with only cancelled orders in period
    for (const r of cancelledRows || []) {
      if (seen.has(r.employee_id)) continue;
      result.push({
        employee_id: r.employee_id,
        employee_name: nameByEmployee.get(r.employee_id) || r.employee_id,
        order_count: 0,
        total_revenue: 0,
        total_profit: 0,
        cancelled_count: Number(r.cancelled_count) || 0,
        cancelled_value: Number(r.cancelled_value) || 0,
      });
    }

    result.sort((a, b) => (b.total_revenue || 0) - (a.total_revenue || 0));
    return result;
  }

  _mergePaymentMethodRows(rows, extraRows) {
    const merged = new Map();
    for (const list of [rows, extraRows]) {
      for (const r of list || []) {
        const m = String(r.method || 'unknown');
        const existing = merged.get(m) || { count: 0, total: 0 };
        merged.set(m, {
          count: existing.count + (Number(r.count) || 0),
          total: existing.total + (Number(r.total) || 0),
        });
      }
    }
    return Array.from(merged.entries())
      .map(([method, v]) => ({ method, count: v.count, total: v.total }))
      .sort((a, b) => b.total - a.total);
  }

  /**
   * AR collections (customer_payments) and paid web/Payme/Click orders —
   * not stored in POS `payments`.
   */
  _bankReconExtraMethodRows({ dateFrom, dateTo, warehouseId, isAllWarehouses, nonCashSettlement }) {
    const extra = [];
    const applyDates = (col, params, where) => {
      const dateExpr = this._tzDateExpr(col);
      let next = where;
      if (dateFrom) {
        next += ` AND ${dateExpr} >= date(?)`;
        params.push(dateFrom);
      }
      if (dateTo) {
        next += ` AND ${dateExpr} <= date(?)`;
        params.push(dateTo);
      }
      return next;
    };

    if (this._hasTable('customer_payments')) {
      try {
        const cpUzs = customerPaymentAmountUzsSql(this.db, 'cp');
        const cpParams = [];
        let cpWhere = `WHERE COALESCE(LOWER(cp.payment_method), '') NOT IN ${nonCashSettlement}
          AND COALESCE(LOWER(cp.payment_method), '') NOT IN ('refund_cash', 'refund_balance')
          AND COALESCE(cp.amount, 0) > 0`;
        const hasOp = !!this.db
          .prepare(`SELECT 1 AS ok FROM pragma_table_info('customer_payments') WHERE name = 'operation' LIMIT 1`)
          .get()?.ok;
        if (hasOp) {
          cpWhere += ` AND COALESCE(LOWER(cp.operation), 'payment_in') = 'payment_in'`;
        }
        cpWhere = applyDates('cp.paid_at', cpParams, cpWhere);
        if (warehouseId && !isAllWarehouses) {
          cpWhere += ` AND EXISTS (SELECT 1 FROM orders o2 WHERE o2.id = cp.order_id AND o2.warehouse_id = ?)`;
          cpParams.push(warehouseId);
        }
        const cpRows = this.db
          .prepare(
            `
            SELECT
              COALESCE(LOWER(NULLIF(TRIM(cp.payment_method), '')), 'unknown') AS method,
              COUNT(*) AS count,
              COALESCE(SUM(${cpUzs}), 0) AS total
            FROM customer_payments cp
            ${cpWhere}
            GROUP BY method
          `
          )
          .all(...cpParams);
        extra.push(...(cpRows || []));
      } catch {
        /* schema partial */
      }
    }

    if (this._hasTable('web_orders')) {
      try {
        const includeWebWarehouse = !warehouseId || isAllWarehouses || String(warehouseId) === 'main-warehouse-001';
        if (includeWebWarehouse) {
          const webAmt = webOrderAmountUzsSql(this.db, 'wo');
          const webParams = [];
          let webWhere = `WHERE LOWER(TRIM(COALESCE(wo.payment_status, ''))) = 'paid'
            AND COALESCE(LOWER(wo.payment_method), '') NOT IN ${nonCashSettlement}`;
          webWhere = applyDates('COALESCE(wo.updated_at, wo.created_at)', webParams, webWhere);
          const webRows = this.db
            .prepare(
              `
              SELECT
                COALESCE(LOWER(NULLIF(TRIM(wo.payment_method), '')), 'unknown') AS method,
                COUNT(*) AS count,
                COALESCE(SUM(${webAmt}), 0) AS total
              FROM web_orders wo
              ${webWhere}
              GROUP BY method
            `
            )
            .all(...webParams);
          extra.push(...(webRows || []));
        }
      } catch {
        /* schema partial */
      }
    }

    return extra;
  }

  /**
   * Payment methods distribution for a date range.
   * Aggregates `payments` (order payments) by `payment_method`.
   *
   * Excludes:
   *   - non-cash settlement methods (credit / on_credit / debt / customer_account / credit_note)
   *   - refund payouts (refund_cash)
   *
   * Returns:
   *   {
   *     filters: { date_from, date_to, warehouse_id },
   *     totals: { total_amount, total_count, avg_per_tx },
   *     methods: [{ method, count, total, percentage, avg }]
   *   }
   *
   * NOTE: Replaces the legacy client-side aggregation in PaymentMethodReport.tsx
   * which fetched only the latest 100 orders via `getOrders()`.
   */
  getPaymentMethodsSummary(filters = {}) {
    const dateFrom = filters.date_from ? this._ymd(filters.date_from) : null;
    const dateTo = filters.date_to ? this._ymd(filters.date_to) : null;
    const warehouseId = filters.warehouse_id || null;
    const isAllWarehouses = String(filters.warehouse_id || '').toUpperCase() === 'ALL';

    if (!this._hasTable('orders')) {
      return {
        filters: { date_from: dateFrom, date_to: dateTo, warehouse_id: warehouseId },
        totals: { total_amount: 0, total_count: 0, avg_per_tx: 0 },
        methods: [],
      };
    }

    const params = [];
    let where = `WHERE o.status = 'completed'`;
    const orderDateExpr = this._tzDateExpr('o.created_at');
    if (dateFrom) {
      where += ` AND ${orderDateExpr} >= date(?)`;
      params.push(dateFrom);
    }
    if (dateTo) {
      where += ` AND ${orderDateExpr} <= date(?)`;
      params.push(dateTo);
    }
    if (warehouseId && !isAllWarehouses) {
      where += ` AND o.warehouse_id = ?`;
      params.push(warehouseId);
    }

    // Non-cash settlement methods that should NOT count toward "received money"
    const nonCashSettlement = `('credit', 'on_credit', 'debt', 'customer_account', 'credit_note')`;
    const refundPayout = `('refund_cash')`;

    const hasPayments = this._hasTable('payments');

    let rows = [];
    if (hasPayments) {
      const payUzs = paymentAmountUzsSql(this.db, 'p', 'o');
      rows = this.db
        .prepare(
          `
          SELECT
            COALESCE(LOWER(NULLIF(TRIM(p.payment_method), '')), 'unknown') AS method,
            COUNT(*) AS count,
            COALESCE(SUM(${payUzs}), 0) AS total
          FROM payments p
          INNER JOIN orders o ON o.id = p.order_id
          ${where}
            AND COALESCE(LOWER(p.payment_method), '') NOT IN ${nonCashSettlement}
            AND COALESCE(LOWER(p.payment_method), '') NOT IN ${refundPayout}
            AND p.amount > 0
          GROUP BY method
          ORDER BY total DESC
        `
        )
        .all(params);
    }

    // Fallback for orders that have NO `payments` row at all but are completed
    // (e.g. pure-cash quick sales not split into payments). Use orders.payment_type.
    const hasPaymentType = (() => {
      try {
        return !!this.db
          .prepare(`SELECT 1 AS ok FROM pragma_table_info('orders') WHERE name = 'payment_type' LIMIT 1`)
          .get()?.ok;
      } catch {
        return false;
      }
    })();

    if (hasPaymentType) {
      const orphanQuery = hasPayments
        ? `
          SELECT
            COALESCE(LOWER(NULLIF(TRIM(o.payment_type), '')), 'cash') AS method,
            COUNT(*) AS count,
            COALESCE(SUM(${orderAmountUzsSql(this.db, 'o')}), 0) AS total
          FROM orders o
          ${where}
            AND COALESCE(LOWER(o.payment_type), '') NOT IN ${nonCashSettlement}
            AND COALESCE(LOWER(o.payment_type), '') NOT IN ${refundPayout}
            AND NOT EXISTS (SELECT 1 FROM payments p2 WHERE p2.order_id = o.id AND p2.amount > 0)
            AND o.total_amount > 0
          GROUP BY method
        `
        : `
          SELECT
            COALESCE(LOWER(NULLIF(TRIM(o.payment_type), '')), 'cash') AS method,
            COUNT(*) AS count,
            COALESCE(SUM(${orderAmountUzsSql(this.db, 'o')}), 0) AS total
          FROM orders o
          ${where}
            AND COALESCE(LOWER(o.payment_type), '') NOT IN ${nonCashSettlement}
            AND COALESCE(LOWER(o.payment_type), '') NOT IN ${refundPayout}
            AND o.total_amount > 0
          GROUP BY method
        `;
      const orphanRows = this.db.prepare(orphanQuery).all(params);
      const merged = new Map();
      for (const r of rows) merged.set(r.method, { count: Number(r.count) || 0, total: Number(r.total) || 0 });
      for (const r of orphanRows || []) {
        const m = r.method;
        const existing = merged.get(m) || { count: 0, total: 0 };
        merged.set(m, {
          count: existing.count + (Number(r.count) || 0),
          total: existing.total + (Number(r.total) || 0),
        });
      }
      rows = Array.from(merged.entries())
        .map(([method, v]) => ({ method, count: v.count, total: v.total }))
        .sort((a, b) => b.total - a.total);
    }

    rows = this._mergePaymentMethodRows(
      rows,
      this._bankReconExtraMethodRows({
        dateFrom,
        dateTo,
        warehouseId,
        isAllWarehouses,
        nonCashSettlement,
      })
    );

    const totalAmount = rows.reduce((s, r) => s + (Number(r.total) || 0), 0);
    const totalCount = rows.reduce((s, r) => s + (Number(r.count) || 0), 0);

    const methods = rows.map((r) => {
      const total = Number(r.total) || 0;
      const count = Number(r.count) || 0;
      return {
        method: r.method || 'unknown',
        count,
        total,
        percentage: totalAmount > 0 ? (total / totalAmount) * 100 : 0,
        avg: count > 0 ? total / count : 0,
      };
    });

    return {
      filters: { date_from: dateFrom, date_to: dateTo, warehouse_id: warehouseId || null },
      totals: {
        total_amount: totalAmount,
        total_count: totalCount,
        avg_per_tx: totalCount > 0 ? totalAmount / totalCount : 0,
      },
      methods,
    };
  }

  /**
   * Bank vs cash reconciliation (MVP): sum payments by method group for a date range.
   * Cash vs card/transfer/click/payme/bank. No statement import.
   */
  getBankCashReconciliation(filters = {}) {
    const summary = this.getPaymentMethodsSummary(filters);
    const groups = {
      cash: { total: 0, count: 0, methods: [] },
      bank: { total: 0, count: 0, methods: [] },
      credit: { total: 0, count: 0, methods: [] },
      other: { total: 0, count: 0, methods: [] },
    };
    for (const m of summary.methods || []) {
      const group = classifyPaymentMethodGroup(m.method);
      const bucket = groups[group] || groups.other;
      bucket.total += Number(m.total) || 0;
      bucket.count += Number(m.count) || 0;
      bucket.methods.push(m);
    }
    const totalCommission = this._sumPeriodCommissions(
      summary.filters.date_from,
      summary.filters.date_to,
      summary.filters.warehouse_id
    );
    return {
      filters: summary.filters,
      cash: groups.cash,
      bank: groups.bank,
      credit: groups.credit,
      other: groups.other,
      totals: summary.totals,
      total_commission: totalCommission,
      payment_fees: totalCommission,
      methods: summary.methods,
    };
  }

  getCashFlow(filters = {}) {
    const granularity = filters.granularity === 'week' ? 'week' : 'day';
    const dateFrom = filters.date_from ? this._ymd(filters.date_from) : null;
    const dateTo = filters.date_to ? this._ymd(filters.date_to) : null;

    const hasPayments = this._hasTable('payments');
    const hasCustomerPayments = this._hasTable('customer_payments');
    const hasExpenses = this._hasTable('expenses');
    const hasSupplierPayments = this._hasTable('supplier_payments');
    // Prefer modern `sales_returns`; fallback to legacy `sale_returns`
    const returnsTable = this._hasTable('sales_returns')
      ? 'sales_returns'
      : this._hasTable('sale_returns')
        ? 'sale_returns'
        : null;
    const _retHasRefundMethod = returnsTable
      ? (() => {
          try {
            return !!this.db
              .prepare(`SELECT 1 AS ok FROM pragma_table_info(?) WHERE name = 'refund_method' LIMIT 1`)
              .get(returnsTable)?.ok;
          } catch {
            return false;
          }
        })()
      : false;
    const _retHasRefundAmount = returnsTable
      ? (() => {
          try {
            return !!this.db
              .prepare(`SELECT 1 AS ok FROM pragma_table_info(?) WHERE name = 'refund_amount' LIMIT 1`)
              .get(returnsTable)?.ok;
          } catch {
            return false;
          }
        })()
      : false;

    // If there is no data source at all, return empty bundle.
    if (!hasPayments && !hasCustomerPayments && !hasExpenses && !hasSupplierPayments && !returnsTable) {
      return { rows: [], by_source: [], reconciliation: null };
    }

    const params = [];
    const whereDate = (col) => {
      let where = 'WHERE 1=1';
      const dateExpr = this._tzDateExpr(col);
      if (dateFrom) {
        where += ` AND ${dateExpr} >= date(?)`;
        params.push(dateFrom);
      }
      if (dateTo) {
        where += ` AND ${dateExpr} <= date(?)`;
        params.push(dateTo);
      }
      return where;
    };

    // We aggregate per-day first (d), then compute period_start (day/week) above it.
    const parts = [];

    if (hasPayments) {
      const payUzs = paymentAmountUzsSql(this.db, 'p', 'o');
      parts.push(`
        SELECT
          ${this._tzDateExpr('p.paid_at')} AS d,
          p.payment_method AS method,
          COALESCE(SUM(CASE WHEN COALESCE(LOWER(p.payment_method), '') IN ('refund_cash') THEN 0 ELSE ${payUzs} END), 0) AS inflow,
          COALESCE(SUM(CASE WHEN COALESCE(LOWER(p.payment_method), '') IN ('refund_cash') THEN ${payUzs} ELSE 0 END), 0) AS outflow,
          'order_payments' AS source
        FROM payments p
        INNER JOIN orders o ON o.id = p.order_id
        ${whereDate('p.paid_at')}
          AND COALESCE(LOWER(p.payment_method), '') NOT IN ('credit', 'on_credit', 'debt')
        GROUP BY ${this._tzDateExpr('p.paid_at')}, p.payment_method
      `);
    }

    if (hasCustomerPayments) {
      const cpUzs = customerPaymentAmountUzsSql(this.db, 'cp');
      parts.push(`
        SELECT
          ${this._tzDateExpr('cp.paid_at')} AS d,
          cp.payment_method AS method,
          COALESCE(SUM(${cpUzs}), 0) AS inflow,
          0 AS outflow,
          'customer_payments' AS source
        FROM customer_payments cp
        ${whereDate('cp.paid_at')}
          AND COALESCE(LOWER(cp.payment_method), '') NOT IN ('credit', 'on_credit', 'debt')
        GROUP BY ${this._tzDateExpr('cp.paid_at')}, cp.payment_method
      `);
    }

    if (hasExpenses) {
      parts.push(`
        SELECT
          ${this._tzDateExpr('e.expense_date')} AS d,
          e.payment_method AS method,
          0 AS inflow,
          COALESCE(SUM(${expenseAmountUzsSql(this.db, 'e')}), 0) AS outflow,
          'expenses' AS source
        FROM expenses e
        ${whereDate('e.expense_date')}
          AND e.status = 'approved'
        GROUP BY ${this._tzDateExpr('e.expense_date')}, e.payment_method
      `);
    }

    if (hasSupplierPayments) {
      const spUzs = supplierPaymentCashUzsSql(this.db, 'sp');
      parts.push(`
        SELECT
          ${this._tzDateExpr('sp.paid_at')} AS d,
          sp.payment_method AS method,
          COALESCE(SUM(CASE WHEN COALESCE(LOWER(sp.payment_method), '') IN ('credit_note') THEN 0 WHEN ${spUzs} < 0 THEN ABS(${spUzs}) ELSE 0 END), 0) AS inflow,
          COALESCE(SUM(CASE WHEN COALESCE(LOWER(sp.payment_method), '') IN ('credit_note') THEN 0 WHEN ${spUzs} > 0 THEN ${spUzs} ELSE 0 END), 0) AS outflow,
          'supplier_payments' AS source
        FROM supplier_payments sp
        ${whereDate('sp.paid_at')}
        GROUP BY ${this._tzDateExpr('sp.paid_at')}, sp.payment_method
      `);
    }

    if (returnsTable) {
      const methodExpr = _retHasRefundMethod
        ? `COALESCE(r.refund_method, 'unknown')`
        : `'unknown'`;
      const amountExpr = _retHasRefundAmount
        ? `COALESCE(r.refund_amount, r.total_amount, 0)`
        : `COALESCE(r.total_amount, 0)`;
      const refundUzs = returnRefundUzsSql(this.db, 'r', 'o', amountExpr);
      parts.push(`
        SELECT
          ${this._tzDateExpr('r.created_at')} AS d,
          ${methodExpr} AS method,
          0 AS inflow,
          COALESCE(SUM(${refundUzs}), 0) AS outflow,
          'refunds' AS source
        FROM ${returnsTable} r
        LEFT JOIN orders o ON o.id = r.order_id
        ${whereDate('r.created_at')}
          AND LOWER(COALESCE(r.status, '')) = 'completed'
        GROUP BY ${this._tzDateExpr('r.created_at')}, ${methodExpr}
      `);
    }

    const union = parts.join('\nUNION ALL\n');

    const periodStartExpr =
      granularity === 'week'
        ? `date(d, '-' || ((CAST(strftime('%w', d) AS INTEGER) + 6) % 7) || ' days')`
        : `d`;

    const query = `
      WITH tx AS (
        ${union}
      )
      SELECT
        ${periodStartExpr} AS period_start,
        CASE
          WHEN ? = 'week' THEN strftime('%Y-W%W', d)
          ELSE d
        END AS period_key,
        method,
        COALESCE(SUM(inflow), 0) AS inflow,
        COALESCE(SUM(outflow), 0) AS outflow,
        COALESCE(SUM(inflow), 0) - COALESCE(SUM(outflow), 0) AS net
      FROM tx
      GROUP BY period_start, period_key, method
      ORDER BY period_start ASC, method ASC
    `;

    const bySourceQuery = `
      WITH tx AS (
        ${union}
      )
      SELECT
        source,
        COALESCE(SUM(inflow), 0) AS inflow,
        COALESCE(SUM(outflow), 0) AS outflow,
        COALESCE(SUM(inflow), 0) - COALESCE(SUM(outflow), 0) AS net
      FROM tx
      GROUP BY source
      ORDER BY source ASC
    `;

    // SQL placeholder order: all WHERE params first (in union order), then granularity check (`WHEN ? = 'week'`)
    const allParams = [...params, granularity];
    const rows = this.db.prepare(query).all(allParams);
    const bySourceRows = this.db.prepare(bySourceQuery).all(params);

    const mappedRows = (rows || []).map((r) => ({
      period_start: r.period_start,
      period_key: r.period_key,
      method: r.method || 'unknown',
      inflow: Number(r.inflow || 0) || 0,
      outflow: Number(r.outflow || 0) || 0,
      net: Number(r.net || 0) || 0,
    }));

    const by_source = (bySourceRows || []).map((r) => ({
      source: r.source || 'unknown',
      inflow: Number(r.inflow || 0) || 0,
      outflow: Number(r.outflow || 0) || 0,
      net: Number(r.net || 0) || 0,
    }));

    let reconciliation = null;
    if (this._hasTable('shifts')) {
      try {
        const shiftParams = [];
        const closedDateExpr = `COALESCE(${this._tzDateExpr('s.closed_at')}, ${this._tzDateExpr('s.opened_at')})`;
        let shiftWhere = `WHERE s.status = 'closed' AND ${closedDateExpr} IS NOT NULL`;
        if (dateFrom) {
          shiftWhere += ` AND ${closedDateExpr} >= date(?)`;
          shiftParams.push(dateFrom);
        }
        if (dateTo) {
          shiftWhere += ` AND ${closedDateExpr} <= date(?)`;
          shiftParams.push(dateTo);
        }
        const shiftRow = this.db
          .prepare(
            `
            SELECT
              COALESCE(SUM(s.opening_cash), 0) AS opening_cash,
              COALESCE(SUM(s.closing_cash), 0) AS closing_cash
            FROM shifts s
            ${shiftWhere}
          `,
          )
          .get(...shiftParams);
        const cashRows = mappedRows.filter((r) => String(r.method || '').toLowerCase() === 'cash');
        const netCashMovement = cashRows.reduce((sum, r) => sum + Number(r.net || 0), 0);
        const opening = Number(shiftRow?.opening_cash || 0) || 0;
        const closing = Number(shiftRow?.closing_cash || 0) || 0;
        reconciliation = {
          opening_cash: opening,
          closing_cash: closing,
          net_cash_movement: netCashMovement,
          delta: closing - opening - netCashMovement,
        };
      } catch {
        reconciliation = null;
      }
    }

    return { rows: mappedRows, by_source, reconciliation };
  }

  /**
   * Cash discrepancies (kassa tafovutlari) by cashier.
   * filters: { date_from?, date_to? } - applies to shifts.closed_at (or opened_at fallback)
   */
  getCashDiscrepancies(filters = {}) {
    if (!this._hasTable('shifts')) return [];

    const dateFrom = filters.date_from ? this._ymd(filters.date_from) : null;
    const dateTo = filters.date_to ? this._ymd(filters.date_to) : null;

    const hasUsers = this._hasTable('users');
    const hasProfiles = this._hasTable('profiles');

    const params = [];
    let where = `WHERE s.status = 'closed'`;

    // Prefer closed_at; fallback to opened_at for older schemas.
    // TZ-aware (Tashkent calendar) — _tzDateExpr handles DATE() in app TZ
    const closedDateExpr = `COALESCE(${this._tzDateExpr('s.closed_at')}, ${this._tzDateExpr('s.opened_at')})`;
    where += ` AND ${closedDateExpr} IS NOT NULL`;
    if (dateFrom) {
      where += ` AND ${closedDateExpr} >= date(?)`;
      params.push(dateFrom);
    }
    if (dateTo) {
      where += ` AND ${closedDateExpr} <= date(?)`;
      params.push(dateTo);
    }

    const userJoin = hasUsers ? `LEFT JOIN users u ON u.id = s.user_id` : '';
    const profileJoin = hasProfiles ? `LEFT JOIN profiles p ON p.id = s.user_id` : '';

    const cashierNameExpr = hasUsers && hasProfiles
      ? `COALESCE(u.username, p.username, s.user_id)`
      : hasUsers
        ? `COALESCE(u.username, s.user_id)`
        : hasProfiles
          ? `COALESCE(p.username, s.user_id)`
          : `s.user_id`;

    const query = `
      SELECT
        s.user_id,
        ${cashierNameExpr} AS cashier_name,
        COUNT(*) AS shift_count,
        COALESCE(SUM(COALESCE(s.cash_difference, 0)), 0) AS sum_diff,
        COALESCE(SUM(CASE WHEN COALESCE(s.cash_difference, 0) > 0 THEN COALESCE(s.cash_difference, 0) ELSE 0 END), 0) AS over_amount,
        COALESCE(SUM(CASE WHEN COALESCE(s.cash_difference, 0) < 0 THEN ABS(COALESCE(s.cash_difference, 0)) ELSE 0 END), 0) AS short_amount,
        COALESCE(AVG(COALESCE(s.cash_difference, 0)), 0) AS avg_diff,
        MAX(s.closed_at) AS last_closed_at
      FROM shifts s
      ${userJoin}
      ${profileJoin}
      ${where}
      GROUP BY s.user_id
      ORDER BY ABS(sum_diff) DESC, shift_count DESC, cashier_name ASC
    `;

    const rows = this.db.prepare(query).all(params);
    return (rows || []).map((r) => ({
      user_id: r.user_id,
      cashier_name: r.cashier_name || r.user_id,
      shift_count: Number(r.shift_count || 0) || 0,
      sum_diff: Number(r.sum_diff || 0) || 0,
      over_amount: Number(r.over_amount || 0) || 0,
      short_amount: Number(r.short_amount || 0) || 0,
      avg_diff: Number(r.avg_diff || 0) || 0,
      last_closed_at: r.last_closed_at || null,
    }));
  }

  /**
   * True FIFO aging for customers & suppliers.
   * filters: { as_of_date?: 'YYYY-MM-DD' }
   *
   * Output:
   * {
   *   as_of_date,
   *   customers: [{ customer_id, customer_name, buckets... }],
   *   suppliers: [{ supplier_id, supplier_name, buckets... }]
   * }
   */
  getAging(filters = {}) {
    const asOf = filters.as_of_date ? this._ymd(filters.as_of_date) : this._ymd();

    const result = {
      as_of_date: asOf,
      customers: [],
      suppliers: [],
      reconciliation_diffs: [],
    };

    const reconciliationDiffs = [];

    // -----------------------------
    // Customers (AR)
    // -----------------------------
    if (this._hasTable('orders') && this._hasTable('customers')) {
      const hasPayments = this._hasTable('payments');
      const hasCustomerPayments = this._hasTable('customer_payments');
      const hasDueDate = (() => {
        try {
          return !!this.db
            .prepare(`SELECT 1 AS ok FROM pragma_table_info('orders') WHERE name = 'due_date' LIMIT 1`)
            .get()?.ok;
        } catch {
          return false;
        }
      })();

      const payUzs = paymentAmountUzsSql(this.db, 'p', 'o');
      const isUsd = orderIsUsdExpr('o');

      const orders = this.db
        .prepare(
          `
          SELECT
            o.id,
            o.order_number,
            o.customer_id,
            o.total_amount,
            COALESCE(o.credit_amount, 0) AS credit_amount,
            COALESCE(o.payment_status, '') AS payment_status,
            ${hasDueDate ? 'o.due_date' : 'NULL'} AS due_date,
            COALESCE(o.currency, 'UZS') AS currency,
            o.created_at
          FROM orders o
          WHERE o.customer_id IS NOT NULL
            AND o.customer_id <> ?
            AND o.status = 'completed'
            AND (
              COALESCE(o.credit_amount, 0) > 0.009
              OR LOWER(COALESCE(o.payment_status, '')) IN ('on_credit', 'partial', 'partially_paid')
            )
          ORDER BY o.customer_id ASC, COALESCE(${hasDueDate ? 'o.due_date' : 'NULL'}, o.created_at) ASC, o.created_at ASC
        `
        )
        .all(DEFAULT_WALK_IN_CUSTOMER);

      const paidByOrder = new Map();
      if (hasPayments) {
        const rows = this.db
          .prepare(
            `
            SELECT
              p.order_id,
              COALESCE(SUM(CASE
                WHEN ${isUsd} THEN COALESCE(p.amount, 0)
                ELSE ${payUzs}
              END), 0) AS paid
            FROM payments p
            INNER JOIN orders o ON o.id = p.order_id
            WHERE COALESCE(LOWER(p.payment_method), '') NOT IN ('credit', 'on_credit', 'debt')
            GROUP BY p.order_id
          `
          )
          .all();
        for (const r of rows || []) paidByOrder.set(r.order_id, Number(r.paid || 0) || 0);
      }

      const linkedCustomerPaidByOrder = new Map();
      const unlinkedCustomerPaidByCustomer = new Map();
      if (hasCustomerPayments) {
        const cpCols = (() => {
          try {
            return new Set(
              (this.db.prepare(`PRAGMA table_info(customer_payments)`).all() || []).map((c) => c.name)
            );
          } catch {
            return new Set();
          }
        })();
        const hasCpCur = cpCols.has('currency');
        const hasCpOp = cpCols.has('operation');
        const cpIsUsd = hasCpCur ? `UPPER(TRIM(COALESCE(cp.currency, 'UZS'))) = 'USD'` : '0';
        const cpSignedAmount = hasCpOp
          ? `CASE WHEN COALESCE(cp.operation, 'payment_in') = 'payment_out' THEN -ABS(COALESCE(cp.amount, 0)) ELSE ABS(COALESCE(cp.amount, 0)) END`
          : `COALESCE(cp.amount, 0)`;

        const linked = this.db
          .prepare(
            `
            SELECT order_id, COALESCE(SUM(${cpSignedAmount}), 0) AS paid
            FROM customer_payments cp
            WHERE cp.order_id IS NOT NULL
              AND COALESCE(LOWER(cp.payment_method), '') NOT IN ('credit', 'on_credit', 'debt')
            GROUP BY order_id
          `
          )
          .all();
        for (const r of linked || []) linkedCustomerPaidByOrder.set(r.order_id, Number(r.paid || 0) || 0);

        const unlinked = this.db
          .prepare(
            `
            SELECT
              cp.customer_id,
              COALESCE(SUM(CASE WHEN ${cpIsUsd} THEN 0 ELSE ${cpSignedAmount} END), 0) AS paid_uzs,
              COALESCE(SUM(CASE WHEN ${cpIsUsd} THEN ${cpSignedAmount} ELSE 0 END), 0) AS paid_usd
            FROM customer_payments cp
            WHERE cp.order_id IS NULL
              AND COALESCE(LOWER(cp.payment_method), '') NOT IN ('credit', 'on_credit', 'debt')
            GROUP BY cp.customer_id
          `
          )
          .all();
        for (const r of unlinked || []) {
          unlinkedCustomerPaidByCustomer.set(r.customer_id, {
            uzs: Number(r.paid_uzs || 0) || 0,
            usd: Number(r.paid_usd || 0) || 0,
          });
        }
      }

      // Refunds / adjustments from ledger (reduce debt FIFO like payments)
      const ledgerAdjustByCustomer = new Map();
      if (this._hasTable('customer_ledger')) {
        const hasLedgerCur = (() => {
          try {
            return !!this.db
              .prepare(`SELECT 1 AS ok FROM pragma_table_info('customer_ledger') WHERE name = 'currency' LIMIT 1`)
              .get()?.ok;
          } catch {
            return false;
          }
        })();
        const ledgerCur = hasLedgerCur ? `UPPER(TRIM(COALESCE(currency, 'UZS')))` : `'UZS'`;
        const rows = this.db
          .prepare(
            `
            SELECT
              customer_id,
              COALESCE(SUM(CASE WHEN ${ledgerCur} = 'USD' THEN 0 ELSE CASE WHEN amount > 0 THEN amount ELSE 0 END END), 0) AS adj_uzs,
              COALESCE(SUM(CASE WHEN ${ledgerCur} = 'USD' THEN CASE WHEN amount > 0 THEN amount ELSE 0 END ELSE 0 END), 0) AS adj_usd
            FROM customer_ledger
            WHERE type IN ('refund', 'adjustment')
              AND amount > 0
            GROUP BY customer_id
          `
          )
          .all();
        for (const r of rows || []) {
          ledgerAdjustByCustomer.set(r.customer_id, {
            uzs: Number(r.adj_uzs || 0) || 0,
            usd: Number(r.adj_usd || 0) || 0,
          });
        }
      }

      const outstandingByCustomer = new Map();
      for (const o of orders || []) {
        const total = Number(o.total_amount || 0) || 0;
        const paid = Number(paidByOrder.get(o.id) || 0) || 0;
        const linked = Number(linkedCustomerPaidByOrder.get(o.id) || 0) || 0;
        let outstanding = Math.max(0, total - paid - linked);
        if (outstanding <= 0.009) continue;
        const cur = String(o.currency || 'UZS').toUpperCase() === 'USD' ? 'USD' : 'UZS';
        const arr = outstandingByCustomer.get(o.customer_id) || [];
        arr.push({
          order_id: o.id,
          order_number: o.order_number,
          due_date: o.due_date || null,
          created_at: o.created_at,
          anchor: this._agingAnchorDate(o),
          outstanding,
          currency: cur,
        });
        outstandingByCustomer.set(o.customer_id, arr);
      }

      for (const [customerId, arr] of outstandingByCustomer.entries()) {
        const cpPool = unlinkedCustomerPaidByCustomer.get(customerId) || { uzs: 0, usd: 0 };
        const ledgerPool = ledgerAdjustByCustomer.get(customerId) || { uzs: 0, usd: 0 };
        let availableUzs = Math.max(0, Number(cpPool.uzs || 0) + Number(ledgerPool.uzs || 0));
        let availableUsd = Math.max(0, Number(cpPool.usd || 0) + Number(ledgerPool.usd || 0));

        const uzsInvoices = arr.filter((inv) => inv.currency !== 'USD');
        const usdInvoices = arr.filter((inv) => inv.currency === 'USD');
        allocateFifoPool(uzsInvoices, availableUzs);
        allocateFifoPool(usdInvoices, availableUsd);
      }

      const customerNames = new Map();
      const customerPhones = new Map();
      const customerBalances = new Map();
      const custRows = this.db
        .prepare(`SELECT id, name, phone, balance, ${this._customerBalanceUsdSelect()} FROM customers`)
        .all();
      for (const c of custRows || []) {
        customerNames.set(c.id, c.name || c.id);
        if (c.phone) customerPhones.set(c.id, c.phone);
        customerBalances.set(c.id, {
          uzs: Number(c.balance || 0) || 0,
          usd: Number(c.balance_usd || 0) || 0,
        });
      }

      for (const [customerId, arr] of outstandingByCustomer.entries()) {
        const bucketsUzs = this._initBuckets();
        const bucketsUsd = this._initBuckets();
        for (const inv of arr) {
          const amt = Number(inv.outstanding || 0) || 0;
          if (amt <= 0) continue;
          const ageDays = this._ageDaysBetween(asOf, inv.anchor);
          const key = this._bucketAgeDays(ageDays);
          if (inv.currency === 'USD') this._addToBuckets(bucketsUsd, key, amt);
          else this._addToBuckets(bucketsUzs, key, amt);
        }
        if (bucketsUzs.total <= 0 && bucketsUsd.total <= 0) continue;

        const stored = customerBalances.get(customerId) || { uzs: 0, usd: 0 };
        const storedUzsDebt = stored.uzs < -0.009 ? Math.abs(stored.uzs) : 0;
        const storedUsdDebt = stored.usd < -0.009 ? Math.abs(stored.usd) : 0;
        if (Math.abs(storedUzsDebt - bucketsUzs.total) > 0.02) {
          reconciliationDiffs.push({
            side: 'customer',
            customer_id: customerId,
            customer_name: customerNames.get(customerId) || customerId,
            currency: 'UZS',
            stored: storedUzsDebt,
            computed: bucketsUzs.total,
            diff: bucketsUzs.total - storedUzsDebt,
          });
        }
        if (Math.abs(storedUsdDebt - bucketsUsd.total) > 0.02) {
          reconciliationDiffs.push({
            side: 'customer',
            customer_id: customerId,
            customer_name: customerNames.get(customerId) || customerId,
            currency: 'USD',
            stored: storedUsdDebt,
            computed: bucketsUsd.total,
            diff: bucketsUsd.total - storedUsdDebt,
          });
        }

        result.customers.push({
          customer_id: customerId,
          customer_name: customerNames.get(customerId) || customerId,
          customer_phone: customerPhones.get(customerId) || null,
          total: bucketsUzs.total,
          _0_7: bucketsUzs._0_7,
          _8_30: bucketsUzs._8_30,
          _31_60: bucketsUzs._31_60,
          _60_plus: bucketsUzs._60_plus,
          total_uzs: bucketsUzs.total,
          _0_7_uzs: bucketsUzs._0_7,
          _8_30_uzs: bucketsUzs._8_30,
          _31_60_uzs: bucketsUzs._31_60,
          _60_plus_uzs: bucketsUzs._60_plus,
          total_usd: bucketsUsd.total,
          _0_7_usd: bucketsUsd._0_7,
          _8_30_usd: bucketsUsd._8_30,
          _31_60_usd: bucketsUsd._31_60,
          _60_plus_usd: bucketsUsd._60_plus,
          bucket_sum_uzs: bucketSum(bucketsUzs),
          bucket_sum_usd: bucketSum(bucketsUsd),
          stored_balance_uzs: stored.uzs,
          stored_balance_usd: stored.usd,
        });
      }

      result.customers.sort((a, b) => (b.total || 0) - (a.total || 0));
    }

    // -----------------------------
    // Suppliers (AP)
    // -----------------------------
    if (this._hasTable('purchase_orders') && this._hasTable('suppliers') && this._hasTable('supplier_payments')) {
      const ledger = createCurrencyLedger(this.db);
      const hasPoCurrency = ledger.hasPoCurrency;
      const hasPoTotalUsd = ledger.hasPoTotalUsd;
      const hasPoDueDate = (() => {
        try {
          return !!this.db
            .prepare(`SELECT 1 AS ok FROM pragma_table_info('purchase_orders') WHERE name = 'payment_due_date' LIMIT 1`)
            .get()?.ok;
        } catch {
          return false;
        }
      })();

      const purchaseOrders = this.db
        .prepare(
          `
          SELECT
            po.id,
            po.po_number,
            po.supplier_id,
            po.total_amount,
            ${hasPoTotalUsd ? 'po.total_usd' : 'NULL'} AS total_usd,
            ${hasPoCurrency ? "COALESCE(po.currency, 'UZS')" : "'UZS'"} AS currency,
            po.order_date,
            ${hasPoDueDate ? 'po.payment_due_date' : 'NULL'} AS payment_due_date,
            po.created_at
          FROM purchase_orders po
          WHERE po.supplier_id IS NOT NULL
            AND po.status IN ('received', 'partially_received')
          ORDER BY po.supplier_id ASC, COALESCE(${hasPoDueDate ? 'po.payment_due_date' : 'NULL'}, po.order_date) ASC, po.created_at ASC
        `
        )
        .all();

      const paidByPo = ledger.paidByPurchaseOrder();

      const unlinkedPaidBySupplier = new Map();
      const unlinkedRows = this.db
        .prepare(
          `
          SELECT supplier_id, amount, ${ledger.hasPayAmountUsd ? 'amount_usd' : 'NULL'} AS amount_usd,
            ${ledger.hasPayCurrency ? "COALESCE(currency, 'UZS')" : "'UZS'"} AS currency
          FROM supplier_payments
          WHERE purchase_order_id IS NULL
        `
        )
        .all();
      const settlementCache = new Map();
      for (const r of unlinkedRows || []) {
        const settlement = ledger.supplierSettlement(r.supplier_id, settlementCache);
        const amt = ledger.paymentLedgerAmount(r, settlement);
        const prev = unlinkedPaidBySupplier.get(r.supplier_id) || { pos: 0, neg: 0 };
        if (amt > 0) prev.pos += amt;
        else if (amt < 0) prev.neg += Math.abs(amt);
        unlinkedPaidBySupplier.set(r.supplier_id, prev);
      }

      const outstandingBySupplier = new Map();
      for (const po of purchaseOrders || []) {
        const total = ledger.poLedgerTotal(po);
        const paidRow = paidByPo.get(po.id) || { paid_uzs: 0, paid_usd: 0 };
        const cur = ledger.poLedgerCurrency(po);
        const paid = cur === 'USD' ? paidRow.paid_usd : paidRow.paid_uzs;
        const outstanding = Math.max(0, total - paid);
        if (outstanding <= 0) continue;
        const anchor = po.payment_due_date
          ? String(po.payment_due_date).slice(0, 10)
          : po.order_date || po.created_at;
        const arr = outstandingBySupplier.get(po.supplier_id) || [];
        arr.push({
          purchase_order_id: po.id,
          po_number: po.po_number,
          order_date: po.order_date || po.created_at,
          anchor,
          outstanding,
        });
        outstandingBySupplier.set(po.supplier_id, arr);
      }

      for (const [supplierId, arr] of outstandingBySupplier.entries()) {
        const unlinked = unlinkedPaidBySupplier.get(supplierId) || { pos: 0, neg: 0 };
        allocateFifoPool(arr, Number(unlinked.pos || 0) + Number(unlinked.neg || 0));
      }

      const supplierNames = new Map();
      const supplierPhones = new Map();
      const supplierSettlement = new Map();
      const supRows = this.db
        .prepare(
          `SELECT id, name, phone, COALESCE(settlement_currency, 'UZS') AS settlement_currency FROM suppliers`
        )
        .all();
      for (const s of supRows || []) {
        supplierNames.set(s.id, s.name || s.id);
        if (s.phone) supplierPhones.set(s.id, s.phone);
        supplierSettlement.set(
          s.id,
          String(s.settlement_currency || 'UZS').toUpperCase() === 'USD' ? 'USD' : 'UZS'
        );
      }

      for (const [supplierId, arr] of outstandingBySupplier.entries()) {
        const buckets = this._initBuckets();
        for (const bill of arr) {
          const amt = Number(bill.outstanding || 0) || 0;
          if (amt <= 0) continue;
          const ageDays = this._ageDaysBetween(asOf, bill.anchor);
          const key = this._bucketAgeDays(ageDays);
          this._addToBuckets(buckets, key, amt);
        }
        if (buckets.total <= 0) continue;

        const poTotal = arr.reduce((sum, b) => sum + Math.max(0, Number(b.outstanding || 0)), 0);
        if (Math.abs(bucketSum(buckets) - poTotal) > 0.02) {
          reconciliationDiffs.push({
            side: 'supplier',
            supplier_id: supplierId,
            supplier_name: supplierNames.get(supplierId) || supplierId,
            stored: poTotal,
            computed: buckets.total,
            diff: buckets.total - poTotal,
          });
        }

        result.suppliers.push({
          supplier_id: supplierId,
          supplier_name: supplierNames.get(supplierId) || supplierId,
          supplier_phone: supplierPhones.get(supplierId) || null,
          settlement_currency: supplierSettlement.get(supplierId) || 'UZS',
          ...buckets,
          bucket_sum: bucketSum(buckets),
        });
      }

      result.suppliers.sort((a, b) => (b.total || 0) - (a.total || 0));
    }

    result.reconciliation_diffs = reconciliationDiffs;
    this._logAgingReconciliationDiffs(reconciliationDiffs);
    return result;
  }

  /**
   * Data-quality warnings for aging report UI.
   */
  getAgingWarnings() {
    const warnings = [];
    if (this._hasTable('customers')) {
      const walkIn = this.db
        .prepare(
          `SELECT id, name, balance, ${this._customerBalanceUsdSelect()} FROM customers WHERE id = ?`
        )
        .get(DEFAULT_WALK_IN_CUSTOMER);
      if (walkIn) {
        const debtUzs = Number(walkIn.balance || 0) < -0.009 ? Math.abs(Number(walkIn.balance)) : 0;
        const debtUsd =
          Number(walkIn.balance_usd || 0) < -0.009 ? Math.abs(Number(walkIn.balance_usd)) : 0;
        if (debtUzs > 0 || debtUsd > 0) {
          warnings.push({
            level: 'warning',
            code: 'default_customer_debt',
            title: 'Yangi mijoz (default) qarzi mavjud',
            description: `default-customer-001 da tarixiy qarz: ${debtUzs > 0 ? `${debtUzs} UZS` : ''}${debtUzs > 0 && debtUsd > 0 ? ', ' : ''}${debtUsd > 0 ? `${debtUsd} USD` : ''}. Yangi nasiya sotuvlar bloklangan.`,
          });
        }
      }

      const badPhoneRows = this.db
        .prepare(
          `
          SELECT id, name, phone, balance
          FROM customers
          WHERE COALESCE(balance, 0) < -0.009
            AND id <> ?
            AND (
              phone IS NULL OR TRIM(phone) = '' OR TRIM(phone) = '-'
            )
        `
        )
        .all(DEFAULT_WALK_IN_CUSTOMER);
      if (badPhoneRows.length > 0) {
        warnings.push({
          level: 'warning',
          code: 'debtors_missing_phone',
          title: `Telefonsiz qarzdorlar (${badPhoneRows.length})`,
          description: badPhoneRows
            .slice(0, 5)
            .map((r) => r.name || r.id)
            .join(', ') + (badPhoneRows.length > 5 ? '…' : ''),
          count: badPhoneRows.length,
        });
      }
    }
    return warnings;
  }

  /**
   * Reconcile aging totals vs stored customer balances; optional CSV export payload.
   */
  reconcileCustomerAging(options = {}) {
    const rep = this.getAging({ as_of_date: options.as_of_date || null });
    const rows = [];
    const eps = 0.02;

    if (this._hasTable('customers')) {
      const debtors = this.db
        .prepare(
          `
          SELECT id, name, phone, balance, ${this._customerBalanceUsdSelect()}
          FROM customers
          WHERE id <> ?
            AND (COALESCE(balance, 0) < -0.009 OR ${hasCustomerBalanceUsd(this.db) ? 'COALESCE(balance_usd, 0)' : '0'} < -0.009)
        `
        )
        .all(DEFAULT_WALK_IN_CUSTOMER);

      const agingByCustomer = new Map();
      for (const c of rep.customers || []) {
        agingByCustomer.set(c.customer_id, c);
      }

      for (const d of debtors || []) {
        const aging = agingByCustomer.get(d.id);
        const storedUzs = Number(d.balance || 0) < -eps ? Math.abs(Number(d.balance)) : 0;
        const storedUsd = Number(d.balance_usd || 0) < -eps ? Math.abs(Number(d.balance_usd)) : 0;
        const computedUzs = Number(aging?.total_uzs ?? aging?.total ?? 0) || 0;
        const computedUsd = Number(aging?.total_usd || 0) || 0;
        if (Math.abs(storedUzs - computedUzs) > eps || Math.abs(storedUsd - computedUsd) > eps) {
          rows.push({
            customer_id: d.id,
            customer_name: d.name || d.id,
            phone: d.phone || '',
            stored_uzs: storedUzs,
            computed_uzs: computedUzs,
            diff_uzs: computedUzs - storedUzs,
            stored_usd: storedUsd,
            computed_usd: computedUsd,
            diff_usd: computedUsd - storedUsd,
          });
        }
        agingByCustomer.delete(d.id);
      }

      for (const [customerId, aging] of agingByCustomer.entries()) {
        const computedUzs = Number(aging.total_uzs ?? aging.total ?? 0) || 0;
        const computedUsd = Number(aging.total_usd || 0) || 0;
        if (computedUzs > eps || computedUsd > eps) {
          rows.push({
            customer_id: customerId,
            customer_name: aging.customer_name || customerId,
            phone: aging.customer_phone || '',
            stored_uzs: 0,
            computed_uzs: computedUzs,
            diff_uzs: computedUzs,
            stored_usd: 0,
            computed_usd: computedUsd,
            diff_usd: computedUsd,
          });
        }
      }
    }

    const independent = this._independentCustomerAgingTotals();
    const agingTotalUzs = (rep.customers || []).reduce(
      (sum, c) => sum + (Number(c.total_uzs ?? c.total ?? 0) || 0),
      0
    );
    const ledger = reconcileCustomerLedgerVsBalance(this.db, { eps });

    return {
      as_of_date: rep.as_of_date,
      diffs: rows,
      independent_total_uzs: independent.total_uzs,
      aging_total_uzs: agingTotalUzs,
      independent_diff_uzs: agingTotalUzs - independent.total_uzs,
      reconciliation_diffs: rep.reconciliation_diffs || [],
      ledger_diffs: ledger.diffs,
      ledger_checked: ledger.checked,
    };
  }

  reconcileCustomerLedger(options = {}) {
    return reconcileCustomerLedgerVsBalance(this.db, options);
  }

  /** on_credit sales − payments − returns (UZS bucket, schema-safe). */
  _independentCustomerAgingTotals() {
    if (!this._hasTable('orders') || !this._hasTable('customers')) {
      return { total_uzs: 0, credit_sales_uzs: 0, payments_uzs: 0, returns_uzs: 0 };
    }

    const creditRow = this.db
      .prepare(
        `
        SELECT COALESCE(SUM(
          CASE WHEN UPPER(TRIM(COALESCE(o.currency, 'UZS'))) = 'USD' THEN 0
          ELSE COALESCE(o.credit_amount, 0) END
        ), 0) AS credit_sales
        FROM orders o
        WHERE o.status = 'completed'
          AND o.customer_id IS NOT NULL
          AND o.customer_id <> ?
          AND COALESCE(o.credit_amount, 0) > 0.009
      `
      )
      .get(DEFAULT_WALK_IN_CUSTOMER);

    let paymentsUzs = 0;
    if (this._hasTable('customer_payments')) {
      const payRow = this.db
        .prepare(
          `
          SELECT COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) AS paid
          FROM customer_payments
          WHERE COALESCE(LOWER(payment_method), '') NOT IN ('credit', 'on_credit', 'debt')
        `
        )
        .get();
      paymentsUzs = Number(payRow?.paid || 0) || 0;
    }

    let returnsUzs = 0;
    if (this._hasTable('customer_ledger')) {
      const retRow = this.db
        .prepare(
          `
          SELECT COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) AS ret
          FROM customer_ledger
          WHERE type IN ('refund', 'adjustment')
        `
        )
        .get();
      returnsUzs = Number(retRow?.ret || 0) || 0;
    }

    const creditSales = Number(creditRow?.credit_sales || 0) || 0;
    const total = Math.max(0, creditSales - paymentsUzs - returnsUzs);
    return {
      total_uzs: total,
      credit_sales_uzs: creditSales,
      payments_uzs: paymentsUzs,
      returns_uzs: returnsUzs,
    };
  }

  /**
   * Supplier → Product Sales (Batch allocation trace)
   * filters: { date_from, date_to, supplier_id?, warehouse_id? }
   */
  getSupplierProductSales(filters = {}) {
    const dateFrom = this._ymd(filters.date_from || new Date());
    const dateTo = this._ymd(filters.date_to || new Date());
    const supplierId = filters.supplier_id || null;
    const warehouseId = filters.warehouse_id || null;

    if (
      !this._hasTable('inventory_batch_allocations') ||
      !this._hasTable('inventory_batches') ||
      !this._hasTable('order_items') ||
      !this._hasTable('orders')
    ) {
      return [];
    }

    const params = [dateFrom, dateTo];
    let where = `
      WHERE a.direction = 'out'
        AND a.reference_type = 'order_item'
        AND o.status = 'completed'
        AND ${this._tzDateExpr('o.created_at')} BETWEEN date(?) AND date(?)
    `;

    if (supplierId) {
      where += ` AND b.supplier_id = ?`;
      params.push(supplierId);
    }

    if (warehouseId) {
      where += ` AND a.warehouse_id = ?`;
      params.push(warehouseId);
    }

    const unitPriceExpr = `
      COALESCE(
        oi.unit_price,
        (oi.line_total / NULLIF(oi.quantity, 0)),
        0
      )
    `;
    const discountPerUnitExpr = `COALESCE(oi.discount_amount, 0) / NULLIF(oi.quantity, 0)`;

    const rows = this.db.prepare(`
      SELECT
        b.supplier_id AS supplier_id,
        COALESCE(b.supplier_name, s.name) AS supplier_name,
        p.id AS product_id,
        p.name AS product_name,
        p.sku AS product_sku,
        p.barcode AS product_barcode,
        SUM(a.quantity) AS sold_qty,
        SUM(a.quantity * ${unitPriceExpr}) AS sales_amount_uzs,
        SUM(a.quantity * ${discountPerUnitExpr}) AS discount_uzs,
        SUM(a.quantity * (${unitPriceExpr} - ${discountPerUnitExpr})) AS net_sales_uzs,
        SUM(a.quantity * (${this._cogsLineSql('oi', '1')})) AS cogs_uzs,
        SUM(a.quantity * ((${unitPriceExpr} - ${discountPerUnitExpr}) - (${this._cogsLineSql('oi', '1')}))) AS gross_profit_uzs
      FROM inventory_batch_allocations a
      JOIN inventory_batches b ON b.id = a.batch_id
      JOIN order_items oi ON oi.id = a.reference_id
      JOIN orders o ON o.id = oi.order_id
      LEFT JOIN products p ON p.id = oi.product_id
      LEFT JOIN suppliers s ON s.id = b.supplier_id
      ${where}
      GROUP BY b.supplier_id, p.id
      ORDER BY supplier_name, product_name
    `).all(params);

    const receivedMap = new Map();
    if (this._hasTable('purchase_receipts') && this._hasTable('purchase_receipt_items')) {
      const receiptParams = [dateFrom, dateTo];
      let receiptWhere = `${this._tzDateExpr('COALESCE(pr.received_at, pr.created_at)')} BETWEEN date(?) AND date(?)`;
      if (supplierId) {
        receiptWhere += ` AND pr.supplier_id = ?`;
        receiptParams.push(supplierId);
      }
      if (warehouseId) {
        receiptWhere += ` AND pr.warehouse_id = ?`;
        receiptParams.push(warehouseId);
      }
      const receiptRows = this.db
        .prepare(
          `
          SELECT
            pr.supplier_id AS supplier_id,
            pri.product_id AS product_id,
            COALESCE(SUM(pri.received_qty), 0) AS received_qty,
            COALESCE(SUM(CASE
              WHEN COALESCE(pri.line_total, 0) > 0 THEN pri.line_total
              ELSE COALESCE(pri.received_qty, 0) * COALESCE(pri.unit_cost, 0)
            END), 0) AS received_amount_uzs
          FROM purchase_receipt_items pri
          INNER JOIN purchase_receipts pr ON pr.id = pri.receipt_id
          WHERE ${receiptWhere}
          GROUP BY pr.supplier_id, pri.product_id
        `
        )
        .all(...receiptParams);
      for (const rr of receiptRows || []) {
        const key = `${rr.supplier_id || ''}::${rr.product_id || ''}`;
        receivedMap.set(key, {
          qty: Number(rr.received_qty || 0) || 0,
          amount: Number(rr.received_amount_uzs || 0) || 0,
        });
      }
    }

    if (rows && rows.length > 0) {
      return rows.map((r) => {
        const key = `${r.supplier_id || ''}::${r.product_id || ''}`;
        const rec = receivedMap.get(key) || { qty: 0, amount: 0 };
        return {
          ...r,
          received_qty: Number(rec.qty || 0) || 0,
          received_amount_uzs: Number(rec.amount || 0) || 0,
          is_estimated: 0,
        };
      });
    }

    // Fallback: if allocations are missing, approximate by latest receipt supplier per product
    if (!this._hasTable('purchase_receipts') || !this._hasTable('purchase_receipt_items')) {
      return [];
    }

    const fallbackParams = [dateFrom, dateTo];
    let fallbackWhere = `
      WHERE o.status = 'completed'
        AND ${this._tzDateExpr('o.created_at')} BETWEEN date(?) AND date(?)
    `;

    if (supplierId) {
      fallbackWhere += ` AND lr.supplier_id = ?`;
      fallbackParams.push(supplierId);
    }

    if (warehouseId) {
      fallbackWhere += ` AND o.warehouse_id = ?`;
      fallbackParams.push(warehouseId);
    }

    const fallbackRows = this.db.prepare(`
      WITH latest_receipt AS (
        SELECT
          pri.product_id AS product_id,
          pr.supplier_id AS supplier_id,
          MAX(COALESCE(pr.received_at, pr.created_at)) AS last_received
        FROM purchase_receipt_items pri
        JOIN purchase_receipts pr ON pr.id = pri.receipt_id
        GROUP BY pri.product_id
      )
      SELECT
        lr.supplier_id AS supplier_id,
        s.name AS supplier_name,
        p.id AS product_id,
        p.name AS product_name,
        p.sku AS product_sku,
        p.barcode AS product_barcode,
        SUM(oi.quantity) AS sold_qty,
        SUM(oi.quantity * ${unitPriceExpr}) AS sales_amount_uzs,
        SUM(COALESCE(oi.discount_amount, 0)) AS discount_uzs,
        SUM((oi.quantity * ${unitPriceExpr}) - COALESCE(oi.discount_amount, 0)) AS net_sales_uzs,
        SUM(${this._cogsLineSql('oi')}) AS cogs_uzs,
        SUM((oi.quantity * ${unitPriceExpr}) - COALESCE(oi.discount_amount, 0) - (${this._cogsLineSql('oi')})) AS gross_profit_uzs
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      LEFT JOIN products p ON p.id = oi.product_id
      LEFT JOIN latest_receipt lr ON lr.product_id = oi.product_id
      LEFT JOIN suppliers s ON s.id = lr.supplier_id
      ${fallbackWhere}
      GROUP BY lr.supplier_id, p.id
      ORDER BY supplier_name, product_name
    `).all(fallbackParams);

    return (fallbackRows || []).map((r) => {
      const key = `${r.supplier_id || ''}::${r.product_id || ''}`;
      const rec = receivedMap.get(key) || { qty: 0, amount: 0 };
      return {
        ...r,
        received_qty: Number(rec.qty || 0) || 0,
        received_amount_uzs: Number(rec.amount || 0) || 0,
        is_estimated: 1,
      };
    });
  }

  /**
   * FINANCIAL REPORTS
   */

  // NOTE:
  // `getCashFlow` and `getCashDiscrepancies` are implemented earlier in this class with
  // robust, schema-safe logic (payments/expenses/returns/shifts). A duplicate older
  // implementation previously existed here and could override the correct one, causing
  // "no such column" / empty report issues. That duplicate was removed intentionally.

  /**
   * Customer Aging Report
   *
   * Uses customers.balance as the source of truth for total debt (balance < 0 = debt).
   * Distributes debt across aging buckets using FIFO: payments reduce the oldest
   * credit orders first, and the remaining outstanding amounts are bucketed by age.
   */
  getCustomerAging() {
    // Use the FIFO-correct getAging() implementation under the hood and reshape
    // to the legacy schema. The previous implementation distorted buckets by
    // "scaling" them to match c.balance (a single saldo number), which produced
    // wrong distributions when partial payments / adjustments existed.
    try {
      const rep = this.getAging({});
      const rows = [];
      for (const c of rep?.customers || []) {
        const base = {
          id: c.customer_id,
          name: c.customer_name,
          phone: c.customer_phone || null,
        };
        const uzsTotal = Number(c.total_uzs ?? c.total ?? 0) || 0;
        if (uzsTotal > 0) {
          rows.push({
            ...base,
            id: `${c.customer_id}::UZS`,
            ledger_currency: 'UZS',
            total_debt: uzsTotal,
            current: Number(c._0_7_uzs ?? c._0_7 ?? 0) || 0,
            days_8_30: Number(c._8_30_uzs ?? c._8_30 ?? 0) || 0,
            days_31_60: Number(c._31_60_uzs ?? c._31_60 ?? 0) || 0,
            days_60_plus: Number(c._60_plus_uzs ?? c._60_plus ?? 0) || 0,
          });
        }
        const usdTotal = Number(c.total_usd || 0) || 0;
        if (usdTotal > 0) {
          rows.push({
            ...base,
            id: `${c.customer_id}::USD`,
            ledger_currency: 'USD',
            total_debt: usdTotal,
            current: Number(c._0_7_usd || 0) || 0,
            days_8_30: Number(c._8_30_usd || 0) || 0,
            days_31_60: Number(c._31_60_usd || 0) || 0,
            days_60_plus: Number(c._60_plus_usd || 0) || 0,
          });
        }
      }
      return rows;
    } catch (err) {
      console.warn('[reportsService.getCustomerAging] FIFO path failed, falling back to legacy scaling:', err?.message || err);
      // fall through to legacy implementation below
    }

    const asOf = this._ymd(new Date());

    const customers = this.db.prepare(`
      SELECT
        c.id,
        c.name,
        c.phone,
        ABS(c.balance) as total_debt
      FROM customers c
      WHERE c.balance < 0
        AND c.id <> 'default-customer-001'
    `).all();

    const hasLedger = this._hasTable('customer_ledger');

    const result = [];
    for (const cust of customers) {
      const actualDebt = Number(cust.total_debt) || 0;
      if (actualDebt <= 0) continue;

      const creditOrders = this.db.prepare(`
        SELECT
          id,
          created_at,
          COALESCE(credit_amount, CASE WHEN total_amount > paid_amount THEN total_amount - paid_amount ELSE 0 END) as credit_portion,
          CAST((julianday(?) - julianday(created_at)) AS INTEGER) as age_days
        FROM orders
        WHERE customer_id = ?
          AND status = 'completed'
          AND (COALESCE(credit_amount, 0) > 0 OR paid_amount < total_amount)
        ORDER BY created_at ASC
      `).all(asOf, cust.id);

      let totalPaymentsReceived = 0;
      if (hasLedger) {
        try {
          const row = this.db.prepare(`
            SELECT COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) as total_in
            FROM customer_ledger
            WHERE customer_id = ?
              AND type IN ('payment_in', 'refund', 'adjustment')
          `).get(cust.id);
          totalPaymentsReceived = Number(row?.total_in) || 0;
        } catch (_e) { /* ignore */ }
      }
      if (totalPaymentsReceived === 0 && this._hasTable('customer_payments')) {
        try {
          const row = this.db.prepare(`
            SELECT COALESCE(SUM(amount), 0) as total_in
            FROM customer_payments
            WHERE customer_id = ?
          `).get(cust.id);
          totalPaymentsReceived = Number(row?.total_in) || 0;
        } catch (_e) { /* ignore */ }
      }

      const buckets = { current: 0, days_8_30: 0, days_31_60: 0, days_60_plus: 0 };
      let paymentsToApply = totalPaymentsReceived;
      let totalFromOrders = 0;

      for (const ord of creditOrders) {
        let outstanding = Number(ord.credit_portion) || 0;
        if (outstanding <= 0) continue;

        if (paymentsToApply > 0) {
          const apply = Math.min(outstanding, paymentsToApply);
          outstanding -= apply;
          paymentsToApply -= apply;
        }
        if (outstanding <= 0) continue;

        const age = Number(ord.age_days) || 0;
        if (age <= 7) buckets.current += outstanding;
        else if (age <= 30) buckets.days_8_30 += outstanding;
        else if (age <= 60) buckets.days_31_60 += outstanding;
        else buckets.days_60_plus += outstanding;
        totalFromOrders += outstanding;
      }

      if (totalFromOrders < actualDebt) {
        buckets.current += (actualDebt - totalFromOrders);
      } else if (totalFromOrders > actualDebt) {
        const scale = actualDebt / totalFromOrders;
        buckets.current = Math.round(buckets.current * scale);
        buckets.days_8_30 = Math.round(buckets.days_8_30 * scale);
        buckets.days_31_60 = Math.round(buckets.days_31_60 * scale);
        buckets.days_60_plus = Math.round(buckets.days_60_plus * scale);
      }

      result.push({
        id: cust.id,
        name: cust.name,
        phone: cust.phone,
        total_debt: actualDebt,
        ...buckets,
      });
    }

    return result.sort((a, b) => b.total_debt - a.total_debt);
  }

  /**
   * Supplier PO payments due (open document debt + installment schedule).
   *
   * Includes:
   *  - payment_scheme=full (or missing): open invoice remaining (may have no due date)
   *  - payment_scheme=partial: remaining with payment_due_date when set
   *  - payment_scheme=installment: pending schedule rows
   *
   * filter: 'open' | 'all' | 'today' | 'overdue' | 'upcoming7' | 'upcoming30' | 'no_due'
   * Debt = document remaining (total − payments), NOT warehouse landed UZS.
   */
  listSupplierPaymentsDue(filters = {}) {
    if (!this._hasTable('purchase_orders') || !this._hasTable('suppliers')) return [];
    const poCols = this.db.prepare(`PRAGMA table_info(purchase_orders)`).all().map((c) => c.name);
    const hasScheme = poCols.includes('payment_scheme');
    const hasDueDate = poCols.includes('payment_due_date');
    const hasSchedule = this._hasTable('po_payment_schedule');
    const hasTotalUsd = poCols.includes('total_usd');
    const hasCurrency = poCols.includes('currency');
    const hasFx = poCols.includes('fx_rate');

    const today = this._ymd(new Date());
    const filterRaw = String(filters.filter || 'open').toLowerCase();
    const filter = filterRaw === 'all' ? 'open' : filterRaw;

    const addDaysYmd = (ymd, days) => {
      const [y, m, d] = String(ymd).split('-').map((n) => Number(n));
      const dt = new Date(y, (m || 1) - 1, d || 1);
      dt.setDate(dt.getDate() + days);
      return this._ymd(dt);
    };
    const upcoming7End = addDaysYmd(today, 7);
    const upcoming30End = addDaysYmd(today, 30);

    const paidByPo = new Map();
    if (this._hasTable('supplier_payments')) {
      const paidRows = this.db
        .prepare(
          `
        SELECT purchase_order_id,
               COALESCE(SUM(amount), 0) AS paid_uzs,
               COALESCE(SUM(COALESCE(amount_usd, 0)), 0) AS paid_usd
        FROM supplier_payments
        WHERE purchase_order_id IS NOT NULL
        GROUP BY purchase_order_id
      `
        )
        .all();
      for (const r of paidRows || []) {
        paidByPo.set(r.purchase_order_id, {
          paid_uzs: Number(r.paid_uzs || 0),
          paid_usd: Number(r.paid_usd || 0),
        });
      }
    }

    const poDebt = (po) => {
      const cur = String(po.currency || 'UZS').toUpperCase() === 'USD' ? 'USD' : 'UZS';
      const paid = paidByPo.get(po.id) || { paid_uzs: 0, paid_usd: 0 };
      if (cur === 'USD') {
        const total = Number(po.total_usd || 0);
        let paidAmt = Number(paid.paid_usd || 0);
        if (paidAmt <= 0 && Number(po.fx_rate || 0) > 0) {
          paidAmt = Number(paid.paid_uzs || 0) / Number(po.fx_rate);
        }
        return Math.max(0, total - paidAmt);
      }
      return Math.max(0, Number(po.total_amount || 0) - Number(paid.paid_uzs || 0));
    };

    const dueStatusKey = (dueDate) => {
      const d = dueDate ? String(dueDate).slice(0, 10) : '';
      if (!d) return 'no_due';
      if (d < today) return 'overdue';
      if (d === today) return 'today';
      return 'upcoming';
    };

    const matchesFilter = (dueDate) => {
      const d = dueDate ? String(dueDate).slice(0, 10) : '';
      if (filter === 'open') return true;
      if (filter === 'no_due') return !d;
      if (!d) return false;
      if (filter === 'today') return d === today;
      if (filter === 'overdue') return d < today;
      if (filter === 'upcoming7') return d > today && d <= upcoming7End;
      if (filter === 'upcoming30') return d > today && d <= upcoming30End;
      return true;
    };

    const out = [];
    const installmentPoIds = new Set();

    // --- Installment schedule rows ---
    if (hasSchedule && hasScheme) {
      const scheduleRows = this.db
        .prepare(
          `
        SELECT ps.id AS schedule_id, ps.seq, ps.due_date, ps.amount, ps.amount_usd, ps.status AS schedule_status,
               po.id AS po_id, po.po_number, po.supplier_id,
               ${hasCurrency ? "COALESCE(po.currency, 'UZS')" : "'UZS'"} AS currency,
               po.total_amount,
               ${hasTotalUsd ? 'po.total_usd' : 'NULL'} AS total_usd,
               ${hasFx ? 'po.fx_rate' : 'NULL'} AS fx_rate,
               po.payment_scheme, po.payment_status, po.status AS po_status,
               s.name AS supplier_name, s.settlement_currency
        FROM po_payment_schedule ps
        INNER JOIN purchase_orders po ON po.id = ps.purchase_order_id
        LEFT JOIN suppliers s ON s.id = po.supplier_id
        WHERE po.status != 'cancelled'
          AND COALESCE(po.payment_scheme, 'full') = 'installment'
          AND ps.status = 'pending'
      `
        )
        .all();

      for (const row of scheduleRows || []) {
        installmentPoIds.add(row.po_id);
        const po = {
          id: row.po_id,
          currency: row.currency,
          total_amount: row.total_amount,
          total_usd: row.total_usd,
          fx_rate: row.fx_rate,
        };
        const poRemaining = poDebt(po);
        if (poRemaining <= 0.01) continue;
        const dueDate = row.due_date ? String(row.due_date).slice(0, 10) : null;
        if (!matchesFilter(dueDate)) continue;
        const cur = String(row.currency || 'UZS').toUpperCase() === 'USD' ? 'USD' : 'UZS';
        const rowAmt =
          cur === 'USD' ? Number(row.amount_usd ?? row.amount ?? 0) : Number(row.amount ?? 0);
        out.push({
          row_type: 'installment',
          po_id: row.po_id,
          po_number: row.po_number,
          supplier_id: row.supplier_id,
          supplier_name: row.supplier_name,
          currency: cur,
          settlement_currency: String(row.settlement_currency || row.currency || 'UZS').toUpperCase(),
          amount: Math.min(rowAmt > 0 ? rowAmt : poRemaining, poRemaining),
          due_date: dueDate,
          due_status: dueStatusKey(dueDate),
          payment_scheme: row.payment_scheme || 'installment',
          schedule_seq: row.seq,
          schedule_id: row.schedule_id,
          po_status: row.po_status,
          payment_status: row.payment_status,
        });
      }
    }

    // --- Full / partial open invoice debt (document remaining) ---
    const openPos = this.db
      .prepare(
        `
      SELECT po.id, po.po_number, po.supplier_id,
             ${hasCurrency ? "COALESCE(po.currency, 'UZS')" : "'UZS'"} AS currency,
             po.total_amount,
             ${hasTotalUsd ? 'po.total_usd' : 'NULL'} AS total_usd,
             ${hasFx ? 'po.fx_rate' : 'NULL'} AS fx_rate,
             ${hasScheme ? "COALESCE(po.payment_scheme, 'full')" : "'full'"} AS payment_scheme,
             ${hasDueDate ? 'po.payment_due_date' : 'NULL'} AS payment_due_date,
             po.payment_status, po.status, po.order_date,
             s.name AS supplier_name, s.settlement_currency
      FROM purchase_orders po
      LEFT JOIN suppliers s ON s.id = po.supplier_id
      WHERE po.status != 'cancelled'
        AND po.status != 'draft'
    `
      )
      .all();

    for (const po of openPos || []) {
      const scheme = String(po.payment_scheme || 'full').toLowerCase();
      // Installment POs are covered by schedule rows (avoid double count)
      if (scheme === 'installment' && installmentPoIds.has(po.id)) continue;
      if (scheme === 'installment' && hasSchedule) continue;

      const debt = poDebt(po);
      if (debt <= 0.01) continue;

      const dueDate = po.payment_due_date ? String(po.payment_due_date).slice(0, 10) : null;
      if (!matchesFilter(dueDate)) continue;

      out.push({
        row_type: scheme === 'partial' ? 'partial' : 'open',
        po_id: po.id,
        po_number: po.po_number,
        supplier_id: po.supplier_id,
        supplier_name: po.supplier_name,
        currency: String(po.currency || 'UZS').toUpperCase() === 'USD' ? 'USD' : 'UZS',
        settlement_currency: String(po.settlement_currency || po.currency || 'UZS').toUpperCase(),
        amount: debt,
        due_date: dueDate,
        due_status: dueStatusKey(dueDate),
        payment_scheme: scheme,
        schedule_seq: null,
        po_status: po.status,
        payment_status: po.payment_status,
        order_date: po.order_date ? String(po.order_date).slice(0, 10) : null,
      });
    }

    out.sort((a, b) => {
      const ad = a.due_date || '9999-99-99';
      const bd = b.due_date || '9999-99-99';
      if (ad !== bd) return String(ad).localeCompare(String(bd));
      return String(a.po_number || '').localeCompare(String(b.po_number || ''));
    });

    return out;
  }

  /**
   * Supplier Aging Report
   */
  getSupplierAging() {
    // Use the FIFO-correct getAging() implementation under the hood and reshape
    // to the legacy schema. Both AR and AP aging now use the same true-FIFO
    // computation for consistent buckets.
    try {
      const rep = this.getAging({});
      return (rep?.suppliers || []).map((s) => ({
        id: s.supplier_id,
        name: s.supplier_name,
        phone: s.supplier_phone || null,
        settlement_currency: s.settlement_currency || 'UZS',
        total_debt: Number(s.total || 0) || 0,
        current: Number(s._0_7 || 0) || 0,
        days_8_30: Number(s._8_30 || 0) || 0,
        days_31_60: Number(s._31_60 || 0) || 0,
        days_60_plus: Number(s._60_plus || 0) || 0,
        loyalty_score: Math.min(100, Math.max(0,
          (Number(s.total || 0) || 0) > 0
            ? 100 - ((Number(s._60_plus || 0) || 0) / (Number(s.total || 0) || 1)) * 50
            : 100
        )),
      }));
    } catch (err) {
      console.warn('[reportsService.getSupplierAging] FIFO path failed, falling back:', err?.message || err);
      // fall through to legacy implementation below
    }

    const asOf = this._ymd(new Date());

    // NOTE (SQLite schema):
    // - purchase_orders has total_amount (not total_cost)
    // - supplier_payments tracks payments; there is no paid_amount column on purchase_orders
    // We compute outstanding per PO as: total_amount - SUM(supplier_payments.amount)
    // (negative amounts increase outstanding; credit_note reduces outstanding if stored as positive)

    // Load suppliers (active)
    const suppliers = this.db
      .prepare(
        `
        SELECT id, name, phone
        FROM suppliers
        WHERE COALESCE(is_active, 1) = 1
      `
      )
      .all();

    // Sum payments per PO
    const paidByPo = new Map();
    const paidRows = this.db
      .prepare(
        `
        SELECT purchase_order_id, COALESCE(SUM(amount), 0) AS paid
        FROM supplier_payments
        WHERE purchase_order_id IS NOT NULL
        GROUP BY purchase_order_id
      `
      )
      .all();
    for (const r of paidRows || []) paidByPo.set(r.purchase_order_id, Number(r.paid || 0) || 0);

    // Load eligible purchase orders
    const purchaseOrders = this.db
      .prepare(
        `
        SELECT id, supplier_id, po_number, total_amount, order_date, created_at, status
        FROM purchase_orders
        WHERE supplier_id IS NOT NULL
          AND status IN ('received', 'partially_received')
        ORDER BY supplier_id ASC, date(order_date) ASC, datetime(created_at) ASC
      `
      )
      .all();

    const posBySupplier = new Map(); // supplier_id -> [{ outstanding, age_days }]
    for (const po of purchaseOrders || []) {
      const total = Number(po.total_amount || 0) || 0;
      const paid = Number(paidByPo.get(po.id) || 0) || 0;
      const outstanding = total - paid;
      if (outstanding <= 0) continue;
      const orderDate = po.order_date || po.created_at;
      const ageDaysRow = this.db
        .prepare(`SELECT CAST((julianday(?) - julianday(?)) AS INTEGER) AS age_days`)
        .get(asOf, orderDate);
      const age = Number(ageDaysRow?.age_days || 0) || 0;
      const arr = posBySupplier.get(po.supplier_id) || [];
      arr.push({ outstanding, age_days: age });
      posBySupplier.set(po.supplier_id, arr);
    }

    const supplierMap = new Map();
    for (const s of suppliers || []) supplierMap.set(s.id, s);

    const result = [];
    for (const [supplierId, arr] of posBySupplier.entries()) {
      const buckets = { current: 0, days_8_30: 0, days_31_60: 0, days_60_plus: 0 };
      for (const inv of arr) {
        const amt = Number(inv.outstanding) || 0;
        const age = Number(inv.age_days) || 0;
        if (age <= 7) buckets.current += amt;
        else if (age <= 30) buckets.days_8_30 += amt;
        else if (age <= 60) buckets.days_31_60 += amt;
        else buckets.days_60_plus += amt;
      }
      const totalDebt = buckets.current + buckets.days_8_30 + buckets.days_31_60 + buckets.days_60_plus;
      if (totalDebt <= 0) continue;
      const sup = supplierMap.get(supplierId) || { id: supplierId, name: supplierId, phone: null };
      result.push({
        id: supplierId,
        name: sup.name,
        phone: sup.phone,
        total_debt: totalDebt,
        ...buckets,
        loyalty_score: Math.min(100, Math.max(0, 100 - (buckets.days_60_plus / totalDebt) * 50)),
      });
    }

    return result.sort((a, b) => Number(b.total_debt || 0) - Number(a.total_debt || 0));
  }

  /**
   * CRM REPORTS
   */

  /**
   * VIP Customers
   * @param {object} filters - { sort_by, sort_order: 'asc'|'desc', min_orders, limit }
   */
  getVIPCustomers(filters = {}) {
    const { sort_by = 'total_spent', sort_order: sortOrderRaw = 'desc', min_orders = 1, limit = 50 } = filters;

    // Schema safety
    if (!this._hasTable('customers') || !this._hasTable('orders')) return [];

    const allowedSort = [
      'total_spent',
      'order_count',
      'loyalty_score',
      'bonus_points',
      'avg_order_value',
      'customer_name',
      'customer_phone',
      'last_purchase',
    ];
    const validSortBy = allowedSort.includes(sort_by) ? sort_by : 'total_spent';
    const sortDir = String(sortOrderRaw || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    const orderExpr =
      validSortBy === 'order_count'
        ? 'order_count'
        : validSortBy === 'loyalty_score' || validSortBy === 'bonus_points'
          ? 'COALESCE(c.bonus_points, 0)'
          : validSortBy === 'avg_order_value'
            ? 'avg_order_value'
            : validSortBy === 'customer_name'
              ? "LOWER(TRIM(COALESCE(c.name, '')))"
              : validSortBy === 'customer_phone'
                ? "LOWER(TRIM(COALESCE(c.phone, '')))"
                : validSortBy === 'last_purchase'
                  ? 'MAX(o.created_at)'
                  : 'total_spent';

    // Optional date filter
    const dateParams = [];
    let dateWhere = '';
    if (filters.date_from) {
      dateWhere += ` AND ${this._tzDateExpr('o.created_at')} >= date(?)`;
      dateParams.push(this._ymd(filters.date_from));
    }
    if (filters.date_to) {
      dateWhere += ` AND ${this._tzDateExpr('o.created_at')} <= date(?)`;
      dateParams.push(this._ymd(filters.date_to));
    }
    const _hasBonus = (() => {
      try {
        return !!this.db
          .prepare(`SELECT 1 AS ok FROM pragma_table_info('customers') WHERE name = 'bonus_points' LIMIT 1`)
          .get()?.ok;
      } catch {
        return false;
      }
    })();
    const bonusSelect = _hasBonus ? `COALESCE(c.bonus_points, 0)` : `0`;

    const customers = this.db.prepare(`
      SELECT
        c.id as customer_id,
        c.name as customer_name,
        c.phone as customer_phone,
        ${bonusSelect} as bonus_points,
        COUNT(o.id) as order_count,
        COALESCE(SUM(${orderAmountUzsSql(this.db, 'o')}), 0) as total_spent,
        COALESCE(AVG(${orderAmountUzsSql(this.db, 'o')}), 0) as avg_order_value,
        MIN(o.created_at) as first_purchase_date,
        MAX(o.created_at) as last_purchase_date,
        CAST((julianday('now') - julianday(MAX(o.created_at))) AS INTEGER) as days_since_last
      FROM customers c
      JOIN orders o ON c.id = o.customer_id
      WHERE o.status = 'completed'
        ${dateWhere}
      GROUP BY c.id, c.name, c.phone${_hasBonus ? ', c.bonus_points' : ''}
      HAVING order_count >= ?
      ORDER BY ${orderExpr} ${sortDir}
      LIMIT ?
    `).all(...dateParams, min_orders, limit);

    return customers.map(c => {
      const bonus = Number(c.bonus_points) || 0;
      const activity = Math.min(50, (c.order_count || 0) * 5) + Math.max(0, 40 - (c.days_since_last || 0));
      const fromPoints = Math.min(50, bonus / 20);
      return {
        ...c,
        total_purchases: c.order_count,
        loyalty_score: Math.min(100, Math.round(activity + fromPoints)),
      };
    });
  }

  /**
   * Loyalty bonus summary (ledger aggregates + top balances)
   * @param {object} filters - { date_from, date_to, top_limit }
   */
  getLoyaltyPointsSummary(filters = {}) {
    let dateFrom = '1970-01-01';
    let dateTo = '9999-12-31';
    try {
      if (filters.date_from) dateFrom = this._ymd(filters.date_from);
    } catch {
      /* ignore: fall back to wide range */
    }
    try {
      if (filters.date_to) dateTo = this._ymd(filters.date_to);
    } catch {
      /* ignore */
    }
    const topLimit = Math.min(100, Math.max(1, Number(filters.top_limit) || 20));

    const table = this.db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='customer_bonus_ledger'`)
      .get();
    let byType = [];
    let bonusLedgerTotalRows = 0;
    if (table) {
      try {
        const cnt = this.db.prepare('SELECT COUNT(*) as n FROM customer_bonus_ledger').get();
        bonusLedgerTotalRows = Number(cnt?.n) || 0;
      } catch {
        bonusLedgerTotalRows = 0;
      }
      byType =
        this.db
          .prepare(
            `
        SELECT type, SUM(points) as total_points, COUNT(*) as entry_count
        FROM customer_bonus_ledger
        WHERE ${this._tzDateExpr('created_at')} >= date(?) AND ${this._tzDateExpr('created_at')} <= date(?)
        GROUP BY type
      `
          )
          .all(dateFrom, dateTo) || [];
    }

    const topBalances = this._hasTable('customers')
      ? this.db
          .prepare(
            `
          SELECT id as customer_id, name as customer_name, phone as customer_phone,
                 COALESCE(bonus_points, 0) as bonus_points
          FROM customers
          WHERE id != 'default-customer-001'
          ORDER BY COALESCE(bonus_points, 0) DESC
          LIMIT ?
        `
          )
          .all(topLimit)
      : [];

    const earnScope = String(
      (this._getSettingValue('loyalty.earn.scope') || 'master_only').trim().toLowerCase()
    );
    return {
      period: { date_from: dateFrom, date_to: dateTo },
      ledger_by_type: byType,
      top_bonus_balances: topBalances,
      /** Helps UI explain “empty” reports (not a network bug). */
      loyalty: {
        general_enabled: this._isTruthySetting('loyalty.general.enabled'),
        master_enabled: this._isTruthySetting('loyalty.master.enabled'),
        earn_scope: earnScope,
      },
      bonus_ledger_total_rows: bonusLedgerTotalRows,
    };
  }

  /**
   * Lost Customers
   * @param {object} filters - { inactive_days }
   */
  getLostCustomers(filters = {}) {
    const { inactive_days = 7 } = filters;

    // Schema safety
    if (!this._hasTable('customers') || !this._hasTable('orders')) return [];

    const customers = this.db.prepare(`
      SELECT
        c.id as customer_id,
        c.name as customer_name,
        c.phone as customer_phone,
        MAX(o.created_at) as last_purchase_date,
        CAST((julianday('now') - julianday(MAX(o.created_at))) AS INTEGER) as days_since_last,
        COUNT(o.id) as order_count,
        COALESCE(SUM(${orderAmountUzsSql(this.db, 'o')}), 0) as total_spent,
        COALESCE(AVG(${orderAmountUzsSql(this.db, 'o')}), 0) as avg_order_value
      FROM customers c
      JOIN orders o ON c.id = o.customer_id
      WHERE o.status = 'completed'
      GROUP BY c.id
      HAVING days_since_last >= ?
      ORDER BY total_spent DESC
    `).all(inactive_days);

    return customers.map(c => ({
      ...c,
      total_purchases: c.order_count,
      risk_level: c.total_spent > 10000000 ? 'high' : c.total_spent > 5000000 ? 'medium' : 'low'
    }));
  }

  /**
   * Customer Profitability
   * @param {object} filters - { date_from, date_to, sort_by }
   */
  getCustomerProfitability(filters = {}) {
    const { date_from, date_to, sort_by = 'net_profit' } = filters;
    const dateFrom = this._ymd(date_from || new Date(Date.now() - 90 * 86400000));
    const dateTo = this._ymd(date_to || new Date());

    // Schema safety
    if (!this._hasTable('customers') || !this._hasTable('orders')) return [];

    const hasOrderItems = this._hasTable('order_items');
    const hasProducts = this._hasTable('products');
    // Returns table — modern preferred, legacy fallback
    const returnsTable = this._hasTable('sales_returns')
      ? 'sales_returns'
      : this._hasTable('sale_returns')
        ? 'sale_returns'
        : null;

    // 1) Per-customer COGS from order_items
    const orderDateExpr = this._tzDateExpr('o.created_at');
    const cogsByCustomer = new Map();
    if (hasOrderItems) {
      const cogsRows = this.db
        .prepare(
          `
          SELECT
            o.customer_id,
            COALESCE(SUM(${this._cogsLineSql('oi')}), 0) AS total_cost
          FROM order_items oi
          INNER JOIN orders o ON o.id = oi.order_id
          ${hasProducts ? 'LEFT JOIN products p ON p.id = oi.product_id' : ''}
          WHERE o.status = 'completed'
            AND o.customer_id IS NOT NULL
            AND ${orderDateExpr} BETWEEN date(?) AND date(?)
          GROUP BY o.customer_id
        `
        )
        .all(dateFrom, dateTo);
      for (const r of cogsRows || []) {
        cogsByCustomer.set(r.customer_id, Number(r.total_cost || 0) || 0);
      }
    }

    // 2) Per-customer returns (refund amount + returns COGS)
    const returnsByCustomer = new Map();
    const returnsCogsByCustomer = new Map();
    if (returnsTable) {
      const _retCols = (() => {
        try {
          return new Set(
            (this.db.prepare(`PRAGMA table_info(${returnsTable})`).all() || []).map((c) => c.name)
          );
        } catch {
          return new Set();
        }
      })();
      const _hasRefundAmount = _retCols.has('refund_amount');
      const _hasCustomerId = _retCols.has('customer_id');

      if (_hasCustomerId) {
        const _amountExpr = _hasRefundAmount
          ? `COALESCE(sr.refund_amount, sr.total_amount, 0)`
          : `COALESCE(sr.total_amount, 0)`;
        const _returnsUzsExpr = returnRefundUzsSql(this.db, 'sr', 'o', _amountExpr);
        const returnDateExpr = this._tzDateExpr('sr.created_at');
        const returnsRows = this.db
          .prepare(
            `
            SELECT
              sr.customer_id,
              COALESCE(SUM(${_returnsUzsExpr}), 0) AS total_returns
            FROM ${returnsTable} sr
            LEFT JOIN orders o ON o.id = sr.order_id
            WHERE COALESCE(LOWER(sr.status), 'completed') = 'completed'
              AND sr.customer_id IS NOT NULL
              AND ${returnDateExpr} BETWEEN date(?) AND date(?)
            GROUP BY sr.customer_id
          `
          )
          .all(dateFrom, dateTo);
        for (const r of returnsRows || []) {
          returnsByCustomer.set(r.customer_id, Number(r.total_returns || 0) || 0);
        }

        // Returns COGS — schema-aware (modern: return_items; legacy: sale_return_items)
        const returnItemsTable = returnsTable === 'sale_returns' ? 'sale_return_items' : 'return_items';
        if (this._hasTable(returnItemsTable)) {
          const _riCols = (() => {
            try {
              return new Set(
                (this.db.prepare(`PRAGMA table_info(${returnItemsTable})`).all() || []).map((c) => c.name)
              );
            } catch {
              return new Set();
            }
          })();
          const _hasQtyBase = _riCols.has('qty_base');
          const _hasOrderItemId = _riCols.has('order_item_id');
          const _hasProductId = _riCols.has('product_id');
          const _qty = _hasQtyBase ? `COALESCE(ri.qty_base, ri.quantity, 0)` : `COALESCE(ri.quantity, 0)`;

          let cogsSql = null;
          if (_hasOrderItemId && _hasProductId) {
            cogsSql = `
              SELECT sr.customer_id,
                COALESCE(SUM(${this._returnCogsLineSql('oi', _qty)}), 0) AS returns_cogs
              FROM ${returnItemsTable} ri
              INNER JOIN ${returnsTable} sr ON sr.id = ri.return_id
              LEFT JOIN order_items oi ON oi.id = ri.order_item_id
              WHERE COALESCE(LOWER(sr.status), 'completed') = 'completed'
                AND sr.customer_id IS NOT NULL
                AND ${this._tzDateExpr('sr.created_at')} BETWEEN date(?) AND date(?)
              GROUP BY sr.customer_id
            `;
          } else if (_hasProductId) {
            cogsSql = `
              SELECT sr.customer_id,
                COALESCE(SUM(${_qty} * COALESCE(pr.purchase_price, 0)), 0) AS returns_cogs
              FROM ${returnItemsTable} ri
              INNER JOIN ${returnsTable} sr ON sr.id = ri.return_id
              LEFT JOIN products pr ON pr.id = ri.product_id
              WHERE COALESCE(LOWER(sr.status), 'completed') = 'completed'
                AND sr.customer_id IS NOT NULL
                AND ${this._tzDateExpr('sr.created_at')} BETWEEN date(?) AND date(?)
              GROUP BY sr.customer_id
            `;
          }
          if (cogsSql) {
            const cogsRows = this.db.prepare(cogsSql).all(dateFrom, dateTo);
            for (const r of cogsRows || []) {
              returnsCogsByCustomer.set(r.customer_id, Number(r.returns_cogs || 0) || 0);
            }
          }
        }
      }
    }

    // 3) Main aggregation
    const customers = this.db.prepare(`
      SELECT
        c.id as customer_id,
        c.name as customer_name,
        c.phone as customer_phone,
        MAX(COALESCE(c.bonus_points, 0)) as bonus_points,
        COUNT(o.id) as order_count,
        COALESCE(SUM(${orderAmountUzsSql(this.db, 'o')}), 0) as total_sales,
        COALESCE(SUM(${orderFieldUzsSql(this.db, 'o', 'discount_amount')}), 0) as total_discounts
      FROM customers c
      JOIN orders o ON c.id = o.customer_id
      WHERE o.status = 'completed'
        AND ${orderDateExpr} BETWEEN date(?) AND date(?)
      GROUP BY c.id
      ORDER BY total_sales DESC
    `).all(dateFrom, dateTo);

    return customers.map((c) => {
      const totalCostGross = cogsByCustomer.get(c.customer_id) || 0;
      const totalReturns = returnsByCustomer.get(c.customer_id) || 0;
      const returnsCogs = returnsCogsByCustomer.get(c.customer_id) || 0;
      // Net cost = sales COGS minus COGS for returned items
      const totalCost = Math.max(0, totalCostGross - returnsCogs);
      const netSales = c.total_sales - totalReturns;
      const netProfit = netSales - totalCost - c.total_discounts;
      const profitMargin = c.total_sales > 0 ? (netProfit / c.total_sales) * 100 : 0;
      return {
        ...c,
        bonus_points: Number(c.bonus_points) || 0,
        total_cost: totalCost,
        total_returns: totalReturns,
        net_profit: netProfit,
        profit_margin: profitMargin,
        avg_profit_per_order: c.order_count > 0 ? netProfit / c.order_count : 0,
        profitability_score: Math.min(100, Math.max(0, profitMargin + 20)),
      };
    });
  }

  /**
   * SUPPLIER/PURCHASE ADVANCED REPORTS
   */

  /**
   * Delivery Accuracy
   * @param {object} filters - { date_from, date_to }
   */
  getDeliveryAccuracy(filters = {}) {
    const { date_from, date_to } = filters;
    const dateFrom = this._ymd(date_from || new Date(Date.now() - 90 * 86400000));
    const dateTo = this._ymd(date_to || new Date());

    // Schema safety
    if (!this._hasTable('suppliers') || !this._hasTable('purchase_orders')) return [];

    const hasReceipts = this._hasTable('purchase_receipts');
    const hasPoi = this._hasTable('purchase_order_items');
    const hasIsActive = (() => {
      try {
        return !!this.db
          .prepare(`SELECT 1 AS ok FROM pragma_table_info('suppliers') WHERE name = 'is_active' LIMIT 1`)
          .get()?.ok;
      } catch {
        return false;
      }
    })();
    const activeWhere = hasIsActive ? `WHERE s.is_active = 1` : `WHERE 1=1`;

    // Receipt CTE: max received date per PO
    const receiptCte = hasReceipts
      ? `LEFT JOIN (
          SELECT purchase_order_id, MAX(received_at) AS received_at
          FROM purchase_receipts
          GROUP BY purchase_order_id
        ) gr ON gr.purchase_order_id = po.id`
      : `LEFT JOIN (SELECT NULL AS purchase_order_id, NULL AS received_at WHERE 0) gr ON gr.purchase_order_id = po.id`;

    // Shortage CTE: ordered_qty - received_qty per PO * unit_cost
    const shortageCte = hasPoi
      ? `LEFT JOIN (
          SELECT
            purchase_order_id,
            COALESCE(SUM(MAX(0, COALESCE(ordered_qty, 0) - COALESCE(received_qty, 0))), 0) AS shortage_qty,
            COALESCE(SUM(MAX(0, COALESCE(ordered_qty, 0) - COALESCE(received_qty, 0)) * COALESCE(unit_cost, 0)), 0) AS shortage_value,
            COUNT(CASE WHEN COALESCE(received_qty, 0) < COALESCE(ordered_qty, 0) THEN 1 END) AS shortage_lines
          FROM purchase_order_items
          GROUP BY purchase_order_id
        ) sh ON sh.purchase_order_id = po.id`
      : `LEFT JOIN (SELECT NULL AS purchase_order_id, 0.0 AS shortage_qty, 0.0 AS shortage_value, 0 AS shortage_lines WHERE 0) sh ON sh.purchase_order_id = po.id`;

    const suppliers = this.db.prepare(`
      SELECT
        s.id as supplier_id,
        s.name as supplier_name,
        COUNT(po.id) as total_orders,
        COALESCE(SUM(
          CASE
            WHEN po.status = 'received'
              AND po.expected_date IS NOT NULL
              AND gr.received_at IS NOT NULL
              AND date(gr.received_at) <= date(po.expected_date)
            THEN 1 ELSE 0
          END
        ), 0) as on_time_deliveries,
        COALESCE(SUM(
          CASE
            WHEN po.status = 'received'
              AND po.expected_date IS NOT NULL
              AND gr.received_at IS NOT NULL
              AND date(gr.received_at) > date(po.expected_date)
            THEN 1 ELSE 0
          END
        ), 0) as late_deliveries,
        COALESCE(AVG(
          CASE
            WHEN po.status = 'received'
              AND po.expected_date IS NOT NULL
              AND gr.received_at IS NOT NULL
              AND date(gr.received_at) > date(po.expected_date)
            THEN CAST(julianday(date(gr.received_at)) - julianday(date(po.expected_date)) AS INTEGER)
          END
        ), 0) as avg_delay_days,
        COALESCE(SUM(sh.shortage_value), 0) as total_shortage_value,
        COALESCE(SUM(sh.shortage_lines), 0) as shortage_count,
        MAX(gr.received_at) as last_delivery_date
      FROM suppliers s
      LEFT JOIN purchase_orders po ON s.id = po.supplier_id
        AND date(po.order_date) BETWEEN date(?) AND date(?)
      ${receiptCte}
      ${shortageCte}
      ${activeWhere}
      GROUP BY s.id
      HAVING total_orders > 0
      ORDER BY total_orders DESC
    `).all(dateFrom, dateTo);

    return suppliers.map(s => ({
      ...s,
      avg_delay_days: Number(s.avg_delay_days || 0) || 0,
      total_shortage_value: Number(s.total_shortage_value || 0) || 0,
      shortage_count: Number(s.shortage_count || 0) || 0,
      accuracy_score: s.total_orders > 0 ? Math.round((s.on_time_deliveries / s.total_orders) * 100) : 100
    }));
  }

  /**
   * Delivery Details
   * @param {object} filters - { date_from, date_to }
   */
  getDeliveryDetails(filters = {}) {
    const { date_from, date_to } = filters;
    const dateFrom = this._ymd(date_from || new Date(Date.now() - 90 * 86400000));
    const dateTo = this._ymd(date_to || new Date());

    // Schema safety
    if (!this._hasTable('purchase_orders') || !this._hasTable('suppliers')) return [];

    const hasReceipts = this._hasTable('purchase_receipts');
    const hasPoi = this._hasTable('purchase_order_items');

    const receiptCte = hasReceipts
      ? `LEFT JOIN (
          SELECT purchase_order_id, MAX(received_at) AS received_at
          FROM purchase_receipts
          GROUP BY purchase_order_id
        ) gr ON gr.purchase_order_id = po.id`
      : `LEFT JOIN (SELECT NULL AS purchase_order_id, NULL AS received_at WHERE 0) gr ON gr.purchase_order_id = po.id`;

    // Aggregated per-PO ordered/received/shortage from purchase_order_items
    const itemsCte = hasPoi
      ? `LEFT JOIN (
          SELECT
            purchase_order_id,
            COUNT(*) AS line_count,
            COALESCE(SUM(COALESCE(ordered_qty, 0)), 0) AS ordered_qty_total,
            COALESCE(SUM(COALESCE(received_qty, 0)), 0) AS received_qty_total,
            COALESCE(SUM(MAX(0, COALESCE(ordered_qty, 0) - COALESCE(received_qty, 0))), 0) AS shortage_qty,
            COALESCE(SUM(MAX(0, COALESCE(ordered_qty, 0) - COALESCE(received_qty, 0)) * COALESCE(unit_cost, 0)), 0) AS shortage_value,
            COUNT(CASE WHEN COALESCE(received_qty, 0) < COALESCE(ordered_qty, 0) THEN 1 END) AS shortage_lines
          FROM purchase_order_items
          GROUP BY purchase_order_id
        ) it ON it.purchase_order_id = po.id`
      : `LEFT JOIN (SELECT NULL AS purchase_order_id, 0 AS line_count, 0.0 AS ordered_qty_total, 0.0 AS received_qty_total, 0.0 AS shortage_qty, 0.0 AS shortage_value, 0 AS shortage_lines WHERE 0) it ON it.purchase_order_id = po.id`;

    return this.db.prepare(`
      SELECT 
        po.id as order_id,
        po.po_number,
        s.name as supplier_name,
        po.order_date,
        po.expected_date,
        gr.received_at as actual_date,
        CASE
          WHEN po.expected_date IS NOT NULL AND gr.received_at IS NOT NULL
          THEN COALESCE(CAST((julianday(date(gr.received_at)) - julianday(date(po.expected_date))) AS INTEGER), 0)
          ELSE 0
        END as delay_days,
        COALESCE(it.ordered_qty_total, 0) as ordered_items,
        COALESCE(it.received_qty_total, 0) as received_items,
        COALESCE(it.shortage_lines, 0) as shortage_items,
        COALESCE(it.shortage_value, 0) as shortage_value,
        CASE 
          WHEN po.status = 'received'
            AND po.expected_date IS NOT NULL
            AND gr.received_at IS NOT NULL
            AND date(gr.received_at) <= date(po.expected_date)
          THEN 'on_time'
          WHEN po.status = 'received'
            AND po.expected_date IS NOT NULL
            AND gr.received_at IS NOT NULL
            AND date(gr.received_at) > date(po.expected_date)
          THEN 'late'
          ELSE 'pending'
        END as status
      FROM purchase_orders po
      JOIN suppliers s ON po.supplier_id = s.id
      ${receiptCte}
      ${itemsCte}
      WHERE date(po.order_date) BETWEEN date(?) AND date(?)
      ORDER BY po.order_date DESC
    `).all(dateFrom, dateTo);
  }

  /**
   * Price History
   * @param {object} filters - { date_from, date_to }
   */
  getPriceHistory(filters = {}) {
    const { date_from, date_to } = filters;
    const dateFrom = this._ymd(date_from || new Date(Date.now() - 180 * 86400000));
    const dateTo = this._ymd(date_to || new Date());

    // Schema safety
    if (
      !this._hasTable('purchase_order_items') ||
      !this._hasTable('purchase_orders') ||
      !this._hasTable('suppliers') ||
      !this._hasTable('products')
    ) {
      return [];
    }

    // Get raw rows ordered by product/date ASC so we can compute price change vs previous purchase
    const rows = this.db.prepare(`
      SELECT 
        p.id as product_id,
        p.name as product_name,
        p.sku as product_sku,
        s.id as supplier_id,
        s.name as supplier_name,
        po.order_date as purchase_date,
        poi.unit_cost as unit_price,
        COALESCE(poi.received_qty, poi.ordered_qty, 0) as quantity,
        (COALESCE(poi.received_qty, poi.ordered_qty, 0) * poi.unit_cost) as total_cost
      FROM purchase_order_items poi
      JOIN purchase_orders po ON poi.purchase_order_id = po.id
      JOIN suppliers s ON po.supplier_id = s.id
      JOIN products p ON poi.product_id = p.id
      WHERE date(po.order_date) BETWEEN date(?) AND date(?)
        AND po.status IN ('approved', 'received', 'partially_received')
      ORDER BY p.id ASC, datetime(po.order_date) ASC
    `).all(dateFrom, dateTo);

    // Compute price_change vs previous entry per product, and mark is_latest = last entry per product
    const lastByProduct = new Map(); // product_id -> {price, idx}
    const enriched = rows.map((r, idx) => {
      const price = Number(r.unit_price || 0) || 0;
      const prev = lastByProduct.get(r.product_id);
      const change = prev ? price - prev.price : 0;
      const changePct = prev && prev.price > 0 ? (change / prev.price) * 100 : 0;
      lastByProduct.set(r.product_id, { price, idx });
      return {
        ...r,
        price_change: change,
        price_change_percent: changePct,
        is_latest: 0,
      };
    });
    // Mark the last index per product as latest
    for (const { idx } of lastByProduct.values()) {
      if (enriched[idx]) enriched[idx].is_latest = 1;
    }
    // Sort by product name ASC, then date DESC for display (UI expectation)
    enriched.sort((a, b) => {
      const cmp = String(a.product_name || '').localeCompare(String(b.product_name || ''));
      if (cmp !== 0) return cmp;
      return String(b.purchase_date || '').localeCompare(String(a.purchase_date || ''));
    });
    return enriched;
  }

  /**
   * Product Price Summary
   * @param {object} filters - { date_from, date_to }
   */
  getProductPriceSummary(filters = {}) {
    const { date_from, date_to } = filters;
    const dateFrom = this._ymd(date_from || new Date(Date.now() - 180 * 86400000));
    const dateTo = this._ymd(date_to || new Date());

    if (!this._hasTable('products')) return [];

    // Schema-aware filters
    const hasIsActive = (() => {
      try {
        return !!this.db
          .prepare(`SELECT 1 AS ok FROM pragma_table_info('products') WHERE name = 'is_active' LIMIT 1`)
          .get()?.ok;
      } catch {
        return false;
      }
    })();
    const hasPoi = this._hasTable('purchase_order_items') && this._hasTable('purchase_orders');
    const activeWhere = hasIsActive ? `WHERE p.is_active = 1` : `WHERE 1=1`;

    const summary = this.db.prepare(`
      SELECT 
        p.id as product_id,
        p.name as product_name,
        p.sku as product_sku,
        p.purchase_price as current_price,
        COALESCE(MIN(poi.unit_cost), p.purchase_price) as min_price,
        COALESCE(MAX(poi.unit_cost), p.purchase_price) as max_price,
        COALESCE(AVG(poi.unit_cost), p.purchase_price) as avg_price,
        CASE 
          WHEN COUNT(DISTINCT poi.unit_cost) > 1 THEN 
            ((MAX(poi.unit_cost) - MIN(poi.unit_cost)) / NULLIF(AVG(poi.unit_cost), 0) * 100)
          ELSE 0 
        END as price_volatility,
        ${hasPoi ? `COUNT(DISTINCT po.supplier_id)` : `0`} as supplier_count
      FROM products p
      ${hasPoi ? `LEFT JOIN purchase_order_items poi ON p.id = poi.product_id
      LEFT JOIN purchase_orders po ON poi.purchase_order_id = po.id
        AND date(po.order_date) BETWEEN date(?) AND date(?)
        AND po.status IN ('approved', 'received', 'partially_received')` : ''}
      ${activeWhere}
      GROUP BY p.id
      ORDER BY p.name
    `).all(...(hasPoi ? [dateFrom, dateTo] : []));

    // Compute best/worst supplier per product (lowest avg unit_cost = best)
    if (!hasPoi || !this._hasTable('suppliers') || summary.length === 0) {
      return summary.map((s) => ({ ...s, best_supplier: '', worst_supplier: '' }));
    }
    const supplierAvgRows = this.db.prepare(`
      SELECT
        poi.product_id,
        s.name AS supplier_name,
        AVG(poi.unit_cost) AS avg_cost
      FROM purchase_order_items poi
      JOIN purchase_orders po ON poi.purchase_order_id = po.id
      JOIN suppliers s ON po.supplier_id = s.id
      WHERE date(po.order_date) BETWEEN date(?) AND date(?)
        AND po.status IN ('approved', 'received', 'partially_received')
      GROUP BY poi.product_id, s.id
    `).all(dateFrom, dateTo);

    const bestByProduct = new Map();
    const worstByProduct = new Map();
    for (const r of supplierAvgRows || []) {
      const cur = bestByProduct.get(r.product_id);
      if (!cur || r.avg_cost < cur.avg_cost) bestByProduct.set(r.product_id, r);
      const wcur = worstByProduct.get(r.product_id);
      if (!wcur || r.avg_cost > wcur.avg_cost) worstByProduct.set(r.product_id, r);
    }

    return summary.map((s) => ({
      ...s,
      best_supplier: bestByProduct.get(s.product_id)?.supplier_name || '',
      worst_supplier: worstByProduct.get(s.product_id)?.supplier_name || '',
    }));
  }

  /**
   * Purchase Planning Report (Bozorga borish hisoboti)
   * filters: { analysis_days?: 7|14|30, plan_days?: 7|14, date_to?: 'YYYY-MM-DD', category_id?: string|null, only_risk?: boolean }
   *
   * Assumptions (current version):
   * - Stock scope: main warehouse only (main-warehouse-001)
   * - Safety stock: fixed 2 days
   */
  getPurchasePlanning(filters = {}) {
    const analysisDaysRaw = Number(filters.analysis_days ?? 7);
    const planDaysRaw = Number(filters.plan_days ?? 7);
    const analysisDays = [7, 14, 30].includes(analysisDaysRaw) ? analysisDaysRaw : 7;
    const planDays = [7, 14].includes(planDaysRaw) ? planDaysRaw : 7;
    const safetyDays = 2;

    // Schema safety
    if (!this._hasTable('products')) return [];

    // Resolve warehouse: explicit filter > default warehouse > main-warehouse-001 (legacy fallback)
    let warehouseId = filters.warehouse_id || null;
    if (!warehouseId && this._hasTable('warehouses')) {
      try {
        const def = this.db
          .prepare(`SELECT id FROM warehouses WHERE is_default = 1 LIMIT 1`)
          .get();
        warehouseId = def?.id || 'main-warehouse-001';
      } catch {
        warehouseId = 'main-warehouse-001';
      }
    } else if (!warehouseId) {
      warehouseId = 'main-warehouse-001';
    }

    const dateTo = this._ymd(filters.date_to || new Date());
    const end = new Date(`${dateTo}T00:00:00Z`);
    const start = new Date(end.getTime() - (analysisDays - 1) * 86400000);
    const dateFrom = this._ymd(start);

    // Products (active)
    const hasProductsCurrentStock = (() => {
      try {
        return !!this.db.prepare(`SELECT 1 AS ok FROM pragma_table_info('products') WHERE name = 'current_stock' LIMIT 1`).get()
          ?.ok;
      } catch {
        return false;
      }
    })();

    let productQuery = `
      SELECT 
        p.id as product_id,
        p.name as product_name,
        p.sku as product_sku,
        p.unit as unit,
        ${hasProductsCurrentStock ? 'COALESCE(p.current_stock, 0) as product_current_stock,' : '0 as product_current_stock,'}
        p.category_id as category_id,
        c.name as category_name
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
      WHERE p.is_active = 1
    `;
    const productParams = [];
    if (filters.category_id) {
      productQuery += ` AND p.category_id = ?`;
      productParams.push(filters.category_id);
    }
    productQuery += ` ORDER BY p.name ASC`;
    const products = this.db.prepare(productQuery).all(productParams);

    if (!products?.length) return [];

    // Sales totals per product for analysis window — TZ-aware (Tashkent calendar)
    const salesRows = this._hasTable('orders') && this._hasTable('order_items')
      ? this.db
          .prepare(
            `
            SELECT
              oi.product_id,
              COALESCE(SUM(oi.quantity), 0) as total_sold
            FROM order_items oi
            INNER JOIN orders o ON o.id = oi.order_id
            WHERE COALESCE(LOWER(o.status), '') = 'completed'
              AND ${this._tzDateExpr('o.created_at')} BETWEEN date(?) AND date(?)
            GROUP BY oi.product_id
          `
          )
          .all(dateFrom, dateTo)
      : [];
    const soldByProduct = new Map();
    for (const r of salesRows || []) {
      soldByProduct.set(r.product_id, Number(r.total_sold || 0) || 0);
    }

    // Stock balances per product for main warehouse
    const stockRows = this._hasTable('stock_balances')
      ? this.db
          .prepare(
            `
            SELECT product_id, COALESCE(quantity, 0) as quantity
            FROM stock_balances
            WHERE warehouse_id = ?
          `
          )
          .all(warehouseId)
      : [];
    const stockByProduct = new Map();
    for (const r of stockRows || []) {
      stockByProduct.set(r.product_id, Number(r.quantity || 0) || 0);
    }

    const onlyRisk = Boolean(filters.only_risk);

    const roundQty = (qty, unit) => {
      const n = Number(qty || 0) || 0;
      const u = String(unit || '').toLowerCase();
      if (u === 'kg') {
        // Round up to grams (0.001 kg)
        return Math.ceil(n * 1000) / 1000;
      }
      return Math.ceil(n);
    };

    const rows = products.map((p) => {
      const totalSold = Number(soldByProduct.get(p.product_id) || 0) || 0;
      const avgDailySales = analysisDays > 0 ? totalSold / analysisDays : 0;
      const stockFromBalances = stockByProduct.has(p.product_id)
        ? Number(stockByProduct.get(p.product_id) || 0) || 0
        : null;
      const currentStock =
        stockFromBalances !== null
          ? stockFromBalances
          : (Number(p.product_current_stock || 0) || 0);

      const stockDays = avgDailySales > 0 ? currentStock / avgDailySales : (currentStock > 0 ? Infinity : 0);
      const shortageRaw = (avgDailySales * planDays) - currentStock;
      const shortage = shortageRaw > 0 ? shortageRaw : 0;
      const safetyQty = avgDailySales * safetyDays;
      const recommended = shortage + safetyQty;

      let status = 'OK';
      if (avgDailySales > 0) {
        if (stockDays < 0.5 * planDays) status = 'SHORTAGE';
        else if (stockDays < planDays) status = 'RISK';
      }

      return {
        product_id: p.product_id,
        product_name: p.product_name,
        product_sku: p.product_sku,
        unit: p.unit,
        category_id: p.category_id ?? null,
        category_name: p.category_name ?? null,

        analysis_days: analysisDays,
        plan_days: planDays,
        period_sales_qty: totalSold,
        avg_daily_sales: avgDailySales,
        current_stock: currentStock,
        stock_days: stockDays,
        shortage_qty: shortage,
        safety_qty: safetyQty,
        recommended_qty: roundQty(recommended, p.unit),
        status,
      };
    });

    const filtered = onlyRisk ? rows.filter((r) => r.status !== 'OK') : rows;

    // Sort: SHORTAGE first, then RISK, then OK; within, higher recommended first
    const rank = (s) => (s === 'SHORTAGE' ? 0 : s === 'RISK' ? 1 : 2);
    filtered.sort((a, b) => {
      const ra = rank(a.status);
      const rb = rank(b.status);
      if (ra !== rb) return ra - rb;
      return Number(b.recommended_qty || 0) - Number(a.recommended_qty || 0);
    });

    return filtered;
  }

  /**
   * Purchase vs Sale Spread
   * @param {object} filters - { date_from, date_to, sort_by }
   */
  getPurchaseSaleSpread(filters = {}) {
    const { date_from, date_to, sort_by = 'margin_percent' } = filters;
    const dateFrom = this._ymd(date_from || new Date(Date.now() - 90 * 86400000));
    const dateTo = this._ymd(date_to || new Date());
    const salesTable = this._salesTable();
    const itemsTable = this._saleItemsTable();
    const orderJoinCol = this._useUnifiedSales() ? 'unified_order_id' : 'order_id';
    const salesJoinCol = this._useUnifiedSales() ? 'unified_id' : 'id';
    const soldRevExpr = this._soldLineRevenueUzsSql('oi');
    const salesStatusWhere = completedStatusWhere(this.db, 'o');

    const rows = this.db
      .prepare(
        `
        WITH purchase_costs AS (
          SELECT
            pri.product_id,
            SUM(pri.received_qty) AS qty,
            SUM(
              pri.received_qty *
              CASE
                WHEN UPPER(COALESCE(pr.currency, 'USD')) = 'USD'
                  AND pr.exchange_rate IS NOT NULL
                  THEN COALESCE(pri.unit_cost_usd, pri.unit_cost) * pr.exchange_rate
                ELSE pri.unit_cost
              END
            ) AS cost_uzs
          FROM purchase_receipt_items pri
          INNER JOIN purchase_receipts pr ON pr.id = pri.receipt_id
          WHERE date(COALESCE(pr.received_at, pr.created_at)) BETWEEN date(?) AND date(?)
          GROUP BY pri.product_id
        ),
        sales AS (
          SELECT
            oi.product_id,
            SUM(oi.quantity) AS qty_sold,
            SUM(${soldRevExpr}) AS revenue_uzs,
            SUM(${this._cogsLineSql('oi')}) AS cogs_uzs
          FROM ${itemsTable} oi
          INNER JOIN ${salesTable} o ON o.${salesJoinCol} = oi.${orderJoinCol}
          WHERE ${salesStatusWhere}
            AND ${this._tzDateExpr('o.created_at')} BETWEEN date(?) AND date(?)
          GROUP BY oi.product_id
        )
        SELECT
          p.id AS product_id,
          p.name AS product_name,
          p.sku AS product_sku,
          c.name AS category_name,
          CASE WHEN pc.qty > 0 THEN (pc.cost_uzs / pc.qty) ELSE NULL END AS current_purchase_price,
          CASE WHEN s.qty_sold > 0 THEN (s.revenue_uzs / s.qty_sold) ELSE NULL END AS current_sale_price,
          CASE WHEN pc.qty > 0 THEN (pc.cost_uzs / pc.qty) ELSE NULL END AS avg_purchase_price,
          CASE WHEN s.qty_sold > 0 THEN (s.revenue_uzs / s.qty_sold) ELSE NULL END AS avg_sale_price,
          CASE
            WHEN pc.qty > 0 AND s.qty_sold > 0
              THEN ((s.revenue_uzs / s.qty_sold) - (pc.cost_uzs / pc.qty))
            ELSE 0
          END AS margin_amount,
          CASE
            WHEN pc.qty > 0
              THEN (((s.revenue_uzs / NULLIF(s.qty_sold, 0)) - (pc.cost_uzs / pc.qty)) / (pc.cost_uzs / pc.qty)) * 100
            ELSE 0
          END AS margin_percent,
          0 AS historical_min_margin,
          0 AS historical_max_margin,
          COALESCE(s.qty_sold, 0) AS total_quantity_sold,
          COALESCE(s.revenue_uzs, 0) AS total_revenue,
          COALESCE(s.revenue_uzs - s.cogs_uzs, 0) AS total_profit,
          CASE
            WHEN COALESCE(s.cogs_uzs, 0) > 0 THEN ((s.revenue_uzs - s.cogs_uzs) / s.cogs_uzs) * 100
            ELSE 0
          END AS roi
        FROM products p
        LEFT JOIN categories c ON p.category_id = c.id
        LEFT JOIN purchase_costs pc ON pc.product_id = p.id
        LEFT JOIN sales s ON s.product_id = p.id
        WHERE p.is_active = 1
        ORDER BY ${sort_by === 'margin_amount' ? 'margin_amount' : sort_by === 'total_profit' ? 'total_profit' : sort_by === 'roi' ? 'roi' : 'margin_percent'} DESC
      `
      )
      .all(dateFrom, dateTo, dateFrom, dateTo);

    return rows;
  }

  /**
   * Purchased vs sold per product.
   * Answers: qancha sotib olindi, qancha sotildi, qancha farq qoldi.
   * @param {object} filters - { date_from, date_to, sort_by }
   */
  getPurchaseVsSold(filters = {}) {
    const { date_from, date_to, sort_by = 'profit_uzs' } = filters;
    const dateFrom = this._ymd(date_from || new Date(Date.now() - 30 * 86400000));
    const dateTo = this._ymd(date_to || new Date());
    const supplierIdRaw = filters.supplier_id ?? filters.supplierId ?? null;
    const supplierId =
      supplierIdRaw != null && String(supplierIdRaw).trim() && String(supplierIdRaw).trim().toUpperCase() !== 'ALL'
        ? String(supplierIdRaw).trim()
        : null;
    const orderBy =
      sort_by === 'purchased_amount'
        ? 'purchased_amount_uzs'
        : sort_by === 'sold_amount'
          ? 'sold_amount_uzs'
          : sort_by === 'purchased_qty'
            ? 'purchased_qty'
            : sort_by === 'sold_qty'
              ? 'sold_qty'
              : sort_by === 'remaining_qty'
                ? 'remaining_qty'
                : 'profit_uzs';

    if (
      !this._hasTable('purchase_receipts') ||
      !this._hasTable('purchase_receipt_items') ||
      !this._hasTable('products')
    ) {
      return { period: { date_from: dateFrom, date_to: dateTo }, totals: {}, rows: [] };
    }
    const hasCategories = this._hasTable('categories');
    const hasQtyBase = (() => {
      try {
        return !!this.db
          .prepare(`SELECT 1 AS ok FROM pragma_table_info('order_items') WHERE name = 'qty_base' LIMIT 1`)
          .get()?.ok;
      } catch {
        return false;
      }
    })();
    const soldQtyExpr = hasQtyBase ? 'COALESCE(oi.qty_base, oi.quantity, 0)' : 'COALESCE(oi.quantity, 0)';
    const salesTable = this._salesTable();
    const itemsTable = this._saleItemsTable();
    const orderJoinCol = this._useUnifiedSales() ? 'unified_order_id' : 'order_id';
    const salesJoinCol = this._useUnifiedSales() ? 'unified_id' : 'id';
    const soldRevExpr = this._soldLineRevenueUzsSql('oi');
    const salesStatusWhere = completedStatusWhere(this.db, 'o');

    /**
     * Supplier filtri:
     *  - `purchases` CTE faqat shu yetkazib beruvchining kvitansiyalarini sanab chiqadi
     *  - mahsulot ro'yxati ham faqat shu supplier qabul qilgan mahsulotlar bilan cheklanadi
     *    (`INNER JOIN purchases pc`), aks holda yo'q mahsulotlar ham chiqib qolar edi.
     *  - sotuv qatorlari (sales) supplier dan qat'iy nazar shu mahsulot bo'yicha barchasini hisoblaydi.
     */
    // Some legacy receipts have NULL supplier_id but keep purchase_order_id.
    // In that case, fall back to the PO supplier so the filter still works.
    const purchasesSupplierWhere = supplierId
      ? ` AND (
            pr.supplier_id = ?
            OR (pr.supplier_id IS NULL AND po.supplier_id = ?)
          )`
      : '';
    // For supplier-specific view we only want actually received items.
    // Rows with received_qty = 0 were causing unrelated sales rows to leak
    // into the report because product linkage existed but no real purchase.
    const purchasesHaving = supplierId ? ' HAVING SUM(COALESCE(pri.received_qty, 0)) > 0' : '';
    const productJoinKind = supplierId ? 'INNER' : 'LEFT';
    const purchasesParams = supplierId
      ? [dateFrom, dateTo, supplierId, supplierId]
      : [dateFrom, dateTo];
    const sqlParams = [...purchasesParams, dateFrom, dateTo];

    const rows = this.db
      .prepare(
        `
        WITH purchases AS (
          SELECT
            pri.product_id,
            SUM(COALESCE(pri.received_qty, 0)) AS purchased_qty,
            SUM(
              COALESCE(pri.received_qty, 0) *
              CASE
                WHEN UPPER(COALESCE(pr.currency, 'USD')) = 'USD'
                  AND pr.exchange_rate IS NOT NULL
                  THEN COALESCE(pri.unit_cost_usd, pri.unit_cost, 0) * pr.exchange_rate
                ELSE COALESCE(pri.unit_cost, 0)
              END
            ) AS purchased_amount_uzs
          FROM purchase_receipt_items pri
          INNER JOIN purchase_receipts pr ON pr.id = pri.receipt_id
          LEFT JOIN purchase_orders po ON po.id = pr.purchase_order_id
          WHERE date(COALESCE(pr.received_at, pr.created_at)) BETWEEN date(?) AND date(?)${purchasesSupplierWhere}
          GROUP BY pri.product_id
          ${purchasesHaving}
        ),
        sales AS (
          SELECT
            oi.product_id,
            SUM(${soldQtyExpr}) AS sold_qty,
            SUM(${soldRevExpr}) AS sold_amount_uzs,
            SUM(${this._cogsLineSql('oi')}) AS cogs_uzs
          FROM ${itemsTable} oi
          INNER JOIN ${salesTable} o ON o.${salesJoinCol} = oi.${orderJoinCol}
          WHERE ${salesStatusWhere}
            AND ${this._tzDateExpr('o.created_at')} BETWEEN date(?) AND date(?)
          GROUP BY oi.product_id
        )
        SELECT
          p.id AS product_id,
          p.name AS product_name,
          p.sku AS product_sku,
          ${hasCategories ? 'c.name AS category_name' : "'' AS category_name"},
          COALESCE(p.current_stock, 0) AS current_stock,
          COALESCE(pc.purchased_qty, 0) AS purchased_qty,
          COALESCE(pc.purchased_amount_uzs, 0) AS purchased_amount_uzs,
          CASE
            WHEN COALESCE(pc.purchased_qty, 0) > 0
              THEN COALESCE(pc.purchased_amount_uzs, 0) / pc.purchased_qty
            ELSE 0
          END AS avg_purchase_price,
          COALESCE(s.sold_qty, 0) AS sold_qty,
          COALESCE(s.sold_amount_uzs, 0) AS sold_amount_uzs,
          CASE
            WHEN COALESCE(s.sold_qty, 0) > 0
              THEN COALESCE(s.sold_amount_uzs, 0) / s.sold_qty
            ELSE 0
          END AS avg_sale_price,
          COALESCE(pc.purchased_qty, 0) - COALESCE(s.sold_qty, 0) AS remaining_qty,
          CASE
            WHEN COALESCE(s.cogs_uzs, 0) > 0 THEN s.cogs_uzs
            WHEN COALESCE(pc.purchased_qty, 0) > 0
              THEN COALESCE(s.sold_qty, 0) * (COALESCE(pc.purchased_amount_uzs, 0) / pc.purchased_qty)
            ELSE 0
          END AS estimated_sold_cost_uzs,
          COALESCE(s.sold_amount_uzs, 0) -
          CASE
            WHEN COALESCE(s.cogs_uzs, 0) > 0 THEN s.cogs_uzs
            WHEN COALESCE(pc.purchased_qty, 0) > 0
              THEN COALESCE(s.sold_qty, 0) * (COALESCE(pc.purchased_amount_uzs, 0) / pc.purchased_qty)
            ELSE 0
          END AS profit_uzs,
          CASE
            WHEN COALESCE(pc.purchased_qty, 0) > 0
              THEN (COALESCE(s.sold_qty, 0) / pc.purchased_qty) * 100
            ELSE 0
          END AS sell_through_percent
        FROM products p
        ${hasCategories ? 'LEFT JOIN categories c ON c.id = p.category_id' : ''}
        ${productJoinKind} JOIN purchases pc ON pc.product_id = p.id
        LEFT JOIN sales s ON s.product_id = p.id
        WHERE p.is_active = 1
          AND (COALESCE(pc.purchased_qty, 0) <> 0 OR COALESCE(s.sold_qty, 0) <> 0)
        ORDER BY ${orderBy} DESC, p.name ASC
      `
      )
      .all(...sqlParams);

    const totals = rows.reduce(
      (acc, row) => {
        acc.purchased_qty += Number(row.purchased_qty || 0) || 0;
        acc.purchased_amount_uzs += Number(row.purchased_amount_uzs || 0) || 0;
        acc.sold_qty += Number(row.sold_qty || 0) || 0;
        acc.sold_amount_uzs += Number(row.sold_amount_uzs || 0) || 0;
        acc.estimated_sold_cost_uzs += Number(row.estimated_sold_cost_uzs || 0) || 0;
        acc.profit_uzs += Number(row.profit_uzs || 0) || 0;
        return acc;
      },
      {
        purchased_qty: 0,
        purchased_amount_uzs: 0,
        sold_qty: 0,
        sold_amount_uzs: 0,
        estimated_sold_cost_uzs: 0,
        profit_uzs: 0,
      }
    );
    totals.remaining_qty = totals.purchased_qty - totals.sold_qty;
    totals.sell_through_percent =
      totals.purchased_qty > 0 ? (totals.sold_qty / totals.purchased_qty) * 100 : 0;

    return {
      period: { date_from: dateFrom, date_to: dateTo },
      filters: { supplier_id: supplierId },
      totals,
      rows,
    };
  }

  /**
   * Spread Time Series
   * @param {object} filters - { date_from, date_to }
   */
  getSpreadTimeSeries(filters = {}) {
    const { date_from, date_to } = filters;
    const dateFrom = this._ymd(date_from || new Date(Date.now() - 90 * 86400000));
    const dateTo = this._ymd(date_to || new Date());
    const salesTable = this._salesTable();
    const itemsTable = this._saleItemsTable();
    const orderJoinCol = this._useUnifiedSales() ? 'unified_order_id' : 'order_id';
    const salesJoinCol = this._useUnifiedSales() ? 'unified_id' : 'id';
    const soldRevExpr = this._soldLineRevenueUzsSql('oi');
    const salesStatusWhere = completedStatusWhere(this.db, 'o');

    return this.db
      .prepare(
        `
        SELECT
          ${this._tzDateExpr('o.created_at')} as date,
          oi.product_id as product_id,
          COALESCE(p.name, oi.product_name, '') as product_name,
          CASE WHEN SUM(oi.quantity) > 0 THEN SUM(${soldRevExpr}) / SUM(oi.quantity) ELSE 0 END as avg_sale_price,
          CASE WHEN SUM(oi.quantity) > 0 THEN SUM(${this._cogsLineSql('oi')}) / SUM(oi.quantity) ELSE 0 END as avg_cost_price,
          CASE WHEN SUM(oi.quantity) > 0 THEN
            (SUM(${soldRevExpr}) / SUM(oi.quantity)) -
            (SUM(${this._cogsLineSql('oi')}) / SUM(oi.quantity))
          ELSE 0 END as margin_amount,
          CASE WHEN SUM(${this._cogsLineSql('oi')}) > 0 THEN
            ((SUM(${soldRevExpr}) - SUM(${this._cogsLineSql('oi')})) / SUM(${this._cogsLineSql('oi')})) * 100
          ELSE 0 END as margin_percent,
          COALESCE(SUM(oi.quantity), 0) as quantity_sold
        FROM ${salesTable} o
        JOIN ${itemsTable} oi ON o.${salesJoinCol} = oi.${orderJoinCol}
        LEFT JOIN products p ON oi.product_id = p.id
        WHERE ${salesStatusWhere}
          AND ${this._tzDateExpr('o.created_at')} BETWEEN date(?) AND date(?)
        GROUP BY date, oi.product_id
        ORDER BY date, product_name
      `
      )
      .all(dateFrom, dateTo);
  }

  /**
   * EMPLOYEE/OPERATIONS REPORTS
   */

  /**
   * Cashier Errors
   * @param {object} filters - { date_from, date_to }
   */
  getCashierErrors(filters = {}) {
    const { date_from, date_to } = filters;
    const dateFrom = this._ymd(date_from || new Date(Date.now() - 30 * 86400000));
    const dateTo = this._ymd(date_to || new Date());
    if (!this._hasTable('users') || !this._hasTable('orders')) return [];
    const hasReturns = this._hasTable('sales_returns');
    const params = [dateFrom, dateTo, dateFrom, dateTo, dateFrom, dateTo];

    const employees = hasReturns
      ? this.db
          .prepare(
            `
      SELECT
        u.id as employee_id,
        u.full_name as employee_name,
        COALESCE(cs.cnt, 0) as total_sales,
        COALESCE(cc.cnt, 0) as cancelled_count,
        COALESCE(cc.val, 0) as cancelled_value,
        COALESCE(rc.cnt, 0) as returns_count,
        COALESCE(rc.val, 0) as returns_value
      FROM users u
      LEFT JOIN (
        SELECT COALESCE(user_id, cashier_id) as uid, COUNT(*) as cnt
        FROM orders
        WHERE status = 'completed' AND ${this._tzDateExpr('orders.created_at')} BETWEEN date(?) AND date(?)
        GROUP BY COALESCE(user_id, cashier_id)
      ) cs ON u.id = cs.uid
      LEFT JOIN (
        SELECT COALESCE(user_id, cashier_id) as uid, COUNT(*) as cnt, COALESCE(SUM(${orderAmountUzsSql(this.db, 'orders')}), 0) as val
        FROM orders
        WHERE status = 'cancelled' AND ${this._tzDateExpr('orders.created_at')} BETWEEN date(?) AND date(?)
        GROUP BY COALESCE(user_id, cashier_id)
      ) cc ON u.id = cc.uid
      LEFT JOIN (
        SELECT COALESCE(sr.cashier_id, sr.user_id) as uid, COUNT(*) as cnt,
          COALESCE(SUM(${returnRefundUzsSql(this.db, 'sr', 'o', 'COALESCE(sr.refund_amount, sr.total_amount, 0)')}), 0) as val
        FROM sales_returns sr
        LEFT JOIN orders o ON o.id = sr.order_id
        WHERE IFNULL(sr.status, 'completed') = 'completed'
          AND ${this._tzDateExpr('sr.created_at')} BETWEEN date(?) AND date(?)
        GROUP BY COALESCE(sr.cashier_id, sr.user_id)
      ) rc ON u.id = rc.uid
      WHERE (COALESCE(cs.cnt, 0) + COALESCE(cc.cnt, 0) + COALESCE(rc.cnt, 0)) > 0
      ORDER BY (COALESCE(cc.cnt, 0) + COALESCE(rc.cnt, 0)) DESC, u.full_name ASC
    `
          )
          .all(...params)
      : this.db
          .prepare(
            `
      SELECT 
        u.id as employee_id,
        u.full_name as employee_name,
        COALESCE(SUM(CASE WHEN o.status = 'completed' THEN 1 ELSE 0 END), 0) as total_sales,
        COALESCE(SUM(CASE WHEN o.status = 'cancelled' THEN 1 ELSE 0 END), 0) as cancelled_count,
        COALESCE(SUM(CASE WHEN o.status = 'cancelled' THEN ${orderFieldUzsSql(this.db, 'o', 'total_amount')} ELSE 0 END), 0) as cancelled_value,
        0 as returns_count,
        0 as returns_value
      FROM users u
      LEFT JOIN orders o ON u.id = COALESCE(o.user_id, o.cashier_id)
        AND ${this._tzDateExpr('o.created_at')} BETWEEN date(?) AND date(?)
      GROUP BY u.id
      HAVING (COALESCE(SUM(CASE WHEN o.status = 'completed' THEN 1 ELSE 0 END), 0) + COALESCE(SUM(CASE WHEN o.status = 'cancelled' THEN 1 ELSE 0 END), 0)) > 0
      ORDER BY cancelled_count DESC
    `
          )
          .all(dateFrom, dateTo);

    return employees.map((e) => {
      const totalSales = Number(e.total_sales) || 0;
      const cancelledCount = Number(e.cancelled_count) || 0;
      const returnsCount = Number(e.returns_count) || 0;
      const cancelledValue = Number(e.cancelled_value) || 0;
      const returnsValue = Number(e.returns_value) || 0;
      const totalEvents = totalSales + cancelledCount + returnsCount;
      const errorRate = totalSales > 0 ? ((cancelledCount + returnsCount) / totalSales) * 100 : 0;
      const legacyEventRate = totalEvents > 0 ? ((cancelledCount + returnsCount) / totalEvents) * 100 : 0;
      return {
        ...e,
        total_sales: totalSales,
        cancelled_count: cancelledCount,
        cancelled_value: cancelledValue,
        returns_count: returnsCount,
        returns_value: returnsValue,
        avg_cancelled_value: cancelledCount > 0 ? cancelledValue / cancelledCount : 0,
        avg_return_value: returnsCount > 0 ? returnsValue / returnsCount : 0,
        error_rate: errorRate,
        error_rate_legacy: legacyEventRate,
        error_score: Math.min(100, errorRate * 2.5),
      };
    });
  }

  /**
   * Cashier Error Details
   * @param {object} filters - { date_from, date_to }
   */
  getCashierErrorDetails(filters = {}) {
    const { date_from, date_to } = filters;
    const dateFrom = this._ymd(date_from || new Date(Date.now() - 30 * 86400000));
    const dateTo = this._ymd(date_to || new Date());
    if (!this._hasTable('users') || !this._hasTable('orders')) return [];
    const hasReturns = this._hasTable('sales_returns') && this._hasTable('return_items');

    if (!hasReturns) {
      return this.db
        .prepare(
          `
        SELECT
          o.id,
          o.order_number,
          u.full_name as employee_name,
          ${this._tzDateExpr('o.created_at')} as order_date,
          ${this._tzTimeExpr('o.created_at')} as order_time,
          'cancelled' as type,
          o.total_amount as amount,
          (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) as items_count,
          COALESCE(o.notes, '') as reason,
          c.name as customer_name
        FROM orders o
        JOIN users u ON COALESCE(o.user_id, o.cashier_id) = u.id
        LEFT JOIN customers c ON o.customer_id = c.id
        WHERE o.status = 'cancelled'
          AND ${this._tzDateExpr('o.created_at')} BETWEEN date(?) AND date(?)
        ORDER BY o.created_at DESC
      `
        )
        .all(dateFrom, dateTo);
    }

    return this.db
      .prepare(
        `
        SELECT * FROM (
          SELECT
            o.id,
            o.order_number,
            u.full_name as employee_name,
            ${this._tzDateExpr('o.created_at')} as order_date,
            ${this._tzTimeExpr('o.created_at')} as order_time,
            'cancelled' as type,
            o.total_amount as amount,
            (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) as items_count,
            TRIM(COALESCE(o.notes, '')) as reason,
            c.name as customer_name,
            o.created_at as _sort_ts
          FROM orders o
          JOIN users u ON COALESCE(o.user_id, o.cashier_id) = u.id
          LEFT JOIN customers c ON o.customer_id = c.id
          WHERE o.status = 'cancelled'
            AND ${this._tzDateExpr('o.created_at')} BETWEEN date(?) AND date(?)
          UNION ALL
          SELECT
            sr.id,
            sr.return_number,
            u.full_name as employee_name,
            ${this._tzDateExpr('sr.created_at')} as order_date,
            ${this._tzTimeExpr('sr.created_at')} as order_time,
            'return' as type,
            COALESCE(NULLIF(sr.refund_amount, 0), sr.total_amount, 0) as amount,
            (SELECT COUNT(*) FROM return_items ri WHERE ri.return_id = sr.id) as items_count,
            TRIM(COALESCE(sr.return_reason, '')) as reason,
            c.name as customer_name,
            sr.created_at as _sort_ts
          FROM sales_returns sr
          JOIN users u ON u.id = COALESCE(sr.cashier_id, sr.user_id)
          LEFT JOIN customers c ON c.id = sr.customer_id
          WHERE IFNULL(sr.status, 'completed') = 'completed'
            AND ${this._tzDateExpr('sr.created_at')} BETWEEN date(?) AND date(?)
        ) x
        ORDER BY x._sort_ts DESC
      `
      )
      .all(dateFrom, dateTo, dateFrom, dateTo)
      .map((row) => {
        const { _sort_ts, ...rest } = row;
        return rest;
      });
  }

  /**
   * Shift Productivity — REAL data from `shifts` table.
   *
   * For every CLOSED shift in the date range, computes:
   *   - actual start_time / end_time (HH:MM, Tashkent TZ)
   *   - hours_worked (julianday diff in hours, 1 decimal)
   *   - orders_count, total_revenue (joined to that shift's user_id + opened..closed window)
   *   - revenue_per_hour, orders_per_hour
   *   - productivity_score (computed from cohort z-score, 0..100)
   *
   * NOTE: Replaces previous implementation that used HARDCODED 09:00–18:00 / 9 hours
   * and grouped by `orders.created_at` day instead of actual `shifts` rows.
   */
  getShiftProductivity(filters = {}) {
    const { date_from, date_to } = filters;
    const dateFrom = this._ymd(date_from || new Date(Date.now() - 30 * 86400000));
    const dateTo = this._ymd(date_to || new Date());

    if (!this._hasTable('shifts')) return [];

    // Use Tashkent-TZ-adjusted date expressions so shifts that span midnight
    // UTC don't get counted on the wrong calendar day in the user's timezone.
    const closedDateExpr = this._tzDateExpr('s.closed_at');
    const openedDateExpr = this._tzDateExpr('s.opened_at');
    const shiftDateExpr = `COALESCE(${closedDateExpr}, ${openedDateExpr})`;
    const startTimeExpr = this._tzTimeExpr('s.opened_at');
    const endTimeExpr = `CASE WHEN s.closed_at IS NOT NULL THEN ${this._tzTimeExpr('s.closed_at')} ELSE NULL END`;
    const hoursExpr = `
      CASE
        WHEN s.closed_at IS NOT NULL THEN
          ROUND((julianday(s.closed_at) - julianday(s.opened_at)) * 24.0, 2)
        ELSE NULL
      END
    `;

    // Sales per shift (orders by same user, created_at within shift window)
    const ordersJoin = `
      LEFT JOIN (
        SELECT
          o.user_id,
          o.cashier_id,
          o.id,
          o.total_amount,
          o.currency,
          o.fx_rate,
          o.created_at,
          o.status
        FROM orders o
        WHERE o.status = 'completed'
      ) o ON COALESCE(o.user_id, o.cashier_id) = s.user_id
        AND datetime(o.created_at) >= datetime(s.opened_at)
        AND (s.closed_at IS NULL OR datetime(o.created_at) <= datetime(s.closed_at))
    `;
    const shiftSalesSplit = orderSalesSplitExpressions(this.db, 'o');

    const hasUsers = this._hasTable('users');
    const userJoin = hasUsers ? `LEFT JOIN users u ON u.id = s.user_id` : '';
    const employeeNameExpr = hasUsers
      ? `COALESCE(u.full_name, u.username, s.user_id)`
      : `s.user_id`;

    const rows = this.db
      .prepare(
        `
        SELECT
          s.id AS shift_id,
          ${shiftDateExpr} AS shift_date,
          s.user_id AS employee_id,
          ${employeeNameExpr} AS employee_name,
          ${startTimeExpr} AS start_time,
          ${endTimeExpr} AS end_time,
          ${hoursExpr} AS hours_worked,
          s.status AS shift_status,
          COUNT(o.id) AS orders_count,
          COALESCE(SUM(${orderAmountUzsSql(this.db, 'o')}), 0) AS total_revenue,
          ${shiftSalesSplit.uzsSum} AS revenue_uzs,
          ${shiftSalesSplit.usdSum} AS revenue_usd,
          COALESCE(AVG(${orderAmountUzsSql(this.db, 'o')}), 0) AS avg_order_value
        FROM shifts s
        ${userJoin}
        ${ordersJoin}
        WHERE ${shiftDateExpr} BETWEEN date(?) AND date(?)
        GROUP BY s.id
        ORDER BY ${shiftDateExpr} DESC, total_revenue DESC
      `
      )
      .all(dateFrom, dateTo);

    // Compute productivity score relative to cohort (revenue_per_hour z-score → 0..100)
    const enriched = (rows || []).map((r) => {
      const hours = Number(r.hours_worked) || 0;
      const revenue = Number(r.total_revenue) || 0;
      const orders = Number(r.orders_count) || 0;
      const revenuePerHour = hours > 0 ? revenue / hours : 0;
      const ordersPerHour = hours > 0 ? orders / hours : 0;
      return {
        shift_id: r.shift_id,
        shift_date: r.shift_date,
        employee_id: r.employee_id,
        employee_name: r.employee_name || r.employee_id,
        start_time: r.start_time || null,
        end_time: r.end_time || null,
        hours_worked: hours,
        shift_status: r.shift_status,
        total_sales: orders,
        total_revenue: revenue,
        revenue_uzs: Number(r.revenue_uzs || 0) || 0,
        revenue_usd: Number(r.revenue_usd || 0) || 0,
        orders_count: orders,
        avg_order_value: Number(r.avg_order_value) || 0,
        revenue_per_hour: revenuePerHour,
        orders_per_hour: ordersPerHour,
        productivity_score: 0, // will be filled below
      };
    });

    // Score: percentile-based 0..100 from revenue_per_hour across the cohort
    const eligible = enriched.filter((s) => s.hours_worked > 0 && s.revenue_per_hour > 0);
    if (eligible.length > 0) {
      const sorted = [...eligible].sort((a, b) => a.revenue_per_hour - b.revenue_per_hour);
      const N = sorted.length;
      const rankByShiftId = new Map();
      sorted.forEach((s, i) => rankByShiftId.set(s.shift_id, i));
      for (const s of enriched) {
        if (s.hours_worked <= 0 || s.revenue_per_hour <= 0) {
          s.productivity_score = 0;
          continue;
        }
        const rank = rankByShiftId.get(s.shift_id);
        s.productivity_score = N === 1 ? 50 : Math.round((rank / (N - 1)) * 100);
      }
    }

    return enriched;
  }

  /**
   * Productivity Summary — REAL aggregates from `shifts` table.
   *
   * For each cashier:
   *   - total_shifts (closed shifts in range)
   *   - total_hours (SUM of (closed_at - opened_at) hours)
   *   - total_revenue / total_orders (orders within the cashier's shift windows)
   *   - avg_revenue_per_hour / avg_orders_per_hour
   *   - best_shift_revenue / worst_shift_revenue (per-SHIFT max/min, NOT per-order)
   *   - productivity_score (cohort percentile 0..100)
   */
  getProductivitySummary(filters = {}) {
    const { date_from, date_to, sort_by = 'revenue_per_hour' } = filters;
    const dateFrom = this._ymd(date_from || new Date(Date.now() - 30 * 86400000));
    const dateTo = this._ymd(date_to || new Date());

    // Use the per-shift report as source of truth, then aggregate per employee.
    const shifts = this.getShiftProductivity({ date_from: dateFrom, date_to: dateTo });

    const byEmployee = new Map();
    for (const s of shifts || []) {
      // Only count CLOSED shifts in the summary (open shifts have no real hours_worked)
      if (s.shift_status !== 'closed' || !(s.hours_worked > 0)) continue;
      const empId = s.employee_id;
      const acc = byEmployee.get(empId) || {
        employee_id: empId,
        employee_name: s.employee_name,
        total_shifts: 0,
        total_hours: 0,
        total_revenue: 0,
        total_revenue_uzs: 0,
        total_revenue_usd: 0,
        total_orders: 0,
        best_shift_revenue: 0,
        worst_shift_revenue: Number.POSITIVE_INFINITY,
      };
      acc.total_shifts += 1;
      acc.total_hours += s.hours_worked;
      acc.total_revenue += s.total_revenue;
      acc.total_revenue_uzs += Number(s.revenue_uzs || 0) || 0;
      acc.total_revenue_usd += Number(s.revenue_usd || 0) || 0;
      acc.total_orders += s.orders_count;
      if (s.total_revenue > acc.best_shift_revenue) acc.best_shift_revenue = s.total_revenue;
      if (s.total_revenue < acc.worst_shift_revenue) acc.worst_shift_revenue = s.total_revenue;
      byEmployee.set(empId, acc);
    }

    let employees = Array.from(byEmployee.values()).map((e) => ({
      ...e,
      worst_shift_revenue: e.worst_shift_revenue === Number.POSITIVE_INFINITY ? 0 : e.worst_shift_revenue,
      avg_revenue_per_hour: e.total_hours > 0 ? e.total_revenue / e.total_hours : 0,
      avg_orders_per_hour: e.total_hours > 0 ? e.total_orders / e.total_hours : 0,
      productivity_score: 0,
    }));

    // Cohort percentile score
    if (employees.length > 0) {
      const eligible = employees.filter((e) => e.avg_revenue_per_hour > 0);
      if (eligible.length > 0) {
        const sortedByRPH = [...eligible].sort((a, b) => a.avg_revenue_per_hour - b.avg_revenue_per_hour);
        const N = sortedByRPH.length;
        const rankByEmp = new Map();
        sortedByRPH.forEach((e, i) => rankByEmp.set(e.employee_id, i));
        for (const e of employees) {
          if (e.avg_revenue_per_hour <= 0) continue;
          const rank = rankByEmp.get(e.employee_id);
          e.productivity_score = N === 1 ? 50 : Math.round((rank / (N - 1)) * 100);
        }
      }
    }

    const sortKey =
      sort_by === 'orders_per_hour' ? 'avg_orders_per_hour'
      : sort_by === 'productivity_score' ? 'productivity_score'
      : 'avg_revenue_per_hour';
    employees.sort((a, b) => (Number(b[sortKey]) || 0) - (Number(a[sortKey]) || 0));

    return employees;
  }

  /**
   * Fraud Signals — improved.
   *
   * Per cashier in [date_from..date_to]:
   *   - cancelled_count / cancelled_rate
   *   - excessive_discount_count / rate
   *       NOTE: threshold is now applied to GROSS price (total_amount + discount_amount),
   *       so "30%" really means 30% of pre-discount price (the previous formula compared
   *       discount to NET price, which behaves like ~23% of gross).
   *   - returns_count / returns_value (from sales_returns)
   *   - high_value_returns_count (returns >= 70% of original order value — a known fraud pattern)
   *   - overall_risk_score (weighted), risk_level, alert_count
   *
   * The query uses LEFT JOINs against `users` so that we still see cashiers with no
   * activity (rather than `HAVING total_sales > 0` filtering them out silently).
   */
  getFraudSignals(filters = {}) {
    const { date_from, date_to } = filters;
    const dateFrom = this._ymd(date_from || new Date(Date.now() - 30 * 86400000));
    const dateTo = this._ymd(date_to || new Date());

    // If schema is incomplete (e.g. fresh DB) return empty array gracefully.
    if (!this._hasTable('users') || !this._hasTable('orders')) return [];

    // Support both modern (`sales_returns`) and legacy (`sale_returns`) schemas
    const returnsTable = this._hasTable('sales_returns')
      ? 'sales_returns'
      : this._hasTable('sale_returns')
        ? 'sale_returns'
        : null;
    const hasReturns = !!returnsTable;
    const hasUserRoles = this._hasTable('user_roles') && this._hasTable('roles');

    const cashierFilter = hasUserRoles
      ? `WHERE EXISTS (
          SELECT 1
          FROM user_roles ur
          INNER JOIN roles r ON r.id = ur.role_id
          WHERE ur.user_id = u.id AND r.is_active = 1 AND r.code = 'cashier'
        )`
      : `WHERE 1=1`;

    const orderAmtUzs = orderAmountUzsSql(this.db, 'o');
    const orderDiscUzs = orderFieldUzsSql(this.db, 'o', 'discount_amount');
    const grossUzsExpr = `(${orderAmtUzs} + ${orderDiscUzs})`;
    const dateExpr = this._tzDateExpr('o.created_at');

    const employees = this.db
      .prepare(
        `
        SELECT
          u.id AS employee_id,
          COALESCE(u.full_name, u.username, u.id) AS employee_name,
          COUNT(o.id) AS total_orders,
          COALESCE(SUM(CASE WHEN o.status = 'completed' THEN 1 ELSE 0 END), 0) AS completed_count,
          COALESCE(SUM(CASE WHEN o.status = 'cancelled' THEN 1 ELSE 0 END), 0) AS cancelled_count,
          COALESCE(SUM(CASE WHEN o.status = 'completed' THEN ${orderAmtUzs} ELSE 0 END), 0) AS total_revenue,
          COALESCE(SUM(CASE
            WHEN o.status = 'completed' AND ${grossUzsExpr} > 0
              AND ${orderDiscUzs} / NULLIF(${grossUzsExpr}, 0) > 0.30
            THEN 1 ELSE 0
          END), 0) AS excessive_discount_count,
          COALESCE(SUM(CASE WHEN o.status = 'completed' THEN ${orderDiscUzs} ELSE 0 END), 0) AS total_discount_given,
          COALESCE(AVG(CASE
            WHEN o.status = 'completed' AND ${grossUzsExpr} > 0 AND ${orderDiscUzs} > 0
            THEN ${orderDiscUzs} / NULLIF(${grossUzsExpr}, 0) * 100
            ELSE NULL
          END), 0) AS avg_discount_percent
        FROM users u
        LEFT JOIN orders o ON u.id = COALESCE(o.user_id, o.cashier_id)
          AND ${dateExpr} BETWEEN date(?) AND date(?)
        ${cashierFilter}
        GROUP BY u.id
      `
      )
      .all(dateFrom, dateTo);

    // Returns per cashier (separate query to avoid cartesian blow-up)
    const returnsByCashier = new Map();
    if (hasReturns) {
      try {
        const returnDateExpr = this._tzDateExpr('sr.created_at');
        const refundAmt = 'COALESCE(NULLIF(sr.refund_amount, 0), sr.total_amount, 0)';
        const refundUzs = returnRefundUzsSql(this.db, 'sr', 'o', refundAmt);
        const orderAmtForReturn = orderAmountUzsSql(this.db, 'o');
        const rows = this.db
          .prepare(
            `
            SELECT
              COALESCE(sr.cashier_id, sr.user_id) AS employee_id,
              COUNT(*) AS returns_count,
              COALESCE(SUM(${refundUzs}), 0) AS returns_value,
              COALESCE(SUM(CASE
                WHEN o.id IS NOT NULL AND ${orderAmtForReturn} > 0
                  AND (${refundUzs}) / ${orderAmtForReturn} >= 0.70
                THEN 1 ELSE 0
              END), 0) AS high_value_returns_count
            FROM ${returnsTable} sr
            LEFT JOIN orders o ON o.id = sr.order_id
            WHERE IFNULL(LOWER(sr.status), 'completed') = 'completed'
              AND ${returnDateExpr} BETWEEN date(?) AND date(?)
            GROUP BY COALESCE(sr.cashier_id, sr.user_id)
          `
          )
          .all(dateFrom, dateTo);
        for (const r of rows || []) {
          if (!r.employee_id) continue;
          returnsByCashier.set(r.employee_id, {
            returns_count: Number(r.returns_count) || 0,
            returns_value: Number(r.returns_value) || 0,
            high_value_returns_count: Number(r.high_value_returns_count) || 0,
          });
        }
      } catch (err) {
        console.warn('[reportsService.getFraudSignals] returns query failed:', err?.message || err);
      }
    }

    return employees
      .map((e) => {
        const totalOrders = Number(e.total_orders) || 0;
        const completed = Number(e.completed_count) || 0;
        const cancelled = Number(e.cancelled_count) || 0;
        const excessiveDisc = Number(e.excessive_discount_count) || 0;
        const ret = returnsByCashier.get(e.employee_id) || {
          returns_count: 0,
          returns_value: 0,
          high_value_returns_count: 0,
        };

        const cancelledRate = totalOrders > 0 ? (cancelled / totalOrders) * 100 : 0;
        const excessiveDiscRate = totalOrders > 0 ? (excessiveDisc / totalOrders) * 100 : 0;
        // Returns rate based on completed orders (denominator excludes cancelled to avoid double-counting)
        const denomForReturns = Math.max(1, completed);
        const returnsRate = (ret.returns_count / denomForReturns) * 100;
        const highValueReturnsRate = (ret.high_value_returns_count / denomForReturns) * 100;

        // Weighted overall risk: cancellations, excessive discounts, return patterns
        const riskScore = Math.min(
          100,
          cancelledRate * 0.35 +
            excessiveDiscRate * 0.35 +
            returnsRate * 0.15 +
            highValueReturnsRate * 0.15
        );
        let riskLevel = 'low';
        if (riskScore >= 30) riskLevel = 'critical';
        else if (riskScore >= 20) riskLevel = 'high';
        else if (riskScore >= 10) riskLevel = 'medium';

        return {
          employee_id: e.employee_id,
          employee_name: e.employee_name,
          total_sales: totalOrders, // backwards compat: legacy field name
          completed_count: completed,
          cancelled_count: cancelled,
          cancelled_rate: cancelledRate,
          excessive_discount_count: excessiveDisc,
          excessive_discount_rate: excessiveDiscRate,
          total_discount_given: Number(e.total_discount_given) || 0,
          avg_discount_percent: Number(e.avg_discount_percent) || 0,
          // returns block
          returns_count: ret.returns_count,
          returns_value: ret.returns_value,
          returns_rate: returnsRate,
          high_value_returns_count: ret.high_value_returns_count,
          high_value_returns_rate: highValueReturnsRate,
          // backwards-compat aliases
          suspicious_returns: ret.high_value_returns_count,
          void_pattern_score: cancelledRate,
          discount_pattern_score: excessiveDiscRate,
          overall_risk_score: riskScore,
          risk_level: riskLevel,
          alert_count: cancelled + excessiveDisc + ret.high_value_returns_count,
        };
      })
      // Show only cashiers with at least some activity (orders OR returns) in period
      .filter((e) => e.total_sales > 0 || e.returns_count > 0)
      .sort((a, b) => b.overall_risk_score - a.overall_risk_score);
  }

  /**
   * Fraud Incidents — improved.
   *
   * Lists individual events (cancellations, excessive discounts, high-value returns).
   * The discount threshold is now applied to GROSS price (total_amount + discount_amount),
   * so "30%" really means 30% of pre-discount price.
   */
  getFraudIncidents(filters = {}) {
    const { date_from, date_to } = filters;
    const dateFrom = this._ymd(date_from || new Date(Date.now() - 30 * 86400000));
    const dateTo = this._ymd(date_to || new Date());

    if (!this._hasTable('orders')) return [];

    const orderAmtUzs = orderAmountUzsSql(this.db, 'o');
    const orderDiscUzs = orderFieldUzsSql(this.db, 'o', 'discount_amount');
    const grossUzsExpr = `(${orderAmtUzs} + ${orderDiscUzs})`;
    const dateExpr = this._tzDateExpr('o.created_at');
    const timeExpr = this._tzTimeExpr('o.created_at');

    const hasUsersTable = this._hasTable('users');
    const userJoin = hasUsersTable ? 'LEFT JOIN users u ON u.id = COALESCE(o.cashier_id, o.user_id)' : '';
    const employeeNameExpr = hasUsersTable
      ? `COALESCE(u.full_name, u.username, COALESCE(o.cashier_id, o.user_id))`
      : `COALESCE(o.cashier_id, o.user_id)`;

    const orderIncidents = this.db
      .prepare(
        `
        SELECT
          o.id,
          ${employeeNameExpr} AS employee_name,
          ${dateExpr} AS incident_date,
          ${timeExpr} AS incident_time,
          CASE
            WHEN o.status = 'cancelled' THEN 'excessive_cancel'
            WHEN ${grossUzsExpr} > 0 AND ${orderDiscUzs} / NULLIF(${grossUzsExpr}, 0) > 0.30 THEN 'excessive_discount'
            ELSE 'other'
          END AS type,
          o.order_number,
          ${orderAmtUzs} AS amount,
          CASE
            WHEN ${grossUzsExpr} > 0 AND ${orderDiscUzs} > 0
              THEN ${orderDiscUzs} / NULLIF(${grossUzsExpr}, 0) * 100
            ELSE 0
          END AS discount_percent,
          CASE
            WHEN o.status = 'cancelled' THEN 'Buyurtma bekor qilindi'
            WHEN ${grossUzsExpr} > 0 AND ${orderDiscUzs} / NULLIF(${grossUzsExpr}, 0) > 0.30 THEN 'Juda katta chegirma'
            ELSE ''
          END AS description,
          CASE
            WHEN o.status = 'cancelled' THEN 75
            WHEN ${grossUzsExpr} > 0 AND ${orderDiscUzs} / NULLIF(${grossUzsExpr}, 0) > 0.30 THEN 60
            ELSE 30
          END AS risk_score
        FROM orders o
        ${userJoin}
        WHERE (
          o.status = 'cancelled'
          OR (${grossUzsExpr} > 0 AND ${orderDiscUzs} / NULLIF(${grossUzsExpr}, 0) > 0.30)
        )
          AND ${dateExpr} BETWEEN date(?) AND date(?)
      `
      )
      .all(dateFrom, dateTo);

    let returnIncidents = [];
    const returnsTableForIncidents = this._hasTable('sales_returns')
      ? 'sales_returns'
      : this._hasTable('sale_returns')
        ? 'sale_returns'
        : null;
    if (returnsTableForIncidents) {
      try {
        const returnDateExpr = this._tzDateExpr('sr.created_at');
        const returnTimeExpr = this._tzTimeExpr('sr.created_at');
        const refundAmtInc = 'COALESCE(NULLIF(sr.refund_amount, 0), sr.total_amount, 0)';
        const refundUzsInc = returnRefundUzsSql(this.db, 'sr', 'o', refundAmtInc);
        const orderAmtInc = orderAmountUzsSql(this.db, 'o');
        returnIncidents = this.db
          .prepare(
            `
            SELECT
              sr.id,
              COALESCE(u.full_name, u.username, u.id) AS employee_name,
              ${returnDateExpr} AS incident_date,
              ${returnTimeExpr} AS incident_time,
              'high_value_return' AS type,
              sr.return_number AS order_number,
              ${refundUzsInc} AS amount,
              0 AS discount_percent,
              'Yuqori summa qaytarish (>=70%)' AS description,
              70 AS risk_score
            FROM ${returnsTableForIncidents} sr
            LEFT JOIN orders o ON o.id = sr.order_id
            LEFT JOIN users u ON u.id = COALESCE(sr.cashier_id, sr.user_id)
            WHERE IFNULL(LOWER(sr.status), 'completed') = 'completed'
              AND ${returnDateExpr} BETWEEN date(?) AND date(?)
              AND o.id IS NOT NULL
              AND ${orderAmtInc} > 0
              AND (${refundUzsInc}) / ${orderAmtInc} >= 0.70
          `
          )
          .all(dateFrom, dateTo);
      } catch (err) {
        console.warn('[reportsService.getFraudIncidents] returns query failed:', err?.message || err);
      }
    }

    return [...orderIncidents, ...returnIncidents].sort((a, b) => {
      const da = `${a.incident_date || ''} ${a.incident_time || ''}`;
      const db = `${b.incident_date || ''} ${b.incident_time || ''}`;
      return db.localeCompare(da);
    });
  }

  /**
   * SYSTEM & TECHNICAL REPORTS
   */

  /**
   * Tashqi internet (HTTPS) — jiddiy xato bo‘lmasa ham sekinlik ogohlantirish
   */
  _probeInternetStatus() {
    const https = require('https');
    return new Promise((resolve) => {
      const t0 = Date.now();
      const req = https.get(
        'https://connectivitycheck.gstatic.com/generate_204',
        { timeout: 5000, headers: { 'User-Agent': 'POS-DeviceHealth/1' } },
        (res) => {
          res.resume();
          const ms = Date.now() - t0;
          const ok = res.statusCode === 204 || res.statusCode === 200;
          if (ok) {
            const slow = ms > 2500;
            resolve({
              status: slow ? 'warning' : 'online',
              last_check: new Date().toISOString(),
              uptime_percent: slow ? 92 : 99.2,
              error_count: 0,
              last_error: slow ? `Javob sekin (~${ms}ms)` : null,
              last_error_time: slow ? new Date().toISOString() : null,
            });
            return;
          }
          resolve({
            status: 'warning',
            last_check: new Date().toISOString(),
            uptime_percent: 85,
            error_count: 1,
            last_error: `HTTP ${res.statusCode}`,
            last_error_time: new Date().toISOString(),
          });
        }
      );
      req.on('error', (e) => {
        resolve({
          status: 'offline',
          last_check: new Date().toISOString(),
          uptime_percent: 0,
          error_count: 1,
          last_error: e?.message || "Internet aloqasi yo'q",
          last_error_time: new Date().toISOString(),
        });
      });
      req.on('timeout', () => {
        req.destroy();
        resolve({
          status: 'offline',
          last_check: new Date().toISOString(),
          uptime_percent: 0,
          error_count: 1,
          last_error: 'Timeout (5s)',
          last_error_time: new Date().toISOString(),
        });
      });
    });
  }

  /**
   * termal printer — node-thermal-printer isPrinterConnected (spooler rejimida tarmoq tekshiruvi cheklangan)
   */
  async _probePrinterDeviceRow() {
    try {
      const PrintService = require('./printService.cjs');
      const print = new PrintService(this.db);
      const cfg = print.getPrinterConfig();
      const iface = String(cfg.interface || 'usb').toLowerCase();
      const useSpooler = iface.startsWith('printer:');
      const { useUsb } = print.resolveUsbIds(cfg);
      const label = cfg.spoolerName
        ? String(cfg.spoolerName)
        : useUsb
          ? 'USB termal'
          : iface;
      if (useSpooler) {
        return {
          device_id: 'device-printer',
          device_name: 'Printer (Windows spooler)',
          device_type: 'printer',
          location: 'Ilova sozlamalari',
          status: 'warning',
          last_check: new Date().toISOString(),
          uptime_percent: 100,
          error_count: 0,
          last_error: "Spooler rejimida to'g'ridan-to'g'ri USB ulanish tekshiruvi bajarilmaydi",
          last_error_time: null,
        };
      }
      const chars = print.resolveCharsPerLine(cfg);
      const p = print.createPrinter({ ...cfg, charsPerLine: chars });
      const ok = await Promise.race([
        p.isPrinterConnected(),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 6000)),
      ])
        .then((v) => v === true)
        .catch(() => false);
      return {
        device_id: 'device-printer',
        device_name: `Termal printer (${label})`,
        device_type: 'printer',
        location: "Ilova sozlamalari (printer)",
        status: ok ? 'online' : 'offline',
        last_check: new Date().toISOString(),
        uptime_percent: ok ? 99 : 0,
        error_count: ok ? 0 : 1,
        last_error: ok ? null : "Printer topilmadi yoki ulanish vaqti tugadi",
        last_error_time: ok ? null : new Date().toISOString(),
      };
    } catch (e) {
      return {
        device_id: 'device-printer',
        device_name: 'Termal printer',
        device_type: 'printer',
        location: 'Ilova sozlamalari',
        status: 'warning',
        last_check: new Date().toISOString(),
        uptime_percent: 0,
        error_count: 1,
        last_error: e?.message || 'Printer tekshiruvi xatosi',
        last_error_time: new Date().toISOString(),
      };
    }
  }

  async _collectDeviceHealthBundle() {
    const now = Date.now();
    const cache = this._deviceHealthCache;
    if (cache && cache.payload && now - cache.at < 8000) {
      return cache.payload;
    }
    const [inet, printerRow] = await Promise.all([this._probeInternetStatus(), this._probePrinterDeviceRow()]);
    const scaleRow = {
      device_id: 'device-scale',
      device_name: 'Tar termal (integratsiya)',
      device_type: 'scale',
      location: 'Kassa',
      status: 'warning',
      last_check: new Date().toISOString(),
      uptime_percent: 0,
      error_count: 0,
      last_error: "Hozir bu sahifa tarozidan real vaqtda o'qimaydi; alohida servis kutiladi",
      last_error_time: null,
    };
    const netRow = {
      device_id: 'device-internet',
      device_name: 'Internet (HTTPS test)',
      device_type: 'internet',
      location: "Tashqi tarmoq (G'mobile check)",
      status: inet.status,
      last_check: inet.last_check,
      uptime_percent: inet.uptime_percent,
      error_count: inet.error_count,
      last_error: inet.last_error,
      last_error_time: inet.last_error_time,
    };
    const devices = [printerRow, scaleRow, netRow];
    const incidents = [];
    for (const d of devices) {
      if (d.status === 'offline' || d.error_count > 0) {
        if (d.last_error) {
          incidents.push({
            id: `inc-${d.device_id}-${d.last_error_time || d.last_check}`,
            device_name: d.device_name,
            device_type: d.device_type,
            incident_type: d.status === 'offline' ? 'offline' : 'error',
            occurred_at: d.last_error_time || d.last_check,
            resolved_at: undefined,
            duration_minutes: undefined,
            error_message: d.last_error,
            affected_operations: 0,
          });
        }
      }
    }
    this._deviceHealthCache = { at: now, payload: { devices, incidents } };
    return { devices, incidents };
  }

  /**
   * Device Health: printer (sozlamalar + iltimos, USB) | tarozi (placeholder) | internet (haqiqiy)
   */
  async getDeviceHealth() {
    const { devices } = await this._collectDeviceHealthBundle();
    return devices;
  }

  /**
   * Hozirgi yukdagi xatolik/yo‘qlik (tarixi DBda saqlanmaydi)
   */
  async getDeviceIncidents() {
    const { incidents } = await this._collectDeviceHealthBundle();
    return incidents;
  }

  /**
   * Audit Log (Action History)
   * @param {object} filters - { date_from, date_to, action, entity_type, user_id }
   */
  getAuditLog(filters = {}) {
    const { date_from, date_to, action, entity_type, user_id } = filters;
    const dateFrom = this._ymd(date_from || new Date(Date.now() - 7 * 86400000));
    const dateTo = this._ymd(date_to || new Date());

    const hasAuditLogs = this._hasTable('audit_logs');
    const hasAuditLog = this._hasTable('audit_log');
    const hasPriceHistory = this._hasTable('price_history');
    const hasUsers = this._hasTable('users');
    const hasProducts = this._hasTable('products');

    const wantPrice =
      hasPriceHistory &&
      (!entity_type || entity_type === 'all' || entity_type === 'price');
    const wantAudit =
      (hasAuditLogs || hasAuditLog) &&
      (!entity_type || entity_type === 'all' || entity_type !== 'price');

    const rows = [];

    if (wantAudit && (hasAuditLogs || hasAuditLog)) {
      const userJoin = hasUsers ? 'LEFT JOIN users u ON al.user_id = u.id' : '';
      const userNameExpr = hasUsers
        ? `COALESCE(u.full_name, u.username, al.user_id, 'Noma''lum')`
        : `COALESCE(al.user_id, 'Noma''lum')`;
      const dayCol = this._tzDateExpr('al.created_at');
      let where = `WHERE ${dayCol} BETWEEN date(?) AND date(?)`;
      const params = [dateFrom, dateTo];

      if (action) {
        where += ` AND al.action = ?`;
        params.push(action);
      }
      if (entity_type && entity_type !== 'all' && entity_type !== 'price') {
        where += ` AND al.entity_type = ?`;
        params.push(entity_type);
      }
      if (user_id) {
        where += ` AND al.user_id = ?`;
        params.push(user_id);
      }

      if (hasAuditLogs) {
        const auditRows = this.db
          .prepare(
            `
          SELECT 
            al.id,
            al.user_id,
            ${userNameExpr} as user_name,
            al.action,
            al.entity_type,
            al.entity_id,
            al.entity_name,
            al.old_value,
            al.new_value,
            al.ip_address,
            al.user_agent,
            al.created_at,
            al.description
          FROM audit_logs al
          ${userJoin}
          ${where}
          ORDER BY al.created_at DESC
          LIMIT 1000
        `,
          )
          .all(...params);
        rows.push(...(auditRows || []));
      } else {
        const auditRows = this.db
          .prepare(
            `
        SELECT 
          al.id,
          al.user_id,
          ${userNameExpr} as user_name,
          al.action,
          al.entity_type,
          al.entity_id,
          NULL as entity_name,
          al.old_values as old_value,
          al.new_values as new_value,
          al.ip_address,
          al.user_agent,
          al.created_at,
          NULL as description
        FROM audit_log al
        ${userJoin}
        ${where}
        ORDER BY al.created_at DESC
        LIMIT 1000
      `,
          )
          .all(...params);
        rows.push(...(auditRows || []));
      }
    }

    if (wantPrice) {
      const productJoin = hasProducts ? 'LEFT JOIN products p ON ph.product_id = p.id' : '';
      const productNameExpr = hasProducts ? `COALESCE(p.name, ph.product_id)` : `ph.product_id`;
      const productSkuExpr = hasProducts ? `p.sku` : `NULL`;
      const userJoin = hasUsers ? 'LEFT JOIN users u ON ph.changed_by = u.id' : '';
      const changedByExpr = hasUsers
        ? `COALESCE(u.full_name, u.username, ph.changed_by, 'Noma''lum')`
        : `COALESCE(ph.changed_by, 'Noma''lum')`;
      let priceWhere = `WHERE ${this._tzDateExpr('ph.changed_at')} BETWEEN date(?) AND date(?)`;
      const priceParams = [dateFrom, dateTo];
      if (action && action !== 'update') {
        // price history entries are always "update"
      } else if (action === 'update') {
        // no extra filter
      }
      if (user_id) {
        priceWhere += ` AND ph.changed_by = ?`;
        priceParams.push(user_id);
      }

      const priceRows = this.db
        .prepare(
          `
        SELECT
          'ph:' || ph.id AS id,
          ph.changed_by AS user_id,
          ${changedByExpr} AS user_name,
          'update' AS action,
          'price' AS entity_type,
          ph.product_id AS entity_id,
          ${productNameExpr} AS entity_name,
          printf('%.2f', COALESCE(ph.old_price, 0)) AS old_value,
          printf('%.2f', COALESCE(ph.new_price, 0)) AS new_value,
          NULL AS ip_address,
          NULL AS user_agent,
          ph.changed_at AS created_at,
          COALESCE(ph.reason, ph.price_type || ' narx') AS description,
          ph.price_type,
          ${productSkuExpr} AS product_sku
        FROM price_history ph
        ${productJoin}
        ${userJoin}
        ${priceWhere}
        ORDER BY ph.changed_at DESC
        LIMIT 1000
      `,
        )
        .all(...priceParams);
      rows.push(...(priceRows || []));
    }

    if (!rows.length) return [];

    return rows
      .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
      .slice(0, 1000);
  }

  /**
   * Price Change History
   * @param {object} filters - { date_from, date_to, price_type }
   */
  getPriceChangeHistory(filters = {}) {
    const { date_from, date_to, price_type } = filters;
    const dateFrom = this._ymd(date_from || new Date(Date.now() - 30 * 86400000));
    const dateTo = this._ymd(date_to || new Date());

    if (!this._hasTable('price_history')) {
      return [];
    }
    const hasProducts = this._hasTable('products');
    const hasUsers = this._hasTable('users');

    let where = `WHERE ${this._tzDateExpr('ph.changed_at')} BETWEEN date(?) AND date(?)`;
    const params = [dateFrom, dateTo];

    if (price_type) {
      where += ` AND ph.price_type = ?`;
      params.push(price_type);
    }

    const productJoin = hasProducts ? 'LEFT JOIN products p ON ph.product_id = p.id' : '';
    const productNameExpr = hasProducts ? `p.name` : `NULL`;
    const productSkuExpr = hasProducts ? `p.sku` : `NULL`;
    const userJoin = hasUsers ? 'LEFT JOIN users u ON ph.changed_by = u.id' : '';
    const changedByExpr = hasUsers
      ? `COALESCE(u.full_name, u.username, ph.changed_by, 'Noma''lum')`
      : `COALESCE(ph.changed_by, 'Noma''lum')`;

    return this.db.prepare(`
      SELECT 
        ph.id,
        ph.product_id,
        ${productNameExpr} as product_name,
        ${productSkuExpr} as product_sku,
        ph.price_type,
        ph.unit,
        ph.old_price,
        ph.new_price,
        (ph.new_price - ph.old_price) as change_amount,
        CASE
          WHEN ph.old_price IS NULL OR ph.old_price = 0 THEN NULL
          ELSE ((ph.new_price - ph.old_price) / ph.old_price * 100)
        END as change_percent,
        ph.changed_by,
        ${changedByExpr} as changed_by_name,
        ph.changed_at,
        ph.reason
      FROM price_history ph
      ${productJoin}
      ${userJoin}
      ${where}
      ORDER BY ph.changed_at DESC
      LIMIT 1000
    `).all(...params);
  }

  /**
   * EXECUTIVE DASHBOARD
   */

  /**
   * Executive KPI Overview
   * @param {object} filters - { period: 'day'|'week'|'month' }
   */
  getExecutiveKPI(filters = {}) {
    const { period = 'day' } = filters;
    const today = this._ymd(new Date());

    let daysBack = 1;
    if (period === 'week') daysBack = 7;
    if (period === 'month') daysBack = 30;

    const dateFrom = this._ymd(new Date(Date.now() - daysBack * 86400000));
    const datePrevFrom = this._ymd(new Date(Date.now() - daysBack * 2 * 86400000));
    const datePrevTo = this._ymd(new Date(Date.now() - daysBack * 86400000));

    const emptyResult = {
      revenue: 0, revenue_previous: 0, revenue_growth: 0,
      profit: 0, profit_previous: 0, profit_margin: 0, profit_growth: 0,
      total_debt: 0, customer_debt: 0, supplier_debt: 0, debt_growth: 0,
      inventory_value: 0, inventory_value_previous: 0, inventory_growth: 0,
      orders_count: 0, customers_count: 0, avg_order_value: 0,
    };

    const hasOrders = this._hasView('v_unified_sales') || this._hasTable('orders');
    const hasOrderItems = this._hasSaleItemsSource();
    const hasCustomers = this._hasTable('customers');
    const hasPurchaseOrders = this._hasTable('purchase_orders');
    const hasSupplierPayments = this._hasTable('supplier_payments');

    // If no orders table, the entire KPI panel is meaningless
    if (!hasOrders) return emptyResult;

    const salesTable = this._salesTable();
    const itemsTable = this._saleItemsTable();
    const orderJoinCol = this._useUnifiedSales() ? 'unified_order_id' : 'order_id';
    const salesJoinCol = this._useUnifiedSales() ? 'unified_id' : 'id';
    const salesSplit = unifiedSalesSplitExpressions(this.db, 's');
    const amountUzs = unifiedAmountUzsSql(this.db, 's');

    const current = this.db.prepare(`
      SELECT 
        COALESCE(SUM(${amountUzs}), 0) as revenue,
        ${salesSplit.uzsSum} AS revenue_uzs,
        ${salesSplit.usdSum} AS revenue_usd,
        COUNT(*) as orders_count,
        COUNT(DISTINCT customer_id) as customers_count,
        COALESCE(AVG(${amountUzs}), 0) as avg_order_value
      FROM ${salesTable} s
      WHERE ${completedStatusWhere(this.db, 's')}
        AND ${this._tzDateExpr('s.created_at')} BETWEEN date(?) AND date(?)
    `).get(dateFrom, today);

    const previous = this.db.prepare(`
      SELECT 
        COALESCE(SUM(${amountUzs}), 0) as revenue,
        ${salesSplit.uzsSum} AS revenue_uzs,
        ${salesSplit.usdSum} AS revenue_usd
      FROM ${salesTable} s
      WHERE ${completedStatusWhere(this.db, 's')}
        AND ${this._tzDateExpr('s.created_at')} BETWEEN date(?) AND date(?)
    `).get(datePrevFrom, datePrevTo);

    let currentCogsRow = { cogs: 0, sold_revenue: 0 };
    let previousCogsRow = { cogs: 0, sold_revenue: 0 };
    if (hasOrderItems) {
      const cogsExpr = this._cogsLineSql('oi');
      const soldRevExpr = this._soldLineRevenueUzsSql('oi');
      currentCogsRow = this.db.prepare(`
        SELECT COALESCE(SUM(${cogsExpr}), 0) as cogs,
               COALESCE(SUM(${soldRevExpr}), 0) as sold_revenue
        FROM ${itemsTable} oi
        JOIN ${salesTable} o ON o.${salesJoinCol} = oi.${orderJoinCol}
        WHERE ${completedStatusWhere(this.db, 'o')}
          AND ${this._tzDateExpr('o.created_at')} BETWEEN date(?) AND date(?)
      `).get(dateFrom, today);
      previousCogsRow = this.db.prepare(`
        SELECT COALESCE(SUM(${cogsExpr}), 0) as cogs,
               COALESCE(SUM(${soldRevExpr}), 0) as sold_revenue
        FROM ${itemsTable} oi
        JOIN ${salesTable} o ON o.${salesJoinCol} = oi.${orderJoinCol}
        WHERE ${completedStatusWhere(this.db, 'o')}
          AND ${this._tzDateExpr('o.created_at')} BETWEEN date(?) AND date(?)
      `).get(datePrevFrom, datePrevTo);
    }

    const currentSoldRevenue = Number(currentCogsRow?.sold_revenue || 0) || Number(current.revenue || 0);
    const previousSoldRevenue = Number(previousCogsRow?.sold_revenue || 0) || Number(previous.revenue || 0);
    const currentProfit = currentSoldRevenue - (currentCogsRow?.cogs || 0);
    const previousProfit = previousSoldRevenue - (previousCogsRow?.cogs || 0);
    const profitMargin = current.revenue > 0 ? (currentProfit / current.revenue) : 0;

    let customerDebtVal = 0;
    if (hasCustomers) {
      const row = this.db.prepare(`
        SELECT COALESCE(SUM(ABS(balance)), 0) as debt
        FROM customers
        WHERE COALESCE(balance, 0) < 0
      `).get();
      customerDebtVal = Number(row?.debt || 0) || 0;
    }

    let supplierDebtVal = 0;
    let supplierDebtUsdVal = 0;
    if (hasPurchaseOrders && hasSupplierPayments) {
      const debtSplit = createCurrencyLedger(this.db).executiveSupplierDebt();
      supplierDebtVal = Number(debtSplit.supplier_debt_uzs || 0) || 0;
      supplierDebtUsdVal = Number(debtSplit.supplier_debt_usd || 0) || 0;
    }

    const totalDebt = customerDebtVal + supplierDebtVal;

    // Inventory value (FIFO if enabled, else weighted avg fallback)
    const inventoryValue = (() => {
      try {
        const totals = this.validateAccountingConsistency({ warehouse_id: filters.warehouse_id });
        return totals?.fifo_total ?? totals?.weighted_total ?? 0;
      } catch {
        return 0;
      }
    })();
    const inventoryValuePrev = inventoryValue;

    return {
      revenue: current.revenue || 0,
      revenue_uzs: Number(current.revenue_uzs || 0) || 0,
      revenue_usd: Number(current.revenue_usd || 0) || 0,
      revenue_previous: previous.revenue || 0,
      revenue_previous_uzs: Number(previous.revenue_uzs || 0) || 0,
      revenue_previous_usd: Number(previous.revenue_usd || 0) || 0,
      revenue_growth: previous.revenue > 0 ? ((current.revenue - previous.revenue) / previous.revenue) * 100 : 0,
      profit: currentProfit,
      profit_previous: previousProfit,
      profit_margin: profitMargin * 100,
      profit_growth: previousProfit > 0 ? ((currentProfit - previousProfit) / previousProfit) * 100 : 0,
      total_debt: totalDebt,
      customer_debt: customerDebtVal,
      supplier_debt: supplierDebtVal,
      supplier_debt_uzs: supplierDebtVal,
      supplier_debt_usd: supplierDebtUsdVal,
      // Historical debt is not snapshotted yet — compare current period to itself yields 0 by design.
      debt_growth: 0,
      inventory_value: inventoryValue || 0,
      inventory_value_previous: inventoryValuePrev,
      inventory_growth: 0,
      orders_count: current.orders_count || 0,
      customers_count: current.customers_count || 0,
      avg_order_value: current.avg_order_value || 0,
    };
  }

  /**
   * Accounting safety checks.
   * Returns { missing_cost_count, fifo_total, weighted_total, valuation_mismatch }
   */
  validateAccountingConsistency(filters = {}) {
    const warehouseId = filters.warehouse_id || null;
    const dateFrom = filters.date_from ? this._ymd(filters.date_from) : null;
    const dateTo = filters.date_to ? this._ymd(filters.date_to) : null;
    const salesTable = this._salesTable();
    const itemsTable = this._saleItemsTable();
    const orderJoinCol = this._useUnifiedSales() ? 'unified_order_id' : 'order_id';
    const salesJoinCol = this._useUnifiedSales() ? 'unified_id' : 'id';

    const params = [];
    let where = `WHERE ${completedStatusWhere(this.db, 'o')}`;
    const orderDateExpr = this._tzDateExpr('o.created_at');
    if (warehouseId) {
      where += ` AND o.warehouse_id = ?`;
      params.push(warehouseId);
    }
    if (dateFrom) {
      where += ` AND ${orderDateExpr} >= date(?)`;
      params.push(dateFrom);
    }
    if (dateTo) {
      where += ` AND ${orderDateExpr} <= date(?)`;
      params.push(dateTo);
    }
    where += salesChannelWhere('o', filters.sales_channel, params);

    let missingCostCount = 0;
    try {
      if (this._hasSaleItemsSource() && (this._hasView('v_unified_sales') || this._hasTable('orders'))) {
        const row = this.db
          .prepare(
            `
            SELECT COUNT(*) AS missing_count
            FROM ${itemsTable} oi
            INNER JOIN ${salesTable} o ON o.${salesJoinCol} = oi.${orderJoinCol}
            ${where}
              AND (oi.cost_price IS NULL OR oi.cost_price = 0)
          `
          )
          .get(params);
        missingCostCount = Number(row?.missing_count || 0) || 0;
        if (missingCostCount > 0) {
          console.warn('⚠️ ACCOUNTING_COGS_MISSING', {
            missingCostCount,
            warehouseId,
            dateFrom,
            dateTo,
            sales_channel: filters.sales_channel || null,
          });
        }
      }
    } catch {
      missingCostCount = 0;
    }

    let missingCostSamples = [];
    try {
      if (missingCostCount > 0 && this._hasSaleItemsSource() && (this._hasView('v_unified_sales') || this._hasTable('orders'))) {
        const hasProducts = this._hasTable('products');
        const productJoin = hasProducts ? 'LEFT JOIN products p ON p.id = oi.product_id' : '';
        const productNameExpr = hasProducts ? `COALESCE(p.name, oi.product_id)` : `oi.product_id`;
        const productSkuExpr = hasProducts ? `p.sku` : `NULL`;
        missingCostSamples =
          this.db
            .prepare(
              `
              SELECT
                oi.product_id,
                ${productNameExpr} AS product_name,
                ${productSkuExpr} AS product_sku,
                COUNT(*) AS line_count
              FROM ${itemsTable} oi
              INNER JOIN ${salesTable} o ON o.${salesJoinCol} = oi.${orderJoinCol}
              ${where}
                AND (oi.cost_price IS NULL OR oi.cost_price = 0)
              GROUP BY oi.product_id
              ORDER BY line_count DESC
              LIMIT 20
            `,
            )
            .all(params) || [];
      }
    } catch {
      missingCostSamples = [];
    }

    let fifoTotal = null;
    let weightedTotal = null;

    if (warehouseId && this._hasTable('inventory_batches')) {
      try {
        let batchCostExpr = 'COALESCE(unit_cost, 0)';
        try {
          const batchCols = new Set(
            (this.db.prepare(`PRAGMA table_info(inventory_batches)`).all() || []).map((c) => c.name),
          );
          if (batchCols.has('cost_price_uzs')) {
            batchCostExpr = 'COALESCE(cost_price_uzs, unit_cost, 0)';
          }
        } catch {
          /* keep unit_cost */
        }
        const fifoRow = this.db
          .prepare(
            `
            WITH batch_costs AS (
              SELECT
                product_id,
                SUM(remaining_qty) AS remaining_qty,
                SUM(remaining_qty * ${batchCostExpr}) AS remaining_value
              FROM inventory_batches
              WHERE warehouse_id = ?
              GROUP BY product_id
            )
            SELECT COALESCE(SUM(
              COALESCE(bc.remaining_value, 0)
              + MAX(0, COALESCE(sb.quantity, 0) - COALESCE(bc.remaining_qty, 0)) * COALESCE(p.purchase_price, 0)
            ), 0) AS fifo_value
            FROM stock_balances sb
            INNER JOIN products p ON p.id = sb.product_id
            LEFT JOIN batch_costs bc ON bc.product_id = sb.product_id
            WHERE sb.warehouse_id = ?
          `
          )
          .get(warehouseId, warehouseId);
        fifoTotal = Number(fifoRow?.fifo_value || 0) || 0;
      } catch {
        fifoTotal = null;
      }
    }

    if (warehouseId && this._hasTable('purchase_receipts') && this._hasTable('purchase_receipt_items')) {
      try {
        const weightedRow = this.db
          .prepare(
            `
            WITH receipt_costs AS (
              SELECT
                pri.product_id,
                pr.warehouse_id,
                SUM(pri.received_qty) AS qty,
                SUM(
                  pri.received_qty *
                  CASE
                    WHEN UPPER(COALESCE(pr.currency, 'USD')) = 'USD'
                      AND pr.exchange_rate IS NOT NULL
                      THEN COALESCE(pri.unit_cost_usd, pri.unit_cost) * pr.exchange_rate
                    ELSE pri.unit_cost
                  END
                ) AS cost_uzs
              FROM purchase_receipt_items pri
              INNER JOIN purchase_receipts pr ON pr.id = pri.receipt_id
              WHERE pr.warehouse_id = ?
              GROUP BY pri.product_id, pr.warehouse_id
            )
            SELECT
              COALESCE(SUM(COALESCE(sb.quantity, 0) * COALESCE((rc.cost_uzs / NULLIF(rc.qty, 0)), 0)), 0) AS weighted_value
            FROM stock_balances sb
            LEFT JOIN receipt_costs rc ON rc.product_id = sb.product_id AND rc.warehouse_id = sb.warehouse_id
            WHERE sb.warehouse_id = ?
          `
          )
          .get(warehouseId, warehouseId);
        weightedTotal = Number(weightedRow?.weighted_value || 0) || 0;
      } catch {
        weightedTotal = null;
      }
    }

    let valuationMismatch = false;
    if (fifoTotal != null && weightedTotal != null) {
      const diff = Math.abs(fifoTotal - weightedTotal);
      const baseline = Math.max(1, weightedTotal);
      valuationMismatch = diff > Math.max(1000, baseline * 0.02);
      if (valuationMismatch) {
        console.warn('[reportsService] Valuation mismatch FIFO vs weighted:', {
          fifoTotal,
          weightedTotal,
          diff,
          warehouseId,
        });
      }
    }

    return {
      missing_cost_count: missingCostCount,
      missing_cost_samples: (missingCostSamples || []).map((r) => ({
        product_id: r.product_id,
        product_name: r.product_name,
        product_sku: r.product_sku,
        line_count: Number(r.line_count || 0) || 0,
      })),
      cogs_missing: missingCostCount > 0,
      accounting_cogs_missing: missingCostCount > 0,
      profit_incomplete: missingCostCount > 0,
      fifo_total: fifoTotal,
      weighted_total: weightedTotal,
      valuation_mismatch: valuationMismatch,
    };
  }

  /**
   * Executive Trends
   * @param {object} filters - { period: 'day'|'week'|'month' }
   */
  getExecutiveTrends(filters = {}) {
    const { period = 'day' } = filters;
    const today = this._ymd(new Date());
    const salesTable = this._salesTable();
    const itemsTable = this._saleItemsTable();
    const orderJoinCol = this._useUnifiedSales() ? 'unified_order_id' : 'order_id';
    const salesJoinCol = this._useUnifiedSales() ? 'unified_id' : 'id';

    if (!this._hasView('v_unified_sales') && !this._hasTable('orders')) return [];

    let daysBack = 7;
    const tzExpr = (col) => this._tzDateExpr(col);
    let groupExprForOrders = tzExpr('o.created_at');
    let periodLabelExprForOrders = tzExpr('o.created_at');

    if (period === 'week') {
      daysBack = 8 * 7;
      groupExprForOrders = `strftime('%Y-W%W', datetime(replace(replace(o.created_at, 'T', ' '), 'Z', ''), '${UZBEKISTAN_TZ_SQLITE_OFFSET}'))`;
      periodLabelExprForOrders = `strftime('Hafta %W', datetime(replace(replace(o.created_at, 'T', ' '), 'Z', ''), '${UZBEKISTAN_TZ_SQLITE_OFFSET}'))`;
    } else if (period === 'month') {
      daysBack = 12 * 30;
      groupExprForOrders = `strftime('%Y-%m', datetime(replace(replace(o.created_at, 'T', ' '), 'Z', ''), '${UZBEKISTAN_TZ_SQLITE_OFFSET}'))`;
      periodLabelExprForOrders = groupExprForOrders;
    }

    const dateFrom = this._ymd(new Date(Date.now() - daysBack * 86400000));
    const hasOrderItems = this._hasTable(itemsTable);
    const amountUzs = unifiedAmountUzsSql(this.db, 'o');
    const cogsExpr = this._cogsLineSql('oi');

    const cogsJoin = hasOrderItems
      ? `LEFT JOIN (
          SELECT oi.${orderJoinCol} AS order_key, COALESCE(SUM(${cogsExpr}), 0) AS cogs
          FROM ${itemsTable} oi
          GROUP BY oi.${orderJoinCol}
        ) c ON c.order_key = o.${salesJoinCol}`
      : '';
    const cogsSumExpr = hasOrderItems ? 'COALESCE(c.cogs, 0)' : '0';

    const trends = this.db.prepare(`
      SELECT 
        ${periodLabelExprForOrders} as period,
        ${groupExprForOrders} as period_key,
        COALESCE(SUM(${amountUzs}), 0) as revenue,
        COALESCE(SUM(${cogsSumExpr}), 0) as cogs,
        COUNT(*) as orders,
        MIN(o.created_at) as period_start
      FROM ${salesTable} o
      ${cogsJoin}
      WHERE ${completedStatusWhere(this.db, 'o')}
        AND ${tzExpr('o.created_at')} BETWEEN date(?) AND date(?)
      GROUP BY ${groupExprForOrders}, ${periodLabelExprForOrders}
      ORDER BY period_start
    `).all(dateFrom, today);

    return trends.map((t) => {
      const revenue = Number(t.revenue) || 0;
      const cogs = Number(t.cogs) || 0;
      return {
        period: t.period,
        revenue,
        profit: revenue - cogs,
        orders: Number(t.orders) || 0,
      };
    });
  }
}

module.exports = ReportsService;

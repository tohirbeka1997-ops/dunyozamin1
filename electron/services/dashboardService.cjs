const { ERROR_CODES, createError } = require('../lib/errors.cjs');
const {
  formatYmdInTimeZone,
  nowSqlInTimeZone,
  UZBEKISTAN_TZ_SQLITE_OFFSET,
} = require('../lib/timezone.cjs');
const { expenseAmountUzsSql } = require('../lib/expenseAmount.cjs');
const { sumPaymentFeesForPeriod } = require('../lib/paymentFee.cjs');
const { orderFieldUzsSql, orderAmountUzsSql, returnRefundUzsSql } = require('../lib/orderAmount.cjs');
const {
  salesFrom,
  saleItemsFrom,
  completedStatusWhere,
  unifiedAmountUzsSql,
  unifiedFieldUzsSql,
  unifiedSalesSplitExpressions,
  cogsLineSql,
  returnCogsLineSql,
  calculateNetProfit,
  soldLineRevenueUzsSql,
  salesChannelWhere,
  useUnifiedSales,
  posCartReturnExcludeWhere,
} = require('../lib/unifiedSalesSql.cjs');

/**
 * Dashboard Service
 * Handles dashboard statistics and analytics
 */
class DashboardService {
  constructor(db) {
    this.db = db;
  }

  _hasTable(name) {
    try {
      const row = this.db
        .prepare(`SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name = ? LIMIT 1`)
        .get(String(name));
      return !!row?.ok;
    } catch {
      return false;
    }
  }

  _ymd(input) {
    if (!input) return formatYmdInTimeZone(new Date());
    if (typeof input === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input)) return input;
    const ymd = formatYmdInTimeZone(input);
    if (!ymd) return formatYmdInTimeZone(new Date());
    return ymd;
  }

  _tzDateExpr(columnExpr) {
    return `date(datetime(replace(replace(${columnExpr}, 'T', ' '), 'Z', ''), '${UZBEKISTAN_TZ_SQLITE_OFFSET}'))`;
  }

  /**
   * Get dashboard statistics
   */
  getStats(filters = {}) {
    const today = this._ymd(new Date());
    const params = [];
    const salesTable = salesFrom(this.db);
    const itemsTable = saleItemsFrom(this.db);
    const orderJoinCol = useUnifiedSales(this.db) ? 'unified_order_id' : 'order_id';
    const salesJoinCol = useUnifiedSales(this.db) ? 'unified_id' : 'id';

    const orderDateExpr = this._tzDateExpr('created_at');
    const todayAmtUzs = unifiedAmountUzsSql(this.db, 'o');
    const todayPaidUzs = useUnifiedSales(this.db)
      ? unifiedFieldUzsSql(this.db, 'o', null, 'o.paid_amount')
      : orderFieldUzsSql(this.db, 'o', 'paid_amount');
    let salesQuery = `
      SELECT 
        COUNT(*) as today_orders,
        COALESCE(SUM(${todayAmtUzs}), 0) as today_sales,
        COALESCE(SUM(${todayPaidUzs}), 0) as today_revenue
      FROM ${salesTable} o
      WHERE ${completedStatusWhere(this.db, 'o')}
        AND ${orderDateExpr} = DATE(?)
    `;
    params.push(today);
    salesQuery += salesChannelWhere('o', filters.sales_channel, params);

    const salesStats = this.db.prepare(salesQuery).get(...params);

    // Low stock count
    const lowStockQuery = `
      SELECT COUNT(DISTINCT p.id) as low_stock_count
      FROM products p
      INNER JOIN stock_balances sb ON p.id = sb.product_id
      WHERE sb.quantity <= p.min_stock_level
        AND sb.quantity > 0
    `;
    const lowStock = this.db.prepare(lowStockQuery).get();

    // Active customers (customers who made orders in last 30 days)
    const activeCustomersQuery = `
      SELECT COUNT(DISTINCT customer_id) as active_customers
      FROM ${salesTable}
      WHERE customer_id IS NOT NULL
        AND created_at >= datetime(?, '-30 days')
    `;
    const activeCustomers = this.db.prepare(activeCustomersQuery).get(nowSqlInTimeZone());

    const revAmtUzs = useUnifiedSales(this.db)
      ? unifiedFieldUzsSql(this.db, 'o', null, 'o.paid_amount')
      : orderFieldUzsSql(this.db, 'o', 'paid_amount');
    const totalRevenueQuery = `
      SELECT COALESCE(SUM(${revAmtUzs}), 0) as total_revenue
      FROM ${salesTable} o
      WHERE ${completedStatusWhere(this.db, 'o')}
    `;
    const totalRevenue = this.db.prepare(totalRevenueQuery).get();

    const cogsExpr = cogsLineSql('oi');
    const soldRevExpr = soldLineRevenueUzsSql(this.db, 'o', 'oi');
    const hasItemsSource = useUnifiedSales(this.db) || this._hasTable('order_items');
    const totalProfit = hasItemsSource
      ? this.db.prepare(`
          SELECT COALESCE(SUM(${cogsExpr}), 0) AS total_cogs,
                 COALESCE(SUM(${soldRevExpr}), 0) AS total_revenue_items
          FROM ${itemsTable} oi
          INNER JOIN ${salesTable} o ON o.${salesJoinCol} = oi.${orderJoinCol}
          WHERE ${completedStatusWhere(this.db, 'o')}
        `).get()
      : { total_cogs: 0, total_revenue_items: 0 };
    const profitVal =
      (Number(totalProfit?.total_revenue_items || 0) || 0) -
      (Number(totalProfit?.total_cogs || 0) || 0);

    return {
      today_sales: salesStats?.today_sales || 0,
      today_orders: salesStats?.today_orders || 0,
      low_stock_count: lowStock?.low_stock_count || 0,
      active_customers: activeCustomers?.active_customers || 0,
      total_revenue: totalRevenue?.total_revenue || 0,
      total_profit: profitVal,
    };
  }

  /**
   * Dashboard analytics for a date range (used by Dashboard KPI cards)
   * filters: { date_from: 'YYYY-MM-DD', date_to: 'YYYY-MM-DD' }
   */
  getAnalytics(filters = {}) {
    const dateFrom = this._ymd(filters.date_from || new Date());
    const dateTo = this._ymd(filters.date_to || new Date());
    const salesTable = salesFrom(this.db);
    const itemsTable = saleItemsFrom(this.db);
    const orderJoinCol = useUnifiedSales(this.db) ? 'unified_order_id' : 'order_id';
    const salesJoinCol = useUnifiedSales(this.db) ? 'unified_id' : 'id';
    const orderDateExpr = this._tzDateExpr('o.created_at');
    const isAllWarehouses = String(filters.warehouse_id || '').toUpperCase() === 'ALL';
    const warehouseId = isAllWarehouses ? null : (filters.warehouse_id || null);

    const salesParams = [dateFrom, dateTo];
    const salesWarehouseWhere = warehouseId ? ` AND o.warehouse_id = ?` : '';
    if (warehouseId) salesParams.push(warehouseId);
    const channelClause = salesChannelWhere('o', filters.sales_channel, salesParams);
    const salesAmtUzs = unifiedAmountUzsSql(this.db, 'o');
    const paidAmtUzs = useUnifiedSales(this.db)
      ? unifiedFieldUzsSql(this.db, 'o', null, 'o.paid_amount')
      : orderFieldUzsSql(this.db, 'o', 'paid_amount');
    const creditAmtUzs = useUnifiedSales(this.db)
      ? unifiedFieldUzsSql(this.db, 'o', null, 'o.credit_amount')
      : orderFieldUzsSql(this.db, 'o', 'credit_amount');
    const salesSplit = unifiedSalesSplitExpressions(this.db, 'o');
    const salesRow = this.db
      .prepare(
        `
        SELECT
          COUNT(*) AS total_orders,
          COALESCE(SUM(${salesAmtUzs}), 0) AS total_sales,
          ${salesSplit.uzsSum} AS total_sales_uzs,
          ${salesSplit.usdSum} AS total_sales_usd,
          COALESCE(SUM(${paidAmtUzs}), 0) AS total_collected,
          COALESCE(SUM(${creditAmtUzs}), 0) AS credit_issued,
          COALESCE(AVG(${salesAmtUzs}), 0) AS average_order_value
        FROM ${salesTable} o
        WHERE ${completedStatusWhere(this.db, 'o')}
          AND ${orderDateExpr} BETWEEN date(?) AND date(?)
          AND ${posCartReturnExcludeWhere(this.db, 'o')}
          ${salesWarehouseWhere}
          ${channelClause}
      `
      )
      .get(...salesParams);

    const cogsParams = [dateFrom, dateTo];
    const cogsWarehouseWhere = warehouseId ? ` AND o.warehouse_id = ?` : '';
    if (warehouseId) cogsParams.push(warehouseId);
    const cogsChannelClause = salesChannelWhere('o', filters.sales_channel, cogsParams);
    const cogsExpr = cogsLineSql('oi');
    const soldRevExpr = soldLineRevenueUzsSql(this.db, 'o', 'oi');
    const hasItemsSource = useUnifiedSales(this.db) || this._hasTable('order_items');
    const cogsRow = hasItemsSource
      ? this.db
          .prepare(
            `
            SELECT
              COALESCE(SUM(${cogsExpr}), 0) AS total_cogs,
              COALESCE(SUM(${soldRevExpr}), 0) AS sold_revenue,
              COALESCE(SUM(COALESCE(oi.qty_base, oi.quantity, 0)), 0) AS items_sold
            FROM ${itemsTable} oi
            INNER JOIN ${salesTable} o ON o.${salesJoinCol} = oi.${orderJoinCol}
            WHERE ${completedStatusWhere(this.db, 'o')}
              AND ${orderDateExpr} BETWEEN date(?) AND date(?)
              AND ${posCartReturnExcludeWhere(this.db, 'o')}
              ${cogsWarehouseWhere}
              ${cogsChannelClause}
          `
          )
          .get(...cogsParams)
      : { total_cogs: 0, sold_revenue: 0, items_sold: 0 };

    // Expenses
    const hasExpenseWh = (() => {
      if (!warehouseId || !this._hasTable('expenses')) return false;
      try {
        return !!this.db.prepare(`SELECT 1 AS ok FROM pragma_table_info('expenses') WHERE name = 'warehouse_id' LIMIT 1`).get()?.ok;
      } catch {
        return false;
      }
    })();
    const expenseDateExpr = this._tzDateExpr('COALESCE(e.expense_date, e.created_at)');
    const expenseParams = [dateFrom, dateTo];
    const expenseWarehouseWhere = hasExpenseWh ? ` AND e.warehouse_id = ?` : '';
    if (hasExpenseWh && warehouseId) expenseParams.push(warehouseId);
    const expensesRow = this._hasTable('expenses')
      ? this.db
          .prepare(
            `
            SELECT COALESCE(SUM(${expenseAmountUzsSql(this.db, 'e')}), 0) AS total_expenses
            FROM expenses e
            WHERE COALESCE(LOWER(e.status), 'approved') = 'approved'
              AND ${expenseDateExpr} BETWEEN date(?) AND date(?)
              ${expenseWarehouseWhere}
          `
          )
          .get(...expenseParams)
      : { total_expenses: 0 };

    // Returns (optional)
    const returnsTable = this._hasTable('sales_returns')
      ? 'sales_returns'
      : this._hasTable('sale_returns')
        ? 'sale_returns'
        : null;
    const _retCols = returnsTable
      ? (() => {
          try {
            return new Set(
              (this.db.prepare(`PRAGMA table_info(${returnsTable})`).all() || []).map((c) => c.name)
            );
          } catch {
            return new Set();
          }
        })()
      : new Set();
    const _retHasRefundAmount = _retCols.has('refund_amount');
    const _retHasWarehouseId = _retCols.has('warehouse_id');

    const returnDateExpr = this._tzDateExpr('r.created_at');
    const returnParams = [dateFrom, dateTo];
    const returnWarehouseWhere = warehouseId && _retHasWarehouseId ? ` AND r.warehouse_id = ?` : '';
    if (warehouseId && _retHasWarehouseId) returnParams.push(warehouseId);
    const _amountExpr = _retHasRefundAmount
      ? `COALESCE(r.refund_amount, r.total_amount, 0)`
      : `COALESCE(r.total_amount, 0)`;
    const _returnsUzsExpr = returnRefundUzsSql(this.db, 'r', 'o', _amountExpr);
    const returnsRow = returnsTable
      ? this.db
          .prepare(
            `
            SELECT
              COUNT(*) AS returns_count,
              COALESCE(SUM(${_returnsUzsExpr}), 0) AS returns_amount
            FROM ${returnsTable} r
            LEFT JOIN orders o ON o.id = r.order_id
            WHERE COALESCE(LOWER(r.status), 'completed') = 'completed'
              AND ${returnDateExpr} BETWEEN date(?) AND date(?)
              ${returnWarehouseWhere}
          `
          )
          .get(...returnParams)
      : { returns_count: 0, returns_amount: 0 };

    const returnItemsTable = returnsTable === 'sale_returns' ? 'sale_return_items' : 'return_items';
    // Detect whether return-items has qty_base (added in migration 041) and order_item_id link
    const _retItemsHasQtyBase = returnsTable && this._hasTable(returnItemsTable)
      ? (() => {
          try {
            return !!this.db
              .prepare(`SELECT 1 AS ok FROM pragma_table_info(?) WHERE name = 'qty_base' LIMIT 1`)
              .get(returnItemsTable)?.ok;
          } catch {
            return false;
          }
        })()
      : false;
    const _retItemsHasOrderItemId = returnsTable && this._hasTable(returnItemsTable)
      ? (() => {
          try {
            return !!this.db
              .prepare(`SELECT 1 AS ok FROM pragma_table_info(?) WHERE name = 'order_item_id' LIMIT 1`)
              .get(returnItemsTable)?.ok;
          } catch {
            return false;
          }
        })()
      : false;
    const _retItemsHasProductId = returnsTable && this._hasTable(returnItemsTable)
      ? (() => {
          try {
            return !!this.db
              .prepare(`SELECT 1 AS ok FROM pragma_table_info(?) WHERE name = 'product_id' LIMIT 1`)
              .get(returnItemsTable)?.ok;
          } catch {
            return false;
          }
        })()
      : false;

    const returnCogsParams = [dateFrom, dateTo];
    if (warehouseId) returnCogsParams.push(warehouseId);
    const _retQtyExpr = _retItemsHasQtyBase
      ? `COALESCE(ri.qty_base, ri.quantity, 0)`
      : `COALESCE(ri.quantity, 0)`;
    const _retCogsUnitExpr = returnCogsLineSql('oi', _retQtyExpr);
    let _retCogsSql;
    if (_retItemsHasOrderItemId) {
      _retCogsSql = `
        SELECT COALESCE(SUM(${_retCogsUnitExpr}), 0) AS returns_cogs
        FROM ${returnItemsTable} ri
        INNER JOIN ${returnsTable} r ON r.id = ri.return_id
        LEFT JOIN order_items oi ON oi.id = ri.order_item_id
        WHERE COALESCE(LOWER(r.status), 'completed') = 'completed'
          AND ${returnDateExpr} BETWEEN date(?) AND date(?)
          ${returnWarehouseWhere}
      `;
    } else if (_retItemsHasProductId) {
      _retCogsSql = `
        SELECT COALESCE(SUM(${_retQtyExpr} * COALESCE((
          SELECT purchase_price FROM products WHERE id = ri.product_id LIMIT 1
        ), 0)), 0) AS returns_cogs
        FROM ${returnItemsTable} ri
        INNER JOIN ${returnsTable} r ON r.id = ri.return_id
        WHERE COALESCE(LOWER(r.status), 'completed') = 'completed'
          AND ${returnDateExpr} BETWEEN date(?) AND date(?)
          ${returnWarehouseWhere}
      `;
    } else {
      _retCogsSql = null;
    }
    const returnsCogsRow =
      returnsTable && this._hasTable(returnItemsTable) && _retCogsSql
        ? this.db.prepare(_retCogsSql).get(...returnCogsParams)
        : { returns_cogs: 0 };

    // POS savat qaytarishlari (manfiy jami orders) — sales_returns jadvalida emas
    let posCartReturnsAmount = 0;
    let posCartReturnsCogs = 0;
    let posCartReturnsCount = 0;
    if (this._hasTable('orders') && this._hasTable('order_items')) {
      const posParams = [dateFrom, dateTo];
      let posWhere = `WHERE o.status = 'completed' AND o.total_amount < -0.009`;
      posWhere += ` AND ${orderDateExpr} BETWEEN date(?) AND date(?)`;
      if (warehouseId) {
        posWhere += ` AND o.warehouse_id = ?`;
        posParams.push(warehouseId);
      }
      const posChannelClause = salesChannelWhere('o', filters.sales_channel, posParams);
      const posCogsExpr = cogsLineSql('oi');
      const posAmtUzs = orderAmountUzsSql(this.db, 'o');
      try {
        const posRow = this.db
          .prepare(
            `
            SELECT
              COUNT(DISTINCT o.id) AS returns_count,
              COALESCE(SUM(ABS(${posAmtUzs})), 0) AS returns_amount,
              COALESCE(SUM(ABS(item_cogs.cogs)), 0) AS returns_cogs
            FROM orders o
            LEFT JOIN (
              SELECT oi.order_id, SUM(${posCogsExpr}) AS cogs
              FROM order_items oi
              GROUP BY oi.order_id
            ) item_cogs ON item_cogs.order_id = o.id
            ${posWhere}
            ${posChannelClause}
          `,
          )
          .get(...posParams);
        posCartReturnsCount = Number(posRow?.returns_count || 0) || 0;
        posCartReturnsAmount = Number(posRow?.returns_amount || 0) || 0;
        posCartReturnsCogs = Number(posRow?.returns_cogs || 0) || 0;
      } catch {
        /* orders schema partial in some test DBs */
      }
    }

    // Low stock count (optional)
    let lowStockCount = 0;
    if (this._hasTable('products') && this._hasTable('stock_balances')) {
      const lowParams = [];
      const lowWarehouseWhere = warehouseId ? ` AND sb.warehouse_id = ?` : '';
      if (warehouseId) lowParams.push(warehouseId);
      const low = this.db
        .prepare(
          `
          SELECT COUNT(DISTINCT p.id) as low_stock_count
          FROM products p
          INNER JOIN stock_balances sb ON p.id = sb.product_id
          WHERE p.is_active = 1
            AND sb.quantity <= p.min_stock_level
            AND sb.quantity > 0
            ${lowWarehouseWhere}
        `
        )
        .get(...lowParams);
      lowStockCount = Number(low?.low_stock_count || 0) || 0;
    }

    // Active customers count
    const activeParams = [dateFrom, dateTo];
    const activeWarehouseWhere = warehouseId ? ` AND warehouse_id = ?` : '';
    if (warehouseId) activeParams.push(warehouseId);
    const activeChannelParams = [];
    const activeChannelClause = salesChannelWhere('s', filters.sales_channel, activeChannelParams);
    activeParams.push(...activeChannelParams);
    const activeCustomers = this.db
      .prepare(
        `
        SELECT COUNT(DISTINCT customer_id) as active_customers
        FROM ${salesTable} s
        WHERE customer_id IS NOT NULL
          AND ${completedStatusWhere(this.db, 's')}
          AND ${this._tzDateExpr('s.created_at')} BETWEEN date(?) AND date(?)
          ${activeWarehouseWhere}
          ${activeChannelClause}
      `
      )
      .get(...activeParams);

    const missingCost = hasItemsSource
      ? this.db
          .prepare(
            `
            SELECT COUNT(*) AS missing_cost_count
            FROM ${itemsTable} oi
            INNER JOIN ${salesTable} o ON o.${salesJoinCol} = oi.${orderJoinCol}
            WHERE ${completedStatusWhere(this.db, 'o')}
              AND ${orderDateExpr} BETWEEN date(?) AND date(?)
              AND ${posCartReturnExcludeWhere(this.db, 'o')}
              ${cogsWarehouseWhere}
              ${cogsChannelClause}
              AND (oi.cost_price IS NULL OR oi.cost_price = 0)
          `
          )
          .get(...cogsParams)
      : { missing_cost_count: 0 };
    const missingCostSamples = hasItemsSource
      ? this.db
          .prepare(
            `
            SELECT
              oi.source_item_id AS order_item_id,
              oi.source_order_id AS order_id,
              o.order_number,
              oi.product_id,
              COALESCE(oi.product_name, p.name, oi.product_id) AS product_name,
              o.created_at
            FROM ${itemsTable} oi
            INNER JOIN ${salesTable} o ON o.${salesJoinCol} = oi.${orderJoinCol}
            LEFT JOIN products p ON p.id = oi.product_id
            WHERE ${completedStatusWhere(this.db, 'o')}
              AND ${orderDateExpr} BETWEEN date(?) AND date(?)
              AND ${posCartReturnExcludeWhere(this.db, 'o')}
              ${cogsWarehouseWhere}
              ${cogsChannelClause}
              AND (oi.cost_price IS NULL OR oi.cost_price = 0)
            ORDER BY datetime(o.created_at) DESC
            LIMIT 5
          `
          )
          .all(...cogsParams)
      : [];

    const totalSales = Number(salesRow?.total_sales || 0) || 0;
    const totalCogs = Number(cogsRow?.total_cogs || 0) || 0;
    const soldRevenue = Number(cogsRow?.sold_revenue || 0) || 0;
    const totalProfit = soldRevenue > 0 ? soldRevenue - totalCogs : totalSales - totalCogs;
    const totalExpenses = Number(expensesRow?.total_expenses || 0) || 0;
    const totalCommission = sumPaymentFeesForPeriod(this.db, {
      dateFrom,
      dateTo,
      warehouseId,
      tzDateExpr: (col) => this._tzDateExpr(col),
    });
    const returnsAmount = (Number(returnsRow?.returns_amount || 0) || 0) + posCartReturnsAmount;
    const returnsCogs = (Number(returnsCogsRow?.returns_cogs || 0) || 0) + posCartReturnsCogs;
    const returnsCount = (Number(returnsRow?.returns_count || 0) || 0) + posCartReturnsCount;
    const netSales = Math.max(0, totalSales - returnsAmount);
    let customerAdvance = 0;
    try {
      if (this._hasTable('customers')) {
        const adv = this.db
          .prepare(
            `
            SELECT COALESCE(SUM(CASE WHEN balance > 0 THEN balance ELSE 0 END), 0) AS customer_advance
            FROM customers
            WHERE COALESCE(status, 'active') = 'active'
          `,
          )
          .get();
        customerAdvance = Number(adv?.customer_advance || 0) || 0;
      }
    } catch {
      customerAdvance = 0;
    }
    const netProfit = calculateNetProfit({
      grossProfit: totalProfit,
      returnsRevenue: returnsAmount,
      returnsCogs,
      expenses: totalExpenses,
      commission: totalCommission,
    });
    const profitMargin = totalSales > 0 ? (netProfit / totalSales) * 100 : 0;

    return {
      period: { date_from: dateFrom, date_to: dateTo },
      warehouse_id: warehouseId || null,
      total_sales: totalSales,
      total_sales_uzs: Number(salesRow?.total_sales_uzs ?? totalSales) || 0,
      total_sales_usd: Number(salesRow?.total_sales_usd || 0) || 0,
      total_collected: Number(salesRow?.total_collected || 0) || 0,
      credit_issued: Number(salesRow?.credit_issued || 0) || 0,
      customer_advance: customerAdvance,
      total_orders: Number(salesRow?.total_orders || 0) || 0,
      average_order_value: Number(salesRow?.average_order_value || 0) || 0,
      total_cogs: totalCogs,
      total_profit: totalProfit,
      net_sales: netSales,
      net_profit: netProfit,
      profit_margin: profitMargin,
      total_expenses: totalExpenses,
      total_commission: totalCommission,
      payment_fees: totalCommission,
      low_stock_count: lowStockCount,
      active_customers: Number(activeCustomers?.active_customers || 0) || 0,
      items_sold: Number(cogsRow?.items_sold || 0) || 0,
      returns_count: returnsCount,
      returns_amount: returnsAmount,
      returns_cogs: returnsCogs,
      pending_purchase_orders: 0,
      warnings: {
        missing_cost_count: Number(missingCost?.missing_cost_count || 0) || 0,
        cogs_missing: Number(missingCost?.missing_cost_count || 0) > 0,
        accounting_cogs_missing: Number(missingCost?.missing_cost_count || 0) > 0,
        missing_cost_samples: (missingCostSamples || []).map((r) => ({
          order_item_id: r.order_item_id,
          order_id: r.order_id,
          order_number: r.order_number,
          product_id: r.product_id,
          product_name: r.product_name,
          created_at: r.created_at,
        })),
        using_legacy_returns_table: returnsTable === 'sale_returns',
        expenses_filtered_by_warehouse: Boolean(hasExpenseWh),
      },
    };
  }
}

module.exports = DashboardService;

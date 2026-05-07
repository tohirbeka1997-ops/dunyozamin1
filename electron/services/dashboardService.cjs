const { ERROR_CODES, createError } = require('../lib/errors.cjs');
const {
  formatYmdInTimeZone,
  nowSqlInTimeZone,
  UZBEKISTAN_TZ_SQLITE_OFFSET,
} = require('../lib/timezone.cjs');

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

    // Today's sales
    const orderDateExpr = this._tzDateExpr('created_at');
    let salesQuery = `
      SELECT 
        COUNT(*) as today_orders,
        COALESCE(SUM(total_amount), 0) as today_sales,
        COALESCE(SUM(CASE WHEN payment_status = 'paid' THEN total_amount ELSE 0 END), 0) as today_revenue
      FROM orders
      WHERE ${orderDateExpr} = DATE(?)
        AND status = 'completed'
    `;
    params.push(today);

    const salesStats = this.db.prepare(salesQuery).get(today);

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
      FROM orders
      WHERE customer_id IS NOT NULL
        AND created_at >= datetime(?, '-30 days')
        AND status = 'completed'
    `;
    const activeCustomers = this.db.prepare(activeCustomersQuery).get(nowSqlInTimeZone());

    // Total revenue (all time paid orders)
    const totalRevenueQuery = `
      SELECT COALESCE(SUM(total_amount), 0) as total_revenue
      FROM orders
      WHERE status = 'completed'
        AND payment_status = 'paid'
    `;
    const totalRevenue = this.db.prepare(totalRevenueQuery).get();

    const totalProfit = this._hasTable('order_items')
      ? this.db.prepare(`
          SELECT COALESCE(SUM(oi.line_total) - SUM(
            CASE
              WHEN COALESCE(oi.cost_price, 0) > 0 THEN oi.cost_price * COALESCE(oi.quantity, 0)
              ELSE COALESCE(p.purchase_price, 0) * COALESCE(oi.quantity, 0)
            END
          ), 0) AS total_profit
          FROM order_items oi
          INNER JOIN orders o ON o.id = oi.order_id
          LEFT JOIN products p ON p.id = oi.product_id
          WHERE o.status = 'completed'
        `).get()
      : { total_profit: 0 };

    return {
      today_sales: salesStats?.today_sales || 0,
      today_orders: salesStats?.today_orders || 0,
      low_stock_count: lowStock?.low_stock_count || 0,
      active_customers: activeCustomers?.active_customers || 0,
      total_revenue: totalRevenue?.total_revenue || 0,
      total_profit: totalProfit?.total_profit || 0,
    };
  }

  /**
   * Dashboard analytics for a date range (used by Dashboard KPI cards)
   * filters: { date_from: 'YYYY-MM-DD', date_to: 'YYYY-MM-DD' }
   */
  getAnalytics(filters = {}) {
    const dateFrom = this._ymd(filters.date_from || new Date());
    const dateTo = this._ymd(filters.date_to || new Date());
    const orderDateExpr = this._tzDateExpr('o.created_at');
    const isAllWarehouses = String(filters.warehouse_id || '').toUpperCase() === 'ALL';
    const warehouseId = isAllWarehouses ? null : (filters.warehouse_id || null);

    // Orders/sales
    const salesParams = [dateFrom, dateTo];
    const salesWarehouseWhere = warehouseId ? ` AND o.warehouse_id = ?` : '';
    if (warehouseId) salesParams.push(warehouseId);
    const salesRow = this.db
      .prepare(
        `
        SELECT
          COUNT(*) AS total_orders,
          COALESCE(SUM(o.total_amount), 0) AS total_sales,
          COALESCE(AVG(o.total_amount), 0) AS average_order_value
        FROM orders o
        WHERE o.status = 'completed'
          AND ${orderDateExpr} BETWEEN date(?) AND date(?)
          ${salesWarehouseWhere}
      `
      )
      .get(...salesParams);

    // COGS: use order_items.cost_price; if 0/null, fallback to products.purchase_price
    const cogsParams = [dateFrom, dateTo];
    const cogsWarehouseWhere = warehouseId ? ` AND o.warehouse_id = ?` : '';
    if (warehouseId) cogsParams.push(warehouseId);
    const cogsRow = this._hasTable('order_items')
      ? this.db
          .prepare(
            `
            SELECT
              COALESCE(SUM(
                (COALESCE(NULLIF(oi.cost_price, 0), p.purchase_price) * COALESCE(oi.qty_base, oi.quantity, 0))
              ), 0) AS total_cogs,
              COALESCE(SUM(COALESCE(oi.qty_base, oi.quantity, 0)), 0) AS items_sold
            FROM order_items oi
            INNER JOIN orders o ON o.id = oi.order_id
            LEFT JOIN products p ON p.id = oi.product_id
            WHERE o.status = 'completed'
              AND ${orderDateExpr} BETWEEN date(?) AND date(?)
              ${cogsWarehouseWhere}
          `
          )
          .get(...cogsParams)
      : { total_cogs: 0, items_sold: 0 };

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
            SELECT COALESCE(SUM(e.amount), 0) AS total_expenses
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
    const returnDateExpr = this._tzDateExpr('r.created_at');
    const returnParams = [dateFrom, dateTo];
    const returnWarehouseWhere = warehouseId ? ` AND r.warehouse_id = ?` : '';
    if (warehouseId) returnParams.push(warehouseId);
    const returnsRow = returnsTable
      ? this.db
          .prepare(
            `
            SELECT
              COUNT(*) AS returns_count,
              COALESCE(SUM(COALESCE(r.refund_amount, r.total_amount, 0)), 0) AS returns_amount
            FROM ${returnsTable} r
            WHERE COALESCE(LOWER(status), 'completed') = 'completed'
              AND ${returnDateExpr} BETWEEN date(?) AND date(?)
              ${returnWarehouseWhere}
          `
          )
          .get(...returnParams)
      : { returns_count: 0, returns_amount: 0 };

    const returnItemsTable = returnsTable === 'sale_returns' ? 'sale_return_items' : 'return_items';
    const returnCogsParams = [dateFrom, dateTo];
    if (warehouseId) returnCogsParams.push(warehouseId);
    const returnsCogsRow =
      returnsTable && this._hasTable(returnItemsTable)
        ? this.db
            .prepare(
              `
              SELECT COALESCE(SUM(COALESCE(ri.qty_base, ri.quantity) *
                CASE
                  WHEN COALESCE(oi.cost_price, 0) > 0 THEN oi.cost_price
                  ELSE COALESCE(pr.purchase_price, 0)
                END
              ), 0) AS returns_cogs
              FROM ${returnItemsTable} ri
              INNER JOIN ${returnsTable} r ON r.id = ri.return_id
              LEFT JOIN order_items oi ON oi.id = ri.order_item_id
              LEFT JOIN products pr ON pr.id = ri.product_id
              WHERE COALESCE(LOWER(r.status), 'completed') = 'completed'
                AND ${returnDateExpr} BETWEEN date(?) AND date(?)
                ${returnWarehouseWhere}
            `
            )
            .get(...returnCogsParams)
        : { returns_cogs: 0 };

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
    const activeCustomers = this.db
      .prepare(
        `
        SELECT COUNT(DISTINCT customer_id) as active_customers
        FROM orders
        WHERE customer_id IS NOT NULL
          AND status = 'completed'
          AND ${this._tzDateExpr('created_at')} BETWEEN date(?) AND date(?)
          ${activeWarehouseWhere}
      `
      )
      .get(...activeParams);

    // Data quality: how many sold rows have missing/zero cost_price in selected slice
    const missingCost = this._hasTable('order_items')
      ? this.db
          .prepare(
            `
            SELECT COUNT(*) AS missing_cost_count
            FROM order_items oi
            INNER JOIN orders o ON o.id = oi.order_id
            WHERE o.status = 'completed'
              AND ${orderDateExpr} BETWEEN date(?) AND date(?)
              ${cogsWarehouseWhere}
              AND (oi.cost_price IS NULL OR oi.cost_price = 0)
          `
          )
          .get(...cogsParams)
      : { missing_cost_count: 0 };
    const missingCostSamples = this._hasTable('order_items')
      ? this.db
          .prepare(
            `
            SELECT
              oi.id AS order_item_id,
              oi.order_id,
              o.order_number,
              oi.product_id,
              COALESCE(oi.product_name, p.name, oi.product_id) AS product_name,
              o.created_at
            FROM order_items oi
            INNER JOIN orders o ON o.id = oi.order_id
            LEFT JOIN products p ON p.id = oi.product_id
            WHERE o.status = 'completed'
              AND ${orderDateExpr} BETWEEN date(?) AND date(?)
              ${cogsWarehouseWhere}
              AND (oi.cost_price IS NULL OR oi.cost_price = 0)
            ORDER BY datetime(o.created_at) DESC
            LIMIT 5
          `
          )
          .all(...cogsParams)
      : [];

    const totalSales = Number(salesRow?.total_sales || 0) || 0;
    const totalCogs = Number(cogsRow?.total_cogs || 0) || 0;
    const totalProfit = totalSales - totalCogs;
    const totalExpenses = Number(expensesRow?.total_expenses || 0) || 0;
    const returnsAmount = Number(returnsRow?.returns_amount || 0) || 0;
    const returnsCogs = Number(returnsCogsRow?.returns_cogs || 0) || 0;
    const netProfit = totalProfit - totalExpenses - returnsAmount + returnsCogs;
    const profitMargin = totalSales > 0 ? (netProfit / totalSales) * 100 : 0;

    return {
      period: { date_from: dateFrom, date_to: dateTo },
      warehouse_id: warehouseId || null,
      total_sales: totalSales,
      total_orders: Number(salesRow?.total_orders || 0) || 0,
      average_order_value: Number(salesRow?.average_order_value || 0) || 0,
      total_cogs: totalCogs,
      total_profit: totalProfit,
      net_profit: netProfit,
      profit_margin: profitMargin,
      total_expenses: totalExpenses,
      low_stock_count: lowStockCount,
      active_customers: Number(activeCustomers?.active_customers || 0) || 0,
      items_sold: Number(cogsRow?.items_sold || 0) || 0,
      returns_count: Number(returnsRow?.returns_count || 0) || 0,
      returns_amount: returnsAmount,
      returns_cogs: returnsCogs,
      pending_purchase_orders: 0,
      warnings: {
        missing_cost_count: Number(missingCost?.missing_cost_count || 0) || 0,
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

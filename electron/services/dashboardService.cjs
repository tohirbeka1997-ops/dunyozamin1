const { ERROR_CODES, createError } = require('../lib/errors.cjs');

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
    if (!input) return new Date().toISOString().slice(0, 10);
    if (typeof input === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input)) return input;
    const d = new Date(input);
    if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
    return d.toISOString().slice(0, 10);
  }

  /**
   * Get dashboard statistics
   */
  getStats(filters = {}) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const params = [];

    // Today's sales
    let salesQuery = `
      SELECT 
        COUNT(*) as today_orders,
        COALESCE(SUM(total_amount), 0) as today_sales,
        COALESCE(SUM(CASE WHEN payment_status = 'paid' THEN total_amount ELSE 0 END), 0) as today_revenue
      FROM orders
      WHERE DATE(created_at) = DATE(?)
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
        AND created_at >= datetime('now', '-30 days')
        AND status = 'completed'
    `;
    const activeCustomers = this.db.prepare(activeCustomersQuery).get();

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

    // Orders/sales
    const salesRow = this.db
      .prepare(
        `
        SELECT
          COUNT(*) AS total_orders,
          COALESCE(SUM(o.total_amount), 0) AS total_sales,
          COALESCE(AVG(o.total_amount), 0) AS average_order_value
        FROM orders o
        WHERE o.status = 'completed'
          AND date(o.created_at) BETWEEN date(?) AND date(?)
      `
      )
      .get(dateFrom, dateTo);

    // COGS: use order_items.cost_price; if 0/null, fallback to products.purchase_price
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
              AND date(o.created_at) BETWEEN date(?) AND date(?)
          `
          )
          .get(dateFrom, dateTo)
      : { total_cogs: 0, items_sold: 0 };

    // Expenses
    const expensesRow = this._hasTable('expenses')
      ? this.db
          .prepare(
            `
            SELECT COALESCE(SUM(e.amount), 0) AS total_expenses
            FROM expenses e
            WHERE COALESCE(LOWER(e.status), 'approved') = 'approved'
              AND date(COALESCE(e.expense_date, e.created_at)) BETWEEN date(?) AND date(?)
          `
          )
          .get(dateFrom, dateTo)
      : { total_expenses: 0 };

    // Returns (optional)
    const returnsRow = this._hasTable('sales_returns')
      ? this.db
          .prepare(
            `
            SELECT
              COUNT(*) AS returns_count,
              COALESCE(SUM(total_amount), 0) AS returns_amount
            FROM sales_returns
            WHERE COALESCE(LOWER(status), 'completed') = 'completed'
              AND date(created_at) BETWEEN date(?) AND date(?)
          `
          )
          .get(dateFrom, dateTo)
      : { returns_count: 0, returns_amount: 0 };

    // Low stock count (optional)
    let lowStockCount = 0;
    if (this._hasTable('products') && this._hasTable('stock_balances')) {
      const low = this.db
        .prepare(
          `
          SELECT COUNT(DISTINCT p.id) as low_stock_count
          FROM products p
          INNER JOIN stock_balances sb ON p.id = sb.product_id
          WHERE p.is_active = 1
            AND sb.quantity <= p.min_stock_level
            AND sb.quantity > 0
        `
        )
        .get();
      lowStockCount = Number(low?.low_stock_count || 0) || 0;
    }

    // Active customers count
    const activeCustomers = this.db
      .prepare(
        `
        SELECT COUNT(DISTINCT customer_id) as active_customers
        FROM orders
        WHERE customer_id IS NOT NULL
          AND status = 'completed'
          AND date(created_at) BETWEEN date(?) AND date(?)
      `
      )
      .get(dateFrom, dateTo);

    const totalSales = Number(salesRow?.total_sales || 0) || 0;
    const totalCogs = Number(cogsRow?.total_cogs || 0) || 0;
    const totalProfit = totalSales - totalCogs;
    const profitMargin = totalSales > 0 ? (totalProfit / totalSales) * 100 : 0;

    return {
      period: { date_from: dateFrom, date_to: dateTo },
      total_sales: totalSales,
      total_orders: Number(salesRow?.total_orders || 0) || 0,
      average_order_value: Number(salesRow?.average_order_value || 0) || 0,
      total_cogs: totalCogs,
      total_profit: totalProfit,
      profit_margin: profitMargin,
      total_expenses: Number(expensesRow?.total_expenses || 0) || 0,
      low_stock_count: lowStockCount,
      active_customers: Number(activeCustomers?.active_customers || 0) || 0,
      items_sold: Number(cogsRow?.items_sold || 0) || 0,
      returns_count: Number(returnsRow?.returns_count || 0) || 0,
      returns_amount: Number(returnsRow?.returns_amount || 0) || 0,
      pending_purchase_orders: 0,
    };
  }
}

module.exports = DashboardService;

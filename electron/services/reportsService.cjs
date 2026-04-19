const { ERROR_CODES, createError } = require('../lib/errors.cjs');

/**
 * Reports Service
 * Provides aggregated reporting queries for dashboard and reporting pages.
 */
class ReportsService {
  constructor(db) {
    this.db = db;
    this._tables = null;
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
    if (!this._hasTable('order_items') || !this._hasTable('orders')) return;
    try {
      const countRow = this.db
        .prepare(
          `
          SELECT COUNT(*) AS missing_count
          FROM order_items oi
          INNER JOIN orders o ON o.id = oi.order_id
          ${whereClause}
            AND oi.cost_price IS NULL
        `
        )
        .get(params);
      const missingCount = Number(countRow?.missing_count || 0) || 0;
      if (missingCount > 0) {
        const sample = this.db
          .prepare(
            `
            SELECT oi.id, oi.order_id
            FROM order_items oi
            INNER JOIN orders o ON o.id = oi.order_id
            ${whereClause}
              AND oi.cost_price IS NULL
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
    if (!date) return new Date().toISOString().slice(0, 10);
    // Accept 'YYYY-MM-DD' or ISO-ish strings
    if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
    const d = new Date(date);
    if (Number.isNaN(d.getTime())) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, `Invalid date: ${date}`);
    }
    return d.toISOString().slice(0, 10);
  }

  _bucketAgeDays(ageDays) {
    const d = Number(ageDays);
    if (!Number.isFinite(d) || d < 0) return '0_7';
    if (d <= 7) return '0_7';
    if (d <= 30) return '8_30';
    if (d <= 60) return '31_60';
    return '60_plus';
  }

  _initBuckets() {
    return { _0_7: 0, _8_30: 0, _31_60: 0, _60_plus: 0, total: 0 };
  }

  _addToBuckets(buckets, ageKey, amount) {
    const a = Number(amount) || 0;
    if (a <= 0) return buckets;
    buckets.total += a;
    if (ageKey === '0_7') buckets._0_7 += a;
    else if (ageKey === '8_30') buckets._8_30 += a;
    else if (ageKey === '31_60') buckets._31_60 += a;
    else buckets._60_plus += a;
    return buckets;
  }

  /**
   * Daily sales summary for a specific date.
   * @param {string} date - YYYY-MM-DD
   * @param {string=} warehouseId
   */
  getDailySales(date, warehouseId) {
    const ymd = this._ymd(date);
    const params = [ymd];
    let where = `WHERE o.status = 'completed' AND date(o.created_at) = date(?)`;
    if (warehouseId) {
      where += ` AND o.warehouse_id = ?`;
      params.push(warehouseId);
    }

    const summary = this.db
      .prepare(
        `
        SELECT
          COUNT(*) AS order_count,
          COALESCE(SUM(o.total_amount), 0) AS total_sales,
          COALESCE(SUM(o.discount_amount), 0) AS total_discount,
          COALESCE(SUM(o.tax_amount), 0) AS total_tax
        FROM orders o
        ${where}
      `
      )
      .get(params);

    // Payment breakdown (if payments table present)
    const paymentBreakdown = this._hasTable('payments')
      ? this.db
          .prepare(
            `
            SELECT
              p.payment_method,
              COALESCE(SUM(p.amount), 0) AS amount
            FROM payments p
            INNER JOIN orders o ON o.id = p.order_id
            ${where}
            GROUP BY p.payment_method
          `
          )
          .all(params)
      : [];

    return {
      date: ymd,
      warehouse_id: warehouseId || null,
      total_sales: Number(summary?.total_sales || 0) || 0,
      order_count: Number(summary?.order_count || 0) || 0,
      total_discount: Number(summary?.total_discount || 0) || 0,
      total_tax: Number(summary?.total_tax || 0) || 0,
      payments: paymentBreakdown,
    };
  }

  /**
   * Top products by revenue within a date range.
   * filters: { date_from?, date_to?, warehouse_id?, limit? }
   */
  getTopProducts(filters = {}) {
    const dateFrom = filters.date_from ? this._ymd(filters.date_from) : null;
    const dateTo = filters.date_to ? this._ymd(filters.date_to) : null;
    const limit = Number.isFinite(Number(filters.limit)) ? Number(filters.limit) : 10;

    const params = [];
    let where = `WHERE o.status = 'completed'`;
    if (filters.warehouse_id) {
      where += ` AND o.warehouse_id = ?`;
      params.push(filters.warehouse_id);
    }
    if (dateFrom) {
      where += ` AND date(o.created_at) >= date(?)`;
      params.push(dateFrom);
    }
    if (dateTo) {
      where += ` AND date(o.created_at) <= date(?)`;
      params.push(dateTo);
    }

    const rows = this.db
      .prepare(
        `
        SELECT
          oi.product_id,
          oi.product_name,
          COALESCE(SUM(oi.quantity), 0) AS quantity_sold,
          COALESCE(SUM(oi.line_total), 0) AS total_amount
        FROM order_items oi
        INNER JOIN orders o ON o.id = oi.order_id
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
    const dateFrom = filters.date_from ? this._ymd(filters.date_from) : null;
    const dateTo = filters.date_to ? this._ymd(filters.date_to) : null;
    const promotionId = filters.promotion_id || null;

    let where = '1=1';
    const params = [];
    if (dateFrom) {
      where += ' AND date(pu.applied_at) >= date(?)';
      params.push(dateFrom);
    }
    if (dateTo) {
      where += ' AND date(pu.applied_at) <= date(?)';
      params.push(dateTo);
    }
    if (promotionId) {
      where += ' AND pu.promotion_id = ?';
      params.push(promotionId);
    }

    const rows = this.db
      .prepare(
        `
      SELECT pu.promotion_id, p.name as promotion_name, p.type as promotion_type,
             COUNT(*) as usage_count, COALESCE(SUM(pu.discount_amount), 0) as total_discount
      FROM promotion_usage pu
      LEFT JOIN promotions p ON p.id = pu.promotion_id
      WHERE ${where}
      GROUP BY pu.promotion_id
      ORDER BY total_discount DESC
    `
      )
      .all(...params);
    return rows;
  }

  getProductSalesReport(filters = {}) {
    const dateFrom = filters.date_from ? this._ymd(filters.date_from) : null;
    const dateTo = filters.date_to ? this._ymd(filters.date_to) : null;
    const categoryId = filters.category_id || null;
    const priceTier = filters.price_tier || null;

    const hasOrderItemsPriceTier = (() => {
      try {
        return !!this.db
          .prepare(`SELECT 1 AS ok FROM pragma_table_info('order_items') WHERE name = 'price_tier' LIMIT 1`)
          .get()?.ok;
      } catch {
        return false;
      }
    })();

    const params = [];
    let where = `WHERE o.status = 'completed'`;

    if (filters.warehouse_id) {
      where += ` AND o.warehouse_id = ?`;
      params.push(filters.warehouse_id);
    }
    if (dateFrom) {
      where += ` AND date(o.created_at) >= date(?)`;
      params.push(dateFrom);
    }
    if (dateTo) {
      where += ` AND date(o.created_at) <= date(?)`;
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

    // NOTE:
    // - order_items.cost_price is treated as unit cost (per unit). If it's null, fallback to 0.
    // - revenue uses order_items.line_total.
    const rows = this.db
      .prepare(
        `
        SELECT
          oi.product_id,
          COALESCE(p.name, oi.product_name, '') AS product_name,
          COALESCE(p.sku, '') AS sku,
          COALESCE(c.name, '') AS category_name,
          COALESCE(SUM(oi.quantity), 0) AS quantity_sold,
          COALESCE(SUM(oi.line_total), 0) AS revenue,
          ${
            hasOrderItemsPriceTier
              ? `COALESCE(SUM(CASE WHEN COALESCE(oi.price_tier, 'retail') = 'master' THEN COALESCE(oi.line_total, 0) ELSE 0 END), 0) AS master_revenue,`
              : `0 AS master_revenue,`
          }
          ${
            hasOrderItemsPriceTier
              ? `COALESCE(SUM(CASE WHEN COALESCE(oi.price_tier, 'retail') != 'master' THEN COALESCE(oi.line_total, 0) ELSE 0 END), 0) AS retail_revenue,`
              : `COALESCE(SUM(oi.line_total), 0) AS retail_revenue,`
          }
          COALESCE(SUM(
            CASE
              WHEN COALESCE(oi.cost_price, 0) > 0 THEN oi.cost_price * COALESCE(oi.quantity, 0)
              ELSE COALESCE(p.purchase_price, 0) * COALESCE(oi.quantity, 0)
            END
          ), 0) AS cost
        FROM order_items oi
        INNER JOIN orders o ON o.id = oi.order_id
        LEFT JOIN products p ON p.id = oi.product_id
        LEFT JOIN categories c ON c.id = p.category_id
        ${where}
        GROUP BY oi.product_id, product_name, sku, category_name
        ORDER BY revenue DESC, quantity_sold DESC
      `
      )
      .all(params);

    this._logMissingCostPrice(where, params, 'product_sales_report');

    return (rows || []).map((r) => {
      const revenue = Number(r.revenue || 0) || 0;
      const retailRevenue = Number(r.retail_revenue || 0) || 0;
      const masterRevenue = Number(r.master_revenue || 0) || 0;
      const cost = Number(r.cost || 0) || 0;
      const profit = revenue - cost;
      const profitMargin = revenue > 0 ? (profit / revenue) * 100 : 0;
      return {
        product_id: r.product_id,
        product_name: r.product_name,
        sku: r.sku,
        category_name: r.category_name,
        quantity_sold: Number(r.quantity_sold || 0) || 0,
        revenue,
        retail_revenue: retailRevenue,
        master_revenue: masterRevenue,
        cost,
        profit,
        profit_margin: profitMargin,
      };
    });
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
   * filters: { warehouse_id: string, status?: 'active'|'inactive'|'all' }
   */
  getInventoryValuation(filters = {}) {
    const warehouseId = filters.warehouse_id;
    if (!warehouseId) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'warehouse_id is required');
    }
    if (!this._hasTable('products') || !this._hasTable('stock_balances')) {
      return [];
    }

    const fifoEnabled = this._isTruthySetting('inventory.fifo_enabled');
    const hasBatches = this._hasTable('inventory_batches');
    const useFifo = fifoEnabled && hasBatches;

    const statusFilter = filters.status || 'active';
    const statusWhere =
      statusFilter === 'inactive'
        ? `AND p.is_active = 0`
        : statusFilter === 'all'
          ? `AND 1=1`
          : `AND p.is_active = 1`;

    if (useFifo) {
      return this.db
        .prepare(
          `
          WITH batch_costs AS (
            SELECT
              product_id,
              warehouse_id,
              SUM(remaining_qty) AS remaining_qty,
              SUM(remaining_qty * COALESCE(cost_price_uzs, unit_cost, 0)) AS remaining_value
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
            COALESCE(
              CASE WHEN bc.remaining_qty > 0 THEN (bc.remaining_value / bc.remaining_qty) ELSE NULL END,
              NULLIF(p.purchase_price, 0)
            ) AS unit_cost,
            COALESCE(sb.quantity, 0) * COALESCE(
              CASE WHEN bc.remaining_qty > 0 THEN (bc.remaining_value / bc.remaining_qty) ELSE NULL END,
              NULLIF(p.purchase_price, 0),
              0
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

    return this.db
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
          p.id AS product_id,
          p.name AS product_name,
          p.sku AS product_sku,
          p.category_id,
          c.name AS category_name,
          COALESCE(p.min_stock_level, 0) AS min_stock_level,
          COALESCE(sb.quantity, 0) AS current_stock,
          COALESCE(
            CASE WHEN rc.qty > 0 THEN (rc.cost_uzs / rc.qty) ELSE NULL END,
            NULLIF(p.purchase_price, 0)
          ) AS unit_cost,
          COALESCE(sb.quantity, 0) * COALESCE(
            (rc.cost_uzs / NULLIF(rc.qty, 0)),
            NULLIF(p.purchase_price, 0),
            0
          ) AS stock_value
        FROM products p
        LEFT JOIN categories c ON c.id = p.category_id
        LEFT JOIN stock_balances sb ON sb.product_id = p.id AND sb.warehouse_id = ?
        LEFT JOIN receipt_costs rc ON rc.product_id = p.id AND rc.warehouse_id = ?
        WHERE 1=1
          ${statusWhere}
        ORDER BY p.name ASC
      `
      )
      .all(warehouseId, warehouseId, warehouseId);
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
    const warnings = this.validateAccountingConsistency({ warehouse_id: filters.warehouse_id });
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
    if (filters.warehouse_id) {
      where += ` AND r.warehouse_id = ?`;
      params.push(filters.warehouse_id);
    }
    if (dateFrom) {
      where += ` AND date(r.created_at) >= date(?)`;
      params.push(dateFrom);
    }
    if (dateTo) {
      where += ` AND date(r.created_at) <= date(?)`;
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

    const params = [];
    let where = `WHERE o.status = 'completed'`;
    if (filters.warehouse_id) {
      where += ` AND o.warehouse_id = ?`;
      params.push(filters.warehouse_id);
    }
    if (dateFrom) {
      where += ` AND date(o.created_at) >= date(?)`;
      params.push(dateFrom);
    }
    if (dateTo) {
      where += ` AND date(o.created_at) <= date(?)`;
      params.push(dateTo);
    }

    const revenueRow = this.db
      .prepare(
        `
        SELECT
          COALESCE(SUM(oi.line_total), 0) AS revenue
        FROM order_items oi
        INNER JOIN orders o ON o.id = oi.order_id
        ${where}
      `
      )
      .get(params);

    const revenue = Number(revenueRow?.revenue || 0) || 0;

    const cogsRow = this.db
      .prepare(
        `
        SELECT
          COALESCE(SUM(
            CASE
              WHEN COALESCE(oi.cost_price, 0) > 0 THEN oi.cost_price * COALESCE(oi.quantity, 0)
              ELSE COALESCE(pr.purchase_price, 0) * COALESCE(oi.quantity, 0)
            END
          ), 0) AS cogs
        FROM order_items oi
        INNER JOIN orders o ON o.id = oi.order_id
        LEFT JOIN products pr ON pr.id = oi.product_id
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
    };
  }

  /**
   * Profit & Loss (SQL-driven).
   * filters: { date_from?, date_to?, warehouse_id?, price_tier_id? }
   */
  getProfitAndLossSQL(filters = {}) {
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
    let where = `WHERE o.status = 'completed'`;
    if (warehouseId) {
      where += ` AND o.warehouse_id = ?`;
      params.push(warehouseId);
    }
    if (dateFrom) {
      where += ` AND date(o.created_at) >= date(?)`;
      params.push(dateFrom);
    }
    if (dateTo) {
      where += ` AND date(o.created_at) <= date(?)`;
      params.push(dateTo);
    }
    if (priceTierId != null && hasPriceTierId) {
      where += ` AND o.price_tier_id = ?`;
      params.push(priceTierId);
    }

    const summaryParams = params.concat(params);
    const summary = this.db
      .prepare(
        `
        WITH order_items_agg AS (
          SELECT
            oi.order_id,
            SUM(oi.line_total) AS revenue,
            SUM(
              CASE
                WHEN COALESCE(oi.cost_price, 0) > 0 THEN oi.cost_price * COALESCE(oi.quantity, 0)
                ELSE COALESCE(pr.purchase_price, 0) * COALESCE(oi.quantity, 0)
              END
            ) AS cogs
          FROM order_items oi
          INNER JOIN orders o ON o.id = oi.order_id
          LEFT JOIN products pr ON pr.id = oi.product_id
          ${where}
          GROUP BY oi.order_id
        )
        SELECT
          COALESCE(SUM(a.revenue), 0) AS revenue,
          COALESCE(SUM(a.cogs), 0) AS cogs,
          COALESCE(SUM(o.discount_amount), 0) AS discount,
          COUNT(DISTINCT o.id) AS orders_count
        FROM orders o
        LEFT JOIN order_items_agg a ON a.order_id = o.id
        ${where}
      `
      )
      .get(summaryParams);

    const returnsTable = this._hasTable('sale_returns')
      ? 'sale_returns'
      : this._hasTable('sales_returns')
        ? 'sales_returns'
        : null;

    let returnsRevenue = 0;
    let returnsCogs = 0;
    if (returnsTable) {
      const returnsParams = [];
      let returnsWhere = `WHERE LOWER(COALESCE(r.status, '')) = 'completed'`;
      if (warehouseId) {
        returnsWhere += ` AND r.warehouse_id = ?`;
        returnsParams.push(warehouseId);
      }
      if (dateFrom) {
        returnsWhere += ` AND date(r.created_at) >= date(?)`;
        returnsParams.push(dateFrom);
      }
      if (dateTo) {
        returnsWhere += ` AND date(r.created_at) <= date(?)`;
        returnsParams.push(dateTo);
      }
      if (priceTierId != null && hasPriceTierId) {
        returnsWhere += ` AND o.price_tier_id = ?`;
        returnsParams.push(priceTierId);
      }

      const revRow = this.db
        .prepare(
          `
          SELECT COALESCE(SUM(r.total_amount), 0) AS returns_revenue
          FROM ${returnsTable} r
          LEFT JOIN orders o ON o.id = r.order_id
          ${returnsWhere}
        `
        )
        .get(returnsParams);
      returnsRevenue = Number(revRow?.returns_revenue || 0) || 0;

      if (this._hasTable('return_items')) {
        const cogsRow = this.db
          .prepare(
            `
            SELECT COALESCE(SUM(ri.quantity *
              CASE
                WHEN COALESCE(oi.cost_price, 0) > 0 THEN oi.cost_price
                ELSE COALESCE(pr.purchase_price, 0)
              END
            ), 0) AS returns_cogs
            FROM return_items ri
            INNER JOIN ${returnsTable} r ON r.id = ri.return_id
            INNER JOIN order_items oi ON oi.id = ri.order_item_id
            LEFT JOIN products pr ON pr.id = oi.product_id
            LEFT JOIN orders o ON o.id = r.order_id
            ${returnsWhere}
          `
          )
          .get(returnsParams);
        returnsCogs = Number(cogsRow?.returns_cogs || 0) || 0;
      }
    }

    const expensesRow = this._hasTable('expenses')
      ? this.db
          .prepare(
            `
            SELECT COALESCE(SUM(e.amount), 0) AS total_expenses
            FROM expenses e
            WHERE COALESCE(LOWER(e.status), 'approved') = 'approved'
              ${dateFrom ? `AND date(COALESCE(e.expense_date, e.created_at)) >= date(?)` : ''}
              ${dateTo ? `AND date(COALESCE(e.expense_date, e.created_at)) <= date(?)` : ''}
          `
          )
          .get([...(!dateFrom ? [] : [dateFrom]), ...(!dateTo ? [] : [dateTo])])
      : { total_expenses: 0 };

    const warnings = this.validateAccountingConsistency({
      warehouse_id: warehouseId,
      date_from: dateFrom,
      date_to: dateTo,
    });

    const revenue = Number(summary?.revenue || 0) || 0;
    const discount = Number(summary?.discount || 0) || 0;
    const cogs = Number(summary?.cogs || 0) || 0;
    const ordersCount = Number(summary?.orders_count || 0) || 0;
    const netSales = revenue - discount;
    const grossProfit = netSales - cogs;
    const totalExpenses = Number(expensesRow?.total_expenses || 0) || 0;
    const netProfit = grossProfit - returnsRevenue + returnsCogs - totalExpenses;
    const profitMargin = netSales > 0 ? (grossProfit / netSales) * 100 : 0;
    const returnRate = revenue > 0 ? (returnsRevenue / revenue) * 100 : 0;
    const avgOrderValue = ordersCount > 0 ? netSales / ordersCount : 0;

    const dailyRows = this.db
      .prepare(
        `
        WITH orders_in_range AS (
          SELECT o.id, o.created_at, o.discount_amount
          FROM orders o
          ${where}
        ),
        items_agg AS (
          SELECT
            oi.order_id,
            SUM(oi.line_total) AS revenue,
            SUM(
              CASE
                WHEN COALESCE(oi.cost_price, 0) > 0 THEN oi.cost_price * COALESCE(oi.quantity, 0)
                ELSE COALESCE(pr.purchase_price, 0) * COALESCE(oi.quantity, 0)
              END
            ) AS cogs
          FROM order_items oi
          INNER JOIN orders_in_range o ON o.id = oi.order_id
          LEFT JOIN products pr ON pr.id = oi.product_id
          GROUP BY oi.order_id
        )
        SELECT
          date(o.created_at) AS day,
          COALESCE(SUM(a.revenue), 0) AS revenue,
          COALESCE(SUM(a.cogs), 0) AS cogs,
          COALESCE(SUM(o.discount_amount), 0) AS discount
        FROM orders_in_range o
        LEFT JOIN items_agg a ON a.order_id = o.id
        GROUP BY date(o.created_at)
        ORDER BY day ASC
      `
      )
      .all(params);

    const series = (dailyRows || []).map((r) => {
      const dayRevenue = Number(r.revenue || 0) || 0;
      const dayDiscount = Number(r.discount || 0) || 0;
      const dayCogs = Number(r.cogs || 0) || 0;
      const dayNetSales = dayRevenue - dayDiscount;
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
        discount,
        net_sales: netSales,
        cogs,
        gross_profit: grossProfit,
        returns_revenue: returnsRevenue,
        returns_cogs: returnsCogs,
        expenses: totalExpenses,
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
    if (dateFrom) {
      where += ` AND date(o.created_at) >= date(?)`;
      params.push(dateFrom);
    }
    if (dateTo) {
      where += ` AND date(o.created_at) <= date(?)`;
      params.push(dateTo);
    }
    if (cashierId) {
      where += ` AND COALESCE(o.user_id, o.cashier_id) = ?`;
      params.push(cashierId);
    }
    if (status) {
      where += ` AND o.status = ?`;
      params.push(status);
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
    if (priceTierId != null && hasPriceTierId) {
      where += ` AND o.price_tier_id = ?`;
      params.push(priceTierId);
    }

    const paymentExpr = hasPaymentType
      ? `COALESCE(pm.payment_method, o.payment_type, 'n/a')`
      : `COALESCE(pm.payment_method, 'n/a')`;

    const orders = this.db
      .prepare(
        `
        WITH items_agg AS (
          SELECT
            oi.order_id,
            SUM(oi.line_total) AS revenue,
            SUM(
              CASE
                WHEN COALESCE(oi.cost_price, 0) > 0 THEN oi.cost_price * COALESCE(oi.quantity, 0)
                ELSE COALESCE(pr.purchase_price, 0) * COALESCE(oi.quantity, 0)
              END
            ) AS cogs
          FROM order_items oi
          LEFT JOIN products pr ON pr.id = oi.product_id
          GROUP BY oi.order_id
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
          o.id,
          o.order_number,
          o.created_at,
          o.status,
          o.total_amount,
          o.cashier_id,
          o.user_id,
          o.customer_id,
          o.warehouse_id,
          o.price_tier_id,
          COALESCE(u.full_name, u.username, p.full_name, p.username, o.cashier_id) AS cashier_name,
          ${paymentExpr} AS payment_method,
          COALESCE(a.revenue, 0) AS revenue,
          COALESCE(a.cogs, 0) AS cogs,
          COALESCE(a.revenue, 0) - COALESCE(a.cogs, 0) AS profit
        FROM orders o
        LEFT JOIN items_agg a ON a.order_id = o.id
        LEFT JOIN pay_methods pm ON pm.order_id = o.id
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

    const completed = orders.filter((o) => String(o.status || '') === 'completed');
    const totalSales = completed.reduce((sum, o) => sum + Number(o.revenue || 0), 0);
    const totalProfit = completed.reduce((sum, o) => sum + Number(o.profit || 0), 0);
    const avgOrderValue = completed.length > 0 ? totalSales / completed.length : 0;

    const returnsTable = this._hasTable('sale_returns')
      ? 'sale_returns'
      : this._hasTable('sales_returns')
        ? 'sales_returns'
        : null;

    let returnsTotal = 0;
    let returnsProfitImpact = 0;
    let returnRows = [];
    if (returnsTable) {
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
      if (dateFrom) {
        returnsWhere += ` AND date(r.created_at) >= date(?)`;
        returnsParams.push(dateFrom);
      }
      if (dateTo) {
        returnsWhere += ` AND date(r.created_at) <= date(?)`;
        returnsParams.push(dateTo);
      }
      if (cashierId && returnCashierExpr) {
        returnsWhere += ` AND ${returnCashierExpr} = ?`;
        returnsParams.push(cashierId);
      }
      if (warehouseId) {
        returnsWhere += ` AND r.warehouse_id = ?`;
        returnsParams.push(warehouseId);
      }
      if (priceTierId != null && hasPriceTierId) {
        returnsWhere += ` AND o.price_tier_id = ?`;
        returnsParams.push(priceTierId);
      }

      const returnsRow = this.db
        .prepare(
          `
          SELECT COALESCE(SUM(r.total_amount), 0) AS total_returns
          FROM ${returnsTable} r
          LEFT JOIN orders o ON o.id = r.order_id
          ${returnsWhere}
        `
        )
        .get(returnsParams);
      returnsTotal = Number(returnsRow?.total_returns || 0) || 0;

      if (this._hasTable('return_items')) {
        const impactRow = this.db
          .prepare(
            `
            SELECT
              COALESCE(SUM(ri.line_total - (ri.quantity *
                CASE
                  WHEN COALESCE(oi.cost_price, 0) > 0 THEN oi.cost_price
                  ELSE COALESCE(pr.purchase_price, 0)
                END
              )), 0) AS profit_impact
            FROM return_items ri
            INNER JOIN ${returnsTable} r ON r.id = ri.return_id
            INNER JOIN order_items oi ON oi.id = ri.order_item_id
            LEFT JOIN products pr ON pr.id = oi.product_id
            LEFT JOIN orders o ON o.id = r.order_id
            ${returnsWhere}
          `
          )
          .get(returnsParams);
        returnsProfitImpact = Number(impactRow?.profit_impact || 0) || 0;
      }

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

    return {
      filters: { date_from: dateFrom, date_to: dateTo, cashier_id: cashierId, payment_method: paymentMethod, status, warehouse_id: warehouseId, price_tier_id: priceTierId },
      orders,
      summary: {
        total_sales: totalSales,
        total_profit: totalProfit,
        total_returns: returnsTotal,
        returns_profit_impact: returnsProfitImpact,
        avg_order_value: avgOrderValue,
      },
      returns: returnRows,
      warnings,
    };
  }

  getDailySalesSummary(filters = {}) {
    const report = this.getDailySalesReportSQL(filters);
    return { filters: report.filters, summary: report.summary };
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

    const rows = this.db
      .prepare(
        `
        WITH
          m AS (
            SELECT product_id, warehouse_id, COALESCE(SUM(quantity), 0) AS stock_from_movements
            FROM inventory_movements
            GROUP BY product_id, warehouse_id
          ),
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
      .all(params);

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
    if (!this._hasTable('inventory_batches') || !this._hasTable('inventory_batch_allocations')) {
      return [];
    }

    const params = [];
    let where = `WHERE p.is_active = 1`;
    if (filters.category_id) {
      where += ` AND p.category_id = ?`;
      params.push(filters.category_id);
    }

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
          ),
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
          )
        SELECT
          p.id AS product_id,
          p.name AS product_name,
          p.sku AS product_sku,
          COALESCE(c.name, '') AS category_name,
          COALESCE(pu.total_purchased_qty, 0) AS total_purchased_qty,
          COALESCE(
            CASE WHEN COALESCE(sb.total_sold_qty, 0) > 0 THEN sb.total_sold_qty ELSE so.total_sold_qty END,
            0
          ) AS total_sold_qty,
          COALESCE(pu.remaining_qty, 0) AS remaining_qty,
          COALESCE(pu.total_purchased_cost, 0) AS total_purchased_cost,
          COALESCE(r.total_sold_revenue, 0) AS total_sold_revenue,
          (COALESCE(r.total_sold_revenue, 0) - COALESCE(
            CASE WHEN COALESCE(sb.total_cogs, 0) > 0 THEN sb.total_cogs ELSE so.total_cogs END,
            0
          )) AS total_profit,
          CASE
            WHEN COALESCE(r.total_sold_revenue, 0) > 0
            THEN ((COALESCE(r.total_sold_revenue, 0) - COALESCE(
              CASE WHEN COALESCE(sb.total_cogs, 0) > 0 THEN sb.total_cogs ELSE so.total_cogs END,
              0
            )) / COALESCE(r.total_sold_revenue, 1)) * 100
            ELSE 0
          END AS profit_margin
        FROM products p
        LEFT JOIN categories c ON c.id = p.category_id
        LEFT JOIN purchased pu ON pu.product_id = p.id
        LEFT JOIN sold_batch sb ON sb.product_id = p.id
        LEFT JOIN sold_orders so ON so.product_id = p.id
        LEFT JOIN revenue r ON r.product_id = p.id
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
   * Customer Act Sverka (full customer account statement)
   * Answers: bitta mijoz bo‘yicha nima/qancha/qachon/qanday.
   *
   * filters: { customer_id: string, date_from?: YYYY-MM-DD, date_to?: YYYY-MM-DD }
   *
   * Returns:
   * {
   *   customer: { id, name, phone, balance },
   *   period: { date_from, date_to },
   *   opening_balance,
   *   closing_balance,
   *   totals: { in_amount, out_amount, net_amount },
   *   rows: [{ id, created_at, type, ref_no, amount, in_amount, out_amount, balance_after, method, note, created_by, created_by_name }]
   * }
   */
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
              AND datetime(created_at) < datetime(?)
            ORDER BY datetime(created_at) DESC
            LIMIT 1
          `
          )
          .get(customerId, `${dateFrom} 00:00:00`);
        openingBalance = Number(ob?.balance_after ?? 0) || 0;
      }

      const params = [customerId];
      let where = `WHERE cl.customer_id = ?`;
      if (dateFrom) {
        where += ` AND date(cl.created_at) >= date(?)`;
        params.push(dateFrom);
      }
      if (dateTo) {
        where += ` AND date(cl.created_at) <= date(?)`;
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
      String(supplier.settlement_currency || 'USD').toUpperCase() === 'USD' ? 'USD' : 'UZS';
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
            AND date(paid_at) < date(?)
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
      payDateWhere.push(`date(sp.paid_at) >= date(?)`);
      params.push(dateFrom);
    }
    if (dateTo) {
      poDateWhere.push(`date(po.order_date) <= date(?)`);
      payDateWhere.push(`date(sp.paid_at) <= date(?)`);
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
    const hasReturns = this._hasTable('sale_returns') && this._hasTable('sale_return_items');
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

    // Sales returns (customer -> warehouse)
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
        FROM sale_return_items sri
        INNER JOIN sale_returns sr ON sr.id = sri.return_id
        LEFT JOIN customers c ON c.id = sr.customer_id
        WHERE sri.product_id = ?
          AND sr.status = 'completed'
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
  getCashFlow(filters = {}) {
    const granularity = filters.granularity === 'week' ? 'week' : 'day';
    const dateFrom = filters.date_from ? this._ymd(filters.date_from) : null;
    const dateTo = filters.date_to ? this._ymd(filters.date_to) : null;

    const hasPayments = this._hasTable('payments');
    const hasCustomerPayments = this._hasTable('customer_payments');
    const hasExpenses = this._hasTable('expenses');
    const hasSupplierPayments = this._hasTable('supplier_payments');
    const returnsTable = this._hasTable('sale_returns')
      ? 'sale_returns'
      : this._hasTable('sales_returns')
        ? 'sales_returns'
        : null;

    // If there is no data source at all, return empty.
    if (!hasPayments && !hasCustomerPayments && !hasExpenses && !hasSupplierPayments && !returnsTable) {
      return [];
    }

    const params = [];
    const whereDate = (col) => {
      let where = 'WHERE 1=1';
      if (dateFrom) {
        where += ` AND date(${col}) >= date(?)`;
        params.push(dateFrom);
      }
      if (dateTo) {
        where += ` AND date(${col}) <= date(?)`;
        params.push(dateTo);
      }
      return where;
    };

    // We aggregate per-day first (d), then compute period_start (day/week) above it.
    const parts = [];

    if (hasPayments) {
      parts.push(`
        SELECT
          date(p.paid_at) AS d,
          p.payment_method AS method,
          COALESCE(SUM(p.amount), 0) AS inflow,
          0 AS outflow,
          'order_payments' AS source
        FROM payments p
        ${whereDate('p.paid_at')}
          AND COALESCE(LOWER(p.payment_method), '') NOT IN ('credit', 'on_credit', 'debt')
        GROUP BY date(p.paid_at), p.payment_method
      `);
    }

    if (hasCustomerPayments) {
      parts.push(`
        SELECT
          date(cp.paid_at) AS d,
          cp.payment_method AS method,
          COALESCE(SUM(cp.amount), 0) AS inflow,
          0 AS outflow,
          'customer_payments' AS source
        FROM customer_payments cp
        ${whereDate('cp.paid_at')}
          AND COALESCE(LOWER(cp.payment_method), '') NOT IN ('credit', 'on_credit', 'debt')
        GROUP BY date(cp.paid_at), cp.payment_method
      `);
    }

    if (hasExpenses) {
      parts.push(`
        SELECT
          date(e.expense_date) AS d,
          e.payment_method AS method,
          0 AS inflow,
          COALESCE(SUM(e.amount), 0) AS outflow,
          'expenses' AS source
        FROM expenses e
        ${whereDate('e.expense_date')}
          AND e.status = 'approved'
        GROUP BY date(e.expense_date), e.payment_method
      `);
    }

    if (hasSupplierPayments) {
      parts.push(`
        SELECT
          date(sp.paid_at) AS d,
          sp.payment_method AS method,
          COALESCE(SUM(CASE WHEN sp.amount < 0 THEN ABS(sp.amount) ELSE 0 END), 0) AS inflow,
          COALESCE(SUM(CASE WHEN sp.amount > 0 THEN sp.amount ELSE 0 END), 0) AS outflow,
          'supplier_payments' AS source
        FROM supplier_payments sp
        ${whereDate('sp.paid_at')}
        GROUP BY date(sp.paid_at), sp.payment_method
      `);
    }

    if (returnsTable) {
      parts.push(`
        SELECT
          date(r.created_at) AS d,
          COALESCE(r.refund_method, 'unknown') AS method,
          0 AS inflow,
          COALESCE(SUM(r.refund_amount), 0) AS outflow,
          'refunds' AS source
        FROM ${returnsTable} r
        ${whereDate('r.created_at')}
          AND LOWER(COALESCE(r.status, '')) = 'completed'
        GROUP BY date(r.created_at), COALESCE(r.refund_method, 'unknown')
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

    const rows = this.db.prepare(query).all([granularity, ...params]);
    return (rows || []).map((r) => ({
      period_start: r.period_start,
      period_key: r.period_key,
      method: r.method || 'unknown',
      inflow: Number(r.inflow || 0) || 0,
      outflow: Number(r.outflow || 0) || 0,
      net: Number(r.net || 0) || 0,
    }));
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
    where += ` AND COALESCE(date(s.closed_at), date(s.opened_at)) IS NOT NULL`;
    if (dateFrom) {
      where += ` AND COALESCE(date(s.closed_at), date(s.opened_at)) >= date(?)`;
      params.push(dateFrom);
    }
    if (dateTo) {
      where += ` AND COALESCE(date(s.closed_at), date(s.opened_at)) <= date(?)`;
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
    };

    // -----------------------------
    // Customers (AR)
    // -----------------------------
    if (this._hasTable('orders') && this._hasTable('customers')) {
      const hasPayments = this._hasTable('payments');
      const hasCustomerPayments = this._hasTable('customer_payments');

      const orders = this.db
        .prepare(
          `
          SELECT
            o.id,
            o.order_number,
            o.customer_id,
            o.total_amount,
            o.created_at
          FROM orders o
          WHERE o.customer_id IS NOT NULL
            AND o.status = 'completed'
          ORDER BY o.customer_id ASC, o.created_at ASC
        `
        )
        .all();

      const paidByOrder = new Map();
      if (hasPayments) {
        const rows = this.db
          .prepare(
            `
            SELECT order_id, COALESCE(SUM(amount), 0) AS paid
            FROM payments
            WHERE COALESCE(LOWER(payment_method), '') NOT IN ('credit', 'on_credit', 'debt')
            GROUP BY order_id
          `
          )
          .all();
        for (const r of rows || []) paidByOrder.set(r.order_id, Number(r.paid || 0) || 0);
      }

      const linkedCustomerPaidByOrder = new Map();
      const unlinkedCustomerPaidByCustomer = new Map();
      if (hasCustomerPayments) {
        const linked = this.db
          .prepare(
            `
            SELECT order_id, COALESCE(SUM(amount), 0) AS paid
            FROM customer_payments
            WHERE order_id IS NOT NULL
              AND COALESCE(LOWER(payment_method), '') NOT IN ('credit', 'on_credit', 'debt')
            GROUP BY order_id
          `
          )
          .all();
        for (const r of linked || []) linkedCustomerPaidByOrder.set(r.order_id, Number(r.paid || 0) || 0);

        const unlinked = this.db
          .prepare(
            `
            SELECT customer_id, COALESCE(SUM(amount), 0) AS paid
            FROM customer_payments
            WHERE order_id IS NULL
              AND COALESCE(LOWER(payment_method), '') NOT IN ('credit', 'on_credit', 'debt')
            GROUP BY customer_id
          `
          )
          .all();
        for (const r of unlinked || []) unlinkedCustomerPaidByCustomer.set(r.customer_id, Number(r.paid || 0) || 0);
      }

      // Group orders by customer with outstanding amounts
      const outstandingByCustomer = new Map(); // customer_id -> [{...order, outstanding}]
      for (const o of orders || []) {
        const total = Number(o.total_amount || 0) || 0;
        const paid = Number(paidByOrder.get(o.id) || 0) || 0;
        const linked = Number(linkedCustomerPaidByOrder.get(o.id) || 0) || 0;
        const outstanding = Math.max(0, total - paid - linked);
        if (outstanding <= 0) continue;
        const arr = outstandingByCustomer.get(o.customer_id) || [];
        arr.push({
          order_id: o.id,
          order_number: o.order_number,
          created_at: o.created_at,
          outstanding,
        });
        outstandingByCustomer.set(o.customer_id, arr);
      }

      // Allocate unlinked customer payments FIFO (oldest orders first)
      for (const [customerId, arr] of outstandingByCustomer.entries()) {
        let available = Number(unlinkedCustomerPaidByCustomer.get(customerId) || 0) || 0;
        if (available <= 0) continue;
        for (const inv of arr) {
          if (available <= 0) break;
          const apply = Math.min(inv.outstanding, available);
          inv.outstanding -= apply;
          available -= apply;
        }
      }

      // Preload customer names
      const customerNames = new Map();
      const custRows = this.db.prepare(`SELECT id, name FROM customers`).all();
      for (const c of custRows || []) customerNames.set(c.id, c.name || c.id);

      // Build aging rows per customer
      for (const [customerId, arr] of outstandingByCustomer.entries()) {
        const buckets = this._initBuckets();
        for (const inv of arr) {
          const amt = Number(inv.outstanding || 0) || 0;
          if (amt <= 0) continue;
          const ageDaysRow = this.db
            .prepare(`SELECT CAST((julianday(?) - julianday(?)) AS INTEGER) AS age_days`)
            .get(asOf, inv.created_at);
          const ageDays = Number(ageDaysRow?.age_days || 0) || 0;
          const key = this._bucketAgeDays(ageDays);
          this._addToBuckets(buckets, key, amt);
        }
        if (buckets.total <= 0) continue;
        result.customers.push({
          customer_id: customerId,
          customer_name: customerNames.get(customerId) || customerId,
          ...buckets,
        });
      }

      // Sort customers by total desc
      result.customers.sort((a, b) => (b.total || 0) - (a.total || 0));
    }

    // -----------------------------
    // Suppliers (AP)
    // -----------------------------
    if (this._hasTable('purchase_orders') && this._hasTable('suppliers') && this._hasTable('supplier_payments')) {
      const purchaseOrders = this.db
        .prepare(
          `
          SELECT
            po.id,
            po.po_number,
            po.supplier_id,
            po.total_amount,
            po.order_date,
            po.created_at
          FROM purchase_orders po
          WHERE po.supplier_id IS NOT NULL
            AND po.status IN ('received', 'partially_received')
          ORDER BY po.supplier_id ASC, po.order_date ASC, po.created_at ASC
        `
        )
        .all();

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

      const unlinkedPaidBySupplier = new Map();
      const unlinkedRows = this.db
        .prepare(
          `
          SELECT supplier_id,
            COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) AS paid_pos,
            COALESCE(SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END), 0) AS paid_neg
          FROM supplier_payments
          WHERE purchase_order_id IS NULL
          GROUP BY supplier_id
        `
        )
        .all();
      for (const r of unlinkedRows || []) {
        unlinkedPaidBySupplier.set(r.supplier_id, {
          pos: Number(r.paid_pos || 0) || 0,
          neg: Number(r.paid_neg || 0) || 0,
        });
      }

      const outstandingBySupplier = new Map();
      for (const po of purchaseOrders || []) {
        const total = Number(po.total_amount || 0) || 0;
        const paid = Number(paidByPo.get(po.id) || 0) || 0;
        const outstanding = Math.max(0, total - paid);
        if (outstanding <= 0) continue;
        const arr = outstandingBySupplier.get(po.supplier_id) || [];
        arr.push({
          purchase_order_id: po.id,
          po_number: po.po_number,
          order_date: po.order_date || po.created_at,
          outstanding,
        });
        outstandingBySupplier.set(po.supplier_id, arr);
      }

      // Allocate unlinked supplier payments (positive only) FIFO against oldest POs.
      for (const [supplierId, arr] of outstandingBySupplier.entries()) {
        const unlinked = unlinkedPaidBySupplier.get(supplierId) || { pos: 0, neg: 0 };
        let available = Number(unlinked.pos || 0) || 0;
        if (available <= 0) continue;
        for (const bill of arr) {
          if (available <= 0) break;
          const apply = Math.min(bill.outstanding, available);
          bill.outstanding -= apply;
          available -= apply;
        }
      }

      // Supplier names
      const supplierNames = new Map();
      const supRows = this.db.prepare(`SELECT id, name FROM suppliers`).all();
      for (const s of supRows || []) supplierNames.set(s.id, s.name || s.id);

      for (const [supplierId, arr] of outstandingBySupplier.entries()) {
        const buckets = this._initBuckets();
        for (const bill of arr) {
          const amt = Number(bill.outstanding || 0) || 0;
          if (amt <= 0) continue;
          const ageDaysRow = this.db
            .prepare(`SELECT CAST((julianday(?) - julianday(?)) AS INTEGER) AS age_days`)
            .get(asOf, bill.order_date);
          const ageDays = Number(ageDaysRow?.age_days || 0) || 0;
          const key = this._bucketAgeDays(ageDays);
          this._addToBuckets(buckets, key, amt);
        }
        if (buckets.total <= 0) continue;
        result.suppliers.push({
          supplier_id: supplierId,
          supplier_name: supplierNames.get(supplierId) || supplierId,
          ...buckets,
        });
      }

      result.suppliers.sort((a, b) => (b.total || 0) - (a.total || 0));
    }

    return result;
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
        AND date(o.created_at) BETWEEN date(?) AND date(?)
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
        SUM(a.quantity * COALESCE(oi.cost_price, 0)) AS cogs_uzs,
        SUM(a.quantity * ((${unitPriceExpr} - ${discountPerUnitExpr}) - COALESCE(oi.cost_price, 0))) AS gross_profit_uzs
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

    if (rows && rows.length > 0) return rows;

    // Fallback: if allocations are missing, approximate by latest receipt supplier per product
    if (!this._hasTable('purchase_receipts') || !this._hasTable('purchase_receipt_items')) {
      return [];
    }

    const fallbackParams = [dateFrom, dateTo];
    let fallbackWhere = `
      WHERE o.status = 'completed'
        AND date(o.created_at) BETWEEN date(?) AND date(?)
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
        SUM(oi.quantity * COALESCE(oi.cost_price, 0)) AS cogs_uzs,
        SUM((oi.quantity * ${unitPriceExpr}) - COALESCE(oi.discount_amount, 0) - (oi.quantity * COALESCE(oi.cost_price, 0))) AS gross_profit_uzs
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      LEFT JOIN products p ON p.id = oi.product_id
      LEFT JOIN latest_receipt lr ON lr.product_id = oi.product_id
      LEFT JOIN suppliers s ON s.id = lr.supplier_id
      ${fallbackWhere}
      GROUP BY lr.supplier_id, p.id
      ORDER BY supplier_name, product_name
    `).all(fallbackParams);

    return fallbackRows || [];
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
   * Supplier Aging Report
   */
  getSupplierAging() {
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

    const customers = this.db.prepare(`
      SELECT 
        c.id as customer_id,
        c.name as customer_name,
        c.phone as customer_phone,
        COALESCE(c.bonus_points, 0) as bonus_points,
        COUNT(o.id) as order_count,
        COALESCE(SUM(o.total_amount), 0) as total_spent,
        COALESCE(AVG(o.total_amount), 0) as avg_order_value,
        MIN(o.created_at) as first_purchase_date,
        MAX(o.created_at) as last_purchase_date,
        CAST((julianday('now') - julianday(MAX(o.created_at))) AS INTEGER) as days_since_last
      FROM customers c
      JOIN orders o ON c.id = o.customer_id
      WHERE o.status = 'completed'
      GROUP BY c.id, c.name, c.phone, c.bonus_points
      HAVING order_count >= ?
      ORDER BY ${orderExpr} ${sortDir}
      LIMIT ?
    `).all(min_orders, limit);

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
    const dateFrom = filters.date_from ? String(filters.date_from).trim() : '1970-01-01';
    const dateTo = filters.date_to ? String(filters.date_to).trim() : '9999-12-31';
    const topLimit = Math.min(100, Math.max(1, Number(filters.top_limit) || 20));

    const table = this.db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='customer_bonus_ledger'`)
      .get();
    let byType = [];
    if (table) {
      byType =
        this.db
          .prepare(
            `
        SELECT type, SUM(points) as total_points, COUNT(*) as entry_count
        FROM customer_bonus_ledger
        WHERE date(created_at) >= date(?) AND date(created_at) <= date(?)
        GROUP BY type
      `
          )
          .all(dateFrom, dateTo) || [];
    }

    const topBalances = this.db
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
      .all(topLimit);

    return {
      period: { date_from: dateFrom, date_to: dateTo },
      ledger_by_type: byType,
      top_bonus_balances: topBalances,
    };
  }

  /**
   * Lost Customers
   * @param {object} filters - { inactive_days }
   */
  getLostCustomers(filters = {}) {
    const { inactive_days = 7 } = filters;

    const customers = this.db.prepare(`
      SELECT 
        c.id as customer_id,
        c.name as customer_name,
        c.phone as customer_phone,
        MAX(o.created_at) as last_purchase_date,
        CAST((julianday('now') - julianday(MAX(o.created_at))) AS INTEGER) as days_since_last,
        COUNT(o.id) as order_count,
        COALESCE(SUM(o.total_amount), 0) as total_spent,
        COALESCE(AVG(o.total_amount), 0) as avg_order_value
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

    const customers = this.db.prepare(`
      SELECT 
        c.id as customer_id,
        c.name as customer_name,
        c.phone as customer_phone,
        COUNT(o.id) as order_count,
        COALESCE(SUM(o.total_amount), 0) as total_sales,
        COALESCE(SUM(o.discount_amount), 0) as total_discounts,
        0 as total_returns,
        0 as total_cost
      FROM customers c
      JOIN orders o ON c.id = o.customer_id
      WHERE o.status = 'completed'
        AND date(o.created_at) BETWEEN date(?) AND date(?)
      GROUP BY c.id
      ORDER BY total_sales DESC
    `).all(dateFrom, dateTo);

    return customers.map(c => {
      const netProfit = c.total_sales - c.total_cost - c.total_discounts - c.total_returns;
      const profitMargin = c.total_sales > 0 ? (netProfit / c.total_sales) * 100 : 0;
      return {
        ...c,
        net_profit: netProfit,
        profit_margin: profitMargin,
        avg_profit_per_order: c.order_count > 0 ? netProfit / c.order_count : 0,
        profitability_score: Math.min(100, Math.max(0, profitMargin + 20))
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

    // purchase_orders does NOT have received_date/order_number in our schema.
    // Actual receive datetime is in goods_receipts.received_at.
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
        0 as avg_delay_days,
        0 as total_shortage_value,
        0 as shortage_count,
        MAX(gr.received_at) as last_delivery_date
      FROM suppliers s
      LEFT JOIN purchase_orders po ON s.id = po.supplier_id
        AND date(po.order_date) BETWEEN date(?) AND date(?)
      LEFT JOIN (
        SELECT purchase_order_id, MAX(received_at) AS received_at
        FROM purchase_receipts
        GROUP BY purchase_order_id
      ) gr ON gr.purchase_order_id = po.id
      WHERE s.is_active = 1
      GROUP BY s.id
      HAVING total_orders > 0
      ORDER BY total_orders DESC
    `).all(dateFrom, dateTo);

    return suppliers.map(s => ({
      ...s,
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
        0 as ordered_items,
        0 as received_items,
        0 as shortage_items,
        0 as shortage_value,
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
      LEFT JOIN (
        SELECT purchase_order_id, MAX(received_at) AS received_at
        FROM purchase_receipts
        GROUP BY purchase_order_id
      ) gr ON gr.purchase_order_id = po.id
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

    // Schema: products do NOT have supplier_id; we track purchases via purchase_order_items
    return this.db.prepare(`
      SELECT 
        p.id as product_id,
        p.name as product_name,
        p.sku as product_sku,
        s.id as supplier_id,
        s.name as supplier_name,
        po.order_date as purchase_date,
        poi.unit_cost as unit_price,
        COALESCE(poi.received_qty, poi.ordered_qty, 0) as quantity,
        (COALESCE(poi.received_qty, poi.ordered_qty, 0) * poi.unit_cost) as total_cost,
        0 as price_change,
        0 as price_change_percent,
        1 as is_latest
      FROM purchase_order_items poi
      JOIN purchase_orders po ON poi.purchase_order_id = po.id
      JOIN suppliers s ON po.supplier_id = s.id
      JOIN products p ON poi.product_id = p.id
      WHERE date(po.order_date) BETWEEN date(?) AND date(?)
        AND po.status IN ('approved', 'received', 'partially_received')
      ORDER BY p.name, po.order_date DESC
    `).all(dateFrom, dateTo);
  }

  /**
   * Product Price Summary
   * @param {object} filters - { date_from, date_to }
   */
  getProductPriceSummary(filters = {}) {
    const { date_from, date_to } = filters;
    const dateFrom = this._ymd(date_from || new Date(Date.now() - 180 * 86400000));
    const dateTo = this._ymd(date_to || new Date());

    // Schema: products do NOT have supplier_id; we aggregate from purchase_order_items
    return this.db.prepare(`
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
        COUNT(DISTINCT po.supplier_id) as supplier_count,
        '' as best_supplier,
        '' as worst_supplier
      FROM products p
      LEFT JOIN purchase_order_items poi ON p.id = poi.product_id
      LEFT JOIN purchase_orders po ON poi.purchase_order_id = po.id
        AND date(po.order_date) BETWEEN date(?) AND date(?)
        AND po.status IN ('approved', 'received')
      WHERE p.is_active = 1
      GROUP BY p.id
      ORDER BY p.name
    `).all(dateFrom, dateTo);
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
    const warehouseId = 'main-warehouse-001';

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

    // Sales totals per product for analysis window
    const salesRows = this.db
      .prepare(
        `
        SELECT 
          oi.product_id,
          COALESCE(SUM(oi.quantity), 0) as total_sold
        FROM order_items oi
        INNER JOIN orders o ON o.id = oi.order_id
        WHERE COALESCE(LOWER(o.status), '') = 'completed'
          AND substr(o.created_at, 1, 10) BETWEEN ? AND ?
        GROUP BY oi.product_id
      `
      )
      .all(dateFrom, dateTo);
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
            SUM(oi.quantity * oi.unit_price) AS revenue_uzs,
            SUM(oi.quantity * COALESCE(oi.cost_price, 0)) AS cogs_uzs
          FROM order_items oi
          INNER JOIN orders o ON o.id = oi.order_id
          WHERE o.status = 'completed'
            AND date(o.created_at) BETWEEN date(?) AND date(?)
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
   * Spread Time Series
   * @param {object} filters - { date_from, date_to }
   */
  getSpreadTimeSeries(filters = {}) {
    const { date_from, date_to } = filters;
    const dateFrom = this._ymd(date_from || new Date(Date.now() - 90 * 86400000));
    const dateTo = this._ymd(date_to || new Date());

    return this.db
      .prepare(
        `
        SELECT
          date(o.created_at) as date,
          oi.product_id as product_id,
          COALESCE(p.name, oi.product_name, '') as product_name,
          CASE WHEN SUM(oi.quantity) > 0 THEN SUM(oi.quantity * oi.unit_price) / SUM(oi.quantity) ELSE 0 END as avg_sale_price,
          CASE WHEN SUM(oi.quantity) > 0 THEN SUM(oi.quantity * COALESCE(oi.cost_price, 0)) / SUM(oi.quantity) ELSE 0 END as avg_cost_price,
          CASE WHEN SUM(oi.quantity) > 0 THEN
            (SUM(oi.quantity * oi.unit_price) / SUM(oi.quantity)) -
            (SUM(oi.quantity * COALESCE(oi.cost_price, 0)) / SUM(oi.quantity))
          ELSE 0 END as margin_amount,
          CASE WHEN SUM(oi.quantity * COALESCE(oi.cost_price, 0)) > 0 THEN
            ((SUM(oi.quantity * oi.unit_price) - SUM(oi.quantity * COALESCE(oi.cost_price, 0))) / SUM(oi.quantity * COALESCE(oi.cost_price, 0))) * 100
          ELSE 0 END as margin_percent,
          COALESCE(SUM(oi.quantity), 0) as quantity_sold
        FROM orders o
        JOIN order_items oi ON o.id = oi.order_id
        LEFT JOIN products p ON oi.product_id = p.id
        WHERE o.status = 'completed'
          AND date(o.created_at) BETWEEN date(?) AND date(?)
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

    const employees = this.db.prepare(`
      SELECT 
        u.id as employee_id,
        u.full_name as employee_name,
        COALESCE(SUM(CASE WHEN o.status = 'completed' THEN 1 ELSE 0 END), 0) as total_sales,
        COALESCE(SUM(CASE WHEN o.status = 'cancelled' THEN 1 ELSE 0 END), 0) as cancelled_count,
        COALESCE(SUM(CASE WHEN o.status = 'cancelled' THEN o.total_amount ELSE 0 END), 0) as cancelled_value,
        0 as returns_count,
        0 as returns_value,
        0 as avg_cancelled_value,
        0 as avg_return_value
      FROM users u
      LEFT JOIN orders o ON u.id = COALESCE(o.user_id, o.cashier_id)
        AND date(o.created_at) BETWEEN date(?) AND date(?)
      GROUP BY u.id
      HAVING (total_sales + cancelled_count + returns_count) > 0
      ORDER BY cancelled_count DESC
    `).all(dateFrom, dateTo);

    return employees.map(e => {
      const errorRate = e.total_sales > 0 ? ((e.cancelled_count + e.returns_count) / e.total_sales) * 100 : 0;
      return {
        ...e,
        error_rate: errorRate,
        error_score: Math.min(100, errorRate * 10)
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

    return this.db.prepare(`
      SELECT 
        o.id,
        o.order_number,
        u.full_name as employee_name,
        date(o.created_at) as order_date,
        time(o.created_at) as order_time,
        CASE WHEN o.status = 'cancelled' THEN 'cancelled' ELSE 'return' END as type,
        o.total_amount as amount,
        0 as items_count,
        '' as reason,
        c.name as customer_name
      FROM orders o
      JOIN users u ON COALESCE(o.user_id, o.cashier_id) = u.id
      LEFT JOIN customers c ON o.customer_id = c.id
      WHERE o.status = 'cancelled'
        AND date(o.created_at) BETWEEN date(?) AND date(?)
      ORDER BY o.created_at DESC
    `).all(dateFrom, dateTo);
  }

  /**
   * Shift Productivity
   * @param {object} filters - { date_from, date_to }
   */
  getShiftProductivity(filters = {}) {
    const { date_from, date_to } = filters;
    const dateFrom = this._ymd(date_from || new Date(Date.now() - 30 * 86400000));
    const dateTo = this._ymd(date_to || new Date());

    // Assuming shifts exist in database
    return this.db.prepare(`
      SELECT 
        '' as shift_id,
        date(o.created_at) as shift_date,
        u.id as employee_id,
        u.full_name as employee_name,
        '09:00' as start_time,
        '18:00' as end_time,
        9 as hours_worked,
        COUNT(o.id) as total_sales,
        COALESCE(SUM(o.total_amount), 0) as total_revenue,
        COUNT(o.id) as orders_count,
        COALESCE(AVG(o.total_amount), 0) as avg_order_value,
        COALESCE(SUM(o.total_amount) / 9, 0) as revenue_per_hour,
        COALESCE(COUNT(o.id) / 9.0, 0) as orders_per_hour,
        50 as productivity_score
      FROM orders o
      JOIN users u ON COALESCE(o.user_id, o.cashier_id) = u.id
      WHERE o.status = 'completed'
        AND date(o.created_at) BETWEEN date(?) AND date(?)
      GROUP BY date(o.created_at), u.id
      ORDER BY shift_date DESC, total_revenue DESC
    `).all(dateFrom, dateTo);
  }

  /**
   * Productivity Summary
   * @param {object} filters - { date_from, date_to, sort_by }
   */
  getProductivitySummary(filters = {}) {
    const { date_from, date_to, sort_by = 'revenue_per_hour' } = filters;
    const dateFrom = this._ymd(date_from || new Date(Date.now() - 30 * 86400000));
    const dateTo = this._ymd(date_to || new Date());

    const employees = this.db.prepare(`
      SELECT 
        u.id as employee_id,
        u.full_name as employee_name,
        COUNT(DISTINCT date(o.created_at)) as total_shifts,
        COUNT(DISTINCT date(o.created_at)) * 9 as total_hours,
        COALESCE(SUM(o.total_amount), 0) as total_revenue,
        COUNT(o.id) as total_orders,
        COALESCE(SUM(o.total_amount) / (COUNT(DISTINCT date(o.created_at)) * 9), 0) as avg_revenue_per_hour,
        COALESCE(COUNT(o.id) / (COUNT(DISTINCT date(o.created_at)) * 9.0), 0) as avg_orders_per_hour,
        COALESCE(MAX(o.total_amount), 0) as best_shift_revenue,
        COALESCE(MIN(o.total_amount), 0) as worst_shift_revenue,
        50 as productivity_score
      FROM users u
      JOIN orders o ON u.id = COALESCE(o.user_id, o.cashier_id)
      WHERE o.status = 'completed'
        AND date(o.created_at) BETWEEN date(?) AND date(?)
      GROUP BY u.id
      ORDER BY ${sort_by === 'orders_per_hour' ? 'avg_orders_per_hour' : sort_by === 'productivity_score' ? 'productivity_score' : 'avg_revenue_per_hour'} DESC
    `).all(dateFrom, dateTo);

    return employees;
  }

  /**
   * Fraud Signals
   * @param {object} filters - { date_from, date_to }
   */
  getFraudSignals(filters = {}) {
    const { date_from, date_to } = filters;
    const dateFrom = this._ymd(date_from || new Date(Date.now() - 30 * 86400000));
    const dateTo = this._ymd(date_to || new Date());

    const employees = this.db.prepare(`
      SELECT 
        u.id as employee_id,
        u.full_name as employee_name,
        COUNT(o.id) as total_sales,
        COALESCE(SUM(CASE WHEN o.status = 'cancelled' THEN 1 ELSE 0 END), 0) as cancelled_count,
        COALESCE(SUM(CASE WHEN o.status = 'cancelled' THEN 1 ELSE 0 END) * 100.0 / COUNT(o.id), 0) as cancelled_rate,
        COALESCE(SUM(CASE WHEN o.discount_amount > o.total_amount * 0.3 THEN 1 ELSE 0 END), 0) as excessive_discount_count,
        COALESCE(SUM(CASE WHEN o.discount_amount > o.total_amount * 0.3 THEN 1 ELSE 0 END) * 100.0 / COUNT(o.id), 0) as excessive_discount_rate,
        COALESCE(SUM(o.discount_amount), 0) as total_discount_given,
        COALESCE(AVG(CASE WHEN o.discount_amount > 0 THEN o.discount_amount / o.total_amount * 100 ELSE 0 END), 0) as avg_discount_percent,
        0 as suspicious_returns,
        0 as void_pattern_score,
        0 as discount_pattern_score,
        0 as overall_risk_score,
        0 as alert_count
      FROM users u
      LEFT JOIN orders o ON u.id = COALESCE(o.user_id, o.cashier_id)
        AND date(o.created_at) BETWEEN date(?) AND date(?)
      WHERE u.role = 'cashier'
      GROUP BY u.id
      HAVING total_sales > 0
      ORDER BY cancelled_rate DESC, excessive_discount_rate DESC
    `).all(dateFrom, dateTo);

    return employees.map(e => {
      const riskScore = (e.cancelled_rate * 0.5) + (e.excessive_discount_rate * 0.5);
      let riskLevel = 'low';
      if (riskScore >= 30) riskLevel = 'critical';
      else if (riskScore >= 20) riskLevel = 'high';
      else if (riskScore >= 10) riskLevel = 'medium';
      
      return {
        ...e,
        void_pattern_score: e.cancelled_rate,
        discount_pattern_score: e.excessive_discount_rate,
        overall_risk_score: riskScore,
        risk_level: riskLevel,
        alert_count: e.cancelled_count + e.excessive_discount_count
      };
    });
  }

  /**
   * Fraud Incidents
   * @param {object} filters - { date_from, date_to }
   */
  getFraudIncidents(filters = {}) {
    const { date_from, date_to } = filters;
    const dateFrom = this._ymd(date_from || new Date(Date.now() - 30 * 86400000));
    const dateTo = this._ymd(date_to || new Date());

    return this.db.prepare(`
      SELECT 
        o.id,
        u.full_name as employee_name,
        date(o.created_at) as incident_date,
        time(o.created_at) as incident_time,
        CASE 
          WHEN o.status = 'cancelled' THEN 'excessive_cancel'
          WHEN o.discount_amount > o.total_amount * 0.3 THEN 'excessive_discount'
          ELSE 'other'
        END as type,
        o.order_number,
        o.total_amount as amount,
        CASE WHEN o.discount_amount > 0 THEN o.discount_amount / o.total_amount * 100 ELSE 0 END as discount_percent,
        CASE 
          WHEN o.status = 'cancelled' THEN 'Buyurtma bekor qilindi'
          WHEN o.discount_amount > o.total_amount * 0.3 THEN 'Juda katta chegirma'
          ELSE ''
        END as description,
        CASE 
          WHEN o.status = 'cancelled' THEN 75
          WHEN o.discount_amount > o.total_amount * 0.3 THEN 60
          ELSE 30
        END as risk_score
      FROM orders o
      JOIN users u ON COALESCE(o.user_id, o.cashier_id) = u.id
      WHERE (o.status = 'cancelled' OR o.discount_amount > o.total_amount * 0.3)
        AND date(o.created_at) BETWEEN date(?) AND date(?)
      ORDER BY o.created_at DESC
    `).all(dateFrom, dateTo);
  }

  /**
   * SYSTEM & TECHNICAL REPORTS
   */

  /**
   * Device Health Report
   */
  getDeviceHealth() {
    // This would track actual hardware devices
    // For now, return mock structure
    return [
      {
        device_id: '1',
        device_name: 'Main Printer',
        device_type: 'printer',
        location: 'Kassa 1',
        status: 'online',
        last_check: new Date().toISOString(),
        uptime_percent: 98.5,
        error_count: 2,
        last_error: null,
        last_error_time: null,
      },
      {
        device_id: '2',
        device_name: 'Scale 1',
        device_type: 'scale',
        location: 'Kassa 1',
        status: 'online',
        last_check: new Date().toISOString(),
        uptime_percent: 99.2,
        error_count: 0,
        last_error: null,
        last_error_time: null,
      },
      {
        device_id: '3',
        device_name: 'Internet Connection',
        device_type: 'internet',
        location: 'Main Office',
        status: 'online',
        last_check: new Date().toISOString(),
        uptime_percent: 97.8,
        error_count: 5,
        last_error: 'Connection timeout',
        last_error_time: new Date(Date.now() - 3600000).toISOString(),
      },
    ];
  }

  /**
   * Device Incidents
   */
  getDeviceIncidents() {
    // Return recent device incidents
    return [];
  }

  /**
   * Audit Log (Action History)
   * @param {object} filters - { date_from, date_to, action, entity_type, user_id }
   */
  getAuditLog(filters = {}) {
    const { date_from, date_to, action, entity_type, user_id } = filters;
    const dateFrom = this._ymd(date_from || new Date(Date.now() - 7 * 86400000));
    const dateTo = this._ymd(date_to || new Date());

    // Backward compatibility:
    // - Older/newer DBs may have `audit_log` (009_settings.sql) instead of `audit_logs`
    const hasAuditLogs = this._hasTable('audit_logs');
    const hasAuditLog = this._hasTable('audit_log');
    if (!hasAuditLogs && !hasAuditLog) return [];

    let where = `WHERE date(al.created_at) BETWEEN date(?) AND date(?)`;
    const params = [dateFrom, dateTo];

    if (action) {
      where += ` AND al.action = ?`;
      params.push(action);
    }

    if (entity_type) {
      where += ` AND al.entity_type = ?`;
      params.push(entity_type);
    }

    if (user_id) {
      where += ` AND al.user_id = ?`;
      params.push(user_id);
    }

    if (hasAuditLogs) {
      return this.db
        .prepare(
          `
          SELECT 
            al.id,
            al.user_id,
            COALESCE(u.full_name, u.username, al.user_id) as user_name,
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
          LEFT JOIN users u ON al.user_id = u.id
          ${where}
          ORDER BY al.created_at DESC
          LIMIT 1000
        `
        )
        .all(...params);
    }

    // audit_log schema (009_settings.sql): old_values/new_values (JSON), no entity_name/description
    return this.db
      .prepare(
        `
        SELECT 
          al.id,
          al.user_id,
          COALESCE(u.full_name, u.username, al.user_id) as user_name,
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
        LEFT JOIN users u ON al.user_id = u.id
        ${where}
        ORDER BY al.created_at DESC
        LIMIT 1000
      `
      )
      .all(...params);
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

    let where = `WHERE date(ph.changed_at) BETWEEN date(?) AND date(?)`;
    const params = [dateFrom, dateTo];

    if (price_type) {
      where += ` AND ph.price_type = ?`;
      params.push(price_type);
    }

    return this.db.prepare(`
      SELECT 
        ph.id,
        ph.product_id,
        p.name as product_name,
        p.sku as product_sku,
        ph.price_type,
        ph.old_price,
        ph.new_price,
        (ph.new_price - ph.old_price) as change_amount,
        CASE WHEN ph.old_price > 0 THEN ((ph.new_price - ph.old_price) / ph.old_price * 100) ELSE 0 END as change_percent,
        ph.changed_by,
        u.full_name as changed_by_name,
        ph.changed_at,
        ph.reason
      FROM price_history ph
      JOIN products p ON ph.product_id = p.id
      LEFT JOIN users u ON ph.changed_by = u.id
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

    // Current period revenue and profit
    const current = this.db.prepare(`
      SELECT 
        COALESCE(SUM(total_amount), 0) as revenue,
        COUNT(*) as orders_count,
        COUNT(DISTINCT customer_id) as customers_count,
        COALESCE(AVG(total_amount), 0) as avg_order_value
      FROM orders
      WHERE status = 'completed'
        AND date(created_at) BETWEEN date(?) AND date(?)
    `).get(dateFrom, today);

    // Previous period
    const previous = this.db.prepare(`
      SELECT 
        COALESCE(SUM(total_amount), 0) as revenue
      FROM orders
      WHERE status = 'completed'
        AND date(created_at) BETWEEN date(?) AND date(?)
    `).get(datePrevFrom, datePrevTo);

    // Profit based on frozen cost_price (COGS)
    const currentCogs = this.db.prepare(`
      SELECT COALESCE(SUM(oi.cost_price * oi.quantity), 0) as cogs
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      WHERE o.status = 'completed'
        AND date(o.created_at) BETWEEN date(?) AND date(?)
    `).get(dateFrom, today);
    const previousCogs = this.db.prepare(`
      SELECT COALESCE(SUM(oi.cost_price * oi.quantity), 0) as cogs
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      WHERE o.status = 'completed'
        AND date(o.created_at) BETWEEN date(?) AND date(?)
    `).get(datePrevFrom, datePrevTo);

    const currentProfit = (current.revenue || 0) - (currentCogs?.cogs || 0);
    const previousProfit = (previous.revenue || 0) - (previousCogs?.cogs || 0);
    const profitMargin = current.revenue > 0 ? (currentProfit / current.revenue) : 0;

    // Debt calculation
    const customerDebt = this.db.prepare(`
      SELECT COALESCE(SUM(total_amount - paid_amount), 0) as debt
      FROM orders
      WHERE status = 'completed' AND paid_amount < total_amount
    `).get();

    // purchase_orders schema uses total_amount; "paid_amount" may be cached but the source of truth is supplier_payments.
    // Supplier credit notes (including supplier returns) are stored in supplier_payments with positive amounts, so debt decreases automatically.
    const supplierDebt = this.db.prepare(`
      SELECT COALESCE(SUM(po.total_amount - COALESCE(pays.paid_amount, 0)), 0) as debt
      FROM purchase_orders po
      LEFT JOIN (
        SELECT purchase_order_id, SUM(amount) AS paid_amount
        FROM supplier_payments
        WHERE purchase_order_id IS NOT NULL
        GROUP BY purchase_order_id
      ) pays ON pays.purchase_order_id = po.id
      WHERE po.status IN ('approved', 'received', 'partially_received')
        AND COALESCE(pays.paid_amount, 0) < po.total_amount
    `).get();

    const totalDebt = (customerDebt.debt || 0) + (supplierDebt.debt || 0);

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
      revenue_previous: previous.revenue || 0,
      revenue_growth: previous.revenue > 0 ? ((current.revenue - previous.revenue) / previous.revenue) * 100 : 0,
      profit: currentProfit,
      profit_previous: previousProfit,
      profit_margin: profitMargin * 100,
      profit_growth: previousProfit > 0 ? ((currentProfit - previousProfit) / previousProfit) * 100 : 0,
      total_debt: totalDebt,
      customer_debt: customerDebt.debt || 0,
      supplier_debt: supplierDebt.debt || 0,
      debt_growth: 0, // Would need historical tracking
      inventory_value: inventoryValue || 0,
      inventory_value_previous: inventoryValuePrev,
      inventory_growth: 0, // Would need historical tracking
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

    const params = [];
    let where = `WHERE o.status = 'completed'`;
    if (warehouseId) {
      where += ` AND o.warehouse_id = ?`;
      params.push(warehouseId);
    }
    if (dateFrom) {
      where += ` AND date(o.created_at) >= date(?)`;
      params.push(dateFrom);
    }
    if (dateTo) {
      where += ` AND date(o.created_at) <= date(?)`;
      params.push(dateTo);
    }

    let missingCostCount = 0;
    try {
      const row = this.db
        .prepare(
          `
          SELECT COUNT(*) AS missing_count
          FROM order_items oi
          INNER JOIN orders o ON o.id = oi.order_id
          ${where}
            AND (oi.cost_price IS NULL OR oi.cost_price = 0)
        `
        )
        .get(params);
      missingCostCount = Number(row?.missing_count || 0) || 0;
      if (missingCostCount > 0) {
        console.warn('[reportsService] Missing cost_price rows:', { missingCostCount, warehouseId, dateFrom, dateTo });
      }
    } catch {
      missingCostCount = 0;
    }

    let fifoTotal = null;
    let weightedTotal = null;

    if (warehouseId && this._hasTable('inventory_batches')) {
      try {
        const fifoRow = this.db
          .prepare(
            `
            SELECT COALESCE(SUM(remaining_qty * COALESCE(cost_price_uzs, unit_cost, 0)), 0) AS fifo_value
            FROM inventory_batches
            WHERE warehouse_id = ?
          `
          )
          .get(warehouseId);
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
    
    let daysBack = 7;
    let groupBy = `date(created_at)`;
    let periodFormat = `date(created_at)`;
    
    if (period === 'week') {
      daysBack = 8 * 7; // 8 weeks
      groupBy = `strftime('%Y-W%W', created_at)`;
      periodFormat = `strftime('Hafta %W', created_at)`;
    } else if (period === 'month') {
      daysBack = 12 * 30; // ~12 months
      groupBy = `strftime('%Y-%m', created_at)`;
      periodFormat = `strftime('%Y-%m', created_at)`;
    }

    const dateFrom = this._ymd(new Date(Date.now() - daysBack * 86400000));

    const trends = this.db.prepare(`
      SELECT 
        ${periodFormat} as period,
        COALESCE(SUM(total_amount), 0) as revenue,
        COUNT(*) as orders
      FROM orders
      WHERE status = 'completed'
        AND date(created_at) BETWEEN date(?) AND date(?)
      GROUP BY ${groupBy}
      ORDER BY created_at
    `).all(dateFrom, today);

    // Add profit estimation
    const profitMargin = 0.30;
    return trends.map(t => ({
      period: t.period,
      revenue: t.revenue || 0,
      profit: (t.revenue || 0) * profitMargin,
      orders: t.orders || 0,
    }));
  }
}

module.exports = ReportsService;

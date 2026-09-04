'use strict';

/**
 * Single financial calculation source for P&L, act-sverka, cash flow, dashboard.
 *
 *   grossRevenue = completed orders, pre-discount
 *   discounts    = line + allocated order discounts
 *   salesReturns = returned sales amount
 *   netRevenue   = grossRevenue - discounts - salesReturns
 *   grossProfit  = netRevenue - netCogs
 *   netProfit    = grossProfit - approvedExpenses
 */

const { randomUUID } = require('crypto');
const {
  formatYmdInTimeZone,
  nowSqlInTimeZone,
  UZBEKISTAN_TIMEZONE,
  UZBEKISTAN_TZ_SQLITE_OFFSET,
} = require('./timezone.cjs');
const { expenseAmountUzsSql } = require('./expenseAmount.cjs');
const {
  orderFieldUzsSql,
  returnRefundUzsSql,
  customerPaymentAmountUzsSql,
  paymentAmountUzsSql,
} = require('./orderAmount.cjs');
const { supplierPaymentCashUzsSql } = require('./currencyLedger.cjs');
const {
  useUnifiedSales,
  salesFrom,
  saleItemsFrom,
  completedStatusWhere,
  unifiedFieldUzsSql,
  unifiedAmountUzsSql,
  soldLineRevenueSql,
  soldQtySql,
  salesChannelWhere,
  posCartReturnExcludeWhere,
  cogsLineSql,
  returnCogsLineSql,
} = require('./unifiedSalesSql.cjs');

const DATA_VERSION = 'financial.v2';
const COGS_SOURCES = ['fifo', 'weighted_average', 'historical_fallback', 'insufficient'];

function roundUzs(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n);
}

function money(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function hasTable(db, name) {
  try {
    return !!db
      .prepare(`SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name = ? LIMIT 1`)
      .get(String(name))?.ok;
  } catch {
    return false;
  }
}

function hasView(db, name) {
  try {
    return !!db
      .prepare(`SELECT 1 AS ok FROM sqlite_master WHERE type='view' AND name = ? LIMIT 1`)
      .get(String(name))?.ok;
  } catch {
    return false;
  }
}

function hasColumn(db, table, col) {
  try {
    return (db.prepare(`PRAGMA table_info(${table})`).all() || []).some((c) => c.name === col);
  } catch {
    return false;
  }
}

function isTruthySetting(db, key) {
  try {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    const v = String(row?.value ?? '')
      .trim()
      .toLowerCase();
    return v === '1' || v === 'true' || v === 'yes' || v === 'on';
  } catch {
    return false;
  }
}

function tzDateExpr(host, columnExpr) {
  if (typeof host?._tzDateExpr === 'function') return host._tzDateExpr(columnExpr);
  return `date(datetime(replace(replace(${columnExpr}, 'T', ' '), 'Z', ''), '${UZBEKISTAN_TZ_SQLITE_OFFSET}'))`;
}

function ymdOf(host, input) {
  if (typeof host?._ymd === 'function') return host._ymd(input);
  if (!input) return formatYmdInTimeZone(new Date());
  if (typeof input === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input)) return input;
  return formatYmdInTimeZone(input) || formatYmdInTimeZone(new Date());
}

function hostHasTable(host, name) {
  if (typeof host?._hasTable === 'function') return host._hasTable(name);
  return hasTable(host.db, name);
}

function legacyCogsFallbackEnabled(host) {
  if (typeof host?._isTruthySetting === 'function') {
    return host._isTruthySetting('accounting.cogs_legacy_fallback');
  }
  return isTruthySetting(host.db, 'accounting.cogs_legacy_fallback');
}

function fifoEnabled(host) {
  const check = (key) =>
    typeof host?._isTruthySetting === 'function'
      ? host._isTruthySetting(key)
      : isTruthySetting(host.db, key);
  return check('inventory.fifo_enabled') || check('inventory.batch_mode_enabled') || check('batch_mode_enabled');
}

function itemAllocIdExpr(db, itemAlias = 'oi', options = {}) {
  const fromUnified = options.fromUnified === true && useUnifiedSales(db);
  if (fromUnified) {
    return `CASE
      WHEN ${itemAlias}.sale_source = 'web' THEN ('web_item:' || ${itemAlias}.source_item_id)
      ELSE ${itemAlias}.source_item_id
    END`;
  }
  return `${itemAlias}.id`;
}

function allocCogsSql(db, itemAlias = 'oi', options = {}) {
  if (!hasTable(db, 'inventory_batch_allocations')) return '0';
  const idExpr = itemAllocIdExpr(db, itemAlias, options);
  return `COALESCE((
    SELECT SUM(a.quantity * a.unit_cost)
    FROM inventory_batch_allocations a
    WHERE a.reference_type = 'order_item'
      AND a.reference_id = ${idExpr}
      AND LOWER(TRIM(COALESCE(a.direction, ''))) = 'out'
  ), 0)`;
}

/**
 * Closed-sale COGS: FIFO allocations, else frozen cost_price, else optional catalog fallback.
 * Live catalog price is never used unless accounting.cogs_legacy_fallback is on.
 */
function actualCogsLineSql(db, itemAlias = 'oi', qtyExpr = null, options = {}) {
  const qty = qtyExpr || `COALESCE(${itemAlias}.qty_base, ${itemAlias}.quantity, 0)`;
  const alloc = allocCogsSql(db, itemAlias, options);
  const frozen = `COALESCE(${itemAlias}.cost_price, 0) * (${qty})`;
  const useFallback = options.usePurchaseFallback === true;
  const fallback = useFallback
    ? `COALESCE((SELECT purchase_price FROM products WHERE id = ${itemAlias}.product_id LIMIT 1), 0) * (${qty})`
    : '0';
  return `CASE
    WHEN (${alloc}) > 0.0000001 THEN (${alloc})
    WHEN COALESCE(${itemAlias}.cost_price, 0) > 0 THEN (${frozen})
    ELSE (${fallback})
  END`;
}

function actualCogsSourceSql(db, itemAlias = 'oi', qtyExpr = null, options = {}) {
  const qty = qtyExpr || `COALESCE(${itemAlias}.qty_base, ${itemAlias}.quantity, 0)`;
  const alloc = allocCogsSql(db, itemAlias, options);
  const useFallback = options.usePurchaseFallback === true;
  return `CASE
    WHEN (${alloc}) > 0.0000001 THEN 'fifo'
    WHEN COALESCE(${itemAlias}.cost_price, 0) > 0 THEN 'weighted_average'
    WHEN ${useFallback ? 1 : 0} = 1
      AND COALESCE((SELECT purchase_price FROM products WHERE id = ${itemAlias}.product_id LIMIT 1), 0) > 0
      THEN 'historical_fallback'
    ELSE 'insufficient'
  END`;
}

function grossLineRevenueSql(itemAlias = 'oi') {
  const qty = soldQtySql(itemAlias);
  return `(COALESCE(${itemAlias}.unit_price, 0) * (${qty}))`;
}

function grossLineRevenueUzsSql(db, salesAlias = 'o', itemAlias = 'oi') {
  return unifiedFieldUzsSql(db, salesAlias, itemAlias, grossLineRevenueSql(itemAlias));
}

function expectedClosingCash(parts = {}) {
  return roundUzs(
    money(parts.openingCash) +
      money(parts.cashSales) +
      money(parts.customerPaymentsCash) +
      money(parts.otherCashIn) -
      money(parts.cashRefunds) -
      money(parts.supplierPaymentsCash) -
      money(parts.customerLoanIssuedCash) -
      money(parts.cashExpenses) -
      money(parts.cashWithdrawals) +
      money(parts.cashDeposits)
  );
}

function reportMeta(host, filters = {}, extra = {}) {
  const dateFrom = filters.date_from ? ymdOf(host, filters.date_from) : null;
  const dateTo = filters.date_to ? ymdOf(host, filters.date_to) : null;
  const fifoOn = fifoEnabled(host);
  return {
    computed_at: nowSqlInTimeZone(),
    timezone: UZBEKISTAN_TIMEZONE,
    period: { date_from: dateFrom, date_to: dateTo },
    warehouse_id: filters.warehouse_id || null,
    cogs_method: extra.cogs_method || (fifoOn ? 'fifo' : 'weighted_average'),
    data_version: DATA_VERSION,
    ...extra,
  };
}

function emptyPnL(host, filters) {
  return {
    gross_revenue: 0,
    gross_revenue_uzs: 0,
    gross_revenue_usd: 0,
    discounts: 0,
    discount: 0,
    discount_uzs: 0,
    discount_usd: 0,
    returns_revenue: 0,
    returns_revenue_uzs: 0,
    returns_revenue_usd: 0,
    net_revenue: 0,
    net_sales: 0,
    net_sales_uzs: 0,
    net_sales_usd: 0,
    sold_cogs: 0,
    returns_cogs: 0,
    cogs: 0,
    cogs_source: 'insufficient',
    cogs_source_breakdown: {
      fifo: 0,
      weighted_average: 0,
      historical_fallback: 0,
      insufficient: 0,
    },
    gross_profit: 0,
    expenses: 0,
    total_commission: 0,
    payment_fees: 0,
    net_profit: 0,
    orders_count: 0,
    items_sold: 0,
    revenue: 0,
    revenue_uzs: 0,
    revenue_usd: 0,
    profit_margin: 0,
    return_rate: 0,
    avg_order_value: 0,
    series: [],
    meta: reportMeta(host, filters),
  };
}

function pickPrimaryCogsSource(breakdown) {
  let best = 'insufficient';
  let bestAmt = -1;
  for (const key of COGS_SOURCES) {
    const amt = money(breakdown[key]);
    if (amt > bestAmt) {
      bestAmt = amt;
      best = key;
    }
  }
  if (bestAmt <= 0) return 'insufficient';
  return best;
}

function computeReturns(host, filters) {
  const db = host.db;
  const dateFrom = filters.date_from ? ymdOf(host, filters.date_from) : null;
  const dateTo = filters.date_to ? ymdOf(host, filters.date_to) : null;
  const warehouseId = filters.warehouse_id || null;
  const useFallback = legacyCogsFallbackEnabled(host);

  const returnsTable = hostHasTable(host, 'sales_returns')
    ? 'sales_returns'
    : hostHasTable(host, 'sale_returns')
      ? 'sale_returns'
      : null;

  let returnsRevenue = 0;
  let returnsRevenueUzs = 0;
  let returnsRevenueUsd = 0;
  let returnsCogs = 0;
  let returnsCount = 0;

  if (returnsTable) {
    const retCols = new Set(
      (db.prepare(`PRAGMA table_info(${returnsTable})`).all() || []).map((c) => c.name)
    );
    const hasRefundAmount = retCols.has('refund_amount');
    const hasWarehouseId = retCols.has('warehouse_id');
    const returnsParams = [];
    let returnsWhere = `WHERE LOWER(COALESCE(r.status, '')) = 'completed'`;
    const returnDateExpr = tzDateExpr(host, 'r.created_at');
    if (warehouseId && hasWarehouseId) {
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
    const revAmountExpr = hasRefundAmount
      ? `COALESCE(r.refund_amount, r.total_amount, 0)`
      : `COALESCE(r.total_amount, 0)`;
    const revUzsExpr = returnRefundUzsSql(db, 'r', 'o', revAmountExpr);
    const revRow = db
      .prepare(
        `
        SELECT
          COALESCE(SUM(${revUzsExpr}), 0) AS returns_revenue,
          COALESCE(SUM(CASE
            WHEN o.id IS NOT NULL AND UPPER(TRIM(COALESCE(o.currency, 'UZS'))) = 'USD' THEN 0
            ELSE (${revAmountExpr})
          END), 0) AS returns_revenue_uzs,
          COALESCE(SUM(CASE
            WHEN o.id IS NOT NULL AND UPPER(TRIM(COALESCE(o.currency, 'UZS'))) = 'USD'
            THEN (${revAmountExpr})
            ELSE 0
          END), 0) AS returns_revenue_usd,
          COUNT(*) AS returns_count
        FROM ${returnsTable} r
        LEFT JOIN orders o ON o.id = r.order_id
        ${returnsWhere}
      `
      )
      .get(...returnsParams);
    returnsRevenue = money(revRow?.returns_revenue);
    returnsRevenueUzs = money(revRow?.returns_revenue_uzs);
    returnsRevenueUsd = money(revRow?.returns_revenue_usd);
    returnsCount = Number(revRow?.returns_count || 0) || 0;

    const returnItemsTable = returnsTable === 'sale_returns' ? 'sale_return_items' : 'return_items';
    if (hostHasTable(host, returnItemsTable)) {
      const itemCols = new Set(
        (db.prepare(`PRAGMA table_info(${returnItemsTable})`).all() || []).map((c) => c.name)
      );
      const qty = itemCols.has('qty_base')
        ? `COALESCE(ri.qty_base, ri.quantity, 0)`
        : `COALESCE(ri.quantity, 0)`;
      const retCogsExpr = returnCogsLineSql('oi', qty, { usePurchaseFallback: useFallback });
      if (itemCols.has('order_item_id')) {
        const cogsRow = db
          .prepare(
            `
            SELECT COALESCE(SUM(${retCogsExpr}), 0) AS returns_cogs
            FROM ${returnItemsTable} ri
            INNER JOIN ${returnsTable} r ON r.id = ri.return_id
            LEFT JOIN order_items oi ON oi.id = ri.order_item_id
            LEFT JOIN orders o ON o.id = r.order_id
            ${returnsWhere}
          `
          )
          .get(...returnsParams);
        returnsCogs = money(cogsRow?.returns_cogs);
      }
    }
  }

  if (hostHasTable(host, 'orders') && hostHasTable(host, 'order_items')) {
    try {
      const posParams = [];
      let posWhere = `WHERE o.status = 'completed' AND ${unifiedAmountUzsSql(db, 'o')} < -0.009`;
      const posDateExpr = tzDateExpr(host, 'o.created_at');
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
      const posAmtUzs = unifiedAmountUzsSql(db, 'o');
      const posCogsExpr = actualCogsLineSql(db, 'oi', null, {
        usePurchaseFallback: useFallback,
        fromUnified: false,
      });
      const posRow = db
        .prepare(
          `
          SELECT
            COALESCE(SUM(ABS(${posAmtUzs})), 0) AS returns_revenue,
            COALESCE(SUM(ABS(item_cogs.cogs)), 0) AS returns_cogs,
            COUNT(*) AS returns_count
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
      returnsRevenue += money(posRow?.returns_revenue);
      returnsCogs += money(posRow?.returns_cogs);
      returnsCount += Number(posRow?.returns_count || 0) || 0;
    } catch {
      /* orders schema partial */
    }
  }

  return {
    returnsRevenue: roundUzs(returnsRevenue),
    returnsRevenueUzs: roundUzs(returnsRevenueUzs || returnsRevenue),
    returnsRevenueUsd: money(returnsRevenueUsd),
    returnsCogs: roundUzs(returnsCogs),
    returnsCount,
  };
}

function computeApprovedExpenses(host, filters) {
  const db = host.db;
  if (!hostHasTable(host, 'expenses')) return 0;
  const dateFrom = filters.date_from ? ymdOf(host, filters.date_from) : null;
  const dateTo = filters.date_to ? ymdOf(host, filters.date_to) : null;
  const warehouseId = filters.warehouse_id || null;
  const hasExpenseWh = warehouseId && hasColumn(db, 'expenses', 'warehouse_id');
  const expenseDateExpr = tzDateExpr(host, 'COALESCE(e.expense_date, e.created_at)');
  const expenseParams = [];
  let where = `WHERE COALESCE(LOWER(e.status), 'approved') IN ('approved', 'paid')`;
  if (dateFrom) {
    where += ` AND ${expenseDateExpr} >= date(?)`;
    expenseParams.push(dateFrom);
  }
  if (dateTo) {
    where += ` AND ${expenseDateExpr} <= date(?)`;
    expenseParams.push(dateTo);
  }
  if (hasExpenseWh) {
    where += ` AND e.warehouse_id = ?`;
    expenseParams.push(warehouseId);
  }
  const row = db
    .prepare(
      `
      SELECT COALESCE(SUM(${expenseAmountUzsSql(db, 'e')}), 0) AS total_expenses
      FROM expenses e
      ${where}
    `
    )
    .get(...expenseParams);
  return roundUzs(row?.total_expenses);
}

/**
 * Canonical period P&L. `revenue` is kept as brutto (gross_revenue) so UI labels match TZ.
 */
function computePnL(host, filters = {}) {
  const db = host.db;
  const salesTable = salesFrom(db);
  const itemsTable = saleItemsFrom(db);
  const unified = useUnifiedSales(db);
  if (!unified && !(hostHasTable(host, 'orders') && hostHasTable(host, 'order_items'))) {
    return emptyPnL(host, filters);
  }

  const dateFrom = filters.date_from ? ymdOf(host, filters.date_from) : null;
  const dateTo = filters.date_to ? ymdOf(host, filters.date_to) : null;
  const warehouseId = filters.warehouse_id || null;
  const priceTierId = filters.price_tier_id ?? null;
  const useFallback = legacyCogsFallbackEnabled(host);
  const hasPriceTierId = !unified && hasColumn(db, 'orders', 'price_tier_id');

  const params = [];
  let where = `WHERE ${completedStatusWhere(db, 'o')}`;
  const orderDateExpr = tzDateExpr(host, 'o.created_at');
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
  if (priceTierId != null && hasPriceTierId) {
    where += ` AND o.price_tier_id = ?`;
    params.push(priceTierId);
  }
  where += salesChannelWhere('o', filters.sales_channel, params);
  where += ` AND ${posCartReturnExcludeWhere(db, 'o')}`;

  const orderJoinCol = unified ? 'unified_order_id' : 'order_id';
  const salesJoinCol = unified ? 'unified_id' : 'id';
  const cogsExpr = actualCogsLineSql(db, 'oi', null, {
    usePurchaseFallback: useFallback,
    fromUnified: unified,
  });
  const sourceExpr = actualCogsSourceSql(db, 'oi', null, {
    usePurchaseFallback: useFallback,
    fromUnified: unified,
  });
  const soldRevExpr = soldLineRevenueSql('oi');
  const grossExpr = grossLineRevenueSql('oi');
  const soldRevUzs = unifiedFieldUzsSql(db, 'o', 'oi', soldRevExpr);
  const grossUzs = grossLineRevenueUzsSql(db, 'o', 'oi');

  const itemsRow = db
    .prepare(
      `
      SELECT
        COALESCE(SUM(${grossUzs}), 0) AS gross_revenue,
        COALESCE(SUM(CASE
          WHEN UPPER(TRIM(COALESCE(o.currency, 'UZS'))) = 'USD' THEN 0
          ELSE (${grossExpr})
        END), 0) AS gross_revenue_uzs,
        COALESCE(SUM(CASE
          WHEN UPPER(TRIM(COALESCE(o.currency, 'UZS'))) = 'USD' THEN (${grossExpr})
          ELSE 0
        END), 0) AS gross_revenue_usd,
        COALESCE(SUM(${soldRevUzs}), 0) AS net_line_revenue,
        COALESCE(SUM(CASE
          WHEN UPPER(TRIM(COALESCE(o.currency, 'UZS'))) = 'USD' THEN 0
          ELSE (${soldRevExpr})
        END), 0) AS net_line_revenue_uzs,
        COALESCE(SUM(CASE
          WHEN UPPER(TRIM(COALESCE(o.currency, 'UZS'))) = 'USD' THEN (${soldRevExpr})
          ELSE 0
        END), 0) AS net_line_revenue_usd,
        COALESCE(SUM(${cogsExpr}), 0) AS sold_cogs,
        COALESCE(SUM(CASE WHEN ${sourceExpr} = 'fifo' THEN ${cogsExpr} ELSE 0 END), 0) AS cogs_fifo,
        COALESCE(SUM(CASE WHEN ${sourceExpr} = 'weighted_average' THEN ${cogsExpr} ELSE 0 END), 0) AS cogs_wavg,
        COALESCE(SUM(CASE WHEN ${sourceExpr} = 'historical_fallback' THEN ${cogsExpr} ELSE 0 END), 0) AS cogs_fallback,
        COALESCE(SUM(CASE WHEN ${sourceExpr} = 'insufficient' THEN ${cogsExpr} ELSE 0 END), 0) AS cogs_insufficient,
        COALESCE(SUM(CASE WHEN ${sourceExpr} = 'insufficient' THEN 1 ELSE 0 END), 0) AS insufficient_lines,
        COALESCE(SUM(COALESCE(oi.qty_base, oi.quantity, 0)), 0) AS items_sold
      FROM ${itemsTable} oi
      INNER JOIN ${salesTable} o ON o.${salesJoinCol} = oi.${orderJoinCol}
      ${where}
    `
    )
    .get(...params);

  const ordersRow = db
    .prepare(
      `
      SELECT COUNT(DISTINCT o.${salesJoinCol}) AS orders_count
      FROM ${salesTable} o
      ${where}
    `
    )
    .get(...params);

  const ret = computeReturns(host, filters);
  const expenses = computeApprovedExpenses(host, filters);

  const grossRevenue = roundUzs(itemsRow?.gross_revenue);
  const grossRevenueUzs = roundUzs(itemsRow?.gross_revenue_uzs ?? grossRevenue);
  const grossRevenueUsd = money(itemsRow?.gross_revenue_usd);
  const netLine = roundUzs(itemsRow?.net_line_revenue);
  const netLineUzs = roundUzs(itemsRow?.net_line_revenue_uzs ?? netLine);
  const netLineUsd = money(itemsRow?.net_line_revenue_usd);
  const discounts = roundUzs(grossRevenue - netLine);
  const discountUzs = roundUzs(grossRevenueUzs - netLineUzs);
  const discountUsd = Math.max(0, money(grossRevenueUsd) - money(netLineUsd));
  const soldCogs = roundUzs(itemsRow?.sold_cogs);
  const netCogs = roundUzs(soldCogs - ret.returnsCogs);
  const netRevenue = roundUzs(netLine - ret.returnsRevenue);
  const netRevenueUzs = roundUzs(netLineUzs - ret.returnsRevenueUzs);
  const netRevenueUsd = Math.max(0, money(netLineUsd) - money(ret.returnsRevenueUsd));
  const grossProfit = roundUzs(netRevenue - netCogs);
  const netProfit = roundUzs(grossProfit - expenses);
  const ordersCount = Number(ordersRow?.orders_count || 0) || 0;

  const breakdown = {
    fifo: roundUzs(itemsRow?.cogs_fifo),
    weighted_average: roundUzs(itemsRow?.cogs_wavg),
    historical_fallback: roundUzs(itemsRow?.cogs_fallback),
    insufficient: roundUzs(itemsRow?.cogs_insufficient),
  };
  const cogsSource = pickPrimaryCogsSource(breakdown);
  const profitMargin = netRevenue > 0 ? (grossProfit / netRevenue) * 100 : 0;
  const returnRate = netLine > 0 ? (ret.returnsRevenue / netLine) * 100 : 0;

  const dailyRows = db
    .prepare(
      `
      SELECT
        ${orderDateExpr} AS day,
        COALESCE(SUM(${grossUzs}), 0) AS gross_revenue,
        COALESCE(SUM(${soldRevUzs}), 0) AS net_line_revenue,
        COALESCE(SUM(${cogsExpr}), 0) AS sold_cogs
      FROM ${itemsTable} oi
      INNER JOIN ${salesTable} o ON o.${salesJoinCol} = oi.${orderJoinCol}
      ${where}
      GROUP BY ${orderDateExpr}
      ORDER BY day ASC
    `
    )
    .all(...params);

  const series = (dailyRows || []).map((r) => {
    const dayGross = roundUzs(r.gross_revenue);
    const dayNetLine = roundUzs(r.net_line_revenue);
    const dayDiscount = roundUzs(dayGross - dayNetLine);
    const dayCogs = roundUzs(r.sold_cogs);
    return {
      day: r.day,
      gross_revenue: dayGross,
      revenue: dayGross,
      discount: dayDiscount,
      net_sales: dayNetLine,
      cogs: dayCogs,
      gross_profit: roundUzs(dayNetLine - dayCogs),
    };
  });

  const meta = reportMeta(host, filters, {
    cogs_method: cogsSource,
    insufficient_cogs_lines: Number(itemsRow?.insufficient_lines || 0) || 0,
  });

  return {
    gross_revenue: grossRevenue,
    gross_revenue_uzs: grossRevenueUzs,
    gross_revenue_usd: grossRevenueUsd,
    discounts,
    discount: discounts,
    discount_uzs: discountUzs,
    discount_usd: discountUsd,
    returns_revenue: ret.returnsRevenue,
    returns_revenue_uzs: ret.returnsRevenueUzs,
    returns_revenue_usd: ret.returnsRevenueUsd,
    returns_count: ret.returnsCount,
    net_revenue: netRevenue,
    net_sales: netRevenue,
    net_sales_uzs: netRevenueUzs,
    net_sales_usd: netRevenueUsd,
    sold_cogs: soldCogs,
    returns_cogs: ret.returnsCogs,
    cogs: netCogs,
    cogs_source: cogsSource,
    cogs_source_breakdown: breakdown,
    gross_profit: grossProfit,
    expenses,
    total_commission: 0,
    payment_fees: 0,
    net_profit: netProfit,
    orders_count: ordersCount,
    items_sold: money(itemsRow?.items_sold),
    revenue: grossRevenue,
    revenue_uzs: grossRevenueUzs,
    revenue_usd: grossRevenueUsd,
    profit_margin: profitMargin,
    return_rate: returnRate,
    avg_order_value: ordersCount > 0 ? netRevenue / ordersCount : 0,
    series,
    meta,
  };
}

function periodInboundGoods(host, filters = {}) {
  const db = host.db;
  const dateFrom = filters.date_from ? ymdOf(host, filters.date_from) : null;
  const dateTo = filters.date_to ? ymdOf(host, filters.date_to) : null;
  const warehouseId = filters.warehouse_id || null;

  if (hostHasTable(host, 'purchase_receipts') && hostHasTable(host, 'purchase_receipt_items')) {
    const params = [];
    const dateExpr = tzDateExpr(host, 'COALESCE(pr.received_at, pr.created_at)');
    let where = 'WHERE 1=1';
    if (dateFrom) {
      where += ` AND ${dateExpr} >= date(?)`;
      params.push(dateFrom);
    }
    if (dateTo) {
      where += ` AND ${dateExpr} <= date(?)`;
      params.push(dateTo);
    }
    if (warehouseId && hasColumn(db, 'purchase_receipts', 'warehouse_id')) {
      where += ` AND pr.warehouse_id = ?`;
      params.push(warehouseId);
    }
    const costExpr = `CASE
      WHEN UPPER(COALESCE(pr.currency, 'USD')) = 'USD' AND pr.exchange_rate IS NOT NULL
        THEN COALESCE(pri.unit_cost_usd, pri.unit_cost, 0) * pr.exchange_rate
      ELSE COALESCE(pri.unit_cost, 0)
    END`;
    const qtyExpr = hasColumn(db, 'purchase_receipt_items', 'received_qty')
      ? 'COALESCE(pri.received_qty, 0)'
      : hasColumn(db, 'purchase_receipt_items', 'quantity')
        ? 'COALESCE(pri.quantity, 0)'
        : '0';
    const row = db
      .prepare(
        `
        SELECT COALESCE(SUM((${qtyExpr}) * (${costExpr})), 0) AS inbound
        FROM purchase_receipt_items pri
        INNER JOIN purchase_receipts pr ON pr.id = pri.receipt_id
        ${where}
      `
      )
      .get(...params);
    return roundUzs(row?.inbound);
  }

  if (hostHasTable(host, 'purchase_order_items') && hostHasTable(host, 'purchase_orders')) {
    const params = [];
    const dateExpr = tzDateExpr(host, 'COALESCE(po.order_date, po.created_at)');
    let where = `WHERE COALESCE(poi.received_qty, 0) > 0`;
    if (dateFrom) {
      where += ` AND ${dateExpr} >= date(?)`;
      params.push(dateFrom);
    }
    if (dateTo) {
      where += ` AND ${dateExpr} <= date(?)`;
      params.push(dateTo);
    }
    if (warehouseId) {
      where += ` AND po.warehouse_id = ?`;
      params.push(warehouseId);
    }
    const row = db
      .prepare(
        `
        SELECT COALESCE(SUM(COALESCE(poi.received_qty, 0) * COALESCE(poi.unit_cost, 0)), 0) AS inbound
        FROM purchase_order_items poi
        INNER JOIN purchase_orders po ON po.id = poi.purchase_order_id
        ${where}
      `
      )
      .get(...params);
    return roundUzs(row?.inbound);
  }
  return 0;
}

function currentCustomerBuckets(host) {
  const db = host.db;
  if (!hostHasTable(host, 'customers')) {
    return { debt: 0, advance: 0 };
  }
  const cols = new Set((db.prepare(`PRAGMA table_info(customers)`).all() || []).map((c) => c.name));
  if (cols.has('debt_uzs') && cols.has('advance_uzs')) {
    const row = db
      .prepare(
        `
        SELECT
          COALESCE(SUM(COALESCE(debt_uzs, 0)), 0) AS debt,
          COALESCE(SUM(COALESCE(advance_uzs, 0)), 0) AS advance
        FROM customers
        WHERE COALESCE(status, 'active') = 'active'
      `
      )
      .get();
    return { debt: roundUzs(row?.debt), advance: roundUzs(row?.advance) };
  }
  const row = db
    .prepare(
      `
      SELECT
        COALESCE(SUM(CASE WHEN COALESCE(balance, 0) < 0 THEN ABS(balance) ELSE 0 END), 0) AS debt,
        COALESCE(SUM(CASE WHEN COALESCE(balance, 0) > 0 THEN balance ELSE 0 END), 0) AS advance
      FROM customers
      WHERE COALESCE(status, 'active') = 'active'
    `
    )
    .get();
  return { debt: roundUzs(row?.debt), advance: roundUzs(row?.advance) };
}

function periodCustomerDebtAdvanceChange(host, filters = {}) {
  const db = host.db;
  const dateFrom = filters.date_from ? ymdOf(host, filters.date_from) : null;
  const dateTo = filters.date_to ? ymdOf(host, filters.date_to) : null;
  let debtChange = 0;
  let advanceChange = 0;

  if (hostHasTable(host, 'orders')) {
    const params = [];
    const dateExpr = tzDateExpr(host, 'o.created_at');
    let where = `WHERE o.status = 'completed'`;
    if (dateFrom) {
      where += ` AND ${dateExpr} >= date(?)`;
      params.push(dateFrom);
    }
    if (dateTo) {
      where += ` AND ${dateExpr} <= date(?)`;
      params.push(dateTo);
    }
    if (filters.warehouse_id) {
      where += ` AND o.warehouse_id = ?`;
      params.push(filters.warehouse_id);
    }
    const creditExpr = hasColumn(db, 'orders', 'credit_amount')
      ? orderFieldUzsSql(db, 'o', 'credit_amount')
      : '0';
    const row = db
      .prepare(
        `
        SELECT COALESCE(SUM(${creditExpr}), 0) AS credit_issued
        FROM orders o
        ${where}
      `
      )
      .get(...params);
    debtChange += money(row?.credit_issued);
  }

  if (hostHasTable(host, 'customer_payments')) {
    const params = [];
    const dateExpr = tzDateExpr(host, 'COALESCE(cp.paid_at, cp.created_at)');
    let where = 'WHERE 1=1';
    if (dateFrom) {
      where += ` AND ${dateExpr} >= date(?)`;
      params.push(dateFrom);
    }
    if (dateTo) {
      where += ` AND ${dateExpr} <= date(?)`;
      params.push(dateTo);
    }
    const amt = customerPaymentAmountUzsSql(db, 'cp');
    const hasOp = hasColumn(db, 'customer_payments', 'operation');
    const hasOld = hasColumn(db, 'customer_payments', 'old_balance');
    const op = hasOp ? `COALESCE(cp.operation, 'payment_in')` : `'payment_in'`;
    const row = db
      .prepare(
        `
        SELECT
          COALESCE(SUM(CASE
            WHEN ${op} = 'payment_out' THEN ABS(${amt})
            ELSE 0
          END), 0) AS loans,
          COALESCE(SUM(CASE
            WHEN ${op} != 'payment_out' AND ${hasOld ? 'COALESCE(cp.old_balance, 0) < -0.009' : '0'}
              THEN ${amt}
            ELSE 0
          END), 0) AS debt_paid,
          COALESCE(SUM(CASE
            WHEN ${op} != 'payment_out' AND ${hasOld ? 'COALESCE(cp.old_balance, 0) >= -0.009' : '1'}
              THEN ${amt}
            ELSE 0
          END), 0) AS advances_in
        FROM customer_payments cp
        ${where}
      `
      )
      .get(...params);
    debtChange += money(row?.loans) - money(row?.debt_paid);
    advanceChange += money(row?.advances_in) - money(row?.loans);
  }

  return {
    customer_debt_change: roundUzs(debtChange),
    customer_advance_change: roundUzs(advanceChange),
  };
}

function periodSupplierDebtChange(host, filters = {}) {
  const inbound = periodInboundGoods(host, filters);
  let paid = 0;
  const db = host.db;
  if (hostHasTable(host, 'supplier_payments')) {
    const params = [];
    const dateExpr = tzDateExpr(host, 'COALESCE(sp.paid_at, sp.created_at)');
    let where = 'WHERE 1=1';
    if (filters.date_from) {
      where += ` AND ${dateExpr} >= date(?)`;
      params.push(ymdOf(host, filters.date_from));
    }
    if (filters.date_to) {
      where += ` AND ${dateExpr} <= date(?)`;
      params.push(ymdOf(host, filters.date_to));
    }
    const amt = supplierPaymentCashUzsSql(db, 'sp');
    const row = db
      .prepare(
        `
        SELECT COALESCE(SUM(${amt}), 0) AS paid
        FROM supplier_payments sp
        ${where}
          AND LOWER(TRIM(COALESCE(sp.payment_method, ''))) NOT IN ('credit_note')
      `
      )
      .get(...params);
    paid = money(row?.paid);
  }
  return roundUzs(inbound - paid);
}

function currentSupplierDebt(host) {
  const db = host.db;
  if (!hostHasTable(host, 'suppliers')) return 0;
  const cols = new Set((db.prepare(`PRAGMA table_info(suppliers)`).all() || []).map((c) => c.name));
  if (cols.has('balance')) {
    const row = db
      .prepare(
        `
        SELECT COALESCE(SUM(CASE WHEN COALESCE(balance, 0) > 0 THEN balance ELSE 0 END), 0) AS debt
        FROM suppliers
        WHERE COALESCE(is_active, 1) = 1
      `
      )
      .get();
    return roundUzs(row?.debt);
  }
  return 0;
}

function periodCashSnapshot(host, filters = {}) {
  const db = host.db;
  if (!hostHasTable(host, 'shifts')) {
    return {
      opening_cash: 0,
      closing_cash: 0,
      expected_closing_cash: 0,
      actual_closing_cash: null,
      closing_is_provisional: true,
      shifts: [],
    };
  }
  const dateFrom = filters.date_from ? ymdOf(host, filters.date_from) : null;
  const dateTo = filters.date_to ? ymdOf(host, filters.date_to) : null;
  const openedExpr = tzDateExpr(host, 's.opened_at');
  const closedExpr = tzDateExpr(host, 'COALESCE(s.closed_at, s.opened_at)');
  const params = [];
  let where = 'WHERE 1=1';
  if (dateFrom || dateTo) {
    const from = dateFrom || dateTo;
    const to = dateTo || dateFrom;
    where += ` AND ${openedExpr} <= date(?)`;
    params.push(to);
    where += ` AND (${closedExpr} >= date(?) OR s.status = 'open')`;
    params.push(from);
  }
  const rows = db
    .prepare(
      `
      SELECT
        s.id,
        s.user_id,
        s.cashier_id,
        s.status,
        s.opened_at,
        s.closed_at,
        COALESCE(s.opening_cash, 0) AS opening_cash,
        s.closing_cash,
        s.expected_cash,
        s.cash_difference
      FROM shifts s
      ${where}
      ORDER BY datetime(s.opened_at) ASC
    `
    )
    .all(...params);

  const firstByUser = new Map();
  const lastByUser = new Map();
  for (const s of rows || []) {
    const uid = String(s.user_id || s.cashier_id || s.id);
    if (!firstByUser.has(uid)) firstByUser.set(uid, s);
    lastByUser.set(uid, s);
  }

  let opening = 0;
  for (const s of firstByUser.values()) opening += money(s.opening_cash);

  let expectedClosing = 0;
  let actualClosing = 0;
  let anyOpen = false;
  let anyClosed = false;
  for (const s of lastByUser.values()) {
    const expected = s.expected_cash != null ? money(s.expected_cash) : money(s.opening_cash);
    expectedClosing += expected;
    if (String(s.status) === 'closed' && s.closing_cash != null) {
      actualClosing += money(s.closing_cash);
      anyClosed = true;
    } else {
      anyOpen = true;
    }
  }

  return {
    opening_cash: roundUzs(opening),
    expected_closing_cash: roundUzs(expectedClosing),
    actual_closing_cash: anyOpen ? null : roundUzs(actualClosing),
    closing_cash: anyOpen ? roundUzs(expectedClosing) : roundUzs(actualClosing),
    closing_is_provisional: anyOpen,
    closed_shift_count: anyClosed ? lastByUser.size : 0,
    shifts: rows || [],
  };
}

function computeFinancialActSverka(host, filters = {}, extras = {}) {
  const pnl = extras.pnl || computePnL(host, filters);
  const inbound = extras.inbound_goods != null ? extras.inbound_goods : periodInboundGoods(host, filters);
  const cash = extras.cash || periodCashSnapshot(host, filters);
  const currentCust = extras.current_customers || currentCustomerBuckets(host);
  const periodCust = extras.period_customers || periodCustomerDebtAdvanceChange(host, filters);
  const supplierDebtChange =
    extras.supplier_debt_change != null
      ? extras.supplier_debt_change
      : periodSupplierDebtChange(host, filters);
  const currentSupplier = extras.current_supplier_debt != null ? extras.current_supplier_debt : currentSupplierDebt(host);
  const inventoryValue = roundUzs(
    extras.inventory_value != null ? extras.inventory_value : extras.inventorySummary?.total_value
  );

  const lines = [
    { key: 'opening_cash', label: 'Davr boshidagi kassa', amount: cash.opening_cash },
    { key: 'inbound_goods', label: 'Tovar kirimi', amount: inbound },
    { key: 'gross_revenue', label: 'Brutto sotuv', amount: pnl.gross_revenue },
    { key: 'discounts', label: 'Chegirmalar', amount: pnl.discounts },
    { key: 'sales_returns', label: 'Sotuv qaytarishlari', amount: pnl.returns_revenue },
    { key: 'net_revenue', label: 'Sof tushum', amount: pnl.net_revenue },
    { key: 'cogs', label: 'Sotilgan mahsulot tannarxi', amount: pnl.cogs },
    { key: 'gross_profit', label: 'Yalpi foyda', amount: pnl.gross_profit },
    { key: 'approved_expenses', label: 'Tasdiqlangan xarajatlar', amount: pnl.expenses },
    { key: 'net_profit', label: 'Sof foyda', amount: pnl.net_profit },
    { key: 'customer_debt_change', label: 'Mijoz qarzi o‘zgarishi', amount: periodCust.customer_debt_change },
    {
      key: 'customer_advance_change',
      label: 'Mijoz avansi o‘zgarishi',
      amount: periodCust.customer_advance_change,
    },
    { key: 'supplier_debt_change', label: 'Yetkazib beruvchi qarzi o‘zgarishi', amount: supplierDebtChange },
    { key: 'closing_cash', label: 'Davr oxiridagi kassa', amount: cash.closing_cash },
    { key: 'inventory_value', label: 'Davr oxiridagi ombor qiymati', amount: inventoryValue },
  ];

  return {
    lines,
    pnl,
    period: {
      opening_cash: cash.opening_cash,
      closing_cash: cash.closing_cash,
      expected_closing_cash: cash.expected_closing_cash,
      actual_closing_cash: cash.actual_closing_cash,
      closing_is_provisional: cash.closing_is_provisional,
      inbound_goods: inbound,
      ...periodCust,
      supplier_debt_change: supplierDebtChange,
      inventory_value: inventoryValue,
    },
    current: {
      label: 'Joriy holat',
      customer_debt: currentCust.debt,
      customer_advance: currentCust.advance,
      supplier_debt: currentSupplier,
      inventory_value: inventoryValue,
    },
    meta: pnl.meta,
  };
}

function pnlCompareKeys() {
  return ['gross_revenue', 'discounts', 'returns_revenue', 'net_revenue', 'cogs', 'gross_profit', 'expenses', 'net_profit'];
}

function compareFinancialSnapshots(a, b, keys = pnlCompareKeys(), tolerance = 1) {
  const diffs = [];
  for (const key of keys) {
    const left = money(a?.[key]);
    const right = money(b?.[key]);
    if (Math.abs(left - right) > tolerance) {
      diffs.push({ key, left, right, delta: roundUzs(left - right) });
    }
  }
  return diffs;
}

function logReportDivergence(host, payload = {}) {
  const db = host?.db;
  console.warn('[financialCalc] report divergence', payload);
  if (!db || !hasTable(db, 'audit_log')) return;
  try {
    db.prepare(
      `
      INSERT INTO audit_log (
        id, user_id, action, entity_type, entity_id,
        old_values, new_values, ip_address, user_agent, created_at
      ) VALUES (?, NULL, ?, ?, ?, ?, ?, NULL, NULL, ?)
    `
    ).run(
      randomUUID(),
      'financial_report_divergence',
      'report',
      String(payload.report || 'pnl'),
      payload.left ? JSON.stringify(payload.left) : null,
      payload.right ? JSON.stringify(payload.right) : null,
      nowSqlInTimeZone()
    );
  } catch (err) {
    console.warn('[financialCalc] audit_log write failed:', err?.message || err);
  }
}

module.exports = {
  DATA_VERSION,
  COGS_SOURCES,
  roundUzs,
  expectedClosingCash,
  actualCogsLineSql,
  actualCogsSourceSql,
  allocCogsSql,
  grossLineRevenueSql,
  grossLineRevenueUzsSql,
  reportMeta,
  computePnL,
  computeReturns,
  computeApprovedExpenses,
  computeFinancialActSverka,
  periodInboundGoods,
  periodCashSnapshot,
  periodCustomerDebtAdvanceChange,
  periodSupplierDebtChange,
  currentCustomerBuckets,
  compareFinancialSnapshots,
  logReportDivergence,
  cogsLineSql,
};

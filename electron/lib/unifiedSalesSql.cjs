'use strict';

const { orderAmountUzsSql, orderSalesSplitExpressions, orderLinkedFieldUzsSql } = require('./orderAmount.cjs');

function hasView(db, name) {
  try {
    return !!db.prepare(`SELECT 1 AS ok FROM sqlite_master WHERE type='view' AND name = ? LIMIT 1`).get(name)?.ok;
  } catch {
    return false;
  }
}

function useUnifiedSales(db) {
  return hasView(db, 'v_unified_sales') && hasView(db, 'v_unified_sale_items');
}

function salesFrom(db) {
  return useUnifiedSales(db) ? 'v_unified_sales' : 'orders';
}

function saleItemsFrom(db) {
  return useUnifiedSales(db) ? 'v_unified_sale_items' : 'order_items';
}

function salesIdCol(db, alias = 'o') {
  return useUnifiedSales(db) ? `${alias}.unified_id` : `${alias}.id`;
}

function saleItemsOrderJoin(db, salesAlias = 'o', itemsAlias = 'oi') {
  if (useUnifiedSales(db)) {
    return `INNER JOIN v_unified_sale_items ${itemsAlias} ON ${itemsAlias}.unified_order_id = ${salesAlias}.unified_id`;
  }
  return `INNER JOIN order_items ${itemsAlias} ON ${itemsAlias}.order_id = ${salesAlias}.id`;
}

function completedStatusWhere(db, alias = 'o') {
  if (useUnifiedSales(db)) return '1=1';
  return `${alias}.status = 'completed'`;
}

function unifiedAmountUzsSql(db, alias = 'o') {
  if (!useUnifiedSales(db)) return orderAmountUzsSql(db, alias);
  return `CASE
    WHEN UPPER(TRIM(COALESCE(${alias}.currency, 'UZS'))) = 'USD'
      THEN COALESCE(${alias}.total_amount, 0) * COALESCE(${alias}.fx_rate, 0)
    ELSE COALESCE(${alias}.total_amount, 0)
  END`;
}

function unifiedFieldUzsSql(db, salesAlias, itemsAlias, fieldExpr) {
  if (!useUnifiedSales(db)) {
    return orderLinkedFieldUzsSql(db, salesAlias, fieldExpr);
  }
  const s = salesAlias || 'o';
  const f = fieldExpr;
  return `CASE
    WHEN UPPER(TRIM(COALESCE(${s}.currency, 'UZS'))) = 'USD'
      THEN COALESCE(${f}, 0) * COALESCE(${s}.fx_rate, 0)
    ELSE COALESCE(${f}, 0)
  END`;
}

function unifiedSalesSplitExpressions(db, alias = 'o') {
  if (!useUnifiedSales(db)) return orderSalesSplitExpressions(db, alias);
  const a = alias || 'o';
  return {
    uzsSum: `COALESCE(SUM(CASE
      WHEN UPPER(TRIM(COALESCE(${a}.currency, 'UZS'))) = 'USD' THEN 0
      ELSE COALESCE(${a}.total_amount, 0)
    END), 0)`,
    usdSum: `COALESCE(SUM(CASE
      WHEN UPPER(TRIM(COALESCE(${a}.currency, 'UZS'))) = 'USD'
      THEN COALESCE(${a}.total_amount, 0)
      ELSE 0
    END), 0)`,
  };
}

/**
 * Per-unit cost from frozen line cost_price, with catalog fallback for legacy zeros.
 * @param {object} [options]
 * @param {boolean} [options.usePurchaseFallback=true]
 */
function cogsUnitCostSql(itemAlias = 'oi', options = {}) {
  const usePurchaseFallback = options.usePurchaseFallback !== false;
  const frozen = `COALESCE(${itemAlias}.cost_price, 0)`;
  if (!usePurchaseFallback) {
    return `CASE WHEN ${frozen} > 0 THEN ${itemAlias}.cost_price ELSE 0 END`;
  }
  return `CASE
    WHEN ${frozen} > 0 THEN ${itemAlias}.cost_price
    ELSE COALESCE((SELECT purchase_price FROM products WHERE id = ${itemAlias}.product_id LIMIT 1), 0)
  END`;
}

/** Per-line COGS — falls back to products.purchase_price when cost_price is 0 (legacy rows). */
function cogsLineSql(itemAlias = 'oi', qtyExpr = null, options = {}) {
  const qty = qtyExpr || `COALESCE(${itemAlias}.qty_base, ${itemAlias}.quantity, 0)`;
  const unitCost = cogsUnitCostSql(itemAlias, options);
  return `(${unitCost}) * (${qty})`;
}

/** Return line COGS — uses original sale order_items.cost_price (same rules as cogsLineSql). */
function returnCogsLineSql(orderItemAlias = 'oi', returnQtyExpr, options = {}) {
  const unitCost = cogsUnitCostSql(orderItemAlias, options);
  return `(${unitCost}) * (${returnQtyExpr})`;
}

/**
 * Net profit from period aggregates.
 * Official: Gross Profit − Returns Revenue + Returns COGS − Expenses − Commission
 */
function calculateNetProfit({
  grossProfit = 0,
  returnsRevenue = 0,
  returnsCogs = 0,
  expenses = 0,
  commission = 0,
} = {}) {
  const gp = Number(grossProfit) || 0;
  const rr = Number(returnsRevenue) || 0;
  const rc = Number(returnsCogs) || 0;
  const exp = Number(expenses) || 0;
  const fee = Number(commission) || 0;
  return gp - rr + rc - exp - fee;
}

/** Qty sold (sale unit) for revenue / unit-price derivations. */
function soldQtySql(itemAlias = 'oi') {
  return `COALESCE(${itemAlias}.qty_sale, ${itemAlias}.quantity, 0)`;
}

/**
 * Actual amount customer paid for the line (after line + order-level discount allocation).
 * Prefers frozen snapshots (final_total) over catalog line_total.
 */
function soldLineRevenueSql(itemAlias = 'oi') {
  const a = itemAlias;
  const qty = soldQtySql(a);
  return `COALESCE(
    NULLIF(${a}.final_total, 0),
    NULLIF(${a}.line_total, 0),
    (${a}.unit_price * ${qty}) - COALESCE(${a}.discount_amount, 0),
    0
  )`;
}

/** Line revenue in UZS (USD document lines × order fx_rate). Same as P&L sold_revenue. */
function soldLineRevenueUzsSql(db, salesAlias = 'o', itemAlias = 'oi') {
  return unifiedFieldUzsSql(db, salesAlias, itemAlias, soldLineRevenueSql(itemAlias));
}

/** Per-unit price actually paid (post-discount). */
function soldUnitPriceSql(itemAlias = 'oi') {
  const a = itemAlias;
  const qtyNonZero = `NULLIF(ABS(${soldQtySql(a)}), 0)`;
  return `CASE
    WHEN COALESCE(${a}.final_unit_price, 0) != 0 THEN ${a}.final_unit_price
    WHEN ${qtyNonZero} IS NOT NULL AND COALESCE(${a}.final_total, 0) != 0
      THEN ${a}.final_total / ${qtyNonZero}
    WHEN ${qtyNonZero} IS NOT NULL AND COALESCE(${a}.line_total, 0) != 0
      THEN ${a}.line_total / ${qtyNonZero}
    ELSE ${a}.unit_price - COALESCE(${a}.discount_amount, 0) / ${qtyNonZero}
  END`;
}

/** Per-line gross profit: (actual sold revenue) − COGS. */
function profitLineSql(itemAlias = 'oi', qtyExpr = null) {
  return `(${soldLineRevenueSql(itemAlias)}) - (${cogsLineSql(itemAlias, qtyExpr)})`;
}

function salesChannelWhere(alias, channel, params) {
  const ch = channel != null ? String(channel).trim().toLowerCase() : '';
  if (!ch || ch === 'all') return '';
  params.push(ch);
  return ` AND ${alias}.sales_channel = ?`;
}

/** POS savat qaytarishi: manfiy jami buyurtma (F8 / refund_cash) — sotuv emas. */
function isPosCartReturnAmount(amount) {
  return Number(amount || 0) < -0.009;
}

/** SQL: faqat musbat (yoki nol) sotuvlarni qoldirish — manfiy savat qaytarishlarini chiqarib tashlaydi. */
function posCartReturnExcludeWhere(db, alias = 'o') {
  return `${unifiedAmountUzsSql(db, alias)} >= -0.009`;
}

module.exports = {
  hasView,
  useUnifiedSales,
  salesFrom,
  saleItemsFrom,
  salesIdCol,
  saleItemsOrderJoin,
  completedStatusWhere,
  unifiedAmountUzsSql,
  unifiedFieldUzsSql,
  unifiedSalesSplitExpressions,
  cogsUnitCostSql,
  cogsLineSql,
  returnCogsLineSql,
  calculateNetProfit,
  soldQtySql,
  soldLineRevenueSql,
  soldLineRevenueUzsSql,
  soldUnitPriceSql,
  profitLineSql,
  salesChannelWhere,
  isPosCartReturnAmount,
  posCartReturnExcludeWhere,
};

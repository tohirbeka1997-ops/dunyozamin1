'use strict';

const { formatYmdInTimeZone, UZBEKISTAN_TIMEZONE } = require('./timezone.cjs');

const COST_METHODS = new Set(['weighted_average', 'fifo', 'compare']);
const SORT_FIELDS = {
  name: 'product_name',
  sku: 'product_sku',
  stock: 'current_stock',
  value: 'stock_value',
  diff: 'diff_amount',
  wavg_value: 'wavg_value',
  fifo_value: 'fifo_value',
};

function normalizeCostMethod(raw) {
  const v = String(raw || '').trim().toLowerCase().replace(/[-\s]+/g, '_');
  if (v === 'wavg' || v === 'avg' || v === 'average' || v === 'weighted') return 'weighted_average';
  if (v === 'solishtirish' || v === 'comparison' || v === 'compare') return 'compare';
  if (COST_METHODS.has(v)) return v;
  return null;
}

function money(n) {
  const x = Number(n);
  return Number.isFinite(x) ? x : 0;
}

function batchCostExpr(db) {
  try {
    const cols = new Set((db.prepare(`PRAGMA table_info(inventory_batches)`).all() || []).map((c) => c.name));
    if (cols.has('cost_price_uzs')) return 'COALESCE(cost_price_uzs, unit_cost, 0)';
  } catch {
    /* keep unit_cost */
  }
  return 'COALESCE(unit_cost, 0)';
}

function receiptUnitCostSql() {
  return `CASE
    WHEN UPPER(COALESCE(pr.currency, 'USD')) = 'USD'
      AND pr.exchange_rate IS NOT NULL
      THEN COALESCE(pri.unit_cost_usd, pri.unit_cost, 0) * pr.exchange_rate
    ELSE COALESCE(pri.unit_cost, 0)
  END`;
}

function hasColumn(db, table, col) {
  try {
    return (db.prepare(`PRAGMA table_info(${table})`).all() || []).some((c) => c.name === col);
  } catch {
    return false;
  }
}

/**
 * Last movement after_quantity as of a Tashkent calendar date.
 * Per product (+ warehouse), then summed when warehouse is ALL.
 */
function asOfStockCte(ctx, { asOfYmd, warehouseId, isAllWarehouses }) {
  const tz = ctx._tzDateExpr('im.created_at');
  const params = [asOfYmd];
  let warehouseFilter = '';
  if (!isAllWarehouses && warehouseId) {
    warehouseFilter = 'AND im.warehouse_id = ?';
    params.push(warehouseId);
  }
  const cteSql = `
    ranked_moves AS (
      SELECT
        im.product_id,
        im.warehouse_id,
        im.after_quantity,
        ROW_NUMBER() OVER (
          PARTITION BY im.product_id, im.warehouse_id
          ORDER BY datetime(replace(replace(im.created_at, 'T', ' '), 'Z', '')) DESC, im.rowid DESC
        ) AS rn
      FROM inventory_movements im
      WHERE ${tz} <= date(?)
        ${warehouseFilter}
    ),
    stock_src AS (
      SELECT
        product_id,
        SUM(COALESCE(after_quantity, 0)) AS quantity
      FROM ranked_moves
      WHERE rn = 1
      GROUP BY product_id
    )`;
  return { cteSql, params };
}

function liveStockCte({ warehouseId, isAllWarehouses }) {
  if (isAllWarehouses) {
    return {
      cteSql: `
        stock_src AS (
          SELECT product_id, SUM(quantity) AS quantity
          FROM stock_balances
          GROUP BY product_id
        )`,
      params: [],
    };
  }
  return {
    cteSql: `
      stock_src AS (
        SELECT product_id, SUM(quantity) AS quantity
        FROM stock_balances
        WHERE warehouse_id = ?
        GROUP BY product_id
      )`,
    params: [warehouseId],
  };
}

function runInventoryValuation(ctx, filters = {}) {
  const db = ctx.db;
  if (!ctx._hasTable('products') || !ctx._hasTable('stock_balances')) {
    return [];
  }

  const warehouseIdRaw = filters.warehouse_id;
  const isAllWarehouses = !warehouseIdRaw || String(warehouseIdRaw).toUpperCase() === 'ALL';
  const warehouseId = isAllWarehouses ? null : warehouseIdRaw;

  const today = ctx._ymd(new Date());
  const asOfRaw = filters.as_of || filters.as_of_date || null;
  const asOfYmd = asOfRaw ? ctx._ymd(asOfRaw) : null;
  const useAsOf = Boolean(asOfYmd && asOfYmd < today && ctx._hasTable('inventory_movements'));

  const fifoEnabled =
    ctx._isTruthySetting('inventory.fifo_enabled') ||
    ctx._isTruthySetting('inventory.batch_mode_enabled') ||
    ctx._isTruthySetting('batch_mode_enabled');
  const hasBatches = ctx._hasTable('inventory_batches');
  const hasReceipts = ctx._hasTable('purchase_receipts') && ctx._hasTable('purchase_receipt_items');
  const hasUnit = hasColumn(db, 'products', 'unit');
  const costMethod = normalizeCostMethod(filters.cost_method);

  const stockCte = useAsOf
    ? asOfStockCte(ctx, { asOfYmd, warehouseId, isAllWarehouses })
    : liveStockCte({ warehouseId, isAllWarehouses });

  const ctes = [stockCte.cteSql];
  const params = [...stockCte.params];

  const receiptDateExpr = hasReceipts
    ? ctx._tzDateExpr('COALESCE(pr.received_at, pr.created_at)')
    : 'date(?)';
  if (hasReceipts) {
    const receiptWh = isAllWarehouses ? '' : 'AND pr.warehouse_id = ?';
    const asOfReceipt = asOfYmd ? `AND ${receiptDateExpr} <= date(?)` : '';
    ctes.push(`
      receipt_costs AS (
        SELECT
          pri.product_id,
          SUM(pri.received_qty) AS qty,
          SUM(pri.received_qty * (${receiptUnitCostSql()})) AS cost_uzs
        FROM purchase_receipt_items pri
        INNER JOIN purchase_receipts pr ON pr.id = pri.receipt_id
        WHERE 1=1
          ${receiptWh}
          ${asOfReceipt}
        GROUP BY pri.product_id
      )`);
    if (!isAllWarehouses) params.push(warehouseId);
    if (asOfYmd) params.push(asOfYmd);
  } else {
    ctes.push(`
      receipt_costs AS (
        SELECT CAST(NULL AS TEXT) AS product_id, 0.0 AS qty, 0.0 AS cost_uzs
        WHERE 0
      )`);
  }

  const useBatchFifo = hasBatches && !useAsOf;
  if (useBatchFifo) {
    const bCost = batchCostExpr(db);
    const batchWh = isAllWarehouses ? '' : 'WHERE warehouse_id = ?';
    ctes.push(`
      batch_costs AS (
        SELECT
          product_id,
          SUM(remaining_qty) AS remaining_qty,
          SUM(remaining_qty * ${bCost}) AS remaining_value
        FROM inventory_batches
        ${batchWh}
        GROUP BY product_id
      )`);
    if (!isAllWarehouses) params.push(warehouseId);
  } else {
    ctes.push(`
      batch_costs AS (
        SELECT CAST(NULL AS TEXT) AS product_id, 0.0 AS remaining_qty, 0.0 AS remaining_value
        WHERE 0
      )`);
  }

  if (useAsOf && hasReceipts) {
    const receiptWh = isAllWarehouses ? '' : 'AND pr.warehouse_id = ?';
    ctes.push(`
      fifo_layers AS (
        SELECT
          pri.product_id,
          pri.received_qty AS layer_qty,
          (${receiptUnitCostSql()}) AS layer_cost,
          SUM(pri.received_qty) OVER (
            PARTITION BY pri.product_id
            ORDER BY datetime(COALESCE(pr.received_at, pr.created_at)) DESC, pri.rowid DESC
          ) AS cum_newest
        FROM purchase_receipt_items pri
        INNER JOIN purchase_receipts pr ON pr.id = pri.receipt_id
        WHERE ${receiptDateExpr} <= date(?)
          ${receiptWh}
      ),
      fifo_hist AS (
        SELECT
          p.id AS product_id,
          CASE
            WHEN COALESCE(st.quantity, 0) <= 0 THEN 0
            ELSE
              COALESCE((
                SELECT SUM(
                  CASE
                    WHEN fl.cum_newest <= COALESCE(st.quantity, 0) THEN fl.layer_qty * fl.layer_cost
                    WHEN fl.cum_newest - fl.layer_qty < COALESCE(st.quantity, 0)
                      THEN (COALESCE(st.quantity, 0) - (fl.cum_newest - fl.layer_qty)) * fl.layer_cost
                    ELSE 0
                  END
                )
                FROM fifo_layers fl
                WHERE fl.product_id = p.id
              ), 0)
              + CASE
                  WHEN COALESCE(st.quantity, 0) > COALESCE((
                    SELECT SUM(fl2.layer_qty) FROM fifo_layers fl2 WHERE fl2.product_id = p.id
                  ), 0)
                  THEN (COALESCE(st.quantity, 0) - COALESCE((
                    SELECT SUM(fl3.layer_qty) FROM fifo_layers fl3 WHERE fl3.product_id = p.id
                  ), 0)) * COALESCE(p.purchase_price, 0)
                  ELSE 0
                END
          END AS fifo_value
        FROM products p
        LEFT JOIN stock_src st ON st.product_id = p.id
      )`);
    params.push(asOfYmd);
    if (!isAllWarehouses) params.push(warehouseId);
  } else {
    ctes.push(`
      fifo_hist AS (
        SELECT CAST(NULL AS TEXT) AS product_id, 0.0 AS fifo_value
        WHERE 0
      )`);
  }

  const qtyExpr = 'COALESCE(st.quantity, 0)';
  const catalogValue = `${qtyExpr} * COALESCE(p.purchase_price, 0)`;
  const wavgUnit = `COALESCE(
    (rc.cost_uzs / NULLIF(rc.qty, 0)),
    NULLIF(p.purchase_price, 0),
    0
  )`;
  const wavgValue = `${qtyExpr} * (${wavgUnit})`;
  const liveFifoValue = ctx._fifoOnHandValueSql('st.quantity');
  const fifoValueSql = useAsOf
    ? `COALESCE(fh.fifo_value, ${catalogValue})`
    : useBatchFifo
      ? `(${liveFifoValue})`
      : catalogValue;

  const methodToken = costMethod || '';
  const stockValueSql = `
    CASE
      WHEN ? = 'fifo' THEN (${fifoValueSql})
      WHEN ? IN ('weighted_average', 'compare') THEN (${wavgValue})
      WHEN ? = 1 THEN (${fifoValueSql})
      ELSE (${catalogValue})
    END`;

  const statusFilter = filters.status || 'active';
  const statusWhere =
    statusFilter === 'inactive'
      ? `AND p.is_active = 0`
      : statusFilter === 'all'
        ? `AND 1=1`
        : `AND p.is_active = 1`;

  const whereParams = [];
  const extraWhere = [];
  if (filters.category_id && filters.category_id !== 'all') {
    extraWhere.push('AND p.category_id = ?');
    whereParams.push(filters.category_id);
  }
  const search = String(filters.search || filters.searchTerm || '').trim();
  if (search) {
    extraWhere.push("AND (LOWER(p.name) LIKE ? OR LOWER(COALESCE(p.sku, '')) LIKE ?)");
    const like = `%${search.toLowerCase()}%`;
    whereParams.push(like, like);
  }
  if (filters.product_id) {
    extraWhere.push('AND p.id = ?');
    whereParams.push(filters.product_id);
  }

  const stockStatus = String(filters.stock_status || '').trim();
  if (stockStatus === 'out_of_stock') {
    extraWhere.push(`AND ${qtyExpr} <= 0`);
  } else if (stockStatus === 'low') {
    extraWhere.push(`AND ${qtyExpr} > 0 AND ${qtyExpr} <= COALESCE(p.min_stock_level, 0)`);
  } else if (stockStatus === 'ok') {
    extraWhere.push(`AND ${qtyExpr} > COALESCE(p.min_stock_level, 0)`);
  }

  const diffsOnly =
    filters.diffs_only === true ||
    filters.diffs_only === 1 ||
    String(filters.diffs_only || '').toLowerCase() === 'true' ||
    String(filters.diffs_only || '') === '1';
  if (diffsOnly) {
    extraWhere.push(`AND ABS((${fifoValueSql}) - (${wavgValue})) > 0.009`);
  }

  const sortField = SORT_FIELDS[String(filters.sort || filters.sort_field || 'name')] || 'product_name';
  const sortDir = String(filters.sort_order || filters.sortOrder || 'asc').toLowerCase() === 'desc' ? 'DESC' : 'ASC';
  const orderSql =
    sortField === 'product_name' || sortField === 'product_sku'
      ? `${sortField} COLLATE NOCASE ${sortDir}`
      : `${sortField} ${sortDir}, product_name COLLATE NOCASE ASC`;

  const methodParams = [methodToken, methodToken, fifoEnabled ? 1 : 0];

  const sql = `
    WITH
    ${ctes.join(',\n')}
    SELECT
      p.id AS product_id,
      p.name AS product_name,
      p.sku AS product_sku,
      p.category_id,
      c.name AS category_name,
      ${hasUnit ? 'p.unit AS unit,' : `'pcs' AS unit,`}
      COALESCE(p.min_stock_level, 0) AS min_stock_level,
      COALESCE(p.purchase_price, 0) AS purchase_price,
      ${qtyExpr} AS current_stock,
      (${wavgUnit}) AS wavg_unit_cost,
      (${wavgValue}) AS wavg_value,
      CASE
        WHEN ${qtyExpr} > 0 THEN (${fifoValueSql}) / ${qtyExpr}
        ELSE COALESCE(NULLIF(p.purchase_price, 0), 0)
      END AS fifo_unit_cost,
      (${fifoValueSql}) AS fifo_value,
      ((${fifoValueSql}) - (${wavgValue})) AS diff_amount,
      CASE
        WHEN ABS(${wavgValue}) > 0.009 THEN (((${fifoValueSql}) - (${wavgValue})) / ${wavgValue}) * 100.0
        WHEN ABS(${fifoValueSql}) > 0.009 THEN 100.0
        ELSE 0
      END AS diff_pct,
      ${stockValueSql} AS stock_value,
      CASE
        WHEN ${qtyExpr} > 0 THEN (${stockValueSql}) / ${qtyExpr}
        ELSE COALESCE(NULLIF(p.purchase_price, 0), 0)
      END AS unit_cost,
      CASE
        WHEN COALESCE(bc.remaining_qty, 0) <= 0 THEN 0
        WHEN ${qtyExpr} <= 0 THEN COALESCE(bc.remaining_value, 0)
        WHEN COALESCE(bc.remaining_qty, 0) <= ${qtyExpr} THEN 0
        ELSE COALESCE(bc.remaining_value, 0) * (1.0 - ${qtyExpr} * 1.0 / COALESCE(bc.remaining_qty, 0))
      END AS phantom_batch_value,
      CASE
        WHEN COALESCE(bc.remaining_qty, 0) > ${qtyExpr} THEN COALESCE(bc.remaining_qty, 0) - ${qtyExpr}
        ELSE 0
      END AS phantom_batch_qty
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    LEFT JOIN stock_src st ON st.product_id = p.id
    LEFT JOIN receipt_costs rc ON rc.product_id = p.id
    LEFT JOIN batch_costs bc ON bc.product_id = p.id
    LEFT JOIN fifo_hist fh ON fh.product_id = p.id
    WHERE 1=1
      ${statusWhere}
      ${extraWhere.join('\n      ')}
    ORDER BY ${orderSql}
  `;

  const selectParams = [...params, ...methodParams, ...methodParams, ...whereParams];
  return db.prepare(sql).all(...selectParams) || [];
}

function summarizeInventoryValuation(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const total_value = list.reduce((sum, r) => sum + money(r.stock_value), 0);
  const wavg_total = list.reduce((sum, r) => sum + money(r.wavg_value), 0);
  const fifo_total = list.reduce((sum, r) => sum + money(r.fifo_value), 0);
  const diff_amount = list.reduce((sum, r) => sum + money(r.diff_amount), 0);
  const phantom_batch_value = list.reduce((sum, r) => sum + money(r.phantom_batch_value), 0);
  const phantom_product_count = list.filter((r) => money(r.phantom_batch_value) > 0.009).length;
  const total_quantity = list.reduce((sum, r) => sum + money(r.current_stock), 0);
  const products_count = list.length;
  const out_of_stock_count = list.filter((r) => money(r.current_stock) <= 0).length;
  const low_stock_count = list.filter((r) => {
    const stock = money(r.current_stock);
    const min = money(r.min_stock_level);
    return stock > 0 && stock <= min;
  }).length;
  const diff_row_count = list.filter((r) => Math.abs(money(r.diff_amount)) > 0.009).length;
  return {
    total_value,
    wavg_total,
    fifo_total,
    diff_amount,
    diff_pct: Math.abs(wavg_total) > 0.009 ? (diff_amount / wavg_total) * 100 : fifo_total !== 0 ? 100 : 0,
    phantom_batch_value,
    phantom_product_count,
    total_quantity,
    products_count,
    out_of_stock_count,
    low_stock_count,
    diff_row_count,
  };
}

function valuationMeta(ctx, filters = {}, extras = {}) {
  const today = ctx._ymd(new Date());
  const asOf = filters.as_of || filters.as_of_date || null;
  const asOfYmd = asOf ? ctx._ymd(asOf) : today;
  const method = normalizeCostMethod(filters.cost_method) || (extras.legacyFifo ? 'fifo' : 'weighted_average');
  const useAsOf = Boolean(asOf && ctx._ymd(asOf) < today);
  return {
    computed_at: new Date().toISOString(),
    timezone: UZBEKISTAN_TIMEZONE,
    cost_method: method,
    as_of_date: asOfYmd,
    as_of_mode: extras.as_of_mode || (asOf ? 'date' : 'today'),
    data_source: useAsOf
      ? 'inventory_movements.after_quantity + purchase_receipts/batches'
      : 'stock_balances + purchase_receipts/batches',
  };
}

module.exports = {
  COST_METHODS,
  normalizeCostMethod,
  runInventoryValuation,
  summarizeInventoryValuation,
  valuationMeta,
  formatYmdInTimeZone,
};

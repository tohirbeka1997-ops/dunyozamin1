'use strict';

const { UZBEKISTAN_TIMEZONE, formatYmdInTimeZone } = require('./timezone.cjs');
const { normalizeUnit } = require('./qty.cjs');
const { computePurchasePlanningRow, statusRank, FORMULA, STATUSES } = require('./purchasePlanningCalc.cjs');

function hasTable(db, name) {
  try {
    return !!db.prepare(`SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name = ? LIMIT 1`).get(name)?.ok;
  } catch {
    return false;
  }
}

function hasCol(db, table, col) {
  try {
    return !!db.prepare(`SELECT 1 AS ok FROM pragma_table_info('${String(table).replace(/'/g, '')}') WHERE name = ? LIMIT 1`).get(col)?.ok;
  } catch {
    return false;
  }
}

function toMapSum(rows, key, valueKey) {
  const map = new Map();
  for (const r of rows || []) {
    if (!r || r[key] == null) continue;
    map.set(r[key], Number(r[valueKey] || 0) || 0);
  }
  return map;
}

function resolveWarehouseId(db, filters) {
  let warehouseId = filters.warehouse_id || null;
  if (!warehouseId && hasTable(db, 'warehouses')) {
    try {
      const def = db.prepare(`SELECT id FROM warehouses WHERE is_default = 1 LIMIT 1`).get();
      warehouseId = def?.id || 'main-warehouse-001';
    } catch {
      warehouseId = 'main-warehouse-001';
    }
  }
  return warehouseId || 'main-warehouse-001';
}

function loadQtyMap(db, sql, params) {
  try {
    return toMapSum(db.prepare(sql).all(...params), 'product_id', 'qty');
  } catch {
    return new Map();
  }
}

function runPurchasePlanning(db, filters, tzDateExpr) {
  const started = Date.now();
  const analysisDaysRaw = Number(filters.analysis_days ?? 7);
  const planDaysRaw = Number(filters.plan_days ?? 7);
  const safetyDaysRaw = Number(filters.safety_days ?? 2);
  const analysisDays = [7, 14, 30].includes(analysisDaysRaw) ? analysisDaysRaw : 7;
  const planDays = [7, 14].includes(planDaysRaw) ? planDaysRaw : 7;
  const safetyDays = Number.isFinite(safetyDaysRaw) && safetyDaysRaw >= 0 && safetyDaysRaw <= 30 ? safetyDaysRaw : 2;

  if (!hasTable(db, 'products')) {
    return emptyResult(started, analysisDays, planDays, safetyDays, filters);
  }

  const warehouseId = resolveWarehouseId(db, filters);
  const dateTo = typeof filters.date_to === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(filters.date_to)
    ? filters.date_to
    : formatYmdInTimeZone(filters.date_to || new Date());
  const end = new Date(`${dateTo}T00:00:00Z`);
  const start = new Date(end.getTime() - (analysisDays - 1) * 86400000);
  const dateFrom = formatYmdInTimeZone(start);

  const hasCurrentStock = hasCol(db, 'products', 'current_stock');
  const hasBaseUnit = hasCol(db, 'products', 'base_unit');
  const hasUnitCol = hasCol(db, 'products', 'unit');
  const hasPurchaseSettings = hasTable(db, 'product_purchase_settings');
  const hasBlocked = hasCol(db, 'stock_balances', 'blocked_quantity');
  const hasInTransfer = hasCol(db, 'stock_balances', 'in_transfer_quantity');
  const hasProdSupplier = hasCol(db, 'products', 'preferred_supplier_id');
  const hasProdLead = hasCol(db, 'products', 'lead_time_days');
  const hasProdMoq = hasCol(db, 'products', 'moq');
  const hasProdStep = hasCol(db, 'products', 'order_step');
  const hasProdPrec = hasCol(db, 'products', 'qty_precision');

  const unitExpr = hasBaseUnit
    ? `COALESCE(NULLIF(p.base_unit, ''), ${hasUnitCol ? 'NULLIF(p.unit, \'\')' : 'NULL'}, u.code, 'pcs')`
    : hasUnitCol
      ? `COALESCE(NULLIF(p.unit, ''), u.code, 'pcs')`
      : `COALESCE(u.code, 'pcs')`;

  const search = String(filters.search || filters.q || '').trim();
  const productParams = [];
  let productQuery = `
    SELECT
      p.id AS product_id,
      p.name AS product_name,
      p.sku AS product_sku,
      ${unitExpr} AS unit,
      ${hasCurrentStock ? 'COALESCE(p.current_stock, 0)' : '0'} AS product_current_stock,
      p.category_id AS category_id,
      c.name AS category_name,
      ${hasPurchaseSettings || hasProdSupplier ? `
      ${hasPurchaseSettings && hasProdSupplier
        ? 'COALESCE(pps.preferred_supplier_id, p.preferred_supplier_id)'
        : hasPurchaseSettings
          ? 'pps.preferred_supplier_id'
          : 'p.preferred_supplier_id'} AS preferred_supplier_id,
      ${hasPurchaseSettings && hasProdLead
        ? 'COALESCE(pps.lead_time_days, p.lead_time_days)'
        : hasPurchaseSettings
          ? 'pps.lead_time_days'
          : hasProdLead
            ? 'p.lead_time_days'
            : 'NULL'} AS lead_time_days,
      ${hasPurchaseSettings && hasProdMoq
        ? 'COALESCE(pps.moq, p.moq)'
        : hasPurchaseSettings
          ? 'pps.moq'
          : hasProdMoq
            ? 'p.moq'
            : 'NULL'} AS moq,
      ${hasPurchaseSettings && hasProdStep
        ? 'COALESCE(pps.order_step, p.order_step)'
        : hasPurchaseSettings
          ? 'pps.order_step'
          : hasProdStep
            ? 'p.order_step'
            : 'NULL'} AS order_step,
      ${hasPurchaseSettings && hasProdPrec
        ? 'COALESCE(pps.qty_precision, p.qty_precision)'
        : hasPurchaseSettings
          ? 'pps.qty_precision'
          : hasProdPrec
            ? 'p.qty_precision'
            : 'NULL'} AS qty_precision
      ` : `
      NULL AS preferred_supplier_id,
      NULL AS lead_time_days,
      NULL AS moq,
      NULL AS order_step,
      NULL AS qty_precision
      `}
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    LEFT JOIN units u ON u.id = p.unit_id
    ${hasPurchaseSettings ? 'LEFT JOIN product_purchase_settings pps ON pps.product_id = p.id' : ''}
    WHERE p.is_active = 1
  `;
  if (filters.category_id) {
    productQuery += ` AND p.category_id = ?`;
    productParams.push(filters.category_id);
  }
  if (search) {
    productQuery += ` AND (LOWER(p.name) LIKE ? OR LOWER(COALESCE(p.sku, '')) LIKE ?)`;
    const like = `%${search.toLowerCase()}%`;
    productParams.push(like, like);
  }
  productQuery += ` ORDER BY p.name ASC`;

  const products = db.prepare(productQuery).all(productParams);
  if (!products?.length) {
    return emptyResult(started, analysisDays, planDays, safetyDays, filters, {
      date_from: dateFrom,
      date_to: dateTo,
      warehouse_id: warehouseId,
    });
  }

  const soldByProduct = new Map();
  if (hasTable(db, 'orders') && hasTable(db, 'order_items')) {
    const hasQtyBase = hasCol(db, 'order_items', 'qty_base');
    const qtyExpr = hasQtyBase ? 'COALESCE(oi.qty_base, oi.quantity)' : 'oi.quantity';
    const salesRows = db
      .prepare(
        `
        SELECT
          oi.product_id,
          COALESCE(SUM(${qtyExpr}), 0) AS qty
        FROM order_items oi
        INNER JOIN orders o ON o.id = oi.order_id
        WHERE COALESCE(LOWER(o.status), '') = 'completed'
          AND ${tzDateExpr('o.created_at')} BETWEEN date(?) AND date(?)
        GROUP BY oi.product_id
      `,
      )
      .all(dateFrom, dateTo);
    for (const r of salesRows || []) {
      soldByProduct.set(r.product_id, Number(r.qty || 0) || 0);
    }
  }

  const stockByProduct = new Map();
  const reservedByProduct = new Map();
  const blockedByProduct = new Map();
  const inTransferByProduct = new Map();
  if (hasTable(db, 'stock_balances')) {
    const stockRows = db
      .prepare(
        `
        SELECT
          product_id,
          COALESCE(SUM(quantity), 0) AS qty,
          COALESCE(SUM(reserved_quantity), 0) AS reserved_qty
          ${hasBlocked ? ', COALESCE(SUM(blocked_quantity), 0) AS blocked_qty' : ''}
          ${hasInTransfer ? ', COALESCE(SUM(in_transfer_quantity), 0) AS in_transfer_qty' : ''}
        FROM stock_balances
        WHERE warehouse_id = ?
        GROUP BY product_id
      `,
      )
      .all(warehouseId);
    for (const r of stockRows || []) {
      stockByProduct.set(r.product_id, Number(r.qty || 0) || 0);
      reservedByProduct.set(r.product_id, Number(r.reserved_qty || 0) || 0);
      if (hasBlocked) blockedByProduct.set(r.product_id, Number(r.blocked_qty || 0) || 0);
      if (hasInTransfer) inTransferByProduct.set(r.product_id, Number(r.in_transfer_qty || 0) || 0);
    }
  }

  const inboundByProduct = new Map();
  if (hasTable(db, 'purchase_order_items') && hasTable(db, 'purchase_orders')) {
    const inboundRows = db
      .prepare(
        `
        SELECT
          poi.product_id,
          COALESCE(SUM(
            CASE
              WHEN COALESCE(poi.ordered_qty, 0) - COALESCE(poi.received_qty, 0) > 0
              THEN COALESCE(poi.ordered_qty, 0) - COALESCE(poi.received_qty, 0)
              ELSE 0
            END
          ), 0) AS qty
        FROM purchase_order_items poi
        INNER JOIN purchase_orders po ON po.id = poi.purchase_order_id
        WHERE LOWER(COALESCE(po.status, '')) IN ('approved', 'partially_received', 'ordered', 'confirmed', 'sent', 'open')
        GROUP BY poi.product_id
      `,
      )
      .all();
    for (const r of inboundRows || []) inboundByProduct.set(r.product_id, Number(r.qty || 0) || 0);
  }

  const revisionByProduct = loadQtyMap(
    db,
    hasTable(db, 'inventory_revision_items') && hasTable(db, 'inventory_revisions')
      ? `
        SELECT iri.product_id, COALESCE(SUM(COALESCE(iri.system_qty, 0)), 0) AS qty
        FROM inventory_revision_items iri
        INNER JOIN inventory_revisions ir ON ir.id = iri.revision_id
        WHERE LOWER(COALESCE(ir.status, '')) IN ('draft', 'in_progress')
          AND ir.warehouse_id = ?
        GROUP BY iri.product_id
      `
      : `SELECT NULL AS product_id, 0 AS qty WHERE 0`,
    hasTable(db, 'inventory_revision_items') ? [warehouseId] : [],
  );

  const lastPurchaseByProduct = new Map();
  const prevPurchaseByProduct = new Map();
  if (hasTable(db, 'purchase_receipts') && hasTable(db, 'purchase_receipt_items')) {
    const hasCurrency = hasCol(db, 'purchase_receipts', 'currency');
    const rows = db
      .prepare(
        `
        SELECT
          pri.product_id,
          pri.unit_cost,
          COALESCE(pr.received_at, pr.created_at) AS purchased_at,
          pr.supplier_id,
          s.name AS supplier_name
          ${hasCurrency ? ", COALESCE(pr.currency, 'UZS') AS currency" : ", 'UZS' AS currency"}
        FROM purchase_receipt_items pri
        INNER JOIN purchase_receipts pr ON pr.id = pri.receipt_id
        LEFT JOIN suppliers s ON s.id = pr.supplier_id
        ORDER BY pri.product_id,
          COALESCE(pr.received_at, pr.created_at) DESC,
          pri.id DESC
      `,
      )
      .all();
    for (const r of rows || []) {
      if (!lastPurchaseByProduct.has(r.product_id)) {
        lastPurchaseByProduct.set(r.product_id, r);
      } else if (!prevPurchaseByProduct.has(r.product_id)) {
        prevPurchaseByProduct.set(r.product_id, r);
      }
    }
  }

  const preferredSupplierNames = new Map();
  if (hasTable(db, 'suppliers')) {
    const ids = [...new Set(products.map((p) => p.preferred_supplier_id).filter(Boolean))];
    if (ids.length) {
      const placeholders = ids.map(() => '?').join(',');
      const sups = db.prepare(`SELECT id, name FROM suppliers WHERE id IN (${placeholders})`).all(...ids);
      for (const s of sups || []) preferredSupplierNames.set(s.id, s.name);
    }
  }

  const onlyRisk = Boolean(filters.only_risk);
  const statusFilter = String(filters.status || '').toUpperCase();
  const sortBy = String(filters.sort_by || 'status');
  const sortDir = String(filters.sort_dir || 'asc').toLowerCase() === 'desc' ? -1 : 1;
  const page = Math.max(1, Math.floor(Number(filters.page) || 1));
  const pageSizeRaw = Number(filters.page_size);
  const pageSize = Number.isFinite(pageSizeRaw) && pageSizeRaw > 0 ? Math.min(5000, Math.floor(pageSizeRaw)) : null;

  const rows = [];
  for (const p of products) {
    const last = lastPurchaseByProduct.get(p.product_id) || null;
    const prev = prevPurchaseByProduct.get(p.product_id) || null;
    const preferredId = p.preferred_supplier_id || null;
    const supplierId = preferredId || last?.supplier_id || null;
    const supplierName = preferredId
      ? preferredSupplierNames.get(preferredId) || last?.supplier_name || null
      : last?.supplier_name || null;
    const unit = p.unit || 'pcs';
    const hasUnit = !!normalizeUnit(unit);
    const onHand = stockByProduct.has(p.product_id)
      ? stockByProduct.get(p.product_id)
      : Number(p.product_current_stock || 0) || 0;

    const calc = computePurchasePlanningRow({
      analysisDays,
      planningDays: planDays,
      safetyDays,
      soldQty: soldByProduct.get(p.product_id) || 0,
      onHandQty: onHand,
      reservedQty: reservedByProduct.get(p.product_id) || 0,
      blockedQty: blockedByProduct.get(p.product_id) || 0,
      confirmedInboundQty: inboundByProduct.get(p.product_id) || 0,
      inTransferQty: inTransferByProduct.get(p.product_id) || 0,
      revisionQty: revisionByProduct.get(p.product_id) || 0,
      unit,
      qtyPrecision: p.qty_precision,
      moq: p.moq,
      orderStep: p.order_step,
      lastPurchasePrice: last ? last.unit_cost : null,
      previousPurchasePrice: prev ? prev.unit_cost : null,
      currency: last?.currency || 'UZS',
      hasSupplier: !!supplierId,
      hasUnit,
    });

    rows.push({
      product_id: p.product_id,
      product_name: p.product_name,
      product_sku: p.product_sku,
      unit,
      category_id: p.category_id ?? null,
      category_name: p.category_name ?? null,
      supplier_id: supplierId,
      supplier_name: supplierName,
      supplier_source: preferredId ? 'preferred' : last ? 'last' : null,
      last_purchase_cost: last ? Number(last.unit_cost) || 0 : null,
      last_purchase_date: last ? last.purchased_at : null,
      lead_time_days: p.lead_time_days == null ? null : Number(p.lead_time_days),
      moq: p.moq == null ? null : Number(p.moq),
      order_step: p.order_step == null ? null : Number(p.order_step),
      ...calc,
      // backward-compat aliases used by the old UI
      current_stock: calc.on_hand_qty,
      avg_daily_sales: calc.avg_daily_sales,
      period_sales_qty: calc.period_sales_qty,
    });
  }

  let filtered = rows;
  if (onlyRisk) {
    filtered = filtered.filter((r) => r.status === STATUSES.SHORTAGE || r.status === STATUSES.RISK);
  }
  if (statusFilter && statusFilter !== 'ALL' && Object.values(STATUSES).includes(statusFilter)) {
    filtered = filtered.filter((r) => r.status === statusFilter);
  }

  filtered.sort((a, b) => {
    if (sortBy === 'name') {
      return String(a.product_name || '').localeCompare(String(b.product_name || ''), 'uz') * sortDir;
    }
    if (sortBy === 'recommended_qty') {
      return (Number(a.recommended_qty || 0) - Number(b.recommended_qty || 0)) * sortDir;
    }
    if (sortBy === 'sku') {
      return String(a.product_sku || '').localeCompare(String(b.product_sku || '')) * sortDir;
    }
    const ra = statusRank(a.status);
    const rb = statusRank(b.status);
    if (ra !== rb) return (ra - rb) * (sortBy === 'status' ? sortDir : 1);
    return Number(b.recommended_qty || 0) - Number(a.recommended_qty || 0);
  });

  const statusCounts = {
    SHORTAGE: 0,
    RISK: 0,
    OK: 0,
    NO_SALES: 0,
    INSUFFICIENT_DATA: 0,
  };
  let totalRecommendedQty = 0;
  let totalRecommendedValueUzs = 0;
  let totalRecommendedValueUsd = 0;
  for (const r of filtered) {
    statusCounts[r.status] = (statusCounts[r.status] || 0) + 1;
    totalRecommendedQty += Number(r.recommended_qty || 0) || 0;
    if (r.recommended_value != null) {
      if (r.currency === 'USD') totalRecommendedValueUsd += Number(r.recommended_value) || 0;
      else totalRecommendedValueUzs += Number(r.recommended_value) || 0;
    }
  }

  const totalRows = filtered.length;
  const paged = pageSize ? filtered.slice((page - 1) * pageSize, page * pageSize) : filtered;

  return {
    rows: paged,
    totals: {
      row_count: totalRows,
      recommended_qty: totalRecommendedQty,
      recommended_value_uzs: totalRecommendedValueUzs,
      recommended_value_usd: totalRecommendedValueUsd,
      status_counts: statusCounts,
    },
    meta: {
      analysis_days: analysisDays,
      plan_days: planDays,
      safety_days: safetyDays,
      date_from: dateFrom,
      date_to: dateTo,
      warehouse_id: warehouseId,
      search: search || '',
      category_id: filters.category_id || null,
      only_risk: onlyRisk,
      status: statusFilter || null,
      sort_by: sortBy,
      sort_dir: sortDir === -1 ? 'desc' : 'asc',
      page,
      page_size: pageSize,
      timezone: UZBEKISTAN_TIMEZONE,
      as_of: new Date().toISOString(),
      calc_ms: Date.now() - started,
      formula: FORMULA,
    },
  };
}

function emptyResult(started, analysisDays, planDays, safetyDays, filters, extra = {}) {
  return {
    rows: [],
    totals: {
      row_count: 0,
      recommended_qty: 0,
      recommended_value_uzs: 0,
      recommended_value_usd: 0,
      status_counts: { SHORTAGE: 0, RISK: 0, OK: 0, NO_SALES: 0, INSUFFICIENT_DATA: 0 },
    },
    meta: {
      analysis_days: analysisDays,
      plan_days: planDays,
      safety_days: safetyDays,
      search: String(filters.search || filters.q || '').trim(),
      only_risk: Boolean(filters.only_risk),
      timezone: UZBEKISTAN_TIMEZONE,
      as_of: new Date().toISOString(),
      calc_ms: Date.now() - started,
      formula: FORMULA,
      ...extra,
    },
  };
}

function collectPlanningItems(result, productIds) {
  const want = new Set((productIds || []).map(String));
  return (result.rows || []).filter((r) => want.has(String(r.product_id)));
}

function groupItemsBySupplier(items) {
  const groups = new Map();
  for (const row of items) {
    const key = row.supplier_id || '__none__';
    if (!groups.has(key)) {
      groups.set(key, {
        supplier_id: row.supplier_id || null,
        supplier_name: row.supplier_name || null,
        currency: row.currency || 'UZS',
        items: [],
        total_value: 0,
      });
    }
    const g = groups.get(key);
    g.items.push(row);
    g.total_value += Number(row.recommended_value || 0) || 0;
  }
  return [...groups.values()];
}

module.exports = {
  runPurchasePlanning,
  collectPlanningItems,
  groupItemsBySupplier,
  STATUSES,
};

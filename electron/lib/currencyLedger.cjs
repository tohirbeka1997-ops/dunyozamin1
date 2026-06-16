/**
 * Server-side ledger amount resolution (UZS inventory vs USD supplier settlement).
 */

function _cols(db, table) {
  try {
    return new Set((db.prepare(`PRAGMA table_info(${table})`).all() || []).map((c) => c.name));
  } catch {
    return new Set();
  }
}

function createCurrencyLedger(db) {
  const poCols = _cols(db, 'purchase_orders');
  const payCols = _cols(db, 'supplier_payments');
  const supCols = _cols(db, 'suppliers');

  const hasPoCurrency = poCols.has('currency');
  const hasPoTotalUsd = poCols.has('total_usd');
  const hasPayCurrency = payCols.has('currency');
  const hasPayAmountUsd = payCols.has('amount_usd');
  const hasSettlement = supCols.has('settlement_currency');

  function normalizeCurrency(value, fallback = 'UZS') {
    return String(value || fallback).toUpperCase() === 'USD' ? 'USD' : 'UZS';
  }

  function poLedgerCurrency(po) {
    return hasPoCurrency ? normalizeCurrency(po?.currency, 'UZS') : 'UZS';
  }

  function poLedgerTotal(po) {
    const cur = poLedgerCurrency(po);
    if (cur === 'USD' && hasPoTotalUsd) return Number(po?.total_usd ?? 0) || 0;
    return Number(po?.total_amount ?? 0) || 0;
  }

  function paymentLedgerAmount(payment, supplierSettlement = 'UZS') {
    const cur = hasPayCurrency
      ? normalizeCurrency(payment?.currency, supplierSettlement)
      : supplierSettlement;
    if (cur === 'USD' && hasPayAmountUsd) {
      return Number(payment?.amount_usd ?? 0) || 0;
    }
    return Number(payment?.amount ?? 0) || 0;
  }

  function supplierSettlement(supplierId, cache = new Map()) {
    if (!hasSettlement || !supplierId) return 'UZS';
    if (cache.has(supplierId)) return cache.get(supplierId);
    const row = db.prepare(`SELECT settlement_currency FROM suppliers WHERE id = ?`).get(supplierId);
    const cur = normalizeCurrency(row?.settlement_currency, 'UZS');
    cache.set(supplierId, cur);
    return cur;
  }

  function paidByPurchaseOrder() {
    const rows = db
      .prepare(
        `
        SELECT
          purchase_order_id,
          COALESCE(SUM(amount), 0) AS paid_uzs,
          ${hasPayAmountUsd ? 'COALESCE(SUM(COALESCE(amount_usd, 0)), 0)' : '0'} AS paid_usd
        FROM supplier_payments
        WHERE purchase_order_id IS NOT NULL
        GROUP BY purchase_order_id
      `
      )
      .all();
    const map = new Map();
    for (const r of rows || []) {
      map.set(r.purchase_order_id, {
        paid_uzs: Number(r.paid_uzs ?? 0) || 0,
        paid_usd: Number(r.paid_usd ?? 0) || 0,
      });
    }
    return map;
  }

  function executiveSupplierDebt() {
    if (!poCols.has('total_amount')) {
      return { supplier_debt_uzs: 0, supplier_debt_usd: 0, supplier_debt: 0 };
    }

    const pos = db
      .prepare(
        `
        SELECT po.id, po.supplier_id, po.total_amount, ${hasPoTotalUsd ? 'po.total_usd' : 'NULL'} AS total_usd,
          ${hasPoCurrency ? "COALESCE(po.currency, 'UZS')" : "'UZS'"} AS currency,
          po.status
        FROM purchase_orders po
        WHERE po.status IN ('received', 'partially_received')
      `
      )
      .all();

    const paidMap = paidByPurchaseOrder();
    const settlementCache = new Map();
    let debtUzs = 0;
    let debtUsd = 0;

    for (const po of pos || []) {
      const cur = poLedgerCurrency(po);
      const total = poLedgerTotal(po);
      const paidRow = paidMap.get(po.id) || { paid_uzs: 0, paid_usd: 0 };
      const paid = cur === 'USD' ? paidRow.paid_usd : paidRow.paid_uzs;
      const outstanding = Math.max(0, total - paid);
      if (outstanding <= 0) continue;
      if (cur === 'USD') debtUsd += outstanding;
      else debtUzs += outstanding;
    }

    return {
      supplier_debt_uzs: debtUzs,
      supplier_debt_usd: debtUsd,
      supplier_debt: debtUzs,
    };
  }

  return {
    hasPoCurrency,
    hasPoTotalUsd,
    hasPayAmountUsd,
    hasSettlement,
    normalizeCurrency,
    poLedgerCurrency,
    poLedgerTotal,
    paymentLedgerAmount,
    supplierSettlement,
    paidByPurchaseOrder,
    executiveSupplierDebt,
  };
}

/** Supplier payment amount in UZS for cash-flow / shift aggregates. */
function supplierPaymentCashUzsSql(db, alias = 'sp') {
  const sp = alias || 'sp';
  const payCols = _cols(db, 'supplier_payments');
  const hasAmountUsd = payCols.has('amount_usd');
  const hasCurrency = payCols.has('currency');
  if (!hasAmountUsd) {
    return `COALESCE(${sp}.amount, 0)`;
  }
  const poFx = `(SELECT COALESCE(po.fx_rate, 0) FROM purchase_orders po WHERE po.id = ${sp}.purchase_order_id LIMIT 1)`;
  return `CASE
    WHEN COALESCE(${sp}.amount, 0) != 0 THEN COALESCE(${sp}.amount, 0)
    WHEN COALESCE(${sp}.amount_usd, 0) != 0 AND ${hasCurrency ? `UPPER(TRIM(COALESCE(${sp}.currency, 'USD'))) = 'USD'` : '1=1'}
      THEN COALESCE(${sp}.amount_usd, 0) * ${poFx}
    ELSE COALESCE(${sp}.amount, 0)
  END`;
}

module.exports = { createCurrencyLedger, supplierPaymentCashUzsSql };

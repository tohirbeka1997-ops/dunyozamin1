'use strict';

const { randomUUID } = require('crypto');

const SKIP_FEE_METHODS = new Set([
  'cash',
  'naqd',
  'credit',
  'on_credit',
  'debt',
  'customer_account',
  'credit_note',
  'refund_cash',
  'refund_balance',
]);

const CASH_METHODS = new Set(['cash', 'naqd']);
const BANK_METHODS = new Set([
  'card',
  'transfer',
  'bank',
  'click',
  'payme',
  'marketplace',
  'uzcard',
  'humo',
  'visa',
  'mastercard',
  'master',
  'atm',
]);

function _hasTable(db, name) {
  try {
    return !!db
      .prepare(`SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name = ? LIMIT 1`)
      .get(name)?.ok;
  } catch {
    return false;
  }
}

function _hasColumn(db, table, column) {
  try {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() || [];
    return cols.some((c) => c.name === column);
  } catch {
    return false;
  }
}

function hasPaymentFeesTable(db) {
  return _hasTable(db, 'payment_fees');
}

function normalizePaymentMethod(method) {
  return String(method || '').trim().toLowerCase();
}

function classifyPaymentMethodGroup(method) {
  const m = normalizePaymentMethod(method);
  if (!m) return 'other';
  if (CASH_METHODS.has(m)) return 'cash';
  if (BANK_METHODS.has(m) || /(card|humo|uzcard|visa|master|payme|click|atm|transfer|bank)/i.test(m)) {
    return 'bank';
  }
  if (/(credit|debt|nasiya|qarz|loan|balance)/i.test(m)) return 'credit';
  return 'other';
}

function skipFeeForMethod(method) {
  const m = normalizePaymentMethod(method);
  if (!m) return true;
  if (SKIP_FEE_METHODS.has(m)) return true;
  if (CASH_METHODS.has(m)) return true;
  return false;
}

function _settingNumber(db, key) {
  try {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    const n = Number(row?.value);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

function getPaymentFeeRates(db, paymentMethod) {
  const method = normalizePaymentMethod(paymentMethod);
  let percent = 0;
  let fixed = 0;
  if (_hasTable(db, 'payment_methods') && _hasColumn(db, 'payment_methods', 'fee_percent')) {
    try {
      const row = db
        .prepare(
          `SELECT fee_percent, fee_fixed FROM payment_methods WHERE slug = ? LIMIT 1`
        )
        .get(method);
      if (row) {
        percent = Number(row.fee_percent) || 0;
        fixed = Number(row.fee_fixed) || 0;
      }
    } catch {
      /* schema partial */
    }
  }
  if (!(percent > 0) && !(fixed > 0)) {
    percent = _settingNumber(db, `payment_fees.${method}.percent`);
    fixed = _settingNumber(db, `payment_fees.${method}.fixed`);
  }
  return { percent, fixed };
}

function computePaymentFee(paymentAmount, percent = 0, fixed = 0) {
  const amt = Number(paymentAmount) || 0;
  if (!(amt > 0)) return 0;
  const p = Number(percent) || 0;
  const f = Number(fixed) || 0;
  const fee = amt * (p / 100) + f;
  return Math.round(fee * 100) / 100;
}

function amountToUzs(amount, currency, fxRate) {
  const amt = Number(amount) || 0;
  const cur = String(currency || 'UZS').trim().toUpperCase();
  if (cur === 'USD') {
    const fx = Number(fxRate) || 0;
    return fx > 0 ? amt * fx : 0;
  }
  return amt;
}

/**
 * Persist commission. Idempotent on payment_id.
 * payment_id may be POS payments.id, customer_payments.id, or web:{web_order_id}
 * (no FK to payments after migration 111).
 * @returns {{ recorded: boolean, fee_amount: number, fee_amount_uzs: number }}
 */
function recordPaymentFee(db, payload = {}) {
  if (!hasPaymentFeesTable(db)) return { recorded: false, fee_amount: 0, fee_amount_uzs: 0 };
  const paymentId = payload.paymentId || payload.payment_id;
  const method = payload.paymentMethod || payload.payment_method;
  if (!paymentId || skipFeeForMethod(method)) {
    return { recorded: false, fee_amount: 0, fee_amount_uzs: 0 };
  }
  const paymentAmount = Number(payload.paymentAmount ?? payload.payment_amount ?? payload.amount) || 0;
  const rates = getPaymentFeeRates(db, method);
  const feeAmount = computePaymentFee(paymentAmount, rates.percent, rates.fixed);
  if (!(feeAmount > 0)) return { recorded: false, fee_amount: 0, fee_amount_uzs: 0 };

  const currency = String(payload.currency || 'UZS').trim().toUpperCase() === 'USD' ? 'USD' : 'UZS';
  const feeUzs = amountToUzs(feeAmount, currency, payload.fxRate ?? payload.fx_rate);
  const now = payload.createdAt || payload.created_at || new Date().toISOString();
  const source = String(payload.source || 'payments').trim() || 'payments';
  const hasSource = _hasColumn(db, 'payment_fees', 'source');

  try {
    const cols = [
      'id',
      'payment_id',
      'order_id',
      'payment_method',
      'payment_amount',
      'fee_percent',
      'fee_fixed',
      'fee_amount',
      'fee_amount_uzs',
      'currency',
      'created_at',
    ];
    const vals = [
      payload.id || randomUUID(),
      String(paymentId),
      payload.orderId || payload.order_id || null,
      normalizePaymentMethod(method),
      paymentAmount,
      rates.percent,
      rates.fixed,
      feeAmount,
      feeUzs,
      currency,
      now,
    ];
    if (hasSource) {
      cols.splice(3, 0, 'source');
      vals.splice(3, 0, source);
    }
    const ph = cols.map(() => '?').join(', ');
    db.prepare(`INSERT OR IGNORE INTO payment_fees (${cols.join(', ')}) VALUES (${ph})`).run(...vals);
  } catch (err) {
    console.warn('[paymentFee] recordPaymentFee failed:', err?.message || err);
    return { recorded: false, fee_amount: 0, fee_amount_uzs: 0 };
  }
  return { recorded: true, fee_amount: feeAmount, fee_amount_uzs: feeUzs };
}

/** Payme/Click (and other non-cash web providers) — no POS payments row. */
function recordWebOrderPaymentFee(db, webOrder, options = {}) {
  if (!webOrder || webOrder.id == null) {
    return { recorded: false, fee_amount: 0, fee_amount_uzs: 0 };
  }
  const method = webOrder.payment_method || webOrder.payment_provider || 'payme';
  return recordPaymentFee(db, {
    paymentId: `web:${webOrder.id}`,
    orderId: String(webOrder.id),
    paymentMethod: method,
    paymentAmount: Number(webOrder.total_amount) || 0,
    currency: webOrder.currency || 'UZS',
    fxRate: webOrder.fx_rate,
    source: 'web_orders',
    createdAt: options.createdAt || options.created_at,
  });
}

function sumPaymentFeesForPeriod(db, options = {}) {
  if (!hasPaymentFeesTable(db)) {
    return 0;
  }
  const dateFrom = options.dateFrom || options.date_from || null;
  const dateTo = options.dateTo || options.date_to || null;
  const warehouseId = options.warehouseId || options.warehouse_id || null;
  const hasPayments = _hasTable(db, 'payments');
  const hasOrders = _hasTable(db, 'orders');
  const hasCp = _hasTable(db, 'customer_payments');
  const hasWeb = _hasTable(db, 'web_orders');

  const paidAtExpr = `COALESCE(${[
    hasPayments ? 'p.paid_at' : null,
    hasCp ? 'cp.paid_at' : null,
    hasWeb ? 'wo.updated_at' : null,
    'pf.created_at',
  ]
    .filter(Boolean)
    .join(', ')})`;

  const tzDateExpr =
    typeof options.tzDateExpr === 'function'
      ? options.tzDateExpr(paidAtExpr)
      : `date(datetime(replace(replace(${paidAtExpr}, 'T', ' '), 'Z', ''), '+05:00'))`;

  const params = [];
  let where = `WHERE 1=1`;
  if (dateFrom) {
    where += ` AND ${tzDateExpr} >= date(?)`;
    params.push(dateFrom);
  }
  if (dateTo) {
    where += ` AND ${tzDateExpr} <= date(?)`;
    params.push(dateTo);
  }
  if (warehouseId) {
    const warehouseParts = [];
    if (hasOrders) {
      warehouseParts.push('o.warehouse_id = ?');
      params.push(warehouseId);
    }
    if (hasWeb) {
      warehouseParts.push(`(wo.id IS NOT NULL AND ? = 'main-warehouse-001')`);
      params.push(warehouseId);
    }
    if (hasCp && hasOrders) {
      warehouseParts.push(
        `EXISTS (SELECT 1 FROM orders o2 WHERE o2.id = cp.order_id AND o2.warehouse_id = ?)`
      );
      params.push(warehouseId);
    }
    if (warehouseParts.length) {
      where += ` AND (${warehouseParts.join(' OR ')})`;
    }
  }

  const joins = [
    hasPayments ? 'LEFT JOIN payments p ON p.id = pf.payment_id' : '',
    hasOrders
      ? `LEFT JOIN orders o ON o.id = COALESCE(${hasPayments ? 'p.order_id, ' : ''}pf.order_id)`
      : '',
    hasCp ? 'LEFT JOIN customer_payments cp ON cp.id = pf.payment_id' : '',
    hasWeb ? `LEFT JOIN web_orders wo ON CAST(wo.id AS TEXT) = pf.order_id` : '',
  ]
    .filter(Boolean)
    .join('\n        ');

  try {
    const row = db
      .prepare(
        `
        SELECT COALESCE(SUM(pf.fee_amount_uzs), 0) AS total_commission
        FROM payment_fees pf
        ${joins}
        ${where}
      `
      )
      .get(...params);
    return Number(row?.total_commission || 0) || 0;
  } catch {
    return 0;
  }
}

module.exports = {
  SKIP_FEE_METHODS,
  CASH_METHODS,
  BANK_METHODS,
  hasPaymentFeesTable,
  normalizePaymentMethod,
  classifyPaymentMethodGroup,
  skipFeeForMethod,
  getPaymentFeeRates,
  computePaymentFee,
  amountToUzs,
  recordPaymentFee,
  recordWebOrderPaymentFee,
  sumPaymentFeesForPeriod,
};

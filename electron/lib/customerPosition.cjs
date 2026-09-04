/**
 * Single source of customer AR: open-order remainder + non-order loans + advance.
 * Stored customers.debt_* / advance_* are cache columns; do not use net to hide debt.
 */

const { randomUUID } = require('crypto');
const {
  normalizeCustomerCurrency,
  readCustomerDebtAdvance,
  writeDebtAdvanceNet,
} = require('./customerBalance.cjs');

const OPEN_ORDER_STATUSES = `('completed')`;
const OPEN_CREDIT_STATUSES = `('on_credit', 'partial', 'partially_paid')`;

const OP = {
  SALE_ON_CREDIT: 'SALE_ON_CREDIT',
  CREDIT_SALE: 'CREDIT_SALE',
  SALE_PAYMENT: 'SALE_PAYMENT',
  SALE_RETURN: 'SALE_RETURN',
  CUSTOMER_PAYMENT: 'CUSTOMER_PAYMENT',
  DEBT_PAYMENT_RECEIVED: 'DEBT_PAYMENT_RECEIVED',
  ADVANCE_RECEIVED: 'ADVANCE_RECEIVED',
  ADVANCE_REFUND: 'ADVANCE_REFUND',
  ADVANCE_REFUNDED: 'ADVANCE_REFUNDED',
  ADVANCE_APPLIED_TO_ORDER: 'ADVANCE_APPLIED_TO_ORDER',
  CUSTOMER_LOAN_ISSUED: 'CUSTOMER_LOAN_ISSUED',
  CUSTOMER_LOAN_REPAID: 'CUSTOMER_LOAN_REPAID',
  RETURN: 'RETURN',
  ADJUSTMENT: 'ADJUSTMENT',
};

function roundMoney(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/**
 * Opt-in only: automatic AR heal/backfill/sync that WRITES money columns.
 * Default OFF so list/getById never rewrite debts on open/deploy.
 * Set CUSTOMER_AR_HEAL=1 to enable (explicit repair).
 */
function isCustomerArHealEnabled() {
  const v = process.env.CUSTOMER_AR_HEAL;
  if (v == null || v === '') return false;
  const s = String(v).toLowerCase().trim();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

function _hasTable(db, name) {
  try {
    return !!db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(name);
  } catch {
    return false;
  }
}

function _cols(db, table) {
  try {
    return new Set((db.prepare(`PRAGMA table_info(${table})`).all() || []).map((c) => c.name));
  } catch {
    return new Set();
  }
}

function todayYmd(db) {
  try {
    const row = db.prepare(`SELECT date('now', 'localtime') AS d`).get();
    if (row?.d) return String(row.d).slice(0, 10);
  } catch {
    /* ignore */
  }
  return new Date().toISOString().slice(0, 10);
}

function orderRemaining(order) {
  const credit = Number(order?.credit_amount || 0) || 0;
  if (credit > 0.009) return roundMoney(credit);
  const total = Number(order?.total_amount || 0) || 0;
  const paid = Number(order?.paid_amount || 0) || 0;
  return roundMoney(Math.max(0, total - paid));
}

/**
 * FIFO plan (pure): apply amount to oldest open orders.
 * @param {Array<{id: string, remaining: number, created_at?: string}>} orders
 */
function buildFifoAllocationPlan(orders, amount, preferredOrderId = null) {
  const amt = roundMoney(amount);
  let left = amt;
  const allocations = [];
  const list = [...(orders || [])];
  if (preferredOrderId) {
    const idx = list.findIndex((o) => String(o.id) === String(preferredOrderId));
    if (idx > 0) {
      const [pref] = list.splice(idx, 1);
      list.unshift(pref);
    }
  }
  for (const o of list) {
    if (left <= 0.009) break;
    const rem = roundMoney(Math.max(0, Number(o.remaining || 0)));
    if (rem <= 0.009) continue;
    const applied = roundMoney(Math.min(left, rem));
    allocations.push({
      order_id: o.id,
      applied_amount: applied,
      order_balance_before: rem,
      order_balance_after: roundMoney(rem - applied),
    });
    left = roundMoney(left - applied);
  }
  return {
    allocations,
    remainder: roundMoney(Math.max(0, left)),
    applied_to_orders: roundMoney(amt - Math.max(0, left)),
  };
}

function assertCreditExposure(opts = {}) {
  const newAmount = roundMoney(opts.newDebtAmount);
  const limit = Number(opts.creditLimit);
  const exposure = roundMoney(opts.totalExposure);
  const projected = roundMoney(exposure + newAmount);
  const overrideReason = String(opts.overrideReason || '').trim();
  const overrideApprover = opts.overrideApproverId ? String(opts.overrideApproverId).trim() : '';
  const hasOverride = Boolean(opts.allowOverride && overrideReason && overrideApprover);

  if (!(newAmount > 0)) {
    return { ok: false, code: 'INVALID_AMOUNT', error: 'Summa 0 dan katta bo‘lishi kerak.' };
  }
  if (!(Number.isFinite(limit) && limit > 0)) {
    return {
      ok: false,
      code: 'CREDIT_LIMIT_NOT_SET',
      error: 'Qarz berib bo‘lmaydi: mijoz kredit limiti belgilanmagan.',
      credit_limit: Number.isFinite(limit) ? limit : 0,
      current_debt: exposure,
      new_amount: newAmount,
      projected,
    };
  }
  if (projected > limit + 1e-6 && !hasOverride) {
    return {
      ok: false,
      code: 'CREDIT_LIMIT_EXCEEDED',
      error: `Qarz berib bo‘lmaydi: yangi qarz mijoz kredit limitidan oshadi. Joriy qarz: ${exposure}. Yangi summa: ${newAmount}. Limit: ${limit}. Oshish: ${roundMoney(projected - limit)}.`,
      credit_limit: limit,
      current_debt: exposure,
      new_amount: newAmount,
      projected,
      over_by: roundMoney(Math.max(0, projected - limit)),
    };
  }
  return {
    ok: true,
    credit_limit: limit,
    current_debt: exposure,
    new_amount: newAmount,
    projected,
    override: hasOverride,
    over_by: roundMoney(Math.max(0, projected - limit)),
  };
}

function listOpenCreditOrders(db, customerId, currency = 'UZS') {
  if (!customerId || !_hasTable(db, 'orders')) return [];
  const cur = normalizeCustomerCurrency(currency);
  const hasCur = _cols(db, 'orders').has('currency');
  const hasDue = _cols(db, 'orders').has('due_date');
  const curClause = hasCur
    ? `AND UPPER(TRIM(COALESCE(o.currency, 'UZS'))) = ?`
    : '';
  const params = [customerId];
  if (hasCur) params.push(cur);
  const rows = db
    .prepare(
      `
      SELECT
        o.id,
        o.order_number,
        o.customer_id,
        o.total_amount,
        o.paid_amount,
        o.credit_amount,
        o.payment_status,
        o.created_at
        ${hasDue ? ', o.due_date' : ', NULL AS due_date'}
        ${hasCur ? ', o.currency' : `, 'UZS' AS currency`}
      FROM orders o
      WHERE o.customer_id = ?
        AND o.status IN ${OPEN_ORDER_STATUSES}
        AND COALESCE(o.credit_amount, 0) > 0.009
        ${curClause}
      ORDER BY
        CASE WHEN ${hasDue ? `COALESCE(o.due_date, '')` : `''`} = '' THEN 1 ELSE 0 END,
        ${hasDue ? `date(o.due_date)` : `date('9999-12-31')`} ASC,
        datetime(replace(replace(COALESCE(o.created_at,''), 'T', ' '), 'Z', '')) ASC
    `
    )
    .all(...params);
  return (rows || []).map((o) => ({
    ...o,
    remaining: orderRemaining(o),
  })).filter((o) => o.remaining > 0.009);
}

function sumLoanOps(db, customerId, currency = 'UZS') {
  const cur = normalizeCustomerCurrency(currency);
  let issued = 0;
  let repaid = 0;
  if (_hasTable(db, 'customer_payments') && _cols(db, 'customer_payments').has('op_type')) {
    const hasCur = _cols(db, 'customer_payments').has('currency');
    const sql = `
        SELECT
          COALESCE(SUM(CASE WHEN op_type = 'CUSTOMER_LOAN_ISSUED' THEN ABS(amount) ELSE 0 END), 0) AS issued,
          COALESCE(SUM(CASE WHEN op_type = 'CUSTOMER_LOAN_REPAID' THEN ABS(amount) ELSE 0 END), 0) AS repaid
        FROM customer_payments
        WHERE customer_id = ?
          ${hasCur ? `AND UPPER(TRIM(COALESCE(currency, 'UZS'))) = ?` : ''}
      `;
    const row = hasCur
      ? db.prepare(sql).get(customerId, cur)
      : db.prepare(sql).get(customerId);
    issued = Number(row?.issued || 0) || 0;
    repaid = Number(row?.repaid || 0) || 0;
  }
  return {
    issued: roundMoney(issued),
    repaid: roundMoney(repaid),
    net: roundMoney(Math.max(0, issued - repaid)),
  };
}

function sumAdvanceOps(db, customerId, currency = 'UZS') {
  const cur = normalizeCustomerCurrency(currency);
  if (!_hasTable(db, 'customer_payments') || !_cols(db, 'customer_payments').has('op_type')) {
    return { received: 0, refunded: 0, applied: 0, net: null };
  }
  const hasCur = _cols(db, 'customer_payments').has('currency');
  const sql = `
      SELECT
        COALESCE(SUM(CASE WHEN op_type IN ('ADVANCE_RECEIVED') THEN ABS(amount) ELSE 0 END), 0) AS received,
        COALESCE(SUM(CASE WHEN op_type IN ('ADVANCE_REFUNDED', 'ADVANCE_REFUND') THEN ABS(amount) ELSE 0 END), 0) AS refunded,
        COALESCE(SUM(CASE WHEN op_type = 'ADVANCE_APPLIED_TO_ORDER' THEN ABS(amount) ELSE 0 END), 0) AS applied
      FROM customer_payments
      WHERE customer_id = ?
        ${hasCur ? `AND UPPER(TRIM(COALESCE(currency, 'UZS'))) = ?` : ''}
    `;
  const row = hasCur
    ? db.prepare(sql).get(customerId, cur)
    : db.prepare(sql).get(customerId);
  const received = Number(row?.received || 0) || 0;
  const refunded = Number(row?.refunded || 0) || 0;
  const applied = Number(row?.applied || 0) || 0;
  return {
    received: roundMoney(received),
    refunded: roundMoney(refunded),
    applied: roundMoney(applied),
    net: roundMoney(Math.max(0, received - refunded - applied)),
  };
}

/**
 * Authoritative customer AR snapshot.
 */
function computeCustomerPosition(db, customerId, currency = 'UZS', opts = {}) {
  const cur = normalizeCustomerCurrency(currency);
  const today = opts.today || todayYmd(db);
  const stored = readCustomerDebtAdvance(db, customerId, cur);
  const openOrders = listOpenCreditOrders(db, customerId, cur).filter(
    (o) => !opts.excludeOrderId || String(o.id) !== String(opts.excludeOrderId)
  );
  const openOrderDebt = roundMoney(openOrders.reduce((s, o) => s + o.remaining, 0));
  const overdueAmount = roundMoney(
    openOrders.reduce((s, o) => {
      const due = o.due_date ? String(o.due_date).slice(0, 10) : '';
      if (due.length === 10 && due < today) return s + o.remaining;
      return s;
    }, 0)
  );
  const loans = sumLoanOps(db, customerId, cur);
  const residualLoan = roundMoney(Math.max(0, stored.debt - openOrderDebt - loans.net));
  const loanDebt = roundMoney(loans.net + residualLoan);
  const totalDebt = roundMoney(openOrderDebt + loanDebt);
  const advanceOps = sumAdvanceOps(db, customerId, cur);
  const advance = stored.advance;
  const unappliedAdvance = advance;
  const net = roundMoney(advance - totalDebt);
  const storedVariance = roundMoney(stored.debt - totalDebt);
  return {
    currency: cur,
    open_order_debt: openOrderDebt,
    loan_debt: loanDebt,
    total_debt: totalDebt,
    advance,
    unapplied_advance: unappliedAdvance,
    net,
    overdue_amount: overdueAmount,
    stored_debt: stored.debt,
    stored_advance: stored.advance,
    stored_net: stored.net,
    stored_debt_variance: storedVariance,
    open_orders: openOrders,
    loan_issued: loans.issued,
    loan_repaid: loans.repaid,
    advance_ops: advanceOps,
    as_of: today,
  };
}

function totalExposure(position, pendingUnpostedDebt = 0) {
  return roundMoney((position?.total_debt || 0) + (Number(pendingUnpostedDebt) || 0));
}

function syncCustomerDebtFromPosition(db, customerId, currency, updatedAt) {
  const cur = normalizeCustomerCurrency(currency);
  const at = updatedAt || new Date().toISOString();
  const pos = computeCustomerPosition(db, customerId, cur);
  const buckets = readCustomerDebtAdvance(db, customerId, cur);
  writeDebtAdvanceNet(db, customerId, cur, pos.total_debt, buckets.advance, at);
  return computeCustomerPosition(db, customerId, cur);
}

function applyAmountToOrderRow(db, order, amount, now) {
  const applied = roundMoney(Math.min(orderRemaining(order), amount));
  if (!(applied > 0.009)) return { applied: 0, remainingAfter: orderRemaining(order) };
  const newPaid = roundMoney(Number(order.paid_amount || 0) + applied);
  const newCredit = roundMoney(Math.max(0, orderRemaining(order) - applied));
  let paymentStatus = 'paid';
  if (newCredit > 0.02) {
    paymentStatus = newPaid > 0.02 ? 'partially_paid' : 'on_credit';
  }
  db.prepare(
    `UPDATE orders SET paid_amount = ?, credit_amount = ?, payment_status = ?, updated_at = ? WHERE id = ?`
  ).run(newPaid, newCredit, paymentStatus, now, order.id);
  return { applied, remainingAfter: newCredit, newPaid, paymentStatus };
}

function insertPaymentAllocation(db, row) {
  if (!_hasTable(db, 'customer_payment_allocations')) return;
  const cols = _cols(db, 'customer_payment_allocations');
  const id = row.id || randomUUID();
  const applied = roundMoney(row.applied_amount || row.allocated_amount || 0);
  const names = [
    'id',
    'payment_id',
    'customer_id',
    'order_id',
    'applied_amount',
    'order_balance_before',
    'order_balance_after',
    'remainder_to_advance',
    'currency',
    'fx_rate',
    'payment_method',
    'cash_doc_id',
    'shift_id',
    'created_at',
    'created_by',
  ];
  const vals = [
    id,
    row.payment_id,
    row.customer_id,
    row.order_id || null,
    applied,
    row.order_balance_before != null ? roundMoney(row.order_balance_before) : null,
    row.order_balance_after != null ? roundMoney(row.order_balance_after) : null,
    roundMoney(row.remainder_to_advance || 0),
    row.currency || 'UZS',
    row.fx_rate != null ? Number(row.fx_rate) : null,
    row.payment_method || null,
    row.cash_doc_id || null,
    row.shift_id || null,
    row.created_at,
    row.created_by || null,
  ];
  if (cols.has('allocated_amount')) {
    names.push('allocated_amount');
    vals.push(applied);
  }
  if (cols.has('allocated_at')) {
    names.push('allocated_at');
    vals.push(row.created_at);
  }
  if (cols.has('allocated_by')) {
    names.push('allocated_by');
    vals.push(row.created_by || null);
  }
  if (cols.has('allocation_type')) {
    names.push('allocation_type');
    vals.push(row.allocation_type || 'debt_payment');
  }
  const ph = names.map(() => '?').join(', ');
  db.prepare(`INSERT INTO customer_payment_allocations (${names.join(', ')}) VALUES (${ph})`).run(
    ...vals
  );
}

/**
 * Allocate inbound cash/advance to open orders (FIFO), remainder returned.
 */
function allocateInboundToOpenOrders(db, opts) {
  const {
    customerId,
    paymentId,
    amount,
    currency = 'UZS',
    preferredOrderId = null,
    paymentMethod = null,
    fxRate = null,
    shiftId = null,
    createdAt,
    createdBy = null,
    cashDocId = null,
    manualAllocations = null,
    allocation_type = null,
  } = opts;
  const now = createdAt || new Date().toISOString().replace('T', ' ').slice(0, 19);
  const cur = normalizeCustomerCurrency(currency);
  const open = listOpenCreditOrders(db, customerId, cur);
  let plan;
  if (Array.isArray(manualAllocations) && manualAllocations.length) {
    const mapped = [];
    let left = roundMoney(amount);
    for (const row of manualAllocations) {
      if (left <= 0.009) break;
      const oid = row.order_id || row.orderId;
      const want = roundMoney(Math.min(left, Number(row.amount || row.allocated_amount || 0)));
      if (!oid || !(want > 0.009)) continue;
      const order =
        open.find((o) => String(o.id) === String(oid)) ||
        db.prepare(`SELECT * FROM orders WHERE id = ?`).get(oid);
      if (!order) continue;
      const rem = orderRemaining(order);
      const applied = roundMoney(Math.min(want, rem));
      if (!(applied > 0.009)) continue;
      mapped.push({
        order_id: oid,
        applied_amount: applied,
        order_balance_before: rem,
        order_balance_after: roundMoney(rem - applied),
      });
      left = roundMoney(left - applied);
    }
    plan = {
      allocations: mapped,
      remainder: left,
      applied_to_orders: roundMoney(amount - left),
    };
  } else {
    plan = buildFifoAllocationPlan(open, amount, preferredOrderId);
  }
  const appliedRows = [];
  for (const a of plan.allocations) {
    const order = open.find((o) => o.id === a.order_id) || db.prepare(`SELECT * FROM orders WHERE id = ?`).get(a.order_id);
    if (!order) continue;
    order.remaining = orderRemaining(order);
    const result = applyAmountToOrderRow(db, order, a.applied_amount, now);
    if (result.applied > 0.009) {
      insertPaymentAllocation(db, {
        payment_id: paymentId,
        customer_id: customerId,
        order_id: a.order_id,
        applied_amount: result.applied,
        order_balance_before: a.order_balance_before,
        order_balance_after: result.remainingAfter,
        remainder_to_advance: 0,
        currency: cur,
        fx_rate: fxRate,
        payment_method: paymentMethod,
        cash_doc_id: cashDocId,
        shift_id: shiftId,
        created_at: now,
        created_by: createdBy,
        allocation_type: opts.allocation_type || (opts.manualAllocations ? 'manual_adjustment' : 'debt_payment'),
      });
      appliedRows.push({ ...a, applied_amount: result.applied, order_balance_after: result.remainingAfter });
    }
  }
  if (plan.remainder > 0.009) {
    insertPaymentAllocation(db, {
      payment_id: paymentId,
      customer_id: customerId,
      order_id: null,
      applied_amount: plan.remainder,
      remainder_to_advance: plan.remainder,
      currency: cur,
      fx_rate: fxRate,
      payment_method: paymentMethod,
      cash_doc_id: cashDocId,
      shift_id: shiftId,
      created_at: now,
      created_by: createdBy,
      allocation_type: 'advance_received',
    });
  }
  return {
    allocations: appliedRows,
    remainder: plan.remainder,
    applied_to_orders: roundMoney(appliedRows.reduce((s, r) => s + r.applied_amount, 0)),
  };
}

function applyReturnToOrderRemaining(db, orderId, refundAmount, now) {
  if (!orderId) return { creditReduced: 0 };
  const order = db
    .prepare(
      `SELECT id, total_amount, paid_amount, credit_amount, payment_status FROM orders WHERE id = ?`
    )
    .get(orderId);
  if (!order) return { creditReduced: 0 };
  const remaining = orderRemaining(order);
  const creditReduced = roundMoney(Math.min(remaining, Math.max(0, Number(refundAmount) || 0)));
  if (!(creditReduced > 0.009)) return { creditReduced: 0, remainingAfter: remaining };
  const newCredit = roundMoney(remaining - creditReduced);
  const newPaid = roundMoney(Math.max(0, Number(order.paid_amount || 0)));
  let paymentStatus = 'paid';
  if (newCredit > 0.02) {
    paymentStatus = newPaid > 0.02 ? 'partially_paid' : 'on_credit';
  }
  const at = now || new Date().toISOString().replace('T', ' ').slice(0, 19);
  db.prepare(
    `UPDATE orders SET credit_amount = ?, payment_status = ?, updated_at = ? WHERE id = ?`
  ).run(newCredit, paymentStatus, at, orderId);
  return { creditReduced, remainingAfter: newCredit, paymentStatus };
}

/**
 * When unapplied advance coexists with open credit / loans, apply advance first
 * (FIFO onto orders, then loan repay). Fixes return-path split-brain: balance
 * delta nets stored debt into advance, then open_order_debt was re-synced without
 * consuming that advance — leaving large ortiqcha + still-open nasiya.
 */
function settleAdvanceAgainstOpenDebt(db, customerId, currency = 'UZS', opts = {}) {
  if (!customerId) {
    return { applied_to_orders: 0, applied_to_loans: 0, advance_after: 0 };
  }
  const cur = normalizeCustomerCurrency(currency);
  const now = opts.createdAt || new Date().toISOString().replace('T', ' ').slice(0, 19);
  const createdBy = opts.createdBy || null;
  let buckets = readCustomerDebtAdvance(db, customerId, cur);
  let advance = roundMoney(buckets.advance);
  if (!(advance > 0.009)) {
    return { applied_to_orders: 0, applied_to_loans: 0, advance_after: advance };
  }

  let appliedToOrders = 0;
  const open = listOpenCreditOrders(db, customerId, cur);
  const openDebt = roundMoney(open.reduce((s, o) => s + o.remaining, 0));
  if (openDebt > 0.009 && advance > 0.009) {
    const toOrders = roundMoney(Math.min(advance, openDebt));
    const paymentId = opts.paymentId || randomUUID();
    const alloc = allocateInboundToOpenOrders(db, {
      customerId,
      paymentId,
      amount: toOrders,
      currency: cur,
      paymentMethod: 'advance',
      createdAt: now,
      createdBy,
      cashDocId: opts.refNo || `ADV-SETTLE-${String(paymentId).slice(0, 8)}`,
      allocation_type: 'advance_used',
      preferredOrderId: opts.preferredOrderId || null,
    });
    appliedToOrders = roundMoney(alloc.applied_to_orders || 0);
    advance = roundMoney(Math.max(0, advance - appliedToOrders));
  }

  let appliedToLoans = 0;
  if (opts.includeLoans) {
    const posMid = computeCustomerPosition(db, customerId, cur);
    const loanNet = roundMoney(
      Math.max(0, Number(posMid.loan_issued || 0) - Number(posMid.loan_repaid || 0))
    );
    if (loanNet > 0.009 && advance > 0.009 && _hasTable(db, 'customer_payments')) {
      const repay = roundMoney(Math.min(advance, loanNet));
      const repayId = randomUUID();
      const repayNumber = `LR-${Date.now()}-${String(repayId).slice(0, 8).toUpperCase()}`;
      const payCols = _cols(db, 'customer_payments');
      const cols = [
        'id',
        'payment_number',
        'customer_id',
        'order_id',
        'amount',
        'payment_method',
        'notes',
        'received_by',
        'paid_at',
        'created_at',
      ];
      const vals = [
        repayId,
        repayNumber,
        customerId,
        null,
        repay,
        'advance',
        opts.note || 'CUSTOMER_LOAN_REPAID (advance settle)',
        createdBy,
        now,
        now,
      ];
      if (payCols.has('operation')) {
        cols.push('operation');
        vals.push('loan_repay');
      }
      if (payCols.has('op_type')) {
        cols.push('op_type');
        vals.push(OP.CUSTOMER_LOAN_REPAID);
      }
      if (payCols.has('direction')) {
        cols.push('direction');
        vals.push('in');
      }
      if (payCols.has('currency')) {
        cols.push('currency');
        vals.push(cur);
      }
      const ph = cols.map(() => '?').join(', ');
      db.prepare(`INSERT INTO customer_payments (${cols.join(', ')}) VALUES (${ph})`).run(...vals);
      appliedToLoans = repay;
      advance = roundMoney(Math.max(0, advance - repay));
    }
  }

  const pos = computeCustomerPosition(db, customerId, cur);
  const loanAfter = roundMoney(
    Math.max(0, Number(pos.loan_issued || 0) - Number(pos.loan_repaid || 0))
  );
  const debtFloor = roundMoney(pos.open_order_debt + loanAfter);
  writeDebtAdvanceNet(db, customerId, cur, debtFloor, advance, now);
  return {
    applied_to_orders: appliedToOrders,
    applied_to_loans: appliedToLoans,
    advance_after: advance,
    open_order_debt_after: pos.open_order_debt,
    loan_debt_after: loanAfter,
  };
}

/**
 * Legacy path: payment_in updated customers.balance / customer_ledger but never reduced
 * orders.credit_amount (no rows in customer_payment_allocations). Hisob holati then
 * stays at the original sale credit while ledger Qoldi shows real running AR.
 *
 * Idempotent FIFO backfill onto open orders only. Does not invent payments, does not
 * rewrite ledger history, does not change customer balance/debt buckets.
 */
function backfillMissingOrderAllocations(db, customerId, currency = 'UZS') {
  if (!customerId || !_hasTable(db, 'customer_ledger') || !_hasTable(db, 'orders')) {
    return { applied: 0, allocation_rows: 0, payments_touched: 0 };
  }
  const cur = normalizeCustomerCurrency(currency);
  if (!listOpenCreditOrders(db, customerId, cur).length) {
    return { applied: 0, allocation_rows: 0, payments_touched: 0 };
  }

  const hasLedgerCur = _cols(db, 'customer_ledger').has('currency');
  const ledgerIns = db
    .prepare(
      `
      SELECT id, ref_id, ref_no, amount, method, created_at, created_by
      FROM customer_ledger
      WHERE customer_id = ?
        AND type = 'payment_in'
        AND ABS(COALESCE(amount, 0)) > 0.009
        ${hasLedgerCur ? `AND UPPER(TRIM(COALESCE(currency, 'UZS'))) = ?` : ''}
      ORDER BY datetime(replace(replace(COALESCE(created_at, ''), 'T', ' '), 'Z', '')) ASC,
               rowid ASC
    `
    )
    .all(...(hasLedgerCur ? [customerId, cur] : [customerId]));

  if (!ledgerIns.length) {
    return { applied: 0, allocation_rows: 0, payments_touched: 0 };
  }

  const hasAlloc = _hasTable(db, 'customer_payment_allocations');
  const hasPayTable = _hasTable(db, 'customer_payments');
  const hasPayCur = hasPayTable && _cols(db, 'customer_payments').has('currency');
  const paySelect = hasPayTable
    ? `SELECT id, amount, payment_method, received_by, shift_id, created_at, paid_at
              ${hasPayCur ? ', currency' : ''}
       FROM customer_payments`
    : null;
  const findPayById = paySelect
    ? db.prepare(`${paySelect} WHERE customer_id = ? AND id = ? LIMIT 1`)
    : null;
  const findPayByNumber = paySelect
    ? db.prepare(`${paySelect} WHERE customer_id = ? AND payment_number = ? LIMIT 1`)
    : null;

  const sumOrderAlloc = hasAlloc
    ? db.prepare(
        `
        SELECT COALESCE(SUM(COALESCE(applied_amount, allocated_amount, 0)), 0) AS s
        FROM customer_payment_allocations
        WHERE payment_id = ?
      `
      )
    : null;

  let appliedTotal = 0;
  let allocationRows = 0;
  let paymentsTouched = 0;

  for (const row of ledgerIns) {
    if (!listOpenCreditOrders(db, customerId, cur).length) break;

    const refId = row.ref_id != null ? String(row.ref_id) : '';
    const refNo = row.ref_no != null ? String(row.ref_no) : '';
    let pay = null;
    if (findPayById && refId) {
      pay = findPayById.get(customerId, refId);
      if (!pay && refId.startsWith('pay-')) {
        pay = findPayById.get(customerId, refId.slice(4));
      }
    }
    if (!pay && findPayByNumber && refNo) {
      pay = findPayByNumber.get(customerId, refNo);
    }
    if (hasPayCur && pay?.currency && normalizeCustomerCurrency(pay.currency) !== cur) {
      continue;
    }

    const paymentId = pay?.id || (refId.startsWith('pay-') ? refId.slice(4) : refId) || null;
    if (!paymentId) continue;

    const inbound = roundMoney(Math.abs(Number(row.amount) || 0));
    const already = sumOrderAlloc ? roundMoney(Number(sumOrderAlloc.get(paymentId)?.s || 0)) : 0;
    let left = roundMoney(Math.max(0, inbound - already));
    if (left <= 0.009) continue;

    const open = listOpenCreditOrders(db, customerId, cur);
    const plan = buildFifoAllocationPlan(open, left);
    if (!plan.allocations.length) continue;

    const now =
      pay?.paid_at ||
      pay?.created_at ||
      row.created_at ||
      new Date().toISOString().replace('T', ' ').slice(0, 19);
    let touched = false;

    for (const a of plan.allocations) {
      const order =
        open.find((o) => String(o.id) === String(a.order_id)) ||
        db.prepare(`SELECT * FROM orders WHERE id = ?`).get(a.order_id);
      if (!order) continue;
      const result = applyAmountToOrderRow(db, order, a.applied_amount, now);
      if (!(result.applied > 0.009)) continue;
      touched = true;
      appliedTotal = roundMoney(appliedTotal + result.applied);
      allocationRows += 1;
      if (hasAlloc) {
        insertPaymentAllocation(db, {
          payment_id: paymentId,
          customer_id: customerId,
          order_id: a.order_id,
          applied_amount: result.applied,
          order_balance_before: a.order_balance_before,
          order_balance_after: result.remainingAfter,
          remainder_to_advance: 0,
          currency: cur,
          payment_method: pay?.payment_method || row.method || null,
          shift_id: pay?.shift_id || null,
          created_at: now,
          created_by: row.created_by || pay?.received_by || null,
          allocation_type: 'legacy_debt_payment_backfill',
        });
      }
      left = roundMoney(left - result.applied);
      if (left <= 0.009) break;
    }
    if (touched) paymentsTouched += 1;
  }

  return {
    applied: roundMoney(appliedTotal),
    allocation_rows: allocationRows,
    payments_touched: paymentsTouched,
  };
}

/**
 * Overlay computed AR onto the customer row so list/card/modals that still read
 * `balance` / `debt_*` see the same truth as Hisob holati (open orders + loans).
 * Persist/heal (UPDATE debt columns, credit_amount, allocations) only when opts.sync
 * AND CUSTOMER_AR_HEAL is explicitly enabled — default is display-only (no DB writes).
 */
function attachPosition(customer, db, currency = 'UZS', opts = {}) {
  if (!customer || !db) return customer;
  const sync = Boolean(opts.sync) && isCustomerArHealEnabled();
  let pos = computeCustomerPosition(db, customer.id, 'UZS');
  let posUsd = computeCustomerPosition(db, customer.id, 'USD');

  if (sync) {
    // Repair stale order remainders before trusting / syncing open-order debt.
    try {
      if (Number(pos.open_order_debt || 0) > 0.009) {
        const bf = backfillMissingOrderAllocations(db, customer.id, 'UZS');
        if (bf.applied > 0.009) {
          pos = computeCustomerPosition(db, customer.id, 'UZS');
        }
      }
      if (Number(posUsd.open_order_debt || 0) > 0.009) {
        const bfUsd = backfillMissingOrderAllocations(db, customer.id, 'USD');
        if (bfUsd.applied > 0.009) {
          posUsd = computeCustomerPosition(db, customer.id, 'USD');
        }
      }
    } catch (bfErr) {
      console.warn(
        '[attachPosition] backfillMissingOrderAllocations failed:',
        bfErr?.message || bfErr
      );
    }

    const driftUzs = Math.abs(Number(pos.stored_debt_variance || 0)) > 0.02;
    const driftUsd = Math.abs(Number(posUsd.stored_debt_variance || 0)) > 0.02;
    if (driftUzs || driftUsd) {
      const at = new Date().toISOString();
      if (driftUzs) syncCustomerDebtFromPosition(db, customer.id, 'UZS', at);
      if (driftUsd) syncCustomerDebtFromPosition(db, customer.id, 'USD', at);
      pos = computeCustomerPosition(db, customer.id, 'UZS');
      posUsd = computeCustomerPosition(db, customer.id, 'USD');
    }

    // Heal only when ortiqcha fully covers still-open *order* debt (return split-brain).
    // Loans are left alone so «Pul berildi» can coexist with leftover ortiqcha.
    try {
      const at = new Date().toISOString().replace('T', ' ').slice(0, 19);
      if (
        Number(pos.advance || 0) > 0.009 &&
        Number(pos.open_order_debt || 0) > 0.009 &&
        Number(pos.advance || 0) + 0.01 >= Number(pos.open_order_debt || 0)
      ) {
        const settled = settleAdvanceAgainstOpenDebt(db, customer.id, 'UZS', { createdAt: at });
        if ((settled.applied_to_orders || 0) > 0.009) {
          pos = computeCustomerPosition(db, customer.id, 'UZS');
        }
      }
      if (
        Number(posUsd.advance || 0) > 0.009 &&
        Number(posUsd.open_order_debt || 0) > 0.009 &&
        Number(posUsd.advance || 0) + 0.01 >= Number(posUsd.open_order_debt || 0)
      ) {
        const settledUsd = settleAdvanceAgainstOpenDebt(db, customer.id, 'USD', { createdAt: at });
        if ((settledUsd.applied_to_orders || 0) > 0.009) {
          posUsd = computeCustomerPosition(db, customer.id, 'USD');
        }
      }
    } catch (settleErr) {
      console.warn(
        '[attachPosition] settleAdvanceAgainstOpenDebt failed:',
        settleErr?.message || settleErr
      );
    }
  }

  customer.position = pos;
  customer.position_usd = posUsd;
  customer.open_order_debt = pos.open_order_debt;
  customer.loan_debt = pos.loan_debt;
  customer.total_debt = pos.total_debt;
  customer.overdue_amount = pos.overdue_amount;
  customer.unapplied_advance = pos.unapplied_advance;
  // Signed net + dual buckets (display/API cache — matches computeCustomerPosition)
  customer.balance = pos.net;
  customer.debt_uzs = pos.total_debt;
  customer.advance_uzs = pos.advance;
  customer.balance_usd = posUsd.net;
  customer.debt_usd = posUsd.total_debt;
  customer.advance_usd = posUsd.advance;
  void currency;
  return customer;
}

function classifyInboundOpType(debtPortion, advancePortion, loanRepaid) {
  if (roundMoney(loanRepaid) > 0.009 && roundMoney(debtPortion + advancePortion) <= 0.009) {
    return OP.CUSTOMER_LOAN_REPAID;
  }
  if (roundMoney(advancePortion) > 0.009 && roundMoney(debtPortion) <= 0.009) {
    return OP.ADVANCE_RECEIVED;
  }
  if (roundMoney(debtPortion) > 0.009) {
    return OP.DEBT_PAYMENT_RECEIVED;
  }
  return OP.CUSTOMER_PAYMENT;
}

function ledgerOpCodeForPayment(operation, paymentOutKind, inboundOpType) {
  if (operation === 'payment_out' && paymentOutKind === 'lend') return OP.CUSTOMER_LOAN_ISSUED;
  if (operation === 'payment_out') return OP.ADVANCE_REFUND;
  return inboundOpType || OP.DEBT_PAYMENT_RECEIVED;
}

function appendLedgerAuditCols(db, cols, vals, audit) {
  const names = _cols(db, 'customer_ledger');
  if (names.has('op_code') && audit?.op_code != null) {
    cols.push('op_code');
    vals.push(audit.op_code);
  }
  if (names.has('debt_before') && audit) {
    cols.push('debt_before', 'debt_after', 'advance_before', 'advance_after');
    vals.push(
      audit.debt_before ?? null,
      audit.debt_after ?? null,
      audit.advance_before ?? null,
      audit.advance_after ?? null
    );
  }
}

function sumComputedDebtAll(db, currency = 'UZS') {
  const cur = normalizeCustomerCurrency(currency);
  const hasUsd = _cols(db, 'customers').has('balance_usd');
  const customers = db
    .prepare(`SELECT id FROM customers WHERE COALESCE(status, 'active') = 'active'`)
    .all();
  let debt = 0;
  let advance = 0;
  for (const c of customers || []) {
    const pos = computeCustomerPosition(db, c.id, cur);
    debt += pos.total_debt;
    advance += pos.advance;
  }
  void hasUsd;
  return { debt_uzs: cur === 'UZS' ? roundMoney(debt) : 0, debt: roundMoney(debt), advance: roundMoney(advance) };
}

module.exports = {
  OP,
  roundMoney,
  isCustomerArHealEnabled,
  orderRemaining,
  buildFifoAllocationPlan,
  assertCreditExposure,
  listOpenCreditOrders,
  computeCustomerPosition,
  totalExposure,
  syncCustomerDebtFromPosition,
  allocateInboundToOpenOrders,
  applyReturnToOrderRemaining,
  settleAdvanceAgainstOpenDebt,
  applyAmountToOrderRow,
  backfillMissingOrderAllocations,
  attachPosition,
  classifyInboundOpType,
  ledgerOpCodeForPayment,
  appendLedgerAuditCols,
  insertPaymentAllocation,
  sumComputedDebtAll,
  todayYmd,
};

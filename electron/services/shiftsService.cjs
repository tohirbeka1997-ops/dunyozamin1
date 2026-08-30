const { ERROR_CODES, createError } = require('../lib/errors.cjs');
const { expenseAmountUzsSql } = require('../lib/expenseAmount.cjs');
const {
  orderAmountUzsSql,
  orderFieldUzsSql,
  orderSalesSplitExpressions,
  paymentAmountUzsSql,
  paymentSalesSplitExpressions,
  returnRefundUzsSql,
} = require('../lib/orderAmount.cjs');
const {
  parsePositiveMoneyAmount,
  parseNonNegativeMoneyAmount,
  requiresShiftVarianceReason,
} = require('../lib/posHardening.cjs');
const { randomUUID } = require('crypto');

/**
 * Yakunlangan savdo buyurtmasi (POS `orders`).
 * SHABLON ichida alohida `` ` `` ishlatmaslik — ba’zi muhitlarda noto‘g‘ri interpolatsiya xavfi.
 * Faqat bitta `?` — shift_id; bu qatorlarda `?` ISHLATILMAYDI.
 */
const WHERE_ORDER_DONE_ALIAS_O =
  "(LOWER(TRIM(COALESCE(o.status, ''))) IN ('completed', 'paid', 'done'))";

const WHERE_ORDER_DONE_STATUS_COL =
  "(LOWER(TRIM(COALESCE(status, ''))) IN ('completed', 'paid', 'done'))";

/**
 * Shifts Service
 * Handles cashier shift management
 */
class ShiftsService {
  constructor(db) {
    this.db = db;
  }

  /**
   * Detect simple calendar date (YYYY-MM-DD).
   * We use this to apply local-day filtering via SQLite DATE(..., 'localtime').
   */
  _isYmdDate(value) {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
  }

  /**
   * Kassadan chiqgan naqd qaytarishlar (batafsil breakdown):
   * - strictCash: refund_method aniq 'cash' / 'naqd' bo‘lganlar
   * - legacyUnknown: refund_method NULL/bo‘sh — eski/import qilingan ma‘lumotlarda
   *   default sifatida naqd deb sanaladi (back-compat)
   * - fromMovements: cash_movements jadvalidagi movement_type='refund' (almashuv qaytimi)
   * - total: strictCash + legacyUnknown + fromMovements
   */
  _getCashRefundsBreakdown(shiftId) {
    const empty = { strictCash: 0, legacyUnknown: 0, fromMovements: 0, total: 0 };
    if (!shiftId) return empty;
    const sid = String(shiftId).trim();
    if (!sid) return empty;

    let strictCash = 0;
    let legacyUnknown = 0;
    try {
      const row = this.db
        .prepare(
          `
        SELECT
          COALESCE(SUM(CASE
            WHEN LOWER(TRIM(COALESCE(refund_method, ''))) IN ('cash', 'naqd')
              THEN COALESCE(refund_amount, total_amount, 0)
            ELSE 0
          END), 0) AS strict_cash,
          COALESCE(SUM(CASE
            WHEN refund_method IS NULL OR TRIM(COALESCE(refund_method, '')) = ''
              THEN COALESCE(refund_amount, total_amount, 0)
            ELSE 0
          END), 0) AS legacy_unknown
        FROM sales_returns
        WHERE shift_id = ? AND status = 'completed'
      `
        )
        .get(sid);
      strictCash = Number(row?.strict_cash || 0) || 0;
      legacyUnknown = Number(row?.legacy_unknown || 0) || 0;
    } catch (e) {
      console.warn('[SHIFT] _getCashRefundsBreakdown sales_returns:', e.message);
    }

    let fromMovements = 0;
    try {
      const row = this.db
        .prepare(
          `
        SELECT COALESCE(SUM(amount), 0) AS s
        FROM cash_movements
        WHERE shift_id = ?
          AND LOWER(TRIM(COALESCE(movement_type, ''))) = 'refund'
      `
        )
        .get(sid);
      fromMovements = Number(row?.s || 0) || 0;
    } catch (e) {
      /* cash_movements jadvali yo'q bo'lishi mumkin */
    }

    return {
      strictCash,
      legacyUnknown,
      fromMovements,
      total: strictCash + legacyUnknown + fromMovements,
    };
  }

  /**
   * Backwards-compatible umumiy raqam (oldingi API).
   * Yangi kod _getCashRefundsBreakdown() ni ishlatishi tavsiya etiladi.
   */
  _getCashDrawerRefundsOut(shiftId) {
    return this._getCashRefundsBreakdown(shiftId).total;
  }

  /**
   * Smena ichida qilingan naqd xarajatlar (kassadan chiqim).
   * - sourceExpenses: `expenses` jadvali (rasmiy xarajatlar tizimi orqali)
   * - sourceMovements: `cash_movements.movement_type='withdrawal'` (yopiq
   *   inkassatsiya / qo‘l bilan chiqim)
   * `expenses.shift_id` ustuni eski bazalarda bo‘lmasligi mumkin — soft-fail.
   */
  _getCashOutflowBreakdown(shiftId) {
    const empty = {
      cashExpenses: 0,
      cashWithdrawals: 0,
      total: 0,
    };
    if (!shiftId) return empty;
    const sid = String(shiftId).trim();
    if (!sid) return empty;

    let cashExpenses = 0;
    try {
      const cols = this.db.prepare('PRAGMA table_info(expenses)').all();
      const hasShift = cols.some((c) => c.name === 'shift_id');
      if (hasShift) {
        const amtExpr = expenseAmountUzsSql(this.db, 'expenses');
        const row = this.db
          .prepare(
            `
          SELECT COALESCE(SUM(${amtExpr}), 0) AS s
          FROM expenses
          WHERE shift_id = ?
            AND LOWER(TRIM(COALESCE(payment_method, ''))) IN ('cash', 'naqd')
            AND LOWER(TRIM(COALESCE(status, 'approved'))) IN ('approved', 'paid')
        `
          )
          .get(sid);
        cashExpenses = Number(row?.s || 0) || 0;
      }
    } catch (e) {
      console.warn('[SHIFT] _getCashOutflowBreakdown expenses:', e.message);
    }

    let cashWithdrawals = 0;
    try {
      const row = this.db
        .prepare(
          `
        SELECT COALESCE(SUM(amount), 0) AS s
        FROM cash_movements
        WHERE shift_id = ?
          AND LOWER(TRIM(COALESCE(movement_type, ''))) = 'withdrawal'
      `
        )
        .get(sid);
      cashWithdrawals = Number(row?.s || 0) || 0;
    } catch (e) {
      /* cash_movements jadvali yo'q bo'lishi mumkin */
    }

    return {
      cashExpenses,
      cashWithdrawals,
      total: cashExpenses + cashWithdrawals,
    };
  }

  /**
   * Smena ichida kassaga naqd kirim (deposit) — qo‘l bilan to‘ldirish.
   */
  _getCashDepositsTotal(shiftId) {
    if (!shiftId) return 0;
    const sid = String(shiftId).trim();
    if (!sid) return 0;
    try {
      const row = this.db
        .prepare(
          `
        SELECT COALESCE(SUM(amount), 0) AS s
        FROM cash_movements
        WHERE shift_id = ?
          AND LOWER(TRIM(COALESCE(movement_type, ''))) = 'deposit'
      `
        )
        .get(sid);
      return Number(row?.s || 0) || 0;
    } catch {
      return 0;
    }
  }

  /**
   * To‘lovlar usullari bo‘yicha taqsimot (kassir terminal/karta ko‘chirmasi bilan
   * solishtirishi uchun). `refund_cash` qatorlarini chiqarib tashlaymiz — ular
   * sotuv emas, kassadan qaytarish.
   */
  _getPaymentsByMethod(shiftId) {
    const empty = { cash: 0, card: 0, qr: 0, click: 0, payme: 0, transfer: 0, credit: 0, other: 0 };
    if (!shiftId) return empty;
    const sid = String(shiftId).trim();
    if (!sid) return empty;

    try {
      const payUzs = paymentAmountUzsSql(this.db, 'p', 'o');
      const rows = this.db
        .prepare(
          `
        SELECT
          LOWER(TRIM(COALESCE(p.payment_method, ''))) AS method,
          COALESCE(SUM(${payUzs}), 0) AS s
        FROM payments p
        INNER JOIN orders o ON p.order_id = o.id
        WHERE o.shift_id = ? AND ${WHERE_ORDER_DONE_ALIAS_O}
          AND LOWER(TRIM(COALESCE(p.payment_method, ''))) NOT IN ('refund_cash', 'refund_balance')
        GROUP BY LOWER(TRIM(COALESCE(p.payment_method, '')))
      `
        )
        .all(sid);

      const out = { ...empty };
      for (const r of rows) {
        const amt = Number(r?.s || 0) || 0;
        const m = String(r?.method || '').trim();
        if (m === 'cash' || m === 'naqd') out.cash += amt;
        else if (m === 'card' || m === 'plastik' || m === 'plastic') out.card += amt;
        else if (m === 'qr' || m === 'qr_code') out.qr += amt;
        else if (m === 'click') out.click += amt;
        else if (m === 'payme') out.payme += amt;
        else if (m === 'transfer' || m === 'bank' || m === 'bank_transfer' || m === "o'tkazma" || m === 'otkazma') {
          out.transfer += amt;
        } else if (m === 'credit' || m === 'nasiya' || m === 'qarz') out.credit += amt;
        else out.other += amt;
      }
      return out;
    } catch (e) {
      console.warn('[SHIFT] _getPaymentsByMethod:', e.message);
      return empty;
    }
  }

  /**
   * Mijoz balansiga toʻlovlar (customer_payments): smenaga bogʻlangan naqd oqimi va qarz yopish.
   * - customerDrawerCashNet: kassaga naqd (+ kirim, − chiqim mijozga)
   * - debtRepaidTotal: old_balance < 0 boʻlgan kirimlar (qarzni toʻlash, barcha usullar)
   * - debtRepaidCash: shundan naqd/naqd
   */
  _getCustomerPaymentsShiftRollup(shiftId) {
    const empty = { customerDrawerCashNet: 0, debtRepaidTotal: 0, debtRepaidCash: 0 };
    if (!shiftId) return empty;
    const sid = String(shiftId).trim();
    if (!sid) return empty;
    try {
      const cols = this.db.prepare('PRAGMA table_info(customer_payments)').all();
      if (!cols.some((c) => c.name === 'shift_id')) return empty;
      const hasOld = cols.some((c) => c.name === 'old_balance');

      const cashNetRow = this.db
        .prepare(
          `
        SELECT COALESCE(SUM(
          CASE
            WHEN LOWER(TRIM(COALESCE(payment_method, ''))) NOT IN ('cash', 'naqd') THEN 0
            WHEN COALESCE(operation, 'payment_in') = 'payment_out' THEN -ABS(COALESCE(amount, 0))
            ELSE COALESCE(amount, 0)
          END
        ), 0) AS s
        FROM customer_payments
        WHERE shift_id = ?
      `
        )
        .get(sid);
      const customerDrawerCashNet = Number(cashNetRow?.s || 0) || 0;

      if (!hasOld) {
        return { customerDrawerCashNet, debtRepaidTotal: 0, debtRepaidCash: 0 };
      }

      const debtAll = this.db
        .prepare(
          `
        SELECT COALESCE(SUM(COALESCE(amount, 0)), 0) AS s
        FROM customer_payments
        WHERE shift_id = ?
          AND (operation IS NULL OR operation = 'payment_in')
          AND COALESCE(old_balance, 0) < -0.009
      `
        )
        .get(sid);
      const debtCash = this.db
        .prepare(
          `
        SELECT COALESCE(SUM(COALESCE(amount, 0)), 0) AS s
        FROM customer_payments
        WHERE shift_id = ?
          AND (operation IS NULL OR operation = 'payment_in')
          AND COALESCE(old_balance, 0) < -0.009
          AND LOWER(TRIM(COALESCE(payment_method, ''))) IN ('cash', 'naqd')
      `
        )
        .get(sid);

      return {
        customerDrawerCashNet,
        debtRepaidTotal: Number(debtAll?.s || 0) || 0,
        debtRepaidCash: Number(debtCash?.s || 0) || 0,
      };
    } catch (e) {
      console.warn('[SHIFT] _getCustomerPaymentsShiftRollup:', e.message);
      return empty;
    }
  }

  /**
   * Open shift
   */
  openShift(data) {
    // CRITICAL: cashier_id is NOT NULL in schema, so we must provide it
    // Accept either cashier_id or user_id (map user_id to cashier_id)
    const cashierId = data.cashier_id || data.user_id;
    
    if (!cashierId) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 
        'Cashier ID is required. Please provide cashier_id or user_id.');
    }

    // SINGLE WAREHOUSE SYSTEM: Always use main-warehouse-001
    const MAIN_WAREHOUSE_ID = 'main-warehouse-001';
    
    // Ensure main warehouse exists (create if missing)
    const warehouseExists = this.db.prepare('SELECT id FROM warehouses WHERE id = ?').get(MAIN_WAREHOUSE_ID);
    if (!warehouseExists) {
      console.log('⚠️  [ShiftsService.open] Main warehouse not found, creating it...');
      this.db.prepare(`
        INSERT INTO warehouses (id, code, name, is_active, created_at, updated_at)
        VALUES (?, 'MAIN', 'Asosiy Ombor', 1, datetime('now'), datetime('now'))
      `).run(MAIN_WAREHOUSE_ID);
      console.log('✅ [ShiftsService.open] Main warehouse created');
    }
    
    // Always use main warehouse (ignore any provided warehouse_id)
    const warehouseId = MAIN_WAREHOUSE_ID;
    console.log('📦 [ShiftsService.open] Using main warehouse:', warehouseId);

    // CRITICAL: Run in transaction to ensure atomicity
    return this.db.transaction(() => {
      // Check if user has open shift (use cashier_id for lookup)
      const existingShift = this.db.prepare(`
        SELECT * FROM shifts 
        WHERE cashier_id = ? AND warehouse_id = ? AND status = 'open' AND closed_at IS NULL
      `).get(cashierId, warehouseId);

      if (existingShift) {
        throw createError(ERROR_CODES.VALIDATION_ERROR, 'User already has an open shift');
      }

      const id = randomUUID();
      const shiftNumber = `SHF-${Date.now()}`;
      const now = new Date().toISOString();

      console.log('[SHIFT] Opening shift:', {
        shiftId: id,
        cashier_id: cashierId,
        warehouse_id: warehouseId,
        opening_cash: data.opening_cash || 0,
        status: 'open'
      });

      // CRITICAL FIX: Include cashier_id in INSERT (required by schema)
      this.db.prepare(`
        INSERT INTO shifts (
          id, shift_number, cashier_id, user_id, warehouse_id, opened_at,
          opening_cash, status, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        shiftNumber,
        cashierId,        // ✅ cashier_id (NOT NULL)
        cashierId,        // ✅ user_id (alias, same value)
        warehouseId,
        now,
        data.opening_cash || 0,
        'open',
        now
      );

      // CRITICAL: Update users.current_shift_id to link user to shift
      // Check if current_shift_id column exists (for backward compatibility)
      try {
        this.db.prepare(`
          UPDATE users 
          SET current_shift_id = ?, updated_at = ?
          WHERE id = ?
        `).run(id, now, cashierId);
        console.log('✅ Updated users.current_shift_id:', { cashierId, shiftId: id });
      } catch (error) {
        // Column might not exist in older databases - log warning but continue
        console.warn('⚠️ Could not update users.current_shift_id (column may not exist):', error.message);
      }

      console.log('[SHIFT] Shift opened successfully:', {
        shiftId: id,
        status: 'open',
        cashier_id: cashierId,
        warehouse_id: warehouseId
      });

      return this.getById(id);
    })();
  }

  /**
   * Close shift - ID-based implementation
   * Fixed version without updated_at column
   * Always loads shift by ID (not by query)
   */
  closeShift(shiftId, data = {}) {
    const { closing_cash: closingCashRaw = 0, notes = null, closed_by: closedBy = null } = data;

    const parsedClosing = parseNonNegativeMoneyAmount(closingCashRaw);
    if (!parsedClosing.ok) {
      throw createError(
        ERROR_CODES.UNPROCESSABLE_ENTITY,
        parsedClosing.error || 'Yopilish naqd puli 0 dan katta yoki teng bo‘lishi kerak',
        { field: 'closing_cash', value: closingCashRaw }
      );
    }
    const closingCash = parsedClosing.amount;
    
    console.log('[SHIFT] closeShift called:', {
      shiftId,
      shiftId_type: typeof shiftId,
      shiftId_value: shiftId,
      closingCash,
      closedBy,
      notes
    });

    const runClose = this.db.transaction(() => {
      // DEBUGGING: Check what shifts exist
      const allShifts = this.db.prepare('SELECT id, status, user_id, cashier_id FROM shifts ORDER BY opened_at DESC LIMIT 5').all();
      console.log('[SHIFT] Recent shifts in DB:', allShifts);
      
      // DEBUGGING: Try to find shift without status filter
      const shiftAnyStatus = this.db.prepare('SELECT * FROM shifts WHERE id = ?').get(shiftId);
      console.log('[SHIFT] Shift with any status:', shiftAnyStatus);
      
      // 1. Load shift by ID (not by query)
      const shift = this.db.prepare(`
        SELECT * FROM shifts
        WHERE id = ? AND status = 'open'
      `).get(shiftId);

      console.log('[SHIFT] Loaded shift:', {
        shiftId,
        found: !!shift,
        status: shift?.status,
        user_id: shift?.user_id,
        cashier_id: shift?.cashier_id
      });

      if (!shift) {
        console.error('[SHIFT] ❌ Cannot find open shift with id:', shiftId);
        console.error('[SHIFT] Shift exists but wrong status?', shiftAnyStatus?.status);
        throw createError(
          ERROR_CODES.VALIDATION_ERROR,
          shiftAnyStatus?.status === 'closed'
            ? 'Smena allaqachon yopilgan yoki boshqa jarayon tomonidan yopilmoqda'
            : 'Yopish uchun ochiq smena topilmadi.'
        );
      }

      // 2. Calculate Expected Total from PAYMENTS (not orders.total_amount)
      // This ensures we count actual payments, not just order totals
      const payUzs = paymentAmountUzsSql(this.db, 'p', 'o');
      const paymentsData = this.db.prepare(`
        SELECT 
          COALESCE(SUM(CASE
            WHEN LOWER(TRIM(COALESCE(p.payment_method, ''))) IN ('refund_cash', 'refund_balance') THEN 0
            ELSE ${payUzs}
          END), 0) as total_payments,
          COALESCE(SUM(CASE
            WHEN LOWER(TRIM(COALESCE(p.payment_method, ''))) IN ('cash', 'naqd') THEN ${payUzs}
            ELSE 0
          END), 0) as cash_payments
        FROM payments p
        INNER JOIN orders o ON p.order_id = o.id
        WHERE o.shift_id = ? AND ${WHERE_ORDER_DONE_ALIAS_O}
      `).get(shiftId);

      // Also get order count and total for reference
      const orderUzs = orderAmountUzsSql(this.db, 'orders');
      const ordersData = this.db.prepare(`
        SELECT 
          COUNT(*) as order_count,
          COALESCE(SUM(${orderUzs}), 0) as order_total,
          COALESCE(SUM(COALESCE(paid_amount, 0)), 0) as paid_sum
        FROM orders 
        WHERE shift_id = ? AND ${WHERE_ORDER_DONE_STATUS_COL}
      `).get(shiftId);

      // systemTotal = mijoz to‘lagan barcha pul (nasiyasiz). closeShift returnida saqlanadi.
      const systemTotal = Number(paymentsData.total_payments || 0) || 0;
      const cashTotal = paymentsData.cash_payments || 0;
      const cashRefundsOut = this._getCashDrawerRefundsOut(shiftId);
      const custRoll = this._getCustomerPaymentsShiftRollup(shiftId);
      const cashOutflow = this._getCashOutflowBreakdown(shiftId);
      const cashDeposits = this._getCashDepositsTotal(shiftId);

      let creditDebtIssuedClose = 0;
      try {
        const creditUzs = orderFieldUzsSql(this.db, 'o', 'credit_amount');
        const debtRow = this.db.prepare(`
          SELECT COALESCE(SUM(${creditUzs}), 0) AS s
          FROM orders o
          WHERE o.shift_id = ? AND ${WHERE_ORDER_DONE_ALIAS_O}
        `).get(shiftId);
        creditDebtIssuedClose = Number(debtRow?.s || 0) || 0;
      } catch {
        /* ignore */
      }

      // Kutilayotgan naqd = ochilish + buyurtma naqdi + mijoz balansiga naqd (qarz / oldindan)
      //                   + qo'lda kirim − naqd qaytarishlar − naqd xarajatlar − qo'lda chiqim
      const expectedCash =
        (shift.opening_cash || 0)
        + cashTotal
        + custRoll.customerDrawerCashNet
        + cashDeposits
        - cashRefundsOut
        - cashOutflow.total;

      // Calculate difference = closing_cash - expected_cash
      const difference = closingCash - expectedCash;

      const varianceCheck = requiresShiftVarianceReason(closingCash, expectedCash, notes);
      if (varianceCheck.missing) {
        throw createError(
          ERROR_CODES.UNPROCESSABLE_ENTITY,
          `Katta tafovut (${Math.round(varianceCheck.diff)} so'm) uchun sabab majburiy`,
          { field: 'notes', expectedCash, closingCash, difference: varianceCheck.diff }
        );
      }

      console.log('[SHIFT] Payment-based totals:', {
        shiftId,
        total_payments: systemTotal,
        cash_payments: cashTotal,
        customer_drawer_cash_net: custRoll.customerDrawerCashNet,
        debt_repaid_total: custRoll.debtRepaidTotal,
        debt_repaid_cash: custRoll.debtRepaidCash,
        cash_refunds_out: cashRefundsOut,
        cash_expenses: cashOutflow.cashExpenses,
        cash_withdrawals: cashOutflow.cashWithdrawals,
        cash_deposits: cashDeposits,
        credit_debt_issued: creditDebtIssuedClose,
        order_count: ordersData.order_count || 0,
        order_total: ordersData.order_total || 0,
        opening_cash: shift.opening_cash || 0,
        expected_cash: expectedCash,
        closing_cash: closingCash,
        difference
      });

      // 3. Update Shift (WITHOUT updated_at, WITH optional closed_by)
      // Check if closed_by column exists
      const tableInfo = this.db.prepare("PRAGMA table_info(shifts)").all();
      const hasClosedBy = tableInfo.some(col => col.name === 'closed_by');
      const hasNotes = tableInfo.some(col => col.name === 'notes');

      let updateResult;
      if (hasClosedBy && hasNotes) {
        updateResult = this.db.prepare(`
          UPDATE shifts 
          SET 
            closed_at = datetime('now'),
            status = 'closed',
            closing_cash = ?,
            expected_cash = ?,
            cash_difference = ?,
            closed_by = ?,
            notes = COALESCE(?, notes)
          WHERE id = ? AND status = 'open' AND closed_at IS NULL
        `).run(closingCash, expectedCash, difference, closedBy || shift.user_id || shift.cashier_id, notes || null, shiftId);
      } else if (hasClosedBy) {
        updateResult = this.db.prepare(`
          UPDATE shifts 
          SET 
            closed_at = datetime('now'),
            status = 'closed',
            closing_cash = ?,
            expected_cash = ?,
            cash_difference = ?,
            closed_by = ?
          WHERE id = ? AND status = 'open' AND closed_at IS NULL
        `).run(closingCash, expectedCash, difference, closedBy || shift.user_id || shift.cashier_id, shiftId);
      } else {
        updateResult = this.db.prepare(`
          UPDATE shifts 
          SET 
            closed_at = datetime('now'),
            status = 'closed',
            closing_cash = ?,
            expected_cash = ?,
            cash_difference = ?
          WHERE id = ? AND status = 'open' AND closed_at IS NULL
        `).run(closingCash, expectedCash, difference, shiftId);
      }

      if (!updateResult || updateResult.changes === 0) {
        throw createError(
          ERROR_CODES.VALIDATION_ERROR,
          'Smena allaqachon yopilgan yoki boshqa jarayon tomonidan yopilmoqda'
        );
      }

      // 4. Update User's current shift status
      const userId = shift.user_id || shift.cashier_id;
      if (userId) {
        try {
          this.db.prepare('UPDATE users SET current_shift_id = NULL WHERE id = ?').run(userId);
          console.log('[SHIFT] Cleared users.current_shift_id for user:', userId);
        } catch (error) {
          console.warn('[SHIFT] Could not clear users.current_shift_id (column may not exist):', error.message);
        }
      }

      console.log('[SHIFT] Shift closed successfully:', {
        shiftId,
        status: 'closed',
        closingCash,
        expectedCash,
        cashDifference: difference,
        totalPayments: systemTotal,
        cashPayments: cashTotal
      });

      try {
        this.batchService?.runReconcileCheck?.({ source: 'shift_close' });
      } catch (reconcileErr) {
        console.warn('[SHIFT] batch reconcile on shift close failed:', reconcileErr?.message || reconcileErr);
      }

      return {
        success: true,
        shiftId,
        closingCash,
        expectedCash,
        cashDifference: difference,
        totalPayments: systemTotal,
        cashPayments: cashTotal,
        cashRefundsOut,
        cashExpenses: cashOutflow.cashExpenses,
        cashWithdrawals: cashOutflow.cashWithdrawals,
        cashDeposits,
        creditDebtIssued: creditDebtIssuedClose,
        customerDrawerCashNet: custRoll.customerDrawerCashNet,
        debtRepaidTotal: custRoll.debtRepaidTotal,
        debtRepaidCash: custRoll.debtRepaidCash
      };
    });

    const result = runClose.immediate();
    try {
      this._writeAuditLog({
        user_id: closedBy || null,
        action: 'shift_close',
        entity_type: 'shift',
        entity_id: shiftId,
        old_values: { status: 'open' },
        new_values: {
          status: 'closed',
          closing_cash: result.closingCash,
          expected_cash: result.expectedCash,
          cash_difference: result.cashDifference,
          notes: notes || null,
        },
      });
    } catch (auditErr) {
      console.warn('[SHIFT] close audit log failed:', auditErr?.message || auditErr);
    }
    this._notifyShiftClosedReport(result);
    return result;
  }

  /**
   * Reopen a closed shift (admin/manager only) with audit trail.
   */
  reopenShift(shiftId, data = {}) {
    const sid = String(shiftId || '').trim();
    if (!sid) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'shiftId majburiy');
    }
    const userId = data.user_id || data.userId || data.reopened_by || null;
    const reason = String(data.reason || data.notes || '').trim();
    if (!reason) {
      throw createError(ERROR_CODES.UNPROCESSABLE_ENTITY, 'Smenani qayta ochish uchun sabab majburiy', {
        field: 'reason',
      });
    }
    if (!userId || !this._userHasElevatedRole(userId)) {
      throw createError(
        ERROR_CODES.PERMISSION_DENIED,
        'Yopiq smenani qayta ochish faqat admin/manager uchun'
      );
    }

    const run = this.db.transaction(() => {
      const shift = this.db.prepare('SELECT * FROM shifts WHERE id = ?').get(sid);
      if (!shift) {
        throw createError(ERROR_CODES.NOT_FOUND, `Smena topilmadi: ${sid}`);
      }
      if (shift.status !== 'closed') {
        throw createError(ERROR_CODES.VALIDATION_ERROR, 'Faqat yopiq smenani qayta ochish mumkin');
      }
      const openOther = this.db
        .prepare(
          `
        SELECT id FROM shifts
        WHERE status = 'open' AND closed_at IS NULL
          AND (cashier_id = ? OR user_id = ?)
        LIMIT 1
      `
        )
        .get(shift.cashier_id || shift.user_id, shift.user_id || shift.cashier_id);
      if (openOther) {
        throw createError(
          ERROR_CODES.VALIDATION_ERROR,
          'Kassirda allaqachon ochiq smena bor — avval uni yoping'
        );
      }

      const updated = this.db
        .prepare(
          `
        UPDATE shifts
        SET status = 'open',
            closed_at = NULL,
            closing_cash = NULL,
            expected_cash = NULL,
            cash_difference = NULL
        WHERE id = ? AND status = 'closed'
      `
        )
        .run(sid);
      if (!updated.changes) {
        throw createError(ERROR_CODES.VALIDATION_ERROR, 'Smenani qayta ochib bo‘lmadi');
      }

      const uid = shift.user_id || shift.cashier_id;
      if (uid) {
        try {
          this.db.prepare('UPDATE users SET current_shift_id = ? WHERE id = ?').run(sid, uid);
        } catch {
          /* column may not exist */
        }
      }

      return this.db.prepare('SELECT * FROM shifts WHERE id = ?').get(sid);
    });

    const reopened = run.immediate();
    this._writeAuditLog({
      user_id: userId,
      action: 'shift_reopen',
      entity_type: 'shift',
      entity_id: sid,
      old_values: { status: 'closed' },
      new_values: { status: 'open', reason },
    });
    return reopened;
  }

  _userHasElevatedRole(userId) {
    try {
      const rows = this.db
        .prepare(
          `
        SELECT LOWER(TRIM(COALESCE(r.code, ''))) AS code
        FROM user_roles ur
        JOIN roles r ON r.id = ur.role_id
        WHERE ur.user_id = ?
      `
        )
        .all(String(userId));
      return rows.some((r) => r.code === 'admin' || r.code === 'manager');
    } catch {
      return false;
    }
  }

  /**
   * Fire-and-forget Telegram report when a shift is closed.
   */
  _notifyShiftClosedReport(result) {
    try {
      if (!result?.success || !result?.shiftId) return;
      const { notifyShiftClosed } = require('../../public-api/lib/reportNotify.cjs');
      void notifyShiftClosed(this.db, {
        shiftId: result.shiftId,
        closingCash: result.closingCash,
        expectedCash: result.expectedCash,
        cashDifference: result.cashDifference,
        totalPayments: result.totalPayments,
        cashPayments: result.cashPayments,
        creditDebtIssued: result.creditDebtIssued,
      }).catch((e) => {
        console.warn('[SHIFT] telegram report notify failed:', e?.message || e);
      });
    } catch (e) {
      console.warn('[SHIFT] telegram report notify unavailable:', e?.message || e);
    }
  }

  _writeAuditLog({ user_id, action, entity_type, entity_id, old_values, new_values }) {
    try {
      const hasTable = this.db
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='audit_log'`)
        .get();
      if (!hasTable) return null;
      const id = randomUUID();
      const now = new Date().toISOString();
      this.db
        .prepare(
          `
        INSERT INTO audit_log (
          id, user_id, action, entity_type, entity_id,
          old_values, new_values, ip_address, user_agent, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)
      `
        )
        .run(
          id,
          user_id || null,
          action,
          entity_type,
          entity_id || null,
          old_values ? JSON.stringify(old_values) : null,
          new_values ? JSON.stringify(new_values) : null,
          now
        );
      return { id, created_at: now };
    } catch (e) {
      console.warn('[SHIFT] audit_log write failed:', e?.message || e);
      return null;
    }
  }

  /**
   * Get shift by ID
   */
  getById(id) {
    if (!id) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Shift ID is required');
    }

    const shift = this.db.prepare('SELECT * FROM shifts WHERE id = ?').get(id);
    if (!shift) {
      throw createError(ERROR_CODES.NOT_FOUND, `Shift ${id} not found`);
    }

    const totals = this.db.prepare('SELECT * FROM shift_totals WHERE shift_id = ?').get(id);

    return {
      ...shift,
      totals,
    };
  }

  /**
   * Get shift summary - single source of truth for shift totals
   * Uses the same calculation logic as closeShift
   */
  getShiftSummary(shiftId) {
    // Ba’zi RPC yo‘llari butun `{ shiftId }` obyektini uzatishi mumkin — faqat UUID ishlatamiz
    let sid = shiftId;
    if (Array.isArray(sid) && sid.length) {
      sid = sid[0];
    }
    const id =
      typeof sid === 'string' && String(sid).trim()
        ? String(sid).trim()
        : sid && typeof sid === 'object'
          ? String(sid.shiftId || sid.shift_id || sid.id || '').trim() || null
          : sid != null && (typeof sid === 'number' || typeof sid === 'bigint')
            ? String(sid)
            : null;
    if (!id) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Faol smena topilmadi — shiftId kerak');
    }
    const bindId = String(id).trim();

    // Get shift basic info
    const shift = this.db.prepare(`
      SELECT opening_cash, opened_at, closed_at, status
      FROM shifts
      WHERE id = ?
    `).get(bindId);

    if (!shift) {
      throw createError(ERROR_CODES.NOT_FOUND, `Shift ${bindId} not found`);
    }

    // Totals from PAYMENTS (same as closeShift). Order count MUST come from `orders`
    // alone — nasiya / to‘lovsiz yakunlangan buyurtmalar payments qatorida bo‘lmasligi
    // mumkin; INNER JOIN ularni "0 buyurtma" qilib tashlaydi.
    const payUzs = paymentAmountUzsSql(this.db, 'p', 'o');
    const paymentsData = this.db.prepare(`
      SELECT 
        COALESCE(SUM(CASE
          WHEN LOWER(TRIM(COALESCE(p.payment_method, ''))) IN ('refund_cash', 'refund_balance') THEN 0
          ELSE ${payUzs}
        END), 0) as total_payments,
        COALESCE(SUM(CASE
          WHEN LOWER(TRIM(COALESCE(p.payment_method, ''))) IN ('cash', 'naqd') THEN ${payUzs}
          ELSE 0
        END), 0) as cash_payments
      FROM payments p
      INNER JOIN orders o ON p.order_id = o.id
      WHERE o.shift_id = ? AND ${WHERE_ORDER_DONE_ALIAS_O}
    `).get(bindId);

    const paySplit = paymentSalesSplitExpressions(this.db, 'p', 'o');
    const paySplitRow = this.db.prepare(`
      SELECT ${paySplit.uzsSum} AS total_sales_uzs, ${paySplit.usdSum} AS total_sales_usd
      FROM payments p
      INNER JOIN orders o ON p.order_id = o.id
      WHERE o.shift_id = ? AND ${WHERE_ORDER_DONE_ALIAS_O}
    `).get(bindId);

    const orderCountRow = this.db
      .prepare(
        `
      SELECT COUNT(*) AS order_count
      FROM orders
      WHERE shift_id = ? AND ${WHERE_ORDER_DONE_STATUS_COL}
    `
      )
      .get(bindId);

    /** To‘lovlar jadvali bilan tafovut bo‘lsa (qator yo‘qolgan bo‘lsa), buyurtmadagi paid_amount */
    const orderPaidRow = this.db
      .prepare(
        `
      SELECT COALESCE(SUM(COALESCE(paid_amount, 0)), 0) AS s
      FROM orders
      WHERE shift_id = ? AND ${WHERE_ORDER_DONE_STATUS_COL}
    `
      )
      .get(bindId);

    const orderMerchUzs = orderAmountUzsSql(this.db, 'orders');
    const orderMerchRow = this.db
      .prepare(
        `
      SELECT COALESCE(SUM(${orderMerchUzs}), 0) AS s
      FROM orders
      WHERE shift_id = ? AND ${WHERE_ORDER_DONE_STATUS_COL}
    `
      )
      .get(bindId);

    const salesSplit = orderSalesSplitExpressions(this.db, 'o');
    const salesSplitRow = this.db
      .prepare(
        `
      SELECT ${salesSplit.uzsSum} AS sales_gross_uzs, ${salesSplit.usdSum} AS sales_gross_usd
      FROM orders o
      WHERE o.shift_id = ? AND ${WHERE_ORDER_DONE_ALIAS_O}
    `
      )
      .get(bindId);

    /** Kassadan chiqqan naqd qaytarishlar — batafsil breakdown */
    const refundsBreakdown = this._getCashRefundsBreakdown(bindId);
    const cashRefundsOut = refundsBreakdown.total;

    /** Barcha yakunlangan qaytarishlar (jami summasi, har xil usullar bilan) */
    let totalReturnsGross = 0;
    try {
      const refundAmt = 'COALESCE(sr.refund_amount, sr.total_amount, 0)';
      const refundUzs = returnRefundUzsSql(this.db, 'sr', 'o', refundAmt);
      const grossRow = this.db.prepare(`
        SELECT COALESCE(SUM(${refundUzs}), 0) AS g
        FROM sales_returns sr
        LEFT JOIN orders o ON o.id = sr.order_id
        WHERE sr.shift_id = ? AND sr.status = 'completed'
      `).get(bindId);
      totalReturnsGross = Number(grossRow?.g || 0) || 0;
    } catch (error) {
      console.log('[SHIFT] Could not calculate gross returns:', error.message);
    }

    /** Smena ichida mijozga yozilgan qarz (buyurtmadagi nasiya qismi — kassaga tushmaydi) */
    let creditDebtIssued = 0;
    try {
      const creditUzs = orderFieldUzsSql(this.db, 'o', 'credit_amount');
      const debtRow = this.db.prepare(`
        SELECT COALESCE(SUM(${creditUzs}), 0) AS s
        FROM orders o
        WHERE o.shift_id = ? AND ${WHERE_ORDER_DONE_ALIAS_O}
      `).get(bindId);
      creditDebtIssued = Number(debtRow?.s || 0) || 0;
    } catch (error) {
      console.log('[SHIFT] Could not calculate credit debt issued:', error.message);
    }

    const fromPayments = Number(paymentsData.total_payments || 0) || 0;
    const fromOrdersPaid = Number(orderPaidRow?.s || 0) || 0;
    const fromOrdersMerch = Number(orderMerchRow?.s || 0) || 0;

    /**
     * Real "kelgan pul" (mijoz to‘lagan barcha to‘lovlar) — nasiyasiz.
     * Eski Math.max() formulasi nasiya bilan tovar summasini aralashtirib
     * "Jami savdo" maydonini chalg‘ituvchi qilardi. Endi sof to‘lovlar.
     */
    const totalPaymentsReceived = fromPayments;

    /**
     * Tovar summasi (jami sotuv): naqd + karta + ... + nasiya.
     * Nasiya sotuvlarida payments=0 bo‘lishi mumkin, shuning uchun bir nechta
     * manbadan ishonchlisini olamiz (eski Math.max mantig‘i — endi alohida maydon).
     */
    const salesGross = Math.max(
      totalPaymentsReceived + creditDebtIssued,
      fromOrdersPaid + creditDebtIssued,
      fromOrdersMerch
    );

    const cashSales = Number(paymentsData.cash_payments || 0) || 0;
    const orderCount = Number(orderCountRow?.order_count || 0) || 0;
    const openingCash = shift.opening_cash || 0;
    const custRoll = this._getCustomerPaymentsShiftRollup(bindId);
    const paymentsByMethod = this._getPaymentsByMethod(bindId);
    const cashOutflow = this._getCashOutflowBreakdown(bindId);
    const cashDeposits = this._getCashDepositsTotal(bindId);
    /**
     * Kutilayotgan naqd =
     *   ochilish naqd
     *   + naqd savdo
     *   + mijoz balansiga naqd (qarz to'lash / oldindan to'lov)
     *   + qo'lda kirim (deposit)
     *   − naqd qaytarishlar
     *   − naqd xarajatlar
     *   − qo'lda chiqim (withdrawal / inkassatsiya)
     */
    const expectedCash =
      openingCash
      + cashSales
      + custRoll.customerDrawerCashNet
      + cashDeposits
      - cashRefundsOut
      - cashOutflow.total;

    // CRITICAL: Return camelCase keys (not snake_case)
    // This ensures frontend can access fields correctly
    const summary = {
      shiftId: bindId,
      openedAt: shift.opened_at || null,
      closedAt: shift.closed_at || null,
      status: shift.status || 'open',
      openingCash: openingCash ?? 0,
      /**
       * Mijozdan kelgan barcha to‘lovlar (naqd + karta + QR + ...). Nasiya YO‘Q.
       * UI da "Jami savdo (to‘lovlar)" sifatida ko‘rsatiladi.
       */
      totalSales: totalPaymentsReceived,
      totalSalesUzs: Number(paySplitRow?.total_sales_uzs || 0) || 0,
      totalSalesUsd: Number(paySplitRow?.total_sales_usd || 0) || 0,
      /**
       * Tovar summasi (jami sotilgan tovarlar narxi, nasiya bilan).
       * UI da "Tovar summasi" sifatida ko‘rsatiladi.
       */
      salesGross,
      salesGrossUzs: Number(salesSplitRow?.sales_gross_uzs || 0) || 0,
      salesGrossUsd: Number(salesSplitRow?.sales_gross_usd || 0) || 0,
      cashSales: cashSales ?? 0,
      /**
       * To‘lov usullari bo‘yicha taqsimot (karta/QR ko‘chirmasi bilan solishtirish uchun)
       */
      paymentsByMethod,
      orders: orderCount ?? 0, // Use 'orders' not 'orderCount' for consistency
      /** Kutilayotgan naqd dan ayiriladigan jami naqd qaytarish */
      totalRefunds: cashRefundsOut ?? 0,
      /** Barcha usullar bo'yicha qaytarish yig'indisi (ixtiyoriy taqqoslash) */
      totalReturnsGross: totalReturnsGross ?? 0,
      cashRefundsOut: cashRefundsOut ?? 0,
      /** Qaytarishlar batafsil: aniq naqd / usuli noma'lum / almashuv */
      refundsBreakdown,
      /** Mijozga berilgan qarz (nasiya) — naqd kassa bilan aralashmasligi uchun alohida */
      creditDebtIssued: creditDebtIssued ?? 0,
      /** Mijoz qarzini toʻlash (jami) va shundan naqd — buyurtmadan tashqari balans toʻlovlari */
      debtRepaidTotal: custRoll.debtRepaidTotal ?? 0,
      debtRepaidCash: custRoll.debtRepaidCash ?? 0,
      /** Mijoz hisobidan kassaga naqd (tarmoq: +kirim, mijozga naqd chiqarilsa −) */
      customerDrawerCashNet: custRoll.customerDrawerCashNet ?? 0,
      /** Smena ichida kassadan qilingan naqd xarajatlar (expenses + withdrawals) */
      cashExpenses: cashOutflow.cashExpenses ?? 0,
      cashWithdrawals: cashOutflow.cashWithdrawals ?? 0,
      cashOutflowTotal: cashOutflow.total ?? 0,
      /** Smena ichida kassaga qo'l bilan qilingan naqd kirim */
      cashDeposits: cashDeposits ?? 0,
      expectedCash: expectedCash ?? openingCash ?? 0
    };

    console.log('[SHIFT] getShiftSummary returning:', summary);
    console.log('[SHIFT] getShiftSummary raw data:', {
      shiftId: bindId,
      totalPaymentsReceived,
      salesGross,
      fromOrdersMerch,
      cashSales,
      paymentsByMethod,
      orderCount,
      cashRefundsOut,
      refundsBreakdown,
      totalReturnsGross,
      creditDebtIssued,
      debtRepaidTotal: custRoll.debtRepaidTotal,
      debtRepaidCash: custRoll.debtRepaidCash,
      customerDrawerCashNet: custRoll.customerDrawerCashNet,
      openingCash,
      expectedCash
    });

    return summary;
  }

  /**
   * Kassaga qo'l bilan naqd kirim/chiqim qilish (`cash_movements` jadvali).
   * @param {Object} data
   * @param {string} data.shiftId - faol smena ID (majburiy)
   * @param {'deposit'|'withdrawal'} data.type - 'deposit' (kirim) yoki 'withdrawal' (chiqim)
   * @param {number} data.amount - musbat miqdor (so'm)
   * @param {string} [data.reason] - sabab (ixtiyoriy)
   * @param {string} [data.createdBy] - foydalanuvchi ID
   */
  recordCashMovement(data) {
    const shiftId = String(data?.shiftId || data?.shift_id || '').trim();
    if (!shiftId) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'shiftId majburiy');
    }
    const type = String(data?.type || '').trim().toLowerCase();
    if (!['deposit', 'withdrawal'].includes(type)) {
      throw createError(
        ERROR_CODES.VALIDATION_ERROR,
        "type 'deposit' yoki 'withdrawal' bo'lishi kerak"
      );
    }

    const parsedAmount = parsePositiveMoneyAmount(data?.amount);
    if (!parsedAmount.ok) {
      throw createError(
        ERROR_CODES.UNPROCESSABLE_ENTITY,
        parsedAmount.error || 'amount 0 dan katta bo‘lishi kerak',
        { field: 'amount', value: data?.amount }
      );
    }
    const amount = parsedAmount.amount;

    const run = this.db.transaction(() => {
      // Smena haqiqatdan ham ochiqligini tekshiramiz — yopiq smenaga yozish noto'g'ri.
      const shift = this.db
        .prepare('SELECT id, status, closed_at, opening_cash, cashier_id, user_id FROM shifts WHERE id = ?')
        .get(shiftId);
      if (!shift) {
        throw createError(ERROR_CODES.NOT_FOUND, `Smena topilmadi: ${shiftId}`);
      }
      if (shift.status !== 'open' || shift.closed_at) {
        throw createError(
          ERROR_CODES.VALIDATION_ERROR,
          'Yopiq smenaga naqd kirim/chiqim qo‘shib bo‘lmaydi'
        );
      }

      let previousCashBalance = 0;
      try {
        const summary = this.getShiftSummary(shiftId);
        previousCashBalance = Number(summary?.expectedCash ?? summary?.expected_cash ?? 0) || 0;
      } catch {
        previousCashBalance = Number(shift.opening_cash || 0) || 0;
      }

      if (type === 'withdrawal' && amount > previousCashBalance + 1e-6) {
        throw createError(
          ERROR_CODES.INSUFFICIENT_CASH,
          `Kassada yetarli naqd yo‘q. Mavjud: ${previousCashBalance}, so‘ralgan: ${amount}`,
          {
            available: previousCashBalance,
            requested: amount,
            available_cash: previousCashBalance,
            requested_amount: amount,
          }
        );
      }

      const nextCashBalance =
        type === 'deposit' ? previousCashBalance + amount : previousCashBalance - amount;

      const id = randomUUID();
      const movementNumber = `CASH-${type === 'deposit' ? 'IN' : 'OUT'}-${Date.now()}-${id.substring(0, 6)}`;
      const now = new Date().toISOString();
      const reason = (data?.reason || data?.notes || '').toString().trim() || null;
      let createdBy = data?.createdBy || data?.created_by || null;
      if (createdBy) {
        const uid = String(createdBy).trim();
        const userRow = this.db.prepare('SELECT id FROM users WHERE id = ?').get(uid);
        createdBy = userRow ? uid : null;
      }

      this.db
        .prepare(
          `
        INSERT INTO cash_movements (
          id, movement_number, shift_id, movement_type, amount,
          reason, reference_type, reference_id, created_by, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
        )
        .run(id, movementNumber, shiftId, type, amount, reason, 'shift', shiftId, createdBy, now);

      const row = this.db.prepare('SELECT * FROM cash_movements WHERE id = ?').get(id);

      return {
        movement: row,
        previousCashBalance,
        nextCashBalance,
        createdBy,
        reason,
        type,
        amount,
        shiftId,
      };
    });

    const result = run.immediate();

    console.log('[SHIFT] cash movement recorded:', {
      id: result.movement?.id,
      movementNumber: result.movement?.movement_number,
      shiftId,
      type,
      amount,
      reason: result.reason,
      previousCashBalance: result.previousCashBalance,
      nextCashBalance: result.nextCashBalance,
    });

    this._writeAuditLog({
      user_id: result.createdBy,
      action: type === 'deposit' ? 'cash_in' : 'cash_out',
      entity_type: 'cash_movement',
      entity_id: result.movement?.id,
      old_values: {
        shift_id: shiftId,
        cash_balance: result.previousCashBalance,
      },
      new_values: {
        shift_id: shiftId,
        movement_type: type,
        amount,
        reason: result.reason,
        cash_balance: result.nextCashBalance,
        previous_cash_balance: result.previousCashBalance,
        next_cash_balance: result.nextCashBalance,
        cashier_id: result.createdBy,
        created_at: result.movement?.created_at,
      },
    });

    return {
      ...result.movement,
      previous_cash_balance: result.previousCashBalance,
      next_cash_balance: result.nextCashBalance,
    };
  }

  /** Convenience: kassaga naqd kirim. */
  cashIn(payload) {
    return this.recordCashMovement({ ...payload, type: 'deposit' });
  }

  /** Convenience: kassadan naqd chiqim. */
  cashOut(payload) {
    return this.recordCashMovement({ ...payload, type: 'withdrawal' });
  }

  /**
   * Smena bo'yicha qo'l bilan qilingan naqd harakatlarini ro'yxatlash.
   * @param {string} shiftId
   * @param {Object} [filters]
   * @param {'deposit'|'withdrawal'|'all'} [filters.type='manual']  'manual' = deposit+withdrawal
   * @param {number} [filters.limit=100]
   */
  listShiftCashMovements(shiftId, filters = {}) {
    const sid = String(shiftId || '').trim();
    if (!sid) return [];
    const typeFilter = String(filters.type || 'manual').toLowerCase();
    const limit = Number(filters.limit) > 0 ? Number(filters.limit) : 100;

    let where = 'shift_id = ?';
    const params = [sid];
    if (typeFilter === 'manual') {
      where += " AND LOWER(TRIM(COALESCE(movement_type, ''))) IN ('deposit', 'withdrawal')";
    } else if (typeFilter === 'deposit' || typeFilter === 'withdrawal') {
      where += ` AND LOWER(TRIM(COALESCE(movement_type, ''))) = '${typeFilter}'`;
    }

    try {
      return this.db
        .prepare(
          `SELECT * FROM cash_movements WHERE ${where} ORDER BY created_at DESC LIMIT ?`
        )
        .all(...params, limit);
    } catch (e) {
      console.warn('[SHIFT] listShiftCashMovements:', e.message);
      return [];
    }
  }

  /**
   * Get open shift for cashier (exact query as specified)
   * Used for shift persistence across renderer refresh
   */
  getOpenShiftForCashier(cashierId) {
    if (!cashierId) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Cashier ID is required');
    }

    const id = String(cashierId).trim();
    // getActiveShift bilan bir xil: cashier_id yoki user_id (parallel sessiyalar / ba’zi API lar faqat bittasini to‘ldiradi)
    let shift = this.db.prepare(`
      SELECT * FROM shifts
      WHERE (cashier_id = ? OR user_id = ?)
        AND status = 'open'
        AND closed_at IS NULL
      ORDER BY opened_at DESC
      LIMIT 1
    `).get(id, id);

    // users.current_shift_id — ochiq smenani topishda qo‘shimcha ishonch (UUID mos kelmasa ham)
    if (!shift) {
      try {
        const u = this.db.prepare('SELECT current_shift_id FROM users WHERE id = ?').get(id);
        const sid = u?.current_shift_id ? String(u.current_shift_id).trim() : '';
        if (sid) {
          const s = this.db.prepare(`
            SELECT * FROM shifts
            WHERE id = ? AND status = 'open' AND closed_at IS NULL
          `).get(sid);
          if (s) shift = s;
        }
      } catch {
        /* ustun yo‘q */
      }
    }

    if (!shift) {
      return null;
    }

    // Get totals if available
    const totals = this.db.prepare('SELECT * FROM shift_totals WHERE shift_id = ?').get(shift.id);

    return {
      ...shift,
      totals,
    };
  }

  /**
   * Get active shift
   * If userId is provided, returns active shift for that user
   * If userId is not provided, returns any active shift (for shift persistence)
   * Used for syncing frontend state with database
   */
  getActiveShift(userId = null) {
    let shift;

    if (userId) {
      // Query by both cashier_id and user_id to handle both cases
      // Priority: cashier_id first (since it's NOT NULL), then user_id
      shift = this.db.prepare(`
        SELECT * FROM shifts 
        WHERE (cashier_id = ? OR user_id = ?) AND status = 'open' AND closed_at IS NULL
        ORDER BY opened_at DESC
        LIMIT 1
      `).get(userId, userId);
    } else {
      // Get any active shift (no user filter)
      // Used for shift persistence when navigating between pages
      shift = this.db.prepare(`
        SELECT * FROM shifts 
        WHERE status = 'open' AND closed_at IS NULL
        ORDER BY opened_at DESC
        LIMIT 1
      `).get();
    }

    if (!shift) {
      return null;
    }

    // Get totals if available
    const totals = this.db.prepare('SELECT * FROM shift_totals WHERE shift_id = ?').get(shift.id);

    return {
      ...shift,
      totals,
    };
  }

  /**
   * Get current shift status for user/warehouse
   */
  getStatus(userId, warehouseId) {
    if (!userId || !warehouseId) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'User ID and Warehouse ID are required');
    }

    const shift = this.db.prepare(`
      SELECT * FROM shifts 
      WHERE user_id = ? AND warehouse_id = ? AND status = 'open'
      ORDER BY opened_at DESC
      LIMIT 1
    `).get(userId, warehouseId);

    // Check if shift enforcement is enabled
    const enforceShiftSetting = this.db.prepare(`
      SELECT value FROM settings WHERE key = 'enforce_shift_required'
    `).get();
    const enforceShift = enforceShiftSetting?.value === '1';

    return {
      hasOpenShift: !!shift,
      shift: shift || null,
      enforceShift,
    };
  }

  /**
   * Check if shift is required for operations
   */
  requireShift(userId, warehouseId) {
    const status = this.getStatus(userId, warehouseId);
    
    if (status.enforceShift && !status.hasOpenShift) {
      throw createError(ERROR_CODES.SHIFT_CLOSED, 'No open shift. Please open a shift before processing sales.', {
        userId,
        warehouseId,
        enforceShift: true,
      });
    }

    return status.shift;
  }

  /**
   * List shifts
   */
  list(filters = {}) {
    let query = 'SELECT * FROM shifts WHERE 1=1';
    const params = [];

    if (filters.user_id) {
      query += ' AND user_id = ?';
      params.push(filters.user_id);
    }

    if (filters.warehouse_id) {
      query += ' AND warehouse_id = ?';
      params.push(filters.warehouse_id);
    }

    if (filters.status) {
      query += ' AND status = ?';
      params.push(filters.status);
    }

    if (filters.date_from) {
      // IMPORTANT:
      // - If frontend sends YYYY-MM-DD, treat it as a LOCAL calendar date (Uzbek time, etc.)
      //   so shifts stored as UTC ISO strings still match the user's selected day.
      // - If frontend sends a timestamp/ISO string, keep the original timestamp filtering.
      if (this._isYmdDate(filters.date_from)) {
        query += " AND DATE(opened_at, 'localtime') >= DATE(?)";
        params.push(filters.date_from);
      } else {
        query += ' AND opened_at >= ?';
        params.push(filters.date_from);
      }
    }

    if (filters.date_to) {
      if (this._isYmdDate(filters.date_to)) {
        query += " AND DATE(opened_at, 'localtime') <= DATE(?)";
        params.push(filters.date_to);
      } else {
        query += ' AND opened_at <= ?';
        params.push(filters.date_to);
      }
    }

    query += ' ORDER BY opened_at DESC';

    const limRaw = filters.limit;
    const offRaw = filters.offset;
    const lim = limRaw != null && limRaw !== '' ? Number(limRaw) : NaN;
    const off = offRaw != null && offRaw !== '' ? Number(offRaw) : NaN;
    // offset=0 valid — `if (filters.offset)` noto‘g‘ri (0 falsy), LIMIT/OFFSET va `?` soni mos bo‘lishi kerak
    if (Number.isFinite(lim) && lim >= 0) {
      query += ' LIMIT ?';
      params.push(lim);
      if (Number.isFinite(off) && off > 0) {
        query += ' OFFSET ?';
        params.push(off);
      }
    }

    return this.db.prepare(query).all(...params);
  }
}

module.exports = ShiftsService;



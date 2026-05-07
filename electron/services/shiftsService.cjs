const { ERROR_CODES, createError } = require('../lib/errors.cjs');
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
   * Kassadan chiqgan naqd qaytarishlar (summasi):
   * - sales_returns: refund_amount, faqat naqd/kassa (cash/naqd yoki bo'sh/default)
   * - cash_movements: movement_type = refund (almashuvda mijozga naqd qaytim)
   */
  _getCashDrawerRefundsOut(shiftId) {
    if (!shiftId) return 0;
    const sid = String(shiftId).trim();
    if (!sid) return 0;

    let fromReturns = 0;
    try {
      const row = this.db
        .prepare(
          `
        SELECT COALESCE(SUM(COALESCE(refund_amount, total_amount, 0)), 0) AS s
        FROM sales_returns
        WHERE shift_id = ?
          AND status = 'completed'
          AND (
            refund_method IS NULL
            OR TRIM(refund_method) = ''
            OR LOWER(TRIM(refund_method)) IN ('cash', 'naqd')
          )
      `
        )
        .get(sid);
      fromReturns = Number(row?.s || 0) || 0;
    } catch (e) {
      console.warn('[SHIFT] _getCashDrawerRefundsOut sales_returns:', e.message);
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
      /* jadval yo'q */
    }

    return fromReturns + fromMovements;
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
    const { closing_cash: closingCash = 0, notes = null, closed_by: closedBy = null } = data;
    
    console.log('[SHIFT] closeShift called:', {
      shiftId,
      shiftId_type: typeof shiftId,
      shiftId_value: shiftId,
      closingCash,
      closedBy,
      notes
    });

    return this.db.transaction(() => {
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
        throw new Error('Yopish uchun ochiq smena topilmadi.');
      }

      // 2. Calculate Expected Total from PAYMENTS (not orders.total_amount)
      // This ensures we count actual payments, not just order totals
      const paymentsData = this.db.prepare(`
        SELECT 
          COALESCE(SUM(CASE
            WHEN LOWER(TRIM(COALESCE(p.payment_method, ''))) = 'refund_cash' THEN 0
            ELSE p.amount
          END), 0) as total_payments,
          COALESCE(SUM(CASE
            WHEN LOWER(TRIM(COALESCE(p.payment_method, ''))) IN ('cash', 'naqd') THEN p.amount
            ELSE 0
          END), 0) as cash_payments
        FROM payments p
        INNER JOIN orders o ON p.order_id = o.id
        WHERE o.shift_id = ? AND ${WHERE_ORDER_DONE_ALIAS_O}
      `).get(shiftId);

      // Also get order count and total for reference
      const ordersData = this.db.prepare(`
        SELECT 
          COUNT(*) as order_count,
          COALESCE(SUM(total_amount), 0) as order_total,
          COALESCE(SUM(COALESCE(paid_amount, 0)), 0) as paid_sum
        FROM orders 
        WHERE shift_id = ? AND ${WHERE_ORDER_DONE_STATUS_COL}
      `).get(shiftId);

      const systemTotal = Math.max(
        Number(paymentsData.total_payments || 0) || 0,
        Number(ordersData?.paid_sum || 0) || 0,
        Number(ordersData?.order_total || 0) || 0
      );
      const cashTotal = paymentsData.cash_payments || 0;
      const cashRefundsOut = this._getCashDrawerRefundsOut(shiftId);
      const custRoll = this._getCustomerPaymentsShiftRollup(shiftId);

      let creditDebtIssuedClose = 0;
      try {
        const debtRow = this.db.prepare(`
          SELECT COALESCE(SUM(COALESCE(o.credit_amount, 0)), 0) AS s
          FROM orders o
          WHERE o.shift_id = ? AND ${WHERE_ORDER_DONE_ALIAS_O}
        `).get(shiftId);
        creditDebtIssuedClose = Number(debtRow?.s || 0) || 0;
      } catch {
        /* ignore */
      }

      // Kutilayotgan naqd = ochilish + buyurtma naqdi + mijoz balansiga naqd (qarz / oldindan) − naqd qaytarishlar
      const expectedCash =
        (shift.opening_cash || 0) + cashTotal + custRoll.customerDrawerCashNet - cashRefundsOut;

      // Calculate difference = closing_cash - expected_cash
      const difference = closingCash - expectedCash;

      console.log('[SHIFT] Payment-based totals:', {
        shiftId,
        total_payments: systemTotal,
        cash_payments: cashTotal,
        customer_drawer_cash_net: custRoll.customerDrawerCashNet,
        debt_repaid_total: custRoll.debtRepaidTotal,
        debt_repaid_cash: custRoll.debtRepaidCash,
        cash_refunds_out: cashRefundsOut,
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

      if (hasClosedBy) {
        this.db.prepare(`
          UPDATE shifts 
          SET 
            closed_at = datetime('now'),
            status = 'closed',
            closing_cash = ?,
            expected_cash = ?,
            cash_difference = ?,
            closed_by = ?
          WHERE id = ?
        `).run(closingCash, expectedCash, difference, closedBy || shift.user_id || shift.cashier_id, shiftId);
      } else {
        this.db.prepare(`
          UPDATE shifts 
          SET 
            closed_at = datetime('now'),
            status = 'closed',
            closing_cash = ?,
            expected_cash = ?,
            cash_difference = ?
          WHERE id = ?
        `).run(closingCash, expectedCash, difference, shiftId);
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

      return { 
        success: true, 
        shiftId, 
        closingCash, 
        expectedCash, 
        cashDifference: difference,
        totalPayments: systemTotal,
        cashPayments: cashTotal,
        cashRefundsOut,
        creditDebtIssued: creditDebtIssuedClose,
        customerDrawerCashNet: custRoll.customerDrawerCashNet,
        debtRepaidTotal: custRoll.debtRepaidTotal,
        debtRepaidCash: custRoll.debtRepaidCash
      };
    })();
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
    const paymentsData = this.db.prepare(`
      SELECT 
        COALESCE(SUM(CASE
          WHEN LOWER(TRIM(COALESCE(p.payment_method, ''))) = 'refund_cash' THEN 0
          ELSE p.amount
        END), 0) as total_payments,
        COALESCE(SUM(CASE
          WHEN LOWER(TRIM(COALESCE(p.payment_method, ''))) IN ('cash', 'naqd') THEN p.amount
          ELSE 0
        END), 0) as cash_payments
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

    const orderMerchRow = this.db
      .prepare(
        `
      SELECT COALESCE(SUM(COALESCE(total_amount, 0)), 0) AS s
      FROM orders
      WHERE shift_id = ? AND ${WHERE_ORDER_DONE_STATUS_COL}
    `
      )
      .get(bindId);

    /** Kassadan chiqqan naqd qaytarishlar (kutilayotgan naqd formulasi uchun) */
    const cashRefundsOut = this._getCashDrawerRefundsOut(bindId);

    /** Barcha yakunlangan qaytarishlar summasi (ma'lumot uchun) */
    let totalReturnsGross = 0;
    try {
      const grossRow = this.db.prepare(`
        SELECT COALESCE(SUM(COALESCE(total_amount, refund_amount, 0)), 0) AS g
        FROM sales_returns
        WHERE shift_id = ? AND status = 'completed'
      `).get(bindId);
      totalReturnsGross = Number(grossRow?.g || 0) || 0;
    } catch (error) {
      console.log('[SHIFT] Could not calculate gross returns:', error.message);
    }

    /** Smena ichida mijozga yozilgan qarz (buyurtmadagi nasiya qismi — kassaga tushmaydi) */
    let creditDebtIssued = 0;
    try {
      const debtRow = this.db.prepare(`
        SELECT COALESCE(SUM(COALESCE(o.credit_amount, 0)), 0) AS s
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
    /** To‘liq nasiya sotuvlarida paid/tolovlar 0 bo‘lishi mumkin — jami savdo uchun total_amount ham hisobga olinadi */
    const totalSales = Math.max(fromPayments, fromOrdersPaid, fromOrdersMerch);
    const cashSales = Number(paymentsData.cash_payments || 0) || 0;
    const orderCount = Number(orderCountRow?.order_count || 0) || 0;
    const openingCash = shift.opening_cash || 0;
    const custRoll = this._getCustomerPaymentsShiftRollup(bindId);
    const expectedCash = openingCash + cashSales + custRoll.customerDrawerCashNet - cashRefundsOut;

    // CRITICAL: Return camelCase keys (not snake_case)
    // This ensures frontend can access fields correctly
    const summary = {
      shiftId: bindId,
      openedAt: shift.opened_at || null,
      closedAt: shift.closed_at || null,
      status: shift.status || 'open',
      openingCash: openingCash ?? 0,
      totalSales: totalSales ?? 0,
      cashSales: cashSales ?? 0,
      orders: orderCount ?? 0, // Use 'orders' not 'orderCount' for consistency
      /** Shunday qaytarishlar kutilayotgan naqd dan ayiriladi (naqd/kassa) */
      totalRefunds: cashRefundsOut ?? 0,
      /** Barcha usullar bo'yicha qaytarish yig'indisi (ixtiyoriy taqqoslash) */
      totalReturnsGross: totalReturnsGross ?? 0,
      cashRefundsOut: cashRefundsOut ?? 0,
      /** Mijozga berilgan qarz (nasiya) — naqd kassa bilan aralashmasligi uchun alohida */
      creditDebtIssued: creditDebtIssued ?? 0,
      /** Mijoz qarzini toʻlash (jami) va shundan naqd — buyurtmadan tashqari balans toʻlovlari */
      debtRepaidTotal: custRoll.debtRepaidTotal ?? 0,
      debtRepaidCash: custRoll.debtRepaidCash ?? 0,
      /** Mijoz hisobidan kassaga naqd (tarmoq: +kirim, mijozga naqd chiqarilsa −) */
      customerDrawerCashNet: custRoll.customerDrawerCashNet ?? 0,
      expectedCash: expectedCash ?? openingCash ?? 0
    };

    console.log('[SHIFT] getShiftSummary returning:', summary);
    console.log('[SHIFT] getShiftSummary raw data:', {
      shiftId: bindId,
      totalSales,
      fromOrdersMerch,
      cashSales,
      orderCount,
      cashRefundsOut,
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



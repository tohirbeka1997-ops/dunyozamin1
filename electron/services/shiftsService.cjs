const { ERROR_CODES, createError } = require('../lib/errors.cjs');
const { randomUUID } = require('crypto');

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
          COALESCE(SUM(p.amount), 0) as total_payments,
          COALESCE(SUM(CASE WHEN p.payment_method = 'cash' THEN p.amount ELSE 0 END), 0) as cash_payments
        FROM payments p
        INNER JOIN orders o ON p.order_id = o.id
        WHERE o.shift_id = ? AND o.status = 'completed'
      `).get(shiftId);

      // Also get order count and total for reference
      const ordersData = this.db.prepare(`
        SELECT 
          COUNT(*) as order_count,
          COALESCE(SUM(total_amount), 0) as order_total
        FROM orders 
        WHERE shift_id = ? AND status = 'completed'
      `).get(shiftId);

      const systemTotal = paymentsData.total_payments || 0;
      const cashTotal = paymentsData.cash_payments || 0;
      
      // Calculate expected cash = opening_cash + cash_payments
      const expectedCash = (shift.opening_cash || 0) + cashTotal;
      
      // Calculate difference = closing_cash - expected_cash
      const difference = closingCash - expectedCash;

      console.log('[SHIFT] Payment-based totals:', {
        shiftId,
        total_payments: systemTotal,
        cash_payments: cashTotal,
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
        cashPayments: cashTotal
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
    if (!shiftId) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Shift ID is required');
    }

    // Get shift basic info
    const shift = this.db.prepare(`
      SELECT opening_cash, opened_at, closed_at, status
      FROM shifts
      WHERE id = ?
    `).get(shiftId);

    if (!shift) {
      throw createError(ERROR_CODES.NOT_FOUND, `Shift ${shiftId} not found`);
    }

    // Calculate totals from PAYMENTS (same logic as closeShift)
    const paymentsData = this.db.prepare(`
      SELECT 
        COALESCE(SUM(p.amount), 0) as total_payments,
        COALESCE(SUM(CASE WHEN p.payment_method = 'cash' THEN p.amount ELSE 0 END), 0) as cash_payments,
        COUNT(DISTINCT o.id) as order_count
      FROM payments p
      INNER JOIN orders o ON p.order_id = o.id
      WHERE o.shift_id = ? AND o.status = 'completed'
    `).get(shiftId);

    // Calculate refunds (if returns table exists and has shift_id)
    let totalRefunds = 0;
    try {
      const refundsData = this.db.prepare(`
        SELECT COALESCE(SUM(total_amount), 0) as total_refunds
        FROM sales_returns
        WHERE shift_id = ? AND status = 'completed'
      `).get(shiftId);
      totalRefunds = refundsData?.total_refunds || 0;
    } catch (error) {
      // sales_returns table might not exist or might not have shift_id column
      console.log('[SHIFT] Could not calculate refunds (table may not exist):', error.message);
    }

    const totalSales = paymentsData.total_payments || 0;
    const cashSales = paymentsData.cash_payments || 0;
    const orderCount = paymentsData.order_count || 0;
    const openingCash = shift.opening_cash || 0;
    const expectedCash = openingCash + cashSales;

    // CRITICAL: Return camelCase keys (not snake_case)
    // This ensures frontend can access fields correctly
    const summary = {
      shiftId,
      openedAt: shift.opened_at || null,
      closedAt: shift.closed_at || null,
      status: shift.status || 'open',
      openingCash: openingCash ?? 0,
      totalSales: totalSales ?? 0,
      cashSales: cashSales ?? 0,
      orders: orderCount ?? 0, // Use 'orders' not 'orderCount' for consistency
      totalRefunds: totalRefunds ?? 0,
      expectedCash: expectedCash ?? openingCash ?? 0
    };

    console.log('[SHIFT] getShiftSummary returning:', summary);
    console.log('[SHIFT] getShiftSummary raw data:', {
      shiftId,
      totalSales,
      cashSales,
      orderCount,
      totalRefunds,
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

    const shift = this.db.prepare(`
      SELECT * FROM shifts
      WHERE cashier_id = ?
        AND status = 'open'
        AND closed_at IS NULL
      ORDER BY opened_at DESC
      LIMIT 1
    `).get(cashierId);

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

    if (filters.limit) {
      query += ' LIMIT ?';
      params.push(filters.limit);
      if (filters.offset) {
        query += ' OFFSET ?';
        params.push(filters.offset);
      }
    }

    return this.db.prepare(query).all(params);
  }
}

module.exports = ShiftsService;



const { ERROR_CODES, createError } = require('../lib/errors.cjs');
const { randomUUID } = require('crypto');
const { UZBEKISTAN_TZ_SQLITE_OFFSET } = require('../lib/timezone.cjs');
const {
  computePurchasePaymentStatus,
  splitPaymentAgainstRemainder,
  moneyTolerance,
  pickPrimaryPurchaseRole,
  canAcceptSupplierOverpayAsAdvance,
  canCancelSupplierPayment,
  computeFxDiffAmount,
} = require('../lib/purchaseHardening.cjs');

/**
 * Supplier Service
 * Handles supplier CRUD operations, ledger, and payments
 */
class SupplierService {
  constructor(db) {
    this.db = db;
    this._suppliersColumns = null;
    this._purchaseOrdersColumns = null;
    this._supplierPaymentsColumns = null;
    /** @type {import('./auditService.cjs')|null} */
    this.auditService = null;
  }

  _tableExists(name) {
    try {
      return !!this.db
        .prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`)
        .get(name);
    } catch {
      return false;
    }
  }

  _getUserRoleCodes(userId) {
    if (!userId) return [];
    try {
      const rows = this.db
        .prepare(
          `
        SELECT r.code
        FROM roles r
        INNER JOIN user_roles ur ON ur.role_id = r.id
        WHERE ur.user_id = ?
      `,
        )
        .all(userId);
      const codes = (rows || []).map((r) => String(r.code || '').toLowerCase()).filter(Boolean);
      if (codes.length) return codes;
    } catch {
      // fall through
    }
    try {
      const profile = this.db.prepare(`SELECT role FROM profiles WHERE id = ?`).get(userId);
      if (profile?.role) return [String(profile.role).toLowerCase()];
    } catch {
      // ignore
    }
    if (String(userId) === 'default-admin-001') return ['admin'];
    return [];
  }

  _primaryPurchaseRole(userId) {
    return pickPrimaryPurchaseRole(this._getUserRoleCodes(userId));
  }

  _audit(action, entityType, entityId, oldValues, newValues, userId) {
    try {
      this.auditService?.log?.({
        action,
        entity_type: entityType,
        entity_id: entityId,
        old_values: oldValues || null,
        new_values: newValues || null,
        user_id: userId || null,
      });
    } catch (e) {
      console.warn('[SupplierService] audit failed:', e?.message);
    }
  }

  _getCols(tableName) {
    try {
      const cols = this.db.prepare(`PRAGMA table_info(${tableName})`).all() || [];
      return new Set(cols.map((c) => c.name));
    } catch {
      return new Set();
    }
  }

  _hasSupplierCol(name) {
    if (!this._suppliersColumns) this._suppliersColumns = this._getCols('suppliers');
    return this._suppliersColumns.has(name);
  }

  _hasPurchaseOrderCol(name) {
    if (!this._purchaseOrdersColumns) this._purchaseOrdersColumns = this._getCols('purchase_orders');
    return this._purchaseOrdersColumns.has(name);
  }

  _hasSupplierPaymentCol(name) {
    if (!this._supplierPaymentsColumns) this._supplierPaymentsColumns = this._getCols('supplier_payments');
    return this._supplierPaymentsColumns.has(name);
  }

  _tzDateExpr(columnExpr) {
    return `date(datetime(replace(replace(${columnExpr}, 'T', ' '), 'Z', ''), '${UZBEKISTAN_TZ_SQLITE_OFFSET}'))`;
  }

  _isValidEmail(email) {
    const value = String(email || '').trim();
    if (!value) return true;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }

  _normalizeStatus(status, fallback = 'active') {
    const normalized = String(status || fallback).trim().toLowerCase();
    if (!['active', 'inactive'].includes(normalized)) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Supplier status must be active or inactive');
    }
    return normalized;
  }

  _computePoPaymentStatus(paidAmount, totalAmount, currency = 'UZS') {
    return computePurchasePaymentStatus(paidAmount, totalAmount, currency);
  }

  _poPaymentActiveWhere() {
    const hasCancelled = this._hasSupplierPaymentCol('cancelled_at');
    const hasAdvancePortion = this._hasSupplierPaymentCol('is_advance_portion');
    const parts = ['purchase_order_id = ?'];
    if (hasCancelled) parts.push('cancelled_at IS NULL');
    if (hasAdvancePortion) parts.push('COALESCE(is_advance_portion, 0) = 0');
    return parts.join(' AND ');
  }

  /** PO invoice currency drives cached paid fields (not supplier settlement). */
  _refreshPurchaseOrderPaymentCache(purchaseOrderId) {
    if (!purchaseOrderId) return;
    try {
      if (!this._hasPurchaseOrderCol('paid_amount') || !this._hasPurchaseOrderCol('payment_status')) return;

      const po = this.db
        .prepare(`SELECT currency, total_amount, total_usd, fx_rate FROM purchase_orders WHERE id = ?`)
        .get(purchaseOrderId);
      if (!po) return;

      const poCur =
        this._hasPurchaseOrderCol('currency') && String(po.currency || 'UZS').toUpperCase() === 'USD'
          ? 'USD'
          : 'UZS';
      const hasPaidAmountUsd = this._hasPurchaseOrderCol('paid_amount_usd');
      const hasTotalUsd = this._hasPurchaseOrderCol('total_usd');
      const hasAmountUsd = this._hasSupplierPaymentCol('amount_usd');
      const activeWhere = this._poPaymentActiveWhere();
      const hasAdvanceFlag = this._hasPurchaseOrderCol('has_supplier_advance');

      if (poCur === 'USD' && hasPaidAmountUsd && hasTotalUsd && hasAmountUsd) {
        const totalAmountUsd = Number(po.total_usd ?? 0);
        const sumRow = this.db
          .prepare(
            `
            SELECT
              COALESCE(SUM(COALESCE(amount_usd, 0)), 0) AS paid_amount_usd,
              COALESCE(SUM(amount), 0) AS paid_amount_uzs
            FROM supplier_payments
            WHERE ${activeWhere}
          `
          )
          .get(purchaseOrderId);
        let paidAmountUsd = Number(sumRow?.paid_amount_usd ?? 0);
        if (paidAmountUsd <= 0) {
          const paidUzs = Number(sumRow?.paid_amount_uzs ?? 0);
          const fx = Number(po.fx_rate ?? 0);
          if (paidUzs > 0 && fx > 0) paidAmountUsd = paidUzs / fx;
        }
        // Cap cached paid at total so UI never shows negative debt as "paid more"
        const tol = moneyTolerance('USD');
        const cachedPaid = Math.min(paidAmountUsd, totalAmountUsd + tol);
        const status = this._computePoPaymentStatus(paidAmountUsd, totalAmountUsd, 'USD');
        const sets = ['paid_amount_usd = ?', 'payment_status = ?', "updated_at = datetime('now')"];
        const vals = [cachedPaid, status];
        if (hasAdvanceFlag) {
          sets.push('has_supplier_advance = ?');
          vals.push(paidAmountUsd > totalAmountUsd + tol ? 1 : 0);
        }
        vals.push(purchaseOrderId);
        this.db
          .prepare(`UPDATE purchase_orders SET ${sets.join(', ')} WHERE id = ?`)
          .run(...vals);
        return;
      }

      const totalAmount = Number(po.total_amount ?? 0);
      const sumRow = this.db
        .prepare(
          `
          SELECT COALESCE(SUM(amount), 0) AS paid_amount
          FROM supplier_payments
          WHERE ${activeWhere}
        `
        )
        .get(purchaseOrderId);
      const paidAmount = Number(sumRow?.paid_amount ?? 0);
      const tol = moneyTolerance('UZS');
      const cachedPaid = Math.min(paidAmount, totalAmount + tol);
      const status = this._computePoPaymentStatus(paidAmount, totalAmount, 'UZS');
      const sets = ['paid_amount = ?', 'payment_status = ?', "updated_at = datetime('now')"];
      const vals = [cachedPaid, status];
      if (hasAdvanceFlag) {
        sets.push('has_supplier_advance = ?');
        vals.push(paidAmount > totalAmount + tol ? 1 : 0);
      }
      vals.push(purchaseOrderId);
      this.db
        .prepare(`UPDATE purchase_orders SET ${sets.join(', ')} WHERE id = ?`)
        .run(...vals);
    } catch {
      // cached fields are optional; PurchaseService.get also computes from supplier_payments
    }
  }

  _getPoRemainingForPayment(purchaseOrderId) {
    const po = this.db
      .prepare(
        `SELECT id, currency, total_amount, total_usd, fx_rate, supplier_id FROM purchase_orders WHERE id = ?`,
      )
      .get(purchaseOrderId);
    if (!po) {
      throw createError(ERROR_CODES.NOT_FOUND, `Purchase order ${purchaseOrderId} not found`);
    }
    const poCur =
      this._hasPurchaseOrderCol('currency') && String(po.currency || 'UZS').toUpperCase() === 'USD'
        ? 'USD'
        : 'UZS';
    const activeWhere = this._poPaymentActiveWhere();
    if (poCur === 'USD' && this._hasSupplierPaymentCol('amount_usd')) {
      const sumRow = this.db
        .prepare(
          `SELECT COALESCE(SUM(COALESCE(amount_usd, 0)), 0) AS paid FROM supplier_payments WHERE ${activeWhere}`,
        )
        .get(purchaseOrderId);
      const paid = Number(sumRow?.paid ?? 0);
      const total = Number(po.total_usd ?? 0);
      return { po, poCur, total, paid, remaining: Math.max(0, total - paid) };
    }
    const sumRow = this.db
      .prepare(`SELECT COALESCE(SUM(amount), 0) AS paid FROM supplier_payments WHERE ${activeWhere}`)
      .get(purchaseOrderId);
    const paid = Number(sumRow?.paid ?? 0);
    const total = Number(po.total_amount ?? 0);
    return { po, poCur, total, paid, remaining: Math.max(0, total - paid) };
  }

  _createAdvanceRecord({
    supplierId,
    amount,
    currency,
    fxRate,
    fxRateSource,
    basisPaymentId,
    basisPurchaseOrderId,
    notes,
    createdBy,
  }) {
    if (!this._tableExists('supplier_advances')) {
      throw createError(
        ERROR_CODES.DB_ERROR,
        'supplier_advances table missing (apply migration 130)',
      );
    }
    const id = randomUUID();
    const advanceNumber = `SADV-${Date.now()}`;
    const now = new Date().toISOString();
    this.db
      .prepare(
        `
        INSERT INTO supplier_advances (
          id, advance_number, supplier_id, currency, amount, amount_remaining,
          fx_rate, fx_rate_source, fx_rate_date, basis_payment_id, basis_purchase_order_id,
          notes, created_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      )
      .run(
        id,
        advanceNumber,
        supplierId,
        currency,
        amount,
        amount,
        fxRate ?? null,
        fxRateSource || null,
        now.slice(0, 10),
        basisPaymentId || null,
        basisPurchaseOrderId || null,
        notes || null,
        createdBy || null,
        now,
        now,
      );
    return this.db.prepare('SELECT * FROM supplier_advances WHERE id = ?').get(id);
  }

  /**
   * List suppliers with filters
   */
  list(filters = {}) {
    // Include computed balance from transactions.
    // - Default (legacy): UZS debt = SUM(po.total_amount) - SUM(sp.amount)
    // - USD suppliers (when schema supports it): USD debt = SUM(po.total_usd) - SUM(sp.amount_usd)
    const hasSettlementCurrency = this._hasSupplierCol('settlement_currency');
    const hasTotalUsd = this._hasPurchaseOrderCol('total_usd');
    const hasAmountUsd = this._hasSupplierPaymentCol('amount_usd');

    const debtExpr = hasSettlementCurrency && hasTotalUsd
      ? `CASE WHEN COALESCE(s.settlement_currency, 'UZS') = 'USD'
          THEN COALESCE((
            SELECT SUM(COALESCE(po.total_usd, 0))
            FROM purchase_orders po
            WHERE po.supplier_id = s.id
              AND po.status IN ('received', 'partially_received')
          ), 0)
          ELSE COALESCE((
            SELECT SUM(COALESCE(po.total_amount, 0))
            FROM purchase_orders po
            WHERE po.supplier_id = s.id
              AND po.status IN ('received', 'partially_received')
          ), 0)
        END`
      : `COALESCE((
          SELECT SUM(po.total_amount)
          FROM purchase_orders po
          WHERE po.supplier_id = s.id
            AND po.status IN ('received', 'partially_received')
        ), 0)`;

    const paidExpr = hasSettlementCurrency && hasAmountUsd
      ? `CASE WHEN COALESCE(s.settlement_currency, 'UZS') = 'USD'
          THEN COALESCE((
            SELECT SUM(COALESCE(sp.amount_usd, 0))
            FROM supplier_payments sp
            WHERE sp.supplier_id = s.id
          ), 0)
          ELSE COALESCE((
            SELECT SUM(COALESCE(sp.amount, 0))
            FROM supplier_payments sp
            WHERE sp.supplier_id = s.id
          ), 0)
        END`
      : `COALESCE((
          SELECT SUM(sp.amount)
          FROM supplier_payments sp
          WHERE sp.supplier_id = s.id
        ), 0)`;

    let query = `
      SELECT
        s.*,
        ${debtExpr} AS total_debt,
        ${paidExpr} AS total_paid,
        (${debtExpr} - ${paidExpr}) AS balance
      FROM suppliers s
      WHERE 1=1
    `;
    const params = [];

    if (filters.search) {
      query += ' AND (s.name LIKE ? OR s.contact_person LIKE ? OR s.phone LIKE ? OR s.email LIKE ?)';
      const searchTerm = `%${filters.search}%`;
      params.push(searchTerm, searchTerm, searchTerm, searchTerm);
    }

    if (filters.status && filters.status !== 'all') {
      query += ' AND s.status = ?';
      params.push(filters.status);
    }

    if (filters.includeInactive === false) {
      query += ' AND s.status = ?';
      params.push('active');
    }

    query += ' ORDER BY s.name ASC';

    if (filters.limit) {
      query += ' LIMIT ?';
      params.push(filters.limit);
    }

    return this.db.prepare(query).all(params);
  }

  /**
   * Get supplier by ID
   */
  get(id) {
    if (!id) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Supplier ID is required');
    }

    const hasSettlementCurrency = this._hasSupplierCol('settlement_currency');
    const hasTotalUsd = this._hasPurchaseOrderCol('total_usd');
    const hasAmountUsd = this._hasSupplierPaymentCol('amount_usd');

    const debtExpr = hasSettlementCurrency && hasTotalUsd
      ? `CASE WHEN COALESCE(s.settlement_currency, 'UZS') = 'USD'
          THEN COALESCE((
            SELECT SUM(COALESCE(po.total_usd, 0))
            FROM purchase_orders po
            WHERE po.supplier_id = s.id
              AND po.status IN ('received', 'partially_received')
          ), 0)
          ELSE COALESCE((
            SELECT SUM(COALESCE(po.total_amount, 0))
            FROM purchase_orders po
            WHERE po.supplier_id = s.id
              AND po.status IN ('received', 'partially_received')
          ), 0)
        END`
      : `COALESCE((
          SELECT SUM(po.total_amount)
          FROM purchase_orders po
          WHERE po.supplier_id = s.id
            AND po.status IN ('received', 'partially_received')
        ), 0)`;

    const paidExpr = hasSettlementCurrency && hasAmountUsd
      ? `CASE WHEN COALESCE(s.settlement_currency, 'UZS') = 'USD'
          THEN COALESCE((
            SELECT SUM(COALESCE(sp.amount_usd, 0))
            FROM supplier_payments sp
            WHERE sp.supplier_id = s.id
          ), 0)
          ELSE COALESCE((
            SELECT SUM(COALESCE(sp.amount, 0))
            FROM supplier_payments sp
            WHERE sp.supplier_id = s.id
          ), 0)
        END`
      : `COALESCE((
          SELECT SUM(sp.amount)
          FROM supplier_payments sp
          WHERE sp.supplier_id = s.id
        ), 0)`;

    const supplier = this.db.prepare(`
      SELECT
        s.*,
        ${debtExpr} AS total_debt,
        ${paidExpr} AS total_paid,
        (${debtExpr} - ${paidExpr}) AS balance
      FROM suppliers s
      WHERE s.id = ?
    `).get(id);
    
    if (!supplier) {
      throw createError(ERROR_CODES.NOT_FOUND, `Supplier with id ${id} not found`);
    }

    // Attach purchase_orders list for SupplierDetail UI
    const purchaseOrders = this.db.prepare(`
      SELECT *
      FROM purchase_orders
      WHERE supplier_id = ?
      ORDER BY order_date DESC, created_at DESC
      LIMIT 200
    `).all(id);

    return {
      ...supplier,
      purchase_orders: purchaseOrders,
    };
  }

  /**
   * Supplier purchased products summary
   * Returns aggregated quantities/cost for received/partially_received POs.
   */
  getPurchaseSummary(supplierId, filters = {}) {
    if (!supplierId) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Supplier ID is required');
    }

    // Verify supplier exists
    this.get(supplierId);

    let query = `
      SELECT
        poi.product_id,
        COALESCE(p.name, poi.product_name) AS product_name,
        COALESCE(p.sku, poi.product_sku) AS product_sku,
        COALESCE(SUM(poi.received_qty), 0) AS total_received_qty,
        COALESCE(SUM(poi.ordered_qty), 0) AS total_ordered_qty,
        COALESCE(SUM(poi.received_qty * poi.unit_cost), 0) AS total_cost,
        COUNT(DISTINCT po.id) AS po_count,
        MAX(po.order_date) AS last_order_date
      FROM purchase_order_items poi
      INNER JOIN purchase_orders po ON po.id = poi.purchase_order_id
      LEFT JOIN products p ON p.id = poi.product_id
      WHERE po.supplier_id = ?
        AND po.status IN ('received', 'partially_received')
        AND COALESCE(poi.received_qty, 0) > 0
    `;
    const params = [supplierId];

    if (filters.date_from) {
      query += ' AND po.order_date >= ?';
      params.push(filters.date_from);
    }
    if (filters.date_to) {
      query += ' AND po.order_date <= ?';
      params.push(filters.date_to);
    }

    query += `
      GROUP BY poi.product_id
      ORDER BY total_cost DESC, product_name ASC
      LIMIT 500
    `;

    return this.db.prepare(query).all(...params);
  }

  /**
   * Create supplier
   */
  create(data) {
    if (!data.name || !data.name.trim()) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Supplier name is required');
    }
    if (!this._isValidEmail(data.email)) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Invalid supplier email');
    }

    const id = data.id || randomUUID();
    // Use SQLite-friendly datetime format (consistent across services)
    const now = new Date().toISOString().replace('T', ' ').replace('Z', '').substring(0, 19);

    try {
      const hasSettlementCurrency = this._hasSupplierCol('settlement_currency');

      if (hasSettlementCurrency) {
        this.db.prepare(`
          INSERT INTO suppliers (
            id, name, contact_person, phone, email, address, note, status, settlement_currency, created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          id,
          data.name.trim(),
          data.contact_person?.trim() || null,
          data.phone?.trim() || null,
          data.email?.trim() || null,
          data.address?.trim() || null,
          data.note?.trim() || null,
          this._normalizeStatus(data.status, 'active'),
          String(data.settlement_currency || 'UZS').toUpperCase() === 'USD' ? 'USD' : 'UZS',
          now,
          now
        );
      } else {
        this.db.prepare(`
          INSERT INTO suppliers (
            id, name, contact_person, phone, email, address, note, status, created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          id,
          data.name.trim(),
          data.contact_person?.trim() || null,
          data.phone?.trim() || null,
          data.email?.trim() || null,
          data.address?.trim() || null,
          data.note?.trim() || null,
          this._normalizeStatus(data.status, 'active'),
          now,
          now
        );
      }

      return this.get(id);
    } catch (error) {
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        throw createError(ERROR_CODES.VALIDATION_ERROR, 'Supplier with this name or email already exists');
      }
      throw error;
    }
  }

  /**
   * Update supplier
   */
  update(id, data) {
    if (!id) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Supplier ID is required');
    }

    const existing = this.get(id);
    const updates = [];
    const params = [];

    if (data.name !== undefined) {
      if (!String(data.name || '').trim()) {
        throw createError(ERROR_CODES.VALIDATION_ERROR, 'Supplier name is required');
      }
      updates.push('name = ?');
      params.push(data.name.trim());
    }

    if (data.contact_person !== undefined) {
      updates.push('contact_person = ?');
      params.push(data.contact_person?.trim() || null);
    }

    if (data.phone !== undefined) {
      updates.push('phone = ?');
      params.push(data.phone?.trim() || null);
    }

    if (data.email !== undefined) {
      if (!this._isValidEmail(data.email)) {
        throw createError(ERROR_CODES.VALIDATION_ERROR, 'Invalid supplier email');
      }
      updates.push('email = ?');
      params.push(data.email?.trim() || null);
    }

    if (data.address !== undefined) {
      updates.push('address = ?');
      params.push(data.address?.trim() || null);
    }

    if (data.note !== undefined) {
      updates.push('note = ?');
      params.push(data.note?.trim() || null);
    }

    if (data.status !== undefined) {
      updates.push('status = ?');
      params.push(this._normalizeStatus(data.status, String(existing?.status || 'active')));
    }

    if (data.settlement_currency !== undefined && this._hasSupplierCol('settlement_currency')) {
      updates.push('settlement_currency = ?');
      params.push(String(data.settlement_currency || 'UZS').toUpperCase() === 'USD' ? 'USD' : 'UZS');
    }

    if (updates.length === 0) {
      return existing;
    }

    updates.push('updated_at = ?');
    params.push(new Date().toISOString());
    params.push(id);

    try {
      this.db.prepare(`
        UPDATE suppliers
        SET ${updates.join(', ')}
        WHERE id = ?
      `).run(...params);

      return this.get(id);
    } catch (error) {
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        throw createError(ERROR_CODES.VALIDATION_ERROR, 'Supplier with this name or email already exists');
      }
      throw error;
    }
  }

  /**
   * Delete supplier
   */
  delete(id) {
    if (!id) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Supplier ID is required');
    }

    const existing = this.get(id);

    // If supplier is referenced by transactional tables, we must NOT hard-delete it
    // (SQLite FK constraints + we want to preserve history). Instead we soft-delete
    // by marking inactive.
    const poCount = this.db
      .prepare('SELECT COUNT(*) as count FROM purchase_orders WHERE supplier_id = ?')
      .get(id);
    const paymentCount = this.db
      .prepare('SELECT COUNT(*) as count FROM supplier_payments WHERE supplier_id = ?')
      .get(id);

    const hasReferences =
      (poCount && Number(poCount.count) > 0) || (paymentCount && Number(paymentCount.count) > 0);

    if (hasReferences) {
      const now = new Date().toISOString().replace('T', ' ').replace('Z', '').substring(0, 19);
      this.db
        .prepare(`UPDATE suppliers SET status = 'inactive', is_active = 0, updated_at = ? WHERE id = ?`)
        .run(now, id);

      return {
        success: true,
        softDeleted: true,
        message:
          "Supplier has related purchase orders/payments; marked as inactive to preserve history.",
        supplier: { id: existing.id, name: existing.name },
      };
    }

    this.db.prepare('DELETE FROM suppliers WHERE id = ?').run(id);
    return { success: true, softDeleted: false };
  }

  /**
   * Get supplier ledger (purchase orders and payments)
   */
  getLedger(supplierId, filters = {}) {
    if (!supplierId) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Supplier ID is required');
    }

    const ledger = [];

    const supplier = this.get(supplierId);
    const settlementCurrency =
      String(supplier?.settlement_currency || 'UZS').toUpperCase() === 'USD' ? 'USD' : 'UZS';
    const hasPoTotalUsd = this._hasPurchaseOrderCol('total_usd');
    const hasPayAmountUsd = this._hasSupplierPaymentCol('amount_usd');
    const poAmountCol = settlementCurrency === 'USD' && hasPoTotalUsd ? 'total_usd' : 'total_amount';
    const payAmountCol = settlementCurrency === 'USD' && hasPayAmountUsd ? 'amount_usd' : 'amount';

    // Get purchase orders
    let poQuery = `
      SELECT 
        id, po_number, order_date, ${poAmountCol} as total_amount, status,
        created_at
      FROM purchase_orders
      WHERE supplier_id = ?
        AND (status = 'received' OR status = 'partially_received')
    `;
    const poParams = [supplierId];

    if (filters.date_from) {
      poQuery += ' AND order_date >= ?';
      poParams.push(filters.date_from);
    }

    if (filters.date_to) {
      poQuery += ' AND order_date <= ?';
      poParams.push(filters.date_to);
    }

    const purchaseOrders = this.db.prepare(poQuery).all(...poParams);

    for (const po of purchaseOrders) {
      ledger.push({
        id: `po-${po.id}`,
        date: po.order_date,
        type: 'PURCHASE',
        reference: po.po_number,
        debit: po.total_amount,
        credit: 0,
        balance: 0, // Will be calculated
        purchase_order_id: po.id,
        payment_id: null,
        created_at: po.created_at,
      });
    }

    // Get payments
    let paymentQuery = `
      SELECT 
        id, payment_number, ${payAmountCol} as amount, paid_at, purchase_order_id,
        created_at
      FROM supplier_payments
      WHERE supplier_id = ?
    `;
    const paymentParams = [supplierId];

    if (filters.date_from) {
      paymentQuery += ` AND ${this._tzDateExpr('paid_at')} >= date(?)`;
      paymentParams.push(filters.date_from);
    }

    if (filters.date_to) {
      paymentQuery += ` AND ${this._tzDateExpr('paid_at')} <= date(?)`;
      paymentParams.push(filters.date_to);
    }

    const payments = this.db.prepare(paymentQuery).all(...paymentParams);

    for (const payment of payments) {
      const amt = Number(payment.amount || 0);
      const paidAt = String(payment.paid_at || '').split('T')[0].split(' ')[0];
      ledger.push({
        id: `payment-${payment.id}`,
        date: paidAt,
        type: 'PAYMENT',
        reference: payment.payment_number,
        // Positive amount => we paid supplier (credit)
        // Negative amount => supplier paid us back (debit)
        debit: amt < 0 ? Math.abs(amt) : 0,
        credit: amt > 0 ? amt : 0,
        balance: 0, // Will be calculated
        purchase_order_id: payment.purchase_order_id,
        payment_id: payment.id,
        created_at: payment.created_at,
      });
    }

    // Sort by date (oldest first) and calculate running balance
    ledger.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    let runningBalance = 0;
    for (const entry of ledger) {
      runningBalance += entry.debit - entry.credit;
      entry.balance = runningBalance;
    }

    return ledger;
  }

  /**
   * Insert one supplier_payments row. Caller must be inside a transaction when splitting.
   */
  _insertPaymentRow({
    id,
    paymentNumber,
    supplierId,
    purchaseOrderId,
    amountUzs,
    amountUsd,
    paymentCurrency,
    paymentMethod,
    paidAt,
    note,
    createdBy,
    now,
    fxRate,
    fxRateSource,
    fxDiffAmount,
    idempotencyKey,
    advanceId,
    isAdvancePortion,
    acceptAsAdvance,
  }) {
    const cols = this.db.prepare(`PRAGMA table_info(supplier_payments)`).all().map((c) => c.name);
    const hasNotes = cols.includes('notes');
    const hasNote = cols.includes('note');
    const notesCol = hasNotes ? 'notes' : hasNote ? 'note' : null;
    const hasReferenceNumber = cols.includes('reference_number');
    const hasCurrency = cols.includes('currency');
    const hasAmountUsd = cols.includes('amount_usd');

    const insertCols = [
      'id',
      'payment_number',
      'supplier_id',
      'purchase_order_id',
      'amount',
      'payment_method',
      'paid_at',
    ];
    const values = [
      id,
      paymentNumber,
      supplierId,
      purchaseOrderId || null,
      amountUzs,
      paymentMethod || 'cash',
      paidAt || now,
    ];

    if (hasCurrency) {
      insertCols.push('currency');
      values.push(paymentCurrency);
    }
    if (hasAmountUsd && amountUsd != null) {
      insertCols.push('amount_usd');
      values.push(amountUsd);
    }
    if (hasReferenceNumber) {
      insertCols.push('reference_number');
      values.push(null);
    }
    if (notesCol) {
      insertCols.push(notesCol);
      values.push(note || null);
    }
    if (cols.includes('fx_rate') && fxRate != null) {
      insertCols.push('fx_rate');
      values.push(fxRate);
    }
    if (cols.includes('fx_rate_source') && fxRateSource) {
      insertCols.push('fx_rate_source');
      values.push(fxRateSource);
    }
    if (cols.includes('fx_diff_amount') && fxDiffAmount != null) {
      insertCols.push('fx_diff_amount');
      values.push(fxDiffAmount);
    }
    if (cols.includes('idempotency_key') && idempotencyKey) {
      insertCols.push('idempotency_key');
      values.push(idempotencyKey);
    }
    if (cols.includes('advance_id') && advanceId) {
      insertCols.push('advance_id');
      values.push(advanceId);
    }
    if (cols.includes('is_advance_portion')) {
      insertCols.push('is_advance_portion');
      values.push(isAdvancePortion ? 1 : 0);
    }
    if (cols.includes('accept_as_advance') && acceptAsAdvance) {
      insertCols.push('accept_as_advance');
      values.push(1);
    }

    insertCols.push('created_by', 'created_at');
    values.push(createdBy || null, now);

    const placeholders = insertCols.map(() => '?').join(', ');
    this.db
      .prepare(`INSERT INTO supplier_payments (${insertCols.join(', ')}) VALUES (${placeholders})`)
      .run(...values);

    return this.db.prepare('SELECT * FROM supplier_payments WHERE id = ?').get(id);
  }

  /**
   * Create supplier payment.
   * Overpay on a PO is never stored as negative remainder + PAID:
   * excess (when accept_as_advance) becomes a supplier_advances row + advance cash portion.
   */
  createPayment(data) {
    if (!data.supplier_id) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Supplier ID is required');
    }

    const idempotencyKey = String(data.idempotency_key || data.idempotencyKey || '').trim() || null;
    if (idempotencyKey && this._hasSupplierPaymentCol('idempotency_key')) {
      const existing = this.db
        .prepare(`SELECT * FROM supplier_payments WHERE idempotency_key = ? LIMIT 1`)
        .get(idempotencyKey);
      if (existing) return existing;
    }

    // NOTE:
    // Positive amount => we pay supplier (reduces balance)
    // Negative amount => supplier pays us back (increases balance)
    const supplier = this.get(data.supplier_id);
    const settlementCurrency =
      String(supplier?.settlement_currency || 'UZS').toUpperCase() === 'USD' ? 'USD' : 'UZS';
    const paymentCurrency =
      String(data.currency || settlementCurrency || 'UZS').toUpperCase() === 'USD' ? 'USD' : 'UZS';
    const inputAmount =
      paymentCurrency === 'USD' ? Number(data.amount_usd ?? data.amount) : Number(data.amount);
    const amountUsdInput = Number(data.amount_usd);
    let normalizedAmountUsd =
      Number.isFinite(amountUsdInput) && amountUsdInput !== 0
        ? amountUsdInput
        : paymentCurrency === 'USD'
          ? inputAmount
          : null;

    if (settlementCurrency === 'USD' && paymentCurrency === 'UZS') {
      const usdFromPayload = Number(data.amount_usd);
      if (Number.isFinite(usdFromPayload) && usdFromPayload > 0) {
        normalizedAmountUsd = usdFromPayload;
      } else if (!normalizedAmountUsd || Number(normalizedAmountUsd) === 0) {
        const rate = Number(data.fx_rate ?? data.exchange_rate ?? 0);
        if (rate > 0) normalizedAmountUsd = Number(inputAmount) / rate;
      }
    }

    if (settlementCurrency === 'UZS' && paymentCurrency === 'USD') {
      const uzsFromPayload = Number(data.amount);
      if (!Number.isFinite(uzsFromPayload) || uzsFromPayload <= 0) {
        const rate = Number(data.fx_rate ?? data.exchange_rate ?? 0);
        if (rate > 0 && Number.isFinite(normalizedAmountUsd) && Number(normalizedAmountUsd) > 0) {
          data.amount = Number(normalizedAmountUsd) * rate;
        }
      }
    }

    const inputAmountFinal =
      settlementCurrency === 'UZS' && paymentCurrency === 'USD'
        ? Number(data.amount ?? inputAmount)
        : inputAmount;

    if (inputAmountFinal === null || inputAmountFinal === undefined || Number(inputAmountFinal) === 0) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Payment amount must be non-zero');
    }
    if (!(Number(inputAmountFinal) > 0) && data.purchase_order_id) {
      throw createError(
        ERROR_CODES.VALIDATION_ERROR,
        'Negative amounts are not allowed for purchase order payments',
      );
    }
    if (Number(inputAmountFinal) < 0 && !data.purchase_order_id) {
      // receive-from-supplier still allowed for non-PO
    } else if (!(Number(inputAmountFinal) > 0) && !data.purchase_order_id) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Payment amount must be greater than 0');
    }

    const now = new Date().toISOString();
    const fxRate = Number(data.fx_rate ?? data.exchange_rate ?? 0) || null;
    const fxRateSource = data.fx_rate_source || (fxRate ? 'manual' : null);
    const createdBy = data.created_by || null;
    const note = (data.note ?? data.notes)?.trim?.() || null;
    const acceptAsAdvance = !!(data.accept_as_advance || data.acceptAsAdvance);

    const run = this.db.transaction(() => {
      let settleAmount = Number(inputAmountFinal);
      let advanceAmount = 0;
      let poMeta = null;

      // Convert payment into PO document currency for remainder checks
      if (data.purchase_order_id && Number(inputAmountFinal) > 0) {
        poMeta = this._getPoRemainingForPayment(data.purchase_order_id);
        const { poCur, remaining } = poMeta;

        // Amount in PO currency for split
        let payInPoCur = Number(inputAmountFinal);
        if (poCur === 'USD') {
          if (paymentCurrency === 'USD' || settlementCurrency === 'USD') {
            payInPoCur =
              normalizedAmountUsd != null && Number.isFinite(Number(normalizedAmountUsd))
                ? Number(normalizedAmountUsd)
                : Number(inputAmountFinal);
          } else if (fxRate > 0) {
            payInPoCur = Number(inputAmountFinal) / fxRate;
          }
        } else if (paymentCurrency === 'USD' && fxRate > 0) {
          payInPoCur = Number(inputAmountFinal) * fxRate;
        }

        const split = splitPaymentAgainstRemainder(payInPoCur, remaining, poCur);
        if (split.requiresAdvanceAck) {
          if (!acceptAsAdvance) {
            throw createError(
              ERROR_CODES.VALIDATION_ERROR,
              'To\'lov qoldiqdan oshadi. Ortiqcha summani yetkazib beruvchi avansi sifatida qabul qilish uchun accept_as_advance=true yuboring',
            );
          }
          const role = this._primaryPurchaseRole(createdBy);
          if (!canAcceptSupplierOverpayAsAdvance(role)) {
            throw createError(
              ERROR_CODES.FORBIDDEN || ERROR_CODES.VALIDATION_ERROR,
              'Overpay as supplier advance requires accountant/manager/admin',
            );
          }
        }
        settleAmount = split.settleAmount;
        advanceAmount = split.advanceAmount;
      }

      const linkedPoLedger =
        data.purchase_order_id && this._hasPurchaseOrderCol('currency')
          ? this.db
              .prepare(`SELECT currency, fx_rate FROM purchase_orders WHERE id = ?`)
              .get(data.purchase_order_id)
          : null;
      const poCur =
        linkedPoLedger && String(linkedPoLedger.currency || 'UZS').toUpperCase() === 'USD'
          ? 'USD'
          : null;

      // Auto FX-difference when paying a USD PO at a rate different from the PO booked rate
      let computedFxDiff = data.fx_diff_amount != null ? Number(data.fx_diff_amount) : null;
      if (
        (computedFxDiff == null || !Number.isFinite(computedFxDiff)) &&
        data.purchase_order_id &&
        linkedPoLedger &&
        settleAmount > 0
      ) {
        const poBookedFx = Number(linkedPoLedger.fx_rate || 0);
        computedFxDiff = computeFxDiffAmount({
          settleAmountInPoCurrency: settleAmount,
          poCurrency: String(linkedPoLedger.currency || 'UZS'),
          poFxRate: poBookedFx,
          paymentFxRate: fxRate,
        });
      }
      if (computedFxDiff != null && !Number.isFinite(computedFxDiff)) computedFxDiff = null;

      const settleId = randomUUID();
      const paymentNumber = `SPAY-${Date.now()}`;

      // Map settle amount into ledger storage fields
      let settleUzs = settlementCurrency === 'USD' ? 0 : settleAmount;
      let settleUsd = null;
      if (settlementCurrency === 'USD') {
        settleUsd = settleAmount;
      } else if (poCur === 'USD') {
        settleUsd = settleAmount;
        if (fxRate > 0) settleUzs = settleAmount * fxRate;
        else settleUzs = 0;
      } else {
        settleUzs = settleAmount;
      }

      // When original payment was in settlement currency and not PO-USD special case
      if (!poCur && settlementCurrency === 'UZS') {
        settleUzs = settleAmount;
      }
      if (!poCur && settlementCurrency === 'USD') {
        settleUsd = settleAmount;
        settleUzs = 0;
      }

      // If we only have advance (remaining was 0) — still record cash as advance portion
      let settleRow = null;
      if (settleAmount > moneyTolerance(poMeta?.poCur || paymentCurrency)) {
        settleRow = this._insertPaymentRow({
          id: settleId,
          paymentNumber,
          supplierId: data.supplier_id,
          purchaseOrderId: data.purchase_order_id || null,
          amountUzs: settleUzs,
          amountUsd: settleUsd,
          paymentCurrency: settlementCurrency === 'USD' ? 'USD' : paymentCurrency,
          paymentMethod: data.payment_method || 'cash',
          paidAt: data.paid_at || now,
          note,
          createdBy,
          now,
          fxRate,
          fxRateSource,
          fxDiffAmount: computedFxDiff,
          idempotencyKey,
          advanceId: null,
          isAdvancePortion: false,
          acceptAsAdvance: false,
        });
      }

      let advance = null;
      let advancePayment = null;
      if (advanceAmount > moneyTolerance(poMeta?.poCur || paymentCurrency)) {
        const advPayId = randomUUID();
        let advUzs = settlementCurrency === 'USD' ? 0 : advanceAmount;
        let advUsd = settlementCurrency === 'USD' ? advanceAmount : null;
        if (poCur === 'USD' && settlementCurrency !== 'USD') {
          advUsd = advanceAmount;
          advUzs = fxRate > 0 ? advanceAmount * fxRate : 0;
        }

        advance = this._createAdvanceRecord({
          supplierId: data.supplier_id,
          amount: advanceAmount,
          currency: poMeta?.poCur || paymentCurrency,
          fxRate,
          fxRateSource,
          basisPaymentId: settleRow?.id || advPayId,
          basisPurchaseOrderId: data.purchase_order_id || null,
          notes: note || 'Overpay accepted as supplier advance',
          createdBy,
        });

        advancePayment = this._insertPaymentRow({
          id: advPayId,
          paymentNumber: `SPAY-ADV-${Date.now()}`,
          supplierId: data.supplier_id,
          purchaseOrderId: data.purchase_order_id || null,
          amountUzs: advUzs,
          amountUsd: advUsd,
          paymentCurrency: settlementCurrency === 'USD' ? 'USD' : paymentCurrency,
          paymentMethod: data.payment_method || 'cash',
          paidAt: data.paid_at || now,
          note: note ? `${note} [advance]` : 'Supplier advance (overpay)',
          createdBy,
          now,
          fxRate,
          fxRateSource,
          fxDiffAmount: null,
          idempotencyKey: idempotencyKey ? `${idempotencyKey}:advance` : null,
          advanceId: advance.id,
          isAdvancePortion: true,
          acceptAsAdvance: true,
        });

        if (this._hasPurchaseOrderCol('has_supplier_advance') && data.purchase_order_id) {
          this.db
            .prepare(
              `UPDATE purchase_orders SET has_supplier_advance = 1, updated_at = datetime('now') WHERE id = ?`,
            )
            .run(data.purchase_order_id);
        }
      }

      if (data.purchase_order_id) {
        this._refreshPurchaseOrderPaymentCache(data.purchase_order_id);
      }

      const primary = settleRow || advancePayment;
      this._audit(
        'create',
        'supplier_payment',
        primary?.id,
        null,
        {
          payment: primary,
          advance,
          settle_amount: settleAmount,
          advance_amount: advanceAmount,
          accept_as_advance: acceptAsAdvance,
          fx_diff_amount: computedFxDiff,
        },
        createdBy,
      );

      if (computedFxDiff != null && Math.abs(Number(computedFxDiff)) >= 0.5) {
        this._audit(
          'fx_diff',
          'supplier_payment_fx',
          primary?.id || settleId,
          {
            po_fx_rate: linkedPoLedger ? Number(linkedPoLedger.fx_rate || 0) : null,
            payment_fx_rate: fxRate,
            settle_amount: settleAmount,
            po_currency: linkedPoLedger ? String(linkedPoLedger.currency || 'UZS') : null,
          },
          {
            fx_diff_amount_uzs: computedFxDiff,
            purchase_order_id: data.purchase_order_id || null,
            direction: Number(computedFxDiff) > 0 ? 'fx_loss' : 'fx_gain',
          },
          createdBy,
        );
      }

      return {
        ...(primary || {}),
        advance,
        settle_amount: settleAmount,
        advance_amount: advanceAmount,
        fx_diff_amount: computedFxDiff,
        payment_status_hint: advanceAmount > 0 ? 'PAID_WITH_ADVANCE' : undefined,
      };
    });

    try {
      return run.immediate ? run.immediate() : run();
    } catch (error) {
      if (error?.code === ERROR_CODES.VALIDATION_ERROR || error?.code === 'CONFLICT' || error?.code === 'FORBIDDEN') {
        throw error;
      }
      // better-sqlite3 unique constraint on idempotency
      if (String(error?.message || '').includes('UNIQUE') && idempotencyKey) {
        const existing = this.db
          .prepare(`SELECT * FROM supplier_payments WHERE idempotency_key = ? LIMIT 1`)
          .get(idempotencyKey);
        if (existing) return existing;
      }
      if (error?.code && ERROR_CODES[error.code]) throw error;
      if (error?.statusCode) throw error;
      throw createError(ERROR_CODES.DB_ERROR, `Failed to create payment: ${error.message}`);
    }
  }

  /**
   * Apply an existing supplier advance to a purchase order (explicit select + confirm).
   */
  applyAdvanceToPurchaseOrder({
    advance_id,
    purchase_order_id,
    amount,
    created_by,
    notes,
    confirm,
  }) {
    if (!confirm) {
      throw createError(
        ERROR_CODES.VALIDATION_ERROR,
        'Applying supplier advance requires explicit confirm=true',
      );
    }
    if (!advance_id || !purchase_order_id) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'advance_id and purchase_order_id are required');
    }
    if (!this._tableExists('supplier_advances')) {
      throw createError(ERROR_CODES.DB_ERROR, 'supplier_advances table missing');
    }

    const run = this.db.transaction(() => {
      const advance = this.db.prepare('SELECT * FROM supplier_advances WHERE id = ?').get(advance_id);
      if (!advance) throw createError(ERROR_CODES.NOT_FOUND, 'Supplier advance not found');
      const remainingAdv = Number(advance.amount_remaining || 0);
      const applyAmt = amount != null ? Number(amount) : remainingAdv;
      if (!(applyAmt > 0)) {
        throw createError(ERROR_CODES.VALIDATION_ERROR, 'Apply amount must be > 0');
      }
      if (applyAmt > remainingAdv + moneyTolerance(advance.currency)) {
        throw createError(
          ERROR_CODES.VALIDATION_ERROR,
          `Apply amount exceeds advance remaining (${remainingAdv})`,
        );
      }

      const poMeta = this._getPoRemainingForPayment(purchase_order_id);
      if (poMeta.po.supplier_id && poMeta.po.supplier_id !== advance.supplier_id) {
        throw createError(ERROR_CODES.VALIDATION_ERROR, 'Advance supplier does not match PO supplier');
      }
      if (applyAmt > poMeta.remaining + moneyTolerance(poMeta.poCur)) {
        throw createError(
          ERROR_CODES.VALIDATION_ERROR,
          `Apply amount exceeds PO remaining (${poMeta.remaining})`,
        );
      }

      const now = new Date().toISOString();
      const payId = randomUUID();
      const isUsd = poMeta.poCur === 'USD';
      const payment = this._insertPaymentRow({
        id: payId,
        paymentNumber: `SPAY-APP-${Date.now()}`,
        supplierId: advance.supplier_id,
        purchaseOrderId: purchase_order_id,
        amountUzs: isUsd ? 0 : applyAmt,
        amountUsd: isUsd ? applyAmt : null,
        paymentCurrency: isUsd ? 'USD' : 'UZS',
        paymentMethod: 'advance',
        paidAt: now,
        note: notes || `Applied advance ${advance.advance_number}`,
        createdBy: created_by || null,
        now,
        fxRate: advance.fx_rate,
        fxRateSource: advance.fx_rate_source,
        fxDiffAmount: null,
        idempotencyKey: null,
        advanceId: advance.id,
        isAdvancePortion: false,
        acceptAsAdvance: false,
      });

      this.db
        .prepare(
          `
          UPDATE supplier_advances
          SET amount_remaining = amount_remaining - ?, updated_at = ?
          WHERE id = ?
        `,
        )
        .run(applyAmt, now, advance_id);

      if (this._tableExists('supplier_advance_applications')) {
        this.db
          .prepare(
            `
            INSERT INTO supplier_advance_applications (
              id, advance_id, purchase_order_id, supplier_payment_id, amount, currency, notes, created_by, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
          )
          .run(
            randomUUID(),
            advance_id,
            purchase_order_id,
            payId,
            applyAmt,
            poMeta.poCur,
            notes || null,
            created_by || null,
            now,
          );
      }

      this._refreshPurchaseOrderPaymentCache(purchase_order_id);
      this._audit(
        'apply_advance',
        'supplier_advance',
        advance_id,
        { amount_remaining: remainingAdv },
        { applied: applyAmt, purchase_order_id, payment_id: payId },
        created_by,
      );

      return {
        payment,
        advance: this.db.prepare('SELECT * FROM supplier_advances WHERE id = ?').get(advance_id),
      };
    });

    return run.immediate ? run.immediate() : run();
  }

  listAdvances(supplierId, { includeZero = false } = {}) {
    if (!supplierId) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Supplier ID is required');
    }
    if (!this._tableExists('supplier_advances')) return [];
    let q = `SELECT * FROM supplier_advances WHERE supplier_id = ?`;
    if (!includeZero) q += ` AND amount_remaining > 0`;
    q += ` ORDER BY created_at DESC`;
    return this.db.prepare(q).all(supplierId);
  }

  /**
   * Cancel supplier payment (privileged). Soft-cancel when cancelled_at exists.
   */
  cancelPayment(paymentId, { reason, cancelled_by } = {}) {
    if (!paymentId) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Payment ID is required');
    }
    const reasonText = String(reason || '').trim();
    if (!reasonText) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Cancel reason is required');
    }
    const role = this._primaryPurchaseRole(cancelled_by);
    if (!canCancelSupplierPayment(role)) {
      throw createError(
        ERROR_CODES.FORBIDDEN || ERROR_CODES.VALIDATION_ERROR,
        'Cancel payment requires accountant/manager/admin',
      );
    }

    const payment = this.db.prepare('SELECT * FROM supplier_payments WHERE id = ?').get(paymentId);
    if (!payment) throw createError(ERROR_CODES.NOT_FOUND, 'Payment not found');
    if (payment.cancelled_at) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Payment already cancelled');
    }

    const now = new Date().toISOString();
    const run = this.db.transaction(() => {
      if (this._hasSupplierPaymentCol('cancelled_at')) {
        this.db
          .prepare(
            `
            UPDATE supplier_payments
            SET cancelled_at = ?, cancel_reason = ?, cancelled_by = ?
            WHERE id = ?
          `,
          )
          .run(now, reasonText, cancelled_by || null, paymentId);
      } else {
        this.db.prepare('DELETE FROM supplier_payments WHERE id = ?').run(paymentId);
      }

      if (payment.advance_id && this._tableExists('supplier_advances') && payment.is_advance_portion) {
        const amt =
          String(payment.currency || 'UZS').toUpperCase() === 'USD'
            ? Number(payment.amount_usd || 0)
            : Number(payment.amount || 0);
        if (amt > 0) {
          this.db
            .prepare(
              `
              UPDATE supplier_advances
              SET amount_remaining = MIN(amount, amount_remaining + ?), updated_at = ?
              WHERE id = ?
            `,
            )
            .run(amt, now, payment.advance_id);
        }
      }

      if (payment.purchase_order_id) {
        this._refreshPurchaseOrderPaymentCache(payment.purchase_order_id);
      }

      this._audit(
        'cancel',
        'supplier_payment',
        paymentId,
        payment,
        { cancelled_at: now, cancel_reason: reasonText },
        cancelled_by,
      );
      return { success: true, cancelled_at: now };
    });

    return run.immediate ? run.immediate() : run();
  }

  /**
   * Delete supplier payment by ID (legacy). Prefer cancelPayment.
   */
  deletePayment(paymentId, opts = {}) {
    if (opts && (opts.reason || opts.cancelled_by || opts.requireCancel)) {
      return this.cancelPayment(paymentId, opts);
    }
    // Soft path when cancel columns exist — still require reason via cancelPayment for privilege
    if (this._hasSupplierPaymentCol('cancelled_at')) {
      throw createError(
        ERROR_CODES.VALIDATION_ERROR,
        'Use cancelPayment with reason (privileged). Hard delete disabled after migration 130.',
      );
    }

    if (!paymentId) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Payment ID is required');
    }

    const payment = this.db.prepare('SELECT * FROM supplier_payments WHERE id = ?').get(paymentId);
    if (!payment) {
      throw createError(ERROR_CODES.NOT_FOUND, 'Payment not found');
    }

    const poId = payment.purchase_order_id;

    this.db.prepare('DELETE FROM supplier_payments WHERE id = ?').run(paymentId);

    if (poId) {
      this._refreshPurchaseOrderPaymentCache(poId);
    }

    return { success: true };
  }

  /**
   * Get supplier payments
   */
  getPayments(supplierId) {
    if (!supplierId) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Supplier ID is required');
    }

    return this.db.prepare(`
      SELECT 
        sp.*,
        po.po_number as purchase_order_number
      FROM supplier_payments sp
      LEFT JOIN purchase_orders po ON sp.purchase_order_id = po.id
      WHERE sp.supplier_id = ?
      ORDER BY sp.paid_at DESC, sp.created_at DESC
    `).all(supplierId);
  }
}

module.exports = SupplierService;

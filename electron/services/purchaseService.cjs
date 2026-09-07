const { ERROR_CODES, createError } = require('../lib/errors.cjs');
const { randomUUID } = require('crypto');
const {
  computePurchasePaymentStatus,
  computePurchaseRemainder,
  validateConfirmReceiveInput,
  computeReceivableQty,
  assertReceivableAllows,
  canApproveZeroCostReceive,
  canCreateCostCorrection,
  canApproveCostCorrection,
  pickPrimaryPurchaseRole,
  moneyTolerance,
  canExportPurchaseOrders,
} = require('../lib/purchaseHardening.cjs');

/**
 * Purchase Service
 * Handles purchase orders, receiving goods, and inventory updates
 */
class PurchaseService {
  constructor(db, inventoryService, batchService = null, cacheService = null) {
    this.db = db;
    this.inventoryService = inventoryService;
    this.batchService = batchService;
    this.cacheService = cacheService;
    this.productsService = null;
    /** @type {import('./auditService.cjs')|null} */
    this.auditService = null;
    this._poCols = null;
    this._poiCols = null;
    this._spCols = null;
  }

  /** Late-bound — sync product_prices after PO pushes sale_price to catalog. */
  bindProductsService(productsService) {
    this.productsService = productsService;
  }

  _afterProductCatalogPriceChange(productId) {
    if (!productId) return;
    try {
      this.productsService?._afterCatalogPriceChange?.(productId);
    } catch (e) {
      console.warn('[PurchaseService] catalog price sync after PO:', e?.message);
    }
  }

  _cols(tableName) {
    try {
      const cols = this.db.prepare(`PRAGMA table_info(${tableName})`).all() || [];
      return new Set(cols.map((c) => c.name));
    } catch {
      return new Set();
    }
  }

  _hasPOCol(name) {
    if (!this._poCols) this._poCols = this._cols('purchase_orders');
    return this._poCols.has(name);
  }

  _hasPOItemCol(name) {
    if (!this._poiCols) this._poiCols = this._cols('purchase_order_items');
    return this._poiCols.has(name);
  }

  _hasSupplierPaymentCol(name) {
    if (!this._spCols) this._spCols = this._cols('supplier_payments');
    return this._spCols.has(name);
  }

  _hasScheduleTable() {
    if (this._scheduleTableReady != null) return this._scheduleTableReady;
    try {
      this._scheduleTableReady = !!this.db
        .prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='po_payment_schedule'`)
        .get();
    } catch {
      this._scheduleTableReady = false;
    }
    return this._scheduleTableReady;
  }

  _normalizeScheme(value) {
    const s = String(value || 'full').toLowerCase();
    if (s === 'partial' || s === 'installment') return s;
    return 'full';
  }

  _normalizeDueDate(value) {
    if (value == null || value === '') return null;
    const s = String(value).trim().slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
  }

  _poSettlementTotal(poCurrency, totalAmount, totalUsd) {
    const cur = String(poCurrency || 'UZS').toUpperCase() === 'USD' ? 'USD' : 'UZS';
    return cur === 'USD' ? Number(totalUsd || 0) : Number(totalAmount || 0);
  }

  _schemeTolerance(poCurrency) {
    return String(poCurrency || 'UZS').toUpperCase() === 'USD' ? 0.02 : 1;
  }

  _validatePaymentSchemeInput({
    scheme,
    poCurrency,
    totalAmount,
    totalUsd,
    paymentDueDate,
    paymentSchedule,
    initialPaymentAmount,
  }) {
    if (!this._hasPOCol('payment_scheme')) return;
    const normalizedScheme = this._normalizeScheme(scheme);
    const total = this._poSettlementTotal(poCurrency, totalAmount, totalUsd);
    const tol = this._schemeTolerance(poCurrency);
    const paidNow = Math.max(0, Number(initialPaymentAmount || 0) || 0);

    if (normalizedScheme === 'partial') {
      const debt = total - paidNow;
      if (debt > tol && !this._normalizeDueDate(paymentDueDate)) {
        throw createError(ERROR_CODES.VALIDATION_ERROR, 'Qisman to\'lov uchun muddat sanasini kiriting');
      }
      if (paidNow > total + tol) {
        throw createError(ERROR_CODES.VALIDATION_ERROR, 'To\'lov summasi jami summadan oshmasligi kerak');
      }
      return;
    }

    if (normalizedScheme === 'installment') {
      const rows = Array.isArray(paymentSchedule) ? paymentSchedule : [];
      if (!rows.length) {
        throw createError(ERROR_CODES.VALIDATION_ERROR, 'Bo\'lib to\'lash jadvali kamida 1 qator bo\'lishi kerak');
      }
      let sum = 0;
      for (let i = 0; i < rows.length; i += 1) {
        const row = rows[i] || {};
        const due = this._normalizeDueDate(row.due_date);
        if (!due) {
          throw createError(ERROR_CODES.VALIDATION_ERROR, `Bo'lib to'lash #${i + 1}: muddat sanasi kerak`);
        }
        const amt =
          String(poCurrency || 'UZS').toUpperCase() === 'USD'
            ? Number(row.amount_usd ?? row.amount ?? 0)
            : Number(row.amount ?? 0);
        if (!Number.isFinite(amt) || amt <= 0) {
          throw createError(ERROR_CODES.VALIDATION_ERROR, `Bo'lib to'lash #${i + 1}: summa > 0 bo'lishi kerak`);
        }
        sum += amt;
      }
      if (Math.abs(sum - total) > tol) {
        throw createError(
          ERROR_CODES.VALIDATION_ERROR,
          `Bo'lib to'lash jami ${total} bo'lishi kerak (hozir ${sum})`
        );
      }
    }
  }

  _savePaymentScheme(purchaseOrderId, { scheme, payment_due_date, payment_schedule }) {
    if (!this._hasPOCol('payment_scheme')) return;
    const normalizedScheme = this._normalizeScheme(scheme);
    const dueDate =
      normalizedScheme === 'partial' ? this._normalizeDueDate(payment_due_date) : null;

    this.db
      .prepare(
        `UPDATE purchase_orders SET payment_scheme = ?, payment_due_date = ?, updated_at = datetime('now') WHERE id = ?`
      )
      .run(normalizedScheme, dueDate, purchaseOrderId);

    if (!this._hasScheduleTable()) return;

    this.db.prepare(`DELETE FROM po_payment_schedule WHERE purchase_order_id = ?`).run(purchaseOrderId);

    if (normalizedScheme !== 'installment') return;

    const rows = Array.isArray(payment_schedule) ? payment_schedule : [];
    const insert = this.db.prepare(
      `INSERT INTO po_payment_schedule (id, purchase_order_id, seq, due_date, amount, amount_usd, status)
       VALUES (?, ?, ?, ?, ?, ?, 'pending')`
    );
    rows.forEach((row, idx) => {
      const seq = Number(row.seq ?? idx + 1) || idx + 1;
      const due = this._normalizeDueDate(row.due_date);
      const amountUzs = Number(row.amount ?? 0) || 0;
      const amountUsd = row.amount_usd != null ? Number(row.amount_usd) : null;
      insert.run(randomUUID(), purchaseOrderId, seq, due, amountUzs, amountUsd);
    });
  }

  _loadPaymentSchedule(purchaseOrderId) {
    if (!this._hasScheduleTable()) return [];
    return (
      this.db
        .prepare(
          `
        SELECT id, purchase_order_id, seq, due_date, amount, amount_usd, status, paid_at
        FROM po_payment_schedule
        WHERE purchase_order_id = ?
        ORDER BY seq ASC
      `
        )
        .all(purchaseOrderId) || []
    );
  }

  _computePaymentStatus(paidAmount, totalAmount, currency = 'UZS') {
    return computePurchasePaymentStatus(paidAmount, totalAmount, currency);
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
      console.warn('[PurchaseService] audit failed:', e?.message);
    }
  }

  _supplierPaymentActiveSql(alias = 'sp') {
    const parts = [];
    if (this._hasSupplierPaymentCol('cancelled_at')) {
      parts.push(`${alias}.cancelled_at IS NULL`);
    }
    if (this._hasSupplierPaymentCol('is_advance_portion')) {
      parts.push(`COALESCE(${alias}.is_advance_portion, 0) = 0`);
    }
    return parts.length ? ` AND ${parts.join(' AND ')}` : '';
  }

  /**
   * Insert supplier payment linked to PO and refresh cached paid_amount fields.
   * Must run inside an open SQLite transaction (createOrder / updateOrder).
   */
  _insertSupplierPaymentForPo({
    purchaseOrderId,
    supplierId,
    payment,
    poCurrency,
    totalAmountUzs,
    totalAmountUsd,
  }) {
    if (!payment || !supplierId || !purchaseOrderId) return null;

    const amountUzs = Number(payment.amount ?? 0) || 0;
    const amountUsdRaw = payment.amount_usd;
    const amountUsd =
      amountUsdRaw != null && Number.isFinite(Number(amountUsdRaw)) ? Number(amountUsdRaw) : null;
    const ledgerCurrency = String(payment.currency || 'UZS').toUpperCase() === 'USD' ? 'USD' : 'UZS';

    if (ledgerCurrency === 'USD') {
      if (!amountUsd || amountUsd <= 0) {
        throw createError(ERROR_CODES.VALIDATION_ERROR, 'USD payment amount must be > 0');
      }
    } else if (amountUzs <= 0) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Payment amount must be > 0');
    }

    const id = randomUUID();
    const paymentNumber = `SPAY-${Date.now()}`;
    const now = new Date().toISOString();
    const paidAt = payment.paid_at || now;

    const hasNotes = this._hasSupplierPaymentCol('notes');
    const hasNote = this._hasSupplierPaymentCol('note');
    const notesCol = hasNotes ? 'notes' : hasNote ? 'note' : null;
    const hasReferenceNumber = this._hasSupplierPaymentCol('reference_number');
    const hasCurrency = this._hasSupplierPaymentCol('currency');
    const hasAmountUsd = this._hasSupplierPaymentCol('amount_usd');

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
      purchaseOrderId,
      ledgerCurrency === 'USD' ? 0 : amountUzs,
      payment.payment_method || 'cash',
      paidAt,
    ];

    if (hasCurrency) {
      insertCols.push('currency');
      values.push(ledgerCurrency);
    }
    if (hasAmountUsd && ledgerCurrency === 'USD') {
      insertCols.push('amount_usd');
      values.push(amountUsd);
    }
    if (hasReferenceNumber) {
      insertCols.push('reference_number');
      values.push(payment.reference_number || null);
    }
    if (notesCol) {
      insertCols.push(notesCol);
      values.push((payment.note ?? payment.notes)?.trim?.() || null);
    }
    insertCols.push('created_by', 'created_at');
    values.push(payment.created_by || null, now);

    const placeholders = insertCols.map(() => '?').join(', ');
    this.db
      .prepare(`INSERT INTO supplier_payments (${insertCols.join(', ')}) VALUES (${placeholders})`)
      .run(...values);

    const poCur = String(poCurrency || 'UZS').toUpperCase() === 'USD' ? 'USD' : 'UZS';
    if (this._hasPOCol('paid_amount') && this._hasPOCol('payment_status')) {
      if (poCur === 'USD' && this._hasPOCol('paid_amount_usd') && this._hasPOCol('total_usd')) {
        const sumRow = this.db
          .prepare(
            `SELECT COALESCE(SUM(amount_usd), 0) AS paid_amount_usd FROM supplier_payments WHERE purchase_order_id = ?`
          )
          .get(purchaseOrderId);
        const paidAmountUsd = Number(sumRow?.paid_amount_usd ?? 0);
        const totalUsd = Number(totalAmountUsd ?? 0);
        const status = this._computePaymentStatus(paidAmountUsd, totalUsd);
        this.db
          .prepare(
            `UPDATE purchase_orders SET paid_amount_usd = ?, payment_status = ?, updated_at = datetime('now') WHERE id = ?`
          )
          .run(paidAmountUsd, status, purchaseOrderId);
      } else {
        const sumRow = this.db
          .prepare(
            `SELECT COALESCE(SUM(amount), 0) AS paid_amount FROM supplier_payments WHERE purchase_order_id = ?`
          )
          .get(purchaseOrderId);
        const paidAmount = Number(sumRow?.paid_amount ?? 0);
        const total = Number(totalAmountUzs ?? 0);
        const status = this._computePaymentStatus(paidAmount, total);
        this.db
          .prepare(
            `UPDATE purchase_orders SET paid_amount = ?, payment_status = ?, updated_at = datetime('now') WHERE id = ?`
          )
          .run(paidAmount, status, purchaseOrderId);
      }
    }

    return this.db.prepare('SELECT * FROM supplier_payments WHERE id = ?').get(id);
  }

  _hasAnyReceivedQty(purchaseOrderId) {
    const row = this.db
      .prepare(
        `
        SELECT COALESCE(SUM(received_qty), 0) AS received_total
        FROM purchase_order_items
        WHERE purchase_order_id = ?
      `
      )
      .get(purchaseOrderId);
    return Number(row?.received_total || 0) > 0;
  }

  _syncReceivedProductsPurchasePriceFromLandedCost(purchaseOrderId, now) {
    const hasExpenseTable = this.db
      .prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='purchase_order_expenses'`)
      .get();
    if (!hasExpenseTable) return;

    const items = this.db
      .prepare(
        `
        SELECT id, product_id, ordered_qty, received_qty, unit_cost, line_total
        FROM purchase_order_items
        WHERE purchase_order_id = ?
        ORDER BY id DESC
      `
      )
      .all(purchaseOrderId);
    if (!items.length) return;

    const expenses = this.db
      .prepare(
        `
        SELECT amount, allocation_method
        FROM purchase_order_expenses
        WHERE purchase_order_id = ?
      `
      )
      .all(purchaseOrderId);
    if (!expenses.length) return;

    const baseValueTotal = items.reduce(
      (sum, it) =>
        sum + (Number(it.line_total || 0) || Number(it.ordered_qty || 0) * Number(it.unit_cost || 0)),
      0
    );
    const baseQtyTotal = items.reduce((sum, it) => sum + (Number(it.ordered_qty || 0) || 0), 0);
    const picked = new Map();
    for (const it of items) {
      if (!it.product_id || picked.has(it.product_id)) continue;
      picked.set(it.product_id, it);
    }

    for (const [, it] of picked) {
      if (Number(it.received_qty || 0) <= 0) continue;
      const orderedQty = Number(it.ordered_qty || 0) || 0;
      const baseLineValue =
        Number(it.line_total || 0) || orderedQty * (Number(it.unit_cost || 0) || 0);
      let allocated = 0;
      for (const exp of expenses) {
        const amt = Number(exp.amount || 0) || 0;
        if (amt <= 0) continue;
        if (exp.allocation_method === 'by_qty') {
          allocated += baseQtyTotal > 0 ? (orderedQty / baseQtyTotal) * amt : 0;
        } else {
          allocated += baseValueTotal > 0 ? (baseLineValue / baseValueTotal) * amt : 0;
        }
      }
      const landedUnit = (Number(it.unit_cost || 0) || 0) + (orderedQty > 0 ? allocated / orderedQty : 0);
      if (!Number.isFinite(landedUnit) || landedUnit <= 0) continue;
      this.db.prepare(`UPDATE products SET purchase_price = ?, updated_at = ? WHERE id = ?`).run(landedUnit, now, it.product_id);
      if (this.cacheService?.invalidateProduct) this.cacheService.invalidateProduct(it.product_id);
      if (this.cacheService?.invalidatePricesForProduct) this.cacheService.invalidatePricesForProduct(it.product_id);
    }
  }

  _buildLandedCostByPoiId(purchaseOrderId) {
    const hasExpenseTable = this.db
      .prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='purchase_order_expenses'`)
      .get();
    if (!hasExpenseTable) return new Map();

    const items = this.db
      .prepare(
        `
        SELECT id, ordered_qty, unit_cost, line_total
        FROM purchase_order_items
        WHERE purchase_order_id = ?
      `
      )
      .all(purchaseOrderId);
    if (!items.length) return new Map();

    const expenses = this.db
      .prepare(
        `
        SELECT amount, allocation_method
        FROM purchase_order_expenses
        WHERE purchase_order_id = ?
      `
      )
      .all(purchaseOrderId);
    if (!expenses.length) return new Map();

    const baseValueTotal = items.reduce(
      (sum, it) =>
        sum + (Number(it.line_total || 0) || Number(it.ordered_qty || 0) * Number(it.unit_cost || 0)),
      0
    );
    const baseQtyTotal = items.reduce((sum, it) => sum + (Number(it.ordered_qty || 0) || 0), 0);
    const byId = new Map();

    for (const it of items) {
      const orderedQty = Number(it.ordered_qty || 0) || 0;
      const baseLineValue =
        Number(it.line_total || 0) || orderedQty * (Number(it.unit_cost || 0) || 0);
      let allocated = 0;
      for (const exp of expenses) {
        const amt = Number(exp.amount || 0) || 0;
        if (amt <= 0) continue;
        if (exp.allocation_method === 'by_qty') {
          allocated += baseQtyTotal > 0 ? (orderedQty / baseQtyTotal) * amt : 0;
        } else {
          allocated += baseValueTotal > 0 ? (baseLineValue / baseValueTotal) * amt : 0;
        }
      }
      const landedUnit = (Number(it.unit_cost || 0) || 0) + (orderedQty > 0 ? allocated / orderedQty : 0);
      byId.set(it.id, landedUnit);
    }

    return byId;
  }

  /**
   * List purchase orders with filters
   * filters.include_items: if true, includes items[] for each PO
   */
  list(filters = {}) {
    const hasCurrency = this._hasPOCol('currency');
    const hasTotalUsd = this._hasPOCol('total_usd');
    const hasAmountUsd = this._hasSupplierPaymentCol('amount_usd');

    let query = `
      SELECT 
        po.*,
        s.name as supplier_name,
        COALESCE(pays.paid_amount, 0) AS computed_paid_amount
        ${hasAmountUsd ? ', COALESCE(pays.paid_amount_usd, 0) AS computed_paid_amount_usd' : ''}
      FROM purchase_orders po
      LEFT JOIN suppliers s ON po.supplier_id = s.id
      LEFT JOIN (
        SELECT purchase_order_id,
          SUM(amount) AS paid_amount
          ${hasAmountUsd ? ', SUM(COALESCE(amount_usd, 0)) AS paid_amount_usd' : ''}
        FROM supplier_payments
        WHERE purchase_order_id IS NOT NULL
          ${this._hasSupplierPaymentCol('cancelled_at') ? 'AND cancelled_at IS NULL' : ''}
          ${this._hasSupplierPaymentCol('is_advance_portion') ? 'AND COALESCE(is_advance_portion, 0) = 0' : ''}
        GROUP BY purchase_order_id
      ) pays ON pays.purchase_order_id = po.id
      WHERE 1=1
    `;
    const params = [];

    if (filters.supplier_id) {
      query += ' AND po.supplier_id = ?';
      params.push(filters.supplier_id);
    }

    if (filters.status) {
      query += ' AND po.status = ?';
      params.push(filters.status);
    }

    if (filters.currency) {
      query += ' AND UPPER(COALESCE(po.currency, \'UZS\')) = ?';
      params.push(String(filters.currency).toUpperCase());
    }

    if (filters.payment_status) {
      query += ' AND UPPER(COALESCE(po.payment_status, \'UNPAID\')) = ?';
      params.push(String(filters.payment_status).toUpperCase());
    }

    if (filters.debt_only) {
      query += ` AND (
        CASE WHEN UPPER(COALESCE(po.currency, 'UZS')) = 'USD'
          THEN COALESCE(po.total_usd, 0) - COALESCE(pays.paid_amount_usd, 0)
          ELSE COALESCE(po.total_amount, 0) - COALESCE(pays.paid_amount, 0)
        END
      ) > 0.009`;
    }

    if (filters.date_from) {
      query += ' AND po.order_date >= ?';
      params.push(filters.date_from);
    }

    if (filters.date_to) {
      query += ' AND po.order_date <= ?';
      params.push(filters.date_to);
    }

    if (filters.search && String(filters.search).trim()) {
      const term = `%${String(filters.search).trim()}%`;
      query +=
        ' AND (po.po_number LIKE ? OR IFNULL(s.name, \'\') LIKE ? OR IFNULL(po.supplier_name, \'\') LIKE ?)';
      params.push(term, term, term);
    }

    const sortBy = String(filters.sort_by || filters.sortBy || 'order_date').toLowerCase();
    const sortDir = String(filters.sort_dir || filters.sortDir || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
    const remainingExpr = hasAmountUsd
      ? `(
      CASE WHEN UPPER(COALESCE(po.currency, 'UZS')) = 'USD'
        THEN COALESCE(po.total_usd, 0) - COALESCE(pays.paid_amount_usd, 0)
        ELSE COALESCE(po.total_amount, 0) - COALESCE(pays.paid_amount, 0)
      END
    )`
      : `(COALESCE(po.total_amount, 0) - COALESCE(pays.paid_amount, 0))`;
    const paidExpr = hasAmountUsd
      ? `(
      CASE WHEN UPPER(COALESCE(po.currency, 'UZS')) = 'USD'
        THEN COALESCE(pays.paid_amount_usd, 0)
        ELSE COALESCE(pays.paid_amount, 0)
      END
    )`
      : `COALESCE(pays.paid_amount, 0)`;
    const sortCol =
      sortBy === 'total' || sortBy === 'total_amount'
        ? 'po.total_amount'
        : sortBy === 'status'
          ? 'po.status'
          : sortBy === 'po_number'
            ? 'po.po_number'
            : sortBy === 'remaining' || sortBy === 'remaining_amount'
              ? remainingExpr
              : sortBy === 'paid' || sortBy === 'paid_amount'
                ? paidExpr
                : 'po.order_date';

    const withTotal = !!(filters.with_total || filters.withTotal || filters.return_meta);
    let total = null;
    if (withTotal) {
      const countQuery = `
        SELECT COUNT(*) AS c
        FROM purchase_orders po
        LEFT JOIN suppliers s ON po.supplier_id = s.id
        LEFT JOIN (
          SELECT purchase_order_id,
            SUM(amount) AS paid_amount
            ${hasAmountUsd ? ', SUM(COALESCE(amount_usd, 0)) AS paid_amount_usd' : ''}
          FROM supplier_payments
          WHERE purchase_order_id IS NOT NULL
            ${this._hasSupplierPaymentCol('cancelled_at') ? 'AND cancelled_at IS NULL' : ''}
            ${this._hasSupplierPaymentCol('is_advance_portion') ? 'AND COALESCE(is_advance_portion, 0) = 0' : ''}
          GROUP BY purchase_order_id
        ) pays ON pays.purchase_order_id = po.id
        WHERE 1=1
        ${filters.supplier_id ? ' AND po.supplier_id = ?' : ''}
        ${filters.status ? ' AND po.status = ?' : ''}
        ${filters.currency ? ' AND UPPER(COALESCE(po.currency, \'UZS\')) = ?' : ''}
        ${filters.payment_status ? ' AND UPPER(COALESCE(po.payment_status, \'UNPAID\')) = ?' : ''}
        ${filters.debt_only ? ` AND (
          CASE WHEN UPPER(COALESCE(po.currency, 'UZS')) = 'USD'
            THEN COALESCE(po.total_usd, 0) - COALESCE(pays.paid_amount_usd, 0)
            ELSE COALESCE(po.total_amount, 0) - COALESCE(pays.paid_amount, 0)
          END
        ) > 0.009` : ''}
        ${filters.date_from ? ' AND po.order_date >= ?' : ''}
        ${filters.date_to ? ' AND po.order_date <= ?' : ''}
        ${
          filters.search && String(filters.search).trim()
            ? ' AND (po.po_number LIKE ? OR IFNULL(s.name, \'\') LIKE ? OR IFNULL(po.supplier_name, \'\') LIKE ?)'
            : ''
        }
      `;
      // Reuse same params order as main query (without limit/offset)
      const countParams = [];
      if (filters.supplier_id) countParams.push(filters.supplier_id);
      if (filters.status) countParams.push(filters.status);
      if (filters.currency) countParams.push(String(filters.currency).toUpperCase());
      if (filters.payment_status) countParams.push(String(filters.payment_status).toUpperCase());
      if (filters.date_from) countParams.push(filters.date_from);
      if (filters.date_to) countParams.push(filters.date_to);
      if (filters.search && String(filters.search).trim()) {
        const term = `%${String(filters.search).trim()}%`;
        countParams.push(term, term, term);
      }
      total = Number(this.db.prepare(countQuery).get(...countParams)?.c || 0);
    }

    query += ` ORDER BY ${sortCol} ${sortDir}, po.created_at DESC`;

    const limit = filters.limit != null ? Number(filters.limit) : null;
    const offset = filters.offset != null ? Number(filters.offset) : 0;
    if (Number.isFinite(limit) && limit > 0) {
      query += ' LIMIT ?';
      params.push(limit);
      if (Number.isFinite(offset) && offset > 0) {
        query += ' OFFSET ?';
        params.push(offset);
      }
    }

    const rows = this.db.prepare(query).all(...params);

    // If include_items requested, fetch items for all POs in one batch
    let itemsByPoId = new Map();
    if (filters.include_items) {
      const poIds = rows.map((r) => r.id);
      if (poIds.length > 0) {
        const placeholders = poIds.map(() => '?').join(',');
        const itemsQuery = `
          SELECT 
            poi.*,
            COALESCE(p.name, poi.product_name) as product_name,
            COALESCE(p.sku, poi.product_sku) as product_sku,
            p.unit as product_unit
          FROM purchase_order_items poi
          LEFT JOIN products p ON poi.product_id = p.id
          WHERE poi.purchase_order_id IN (${placeholders})
          ORDER BY poi.purchase_order_id, poi.id
        `;
        const allItems = this.db.prepare(itemsQuery).all(poIds);
        for (const item of allItems) {
          if (!itemsByPoId.has(item.purchase_order_id)) {
            itemsByPoId.set(item.purchase_order_id, []);
          }
          itemsByPoId.get(item.purchase_order_id).push(item);
        }
      }
    }

    const mapped = rows.map((row) => {
      const currency = hasCurrency ? String(row.currency || 'UZS').toUpperCase() : 'UZS';
      const paidAmountUZS = Number(row.computed_paid_amount ?? 0);
      let paidAmountUSD = hasAmountUsd ? Number(row.computed_paid_amount_usd ?? 0) : 0;
      if (currency === 'USD' && paidAmountUSD <= 0 && paidAmountUZS > 0) {
        const fx = Number(row.fx_rate ?? 0);
        if (fx > 0) paidAmountUSD = paidAmountUZS / fx;
      }
      const totalAmountUZS = Number(row.total_amount ?? 0);
      const totalAmountUSD = hasTotalUsd ? Number(row.total_usd ?? 0) : 0;
      const remUzs = computePurchaseRemainder(paidAmountUZS, totalAmountUZS);
      const remUsd = computePurchaseRemainder(paidAmountUSD, totalAmountUSD);
      const result = {
        ...row,
        paid_amount_uzs: paidAmountUZS,
        remaining_amount_uzs: remUzs.debt,
        excess_amount_uzs: remUzs.excess,
        paid_amount_usd: currency === 'USD' ? paidAmountUSD : null,
        remaining_amount_usd: currency === 'USD' ? remUsd.debt : null,
        excess_amount_usd: currency === 'USD' ? remUsd.excess : null,
        // Keep legacy fields too (best-effort) — debt never negative
        paid_amount: currency === 'USD' ? paidAmountUSD : paidAmountUZS,
        remaining_amount: currency === 'USD' ? remUsd.debt : remUzs.debt,
        excess_amount: currency === 'USD' ? remUsd.excess : remUzs.excess,
        payment_status: currency === 'USD'
          ? this._computePaymentStatus(paidAmountUSD, totalAmountUSD, 'USD')
          : this._computePaymentStatus(paidAmountUZS, totalAmountUZS, 'UZS'),
        // Helpful for UI: allow payment from list even if it expects `po.supplier`
        supplier: row.supplier_id
          ? { id: row.supplier_id, name: row.supplier_name || row.supplier_id }
          : null,
      };
      if (filters.include_items) {
        result.items = itemsByPoId.get(row.id) || [];
      }
      return result;
    });

    if (withTotal) {
      return {
        rows: mapped,
        total: total != null ? total : mapped.length,
        limit: Number.isFinite(limit) && limit > 0 ? limit : null,
        offset: Number.isFinite(offset) && offset > 0 ? offset : 0,
      };
    }
    return mapped;
  }

  /**
   * Authorized + audited PO list export (CSV rows as objects).
   */
  exportList(filters = {}, { exported_by } = {}) {
    const role = this._primaryPurchaseRole(exported_by);
    if (!canExportPurchaseOrders(role)) {
      throw createError(
        ERROR_CODES.FORBIDDEN || ERROR_CODES.VALIDATION_ERROR,
        'Export purchase orders requires accountant/manager/admin',
      );
    }
    const { with_total: _wt, withTotal: _wt2, return_meta: _rm, limit: _lim, offset: _off, ...rest } =
      filters || {};
    const rows = this.list({ ...rest, include_items: false });
    const list = Array.isArray(rows) ? rows : rows?.rows || [];
    this._audit(
      'export',
      'purchase_orders',
      null,
      null,
      {
        count: list.length,
        filters: rest,
        exported_at: new Date().toISOString(),
      },
      exported_by || null,
    );
    return { rows: list, count: list.length };
  }

  /**
   * Get purchase order by ID with details
   */
  get(id) {
    if (!id) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Purchase order ID is required');
    }

    const po = this.db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(id);
    if (!po) {
      throw createError(ERROR_CODES.NOT_FOUND, `Purchase order ${id} not found`);
    }

    // Compute payment info from supplier_payments (single source of truth)
    const hasAmountUsd = this._hasSupplierPaymentCol('amount_usd');
    const hasCurrency = this._hasPOCol('currency');
    const hasTotalUsd = this._hasPOCol('total_usd');
    const poCurrency = hasCurrency ? String(po.currency || 'UZS').toUpperCase() : 'UZS';

    const paidFilter = this._supplierPaymentActiveSql('').replace(/^\s*AND\s*/, '');
    // _supplierPaymentActiveSql uses alias — build inline for bare table
    const activePayExtra = [
      this._hasSupplierPaymentCol('cancelled_at') ? 'cancelled_at IS NULL' : null,
      this._hasSupplierPaymentCol('is_advance_portion')
        ? 'COALESCE(is_advance_portion, 0) = 0'
        : null,
    ]
      .filter(Boolean)
      .join(' AND ');
    const payWhere = activePayExtra
      ? `purchase_order_id = ? AND ${activePayExtra}`
      : 'purchase_order_id = ?';

    const paidAmountUZS = Number(
      this.db
        .prepare(`SELECT COALESCE(SUM(amount), 0) AS paid_amount FROM supplier_payments WHERE ${payWhere}`)
        .get(id)?.paid_amount ?? 0
    );
    let paidAmountUSD = hasAmountUsd
      ? Number(
          this.db
            .prepare(
              `SELECT COALESCE(SUM(COALESCE(amount_usd, 0)), 0) AS paid_amount FROM supplier_payments WHERE ${payWhere}`,
            )
            .get(id)?.paid_amount ?? 0,
        )
      : 0;
    if (poCurrency === 'USD' && paidAmountUSD <= 0 && paidAmountUZS > 0) {
      const fx = Number(po.fx_rate ?? 0);
      if (fx > 0) paidAmountUSD = paidAmountUZS / fx;
    }

    // Get items
    const items = this.db.prepare(`
      SELECT 
        poi.*,
        COALESCE(p.name, poi.product_name) as product_name,
        COALESCE(p.sku, poi.product_sku) as product_sku,
        p.unit as product_unit
      FROM purchase_order_items poi
      LEFT JOIN products p ON poi.product_id = p.id
      WHERE poi.purchase_order_id = ?
      ORDER BY poi.id
    `).all(id);

    // Optional: PO expenses (landed cost)
    const hasPOExpenses = (() => {
      try {
        return this.db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='purchase_order_expenses'`).get()
          ? true
          : false;
      } catch {
        return false;
      }
    })();

    const expenses = hasPOExpenses
      ? this.db
          .prepare(
            `
            SELECT id, purchase_order_id, title, amount, allocation_method, notes, created_by, created_at
            FROM purchase_order_expenses
            WHERE purchase_order_id = ?
            ORDER BY datetime(created_at) DESC
          `
          )
          .all(id)
      : [];

    const totalExpenses = expenses.reduce((sum, e) => sum + (Number(e.amount || 0) || 0), 0);

    // Compute landed costs per item for UI:
    // allocation_method:
    // - by_value: proportional to item line_total (ordered_qty * unit_cost)
    // - by_qty: proportional to ordered_qty
    const baseValueTotal = items.reduce((sum, it) => sum + (Number(it.line_total || 0) || (Number(it.ordered_qty) * Number(it.unit_cost) || 0)), 0);
    const baseQtyTotal = items.reduce((sum, it) => sum + (Number(it.ordered_qty) || 0), 0);
    const normalizedItems = items.map((it) => {
      const orderedQty = Number(it.ordered_qty || 0) || 0;
      const baseLineValue = Number(it.line_total || 0) || (orderedQty * (Number(it.unit_cost || 0) || 0));

      let allocated = 0;
      for (const exp of expenses) {
        const amt = Number(exp.amount || 0) || 0;
        const method = exp.allocation_method === 'by_qty' ? 'by_qty' : 'by_value';
        if (amt <= 0) continue;
        if (method === 'by_qty') {
          allocated += baseQtyTotal > 0 ? (orderedQty / baseQtyTotal) * amt : 0;
        } else {
          allocated += baseValueTotal > 0 ? (baseLineValue / baseValueTotal) * amt : 0;
        }
      }

      const perUnitExtra = orderedQty > 0 ? allocated / orderedQty : 0;
      const landedUnitCost = (Number(it.unit_cost || 0) || 0) + perUnitExtra;
      return {
        ...it,
        allocated_expenses: allocated,
        landed_unit_cost: landedUnitCost,
      };
    });

    // Get supplier
    let supplier = null;
    if (po.supplier_id) {
      supplier = this.db.prepare('SELECT * FROM suppliers WHERE id = ?').get(po.supplier_id);
    }

    const remUzs = computePurchaseRemainder(paidAmountUZS, Number(po.total_amount ?? 0));
    const remUsd = computePurchaseRemainder(
      paidAmountUSD,
      hasTotalUsd ? Number(po.total_usd ?? 0) : 0,
    );

    return {
      ...po,
      items: normalizedItems,
      supplier,
      expenses,
      total_expenses: totalExpenses,
      payment_schedule: this._loadPaymentSchedule(id),
      paid_amount_uzs: paidAmountUZS,
      remaining_amount_uzs: remUzs.debt,
      excess_amount_uzs: remUzs.excess,
      paid_amount_usd: poCurrency === 'USD' ? paidAmountUSD : null,
      remaining_amount_usd: poCurrency === 'USD' ? remUsd.debt : null,
      excess_amount_usd: poCurrency === 'USD' ? remUsd.excess : null,
      paid_amount: poCurrency === 'USD' ? paidAmountUSD : paidAmountUZS,
      remaining_amount: poCurrency === 'USD' ? remUsd.debt : remUzs.debt,
      excess_amount: poCurrency === 'USD' ? remUsd.excess : remUzs.excess,
      payment_status: poCurrency === 'USD'
        ? this._computePaymentStatus(paidAmountUSD, hasTotalUsd ? Number(po.total_usd ?? 0) : 0, 'USD')
        : this._computePaymentStatus(paidAmountUZS, Number(po.total_amount ?? 0), 'UZS'),
    };
  }

  /**
   * Purchase order expenses (landed costs)
   */
  listExpenses(purchaseOrderId) {
    if (!purchaseOrderId) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Purchase order ID is required');
    }
    // Ensure PO exists
    this.get(purchaseOrderId);
    // If table doesn't exist, return empty (for older DBs)
    const exists = this.db
      .prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='purchase_order_expenses'`)
      .get();
    if (!exists) return [];
    return this.db
      .prepare(
        `
        SELECT id, purchase_order_id, title, amount, allocation_method, notes, created_by, created_at
        FROM purchase_order_expenses
        WHERE purchase_order_id = ?
        ORDER BY datetime(created_at) DESC
      `
      )
      .all(purchaseOrderId);
  }

  addExpense(purchaseOrderId, payload = {}) {
    if (!purchaseOrderId) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Purchase order ID is required');
    }
    const po = this.get(purchaseOrderId);
    if (String(po.status || '').toLowerCase() === 'cancelled') {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Cancelled buyurtmaga xarajat qo‘shib bo‘lmaydi');
    }

    const title = String(payload.title || '').trim();
    const amount = Number(payload.amount);
    const allocationMethod = payload.allocation_method === 'by_qty' ? 'by_qty' : 'by_value';

    if (!title) throw createError(ERROR_CODES.VALIDATION_ERROR, 'title is required');
    if (!Number.isFinite(amount) || amount < 0) throw createError(ERROR_CODES.VALIDATION_ERROR, 'amount must be >= 0');

    const tableExists = this.db
      .prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='purchase_order_expenses'`)
      .get();
    if (!tableExists) {
      throw createError(ERROR_CODES.DB_ERROR, 'purchase_order_expenses table is missing (migration not applied)');
    }

    const id = randomUUID();
    const now = new Date().toISOString().replace('T', ' ').replace('Z', '').substring(0, 19);
    this.db
      .prepare(
        `
        INSERT INTO purchase_order_expenses (
          id, purchase_order_id, title, amount, allocation_method, notes, created_by, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `
      )
      .run(
        id,
        purchaseOrderId,
        title,
        amount,
        allocationMethod,
        payload.notes ? String(payload.notes).trim() : null,
        payload.created_by || null,
        now
      );

    this.db.prepare(`UPDATE purchase_orders SET updated_at = ? WHERE id = ?`).run(now, purchaseOrderId);
    if (this._hasAnyReceivedQty(purchaseOrderId)) {
      this._syncReceivedProductsPurchasePriceFromLandedCost(purchaseOrderId, now);
    }

    return this.listExpenses(purchaseOrderId);
  }

  deleteExpense(purchaseOrderId, expenseId) {
    if (!purchaseOrderId) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Purchase order ID is required');
    }
    if (!expenseId) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Expense ID is required');
    }

    const po = this.get(purchaseOrderId);
    if (String(po.status || '').toLowerCase() === 'cancelled') {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Cancelled buyurtmada xarajatni o‘chirib bo‘lmaydi');
    }

    const tableExists = this.db
      .prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='purchase_order_expenses'`)
      .get();
    if (!tableExists) return { success: true };

    const res = this.db
      .prepare(`DELETE FROM purchase_order_expenses WHERE id = ? AND purchase_order_id = ?`)
      .run(expenseId, purchaseOrderId);
    if (res.changes === 0) {
      throw createError(ERROR_CODES.NOT_FOUND, 'Expense not found');
    }
    const now = new Date().toISOString().replace('T', ' ').replace('Z', '').substring(0, 19);
    this.db.prepare(`UPDATE purchase_orders SET updated_at = ? WHERE id = ?`).run(now, purchaseOrderId);
    if (this._hasAnyReceivedQty(purchaseOrderId)) {
      this._syncReceivedProductsPurchasePriceFromLandedCost(purchaseOrderId, now);
    }
    return this.listExpenses(purchaseOrderId);
  }

  /**
   * Create purchase order
   */
  createOrder(data) {
    // Validation
    if (!data.items || !Array.isArray(data.items) || data.items.length === 0) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Purchase order must have at least one item');
    }

    const id = randomUUID();
    // PO number must be UNIQUE. Frontend may generate duplicates (especially if it used localStorage counters).
    // So we always ensure uniqueness here.
    let poNumber = data.po_number || null;
    const now = new Date().toISOString().replace('T', ' ').replace('Z', '').substring(0, 19);

    // SINGLE WAREHOUSE SYSTEM: Always use main-warehouse-001
    const MAIN_WAREHOUSE_ID = 'main-warehouse-001';
    const warehouseId = MAIN_WAREHOUSE_ID;

    // Resolve created_by to a valid users.id (FK-safe)
    const KNOWN_DEFAULT_USER = 'default-admin-001';
    let createdBy = data.created_by || data.createdBy || data.user_id || data.userId || null;
    if (createdBy && createdBy !== KNOWN_DEFAULT_USER) {
      const exists = this.db.prepare('SELECT id FROM users WHERE id = ?').get(createdBy);
      if (!exists) {
        createdBy = null;
      }
    }
    if (!createdBy) {
      createdBy = KNOWN_DEFAULT_USER;
    }

    const hasCurrency = this._hasPOCol('currency');
    const hasFxRate = this._hasPOCol('fx_rate');
    const hasTotalUsd = this._hasPOCol('total_usd');
    const hasItemUsd = this._hasPOItemCol('unit_cost_usd') && this._hasPOItemCol('line_total_usd');
    const hasItemSku = this._hasPOItemCol('product_sku');
    const hasItemDiscountPercent = this._hasPOItemCol('discount_percent');
    const hasItemDiscountAmount = this._hasPOItemCol('discount_amount');
    const hasItemSalePrice = this._hasPOItemCol('sale_price');

    const currency = hasCurrency ? String(data.currency || 'UZS').toUpperCase() : 'UZS';
    const isUSD = currency === 'USD';
    const fxRate = isUSD ? Number(data.fx_rate) : null;

    if (data.supplier_id && hasCurrency && this._cols('suppliers').has('settlement_currency')) {
      const supplierRow = this.db
        .prepare('SELECT settlement_currency FROM suppliers WHERE id = ?')
        .get(data.supplier_id);
      const settlement = String(supplierRow?.settlement_currency || 'UZS').toUpperCase();
      if (settlement === 'USD' && currency !== 'USD') {
        throw createError(
          ERROR_CODES.VALIDATION_ERROR,
          'USD supplier requires purchase order in USD currency'
        );
      }
    }

    if (isUSD) {
      if (!hasCurrency || !hasFxRate || !hasTotalUsd || !hasItemUsd) {
        throw createError(ERROR_CODES.DB_ERROR, 'USD purchase columns missing (apply latest migrations and restart app)');
      }
      if (!Number.isFinite(fxRate) || fxRate <= 0) {
        throw createError(ERROR_CODES.VALIDATION_ERROR, 'fx_rate is required for USD purchase (UZS per 1 USD)');
      }
    }

    // Normalize items (store inventory cost in UZS; keep USD snapshot too)
    const normalizedItems = data.items.map((it) => {
      const orderedQty = Number(it.ordered_qty);
      if (!Number.isFinite(orderedQty) || orderedQty <= 0) {
        throw createError(ERROR_CODES.VALIDATION_ERROR, 'ordered_qty must be > 0');
      }
      const discountPercent = Number(it.discount_percent ?? 0);
      const discountAmount = Number(it.discount_amount ?? 0);
      if (isUSD) {
        // Prefer explicit USD fields. Falling back to unit_cost (UZS) caused fx×UZS
        // phantom costs (tens of millions so'm) on sales reports.
        const hasExplicitUsd =
          (it.unit_cost_usd != null && it.unit_cost_usd !== '') ||
          (it.unit_price_usd != null && it.unit_price_usd !== '');
        if (!hasExplicitUsd && hasItemUsd) {
          throw createError(
            ERROR_CODES.VALIDATION_ERROR,
            'USD xarid uchun unit_cost_usd majburiy (UZS unit_cost ni dollar deb ko‘paytirib bo‘lmaydi)',
          );
        }
        const unitUsd = Number(
          hasExplicitUsd ? (it.unit_cost_usd ?? it.unit_price_usd) : it.unit_cost,
        );
        if (!Number.isFinite(unitUsd) || unitUsd < 0) {
          throw createError(ERROR_CODES.VALIDATION_ERROR, 'unit_cost_usd must be >= 0 for USD purchase');
        }
        const lineUsd = Number.isFinite(Number(it.line_total_usd))
          ? Number(it.line_total_usd)
          : orderedQty * unitUsd;
        const unitUzs = unitUsd * fxRate;
        const lineUzs = orderedQty * unitUzs;
        return {
          ...it,
          unit_cost_usd: unitUsd,
          line_total_usd: lineUsd,
          unit_cost: unitUzs,
          line_total: lineUzs,
          discount_percent: discountPercent,
          discount_amount: discountAmount,
        };
      }

      const unitUzs = Number(it.unit_cost);
      if (!Number.isFinite(unitUzs) || unitUzs < 0) {
        throw createError(ERROR_CODES.VALIDATION_ERROR, 'unit_cost must be >= 0');
      }
      const lineUzs = Number.isFinite(Number(it.line_total)) ? Number(it.line_total) : orderedQty * unitUzs;
      return { ...it, unit_cost: unitUzs, line_total: lineUzs, discount_percent: discountPercent, discount_amount: discountAmount };
    });

    // Totals
    const subtotal = normalizedItems.reduce((sum, item) => sum + (Number(item.line_total) || 0), 0);
    const discount = Number(data.discount || 0);
    const tax = Number(data.tax || 0);
    const totalAmount = subtotal - discount + tax;
    const totalUsd = isUSD
      ? Math.max(
          0,
          normalizedItems.reduce((sum, item) => sum + (Number(item.line_total_usd) || 0), 0) -
            (Number(discount || 0) / Number(fxRate || 1))
        )
      : null;

    const initialPaid =
      data.initial_payment != null
        ? Number(
            isUSD
              ? data.initial_payment.amount_usd ?? data.initial_payment.amount ?? 0
              : data.initial_payment.amount ?? 0
          ) || 0
        : 0;
    this._validatePaymentSchemeInput({
      scheme: data.payment_scheme,
      poCurrency: currency,
      totalAmount,
      totalUsd,
      paymentDueDate: data.payment_due_date,
      paymentSchedule: data.payment_schedule,
      initialPaymentAmount: initialPaid,
    });

    // Begin transaction (insert statements are schema-aware)
    const poCols = [
      'id',
      'po_number',
      'supplier_id',
      'supplier_name',
      'warehouse_id',
      'order_date',
      'expected_date',
      'reference',
      'subtotal',
      'discount',
      'tax',
      'total_amount',
      'status',
      'invoice_number',
      'notes',
      'created_by',
      'created_at',
      'updated_at',
    ];
    const poParamsBase = [
      id,
      null, // po_number filled later
      data.supplier_id || null,
      data.supplier_name || null,
      warehouseId,
      data.order_date || now,
      data.expected_date || null,
      data.reference || null,
      subtotal,
      discount,
      tax,
      totalAmount,
      data.status || 'draft',
      data.invoice_number || null,
      data.notes || null,
      createdBy,
      now,
      now,
    ];
    if (hasCurrency) {
      poCols.push('currency');
      poParamsBase.push(currency);
    }
    if (hasFxRate) {
      poCols.push('fx_rate');
      poParamsBase.push(isUSD ? fxRate : null);
    }
    if (hasTotalUsd) {
      poCols.push('total_usd');
      poParamsBase.push(isUSD ? totalUsd : null);
    }
    const insertPO = this.db.prepare(
      `INSERT INTO purchase_orders (${poCols.join(', ')}) VALUES (${poCols.map(() => '?').join(', ')})`
    );

    const itemCols = [
      'id',
      'purchase_order_id',
      'product_id',
      'product_name',
      ...(hasItemSku ? ['product_sku'] : []),
      'ordered_qty',
      'received_qty',
      'unit_cost',
      'line_total',
      ...(hasItemUsd ? ['unit_cost_usd', 'line_total_usd'] : []),
      ...(hasItemDiscountPercent ? ['discount_percent'] : []),
      ...(hasItemDiscountAmount ? ['discount_amount'] : []),
      ...(hasItemSalePrice ? ['sale_price'] : []),
    ];
    const insertItem = this.db.prepare(
      `INSERT INTO purchase_order_items (${itemCols.join(', ')}) VALUES (${itemCols.map(() => '?').join(', ')})`
    );

    const transaction = this.db.transaction(() => {
      // Ensure unique po_number (standard format: PO-YYYY-00001)
      const poExistsStmt = this.db.prepare('SELECT 1 FROM purchase_orders WHERE po_number = ?');
      const year = new Date().getFullYear();
      const prefix = `PO-${year}-`;
      const lastRow = this.db.prepare(`
        SELECT po_number
        FROM purchase_orders
        WHERE po_number LIKE ?
        ORDER BY po_number DESC
        LIMIT 1
      `).get(`${prefix}%`);
      const last = lastRow?.po_number ? String(lastRow.po_number) : '';
      const lastNum = (() => {
        const m = last.match(new RegExp(`^${prefix.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}(\\d+)$`));
        return m ? Number(m[1]) : 0;
      })();
      const nextNum = Number.isFinite(lastNum) ? lastNum + 1 : 1;
      const buildAutoNumber = (n) => `${prefix}${String(n).padStart(5, '0')}`;

      // If caller provided a po_number, only accept it if it's unique; otherwise auto-generate.
      if (!poNumber || poExistsStmt.get(poNumber)) {
        poNumber = buildAutoNumber(nextNum);
      }

      // Final uniqueness loop (very defensive)
      let tries = 0;
      while (poExistsStmt.get(poNumber)) {
        tries += 1;
        if (tries > 50) {
          throw createError(ERROR_CODES.DB_ERROR, 'Failed to generate unique PO number');
        }
        poNumber = buildAutoNumber(nextNum + tries);
      }

      // Ensure main warehouse exists
      const warehouseExists = this.db.prepare('SELECT id FROM warehouses WHERE id = ?').get(MAIN_WAREHOUSE_ID);
      if (!warehouseExists) {
        this.db.prepare(`
          INSERT INTO warehouses (id, code, name, is_active, created_at, updated_at)
          VALUES (?, 'MAIN', 'Asosiy Ombor', 1, datetime('now'), datetime('now'))
        `).run(MAIN_WAREHOUSE_ID);
      }

      // Insert PO (fill po_number in params)
      const poParams = [...poParamsBase];
      poParams[1] = poNumber;
      insertPO.run(...poParams);

      // Insert items
      for (const item of normalizedItems) {
        // Ensure product exists (FK-safe)
        const product = this.db.prepare('SELECT id, sku, name FROM products WHERE id = ?').get(item.product_id);
        if (!product) {
          throw createError(ERROR_CODES.NOT_FOUND, `Product ${item.product_id} not found`);
        }

        const itemId = randomUUID();
        const params = [
          itemId,
          id,
          item.product_id,
          item.product_name || product.name,
          ...(hasItemSku ? [item.product_sku || product.sku || ''] : []),
          item.ordered_qty,
          0, // received_qty starts at 0
          item.unit_cost,
          item.line_total,
          ...(hasItemUsd ? [item.unit_cost_usd ?? null, item.line_total_usd ?? null] : []),
          ...(hasItemDiscountPercent ? [Number(item.discount_percent ?? 0) || 0] : []),
          ...(hasItemDiscountAmount ? [Number(item.discount_amount ?? 0) || 0] : []),
          ...(hasItemSalePrice ? [Number(item.sale_price ?? 0) > 0 ? Number(item.sale_price) : null] : []),
        ];
        insertItem.run(...params);
      }

      this._savePaymentScheme(id, {
        scheme: data.payment_scheme,
        payment_due_date: data.payment_due_date,
        payment_schedule: data.payment_schedule,
      });

      if (data.initial_payment && data.supplier_id) {
        this._insertSupplierPaymentForPo({
          purchaseOrderId: id,
          supplierId: data.supplier_id,
          payment: data.initial_payment,
          poCurrency: currency,
          totalAmountUzs: totalAmount,
          totalAmountUsd: totalUsd,
        });
      }
    });

    transaction();

    return this.get(id);
  }

  /**
   * After line items change, set PO status from ordered vs received totals.
   */
  _finalizePurchaseOrderStatus(purchaseOrderId, po, data, now) {
    const totals = this.db
      .prepare(
        `
        SELECT COALESCE(SUM(ordered_qty), 0) AS o, COALESCE(SUM(received_qty), 0) AS r
        FROM purchase_order_items
        WHERE purchase_order_id = ?
      `
      )
      .get(purchaseOrderId);
    const o = Number(totals?.o || 0);
    const r = Number(totals?.r || 0);
    let newStatus;
    if (r <= 0) {
      const requested = data && data.status != null && String(data.status) !== '' ? String(data.status) : null;
      if (requested === 'draft' || requested === 'approved') {
        newStatus = requested;
      } else {
        newStatus = po.status === 'draft' ? 'draft' : 'approved';
      }
    } else if (o > 0 && r >= o) {
      newStatus = 'received';
    } else {
      newStatus = 'partially_received';
    }
    this.db.prepare(`UPDATE purchase_orders SET status = ?, updated_at = ? WHERE id = ?`).run(newStatus, now, purchaseOrderId);
  }

  _validateStatusTransition(currentStatus, requestedStatus, totalReceived = 0) {
    if (requestedStatus == null || String(requestedStatus) === '') return;
    const current = String(currentStatus || '').toLowerCase();
    const next = String(requestedStatus || '').toLowerCase();
    if (!next) return;
    const hasReceived = Number(totalReceived || 0) > 0;

    if (hasReceived && (next === 'draft' || next === 'approved' || next === 'cancelled')) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, `Cannot set status '${next}' after goods were received`);
    }

    const allowed = {
      draft: new Set(['draft', 'approved', 'cancelled']),
      approved: new Set(['approved', 'cancelled']),
      partially_received: new Set(['partially_received', 'received']),
      received: new Set(['received']),
      cancelled: new Set(['cancelled']),
    };
    const allowSet = allowed[current] || new Set([current]);
    if (!allowSet.has(next)) {
      throw createError(
        ERROR_CODES.VALIDATION_ERROR,
        `Invalid purchase status transition: ${current || 'unknown'} -> ${next}`
      );
    }
  }

  /**
   * After PO line costs change (including edit of received PO), push unit_cost / sale_price to products
   * so the catalog "Sotib olish narxi" matches the purchase — same idea as createReceipt.
   */
  _syncProductCatalogFromReceivedPoLines(purchaseOrderId, now) {
    const rows =
      this.db
        .prepare(
          `
        SELECT product_id, unit_cost, sale_price
        FROM purchase_order_items
        WHERE purchase_order_id = ? AND COALESCE(received_qty, 0) > 0
        ORDER BY id DESC
      `
        )
        .all(purchaseOrderId) || [];
    const picked = new Map();
    for (const row of rows) {
      const pid = row.product_id;
      if (!pid || picked.has(pid)) continue;
      picked.set(pid, row);
    }
    for (const [pid, row] of picked) {
      const uc = Number(row.unit_cost || 0);
      // Do not wipe catalog purchase_price with empty/zero line cost.
      if (Number.isFinite(uc) && uc > 0) {
        try {
          this.db.prepare(`UPDATE products SET purchase_price = ?, updated_at = ? WHERE id = ?`).run(uc, now, pid);
          if (this.cacheService?.invalidateProduct) this.cacheService.invalidateProduct(pid);
          if (this.cacheService?.invalidatePricesForProduct) this.cacheService.invalidatePricesForProduct(pid);
        } catch (e) {
          console.warn('[PurchaseService] sync purchase_price from PO lines:', e?.message);
        }
      }
      const sp = Number(row.sale_price ?? 0);
      if (!Number.isFinite(sp) || sp <= 0) continue;
      try {
        this.db.prepare(`UPDATE products SET sale_price = ?, updated_at = ? WHERE id = ?`).run(sp, now, pid);
        const hasProductUnits = this.db
          .prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='product_units'`)
          .get();
        if (hasProductUnits) {
          const puRes = this.db
            .prepare(`UPDATE product_units SET sale_price = ? WHERE product_id = ? AND is_default = 1`)
            .run(sp, pid);
          if (puRes.changes === 0) {
            const first = this.db
              .prepare(
                `SELECT id FROM product_units WHERE product_id = ? ORDER BY is_default DESC, unit ASC LIMIT 1`
              )
              .get(pid);
            if (first) {
              this.db.prepare(`UPDATE product_units SET sale_price = ? WHERE id = ?`).run(sp, first.id);
            }
          }
        }
        if (this.cacheService?.invalidateProduct) this.cacheService.invalidateProduct(pid);
        if (this.cacheService?.invalidatePricesForProduct) this.cacheService.invalidatePricesForProduct(pid);
        this._afterProductCatalogPriceChange(pid);
      } catch (e) {
        console.warn('[PurchaseService] sync sale_price from PO lines:', e?.message);
      }
    }
  }

  /**
   * After a received PO's unit_cost is edited, update remaining qty on batches
   * that still belong to this PO's receipts. Closed/fully consumed batches are left unchanged.
   */
  _syncOpenBatchCostsFromPoLines(purchaseOrderId, now) {
    try {
      const batchTable = this.db
        .prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='inventory_batches'`)
        .get();
      if (!batchTable) return;
      const batchCols = new Set(
        (this.db.prepare(`PRAGMA table_info(inventory_batches)`).all() || []).map((c) => c.name)
      );
      if (!batchCols.has('unit_cost') || !batchCols.has('remaining_qty')) return;

      const lines =
        this.db
          .prepare(
            `
          SELECT id, product_id, unit_cost
          FROM purchase_order_items
          WHERE purchase_order_id = ? AND COALESCE(received_qty, 0) > 0
        `
          )
          .all(purchaseOrderId) || [];
      if (!lines.length) return;

      const hasCostUzs = batchCols.has('cost_price_uzs');
      const hasUpdatedAt = batchCols.has('updated_at');
      const hasReceiptItemId = batchCols.has('receipt_item_id');
      const hasReceiptId = batchCols.has('receipt_id');
      const hasPriTable = this.db
        .prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='purchase_receipt_items'`)
        .get();
      const hasPrTable = this.db
        .prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='purchase_receipts'`)
        .get();

      for (const row of lines) {
        const pid = row.product_id;
        const uc = Number(row.unit_cost || 0);
        if (!pid || !(uc >= 0)) continue;
        const sets = ['unit_cost = ?'];
        const params = [uc];
        if (hasCostUzs) {
          sets.push('cost_price_uzs = ?');
          params.push(uc);
        }
        if (hasUpdatedAt) {
          sets.push('updated_at = ?');
          params.push(now);
        }

        let where = `product_id = ? AND remaining_qty > 0 AND COALESCE(status, 'active') = 'active'`;
        params.push(pid);

        if (hasReceiptItemId && hasPriTable) {
          where += ` AND receipt_item_id IN (
            SELECT pri.id FROM purchase_receipt_items pri
            WHERE pri.purchase_order_item_id = ?
          )`;
          params.push(row.id);
        } else if (hasReceiptId && hasPrTable) {
          where += ` AND receipt_id IN (
            SELECT pr.id FROM purchase_receipts pr WHERE pr.purchase_order_id = ?
          )`;
          params.push(purchaseOrderId);
        } else {
          continue;
        }

        this.db.prepare(`UPDATE inventory_batches SET ${sets.join(', ')} WHERE ${where}`).run(...params);
      }
    } catch (e) {
      console.warn('[PurchaseService] sync open batch costs from PO lines:', e?.message);
    }
  }

  /**
   * Normalize line items payload from explicit arg or nested data.items.
   */
  _resolveLineItems(data, items) {
    if (Array.isArray(items)) return items;
    if (data && Array.isArray(data.items)) return data.items;
    return null;
  }

  /**
   * Compute UZS/USD unit + line amounts for a PO line payload row.
   */
  _normalizePoLineAmounts(item, isUSD, fxRate) {
    const orderedQty = Number(item.ordered_qty);
    if (!Number.isFinite(orderedQty) || orderedQty <= 0) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'ordered_qty must be > 0');
    }

    let unitUzs = Number(item.unit_cost);
    let lineUzs = Number(item.line_total ?? orderedQty * unitUzs);
    let unitUsd = null;
    let lineUsd = null;

    if (isUSD) {
      const hasExplicitUsd =
        (item.unit_cost_usd != null && item.unit_cost_usd !== '') ||
        (item.unit_price_usd != null && item.unit_price_usd !== '');
      if (!hasExplicitUsd) {
        throw createError(
          ERROR_CODES.VALIDATION_ERROR,
          'USD xarid uchun unit_cost_usd majburiy (UZS unit_cost ni dollar deb ko‘paytirib bo‘lmaydi)',
        );
      }
      unitUsd = Number(item.unit_cost_usd ?? item.unit_price_usd);
      if (!Number.isFinite(unitUsd) || unitUsd < 0) {
        throw createError(ERROR_CODES.VALIDATION_ERROR, 'unit_cost_usd must be >= 0 for USD purchase');
      }
      lineUsd = Number.isFinite(Number(item.line_total_usd)) ? Number(item.line_total_usd) : orderedQty * unitUsd;
      unitUzs = unitUsd * fxRate;
      lineUzs = orderedQty * unitUzs;
    }

    return { orderedQty, unitUzs, lineUzs, unitUsd, lineUsd };
  }

  /**
   * Full line-item sync when nothing received yet: UPDATE by id, INSERT new, DELETE removed.
   */
  _replacePurchaseOrderItems(purchaseOrderId, items, ctx) {
    const {
      isUSD,
      fxRate,
      hasItemSku,
      hasItemUsd,
      hasItemDiscountPercent,
      hasItemDiscountAmount,
      hasItemSalePrice,
    } = ctx;

    const dbRows =
      this.db
        .prepare(`SELECT * FROM purchase_order_items WHERE purchase_order_id = ? ORDER BY id`)
        .all(purchaseOrderId) || [];
    const byId = new Map(dbRows.map((row) => [row.id, row]));
    const keptIds = new Set();

    const updateSets = [
      'product_id = ?',
      'product_name = ?',
      ...(hasItemSku ? ['product_sku = ?'] : []),
      'ordered_qty = ?',
      'unit_cost = ?',
      'line_total = ?',
      ...(hasItemUsd ? ['unit_cost_usd = ?', 'line_total_usd = ?'] : []),
      ...(hasItemDiscountPercent ? ['discount_percent = ?'] : []),
      ...(hasItemDiscountAmount ? ['discount_amount = ?'] : []),
      ...(hasItemSalePrice ? ['sale_price = ?'] : []),
    ];
    const updateItem = this.db.prepare(
      `UPDATE purchase_order_items SET ${updateSets.join(', ')} WHERE id = ? AND purchase_order_id = ?`
    );

    const itemCols = [
      'id',
      'purchase_order_id',
      'product_id',
      'product_name',
      ...(hasItemSku ? ['product_sku'] : []),
      'ordered_qty',
      'received_qty',
      'unit_cost',
      'line_total',
      ...(hasItemUsd ? ['unit_cost_usd', 'line_total_usd'] : []),
      ...(hasItemDiscountPercent ? ['discount_percent'] : []),
      ...(hasItemDiscountAmount ? ['discount_amount'] : []),
      ...(hasItemSalePrice ? ['sale_price'] : []),
    ];
    const insertItem = this.db.prepare(
      `INSERT INTO purchase_order_items (${itemCols.join(', ')}) VALUES (${itemCols.map(() => '?').join(', ')})`
    );
    const deleteItem = this.db.prepare(`DELETE FROM purchase_order_items WHERE id = ?`);

    for (const item of items) {
      const { orderedQty, unitUzs, lineUzs, unitUsd, lineUsd } = this._normalizePoLineAmounts(
        item,
        isUSD,
        fxRate
      );

      const product = this.db.prepare('SELECT id, sku, name FROM products WHERE id = ?').get(item.product_id);
      if (!product) {
        throw createError(ERROR_CODES.NOT_FOUND, `Product ${item.product_id} not found`);
      }

      const rowId = item.id && byId.has(item.id) ? item.id : null;
      if (rowId) {
        const dbRow = byId.get(rowId);
        const uargs = [
          item.product_id,
          item.product_name || product.name,
          ...(hasItemSku ? [item.product_sku ?? dbRow.product_sku ?? product.sku ?? ''] : []),
          orderedQty,
          unitUzs,
          lineUzs,
          ...(hasItemUsd ? [unitUsd, lineUsd] : []),
          ...(hasItemDiscountPercent ? [Number(item.discount_percent ?? 0) || 0] : []),
          ...(hasItemDiscountAmount ? [Number(item.discount_amount ?? 0) || 0] : []),
          ...(hasItemSalePrice ? [Number(item.sale_price ?? 0) > 0 ? Number(item.sale_price) : null] : []),
          rowId,
          purchaseOrderId,
        ];
        updateItem.run(...uargs);
        keptIds.add(rowId);
        continue;
      }

      const params = [
        randomUUID(),
        purchaseOrderId,
        item.product_id,
        item.product_name || product.name,
        ...(hasItemSku ? [item.product_sku || product.sku || ''] : []),
        orderedQty,
        0,
        unitUzs,
        lineUzs,
        ...(hasItemUsd ? [unitUsd, lineUsd] : []),
        ...(hasItemDiscountPercent ? [Number(item.discount_percent ?? 0) || 0] : []),
        ...(hasItemDiscountAmount ? [Number(item.discount_amount ?? 0) || 0] : []),
        ...(hasItemSalePrice ? [Number(item.sale_price ?? 0) > 0 ? Number(item.sale_price) : null] : []),
      ];
      insertItem.run(...params);
    }

    for (const row of dbRows) {
      if (keptIds.has(row.id)) continue;
      const rq = Number(row.received_qty || 0);
      if (rq > 0) {
        throw createError(
          ERROR_CODES.VALIDATION_ERROR,
          `Qabul qilingan mahsulotni o'chirib bo'lmaydi: ${row.product_name || row.product_id}. Omborga kirgan tovar uchun qaytarish amalidan foydalaning.`
        );
      }
      deleteItem.run(row.id);
    }
  }

  /**
   * Per product: ordered qty must not fall below already received (aggregated).
   * Used only on receive/confirm — draft edits may temporarily set ordered below received.
   */
  _assertOrderQtyCoversReceived(purchaseOrderId) {
    const rows =
      this.db
        .prepare(
          `
        SELECT product_id, product_name,
               COALESCE(SUM(ordered_qty), 0) AS ordered,
               COALESCE(SUM(received_qty), 0) AS received
        FROM purchase_order_items
        WHERE purchase_order_id = ?
        GROUP BY product_id
      `
        )
        .all(purchaseOrderId) || [];

    const bad = [];
    for (const row of rows) {
      const ordered = Number(row.ordered || 0);
      const received = Number(row.received || 0);
      if (received > 0 && ordered < received - 1e-9) {
        bad.push(String(row.product_name || row.product_id || ''));
      }
    }
    if (bad.length) {
      throw createError(
        ERROR_CODES.VALIDATION_ERROR,
        `Har bir mahsulot bo'yicha jami buyurtma miqdori qabul qilingan miqdordan kam bo'lmasligi kerak: ${bad.join(', ')}`
      );
    }
  }

  /**
   * Update PO line items when some goods were already received: match rows by product_id (FIFO),
   * preserve received_qty and row ids; delete unreceived omitted lines; reject omitting received lines.
   */
  _mergePurchaseOrderItemsKeepReceipts(purchaseOrderId, items, ctx) {
    const {
      isUSD,
      fxRate,
      hasItemSku,
      hasItemUsd,
      hasItemDiscountPercent,
      hasItemDiscountAmount,
      hasItemSalePrice,
    } = ctx;

    const dbRows =
      this.db
        .prepare(
          `
        SELECT * FROM purchase_order_items
        WHERE purchase_order_id = ?
        ORDER BY id
      `
        )
        .all(purchaseOrderId) || [];

    const queues = new Map();
    for (const row of dbRows) {
      const pid = row.product_id;
      if (!queues.has(pid)) queues.set(pid, []);
      queues.get(pid).push(row);
    }

    const updatedIds = new Set();
    const deleteItem = this.db.prepare(`DELETE FROM purchase_order_items WHERE id = ?`);

    const updateSets = [
      'product_name = ?',
      ...(hasItemSku ? ['product_sku = ?'] : []),
      'ordered_qty = ?',
      'unit_cost = ?',
      'line_total = ?',
      ...(hasItemUsd ? ['unit_cost_usd = ?', 'line_total_usd = ?'] : []),
      ...(hasItemDiscountPercent ? ['discount_percent = ?'] : []),
      ...(hasItemDiscountAmount ? ['discount_amount = ?'] : []),
      ...(hasItemSalePrice ? ['sale_price = ?'] : []),
    ];
    const updateItem = this.db.prepare(
      `UPDATE purchase_order_items SET ${updateSets.join(', ')} WHERE id = ? AND purchase_order_id = ?`
    );

    const itemCols = [
      'id',
      'purchase_order_id',
      'product_id',
      'product_name',
      ...(hasItemSku ? ['product_sku'] : []),
      'ordered_qty',
      'received_qty',
      'unit_cost',
      'line_total',
      ...(hasItemUsd ? ['unit_cost_usd', 'line_total_usd'] : []),
      ...(hasItemDiscountPercent ? ['discount_percent'] : []),
      ...(hasItemDiscountAmount ? ['discount_amount'] : []),
      ...(hasItemSalePrice ? ['sale_price'] : []),
    ];
    const insertItem = this.db.prepare(
      `INSERT INTO purchase_order_items (${itemCols.join(', ')}) VALUES (${itemCols.map(() => '?').join(', ')})`
    );

    for (const item of items) {
      const { orderedQty, unitUzs, lineUzs, unitUsd, lineUsd } = this._normalizePoLineAmounts(
        item,
        isUSD,
        fxRate
      );

      const pid = item.product_id;
      let dbRow = null;

      if (item.id) {
        const direct = dbRows.find((r) => r.id === item.id);
        if (direct) {
          dbRow = direct;
          const queue = queues.get(direct.product_id);
          if (queue) {
            const qIdx = queue.findIndex((r) => r.id === direct.id);
            if (qIdx >= 0) queue.splice(qIdx, 1);
          }
        }
      }

      if (!dbRow) {
        const queue = queues.get(pid);
        dbRow = queue && queue.length ? queue.shift() : null;
      }

      if (dbRow) {
        const uargs = [
          item.product_name || dbRow.product_name,
          ...(hasItemSku ? [item.product_sku ?? dbRow.product_sku ?? null] : []),
          orderedQty,
          unitUzs,
          lineUzs,
          ...(hasItemUsd ? [unitUsd, lineUsd] : []),
          ...(hasItemDiscountPercent ? [Number(item.discount_percent ?? 0) || 0] : []),
          ...(hasItemDiscountAmount ? [Number(item.discount_amount ?? 0) || 0] : []),
          ...(hasItemSalePrice ? [Number(item.sale_price ?? 0) > 0 ? Number(item.sale_price) : null] : []),
          dbRow.id,
          purchaseOrderId,
        ];
        updateItem.run(...uargs);
        updatedIds.add(dbRow.id);
      } else {
        const product = this.db.prepare('SELECT id, sku, name FROM products WHERE id = ?').get(pid);
        if (!product) {
          throw createError(ERROR_CODES.NOT_FOUND, `Product ${pid} not found`);
        }
        const params = [
          randomUUID(),
          purchaseOrderId,
          pid,
          item.product_name || product.name,
          ...(hasItemSku ? [item.product_sku || product.sku || ''] : []),
          orderedQty,
          0,
          unitUzs,
          lineUzs,
          ...(hasItemUsd ? [unitUsd, lineUsd] : []),
          ...(hasItemDiscountPercent ? [Number(item.discount_percent ?? 0) || 0] : []),
          ...(hasItemDiscountAmount ? [Number(item.discount_amount ?? 0) || 0] : []),
          ...(hasItemSalePrice ? [Number(item.sale_price ?? 0) > 0 ? Number(item.sale_price) : null] : []),
        ];
        insertItem.run(...params);
      }
    }

    for (const row of dbRows) {
      if (updatedIds.has(row.id)) continue;
      const rq = Number(row.received_qty || 0);
      if (rq > 0) {
        throw createError(
          ERROR_CODES.VALIDATION_ERROR,
          `Qabul qilingan mahsulotni o'chirib bo'lmaydi: ${row.product_name || row.product_id}. Omborga kirgan tovar uchun qaytarish amalidan foydalaning.`
        );
      }
      deleteItem.run(row.id);
    }
  }

  /**
   * Update purchase order header and/or line items.
   * Blocked only for cancelled. Line items: full replace when nothing received yet;
   * merge (preserve received_qty per row) when any goods were received — including fully received POs.
   * Omitting a line with received_qty > 0 is rejected (stock already posted).
   */
  updateOrder(purchaseOrderId, data, items) {
    if (!purchaseOrderId) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Purchase order ID is required');
    }

    const po = this.db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(purchaseOrderId);
    if (!po) {
      throw createError(ERROR_CODES.NOT_FOUND, `Purchase order ${purchaseOrderId} not found`);
    }

    if (po.status === 'cancelled') {
      throw createError(ERROR_CODES.VALIDATION_ERROR, `Cannot update purchase order with status '${po.status}'`);
    }
    if (String(po.status || '').toLowerCase() === 'closed' && !data?.via_cost_correction) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Closed purchase orders are not editable');
    }

    const lineItems = this._resolveLineItems(data, items);
    const headerData = data && typeof data === 'object' ? { ...data } : null;
    if (headerData && 'items' in headerData) delete headerData.items;

    const existingItems = this.db.prepare(`
      SELECT COALESCE(SUM(received_qty), 0) as total_received
      FROM purchase_order_items
      WHERE purchase_order_id = ?
    `).get(purchaseOrderId);

    const totalReceived = Number(existingItems?.total_received || 0);

    // P1: received/partially received — cost changes only via correction document
    const receivedLocked = ['received', 'partially_received'].includes(
      String(po.status || '').toLowerCase(),
    );
    if (receivedLocked && lineItems && !data?.via_cost_correction) {
      const dbItems =
        this.db
          .prepare(
            `SELECT id, product_id, unit_cost, unit_cost_usd FROM purchase_order_items WHERE purchase_order_id = ?`,
          )
          .all(purchaseOrderId) || [];
      const byId = new Map(dbItems.map((r) => [r.id, r]));
      for (const it of lineItems) {
        const prev = it.id ? byId.get(it.id) : null;
        if (!prev) continue;
        const newCost = Number(it.unit_cost ?? prev.unit_cost);
        const oldCost = Number(prev.unit_cost ?? 0);
        if (Math.abs(newCost - oldCost) > moneyTolerance('UZS')) {
          throw createError(
            ERROR_CODES.VALIDATION_ERROR,
            'Received order costs cannot be edited directly — create a cost correction document',
          );
        }
        if (it.unit_cost_usd != null && prev.unit_cost_usd != null) {
          if (Math.abs(Number(it.unit_cost_usd) - Number(prev.unit_cost_usd)) > moneyTolerance('USD')) {
            throw createError(
              ERROR_CODES.VALIDATION_ERROR,
              'Received order USD costs cannot be edited directly — create a cost correction document',
            );
          }
        }
      }
    }

    if (lineItems && (!Array.isArray(lineItems) || lineItems.length === 0)) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Purchase order must have at least one item');
    }

    const now = new Date().toISOString().replace('T', ' ').replace('Z', '').substring(0, 19);

    const transaction = this.db.transaction(() => {
      const hasCurrency = this._hasPOCol('currency');
      const hasFxRate = this._hasPOCol('fx_rate');
      const hasTotalUsd = this._hasPOCol('total_usd');
      const hasItemUsd = this._hasPOItemCol('unit_cost_usd') && this._hasPOItemCol('line_total_usd');
      const hasItemSku = this._hasPOItemCol('product_sku');
      const hasItemDiscountPercent = this._hasPOItemCol('discount_percent');
      const hasItemDiscountAmount = this._hasPOItemCol('discount_amount');
      const hasItemSalePrice = this._hasPOItemCol('sale_price');

      const nextCurrency = hasCurrency ? String((headerData && headerData.currency) || po.currency || 'UZS').toUpperCase() : 'UZS';
      const isUSD = nextCurrency === 'USD';
      const fxRate = isUSD ? Number((headerData && headerData.fx_rate) ?? po.fx_rate) : null;

      const supplierIdForCheck = (headerData && headerData.supplier_id) || po.supplier_id;
      if (supplierIdForCheck && hasCurrency && this._cols('suppliers').has('settlement_currency')) {
        const supplierRow = this.db
          .prepare('SELECT settlement_currency FROM suppliers WHERE id = ?')
          .get(supplierIdForCheck);
        const settlement = String(supplierRow?.settlement_currency || 'UZS').toUpperCase();
        if (settlement === 'USD' && nextCurrency !== 'USD') {
          throw createError(
            ERROR_CODES.VALIDATION_ERROR,
            'USD supplier requires purchase order in USD currency'
          );
        }
      }

      if (isUSD) {
        if (!hasCurrency || !hasFxRate || !hasTotalUsd || !hasItemUsd) {
          throw createError(ERROR_CODES.DB_ERROR, 'USD purchase columns missing (apply latest migrations and restart app)');
        }
        if (!Number.isFinite(fxRate) || fxRate <= 0) {
          throw createError(ERROR_CODES.VALIDATION_ERROR, 'fx_rate is required for USD purchase (UZS per 1 USD)');
        }
      }

      const itemCtx = {
        isUSD,
        fxRate,
        hasItemSku,
        hasItemUsd,
        hasItemDiscountPercent,
        hasItemDiscountAmount,
        hasItemSalePrice,
      };

      // Update header
      if (headerData) {
        // Recalculate totals from items if provided
        const sourceItemsRaw = Array.isArray(lineItems)
          ? lineItems
          : this.db.prepare('SELECT * FROM purchase_order_items WHERE purchase_order_id = ?').all(purchaseOrderId);

        const sourceItems = sourceItemsRaw.map((it) => {
          const orderedQty = Number(it.ordered_qty);
          if (!Number.isFinite(orderedQty) || orderedQty <= 0) {
            throw createError(ERROR_CODES.VALIDATION_ERROR, 'ordered_qty must be > 0');
          }
          if (isUSD) {
            const hasExplicitUsd =
              (it.unit_cost_usd != null && it.unit_cost_usd !== '') ||
              (it.unit_price_usd != null && it.unit_price_usd !== '');
            if (!hasExplicitUsd && hasItemUsd) {
              throw createError(
                ERROR_CODES.VALIDATION_ERROR,
                'USD xarid uchun unit_cost_usd majburiy (UZS unit_cost ni dollar deb ko‘paytirib bo‘lmaydi)',
              );
            }
            const unitUsd = Number(
              hasExplicitUsd ? (it.unit_cost_usd ?? it.unit_price_usd) : it.unit_cost,
            );
            if (!Number.isFinite(unitUsd) || unitUsd < 0) {
              throw createError(ERROR_CODES.VALIDATION_ERROR, 'unit_cost_usd must be >= 0 for USD purchase');
            }
            const lineUsd = Number.isFinite(Number(it.line_total_usd)) ? Number(it.line_total_usd) : orderedQty * unitUsd;
            const unitUzs = unitUsd * fxRate;
            const lineUzs = orderedQty * unitUzs;
            return { ...it, unit_cost_usd: unitUsd, line_total_usd: lineUsd, unit_cost: unitUzs, line_total: lineUzs };
          }
          const unitUzs = Number(it.unit_cost);
          const lineUzs = Number.isFinite(Number(it.line_total)) ? Number(it.line_total) : orderedQty * unitUzs;
          return { ...it, unit_cost: unitUzs, line_total: lineUzs };
        });

        const subtotal = sourceItems.reduce((sum, it) => sum + (Number(it.line_total) || 0), 0);
        const discount = Number(headerData.discount || 0);
        const tax = Number(headerData.tax || 0);
        const totalAmount = subtotal - discount + tax;
        const totalUsd = isUSD
          ? Math.max(
              0,
              sourceItems.reduce((sum, it) => sum + (Number(it.line_total_usd) || 0), 0) -
                (Number(discount || 0) / Number(fxRate || 1))
            )
          : null;

        this._validateStatusTransition(po.status, headerData.status, totalReceived);

        const sets = [
          'supplier_id = COALESCE(?, supplier_id)',
          'supplier_name = COALESCE(?, supplier_name)',
          'order_date = COALESCE(?, order_date)',
          'expected_date = ?',
          'reference = ?',
          'subtotal = ?',
          'discount = ?',
          'tax = ?',
          'total_amount = ?',
          'status = COALESCE(?, status)',
          'invoice_number = ?',
          'notes = ?',
          'updated_at = ?',
        ];
        const params = [
          headerData.supplier_id ?? null,
          headerData.supplier_name ?? null,
          headerData.order_date ?? null,
          headerData.expected_date ?? null,
          headerData.reference ?? null,
          subtotal,
          discount,
          tax,
          totalAmount,
          headerData.status ?? null,
          headerData.invoice_number ?? null,
          headerData.notes ?? null,
          now,
        ];

        if (hasCurrency) {
          sets.push('currency = ?');
          params.push(nextCurrency);
        }
        if (hasFxRate) {
          sets.push('fx_rate = ?');
          params.push(isUSD ? fxRate : null);
        }
        if (hasTotalUsd) {
          sets.push('total_usd = ?');
          params.push(isUSD ? totalUsd : null);
        }
        params.push(purchaseOrderId);

        const initialPaid =
          headerData.initial_payment != null
            ? Number(
                isUSD
                  ? headerData.initial_payment.amount_usd ?? headerData.initial_payment.amount ?? 0
                  : headerData.initial_payment.amount ?? 0
              ) || 0
            : 0;
        if (
          headerData.payment_scheme != null ||
          headerData.payment_due_date != null ||
          headerData.payment_schedule != null
        ) {
          this._validatePaymentSchemeInput({
            scheme: headerData.payment_scheme ?? po.payment_scheme,
            poCurrency: nextCurrency,
            totalAmount,
            totalUsd,
            paymentDueDate: headerData.payment_due_date ?? po.payment_due_date,
            paymentSchedule: headerData.payment_schedule,
            initialPaymentAmount: initialPaid,
          });
        }

        this.db.prepare(`
          UPDATE purchase_orders
          SET ${sets.join(', ')}
          WHERE id = ?
        `).run(...params);

        if (
          headerData.payment_scheme != null ||
          headerData.payment_due_date != null ||
          headerData.payment_schedule != null
        ) {
          this._savePaymentScheme(purchaseOrderId, {
            scheme: headerData.payment_scheme ?? po.payment_scheme,
            payment_due_date: headerData.payment_due_date,
            payment_schedule: headerData.payment_schedule,
          });
        }
      }

      // Replace or merge line items
      if (Array.isArray(lineItems)) {
        if (totalReceived > 0) {
          this._mergePurchaseOrderItemsKeepReceipts(purchaseOrderId, lineItems, itemCtx);
        } else {
          this._replacePurchaseOrderItems(purchaseOrderId, lineItems, itemCtx);
        }

        this._finalizePurchaseOrderStatus(purchaseOrderId, po, headerData, now);
        this._syncProductCatalogFromReceivedPoLines(purchaseOrderId, now);
        this._syncOpenBatchCostsFromPoLines(purchaseOrderId, now);
      }

      if (headerData && headerData.initial_payment) {
        const supplierId = headerData.supplier_id ?? po.supplier_id;
        if (!supplierId) {
          throw createError(ERROR_CODES.VALIDATION_ERROR, 'Supplier is required for payment');
        }
        const header = this.db.prepare('SELECT total_amount, total_usd, currency FROM purchase_orders WHERE id = ?').get(purchaseOrderId);
        this._insertSupplierPaymentForPo({
          purchaseOrderId,
          supplierId,
          payment: headerData.initial_payment,
          poCurrency: header?.currency || po.currency,
          totalAmountUzs: Number(header?.total_amount ?? 0),
          totalAmountUsd: header?.total_usd != null ? Number(header.total_usd) : null,
        });
      }
    });

    transaction();
    return this.get(purchaseOrderId);
  }

  /**
   * Create purchase receipt (goods receipt)
   * - If purchase_order_id provided, updates PO received quantities and status
   * - Inventory updates ONLY when status === 'received'
   */
  createReceipt(data) {
    const statusInput = String(data?.status || 'received').toLowerCase();
    const status = statusInput === 'draft' ? 'draft' : 'received';

    // Draft may be empty and must not affect stock/finance.
    if (status === 'draft') {
      if (!data) data = { items: [] };
      if (!Array.isArray(data.items)) data.items = [];
    } else {
      if (!data || !Array.isArray(data.items) || data.items.length === 0) {
        throw createError(ERROR_CODES.VALIDATION_ERROR, 'Receipt must have at least one item');
      }
    }

    const idempotencyKey = String(data.idempotency_key || data.idempotencyKey || '').trim() || null;
    if (idempotencyKey) {
      try {
        const existing = this.db
          .prepare(`SELECT * FROM purchase_receipts WHERE idempotency_key = ? LIMIT 1`)
          .get(idempotencyKey);
        if (existing) {
          return {
            ...existing,
            items:
              this.db
                .prepare(`SELECT * FROM purchase_receipt_items WHERE receipt_id = ?`)
                .all(existing.id) || [],
            idempotent_replay: true,
          };
        }
      } catch {
        // column may not exist yet
      }
    }

    const receiptId = randomUUID();
    const receiptNumber = `GR-${Date.now()}`;
    const now = new Date().toISOString().replace('T', ' ').replace('Z', '').substring(0, 19);

    const purchaseOrderId = data.purchase_order_id || null;
    let po = null;
    if (purchaseOrderId) {
      po = this.db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(purchaseOrderId);
      if (!po) {
        throw createError(ERROR_CODES.NOT_FOUND, `Purchase order ${purchaseOrderId} not found`);
      }
      if (po.status === 'cancelled' || po.status === 'closed') {
        throw createError(
          ERROR_CODES.VALIDATION_ERROR,
          `Cannot receive a ${po.status} purchase order`,
        );
      }
    }

    const supplierId = data.supplier_id || po?.supplier_id || null;
    const supplier =
      supplierId ? this.db.prepare('SELECT settlement_currency, name FROM suppliers WHERE id = ?').get(supplierId) : null;
    const settlementCurrency = String(supplier?.settlement_currency || 'UZS').toUpperCase() === 'USD' ? 'USD' : 'UZS';
    const warehouseId = data.warehouse_id || 'main-warehouse-001';

    // Currency early for confirm validation
    const currencyRaw = data.currency ?? po?.currency ?? 'UZS';
    const currencyEarly = String(currencyRaw).toUpperCase() === 'USD' ? 'USD' : 'UZS';

    if (status === 'received') {
      const v = validateConfirmReceiveInput({
        supplier_id: supplierId,
        items: data.items,
        received_at: data.received_at || now,
        currency: currencyEarly,
        receive_type: data.receive_type,
        zero_cost_reason: data.zero_cost_reason,
        zero_cost_approved_by: data.zero_cost_approved_by,
      });
      if (!v.ok) {
        throw createError(ERROR_CODES.VALIDATION_ERROR, v.errors.join('; '));
      }
      if (v.allowZeroCost) {
        const role = this._primaryPurchaseRole(data.zero_cost_approved_by || data.created_by);
        if (!canApproveZeroCostReceive(role)) {
          throw createError(
            ERROR_CODES.FORBIDDEN,
            'Zero-cost receive requires manager/admin approval',
          );
        }
      }
    }

    const hasReceiptTable = this.db
      .prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='purchase_receipts'`)
      .get();
    if (!hasReceiptTable) {
      throw createError(ERROR_CODES.DB_ERROR, 'purchase_receipts table is missing (migration not applied)');
    }

    const receiptCols = this.db.prepare(`PRAGMA table_info(purchase_receipts)`).all().map((c) => c.name);
    const itemCols = this.db.prepare(`PRAGMA table_info(purchase_receipt_items)`).all().map((c) => c.name);
    const hasReceiptCol = (col) => receiptCols.includes(col);
    const hasItemCol = (col) => itemCols.includes(col);

    const receiptInsertCols = [];
    if (hasReceiptCol('id')) receiptInsertCols.push('id');
    if (hasReceiptCol('receipt_number')) receiptInsertCols.push('receipt_number');
    if (hasReceiptCol('purchase_order_id')) receiptInsertCols.push('purchase_order_id');
    if (hasReceiptCol('supplier_id')) receiptInsertCols.push('supplier_id');
    if (hasReceiptCol('warehouse_id')) receiptInsertCols.push('warehouse_id');
    if (hasReceiptCol('status')) receiptInsertCols.push('status');
    if (hasReceiptCol('currency')) receiptInsertCols.push('currency');
    if (hasReceiptCol('exchange_rate')) receiptInsertCols.push('exchange_rate');
    if (hasReceiptCol('total_usd')) receiptInsertCols.push('total_usd');
    if (hasReceiptCol('total_uzs')) receiptInsertCols.push('total_uzs');
    if (hasReceiptCol('invoice_number')) receiptInsertCols.push('invoice_number');
    if (hasReceiptCol('received_at')) receiptInsertCols.push('received_at');
    if (hasReceiptCol('notes')) receiptInsertCols.push('notes');
    if (hasReceiptCol('created_by')) receiptInsertCols.push('created_by');
    if (hasReceiptCol('created_at')) receiptInsertCols.push('created_at');
    if (hasReceiptCol('updated_at')) receiptInsertCols.push('updated_at');
    if (hasReceiptCol('receive_type')) receiptInsertCols.push('receive_type');
    if (hasReceiptCol('zero_cost_reason')) receiptInsertCols.push('zero_cost_reason');
    if (hasReceiptCol('zero_cost_approved_by')) receiptInsertCols.push('zero_cost_approved_by');
    if (hasReceiptCol('idempotency_key')) receiptInsertCols.push('idempotency_key');

    const insertReceipt = this.db.prepare(
      `
      INSERT INTO purchase_receipts (
        ${receiptInsertCols.join(', ')}
      ) VALUES (${receiptInsertCols.map(() => '?').join(', ')})
    `
    );

    const itemInsertCols = [];
    if (hasItemCol('id')) itemInsertCols.push('id');
    if (hasItemCol('receipt_id')) itemInsertCols.push('receipt_id');
    if (hasItemCol('purchase_order_item_id')) itemInsertCols.push('purchase_order_item_id');
    if (hasItemCol('product_id')) itemInsertCols.push('product_id');
    if (hasItemCol('product_name')) itemInsertCols.push('product_name');
    if (hasItemCol('received_qty')) itemInsertCols.push('received_qty');
    if (hasItemCol('unit_cost')) itemInsertCols.push('unit_cost');
    if (hasItemCol('line_total')) itemInsertCols.push('line_total');
    if (hasItemCol('unit_cost_usd')) itemInsertCols.push('unit_cost_usd');
    if (hasItemCol('line_total_usd')) itemInsertCols.push('line_total_usd');
    if (hasItemCol('exchange_rate')) itemInsertCols.push('exchange_rate');
    if (hasItemCol('created_at')) itemInsertCols.push('created_at');

    const insertItem = this.db.prepare(
      `
      INSERT INTO purchase_receipt_items (
        ${itemInsertCols.join(', ')}
      ) VALUES (${itemInsertCols.map(() => '?').join(', ')})
    `
    );

    const transaction = this.db.transaction(() => {
      if (purchaseOrderId && status === 'received') {
        this._assertOrderQtyCoversReceived(purchaseOrderId);
      }

      // Currency rules: USD suppliers must use USD receipts with exchange rate.
      // Default UZS (local inventory currency) — never assume USD when omitted
      // (UZS unit_cost × fx_rate was a common ~70M+ phantom COGS source).
      const currencyRaw = data.currency ?? po?.currency ?? 'UZS';
      const currency = String(currencyRaw).toUpperCase() === 'USD' ? 'USD' : 'UZS';
      if (settlementCurrency === 'USD' && currency !== 'USD') {
        throw createError(ERROR_CODES.VALIDATION_ERROR, 'USD supplier receipt must be in USD');
      }
      const exchangeRate = currency === 'USD' ? Number(data.exchange_rate ?? po?.fx_rate) : null;
      if (currency === 'USD' && (!Number.isFinite(exchangeRate) || exchangeRate <= 0)) {
        throw createError(ERROR_CODES.VALIDATION_ERROR, 'exchange_rate is required for USD receipt');
      }

      let totalUsd = 0;
      let totalUzs = 0;

      const receiptValues = [];
      if (hasReceiptCol('id')) receiptValues.push(receiptId);
      if (hasReceiptCol('receipt_number')) receiptValues.push(receiptNumber);
      if (hasReceiptCol('purchase_order_id')) receiptValues.push(purchaseOrderId);
      if (hasReceiptCol('supplier_id')) receiptValues.push(supplierId);
      if (hasReceiptCol('warehouse_id')) receiptValues.push(warehouseId);
      if (hasReceiptCol('status')) receiptValues.push(status);
      if (hasReceiptCol('currency')) receiptValues.push(currency);
      if (hasReceiptCol('exchange_rate')) receiptValues.push(exchangeRate);
      if (hasReceiptCol('total_usd')) receiptValues.push(null);
      if (hasReceiptCol('total_uzs')) receiptValues.push(null);
      if (hasReceiptCol('invoice_number')) receiptValues.push(data.invoice_number || null);
      if (hasReceiptCol('received_at')) receiptValues.push(data.received_at || now);
      if (hasReceiptCol('notes')) receiptValues.push(data.notes || null);
      if (hasReceiptCol('created_by')) receiptValues.push(data.created_by || null);
      if (hasReceiptCol('created_at')) receiptValues.push(now);
      if (hasReceiptCol('updated_at')) receiptValues.push(now);
      if (hasReceiptCol('receive_type')) {
        receiptValues.push(String(data.receive_type || 'standard').toLowerCase());
      }
      if (hasReceiptCol('zero_cost_reason')) receiptValues.push(data.zero_cost_reason || null);
      if (hasReceiptCol('zero_cost_approved_by')) {
        receiptValues.push(data.zero_cost_approved_by || null);
      }
      if (hasReceiptCol('idempotency_key')) receiptValues.push(idempotencyKey);

      insertReceipt.run(...receiptValues);

      const landedByPoiId = purchaseOrderId ? this._buildLandedCostByPoiId(purchaseOrderId) : new Map();

      for (const item of data.items) {
        const qty = Number(item.received_qty || 0);
        if (!Number.isFinite(qty) || qty <= 0) {
          if (status === 'draft') continue;
          throw createError(ERROR_CODES.VALIDATION_ERROR, 'received_qty must be > 0');
        }
        const poiId = item.purchase_order_item_id || null;

        // Atomic anti-over-receive: receivable = ordered − alreadyReceived
        if (status === 'received' && purchaseOrderId && poiId) {
          const poi = this.db
            .prepare(
              `SELECT ordered_qty, received_qty FROM purchase_order_items WHERE id = ? AND purchase_order_id = ?`,
            )
            .get(poiId, purchaseOrderId);
          if (!poi) {
            throw createError(ERROR_CODES.NOT_FOUND, `PO item not found: ${poiId}`);
          }
          const receivable = computeReceivableQty(poi.ordered_qty, poi.received_qty, 0);
          const gate = assertReceivableAllows(qty, receivable, { code: 'CONFLICT' });
          if (!gate.ok) {
            throw createError(ERROR_CODES.CONFLICT, gate.error, { available: gate.available });
          }
        }

        const landedUnitFromPo = poiId ? Number(landedByPoiId.get(poiId)) : NaN;
        const hasLanded = Number.isFinite(landedUnitFromPo) && landedUnitFromPo >= 0;

        // USD receipts: never treat item.unit_cost as USD (it is often already UZS).
        // Prefer explicit unit_cost_usd; else derive USD from landed/UZS ÷ fx.
        let unitUsd = null;
        if (currency === 'USD') {
          if (hasLanded && Number(exchangeRate) > 0) {
            unitUsd = landedUnitFromPo / Number(exchangeRate);
          } else if (item.unit_cost_usd != null && item.unit_cost_usd !== '') {
            unitUsd = Number(item.unit_cost_usd);
          } else if (item.unit_cost != null && item.unit_cost !== '' && Number(exchangeRate) > 0) {
            // unit_cost alone on a USD receipt = inventory UZS amount, not dollars
            unitUsd = Number(item.unit_cost) / Number(exchangeRate);
          }
          if (!Number.isFinite(unitUsd) || unitUsd < 0) {
            throw createError(ERROR_CODES.VALIDATION_ERROR, 'unit_cost_usd must be >= 0 for USD receipt');
          }
        }

        const unitCost = hasLanded
          ? landedUnitFromPo
          : (currency === 'USD' ? Number(unitUsd || 0) * Number(exchangeRate || 0) : Number(item.unit_cost || 0) || 0);
        const lineTotal = qty * unitCost;
        const lineUsd = currency === 'USD' ? qty * Number(unitUsd || 0) : null;
        totalUzs += Number(lineTotal || 0);
        if (currency === 'USD') totalUsd += Number(lineUsd || 0);

        const receiptItemId = randomUUID();
        const itemValues = [];
        if (hasItemCol('id')) itemValues.push(receiptItemId);
        if (hasItemCol('receipt_id')) itemValues.push(receiptId);
        if (hasItemCol('purchase_order_item_id')) itemValues.push(item.purchase_order_item_id || null);
        if (hasItemCol('product_id')) itemValues.push(item.product_id);
        if (hasItemCol('product_name')) itemValues.push(item.product_name || null);
        if (hasItemCol('received_qty')) itemValues.push(qty);
        if (hasItemCol('unit_cost')) itemValues.push(unitCost);
        if (hasItemCol('line_total')) itemValues.push(lineTotal);
        if (hasItemCol('unit_cost_usd'))
          itemValues.push(currency === 'USD' ? Number(unitUsd || 0) : (item.unit_cost_usd ?? null));
        if (hasItemCol('line_total_usd'))
          itemValues.push(currency === 'USD' ? Number(lineUsd || 0) : (item.line_total_usd ?? null));
        if (hasItemCol('exchange_rate')) itemValues.push(exchangeRate);
        if (hasItemCol('created_at')) itemValues.push(now);

        insertItem.run(...itemValues);

        if (purchaseOrderId && item.purchase_order_item_id) {
          // Update PO item cost snapshot to actual receipt cost.
          // For USD receipts, keep BOTH UZS and USD columns in sync so
          // next partial receipt does not treat UZS value as USD.
          const poiHasUsdCols = this._hasPOItemCol('unit_cost_usd') && this._hasPOItemCol('line_total_usd');
          if (currency === 'USD' && poiHasUsdCols) {
            this.db.prepare(
              `
              UPDATE purchase_order_items
              SET unit_cost = ?, line_total = ?, unit_cost_usd = ?, line_total_usd = ?
              WHERE id = ? AND purchase_order_id = ?
            `
            ).run(
              unitCost,
              lineTotal,
              Number(unitUsd || 0),
              Number(lineUsd || 0),
              item.purchase_order_item_id,
              purchaseOrderId
            );
          } else {
            this.db.prepare(
              `
              UPDATE purchase_order_items
              SET unit_cost = ?, line_total = ?
              WHERE id = ? AND purchase_order_id = ?
            `
            ).run(unitCost, lineTotal, item.purchase_order_item_id, purchaseOrderId);
          }
        }

        if (status === 'received') {
          // Update received qty on PO items if linked
          if (purchaseOrderId && item.purchase_order_item_id) {
            this.db
              .prepare(
                `
                UPDATE purchase_order_items
                SET received_qty = received_qty + ?
                WHERE id = ? AND purchase_order_id = ?
              `
              )
              .run(qty, item.purchase_order_item_id, purchaseOrderId);
          }

          // Update product cost price to latest receipt cost (skip zero — keep catalog empty/prior)
          try {
            if (Number.isFinite(unitCost) && unitCost > 0) {
              this.db.prepare(
                `
                UPDATE products
                SET purchase_price = ?, updated_at = ?
                WHERE id = ?
              `
              ).run(unitCost, now, item.product_id);
              // Invalidate product cache so UI shows updated purchase_price
              if (this.cacheService?.invalidateProduct) {
                this.cacheService.invalidateProduct(item.product_id);
              }
            }
          } catch (error) {
            console.warn('[PurchaseService.createReceipt] Failed to update product purchase_price:', error.message);
          }

          // Update product sale_price from PO item if set (sotish narxi)
          const shouldUpdateSale =
            data.update_product_sale_prices !== false &&
            purchaseOrderId &&
            item.purchase_order_item_id;
          if (shouldUpdateSale) {
            try {
              const poi = this.db.prepare(
                'SELECT sale_price FROM purchase_order_items WHERE id = ? AND purchase_order_id = ?'
              ).get(item.purchase_order_item_id, purchaseOrderId);
              const salePrice = Number(poi?.sale_price ?? 0);
              if (Number.isFinite(salePrice) && salePrice > 0) {
                this.db.prepare(
                  'UPDATE products SET sale_price = ?, updated_at = ? WHERE id = ?'
                ).run(salePrice, now, item.product_id);
                // Also update default product_unit so product card displays correctly
                try {
                  const hasProductUnits = this.db.prepare(
                    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='product_units'"
                  ).get();
                  if (hasProductUnits) {
                    const puRes = this.db.prepare(
                      'UPDATE product_units SET sale_price = ? WHERE product_id = ? AND is_default = 1'
                    ).run(salePrice, item.product_id);
                    if (puRes.changes === 0) {
                      const first = this.db.prepare(
                        'SELECT id FROM product_units WHERE product_id = ? ORDER BY is_default DESC, unit ASC LIMIT 1'
                      ).get(item.product_id);
                      if (first) {
                        this.db.prepare('UPDATE product_units SET sale_price = ? WHERE id = ?').run(salePrice, first.id);
                      }
                    }
                  }
                } catch (puErr) {
                  console.warn('[PurchaseService.createReceipt] Failed to update product_units sale_price:', puErr?.message);
                }
                this._afterProductCatalogPriceChange(item.product_id);
              }
            } catch (err) {
              console.warn('[PurchaseService.createReceipt] Failed to update product sale_price:', err?.message);
            }
          }

          if (this.inventoryService) {
            this.inventoryService._updateBalance(
              item.product_id,
              warehouseId,
              qty,
              'purchase',
              'purchase_receipt',
              receiptId,
              `Received via receipt ${receiptNumber}`,
              data.received_by || null
            );
          }

          // Batch mode: create batch from receipt item (receipt-only source of truth)
          const batchActive = !!this.batchService?.shouldEnforceAt?.(now);
          if (batchActive && this.batchService) {
            this.batchService.createBatchFromReceipt({
              receiptId,
              receiptItemId,
              productId: item.product_id,
              warehouseId,
              quantity: qty,
              unitCost,
              supplierId: supplierId,
              supplierName: po?.supplier_name || supplier?.name || null,
              docNo: receiptNumber,
              openedAt: data.received_at || now,
              currency,
              exchangeRate,
              usdPrice: currency === 'USD' ? Number(unitUsd || 0) : null,
              usdTotal: currency === 'USD' ? Number(lineUsd || 0) : null,
            });
          }
        }
      }

      if (hasReceiptCol('total_usd') || hasReceiptCol('total_uzs')) {
        const sets = [];
        const vals = [];
        if (hasReceiptCol('total_usd')) {
          sets.push('total_usd = ?');
          vals.push(currency === 'USD' ? totalUsd : null);
        }
        if (hasReceiptCol('total_uzs')) {
          sets.push('total_uzs = ?');
          vals.push(totalUzs);
        }
        vals.push(receiptId);
        this.db.prepare(
          `
          UPDATE purchase_receipts
          SET ${sets.join(', ')}
          WHERE id = ?
        `
        ).run(...vals);
      }

      if (purchaseOrderId && status === 'received') {
        const totals = this.db.prepare(
          `
          SELECT SUM(ordered_qty) AS ordered_total, SUM(received_qty) AS received_total
          FROM purchase_order_items
          WHERE purchase_order_id = ?
        `
        ).get(purchaseOrderId);
        const orderedTotal = Number(totals?.ordered_total || 0);
        const receivedTotal = Number(totals?.received_total || 0);
        const nextStatus =
          receivedTotal >= orderedTotal && orderedTotal > 0
            ? 'received'
            : receivedTotal > 0
            ? 'partially_received'
            : po?.status || 'approved';
        this.db.prepare(
          `
          UPDATE purchase_orders
          SET status = ?, updated_at = ?
          WHERE id = ?
        `
        ).run(nextStatus, now, purchaseOrderId);

        this._audit(
          'receive',
          'purchase_receipt',
          receiptId,
          null,
          {
            receipt_number: receiptNumber,
            purchase_order_id: purchaseOrderId,
            status: nextStatus,
            receive_type: data.receive_type || 'standard',
          },
          data.created_by || null,
        );
      }
    });

    try {
      if (typeof transaction.immediate === 'function') {
        transaction.immediate();
      } else {
        transaction();
      }
    } catch (error) {
      if (error?.code === ERROR_CODES.CONFLICT || error?.code === ERROR_CODES.VALIDATION_ERROR) {
        throw error;
      }
      if (String(error?.message || '').includes('UNIQUE') && idempotencyKey) {
        const existing = this.db
          .prepare(`SELECT * FROM purchase_receipts WHERE idempotency_key = ? LIMIT 1`)
          .get(idempotencyKey);
        if (existing) {
          return {
            ...existing,
            items:
              this.db
                .prepare(`SELECT * FROM purchase_receipt_items WHERE receipt_id = ?`)
                .all(existing.id) || [],
            idempotent_replay: true,
          };
        }
      }
      throw error;
    }
    return { id: receiptId, receipt_number: receiptNumber };
  }

  /**
   * Delete purchase order (draft-only)
   */
  deleteOrder(purchaseOrderId) {
    if (!purchaseOrderId) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Purchase order ID is required');
    }

    const po = this.db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(purchaseOrderId);
    if (!po) {
      throw createError(ERROR_CODES.NOT_FOUND, `Purchase order ${purchaseOrderId} not found`);
    }

    if (po.status !== 'draft' && po.status !== 'cancelled') {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Only draft or cancelled purchase orders can be deleted');
    }

    const received = this.db
      .prepare(
        `
        SELECT COALESCE(SUM(received_qty), 0) AS total_received
        FROM purchase_order_items
        WHERE purchase_order_id = ?
      `
      )
      .get(purchaseOrderId);
    if (Number(received?.total_received || 0) > 0) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Cannot delete a purchase order that has received goods');
    }

    const paymentRow = this.db
      .prepare(
        `
        SELECT 1
        FROM supplier_payments
        WHERE purchase_order_id = ?
        LIMIT 1
      `
      )
      .get(purchaseOrderId);
    if (paymentRow) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Cannot delete a purchase order with payments');
    }

    const transaction = this.db.transaction(() => {
      this.db.prepare('DELETE FROM purchase_order_items WHERE purchase_order_id = ?').run(purchaseOrderId);

      const hasExpenses = this.db
        .prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='purchase_order_expenses'`)
        .get();
      if (hasExpenses) {
        this.db.prepare('DELETE FROM purchase_order_expenses WHERE purchase_order_id = ?').run(purchaseOrderId);
      }

      this.db.prepare('DELETE FROM purchase_orders WHERE id = ?').run(purchaseOrderId);
    });

    transaction();
    return { success: true };
  }

  /**
   * Approve purchase order (draft -> approved)
   */
  approveOrder(purchaseOrderId, approvedBy) {
    if (!purchaseOrderId) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Purchase order ID is required');
    }

    const po = this.db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(purchaseOrderId);
    if (!po) {
      throw createError(ERROR_CODES.NOT_FOUND, `Purchase order ${purchaseOrderId} not found`);
    }

    if (po.status !== 'draft') {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Only draft purchase orders can be approved');
    }

    // Resolve approved_by to valid users.id when FK exists (safe fallback)
    const KNOWN_DEFAULT_USER = 'default-admin-001';
    let approvedById = approvedBy || KNOWN_DEFAULT_USER;
    if (approvedById !== KNOWN_DEFAULT_USER) {
      const exists = this.db.prepare('SELECT id FROM users WHERE id = ?').get(approvedById);
      if (!exists) {
        approvedById = KNOWN_DEFAULT_USER;
      }
    }

    const now = new Date().toISOString().replace('T', ' ').replace('Z', '').substring(0, 19);

    // Some schemas (006_purchases.sql) include approved_by/approved_at, some (000_init.sql) may not.
    // Detect columns and update accordingly.
    const cols = this.db.prepare(`PRAGMA table_info(purchase_orders)`).all().map(c => c.name);
    const hasApprovedBy = cols.includes('approved_by');
    const hasApprovedAt = cols.includes('approved_at');

    const sets = ['status = ?', 'updated_at = ?'];
    const params = ['approved', now];
    if (hasApprovedBy) {
      sets.push('approved_by = ?');
      params.push(approvedById);
    }
    if (hasApprovedAt) {
      sets.push('approved_at = ?');
      params.push(now);
    }
    params.push(purchaseOrderId);

    this.db.prepare(`
      UPDATE purchase_orders
      SET ${sets.join(', ')}
      WHERE id = ?
    `).run(...params);

    return this.get(purchaseOrderId);
  }

  /**
   * Create a cost correction document for a received PO (does not rewrite historical sale profit).
   * Apply on approve only.
   */
  createCostCorrection(data) {
    if (!data?.purchase_order_id) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'purchase_order_id is required');
    }
    const reason = String(data.reason || '').trim();
    if (!reason) throw createError(ERROR_CODES.VALIDATION_ERROR, 'Correction reason is required');

    const role = this._primaryPurchaseRole(data.created_by);
    if (!canCreateCostCorrection(role)) {
      throw createError(ERROR_CODES.FORBIDDEN, 'Cost correction requires accountant/manager/admin');
    }

    const hasTable = this.db
      .prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='purchase_cost_corrections'`)
      .get();
    if (!hasTable) {
      throw createError(ERROR_CODES.DB_ERROR, 'purchase_cost_corrections table missing (migration 130)');
    }

    const po = this.db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(data.purchase_order_id);
    if (!po) throw createError(ERROR_CODES.NOT_FOUND, 'Purchase order not found');
    const st = String(po.status || '').toLowerCase();
    if (!['received', 'partially_received', 'closed'].includes(st)) {
      throw createError(
        ERROR_CODES.VALIDATION_ERROR,
        'Cost correction is only for received/partially received/closed orders',
      );
    }

    const id = randomUUID();
    const correctionNumber = `PCC-${Date.now()}`;
    const now = new Date().toISOString();
    this.db
      .prepare(
        `
        INSERT INTO purchase_cost_corrections (
          id, correction_number, purchase_order_id, purchase_order_item_id, product_id,
          field_name, old_value, new_value, reason, notes, status, created_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
      `,
      )
      .run(
        id,
        correctionNumber,
        data.purchase_order_id,
        data.purchase_order_item_id || null,
        data.product_id || null,
        data.field_name || 'unit_cost',
        data.old_value != null ? Number(data.old_value) : null,
        data.new_value != null ? Number(data.new_value) : null,
        reason,
        data.notes || null,
        data.created_by || null,
        now,
        now,
      );

    this._audit(
      'create',
      'purchase_cost_correction',
      id,
      null,
      { correction_number: correctionNumber, ...data },
      data.created_by,
    );

    return this.db.prepare('SELECT * FROM purchase_cost_corrections WHERE id = ?').get(id);
  }

  approveCostCorrection(correctionId, { approved_by, apply = true } = {}) {
    if (!correctionId) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'correction id is required');
    }
    const role = this._primaryPurchaseRole(approved_by);
    if (!canApproveCostCorrection(role)) {
      throw createError(ERROR_CODES.FORBIDDEN, 'Approve cost correction requires accountant/manager/admin');
    }

    const row = this.db.prepare('SELECT * FROM purchase_cost_corrections WHERE id = ?').get(correctionId);
    if (!row) throw createError(ERROR_CODES.NOT_FOUND, 'Correction not found');
    if (row.status !== 'pending') {
      throw createError(ERROR_CODES.VALIDATION_ERROR, `Correction is already ${row.status}`);
    }

    const now = new Date().toISOString();
    const run = this.db.transaction(() => {
      this.db
        .prepare(
          `
          UPDATE purchase_cost_corrections
          SET status = 'approved', approved_by = ?, approved_at = ?, updated_at = ?
          WHERE id = ?
        `,
        )
        .run(approved_by || null, now, now, correctionId);

      if (apply && row.purchase_order_item_id && row.field_name === 'unit_cost') {
        const poi = this.db
          .prepare(`SELECT * FROM purchase_order_items WHERE id = ?`)
          .get(row.purchase_order_item_id);
        if (poi) {
          const newCost = Number(row.new_value);
          const qty = Number(poi.ordered_qty || 0);
          this.db
            .prepare(
              `
              UPDATE purchase_order_items
              SET unit_cost = ?, line_total = ?
              WHERE id = ?
            `,
            )
            .run(newCost, qty * newCost, row.purchase_order_item_id);

          // Snapshot catalog purchase_price for future — do NOT rewrite historical sales COGS
          try {
            this.db
              .prepare(`UPDATE products SET purchase_price = ?, updated_at = ? WHERE id = ?`)
              .run(newCost, now, poi.product_id);
            if (this.cacheService?.invalidateProduct) {
              this.cacheService.invalidateProduct(poi.product_id);
            }
          } catch {
            // optional
          }
        }
      }

      this._audit(
        'approve',
        'purchase_cost_correction',
        correctionId,
        row,
        { status: 'approved', apply },
        approved_by,
      );
      return this.db.prepare('SELECT * FROM purchase_cost_corrections WHERE id = ?').get(correctionId);
    });

    return typeof run.immediate === 'function' ? run.immediate() : run();
  }

  listCostCorrections(purchaseOrderId) {
    if (!purchaseOrderId) return [];
    try {
      return (
        this.db
          .prepare(
            `
            SELECT * FROM purchase_cost_corrections
            WHERE purchase_order_id = ?
            ORDER BY datetime(created_at) DESC
          `,
          )
          .all(purchaseOrderId) || []
      );
    } catch {
      return [];
    }
  }

  /**
   * Receive goods for a purchase order (legacy IPC path).
   * Stock and batches are applied via createReceipt() — same as the Purchase Receipt form.
   */
  receiveGoods(purchaseOrderId, receiptData) {
    if (!purchaseOrderId) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Purchase order ID is required');
    }

    if (!receiptData.items || !Array.isArray(receiptData.items) || receiptData.items.length === 0) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Receipt must have at least one item');
    }

    const po = this.db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(purchaseOrderId);
    if (!po) {
      throw createError(ERROR_CODES.NOT_FOUND, `Purchase order ${purchaseOrderId} not found`);
    }
    if (po.status === 'cancelled') {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Cannot receive goods for a cancelled purchase order');
    }

    this._assertOrderQtyCoversReceived(purchaseOrderId);

    const hasCurrency = this._hasPOCol('currency');
    const hasFxRate = this._hasPOCol('fx_rate');
    const hasItemUsd = this._hasPOItemCol('unit_cost_usd') && this._hasPOItemCol('line_total_usd');
    const currency = hasCurrency && String(po.currency || 'UZS').toUpperCase() === 'USD' ? 'USD' : 'UZS';
    const exchangeRate = currency === 'USD' && hasFxRate ? Number(po.fx_rate) : null;
    if (currency === 'USD' && (!Number.isFinite(exchangeRate) || exchangeRate <= 0)) {
      throw createError(
        ERROR_CODES.VALIDATION_ERROR,
        'USD buyurtmada fx_rate yo‘q yoki noto‘g‘ri; avval kursni PO da kiriting.'
      );
    }

    const getPoi = this.db.prepare(`
      SELECT id, product_id, product_name, ordered_qty, received_qty, unit_cost, unit_cost_usd, line_total_usd
      FROM purchase_order_items
      WHERE id = ? AND purchase_order_id = ?
    `);

    const landedByPoiId = this._buildLandedCostByPoiId(purchaseOrderId);
    const receiptItems = [];
    for (const row of receiptData.items) {
      const qty = Number(row.received_qty || 0);
      if (!Number.isFinite(qty) || qty <= 0) continue;

      const itemId = row.item_id;
      if (!itemId) {
        throw createError(ERROR_CODES.VALIDATION_ERROR, 'Har bir qator uchun item_id (purchase_order_items.id) kerak');
      }

      const poi = getPoi.get(itemId, purchaseOrderId);
      if (!poi) {
        throw createError(ERROR_CODES.NOT_FOUND, `Buyurtma qatori topilmadi: ${itemId}`);
      }

      const ordered = Number(poi.ordered_qty || 0);
      const already = Number(poi.received_qty || 0);
      const remaining = ordered - already;
      if (qty > remaining + 1e-9) {
        throw createError(
          ERROR_CODES.VALIDATION_ERROR,
          `Qabul miqdori (${qty}) qolgan miqdordan (${remaining}) oshib ketdi`
        );
      }

      const productId = row.product_id || poi.product_id;
      const productName = poi.product_name || '';
      const landedUnit = Number(landedByPoiId.get(itemId));
      const hasLanded = Number.isFinite(landedUnit) && landedUnit >= 0;

      if (currency === 'USD' && hasItemUsd) {
        let unitUsd = hasLanded && Number(exchangeRate) > 0 ? landedUnit / Number(exchangeRate) : Number(poi.unit_cost_usd);
        if (!Number.isFinite(unitUsd) || unitUsd < 0) {
          const uc = hasLanded ? landedUnit : Number(poi.unit_cost || 0);
          if (Number.isFinite(exchangeRate) && exchangeRate > 0) {
            unitUsd = uc / exchangeRate;
          } else {
            throw createError(ERROR_CODES.VALIDATION_ERROR, `PO qator ${itemId}: USD narxi aniqlanmadi`);
          }
        }
        receiptItems.push({
          product_id: productId,
          product_name: productName,
          purchase_order_item_id: itemId,
          received_qty: qty,
          unit_cost_usd: unitUsd,
          line_total_usd: qty * unitUsd,
        });
      } else {
        const unitUzs = hasLanded ? landedUnit : Number(poi.unit_cost || 0);
        receiptItems.push({
          product_id: productId,
          product_name: productName,
          purchase_order_item_id: itemId,
          received_qty: qty,
          unit_cost: unitUzs,
          line_total: qty * unitUzs,
        });
      }
    }

    if (receiptItems.length === 0) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Kamida bitta qatorda received_qty > 0 bo‘lishi kerak');
    }

    this.createReceipt({
      purchase_order_id: purchaseOrderId,
      supplier_id: po.supplier_id || null,
      warehouse_id: 'main-warehouse-001',
      status: 'received',
      currency,
      exchange_rate: exchangeRate,
      items: receiptItems,
      received_at: receiptData.received_at || null,
      created_by: receiptData.received_by || null,
      update_product_sale_prices: receiptData.update_product_sale_prices,
    });

    return this.get(purchaseOrderId);
  }

  bindReportsService(reportsService) {
    this.reportsService = reportsService;
  }

  _planningFilters(payload) {
    const src = payload?.planning_filters || payload?.filters || payload || {};
    return {
      analysis_days: src.analysis_days,
      plan_days: src.plan_days,
      safety_days: src.safety_days,
      date_to: src.date_to,
      category_id: src.category_id,
      warehouse_id: src.warehouse_id,
      search: '',
      only_risk: false,
    };
  }

  _openOrdersForProducts(productIds) {
    if (!productIds?.length || !this._hasPOCol('status')) return [];
    try {
      const placeholders = productIds.map(() => '?').join(',');
      return this.db
        .prepare(
          `
          SELECT
            po.id AS purchase_order_id,
            po.po_number,
            po.supplier_id,
            po.status,
            poi.product_id,
            poi.product_name,
            poi.ordered_qty,
            COALESCE(poi.received_qty, 0) AS received_qty
          FROM purchase_order_items poi
          INNER JOIN purchase_orders po ON po.id = poi.purchase_order_id
          WHERE poi.product_id IN (${placeholders})
            AND LOWER(COALESCE(po.status, '')) NOT IN ('received', 'cancelled')
          ORDER BY po.created_at DESC
        `,
        )
        .all(...productIds);
    } catch {
      return [];
    }
  }

  previewDraftFromPlanning(payload = {}) {
    if (!this.reportsService?.getPurchasePlanning) {
      throw createError(ERROR_CODES.INTERNAL_ERROR, 'Reports service is not bound');
    }
    const productIds = [...new Set((payload.product_ids || []).map(String).filter(Boolean))];
    if (!productIds.length) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Mahsulot tanlang');
    }
    const planning = this.reportsService.getPurchasePlanning(this._planningFilters(payload));
    const idSet = new Set(productIds);
    const selected = (planning.rows || []).filter((r) => idSet.has(String(r.product_id)));
    if (!selected.length) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Tanlangan mahsulotlar hisobotda topilmadi');
    }

    const groups = [];
    const bySupplier = new Map();
    for (const row of selected) {
      const key = row.supplier_id || '__none__';
      if (!bySupplier.has(key)) {
        bySupplier.set(key, {
          supplier_id: row.supplier_id || null,
          supplier_name: row.supplier_name || null,
          currency: row.currency || 'UZS',
          items: [],
          total_qty: 0,
          total_value: 0,
          can_create: Boolean(row.supplier_id),
        });
      }
      const g = bySupplier.get(key);
      const qty = Number(row.recommended_qty || 0) || 0;
      if (qty <= 0) continue;
      g.items.push({
        product_id: row.product_id,
        product_name: row.product_name,
        product_sku: row.product_sku,
        unit: row.unit,
        ordered_qty: qty,
        unit_cost: row.last_purchase_cost,
        line_total: row.recommended_value,
        currency: row.currency,
      });
      g.total_qty += qty;
      g.total_value += Number(row.recommended_value || 0) || 0;
      if (row.currency) g.currency = row.currency;
    }
    for (const g of bySupplier.values()) {
      if (g.items.length) groups.push(g);
    }

    const openOrders = this._openOrdersForProducts(productIds);
    const duplicateProductIds = [...new Set(openOrders.map((o) => o.product_id))];

    return {
      groups,
      open_orders: openOrders,
      duplicate_product_ids: duplicateProductIds,
      formula: planning.meta?.formula,
      meta: planning.meta,
      totals: {
        group_count: groups.length,
        item_count: groups.reduce((n, g) => n + g.items.length, 0),
      },
    };
  }

  createDraftFromPlanning(payload = {}) {
    if (!payload.confirm) {
      throw createError(
        ERROR_CODES.VALIDATION_ERROR,
        'Draft xarid buyurtmasini yaratish uchun tasdiq (confirm) kerak',
      );
    }
    const preview = this.previewDraftFromPlanning(payload);
    const creatable = preview.groups.filter((g) => g.can_create && g.supplier_id && g.items.length);
    if (!creatable.length) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Yetkazib beruvchisi bor qatorlar yo‘q');
    }

    const created = [];
    for (const g of creatable) {
      const currency = String(g.currency || 'UZS').toUpperCase() === 'USD' ? 'USD' : 'UZS';
      const items = g.items.map((it) => {
        const qty = Number(it.ordered_qty);
        const unitCost = Number(it.unit_cost || 0) || 0;
        const line = {
          product_id: it.product_id,
          product_name: it.product_name,
          product_sku: it.product_sku,
          ordered_qty: qty,
          unit_cost: currency === 'USD' ? undefined : unitCost,
          line_total: currency === 'USD' ? undefined : qty * unitCost,
        };
        if (currency === 'USD') {
          line.unit_cost_usd = unitCost;
          line.line_total_usd = qty * unitCost;
        }
        return line;
      });
      const po = this.createOrder({
        supplier_id: g.supplier_id,
        supplier_name: g.supplier_name,
        status: 'draft',
        currency,
        fx_rate: currency === 'USD' ? payload.fx_rate : undefined,
        notes: 'Bozorga borish hisobotidan draft',
        created_by: payload.created_by,
        items,
      });
      created.push({
        id: po.id,
        po_number: po.po_number,
        supplier_id: g.supplier_id,
        supplier_name: g.supplier_name,
        item_count: items.length,
        total_amount: po.total_amount,
        total_usd: po.total_usd,
        currency,
      });
    }
    return { created, skipped_without_supplier: preview.groups.filter((g) => !g.can_create) };
  }
}

module.exports = PurchaseService;

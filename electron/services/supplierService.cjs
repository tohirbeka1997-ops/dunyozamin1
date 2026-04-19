const { ERROR_CODES, createError } = require('../lib/errors.cjs');
const { randomUUID } = require('crypto');

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
      ? `CASE WHEN COALESCE(s.settlement_currency, 'USD') = 'USD'
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
      ? `CASE WHEN COALESCE(s.settlement_currency, 'USD') = 'USD'
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
      ? `CASE WHEN COALESCE(s.settlement_currency, 'USD') = 'USD'
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
      ? `CASE WHEN COALESCE(s.settlement_currency, 'USD') = 'USD'
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
          data.status || 'active',
          String(data.settlement_currency || 'USD').toUpperCase() === 'USD' ? 'USD' : 'UZS',
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
          data.status || 'active',
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
      params.push(data.status);
    }

    if (data.settlement_currency !== undefined && this._hasSupplierCol('settlement_currency')) {
      updates.push('settlement_currency = ?');
      params.push(String(data.settlement_currency || 'USD').toUpperCase() === 'USD' ? 'USD' : 'UZS');
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
      String(supplier?.settlement_currency || 'USD').toUpperCase() === 'USD' ? 'USD' : 'UZS';
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
      paymentQuery += ' AND DATE(paid_at) >= ?';
      paymentParams.push(filters.date_from);
    }

    if (filters.date_to) {
      paymentQuery += ' AND DATE(paid_at) <= ?';
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
   * Create supplier payment
   */
  createPayment(data) {
    if (!data.supplier_id) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Supplier ID is required');
    }

    // NOTE:
    // Positive amount => we pay supplier (reduces balance)
    // Negative amount => supplier pays us back (increases balance), used for advance/overpayment settlements
    // For USD suppliers, we store amount_usd/currency='USD' (MVP: no UZS conversion).
    const supplier = this.get(data.supplier_id);
    const settlementCurrency =
      String(supplier?.settlement_currency || 'USD').toUpperCase() === 'USD' ? 'USD' : 'UZS';
    const paymentCurrency = String(data.currency || settlementCurrency || 'UZS').toUpperCase() === 'USD' ? 'USD' : 'UZS';
    const inputAmount =
      paymentCurrency === 'USD'
        ? Number(data.amount_usd ?? data.amount)
        : Number(data.amount);

    if (inputAmount === null || inputAmount === undefined || Number(inputAmount) === 0) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Payment amount must be non-zero');
    }
    if (data.purchase_order_id && Number(inputAmount) < 0) {
      throw createError(
        ERROR_CODES.VALIDATION_ERROR,
        'Negative amounts are not allowed for purchase order payments'
      );
    }

    // Verify supplier exists (already fetched above)

    const id = randomUUID();
    const paymentNumber = `SPAY-${Date.now()}`;
    const now = new Date().toISOString();

    try {
      // Some schemas use "notes" (plural). Older/other code paths may use "note" (singular).
      // Detect columns at runtime for compatibility.
      const cols = this.db.prepare(`PRAGMA table_info(supplier_payments)`).all().map(c => c.name);
      const hasNotes = cols.includes('notes');
      const hasNote = cols.includes('note');
      const notesCol = hasNotes ? 'notes' : (hasNote ? 'note' : null);
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
        data.supplier_id,
        data.purchase_order_id || null,
        settlementCurrency === 'USD' ? 0 : inputAmount,
        data.payment_method || 'cash',
        data.paid_at || now,
      ];

      if (hasCurrency) {
        insertCols.push('currency');
        values.push(paymentCurrency);
      }
      if (paymentCurrency === 'USD' && hasAmountUsd) {
        insertCols.push('amount_usd');
        values.push(inputAmount);
      }

      if (hasReferenceNumber) {
        insertCols.push('reference_number');
        values.push(data.reference_number || null);
      }

      if (notesCol) {
        insertCols.push(notesCol);
        values.push((data.note ?? data.notes)?.trim?.() || null);
      }

      insertCols.push('created_by', 'created_at');
      values.push(data.created_by || null, now);

      const placeholders = insertCols.map(() => '?').join(', ');
      this.db.prepare(`
        INSERT INTO supplier_payments (${insertCols.join(', ')})
        VALUES (${placeholders})
      `).run(...values);

      // If payment is linked to a purchase order, update cached payment fields on purchase_orders (if columns exist).
      // UI expects payment_status values: UNPAID / PARTIALLY_PAID / PAID.
      if (data.purchase_order_id) {
        try {
          const poCols = this.db.prepare(`PRAGMA table_info(purchase_orders)`).all().map(c => c.name);
          if (poCols.includes('paid_amount') && poCols.includes('payment_status')) {
            // For USD suppliers, we don't update UZS cached fields (MVP).
            if (settlementCurrency === 'USD') {
              // Skip cached fields update, but continue returning the payment row.
            } else {
            const totalRow = this.db.prepare(`SELECT total_amount FROM purchase_orders WHERE id = ?`).get(data.purchase_order_id);
            const totalAmount = Number(totalRow?.total_amount ?? 0);
            const sumRow = this.db.prepare(`
              SELECT COALESCE(SUM(amount), 0) AS paid_amount
              FROM supplier_payments
              WHERE purchase_order_id = ?
            `).get(data.purchase_order_id);
            const paidAmount = Number(sumRow?.paid_amount ?? 0);
            const status =
              paidAmount <= 0 ? 'UNPAID' : paidAmount >= totalAmount ? 'PAID' : 'PARTIALLY_PAID';

            this.db.prepare(`
              UPDATE purchase_orders
              SET paid_amount = ?, payment_status = ?, updated_at = datetime('now')
              WHERE id = ?
            `).run(paidAmount, status, data.purchase_order_id);
            }
          }
        } catch {
          // ignore: cached fields are optional; PurchaseService.get/list also computes from supplier_payments
        }
      }

      return this.db.prepare('SELECT * FROM supplier_payments WHERE id = ?').get(id);
    } catch (error) {
      throw createError(ERROR_CODES.DB_ERROR, `Failed to create payment: ${error.message}`);
    }
  }

  /**
   * Delete supplier payment by ID
   */
  deletePayment(paymentId) {
    if (!paymentId) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Payment ID is required');
    }

    const payment = this.db.prepare('SELECT * FROM supplier_payments WHERE id = ?').get(paymentId);
    if (!payment) {
      throw createError(ERROR_CODES.NOT_FOUND, 'Payment not found');
    }

    const poId = payment.purchase_order_id;
    const paymentCurrency = String(payment.currency || 'UZS').toUpperCase();

    this.db.prepare('DELETE FROM supplier_payments WHERE id = ?').run(paymentId);

    // If linked to PO, update cached payment fields when available (UZS only).
    if (poId) {
      try {
        const poCols = this.db.prepare(`PRAGMA table_info(purchase_orders)`).all().map(c => c.name);
        if (poCols.includes('paid_amount') && poCols.includes('payment_status')) {
          if (paymentCurrency !== 'USD') {
            const totalRow = this.db.prepare(`SELECT total_amount FROM purchase_orders WHERE id = ?`).get(poId);
            const totalAmount = Number(totalRow?.total_amount ?? 0);
            const sumRow = this.db.prepare(`
              SELECT COALESCE(SUM(amount), 0) AS paid_amount
              FROM supplier_payments
              WHERE purchase_order_id = ?
            `).get(poId);
            const paidAmount = Number(sumRow?.paid_amount ?? 0);
            const status =
              paidAmount <= 0 ? 'UNPAID' : paidAmount >= totalAmount ? 'PAID' : 'PARTIALLY_PAID';
            this.db.prepare(`
              UPDATE purchase_orders
              SET paid_amount = ?, payment_status = ?, updated_at = datetime('now')
              WHERE id = ?
            `).run(paidAmount, status, poId);
          }
        }
      } catch {
        // ignore cached field errors
      }
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

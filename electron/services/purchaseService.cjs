const { ERROR_CODES, createError } = require('../lib/errors.cjs');
const { randomUUID } = require('crypto');

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
    this._poCols = null;
    this._poiCols = null;
    this._spCols = null;
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

  _computePaymentStatus(paidAmount, totalAmount) {
    const paid = Number(paidAmount) || 0;
    const total = Number(totalAmount) || 0;
    if (paid <= 0) return 'UNPAID';
    if (paid >= total) return 'PAID';
    return 'PARTIALLY_PAID';
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

    query += ' ORDER BY po.order_date DESC, po.created_at DESC';

    if (filters.limit) {
      query += ' LIMIT ?';
      params.push(filters.limit);
    }

    const rows = this.db.prepare(query).all(params);

    // If include_items requested, fetch items for all POs in one batch
    let itemsByPoId = new Map();
    if (filters.include_items) {
      const poIds = rows.map((r) => r.id);
      if (poIds.length > 0) {
        const placeholders = poIds.map(() => '?').join(',');
        const itemsQuery = `
          SELECT 
            poi.*,
            p.name as product_name,
            p.sku as product_sku,
            p.unit as product_unit
          FROM purchase_order_items poi
          INNER JOIN products p ON poi.product_id = p.id
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

    return rows.map((row) => {
      const currency = hasCurrency ? String(row.currency || 'UZS').toUpperCase() : 'UZS';
      const paidAmountUZS = Number(row.computed_paid_amount ?? 0);
      const paidAmountUSD = hasAmountUsd ? Number(row.computed_paid_amount_usd ?? 0) : 0;
      const totalAmountUZS = Number(row.total_amount ?? 0);
      const totalAmountUSD = hasTotalUsd ? Number(row.total_usd ?? 0) : 0;
      const result = {
        ...row,
        paid_amount_uzs: paidAmountUZS,
        remaining_amount_uzs: totalAmountUZS - paidAmountUZS,
        paid_amount_usd: currency === 'USD' ? paidAmountUSD : null,
        remaining_amount_usd: currency === 'USD' ? (totalAmountUSD - paidAmountUSD) : null,
        // Keep legacy fields too (best-effort)
        paid_amount: currency === 'USD' ? paidAmountUSD : paidAmountUZS,
        remaining_amount: currency === 'USD' ? (totalAmountUSD - paidAmountUSD) : (totalAmountUZS - paidAmountUZS),
        payment_status: currency === 'USD'
          ? this._computePaymentStatus(paidAmountUSD, totalAmountUSD)
          : this._computePaymentStatus(paidAmountUZS, totalAmountUZS),
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

    const paidAmountUZS = Number(
      this.db
        .prepare(`SELECT COALESCE(SUM(amount), 0) AS paid_amount FROM supplier_payments WHERE purchase_order_id = ?`)
        .get(id)?.paid_amount ?? 0
    );
    const paidAmountUSD = hasAmountUsd
      ? Number(
          this.db
            .prepare(`SELECT COALESCE(SUM(COALESCE(amount_usd, 0)), 0) AS paid_amount FROM supplier_payments WHERE purchase_order_id = ?`)
            .get(id)?.paid_amount ?? 0
        )
      : 0;

    // Get items
    const items = this.db.prepare(`
      SELECT 
        poi.*,
        p.name as product_name,
        p.sku as product_sku,
        p.unit as product_unit
      FROM purchase_order_items poi
      INNER JOIN products p ON poi.product_id = p.id
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

    return {
      ...po,
      items: normalizedItems,
      supplier,
      expenses,
      total_expenses: totalExpenses,
      paid_amount_uzs: paidAmountUZS,
      remaining_amount_uzs: Number(po.total_amount ?? 0) - paidAmountUZS,
      paid_amount_usd: poCurrency === 'USD' ? paidAmountUSD : null,
      remaining_amount_usd: poCurrency === 'USD' ? ((hasTotalUsd ? Number(po.total_usd ?? 0) : 0) - paidAmountUSD) : null,
      paid_amount: poCurrency === 'USD' ? paidAmountUSD : paidAmountUZS,
      remaining_amount: poCurrency === 'USD' ? ((hasTotalUsd ? Number(po.total_usd ?? 0) : 0) - paidAmountUSD) : (Number(po.total_amount ?? 0) - paidAmountUZS),
      payment_status: poCurrency === 'USD'
        ? this._computePaymentStatus(paidAmountUSD, hasTotalUsd ? Number(po.total_usd ?? 0) : 0)
        : this._computePaymentStatus(paidAmountUZS, Number(po.total_amount ?? 0)),
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

    return this.listExpenses(purchaseOrderId);
  }

  deleteExpense(purchaseOrderId, expenseId) {
    if (!purchaseOrderId) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Purchase order ID is required');
    }
    if (!expenseId) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Expense ID is required');
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
        const unitUsd = Number(it.unit_cost_usd ?? it.unit_price_usd ?? it.unit_cost);
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
      try {
        this.db.prepare(`UPDATE products SET purchase_price = ?, updated_at = ? WHERE id = ?`).run(uc, now, pid);
        if (this.cacheService?.invalidateProduct) this.cacheService.invalidateProduct(pid);
        if (this.cacheService?.invalidatePricesForProduct) this.cacheService.invalidatePricesForProduct(pid);
      } catch (e) {
        console.warn('[PurchaseService] sync purchase_price from PO lines:', e?.message);
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
      } catch (e) {
        console.warn('[PurchaseService] sync sale_price from PO lines:', e?.message);
      }
    }
  }

  /**
   * Update PO line items when some goods were already received: match rows by product_id (FIFO),
   * preserve received_qty and row ids, disallow ordered_qty < received_qty, disallow removing received lines.
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
      const orderedQty = Number(item.ordered_qty);
      if (!Number.isFinite(orderedQty) || orderedQty <= 0) {
        throw createError(ERROR_CODES.VALIDATION_ERROR, 'ordered_qty must be > 0');
      }

      let unitUzs = Number(item.unit_cost);
      let lineUzs = Number(item.line_total ?? orderedQty * unitUzs);
      let unitUsd = null;
      let lineUsd = null;

      if (isUSD) {
        unitUsd = Number(item.unit_cost_usd ?? item.unit_price_usd ?? item.unit_cost);
        if (!Number.isFinite(unitUsd) || unitUsd < 0) {
          throw createError(ERROR_CODES.VALIDATION_ERROR, 'unit_cost_usd must be >= 0 for USD purchase');
        }
        lineUsd = Number.isFinite(Number(item.line_total_usd)) ? Number(item.line_total_usd) : orderedQty * unitUsd;
        unitUzs = unitUsd * fxRate;
        lineUzs = orderedQty * unitUzs;
      }

      const pid = item.product_id;
      const queue = queues.get(pid);
      const dbRow = queue && queue.length ? queue.shift() : null;

      if (dbRow) {
        const rq = Number(dbRow.received_qty || 0);
        if (orderedQty < rq) {
          throw createError(
            ERROR_CODES.VALIDATION_ERROR,
            `Buyurtma miqdori qabul qilinganidan (${rq}) kam bo‘lishi mumkin emas: ${item.product_name || pid}`
          );
        }
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
          'Qabul qilingan mahsulot qatorini o‘chirib bo‘lmaydi — buyurtmada saqlang yoki qabulni bekor qiling'
        );
      }
      deleteItem.run(row.id);
    }
  }

  /**
   * Update purchase order header and/or line items.
   * Blocked only for cancelled. Line items: full replace when nothing received yet;
   * merge (preserve received_qty per row) when any goods were received — including fully received POs.
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

    const existingItems = this.db.prepare(`
      SELECT COALESCE(SUM(received_qty), 0) as total_received
      FROM purchase_order_items
      WHERE purchase_order_id = ?
    `).get(purchaseOrderId);

    const totalReceived = Number(existingItems?.total_received || 0);

    if (items && (!Array.isArray(items) || items.length === 0)) {
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

      const nextCurrency = hasCurrency ? String((data && data.currency) || po.currency || 'UZS').toUpperCase() : 'UZS';
      const isUSD = nextCurrency === 'USD';
      const fxRate = isUSD ? Number((data && data.fx_rate) ?? po.fx_rate) : null;
      if (isUSD) {
        if (!hasCurrency || !hasFxRate || !hasTotalUsd || !hasItemUsd) {
          throw createError(ERROR_CODES.DB_ERROR, 'USD purchase columns missing (apply latest migrations and restart app)');
        }
        if (!Number.isFinite(fxRate) || fxRate <= 0) {
          throw createError(ERROR_CODES.VALIDATION_ERROR, 'fx_rate is required for USD purchase (UZS per 1 USD)');
        }
      }

      // Update header
      if (data) {
        // Recalculate totals from items if provided
        const sourceItemsRaw = Array.isArray(items)
          ? items
          : this.db.prepare('SELECT * FROM purchase_order_items WHERE purchase_order_id = ?').all(purchaseOrderId);

        const sourceItems = sourceItemsRaw.map((it) => {
          const orderedQty = Number(it.ordered_qty);
          if (!Number.isFinite(orderedQty) || orderedQty <= 0) {
            throw createError(ERROR_CODES.VALIDATION_ERROR, 'ordered_qty must be > 0');
          }
          if (isUSD) {
            const unitUsd = Number(it.unit_cost_usd ?? it.unit_price_usd ?? it.unit_cost);
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
        const discount = Number(data.discount || 0);
        const tax = Number(data.tax || 0);
        const totalAmount = subtotal - discount + tax;
        const totalUsd = isUSD
          ? Math.max(
              0,
              sourceItems.reduce((sum, it) => sum + (Number(it.line_total_usd) || 0), 0) -
                (Number(discount || 0) / Number(fxRate || 1))
            )
          : null;

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
          data.supplier_id ?? null,
          data.supplier_name ?? null,
          data.order_date ?? null,
          data.expected_date ?? null,
          data.reference ?? null,
          subtotal,
          discount,
          tax,
          totalAmount,
          data.status ?? null,
          data.invoice_number ?? null,
          data.notes ?? null,
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

        this.db.prepare(`
          UPDATE purchase_orders
          SET ${sets.join(', ')}
          WHERE id = ?
        `).run(...params);
      }

      // Replace or merge line items
      if (Array.isArray(items)) {
        if (totalReceived > 0) {
          this._mergePurchaseOrderItemsKeepReceipts(purchaseOrderId, items, {
            isUSD,
            fxRate,
            hasItemSku,
            hasItemUsd,
            hasItemDiscountPercent,
            hasItemDiscountAmount,
            hasItemSalePrice,
          });
        } else {
          this.db.prepare('DELETE FROM purchase_order_items WHERE purchase_order_id = ?').run(purchaseOrderId);
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
            const orderedQty = Number(item.ordered_qty);
            if (!Number.isFinite(orderedQty) || orderedQty <= 0) {
              throw createError(ERROR_CODES.VALIDATION_ERROR, 'ordered_qty must be > 0');
            }

            let unitUzs = Number(item.unit_cost);
            let lineUzs = Number(item.line_total ?? orderedQty * unitUzs);
            let unitUsd = null;
            let lineUsd = null;

            if (isUSD) {
              unitUsd = Number(item.unit_cost_usd ?? item.unit_price_usd ?? item.unit_cost);
              if (!Number.isFinite(unitUsd) || unitUsd < 0) {
                throw createError(ERROR_CODES.VALIDATION_ERROR, 'unit_cost_usd must be >= 0 for USD purchase');
              }
              lineUsd = Number.isFinite(Number(item.line_total_usd)) ? Number(item.line_total_usd) : orderedQty * unitUsd;
              unitUzs = unitUsd * fxRate;
              lineUzs = orderedQty * unitUzs;
            }

            const product = this.db.prepare('SELECT id, sku, name FROM products WHERE id = ?').get(item.product_id);
            if (!product) {
              throw createError(ERROR_CODES.NOT_FOUND, `Product ${item.product_id} not found`);
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
        }

        this._finalizePurchaseOrderStatus(purchaseOrderId, po, data, now);
        this._syncProductCatalogFromReceivedPoLines(purchaseOrderId, now);
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
    if (!data || !Array.isArray(data.items) || data.items.length === 0) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Receipt must have at least one item');
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
      if (po.status === 'cancelled') {
        throw createError(ERROR_CODES.VALIDATION_ERROR, 'Cannot receive a cancelled purchase order');
      }
    }

    const supplierId = data.supplier_id || po?.supplier_id || null;
    const supplier =
      supplierId ? this.db.prepare('SELECT settlement_currency, name FROM suppliers WHERE id = ?').get(supplierId) : null;
    const settlementCurrency = String(supplier?.settlement_currency || 'USD').toUpperCase() === 'USD' ? 'USD' : 'UZS';
    const warehouseId = data.warehouse_id || 'main-warehouse-001';
    const statusInput = String(data.status || 'received').toLowerCase();
    const status = statusInput === 'draft' ? 'draft' : 'received';

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
      // Currency rules: USD suppliers must use USD receipts with exchange rate
      const currency = String(data.currency || 'USD').toUpperCase() === 'USD' ? 'USD' : 'UZS';
      if (settlementCurrency === 'USD' && currency !== 'USD') {
        throw createError(ERROR_CODES.VALIDATION_ERROR, 'USD supplier receipt must be in USD');
      }
      const exchangeRate = currency === 'USD' ? Number(data.exchange_rate) : null;
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

      insertReceipt.run(...receiptValues);

      for (const item of data.items) {
        const qty = Number(item.received_qty || 0);
        if (!Number.isFinite(qty) || qty <= 0) {
          throw createError(ERROR_CODES.VALIDATION_ERROR, 'received_qty must be > 0');
        }
        const unitUsd = currency === 'USD' ? Number(item.unit_cost_usd ?? item.unit_cost ?? 0) : null;
        if (currency === 'USD' && (!Number.isFinite(unitUsd) || unitUsd < 0)) {
          throw createError(ERROR_CODES.VALIDATION_ERROR, 'unit_cost_usd must be >= 0 for USD receipt');
        }
        const unitCost = currency === 'USD' ? Number(unitUsd || 0) * Number(exchangeRate || 0) : Number(item.unit_cost || 0) || 0;
        const lineTotal = Number(item.line_total) || qty * unitCost;
        const lineUsd = currency === 'USD' ? (Number(item.line_total_usd) || qty * Number(unitUsd || 0)) : null;
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
          // Update PO item cost to actual receipt cost
          this.db.prepare(
            `
            UPDATE purchase_order_items
            SET unit_cost = ?, line_total = ?
            WHERE id = ? AND purchase_order_id = ?
          `
          ).run(unitCost, lineTotal, item.purchase_order_item_id, purchaseOrderId);
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

          // Update product cost price to latest receipt cost
          try {
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
          } catch (error) {
            console.warn('[PurchaseService.createReceipt] Failed to update product purchase_price:', error.message);
          }

          // Update product sale_price from PO item if set (sotish narxi)
          if (purchaseOrderId && item.purchase_order_item_id) {
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
              openedAt: now,
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
      }
    });

    transaction();
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

      if (currency === 'USD' && hasItemUsd) {
        let unitUsd = Number(poi.unit_cost_usd);
        if (!Number.isFinite(unitUsd) || unitUsd < 0) {
          const uc = Number(poi.unit_cost || 0);
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
        const unitUzs = Number(poi.unit_cost || 0);
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
    });

    return this.get(purchaseOrderId);
  }
}

module.exports = PurchaseService;

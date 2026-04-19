const { ERROR_CODES, createError } = require('../lib/errors.cjs');
const { randomUUID } = require('crypto');

/**
 * Supplier Returns Service
 * - Records supplier returns (credit note) and adjusts inventory
 * - Also writes a "credit_note" entry into supplier_payments so supplier debt decreases automatically
 */
class SupplierReturnsService {
  constructor(db, inventoryService) {
    this.db = db;
    this.inventoryService = inventoryService;
  }

  /**
   * Create supplier return (credit note).
   * payload: {
   *   supplier_id, purchase_order_id?, warehouse_id?,
   *   return_reason?, notes?, created_by?,
   *   return_date?, items: [{ product_id, quantity, unit_cost?, reason? }]
   * }
   */
  create(payload = {}) {
    const supplierId = payload.supplier_id;
    if (!supplierId) throw createError(ERROR_CODES.VALIDATION_ERROR, 'supplier_id is required');
    if (!Array.isArray(payload.items) || payload.items.length === 0) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'items are required');
    }

    // Validate supplier exists
    const supplier = this.db.prepare('SELECT id, name FROM suppliers WHERE id = ?').get(supplierId);
    if (!supplier) throw createError(ERROR_CODES.NOT_FOUND, 'Supplier not found');

    // Single warehouse system default
    const warehouseId = payload.warehouse_id || 'main-warehouse-001';

    const now = new Date().toISOString().replace('T', ' ').replace('Z', '').substring(0, 19);
    const returnId = randomUUID();
    const returnNumber = `SRET-${Date.now()}`;
    const returnDate = payload.return_date
      ? String(payload.return_date).split('T')[0].split(' ')[0]
      : now.split(' ')[0];

    // Determine valuation: prefer provided unit_cost; otherwise use latest purchase_order_items.unit_cost
    const getFallbackUnitCost = (productId) => {
      const row = this.db
        .prepare(
          `
          SELECT poi.unit_cost
          FROM purchase_order_items poi
          INNER JOIN purchase_orders po ON po.id = poi.purchase_order_id
          WHERE poi.product_id = ?
            AND po.status IN ('received', 'partially_received', 'approved')
          ORDER BY datetime(po.created_at) DESC
          LIMIT 1
        `
        )
        .get(productId);
      return Number(row?.unit_cost || 0) || 0;
    };

    const tx = this.db.transaction(() => {
      // Insert return header with total_amount=0 for now
      this.db
        .prepare(
          `
          INSERT INTO supplier_returns (
            id, return_number, supplier_id, purchase_order_id, warehouse_id,
            status, return_reason, notes, total_amount,
            created_by, created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
        )
        .run(
          returnId,
          returnNumber,
          supplierId,
          payload.purchase_order_id || null,
          warehouseId,
          payload.status || 'completed',
          payload.return_reason || null,
          payload.notes || null,
          0,
          payload.created_by || null,
          now,
          now
        );

      let totalAmount = 0;

      for (const it of payload.items) {
        const productId = it.product_id;
        const qty = Number(it.quantity);
        if (!productId) throw createError(ERROR_CODES.VALIDATION_ERROR, 'items[].product_id is required');
        if (!Number.isFinite(qty) || qty <= 0) {
          throw createError(ERROR_CODES.VALIDATION_ERROR, 'items[].quantity must be > 0');
        }

        const product = this.db.prepare('SELECT id, name, sku FROM products WHERE id = ?').get(productId);
        if (!product) throw createError(ERROR_CODES.NOT_FOUND, `Product not found: ${productId}`);

        const unitCost =
          it.unit_cost !== undefined && it.unit_cost !== null
            ? Number(it.unit_cost)
            : getFallbackUnitCost(productId);
        const safeUnitCost = Number.isFinite(unitCost) && unitCost >= 0 ? unitCost : 0;

        const lineTotal = safeUnitCost * qty;
        totalAmount += lineTotal;

        // Insert return item snapshot
        this.db
          .prepare(
            `
            INSERT INTO supplier_return_items (
              id, return_id, product_id, product_name, product_sku,
              quantity, unit_cost, line_total, reason, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `
          )
          .run(
            randomUUID(),
            returnId,
            productId,
            product.name || productId,
            product.sku || '',
            qty,
            safeUnitCost,
            lineTotal,
            it.reason || null,
            now
          );

        // Decrease stock (warehouse -> supplier)
        // This writes to inventory_movements (source of truth) and also keeps legacy stock_balances in sync.
        if (payload.status !== 'draft') {
          this.inventoryService._updateBalance(
            productId,
            warehouseId,
            -qty,
            'supplier_return',
            'supplier_return',
            returnId,
            payload.return_reason || 'Supplier return',
            payload.created_by || null
          );
        }
      }

      // Update header total_amount
      this.db
        .prepare(`UPDATE supplier_returns SET total_amount = ?, updated_at = ? WHERE id = ?`)
        .run(totalAmount, now, returnId);

      // Write credit note to supplier_payments (reduces debt automatically)
      // Use positive amount (credit in ledger logic).
      if ((payload.status || 'completed') !== 'draft' && totalAmount > 0) {
        const cols = this.db.prepare(`PRAGMA table_info(supplier_payments)`).all().map((c) => c.name);
        const hasNotes = cols.includes('notes');
        const hasNote = cols.includes('note');
        const notesCol = hasNotes ? 'notes' : hasNote ? 'note' : null;
        const hasReferenceNumber = cols.includes('reference_number');

        const paymentId = randomUUID();
        const paymentNumber = `SCN-${Date.now()}`; // Supplier Credit Note

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
          paymentId,
          paymentNumber,
          supplierId,
          payload.purchase_order_id || null,
          totalAmount,
          'credit_note',
          `${returnDate} 00:00:00`,
        ];

        if (hasReferenceNumber) {
          insertCols.push('reference_number');
          values.push(returnNumber);
        }

        if (notesCol) {
          insertCols.push(notesCol);
          values.push(`Supplier return credit note: ${returnNumber}`);
        }

        insertCols.push('created_by', 'created_at');
        values.push(payload.created_by || null, now);

        const placeholders = insertCols.map(() => '?').join(', ');
        this.db
          .prepare(`INSERT INTO supplier_payments (${insertCols.join(', ')}) VALUES (${placeholders})`)
          .run(...values);

        // Update cached fields on purchase_orders if linked and columns exist (optional)
        if (payload.purchase_order_id) {
          try {
            const poCols = this.db.prepare(`PRAGMA table_info(purchase_orders)`).all().map((c) => c.name);
            if (poCols.includes('paid_amount') && poCols.includes('payment_status')) {
              const totalRow = this.db
                .prepare(`SELECT total_amount FROM purchase_orders WHERE id = ?`)
                .get(payload.purchase_order_id);
              const total = Number(totalRow?.total_amount ?? 0);
              const sumRow = this.db
                .prepare(
                  `
                  SELECT COALESCE(SUM(amount), 0) AS paid_amount
                  FROM supplier_payments
                  WHERE purchase_order_id = ?
                `
                )
                .get(payload.purchase_order_id);
              const paid = Number(sumRow?.paid_amount ?? 0);
              const status = paid <= 0 ? 'UNPAID' : paid >= total ? 'PAID' : 'PARTIALLY_PAID';
              this.db
                .prepare(`UPDATE purchase_orders SET paid_amount = ?, payment_status = ?, updated_at = datetime('now') WHERE id = ?`)
                .run(paid, status, payload.purchase_order_id);
            }
          } catch {
            // ignore
          }
        }
      }

      return this.get(returnId);
    });

    return tx();
  }

  get(id) {
    if (!id) throw createError(ERROR_CODES.VALIDATION_ERROR, 'id is required');

    const row = this.db
      .prepare(
        `
        SELECT sr.*, s.name AS supplier_name, po.po_number AS po_number
        FROM supplier_returns sr
        LEFT JOIN suppliers s ON s.id = sr.supplier_id
        LEFT JOIN purchase_orders po ON po.id = sr.purchase_order_id
        WHERE sr.id = ?
      `
      )
      .get(id);

    if (!row) throw createError(ERROR_CODES.NOT_FOUND, 'Supplier return not found');

    const items = this.db
      .prepare(
        `
        SELECT sri.*
        FROM supplier_return_items sri
        WHERE sri.return_id = ?
        ORDER BY sri.created_at ASC
      `
      )
      .all(id);

    return { ...row, items };
  }

  list(filters = {}) {
    let query = `
      SELECT sr.*, s.name AS supplier_name, po.po_number AS po_number
      FROM supplier_returns sr
      LEFT JOIN suppliers s ON s.id = sr.supplier_id
      LEFT JOIN purchase_orders po ON po.id = sr.purchase_order_id
      WHERE 1=1
    `;
    const params = [];

    if (filters.supplier_id) {
      query += ' AND sr.supplier_id = ?';
      params.push(filters.supplier_id);
    }
    if (filters.purchase_order_id) {
      query += ' AND sr.purchase_order_id = ?';
      params.push(filters.purchase_order_id);
    }
    if (filters.status) {
      query += ' AND sr.status = ?';
      params.push(filters.status);
    }
    if (filters.date_from) {
      query += ' AND date(sr.created_at) >= date(?)';
      params.push(filters.date_from);
    }
    if (filters.date_to) {
      query += ' AND date(sr.created_at) <= date(?)';
      params.push(filters.date_to);
    }

    query += ' ORDER BY datetime(sr.created_at) DESC';

    const limit = Number.isFinite(Number(filters.limit)) ? Math.min(500, Math.max(1, Number(filters.limit))) : 100;
    const offset = Number.isFinite(Number(filters.offset)) ? Math.max(0, Number(filters.offset)) : 0;
    query += ' LIMIT ? OFFSET ?';
    params.push(limit, offset);

    return this.db.prepare(query).all(params);
  }
}

module.exports = SupplierReturnsService;


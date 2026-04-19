/**
 * Quotes Service (Smeta / Estimate)
 * Handles quotes, quote items, and conversion to sale
 */
const { randomUUID } = require('crypto');

class QuotesService {
  constructor(db, salesService = null) {
    this.db = db;
    this.salesService = salesService;
  }

  _hasTable(name) {
    try {
      const r = this.db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
      ).get(name);
      return !!r;
    } catch {
      return false;
    }
  }

  generateQuoteNumber() {
    if (!this._hasTable('quotes')) return 'QUOTE-000001';
    const row = this.db.prepare(`
      SELECT quote_number FROM quotes
      WHERE quote_number LIKE 'QUOTE-%'
      ORDER BY CAST(SUBSTR(quote_number, 7) AS INTEGER) DESC
      LIMIT 1
    `).get();
    if (!row || !row.quote_number) return 'QUOTE-000001';
    const match = String(row.quote_number).match(/^QUOTE-(\d+)$/);
    const next = match ? parseInt(match[1], 10) + 1 : 1;
    return `QUOTE-${String(next).padStart(6, '0')}`;
  }

  list(filters = {}) {
    if (!this._hasTable('quotes')) return [];
    let query = `
      SELECT q.*, COALESCE(u.full_name, u.username) as created_by_name
      FROM quotes q
      LEFT JOIN users u ON q.created_by = u.id
      WHERE 1=1
    `;
    const params = [];
    if (filters.status) {
      query += ' AND q.status = ?';
      params.push(filters.status);
    }
    if (filters.customer_id) {
      query += ' AND q.customer_id = ?';
      params.push(filters.customer_id);
    }
    if (filters.date_from) {
      query += ' AND q.created_at >= ?';
      params.push(filters.date_from);
    }
    if (filters.date_to) {
      query += ' AND q.created_at <= ?';
      params.push(filters.date_to + 'T23:59:59.999Z');
    }
    query += ' ORDER BY q.created_at DESC';
    if (filters.limit) {
      query += ' LIMIT ?';
      params.push(filters.limit);
    }
    const rows = this.db.prepare(query).all(params);
    const includeItems = filters.include_items !== false;
    if (includeItems && rows.length > 0) {
      const ids = rows.map((r) => r.id);
      const placeholders = ids.map(() => '?').join(',');
      const items = this.db.prepare(`
        SELECT * FROM quote_items WHERE quote_id IN (${placeholders})
        ORDER BY sort_order, created_at
      `).all(ids);
      const byQuote = new Map();
      for (const it of items) {
        if (!byQuote.has(it.quote_id)) byQuote.set(it.quote_id, []);
        byQuote.get(it.quote_id).push(it);
      }
      for (const r of rows) {
        r.items = byQuote.get(r.id) || [];
      }
    }
    return rows;
  }

  get(id) {
    if (!this._hasTable('quotes')) return null;
    const row = this.db.prepare(`
      SELECT q.*, COALESCE(u.full_name, u.username) as created_by_name
      FROM quotes q
      LEFT JOIN users u ON q.created_by = u.id
      WHERE q.id = ?
    `).get(id);
    if (!row) return null;
    const items = this.db.prepare(
      'SELECT * FROM quote_items WHERE quote_id = ? ORDER BY sort_order, created_at'
    ).all(id);
    row.items = items;
    return row;
  }

  create(data) {
    if (!this._hasTable('quotes')) {
      throw new Error('quotes table not found - run migrations');
    }
    const id = randomUUID();
    const quoteNumber = data.quote_number || this.generateQuoteNumber();
    const subtotal = Number(data.subtotal) || 0;
    const discountAmount = Number(data.discount_amount) || 0;
    const discountPercent = Number(data.discount_percent) || 0;
    const total = Number(data.total) || subtotal - discountAmount;
    const totalProfit = data.total_profit != null ? Number(data.total_profit) : null;
    const validUntil = data.valid_until || null;
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO quotes (
        id, quote_number, customer_id, customer_name, phone,
        price_type, status, subtotal, discount_amount, discount_percent,
        total, total_profit, valid_until, notes, created_at, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, quoteNumber, data.customer_id || null, data.customer_name || '',
      data.phone || null, data.price_type || 'retail', data.status || 'draft',
      subtotal, discountAmount, discountPercent, total, totalProfit,
      validUntil, data.notes || null, now, data.created_by || 'default-admin-001'
    );

    const items = data.items || [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const itemId = randomUUID();
      const qty = Number(it.quantity) || 1;
      const unitPrice = Number(it.unit_price) || 0;
      const discPct = Number(it.discount_percent) || 0;
      const discAmt = Number(it.discount_amount) || 0;
      const lineTotal = Number(it.line_total) ?? (unitPrice * qty - discAmt);
      const lineProfit = it.line_profit != null ? Number(it.line_profit) : null;
        const retailPrice = it.retail_price ?? null;
        const ustaPrice = it.usta_price ?? null;
        const hasRetailUsta = this.db.prepare('PRAGMA table_info(quote_items)').all().some((c) => c.name === 'retail_price');
        const cols = hasRetailUsta
          ? 'id, quote_id, product_id, name_snapshot, sku_snapshot, unit, quantity, unit_price, price_type_used, override_price, retail_price, usta_price, discount_percent, discount_amount, cost_price, line_total, line_profit, sort_order'
          : 'id, quote_id, product_id, name_snapshot, sku_snapshot, unit, quantity, unit_price, price_type_used, override_price, discount_percent, discount_amount, cost_price, line_total, line_profit, sort_order';
        const vals = hasRetailUsta
          ? [itemId, id, it.product_id, it.name_snapshot || it.product_name || '', it.sku_snapshot || it.sku || null, it.unit || 'pcs', qty, unitPrice, it.price_type_used || 'retail', it.override_price ?? null, retailPrice, ustaPrice, discPct, discAmt, it.cost_price ?? null, lineTotal, lineProfit, i]
          : [itemId, id, it.product_id, it.name_snapshot || it.product_name || '', it.sku_snapshot || it.sku || null, it.unit || 'pcs', qty, unitPrice, it.price_type_used || 'retail', it.override_price ?? null, discPct, discAmt, it.cost_price ?? null, lineTotal, lineProfit, i];
        const placeholders = vals.map(() => '?').join(', ');
        this.db.prepare(`INSERT INTO quote_items (${cols}) VALUES (${placeholders})`).run(...vals);
    }

    return this.get(id);
  }

  update(id, data) {
    if (!this._hasTable('quotes')) return null;
    const existing = this.get(id);
    if (!existing) return null;

    const updates = [];
    const params = [];
    const fields = [
      'customer_id', 'customer_name', 'phone', 'price_type', 'status',
      'subtotal', 'discount_amount', 'discount_percent', 'total', 'total_profit',
      'valid_until', 'notes'
    ];
    for (const f of fields) {
      if (data[f] !== undefined) {
        updates.push(`${f} = ?`);
        params.push(data[f]);
      }
    }
    if (updates.length > 0) {
      updates.push('updated_at = ?');
      params.push(new Date().toISOString());
      params.push(id);
      this.db.prepare(`
        UPDATE quotes SET ${updates.join(', ')} WHERE id = ?
      `).run(...params);
    }

    if (data.items && Array.isArray(data.items)) {
      this.db.prepare('DELETE FROM quote_items WHERE quote_id = ?').run(id);
      for (let i = 0; i < data.items.length; i++) {
        const it = data.items[i];
        const itemId = it.id || randomUUID();
        const qty = Number(it.quantity) || 1;
        const unitPrice = Number(it.unit_price) || 0;
        const discAmt = Number(it.discount_amount) || 0;
        const lineTotal = Number(it.line_total) ?? (unitPrice * qty - discAmt);
        const lineProfit = it.line_profit != null ? Number(it.line_profit) : null;
        const retailPrice = it.retail_price ?? null;
        const ustaPrice = it.usta_price ?? null;
        const hasRetailUsta = this.db.prepare('PRAGMA table_info(quote_items)').all().some((c) => c.name === 'retail_price');
        const cols = hasRetailUsta
          ? 'id, quote_id, product_id, name_snapshot, sku_snapshot, unit, quantity, unit_price, price_type_used, override_price, retail_price, usta_price, discount_percent, discount_amount, cost_price, line_total, line_profit, sort_order'
          : 'id, quote_id, product_id, name_snapshot, sku_snapshot, unit, quantity, unit_price, price_type_used, override_price, discount_percent, discount_amount, cost_price, line_total, line_profit, sort_order';
        const vals = hasRetailUsta
          ? [itemId, id, it.product_id, it.name_snapshot || it.product_name || '', it.sku_snapshot || it.sku || null, it.unit || 'pcs', qty, unitPrice, it.price_type_used || 'retail', it.override_price ?? null, retailPrice, ustaPrice, Number(it.discount_percent) || 0, discAmt, it.cost_price ?? null, lineTotal, lineProfit, i]
          : [itemId, id, it.product_id, it.name_snapshot || it.product_name || '', it.sku_snapshot || it.sku || null, it.unit || 'pcs', qty, unitPrice, it.price_type_used || 'retail', it.override_price ?? null, Number(it.discount_percent) || 0, discAmt, it.cost_price ?? null, lineTotal, lineProfit, i];
        const placeholders = vals.map(() => '?').join(', ');
        this.db.prepare(`INSERT INTO quote_items (${cols}) VALUES (${placeholders})`).run(...vals);
      }
    }

    return this.get(id);
  }

  delete(id) {
    if (!this._hasTable('quotes')) return;
    this.db.prepare('DELETE FROM quote_items WHERE quote_id = ?').run(id);
    this.db.prepare('DELETE FROM quotes WHERE id = ?').run(id);
  }

  /**
   * Convert quote to sale (POS order)
   * Returns { order_id, order_number } on success
   */
  convertToSale(quoteId, orderData) {
    const quote = this.get(quoteId);
    if (!quote) throw new Error('Quote not found');
    if (quote.status === 'converted') {
      throw new Error('Quote already converted to sale');
    }
    if (!this.salesService || typeof this.salesService.completePOSOrder !== 'function') {
      throw new Error('Sales service not available for conversion');
    }

    const items = quote.items.map((it) => ({
      product_id: it.product_id,
      quantity: it.quantity,
      unit_price: it.unit_price,
      discount_amount: it.discount_amount || 0,
      discount_percent: it.discount_percent || 0,
      price_tier: it.price_type_used === 'usta' ? 'master' : 'retail',
    }));

    const payments = orderData.payments || [
      { method: 'cash', amount: quote.total }
    ];

    const result = this.salesService.completePOSOrder(
      {
        customer_id: quote.customer_id || null,
        ...orderData,
      },
      items,
      payments
    );

    this.db.prepare(`
      UPDATE quotes SET status = 'converted', converted_order_id = ?, updated_at = ?
      WHERE id = ?
    `).run(
      result.order_id,
      new Date().toISOString(),
      quoteId
    );

    return result;
  }
}

module.exports = { QuotesService };

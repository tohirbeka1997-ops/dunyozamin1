const { ERROR_CODES, createError } = require('../lib/errors.cjs');
const { randomUUID } = require('crypto');

/**
 * Expenses Service
 * Handles expense categories and expenses
 */
class ExpensesService {
  constructor(db) {
    this.db = db;
    this._expenseColCache = null;
  }

  _hasExpenseCol(name) {
    if (!this._expenseColCache) {
      try {
        this._expenseColCache = new Set(
          this.db.prepare('PRAGMA table_info(expenses)').all().map((c) => c.name)
        );
      } catch {
        this._expenseColCache = new Set();
      }
    }
    return this._expenseColCache.has(name);
  }

  _resolveExpenseCurrency(data) {
    const hasCurrency = this._hasExpenseCol('currency');
    if (!hasCurrency) return { currency: 'UZS', fx_rate: null };
    const currency =
      String(data.currency || 'UZS').trim().toUpperCase() === 'USD' ? 'USD' : 'UZS';
    const fx = currency === 'USD' ? Number(data.fx_rate ?? data.exchange_rate ?? 0) : null;
    if (currency === 'USD' && (!Number.isFinite(fx) || fx <= 0)) {
      throw createError(
        ERROR_CODES.VALIDATION_ERROR,
        'fx_rate is required for USD expenses (UZS per 1 USD)'
      );
    }
    return { currency, fx_rate: currency === 'USD' ? fx : null };
  }

  /**
   * List expense categories
   */
  listCategories(filters = {}) {
    let query = 'SELECT * FROM expense_categories WHERE 1=1';
    const params = [];

    if (filters.is_active !== undefined) {
      query += ' AND is_active = ?';
      params.push(filters.is_active ? 1 : 0);
    }

    query += ' ORDER BY name ASC';

    return this.db.prepare(query).all(params);
  }

  /**
   * Create expense category
   */
  createCategory(data) {
    if (!data.code || !data.code.trim()) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Category code is required');
    }

    if (!data.name || !data.name.trim()) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Category name is required');
    }

    const id = randomUUID();

    try {
      this.db.prepare(`
        INSERT INTO expense_categories (id, code, name, description, is_active, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        id,
        data.code.trim().toUpperCase(),
        data.name.trim(),
        data.description?.trim() || null,
        data.is_active !== undefined ? (data.is_active ? 1 : 0) : 1,
        new Date().toISOString()
      );

      return this.db.prepare('SELECT * FROM expense_categories WHERE id = ?').get(id);
    } catch (error) {
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        throw createError(ERROR_CODES.VALIDATION_ERROR, 'Category code must be unique');
      }
      throw error;
    }
  }

  /**
   * Update expense category
   */
  updateCategory(id, data) {
    if (!id) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Category ID is required');
    }

    const existing = this.db.prepare('SELECT * FROM expense_categories WHERE id = ?').get(id);
    if (!existing) {
      throw createError(ERROR_CODES.NOT_FOUND, `Category ${id} not found`);
    }

    const updates = [];
    const params = [];

    if (data.code !== undefined) {
      updates.push('code = ?');
      params.push(data.code.trim().toUpperCase());
    }

    if (data.name !== undefined) {
      updates.push('name = ?');
      params.push(data.name.trim());
    }

    if (data.description !== undefined) {
      updates.push('description = ?');
      params.push(data.description?.trim() || null);
    }

    if (data.is_active !== undefined) {
      updates.push('is_active = ?');
      params.push(data.is_active ? 1 : 0);
    }

    if (updates.length === 0) {
      return existing;
    }

    params.push(id);

    try {
      this.db.prepare(`UPDATE expense_categories SET ${updates.join(', ')} WHERE id = ?`).run(...params);
      return this.db.prepare('SELECT * FROM expense_categories WHERE id = ?').get(id);
    } catch (error) {
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        throw createError(ERROR_CODES.VALIDATION_ERROR, 'Category code must be unique');
      }
      throw error;
    }
  }

  /**
   * Delete expense category
   */
  deleteCategory(id) {
    if (!id) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Category ID is required');
    }

    const existing = this.db.prepare('SELECT * FROM expense_categories WHERE id = ?').get(id);
    if (!existing) {
      throw createError(ERROR_CODES.NOT_FOUND, `Category ${id} not found`);
    }

    // Check if category has expenses
    const expenseCount = this.db.prepare('SELECT COUNT(*) as count FROM expenses WHERE category_id = ?').get(id);
    if (expenseCount.count > 0) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Cannot delete category with associated expenses');
    }

    this.db.prepare('DELETE FROM expense_categories WHERE id = ?').run(id);
    return { success: true };
  }

  /**
   * List expenses
   */
  list(filters = {}) {
    let query = `
      SELECT e.*, ec.name as category_name
      FROM expenses e
      INNER JOIN expense_categories ec ON e.category_id = ec.id
      WHERE 1=1
    `;
    const params = [];

    if (filters.category_id) {
      query += ' AND e.category_id = ?';
      params.push(filters.category_id);
    }

    if (filters.status) {
      query += ' AND e.status = ?';
      params.push(filters.status);
    }

    if (filters.date_from) {
      query += ' AND e.expense_date >= ?';
      params.push(filters.date_from);
    }

    if (filters.date_to) {
      query += ' AND e.expense_date <= ?';
      params.push(filters.date_to);
    }

    query += ' ORDER BY e.expense_date DESC, e.created_at DESC';

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

  /**
   * Create expense
   */
  create(data) {
    if (!data.category_id) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Category ID is required');
    }

    if (!data.amount || data.amount <= 0) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Valid expense amount is required');
    }

    if (!data.expense_date) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Expense date is required');
    }

    if (!data.description || !data.description.trim()) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Description is required');
    }

    // Verify category exists
    const category = this.db.prepare('SELECT * FROM expense_categories WHERE id = ?').get(data.category_id);
    if (!category) {
      throw createError(ERROR_CODES.NOT_FOUND, `Category ${data.category_id} not found`);
    }

    const id = randomUUID();
    const expenseNumber = `EXP-${Date.now()}`;
    const now = new Date().toISOString();

    // Smena bilan bog'lash (kassa hisobotida xarajatlarni ko'rsatish uchun).
    // Auto-detect: agar shift_id berilmagan, foydalanuvchining ochiq smenasini topamiz.
    let resolvedShiftId = data.shift_id || null;
    if (!resolvedShiftId && data.created_by) {
      try {
        const openShift = this.db
          .prepare(
            `SELECT id FROM shifts
             WHERE (user_id = ? OR cashier_id = ?)
               AND status = 'open'
               AND closed_at IS NULL
             ORDER BY opened_at DESC
             LIMIT 1`
          )
          .get(data.created_by, data.created_by);
        if (openShift?.id) {
          resolvedShiftId = openShift.id;
        }
      } catch {
        /* shifts jadvali yoki user_id ustuni yo'q bo'lishi mumkin — e'tiborsiz */
      }
    }

    // shift_id ustuni eski bazalarda bo'lmasligi mumkin — schema-aware INSERT
    let hasShiftIdCol = false;
    try {
      const cols = this.db.prepare('PRAGMA table_info(expenses)').all();
      hasShiftIdCol = cols.some((c) => c.name === 'shift_id');
    } catch {
      hasShiftIdCol = false;
    }

    const { currency, fx_rate } = this._resolveExpenseCurrency(data);
    const hasCurrency = this._hasExpenseCol('currency');
    const hasFxRate = this._hasExpenseCol('fx_rate');

    const baseCols = [
      'id', 'expense_number', 'category_id', 'amount', 'payment_method', 'expense_date',
      'description', 'receipt_url', 'vendor', 'status', 'notes', 'created_by',
      'created_at', 'updated_at',
      ...(hasCurrency ? ['currency'] : []),
      ...(hasFxRate ? ['fx_rate'] : []),
    ];
    const baseVals = [
      id,
      expenseNumber,
      data.category_id,
      data.amount,
      data.payment_method || 'cash',
      data.expense_date,
      data.description.trim(),
      data.receipt_url || null,
      data.vendor || null,
      data.status || 'approved',
      data.notes || null,
      data.created_by || null,
      now,
      now,
      ...(hasCurrency ? [currency] : []),
      ...(hasFxRate ? [fx_rate] : []),
    ];
    const cols = hasShiftIdCol ? [...baseCols, 'shift_id'] : baseCols;
    const vals = hasShiftIdCol ? [...baseVals, resolvedShiftId] : baseVals;
    const placeholders = cols.map(() => '?').join(', ');

    this.db
      .prepare(`INSERT INTO expenses (${cols.join(', ')}) VALUES (${placeholders})`)
      .run(...vals);

    return this.db.prepare(`
      SELECT e.*, ec.name as category_name
      FROM expenses e
      INNER JOIN expense_categories ec ON e.category_id = ec.id
      WHERE e.id = ?
    `).get(id);
  }

  /**
   * Update expense
   */
  update(id, data) {
    if (!id) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Expense ID is required');
    }

    const existing = this.db.prepare('SELECT * FROM expenses WHERE id = ?').get(id);
    if (!existing) {
      throw createError(ERROR_CODES.NOT_FOUND, `Expense ${id} not found`);
    }

    const updates = [];
    const params = [];

    if (data.category_id !== undefined) {
      updates.push('category_id = ?');
      params.push(data.category_id);
    }

    if (data.amount !== undefined) {
      if (data.amount <= 0) {
        throw createError(ERROR_CODES.VALIDATION_ERROR, 'Expense amount must be positive');
      }
      updates.push('amount = ?');
      params.push(data.amount);
    }

    if (data.payment_method !== undefined) {
      updates.push('payment_method = ?');
      params.push(data.payment_method);
    }

    if (data.expense_date !== undefined) {
      updates.push('expense_date = ?');
      params.push(data.expense_date);
    }

    if (data.description !== undefined) {
      updates.push('description = ?');
      params.push(data.description.trim());
    }

    if (data.status !== undefined) {
      updates.push('status = ?');
      params.push(data.status);
    }

    if (data.notes !== undefined) {
      updates.push('notes = ?');
      params.push(data.notes || null);
    }

    if (data.currency !== undefined || data.fx_rate !== undefined) {
      const merged = {
        currency: data.currency !== undefined ? data.currency : existing.currency,
        fx_rate: data.fx_rate !== undefined ? data.fx_rate : existing.fx_rate,
      };
      const { currency, fx_rate } = this._resolveExpenseCurrency(merged);
      if (this._hasExpenseCol('currency')) {
        updates.push('currency = ?');
        params.push(currency);
      }
      if (this._hasExpenseCol('fx_rate')) {
        updates.push('fx_rate = ?');
        params.push(fx_rate);
      }
    }

    if (updates.length === 0) {
      return existing;
    }

    updates.push('updated_at = ?');
    params.push(new Date().toISOString());
    params.push(id);

    this.db.prepare(`UPDATE expenses SET ${updates.join(', ')} WHERE id = ?`).run(...params);

    return this.db.prepare(`
      SELECT e.*, ec.name as category_name
      FROM expenses e
      INNER JOIN expense_categories ec ON e.category_id = ec.id
      WHERE e.id = ?
    `).get(id);
  }

  /**
   * Delete expense
   */
  delete(id) {
    if (!id) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Expense ID is required');
    }

    const existing = this.db.prepare('SELECT * FROM expenses WHERE id = ?').get(id);
    if (!existing) {
      throw createError(ERROR_CODES.NOT_FOUND, `Expense ${id} not found`);
    }

    this.db.prepare('DELETE FROM expenses WHERE id = ?').run(id);
    return { success: true };
  }
}

module.exports = ExpensesService;






















































const { ERROR_CODES, createError } = require('../lib/errors.cjs');
const { randomUUID } = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { isServerMode } = require('../lib/runtime.cjs');
const {
  nowSqlInTimeZone,
  formatYmdInTimeZone,
  UZBEKISTAN_TZ_SQLITE_OFFSET,
} = require('../lib/timezone.cjs');
const { getCurrentUserId } = require('../lib/currentUser.cjs');
const {
  hasCustomerBalanceUsd,
  hasCustomerPaymentCurrency,
  hasCustomerLedgerCurrency,
  normalizeCustomerCurrency,
  readCustomerBalances,
  readBalanceInCurrency,
  applyCustomerBalanceDelta,
} = require('../lib/customerBalance.cjs');
const { normalizePhoneUz, formatPhoneUz } = require('../lib/phoneNormalize.cjs');

/**
 * Customers Service
 * Handles customer CRUD operations
 */
class CustomersService {
  constructor(db) {
    this.db = db;
    this._customersColumns = null;
  }

  _getCustomersColumns() {
    if (this._customersColumns) return this._customersColumns;
    const cols = this.db.prepare(`PRAGMA table_info(customers)`).all() || [];
    this._customersColumns = new Set(cols.map((c) => c.name));
    return this._customersColumns;
  }

  _hasCol(name) {
    try {
      return this._getCustomersColumns().has(name);
    } catch {
      return false;
    }
  }

  _resolvePhoneFields(phone) {
    const raw = phone != null ? String(phone).trim() : '';
    if (!raw) {
      return { phone: null, phone_normalized: null };
    }
    const phone_normalized = normalizePhoneUz(raw);
    const formatted = formatPhoneUz(raw);
    return {
      phone: formatted || raw,
      phone_normalized,
    };
  }

  _throwDuplicatePhone(existing) {
    const err = createError(
      ERROR_CODES.DUPLICATE_PHONE,
      "Bu telefon raqami allaqachon ro'yxatdan o'tgan",
    );
    err.details = {
      existing_id: existing.id,
      existing_name: existing.name,
      existing_code: existing.code,
    };
    throw err;
  }

  _assertUniquePhoneNormalized(phoneNormalized, excludeId = null) {
    if (!phoneNormalized || !this._hasCol('phone_normalized')) return;
    let row;
    if (excludeId) {
      row = this.db
        .prepare(
          `SELECT id, name, code FROM customers WHERE phone_normalized = ? AND id != ? LIMIT 1`,
        )
        .get(phoneNormalized, excludeId);
    } else {
      row = this.db
        .prepare(
          `SELECT id, name, code FROM customers WHERE phone_normalized = ? LIMIT 1`,
        )
        .get(phoneNormalized);
    }
    if (row?.id) {
      this._throwDuplicatePhone(row);
    }
  }

  _phoneLookupOrderBy() {
    return `ORDER BY datetime(replace(replace(COALESCE(created_at, ''), 'T', ' '), 'Z', '')) ASC, id ASC`;
  }

  _phoneStorageCandidates(norm) {
    const candidates = [];
    const push = (v) => {
      if (v == null || v === '') return;
      const s = String(v);
      if (!candidates.includes(s)) candidates.push(s);
    };
    push(formatPhoneUz(norm));
    push(`+${norm}`);
    push(norm);
    if (norm.length === 12 && norm.startsWith('998')) {
      push(norm.slice(3));
      push(`8${norm.slice(3)}`);
    }
    return candidates;
  }

  _backfillPhoneNormalized(row, norm) {
    if (!row?.id || !norm || !this._hasCol('phone_normalized')) return row;
    if (row.phone_normalized && String(row.phone_normalized).trim() !== '') return row;
    this.db
      .prepare(`UPDATE customers SET phone_normalized = ? WHERE id = ?`)
      .run(norm, row.id);
    row.phone_normalized = norm;
    return row;
  }

  findByNormalizedPhone(phoneNormalized) {
    const norm =
      phoneNormalized != null && String(phoneNormalized).trim() !== ''
        ? String(phoneNormalized).trim()
        : null;
    if (!norm) return null;

    const orderBy = this._phoneLookupOrderBy();

    if (this._hasCol('phone_normalized')) {
      const byNorm = this.db
        .prepare(`SELECT * FROM customers WHERE phone_normalized = ? ${orderBy} LIMIT 1`)
        .get(norm);
      if (byNorm) return byNorm;
    }

    const candidates = this._phoneStorageCandidates(norm);
    if (candidates.length) {
      const placeholders = candidates.map(() => '?').join(', ');
      const byRaw = this.db
        .prepare(
          `SELECT * FROM customers WHERE phone IN (${placeholders}) ${orderBy} LIMIT 1`,
        )
        .get(...candidates);
      if (byRaw) return this._backfillPhoneNormalized(byRaw, norm);
    }

    const legacyFilter = this._hasCol('phone_normalized')
      ? `AND (phone_normalized IS NULL OR TRIM(COALESCE(phone_normalized, '')) = '')`
      : '';
    const legacyRows = this.db
      .prepare(
        `
        SELECT * FROM customers
        WHERE phone IS NOT NULL AND TRIM(phone) != ''
        ${legacyFilter}
        ${orderBy}
      `,
      )
      .all();
    for (const row of legacyRows) {
      if (normalizePhoneUz(row.phone) === norm) {
        return this._backfillPhoneNormalized(row, norm);
      }
    }

    return null;
  }

  findByPhone(rawPhone) {
    const { phone_normalized } = this._resolvePhoneFields(rawPhone);
    if (!phone_normalized) return null;
    return this.findByNormalizedPhone(phone_normalized);
  }

  findOrCreateByPhone(data = {}) {
    const name = data.name?.trim() || 'Onlayn mijoz';
    const { phone, phone_normalized } = this._resolvePhoneFields(data.phone);

    if (phone_normalized) {
      const existing = this.findByNormalizedPhone(phone_normalized);
      if (existing) {
        const updates = {};
        if (name && name !== existing.name) updates.name = name;
        if (phone && phone !== existing.phone) updates.phone = phone;
        if (Object.keys(updates).length) {
          return this.update(existing.id, updates);
        }
        return existing;
      }
    }

    return this.create({
      ...data,
      name,
      phone,
      phone_normalized,
      _skipDuplicateCheck: true,
    });
  }

  _insertCustomerRecord(id, code, data, resolvedPhone, now) {
    const row = {
      id,
      code: code.trim().toUpperCase(),
      name: data.name.trim(),
      phone: resolvedPhone.phone,
      email: data.email?.trim() || null,
      address: data.address?.trim() || null,
      type: data.type || 'individual',
      company_name: data.company_name?.trim() || null,
      tax_number: data.tax_number?.trim() || null,
      credit_limit: data.credit_limit || 0,
      allow_debt: data.allow_debt ? 1 : 0,
      allow_credit: data.allow_credit ? 1 : 0,
      balance: data.balance || 0,
      status: data.status || 'active',
      notes: data.notes?.trim() || null,
      created_at: now,
      updated_at: now,
    };
    if (this._hasCol('pricing_tier')) {
      row.pricing_tier = data.pricing_tier === 'master' ? 'master' : 'retail';
    }
    if (this._hasCol('bonus_points')) {
      row.bonus_points = Number(data.bonus_points) || 0;
    }
    if (this._hasCol('phone_normalized')) {
      row.phone_normalized = resolvedPhone.phone_normalized;
    }
    const cols = Object.keys(row);
    const vals = Object.values(row);
    this.db
      .prepare(
        `INSERT INTO customers (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
      )
      .run(...vals);
  }

  _tzDateExpr(columnExpr) {
    return `date(datetime(replace(replace(${columnExpr}, 'T', ' '), 'Z', ''), '${UZBEKISTAN_TZ_SQLITE_OFFSET}'))`;
  }

  /**
   * customer_payments.received_by references users(id). Renderer user id may not
   * exist in users; main-process session (login) is tried next, then defaults.
   */
  _resolveReceivedByForPayment(receivedBy) {
    const KNOWN_DEFAULT_USER = 'default-admin-001';
    const candidates = [];
    const push = (v) => {
      if (v == null || v === '') return;
      const s = String(v).trim();
      if (s && !candidates.includes(s)) candidates.push(s);
    };
    push(receivedBy);
    push(getCurrentUserId());

    for (const id of candidates) {
      const row = this.db.prepare('SELECT id FROM users WHERE id = ?').get(id);
      if (row?.id) return id;
    }

    if (candidates.length) {
      console.warn(
        '[CustomersService.receivePayment] received_by / session user not in users table; tried:',
        candidates
      );
    }

    const def = this.db
      .prepare('SELECT id FROM users WHERE id = ?')
      .get(KNOWN_DEFAULT_USER);
    if (def?.id) return KNOWN_DEFAULT_USER;

    let any = null;
    try {
      any = this.db
        .prepare(
          `SELECT id FROM users WHERE COALESCE(is_active, 1) = 1 ORDER BY datetime(created_at) ASC LIMIT 1`
        )
        .get();
    } catch {
      try {
        any = this.db
          .prepare(`SELECT id FROM users ORDER BY datetime(created_at) ASC LIMIT 1`)
          .get();
      } catch {
        any = null;
      }
    }
    return any?.id || null;
  }

  /**
   * Optional shift link — only if shift row exists (avoids FK issues if schema/tooling adds one).
   */
  _normalizeShiftIdForPayment(shiftId) {
    const raw =
      shiftId != null && shiftId !== '' ? String(shiftId).trim() : '';
    if (!raw) return null;
    try {
      const row = this.db.prepare(`SELECT id FROM shifts WHERE id = ?`).get(raw);
      if (row?.id) return raw;
    } catch {
      return null;
    }
    console.warn(
      '[CustomersService.receivePayment] shift_id not found in shifts; omitting:',
      raw
    );
    return null;
  }

  /**
   * customer_payments.order_id references orders(id); empty or stale IDs break FK.
   */
  _normalizeOrderIdForPayment(orderId) {
    const raw =
      orderId != null && orderId !== '' ? String(orderId).trim() : '';
    if (!raw) return null;
    const ord = this.db.prepare('SELECT id FROM orders WHERE id = ?').get(raw);
    if (ord?.id) return raw;
    console.warn(
      '[CustomersService.receivePayment] order_id not in orders; omitting:',
      raw
    );
    return null;
  }

  /**
   * List customers
   */
  list(filters = {}) {
    let query = 'SELECT * FROM customers WHERE 1=1';
    const params = [];

    if (filters.search) {
      const trimmed = String(filters.search).trim();
      const searchTerm = `%${trimmed}%`;
      let clause =
        '(name LIKE ? COLLATE NOCASE OR phone LIKE ? OR email LIKE ? COLLATE NOCASE OR id LIKE ?)';
      params.push(searchTerm, searchTerm, searchTerm, searchTerm);
      const digits = trimmed.replace(/\D/g, '');
      if (digits.length >= 3) {
        clause +=
          " OR replace(replace(replace(replace(replace(phone, ' ', ''), '-', ''), '+', ''), '(', ''), ')', '') LIKE ?";
        params.push(`%${digits}%`);
      }
      query += ` AND (${clause})`;
    }

    if (filters.status && filters.status !== 'all') {
      query += ' AND status = ?';
      params.push(filters.status);
    }

    if (filters.type && filters.type !== 'all') {
      query += ' AND type = ?';
      params.push(filters.type);
    }

    const sortByRaw = String(filters.sortBy || 'created_at').toLowerCase();
    const sortOrderRaw = String(filters.sortOrder || 'desc').toLowerCase();
    const sortOrder = sortOrderRaw === 'asc' ? 'ASC' : 'DESC';
    const sortMap = {
      name: 'name',
      created_at: "datetime(replace(replace(created_at, 'T', ' '), 'Z', ''))",
      balance: 'COALESCE(balance, 0)',
      total_sales: 'COALESCE(total_sales, 0)',
      last_order_date: "datetime(replace(replace(COALESCE(last_order_date, created_at), 'T', ' '), 'Z', ''))",
    };
    const sortExpr = sortMap[sortByRaw] || sortMap.created_at;
    query += ` ORDER BY ${sortExpr} ${sortOrder}, name ASC`;

    return this.db.prepare(query).all(params);
  }

  _hasTable(name) {
    try {
      const row = this.db
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
        .get(name);
      return !!row?.name;
    } catch {
      return false;
    }
  }

  /**
   * Count POS + linked web orders and UZS-equivalent sales from source tables.
   */
  computeOrderStats(customerId) {
    const KNOWN_DEFAULT = 'default-customer-001';
    if (!customerId || customerId === KNOWN_DEFAULT) {
      return { order_count: 0, total_sales_uzs: 0 };
    }

    const hasOrderCurrency = this._hasTableColumn('orders', 'currency');
    const hasOrderFx = this._hasTableColumn('orders', 'fx_rate');
    const salesExpr = hasOrderCurrency && hasOrderFx
      ? `CASE WHEN UPPER(TRIM(COALESCE(o.currency, 'UZS'))) = 'USD'
            THEN COALESCE(o.total_amount, 0) * COALESCE(o.fx_rate, 0)
            ELSE COALESCE(o.total_amount, 0) END`
      : 'COALESCE(o.total_amount, 0)';

    const posRow = this.db
      .prepare(
        `
      SELECT COUNT(*) AS cnt, COALESCE(SUM(${salesExpr}), 0) AS sales_uzs
      FROM orders o
      WHERE o.customer_id = ?
        AND o.status NOT IN ('voided', 'cancelled', 'draft', 'hold', 'pending', 'on_hold', 'amended', 'refunded', 'returned')
    `,
      )
      .get(customerId);

    let webCnt = 0;
    let webSales = 0;
    if (this._hasTable('web_orders') && this._hasTable('marketplace_customer_bindings')) {
      const mcIds = this.db
        .prepare(
          `SELECT marketplace_customer_id FROM marketplace_customer_bindings WHERE pos_customer_id = ?`,
        )
        .all(customerId)
        .map((r) => Number(r.marketplace_customer_id))
        .filter((n) => Number.isFinite(n));
      if (mcIds.length > 0) {
        const ph = mcIds.map(() => '?').join(',');
        const webRow = this.db
          .prepare(
            `
          SELECT COUNT(*) AS cnt, COALESCE(SUM(COALESCE(total_amount, 0)), 0) AS sales_uzs
          FROM web_orders
          WHERE customer_id IN (${ph})
            AND status NOT IN ('cancelled', 'rejected')
        `,
          )
          .get(...mcIds);
        webCnt = Number(webRow?.cnt || 0);
        webSales = Number(webRow?.sales_uzs || 0);
      }
    }

    return {
      order_count: Number(posRow?.cnt || 0) + webCnt,
      total_sales_uzs: Number(posRow?.sales_uzs || 0) + webSales,
    };
  }

  _hasTableColumn(table, column) {
    try {
      const cols = this.db.prepare(`PRAGMA table_info(${table})`).all() || [];
      return cols.some((c) => c.name === column);
    } catch {
      return false;
    }
  }

  /**
   * Repair customers.total_orders / total_sales when counters drift from orders table.
   */
  reconcileOrderStats(customerId, { write = true } = {}) {
    const stats = this.computeOrderStats(customerId);
    if (!write) return stats;

    const stored = this.db
      .prepare(`SELECT total_orders, total_sales FROM customers WHERE id = ?`)
      .get(customerId);
    if (!stored) return stats;

    const storedOrders = Number(stored.total_orders || 0);
    const storedSales = Number(stored.total_sales || 0);
    const driftOrders = storedOrders !== stats.order_count;
    const driftSales = Math.abs(storedSales - stats.total_sales_uzs) > 0.5;
    if (!driftOrders && !driftSales) return stats;

    const now = nowSqlInTimeZone();
    this.db
      .prepare(
        `
      UPDATE customers
      SET total_orders = ?, total_sales = ?, updated_at = ?
      WHERE id = ?
    `,
      )
      .run(stats.order_count, stats.total_sales_uzs, now, customerId);
    return stats;
  }

  /**
   * Get customer by ID
   */
  getById(id) {
    if (!id) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Customer ID is required');
    }

    const customer = this.db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
    
    if (!customer) {
      throw createError(ERROR_CODES.NOT_FOUND, `Customer with id ${id} not found`);
    }

    try {
      const stats = this.reconcileOrderStats(id, { write: true });
      customer.total_orders = stats.order_count;
      customer.total_sales = stats.total_sales_uzs;
    } catch (reconcileErr) {
      console.warn('[CustomersService.getById] reconcileOrderStats failed:', reconcileErr.message);
    }

    return customer;
  }

  /**
   * Find POS customer by marketplace loyalty QR/card code.
   * Accepted inputs:
   * - "LOYALTY:LC-123-1" (QR payload)
   * - "LC-123-1" (plain card code)
   */
  getByLoyaltyQr(input) {
    const raw = String(input || '').trim();
    if (!raw) return null;
    const normalized = raw.toUpperCase().startsWith('LOYALTY:')
      ? raw.slice('LOYALTY:'.length).trim()
      : raw;
    if (!normalized) return null;

    const hasBindingTable = this.db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='marketplace_customer_bindings'`)
      .get();
    if (!hasBindingTable) return null;

    const row = this.db
      .prepare(
        `
        SELECT b.pos_customer_id
        FROM marketplace_customer_bindings b
        WHERE b.loyalty_card_code = ? OR b.qr_payload = ?
        LIMIT 1
      `,
      )
      .get(normalized, raw);
    if (!row?.pos_customer_id) return null;

    try {
      return this.getById(row.pos_customer_id);
    } catch {
      return null;
    }
  }

  getLoyaltyCardByCustomerId(customerId) {
    if (!customerId) return null;
    const hasBindingTable = this.db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='marketplace_customer_bindings'`)
      .get();
    if (!hasBindingTable) return null;
    const row = this.db
      .prepare(
        `
        SELECT loyalty_card_code, qr_payload, marketplace_customer_id, created_at
        FROM marketplace_customer_bindings
        WHERE pos_customer_id = ?
        LIMIT 1
      `,
      )
      .get(customerId);
    if (!row) return null;
    return row;
  }

  /**
   * Create customer
   */
  create(data) {
    if (!data.name || !data.name.trim()) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Customer name is required');
    }

    const resolvedPhone = data._skipDuplicateCheck
      ? {
          phone: data.phone ?? null,
          phone_normalized: data.phone_normalized ?? null,
        }
      : this._resolvePhoneFields(data.phone);

    if (!data._skipDuplicateCheck && resolvedPhone.phone_normalized) {
      const existing = this.findByNormalizedPhone(resolvedPhone.phone_normalized);
      if (existing) {
        this._throwDuplicatePhone(existing);
      }
    }

    const id = data.id || randomUUID();
    const now = nowSqlInTimeZone();

    // Generate code if not provided
    let code = data.code;
    if (!code) {
      const lastCustomer = this.db.prepare('SELECT code FROM customers WHERE code LIKE ? ORDER BY code DESC LIMIT 1')
        .get('CUST-%');
      if (lastCustomer && lastCustomer.code) {
        const lastNum = parseInt(lastCustomer.code.replace('CUST-', '')) || 0;
        code = `CUST-${String(lastNum + 1).padStart(4, '0')}`;
      } else {
        code = 'CUST-0001';
      }
    }

    try {
      this._insertCustomerRecord(id, code, data, resolvedPhone, now);
      return this.getById(id);
    } catch (error) {
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        if (
          String(error.message || '').includes('phone_normalized') ||
          String(error.message || '').includes('idx_customers_phone_normalized_unique')
        ) {
          const existing = resolvedPhone.phone_normalized
            ? this.findByNormalizedPhone(resolvedPhone.phone_normalized)
            : null;
          if (existing) {
            this._throwDuplicatePhone(existing);
          }
          throw createError(
            ERROR_CODES.DUPLICATE_PHONE,
            "Bu telefon raqami allaqachon ro'yxatdan o'tgan",
          );
        }
        throw createError(ERROR_CODES.VALIDATION_ERROR, 'Customer code must be unique');
      }
      throw error;
    }
  }

  /**
   * Update customer
   */
  update(id, data) {
    if (!id) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Customer ID is required');
    }

    const existing = this.getById(id);

    const updates = [];
    const params = [];

    if (data.name !== undefined) {
      if (!data.name || !data.name.trim()) {
        throw createError(ERROR_CODES.VALIDATION_ERROR, 'Customer name cannot be empty');
      }
      updates.push('name = ?');
      params.push(data.name.trim());
    }

    if (data.phone !== undefined) {
      const resolvedPhone = this._resolvePhoneFields(data.phone);
      this._assertUniquePhoneNormalized(resolvedPhone.phone_normalized, id);
      updates.push('phone = ?');
      params.push(resolvedPhone.phone);
      if (this._hasCol('phone_normalized')) {
        updates.push('phone_normalized = ?');
        params.push(resolvedPhone.phone_normalized);
      }
    }

    if (data.email !== undefined) {
      updates.push('email = ?');
      params.push(data.email?.trim() || null);
    }

    if (data.address !== undefined) {
      updates.push('address = ?');
      params.push(data.address?.trim() || null);
    }

    if (data.type !== undefined) {
      updates.push('type = ?');
      params.push(data.type);
    }

    if (data.company_name !== undefined) {
      updates.push('company_name = ?');
      params.push(data.company_name?.trim() || null);
    }

    if (data.tax_number !== undefined) {
      updates.push('tax_number = ?');
      params.push(data.tax_number?.trim() || null);
    }

    if (data.credit_limit !== undefined) {
      updates.push('credit_limit = ?');
      params.push(data.credit_limit);
    }

    if (data.allow_debt !== undefined) {
      updates.push('allow_debt = ?');
      params.push(data.allow_debt ? 1 : 0);
    }

    if (data.allow_credit !== undefined) {
      updates.push('allow_credit = ?');
      params.push(data.allow_credit ? 1 : 0);
    }

    if (data.balance !== undefined) {
      updates.push('balance = ?');
      params.push(data.balance);
    }

    if (data.status !== undefined) {
      updates.push('status = ?');
      params.push(data.status);
    }

    if (data.notes !== undefined) {
      updates.push('notes = ?');
      params.push(data.notes?.trim() || null);
    }

    if (data.pricing_tier !== undefined && this._hasCol('pricing_tier')) {
      updates.push('pricing_tier = ?');
      params.push(data.pricing_tier === 'master' ? 'master' : 'retail');
    }

    if (data.bonus_points !== undefined && this._hasCol('bonus_points')) {
      updates.push('bonus_points = ?');
      params.push(Number(data.bonus_points) || 0);
    }

    if (updates.length === 0) {
      return existing;
    }

    updates.push('updated_at = ?');
    params.push(nowSqlInTimeZone());
    params.push(id);

    try {
      this.db.prepare(`
        UPDATE customers 
        SET ${updates.join(', ')}
        WHERE id = ?
      `).run(...params);

      return this.getById(id);
    } catch (error) {
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        if (
          String(error.message || '').includes('phone_normalized') ||
          String(error.message || '').includes('idx_customers_phone_normalized_unique')
        ) {
          throw createError(
            ERROR_CODES.DUPLICATE_PHONE,
            "Bu telefon raqami allaqachon ro'yxatdan o'tgan",
          );
        }
        throw createError(ERROR_CODES.VALIDATION_ERROR, 'Customer code must be unique');
      }
      throw error;
    }
  }

  /**
   * Delete customer
   */
  delete(id) {
    if (!id) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Customer ID is required');
    }

    const existing = this.getById(id);

    // Check if customer has orders
    const orderCount = this.db.prepare('SELECT COUNT(*) as count FROM orders WHERE customer_id = ?').get(id);
    if (orderCount.count > 0) {
      // Soft delete
      this.db.prepare('UPDATE customers SET status = ?, updated_at = ? WHERE id = ?').run(
        'inactive',
        nowSqlInTimeZone(),
        id
      );
      return { success: true, softDeleted: true };
    }

    // Hard delete
    this.db.prepare('DELETE FROM customers WHERE id = ?').run(id);

    return { success: true, softDeleted: false };
  }

  /**
   * Update customer balance (for debt/credit operations)
   * Balance logic: negative = debt, positive = prepaid, zero = settled
   * @param {string} customerId - Customer ID
   * @param {number} amount - Amount to add/subtract
   * @param {string} type - 'debt' (add debt, decrease balance) or 'payment' (reduce debt, increase balance)
   */
  updateBalance(customerId, amount, type, currency = 'UZS') {
    if (!customerId) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Customer ID is required');
    }

    this.getById(customerId);
    const amountValue = Number(amount) || 0;
    const cur = normalizeCustomerCurrency(currency);
    const balances = readCustomerBalances(this.db, customerId);
    const currentBalance = cur === 'USD' ? balances.usd : balances.uzs;
    let newBalance;

    if (type === 'debt' || type === 'credit') {
      newBalance = currentBalance - amountValue;
    } else if (type === 'payment') {
      newBalance = Math.min(0, currentBalance + amountValue);
    } else {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Invalid balance update type. Use "payment", "debt", or "credit"');
    }

    const delta = newBalance - currentBalance;
    const now = nowSqlInTimeZone();
    applyCustomerBalanceDelta(this.db, customerId, delta, cur, now);

    return this.getById(customerId);
  }

  /**
   * Receive payment from customer or give money to customer
   * Balance logic: negative = debt, positive = prepaid/credit, zero = settled
   * 
   * Operation:
   * - 'payment_in': Receive money from customer (increases balance)
   *   - balance = balance + amount
   *   - Example: balance = -9000, payment 3000 => new balance = -6000 (reduces debt)
   *   - Example: balance = +9000, payment 3000 => new balance = +12000 (increases credit)
   * - 'payment_out': Give money to customer (decreases balance)
   *   - balance = balance - amount
   *   - Example: balance = +9000, give 3000 => new balance = +6000 (reduces credit)
   *   - Example: balance = 0, give 3000 => new balance = -3000 (creates debt)
   * 
   * This is the SINGLE SOURCE OF TRUTH for customer payment logic.
   * 
   * @param {string} customerId - Customer ID
   * @param {number} amount - Payment amount (must be > 0, always positive)
   * @param {string} paymentMethod - 'cash', 'card', 'click', 'payme', 'transfer', 'other'
   * @param {string} notes - Optional notes
   * @param {string} receivedBy - User ID who received/gave the payment
   * @param {string} orderId - Optional order ID if payment is for specific order
   * @param {string} source - 'pos' or 'customers' (for logging)
   * @param {string} operation - 'payment_in' (receive) or 'payment_out' (give), required
   * @param {string|null} shiftId - ochiq smena ID (kassa / smena hisobi uchun)
   * @returns {Object} { customer_id, old_balance, requested_amount, applied_amount, new_balance, payment_id, payment_number, created_at }
   */
  receivePayment(
    customerId,
    amount,
    paymentMethod = 'cash',
    notes = null,
    receivedBy = null,
    orderId = null,
    source = null,
    operation = 'payment_in',
    shiftId = null,
    currency = 'UZS',
    fxRate = null
  ) {
    if (customerId && typeof customerId === 'object' && !Array.isArray(customerId)) {
      const p = customerId;
      return this.receivePayment(
        p.customer_id,
        p.amount,
        p.payment_method || p.method || 'cash',
        p.notes ?? p.note ?? null,
        p.received_by ?? p.receivedBy ?? null,
        p.order_id ?? p.orderId ?? null,
        p.source ?? null,
        p.operation || 'payment_in',
        p.shift_id ?? p.shiftId ?? null,
        p.currency ?? 'UZS',
        p.fx_rate ?? p.fxRate ?? null
      );
    }

    const normalizedCustomerId =
      customerId != null && customerId !== '' ? String(customerId).trim() : '';
    if (!normalizedCustomerId) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Customer ID is required');
    }

    // Validation: amount must be positive number
    const requestedAmount = Number(amount);
    if (!requestedAmount || requestedAmount <= 0 || isNaN(requestedAmount) || !isFinite(requestedAmount)) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Payment amount must be greater than zero');
    }

    // Validation: payment method required
    if (!paymentMethod) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Payment method is required');
    }

    // Validate operation type
    if (operation !== 'payment_in' && operation !== 'payment_out') {
      throw createError(ERROR_CODES.VALIDATION_ERROR, `Invalid operation type: ${operation}. Must be 'payment_in' or 'payment_out'`);
    }

    const resolvedReceivedBy = this._resolveReceivedByForPayment(receivedBy);
    const normalizedOrderId = this._normalizeOrderIdForPayment(orderId);
    const normalizedShiftId = this._normalizeShiftIdForPayment(shiftId);
    const payCurrency = normalizeCustomerCurrency(currency);
    const payFx =
      payCurrency === 'USD' ? Number(fxRate ?? 0) : null;
    if (payCurrency === 'USD' && (!Number.isFinite(payFx) || payFx <= 0)) {
      throw createError(
        ERROR_CODES.VALIDATION_ERROR,
        'fx_rate is required for USD customer payments (UZS per 1 USD)'
      );
    }

    // Use transaction for atomicity and consistency
    return this.db.transaction(() => {
      // Read current customer balance
      const customer = this.getById(normalizedCustomerId);
      const balancesBefore = readCustomerBalances(this.db, normalizedCustomerId);
      const oldBalance = readBalanceInCurrency(this.db, normalizedCustomerId, payCurrency);
      
      // Calculate signed amount based on operation type
      // CRITICAL: amount is always positive from UI, backend applies the sign
      let signedAmount = requestedAmount;
      if (operation === 'payment_out') {
        signedAmount = -requestedAmount; // Negative for giving money
      }
      // For 'payment_in', signedAmount remains positive (receiving money increases balance)
      
      // Calculate new balance: balance = balance + signedAmount
      // payment_in: balance = balance + amount (increases)
      // payment_out: balance = balance - amount (decreases)
      const newBalance = oldBalance + signedAmount;

      const now = nowSqlInTimeZone();

      // Log payment operation for debugging
      const operationLabel = operation === 'payment_in' ? 'Receiving' : 'Giving';
      console.log(`💰 ${operationLabel} customer payment:`, {
        customer_id: normalizedCustomerId,
        customer_name: customer.name,
        operation: operation,
        old_balance: oldBalance,
        requested_amount: requestedAmount,
        signed_amount: signedAmount,
        new_balance: newBalance,
        method: paymentMethod,
        source: source || 'unknown',
        balance_type: oldBalance < 0 ? 'debt' : oldBalance > 0 ? 'credit' : 'zero'
      });

      // Assertion: verify calculations are correct
      if (operation === 'payment_in' && signedAmount !== requestedAmount) {
        throw new Error(`CRITICAL: For payment_in, signed_amount (${signedAmount}) must equal requested_amount (${requestedAmount})`);
      }
      if (operation === 'payment_out' && signedAmount !== -requestedAmount) {
        throw new Error(`CRITICAL: For payment_out, signed_amount (${signedAmount}) must equal -requested_amount (${-requestedAmount})`);
      }
      if (newBalance !== oldBalance + signedAmount) {
        throw new Error(`CRITICAL: new_balance (${newBalance}) must equal old_balance (${oldBalance}) + signed_amount (${signedAmount})`);
      }

      // Update customer balance atomically using signed amount
      // This ensures: balance = balance + signedAmount
      // payment_in: balance = balance + amount (positive)
      // payment_out: balance = balance - amount (negative)
      let updateResult;
      if (hasCustomerBalanceUsd(this.db)) {
        const uzsDelta = payCurrency === 'UZS' ? signedAmount : 0;
        const usdDelta = payCurrency === 'USD' ? signedAmount : 0;
        updateResult = this.db
          .prepare(
            `UPDATE customers SET balance = balance + ?, balance_usd = balance_usd + ?, updated_at = ? WHERE id = ?`
          )
          .run(uzsDelta, usdDelta, now, normalizedCustomerId);
      } else {
        updateResult = this.db
          .prepare('UPDATE customers SET balance = balance + ?, updated_at = ? WHERE id = ?')
          .run(signedAmount, now, normalizedCustomerId);
      }

      if (updateResult.changes !== 1) {
        throw new Error(`CRITICAL: Failed to update customer balance. Expected 1 row updated, got ${updateResult.changes}`);
      }

      // Generate payment ID and number
      const paymentId = randomUUID();
      const paymentNumber = `PAY-${Date.now()}-${paymentId.substring(0, 8).toUpperCase()}`;
      
      // Insert ledger entry (single source of truth for balance changes)
      // Check if customer_ledger table exists before inserting
      try {
        const tableExists = this.db.prepare(`
          SELECT name FROM sqlite_master 
          WHERE type='table' AND name='customer_ledger'
        `).get();
        
        if (tableExists) {
          // Check if method column exists
          const tableInfo = this.db.prepare('PRAGMA table_info(customer_ledger)').all();
          const hasMethodColumn = tableInfo.some((col) => col.name === 'method');
          const hasLedgerCur = hasCustomerLedgerCurrency(this.db);
          const hasLedgerBalUsd = tableInfo.some((col) => col.name === 'balance_after_usd');
          const balancesAfter = readCustomerBalances(this.db, normalizedCustomerId);
          
          const ledgerId = randomUUID();
          // Ledger type matches operation type
          const ledgerNote = operation === 'payment_in' 
            ? (notes || `Pul qabul qilindi: ${paymentMethod}`)
            : (notes || `Pul berildi: ${paymentMethod}`);
          
          const ledgerCols = [
            'id',
            'customer_id',
            'type',
            'ref_id',
            'ref_no',
            'amount',
            'balance_after',
            'note',
          ];
          const ledgerVals = [
            ledgerId,
            normalizedCustomerId,
            operation,
            paymentId,
            paymentNumber,
            signedAmount,
            newBalance,
            ledgerNote,
          ];
          if (hasLedgerCur) {
            ledgerCols.push('currency');
            ledgerVals.push(payCurrency);
          }
          if (hasLedgerBalUsd) {
            ledgerCols.push('balance_after_usd');
            ledgerVals.push(balancesAfter.usd);
          }
          if (hasMethodColumn) {
            ledgerCols.push('method');
            ledgerVals.push(paymentMethod);
          }
          ledgerCols.push('created_at', 'created_by');
          ledgerVals.push(now, resolvedReceivedBy);
          const ph = ledgerCols.map(() => '?').join(', ');
          this.db
            .prepare(`INSERT INTO customer_ledger (${ledgerCols.join(', ')}) VALUES (${ph})`)
            .run(...ledgerVals);
          console.log('✅ Ledger entry inserted for payment:', { customerId: normalizedCustomerId, operation, signedAmount, newBalance });
        } else {
          console.warn('⚠️ customer_ledger table does not exist. Run migration 020_create_customer_ledger.sql');
        }
      } catch (ledgerError) {
        console.error('❌ Failed to insert ledger entry (non-critical):', ledgerError.message);
        // Don't throw - ledger insertion failure should not break payment
      }

      // Insert payment record into ledger with all balance tracking fields
      const tableInfo = this.db.prepare('PRAGMA table_info(customer_payments)').all();
      const hasLedgerFields = tableInfo.some((col) => col.name === 'old_balance');
      const hasShiftIdCol = tableInfo.some((col) => col.name === 'shift_id');
      const hasOperationCol = tableInfo.some((col) => col.name === 'operation');

      const cols = [
        'id',
        'payment_number',
        'customer_id',
        'order_id',
        'amount',
        'payment_method',
        'reference_number',
        'notes',
        'received_by',
        'paid_at',
        'created_at',
      ];
      const vals = [
        paymentId,
        paymentNumber,
        normalizedCustomerId,
        normalizedOrderId,
        requestedAmount,
        paymentMethod,
        null,
        notes || null,
        resolvedReceivedBy,
        now,
        now,
      ];
      if (hasLedgerFields) {
        cols.push('old_balance', 'applied_amount', 'new_balance');
        vals.push(oldBalance, requestedAmount, newBalance);
      }
      if (hasShiftIdCol) {
        cols.push('shift_id');
        vals.push(normalizedShiftId);
      }
      if (hasOperationCol) {
        cols.push('operation');
        vals.push(operation);
      }
      const ph = cols.map(() => '?').join(', ');
      this.db
        .prepare(`INSERT INTO customer_payments (${cols.join(', ')}) VALUES (${ph})`)
        .run(...vals);

      // Return standardized response with all required fields
      const finalBalances = readCustomerBalances(this.db, normalizedCustomerId);
      return {
        success: true,
        customer_id: normalizedCustomerId,
        currency: payCurrency,
        old_balance: oldBalance,
        new_balance: newBalance,
        old_balance_uzs: balancesBefore.uzs,
        new_balance_uzs: finalBalances.uzs,
        old_balance_usd: balancesBefore.usd,
        new_balance_usd: finalBalances.usd,
        requested_amount: requestedAmount,
        applied_amount: requestedAmount,
        signed_amount: signedAmount,
        payment_id: paymentId,
        payment_number: paymentNumber,
        created_at: now,
        operation,
      };
    })();
  }

  /**
   * List customer payments (customer_payments table)
   * @param {string} customerId - Customer ID
   * @param {Object} filters - Optional: { limit, offset }
   * @returns {Array} Array of payment rows
   */
  getPayments(customerId, filters = {}) {
    if (!customerId) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Customer ID is required');
    }

    let query = `
      SELECT cp.*
      FROM customer_payments cp
      WHERE cp.customer_id = ?
      ORDER BY cp.created_at DESC
    `;
    const params = [customerId];

    const limit = Number(filters.limit ?? 200);
    const offset = Number(filters.offset ?? 0);
    if (limit) {
      query += ' LIMIT ?';
      params.push(limit);
      if (offset) {
        query += ' OFFSET ?';
        params.push(offset);
      }
    }

    return this.db.prepare(query).all(params);
  }

  /**
   * Get customer ledger (account history)
   * Returns all balance-changing events for a customer
   * 
   * @param {string} customerId - Customer ID
   * @param {Object} filters - Optional filters: { limit, offset, from, to, type }
   * @returns {Array} Array of ledger entries
   */
  getLedger(customerId, filters = {}) {
    if (!customerId) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Customer ID is required');
    }

    // Check if customer_ledger table exists
    const tableExists = this.db.prepare(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name='customer_ledger'
    `).get();

    if (!tableExists) {
      console.warn('⚠️ customer_ledger table does not exist. Run migration 020_create_customer_ledger.sql');
      return [];
    }

    // Check if method column exists in customer_ledger table
    const tableInfo = this.db.prepare("PRAGMA table_info(customer_ledger)").all();
    const hasMethodColumn = tableInfo.some(col => col.name === 'method');
    
    // Build query based on actual schema
    const methodColumn = hasMethodColumn ? 'method' : 'NULL as method';
    let query = `
      SELECT 
        id,
        customer_id,
        type,
        ref_id,
        ref_no,
        amount,
        balance_after,
        note,
        ${methodColumn},
        created_at,
        created_by
      FROM customer_ledger
      WHERE customer_id = ?
    `;
    const params = [customerId];

    // Filter by type if provided
    if (filters.type && filters.type !== 'all') {
      query += ' AND type = ?';
      params.push(filters.type);
    }

    // Filter by date range if provided
    if (filters.from) {
      query += ` AND ${this._tzDateExpr('created_at')} >= date(?)`;
      params.push(filters.from);
    }
    if (filters.to) {
      query += ` AND ${this._tzDateExpr('created_at')} <= date(?)`;
      params.push(filters.to);
    }

    // Order by normalized datetime DESC (latest first).
    // We normalize mixed formats like:
    // - 2026-04-24 20:47:45
    // - 2026-04-24 20:47:45.7082
    // - 2026-04-24T20:47:45.708Z
    query += " ORDER BY datetime(replace(replace(created_at, 'T', ' '), 'Z', '')) DESC, created_at DESC";

    // Apply limit and offset if provided
    if (filters.limit) {
      query += ' LIMIT ?';
      params.push(filters.limit);
      if (filters.offset) {
        query += ' OFFSET ?';
        params.push(filters.offset);
      }
    } else {
      // Default limit if not provided
      query += ' LIMIT 100';
    }

    try {
      const results = this.db.prepare(query).all(params);
      console.log(`✅ Fetched ${results.length} ledger entries for customer ${customerId}`);
      return results;
    } catch (error) {
      console.error('❌ Error fetching ledger:', error.message);
      return [];
    }
  }

  /**
   * Get customer ledger count
   * Returns total number of ledger entries for a customer
   * 
   * @param {string} customerId - Customer ID
   * @returns {number} Total count of ledger entries
   */
  getLedgerCount(customerId) {
    if (!customerId) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Customer ID is required');
    }

    // Check if customer_ledger table exists
    const tableExists = this.db.prepare(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name='customer_ledger'
    `).get();

    if (!tableExists) {
      console.warn('⚠️ customer_ledger table does not exist. Run migration 020_create_customer_ledger.sql');
      return 0;
    }

    try {
      const result = this.db.prepare(`
        SELECT COUNT(*) as count
        FROM customer_ledger
        WHERE customer_id = ?
      `).get(customerId);
      
      return result?.count || 0;
    } catch (error) {
      console.error('❌ Error fetching ledger count:', error.message);
      return 0;
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
      `
        )
        .all(userId);
      return (rows || []).map((r) => String(r.code));
    } catch {
      return [];
    }
  }

  /**
   * Bonus points ledger (earn / redeem / adjust)
   */
  getBonusLedger(customerId, filters = {}) {
    if (!customerId) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Customer ID is required');
    }
    const t = this.db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='customer_bonus_ledger'`)
      .get();
    if (!t) return [];

    const limit = Math.min(500, Math.max(1, Number(filters.limit ?? 100)));
    const offset = Math.max(0, Number(filters.offset ?? 0));

    let query = `
      SELECT id, customer_id, type, points, order_id, note, created_at, created_by
      FROM customer_bonus_ledger
      WHERE customer_id = ?
    `;
    const params = [customerId];
    if (filters.type && filters.type !== 'all') {
      query += ' AND type = ?';
      params.push(filters.type);
    }
    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);
    try {
      return this.db.prepare(query).all(params);
    } catch (e) {
      console.error('getBonusLedger:', e?.message || e);
      return [];
    }
  }

  /**
   * Admin/manager adjustment to bonus_points with audit row.
   */
  adjustBonusPoints(actorUserId, customerId, deltaPoints, note) {
    if (!customerId) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Mijoz ID kerak');
    }
    const roles = this._getUserRoleCodes(actorUserId);
    if (!roles.some((r) => r === 'admin' || r === 'manager')) {
      throw createError(ERROR_CODES.FORBIDDEN, 'Bonus korreksiyasi faqat admin yoki menejer uchun');
    }
    if (!this._hasCol('bonus_points')) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'bonus_points ustuni mavjud emas');
    }
    const delta = Number(deltaPoints);
    if (!Number.isFinite(delta) || delta === 0) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Nol dan farqli ball kiriting');
    }

    const t = this.db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='customer_bonus_ledger'`)
      .get();
    if (!t) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'customer_bonus_ledger jadvali topilmadi');
    }

    const cust = this.db.prepare('SELECT bonus_points FROM customers WHERE id = ?').get(customerId);
    if (!cust) {
      throw createError(ERROR_CODES.NOT_FOUND, 'Mijoz topilmadi');
    }
    const before = Number(cust.bonus_points) || 0;
    const after = before + delta;
    if (after < -0.0001) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Ball manfiy bo‘lishi mumkin emas');
    }

    const now = nowSqlInTimeZone();
    this.db.transaction(() => {
      this.db
        .prepare('UPDATE customers SET bonus_points = ?, updated_at = ? WHERE id = ?')
        .run(after, now, customerId);
      const lid = randomUUID();
      this.db
        .prepare(
          `INSERT INTO customer_bonus_ledger (id, customer_id, type, points, order_id, note, created_at, created_by)
           VALUES (?, ?, 'adjust', ?, NULL, ?, ?, ?)`
        )
        .run(lid, customerId, delta, (note || 'Korreksiya').trim(), now, actorUserId || null);
    })();

    return this.getById(customerId);
  }

  /**
   * Export customers to CSV file
   * @param {Object} filters - Filters to apply (same as list method)
   * @param {Object} browserWindow - Electron BrowserWindow instance (optional, for dialog)
   * @returns {Promise<Object>} { cancelled: boolean, path?: string, count?: number }
   */
  async exportCsv(filters = {}, browserWindow = null) {
    try {
      // Get customers using existing list method
      const customers = this.list(filters);

      if (customers.length === 0) {
        return { cancelled: false, path: null, count: 0, message: 'No customers to export' };
      }

      // Build CSV content
      const hasBalanceUsd = hasCustomerBalanceUsd(this.db);
      const headers = [
        'id',
        'name',
        'phone',
        'type',
        'status',
        'balance',
        ...(hasBalanceUsd ? ['balance_usd'] : []),
        'total_sales',
        'last_order_date',
        'created_at',
      ];

      // CSV escape function
      const escapeCsv = (value) => {
        if (value === null || value === undefined) return '';
        const str = String(value);
        // If contains comma, quote, or newline, wrap in quotes and escape quotes
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      };

      // Build CSV rows
      const csvRows = [
        headers.join(',') // Header row
      ];

      for (const customer of customers) {
        const row = [
          escapeCsv(customer.id),
          escapeCsv(customer.name),
          escapeCsv(customer.phone),
          escapeCsv(customer.type),
          escapeCsv(customer.status),
          escapeCsv(customer.balance || 0),
          ...(hasBalanceUsd ? [escapeCsv(customer.balance_usd ?? 0)] : []),
          escapeCsv(customer.total_sales || 0),
          escapeCsv(customer.last_order_date || ''),
          escapeCsv(customer.created_at || '')
        ];
        csvRows.push(row.join(','));
      }

      const csvContent = csvRows.join('\n');

      const dateStr = formatYmdInTimeZone(new Date()) || 'export'; // YYYY-MM-DD (Asia/Tashkent)
      const defaultFilename = `customers_${dateStr}.csv`;

      let filePath;
      if (isServerMode()) {
        const base = process.env.POS_DATA_DIR
          ? path.resolve(String(process.env.POS_DATA_DIR).trim())
          : path.join(os.homedir(), '.pos-data');
        const exportDir = path.join(base, 'exports');
        if (!fs.existsSync(exportDir)) fs.mkdirSync(exportDir, { recursive: true });
        filePath = path.join(exportDir, defaultFilename);
      } else {
        const { dialog } = require('electron');
        const dialogOptions = {
          title: 'Export Customers to CSV',
          defaultPath: defaultFilename,
          filters: [
            { name: 'CSV Files', extensions: ['csv'] },
            { name: 'All Files', extensions: ['*'] }
          ]
        };
        const result = browserWindow
          ? await dialog.showSaveDialog(browserWindow, dialogOptions)
          : await dialog.showSaveDialog(dialogOptions);
        if (result.canceled || !result.filePath) {
          return { cancelled: true };
        }
        filePath = result.filePath;
      }

      fs.writeFileSync(filePath, csvContent, 'utf8');

      console.log(`✅ Exported ${customers.length} customers to ${filePath}`);

      return {
        cancelled: false,
        path: filePath,
        count: customers.length
      };
    } catch (error) {
      console.error('❌ Error exporting customers to CSV:', error);
      throw createError(ERROR_CODES.DB_ERROR, `Failed to export customers: ${error.message}`);
    }
  }
}

module.exports = CustomersService;





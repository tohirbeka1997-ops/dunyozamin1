const { ERROR_CODES, createError } = require('../lib/errors.cjs');
const { randomUUID } = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { isServerMode } = require('../lib/runtime.cjs');

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

  /**
   * List customers
   */
  list(filters = {}) {
    let query = 'SELECT * FROM customers WHERE 1=1';
    const params = [];

    if (filters.search) {
      query += ' AND (name LIKE ? OR phone LIKE ? OR email LIKE ?)';
      const searchTerm = `%${filters.search}%`;
      params.push(searchTerm, searchTerm, searchTerm);
    }

    if (filters.status && filters.status !== 'all') {
      query += ' AND status = ?';
      params.push(filters.status);
    }

    if (filters.type && filters.type !== 'all') {
      query += ' AND type = ?';
      params.push(filters.type);
    }

    query += ' ORDER BY name ASC';

    return this.db.prepare(query).all(params);
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

    return customer;
  }

  /**
   * Create customer
   */
  create(data) {
    if (!data.name || !data.name.trim()) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Customer name is required');
    }

    const id = data.id || randomUUID();
    const now = new Date().toISOString();

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
      const hasPricingTier = this._hasCol('pricing_tier');
      const hasBonus = this._hasCol('bonus_points');
      const bonusPoints = Number(data.bonus_points) || 0;

      if (hasPricingTier && hasBonus) {
        this.db.prepare(`
          INSERT INTO customers (
            id, code, name, phone, email, address, type, company_name, tax_number,
            pricing_tier,
            credit_limit, allow_debt, allow_credit, balance, status, notes, bonus_points, created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          id,
          code.trim().toUpperCase(),
          data.name.trim(),
          data.phone?.trim() || null,
          data.email?.trim() || null,
          data.address?.trim() || null,
          data.type || 'individual',
          data.company_name?.trim() || null,
          data.tax_number?.trim() || null,
          data.pricing_tier === 'master' ? 'master' : 'retail',
          data.credit_limit || 0,
          data.allow_debt ? 1 : 0,
          data.allow_credit ? 1 : 0,
          data.balance || 0,
          data.status || 'active',
          data.notes?.trim() || null,
          bonusPoints,
          now,
          now
        );
      } else if (hasPricingTier) {
        this.db.prepare(`
          INSERT INTO customers (
            id, code, name, phone, email, address, type, company_name, tax_number,
            pricing_tier,
            credit_limit, allow_debt, allow_credit, balance, status, notes, created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          id,
          code.trim().toUpperCase(),
          data.name.trim(),
          data.phone?.trim() || null,
          data.email?.trim() || null,
          data.address?.trim() || null,
          data.type || 'individual',
          data.company_name?.trim() || null,
          data.tax_number?.trim() || null,
          data.pricing_tier === 'master' ? 'master' : 'retail',
          data.credit_limit || 0,
          data.allow_debt ? 1 : 0,
          data.allow_credit ? 1 : 0,
          data.balance || 0,
          data.status || 'active',
          data.notes?.trim() || null,
          now,
          now
        );
      } else if (hasBonus) {
        this.db.prepare(`
          INSERT INTO customers (
            id, code, name, phone, email, address, type, company_name, tax_number,
            credit_limit, allow_debt, allow_credit, balance, status, notes, bonus_points, created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          id,
          code.trim().toUpperCase(),
          data.name.trim(),
          data.phone?.trim() || null,
          data.email?.trim() || null,
          data.address?.trim() || null,
          data.type || 'individual',
          data.company_name?.trim() || null,
          data.tax_number?.trim() || null,
          data.credit_limit || 0,
          data.allow_debt ? 1 : 0,
          data.allow_credit ? 1 : 0,
          data.balance || 0,
          data.status || 'active',
          data.notes?.trim() || null,
          bonusPoints,
          now,
          now
        );
      } else {
        this.db.prepare(`
          INSERT INTO customers (
            id, code, name, phone, email, address, type, company_name, tax_number,
            credit_limit, allow_debt, allow_credit, balance, status, notes, created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          id,
          code.trim().toUpperCase(),
          data.name.trim(),
          data.phone?.trim() || null,
          data.email?.trim() || null,
          data.address?.trim() || null,
          data.type || 'individual',
          data.company_name?.trim() || null,
          data.tax_number?.trim() || null,
          data.credit_limit || 0,
          data.allow_debt ? 1 : 0,
          data.allow_credit ? 1 : 0,
          data.balance || 0,
          data.status || 'active',
          data.notes?.trim() || null,
          now,
          now
        );
      }

      return this.getById(id);
    } catch (error) {
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
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
    params.push(new Date().toISOString());
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
        new Date().toISOString(),
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
  updateBalance(customerId, amount, type) {
    if (!customerId) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Customer ID is required');
    }

    const customer = this.getById(customerId);
    const amountValue = Number(amount) || 0;
    const currentBalance = Number(customer.balance) || 0;
    let newBalance;

    if (type === 'debt' || type === 'credit') {
      // Add debt: decrease balance (make it more negative)
      // Example: current = 0, debt = 5000 => new = -5000
      // Example: current = -2000, debt = 3000 => new = -5000
      newBalance = currentBalance - amountValue;
    } else if (type === 'payment') {
      // Payment: increase balance toward 0 (add to negative balance)
      // Example: current = -5000, payment = 3000 => new = -2000
      // Example: current = -5000, payment = 5000 => new = 0
      // Clamp to 0 to prevent overpayment creating positive balance
      newBalance = Math.min(0, currentBalance + amountValue);
    } else {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Invalid balance update type. Use "payment", "debt", or "credit"');
    }

    this.db.prepare('UPDATE customers SET balance = ?, updated_at = ? WHERE id = ?').run(
      newBalance,
      new Date().toISOString(),
      customerId
    );

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
   * @returns {Object} { customer_id, old_balance, requested_amount, applied_amount, new_balance, payment_id, payment_number, created_at }
   */
  receivePayment(customerId, amount, paymentMethod = 'cash', notes = null, receivedBy = null, orderId = null, source = null, operation = 'payment_in') {
    // Validation: customer_id required
    if (!customerId) {
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

    // Use transaction for atomicity and consistency
    return this.db.transaction(() => {
      // Read current customer balance
      const customer = this.getById(customerId);
      const oldBalance = Number(customer.balance) || 0;
      
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

      const now = new Date().toISOString();

      // Log payment operation for debugging
      const operationLabel = operation === 'payment_in' ? 'Receiving' : 'Giving';
      console.log(`💰 ${operationLabel} customer payment:`, {
        customer_id: customerId,
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
      const updateResult = this.db.prepare('UPDATE customers SET balance = balance + ?, updated_at = ? WHERE id = ?').run(
        signedAmount, // Signed amount: +amount for payment_in, -amount for payment_out
        now,
        customerId
      );

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
          const tableInfo = this.db.prepare("PRAGMA table_info(customer_ledger)").all();
          const hasMethodColumn = tableInfo.some(col => col.name === 'method');
          
          const ledgerId = randomUUID();
          // Ledger type matches operation type
          const ledgerNote = operation === 'payment_in' 
            ? (notes || `Pul qabul qilindi: ${paymentMethod}`)
            : (notes || `Pul berildi: ${paymentMethod}`);
          
          if (hasMethodColumn) {
            // Schema with method column
            this.db.prepare(`
              INSERT INTO customer_ledger (
                id, customer_id, type, ref_id, ref_no, amount, balance_after, note, method, created_at, created_by
              )
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              ledgerId,
              customerId,
              operation, // 'payment_in' or 'payment_out'
              paymentId,
              paymentNumber,
              signedAmount, // CRITICAL: Signed amount (positive for payment_in, negative for payment_out)
              newBalance,
              ledgerNote,
              paymentMethod,
              now,
              receivedBy || null
            );
          } else {
            // Schema without method column (backward compatibility)
            this.db.prepare(`
              INSERT INTO customer_ledger (
                id, customer_id, type, ref_id, ref_no, amount, balance_after, note, created_at, created_by
              )
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              ledgerId,
              customerId,
              operation, // 'payment_in' or 'payment_out'
              paymentId,
              paymentNumber,
              signedAmount, // CRITICAL: Signed amount (positive for payment_in, negative for payment_out)
              newBalance,
              ledgerNote || `Method: ${paymentMethod}`, // Include method in note if column doesn't exist
              now,
              receivedBy || null
            );
          }
          console.log('✅ Ledger entry inserted for payment:', { customerId, operation, signedAmount, newBalance });
        } else {
          console.warn('⚠️ customer_ledger table does not exist. Run migration 020_create_customer_ledger.sql');
        }
      } catch (ledgerError) {
        console.error('❌ Failed to insert ledger entry (non-critical):', ledgerError.message);
        // Don't throw - ledger insertion failure should not break payment
      }

      // Insert payment record into ledger with all balance tracking fields
      // Check if old_balance, applied_amount, new_balance columns exist (for backward compatibility)
      const tableInfo = this.db.prepare("PRAGMA table_info(customer_payments)").all();
      const hasLedgerFields = tableInfo.some(col => col.name === 'old_balance');

      if (hasLedgerFields) {
        // New schema with ledger fields
        this.db.prepare(`
          INSERT INTO customer_payments (
            id, payment_number, customer_id, order_id, amount,
            payment_method, reference_number, notes, received_by, paid_at, created_at,
            old_balance, applied_amount, new_balance
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          paymentId,
          paymentNumber,
          customerId,
          orderId || null,
          requestedAmount, // amount field (always positive for customer_payments table)
          paymentMethod,
          null, // reference_number
          notes || null,
          receivedBy || null,
          now,
          now,
          oldBalance, // old_balance ledger field
          requestedAmount, // applied_amount ledger field (always positive)
          newBalance // new_balance ledger field
        );
      } else {
        // Old schema without ledger fields (backward compatibility)
        this.db.prepare(`
          INSERT INTO customer_payments (
            id, payment_number, customer_id, order_id, amount,
            payment_method, reference_number, notes, received_by, paid_at, created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          paymentId,
          paymentNumber,
          customerId,
          orderId || null,
          requestedAmount, // amount field (always positive for customer_payments table)
          paymentMethod,
          null,
          notes || null,
          receivedBy || null,
          now,
          now
        );
      }

      // Return standardized response with all required fields
      return {
        success: true,
        customer_id: customerId,
        old_balance: oldBalance,
        requested_amount: requestedAmount, // Always positive (amount from UI)
        applied_amount: requestedAmount, // Always positive (amount from UI)
        signed_amount: signedAmount, // Signed amount (positive for payment_in, negative for payment_out)
        new_balance: newBalance,
        payment_id: paymentId,
        payment_number: paymentNumber,
        created_at: now,
        operation: operation // Include operation type in response
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
      query += ' AND created_at >= ?';
      params.push(filters.from);
    }
    if (filters.to) {
      query += ' AND created_at <= ?';
      params.push(filters.to);
    }

    // Order by created_at DESC (latest first)
    query += ' ORDER BY created_at DESC';

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

    const now = new Date().toISOString().replace('T', ' ').replace('Z', '').substring(0, 19);
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
      const headers = [
        'id',
        'name',
        'phone',
        'type',
        'status',
        'balance',
        'total_sales',
        'last_order_date',
        'created_at'
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
          escapeCsv(customer.total_sales || 0),
          escapeCsv(customer.last_order_date || ''),
          escapeCsv(customer.created_at || '')
        ];
        csvRows.push(row.join(','));
      }

      const csvContent = csvRows.join('\n');

      const dateStr = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
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





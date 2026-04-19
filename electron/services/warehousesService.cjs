const { ERROR_CODES, createError } = require('../lib/errors.cjs');
const { randomUUID } = require('crypto');

/**
 * Warehouses Service
 * Handles warehouse CRUD operations
 */
class WarehousesService {
  constructor(db) {
    this.db = db;
  }

  /**
   * List warehouses
   */
  list(filters = {}) {
    let query = 'SELECT * FROM warehouses WHERE 1=1';
    const params = [];

    if (filters.is_active !== undefined) {
      query += ' AND is_active = ?';
      params.push(filters.is_active ? 1 : 0);
    }

    query += ' ORDER BY is_default DESC, name ASC';

    return this.db.prepare(query).all(params);
  }

  /**
   * Get warehouse by ID
   */
  getById(id) {
    if (!id) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Warehouse ID is required');
    }

    const warehouse = this.db.prepare('SELECT * FROM warehouses WHERE id = ?').get(id);
    
    if (!warehouse) {
      throw createError(ERROR_CODES.NOT_FOUND, `Warehouse with id ${id} not found`);
    }

    return warehouse;
  }

  /**
   * Create warehouse
   */
  create(data) {
    if (!data.code || !data.code.trim()) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Warehouse code is required');
    }

    if (!data.name || !data.name.trim()) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Warehouse name is required');
    }

    const id = randomUUID();
    const now = new Date().toISOString();

    try {
      this.db.prepare(`
        INSERT INTO warehouses (id, code, name, address, is_active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        data.code.trim().toUpperCase(),
        data.name.trim(),
        data.address?.trim() || null,
        data.is_active !== undefined ? (data.is_active ? 1 : 0) : 1,
        now,
        now
      );

      return this.getById(id);
    } catch (error) {
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        throw createError(ERROR_CODES.VALIDATION_ERROR, 'Warehouse code must be unique');
      }
      throw error;
    }
  }

  /**
   * Update warehouse
   */
  update(id, data) {
    if (!id) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Warehouse ID is required');
    }

    const existing = this.getById(id);

    const updates = [];
    const params = [];

    if (data.code !== undefined) {
      if (!data.code || !data.code.trim()) {
        throw createError(ERROR_CODES.VALIDATION_ERROR, 'Warehouse code cannot be empty');
      }
      updates.push('code = ?');
      params.push(data.code.trim().toUpperCase());
    }

    if (data.name !== undefined) {
      if (!data.name || !data.name.trim()) {
        throw createError(ERROR_CODES.VALIDATION_ERROR, 'Warehouse name cannot be empty');
      }
      updates.push('name = ?');
      params.push(data.name.trim());
    }

    if (data.address !== undefined) {
      updates.push('address = ?');
      params.push(data.address?.trim() || null);
    }

    if (data.is_active !== undefined) {
      updates.push('is_active = ?');
      params.push(data.is_active ? 1 : 0);
    }

    if (updates.length === 0) {
      return existing;
    }

    updates.push('updated_at = ?');
    params.push(new Date().toISOString());
    params.push(id);

    try {
      this.db.prepare(`
        UPDATE warehouses 
        SET ${updates.join(', ')}
        WHERE id = ?
      `).run(...params);

      return this.getById(id);
    } catch (error) {
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        throw createError(ERROR_CODES.VALIDATION_ERROR, 'Warehouse code must be unique');
      }
      throw error;
    }
  }

  /**
   * Delete warehouse
   */
  delete(id) {
    if (!id) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Warehouse ID is required');
    }

    const existing = this.getById(id);

    // Check if warehouse has stock
    const stockCount = this.db.prepare(`
      SELECT COUNT(*) as count FROM stock_balances WHERE warehouse_id = ? AND quantity > 0
    `).get(id);
    
    if (stockCount.count > 0) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Cannot delete warehouse with stock');
    }

    // Check if warehouse has orders
    const orderCount = this.db.prepare('SELECT COUNT(*) as count FROM orders WHERE warehouse_id = ?').get(id);
    if (orderCount.count > 0) {
      // Soft delete
      this.db.prepare('UPDATE warehouses SET is_active = 0, updated_at = ? WHERE id = ?').run(
        new Date().toISOString(),
        id
      );
      return { success: true, softDeleted: true };
    }

    // Hard delete
    this.db.prepare('DELETE FROM warehouses WHERE id = ?').run(id);

    return { success: true, softDeleted: false };
  }
}

module.exports = WarehousesService;






















































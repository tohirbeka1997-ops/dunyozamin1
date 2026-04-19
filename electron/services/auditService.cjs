const { ERROR_CODES, createError } = require('../lib/errors.cjs');
const { randomUUID } = require('crypto');

/**
 * Audit Service
 * Handles audit logging for important actions
 */
class AuditService {
  constructor(db) {
    this.db = db;
  }

  /**
   * Log an action
   */
  log(data) {
    if (!data.action) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Action is required');
    }

    if (!data.entity_type) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Entity type is required');
    }

    const id = randomUUID();
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO audit_log (
        id, user_id, action, entity_type, entity_id,
        old_values, new_values, ip_address, user_agent, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      data.user_id || null,
      data.action,
      data.entity_type,
      data.entity_id || null,
      data.old_values ? JSON.stringify(data.old_values) : null,
      data.new_values ? JSON.stringify(data.new_values) : null,
      data.ip_address || null,
      data.user_agent || null,
      now
    );

    return { id, created_at: now };
  }

  /**
   * Log product creation
   */
  logProductCreate(product, userId) {
    return this.log({
      action: 'create',
      entity_type: 'product',
      entity_id: product.id,
      new_values: product,
      user_id: userId,
    });
  }

  /**
   * Log product update
   */
  logProductUpdate(oldProduct, newProduct, userId) {
    return this.log({
      action: 'update',
      entity_type: 'product',
      entity_id: newProduct.id,
      old_values: oldProduct,
      new_values: newProduct,
      user_id: userId,
    });
  }

  /**
   * Log product delete
   */
  logProductDelete(product, userId) {
    return this.log({
      action: 'delete',
      entity_type: 'product',
      entity_id: product.id,
      old_values: product,
      user_id: userId,
    });
  }

  /**
   * Log order finalization
   */
  logOrderFinalize(order, userId) {
    return this.log({
      action: 'finalize',
      entity_type: 'order',
      entity_id: order.id,
      new_values: { order_number: order.order_number, total_amount: order.total_amount },
      user_id: userId,
    });
  }

  /**
   * Log stock adjustment
   */
  logStockAdjustment(adjustment, userId) {
    return this.log({
      action: 'adjust',
      entity_type: 'inventory',
      entity_id: adjustment.id,
      new_values: {
        adjustment_number: adjustment.adjustment_number,
        warehouse_id: adjustment.warehouse_id,
        items_count: adjustment.items?.length || 0,
      },
      user_id: userId,
    });
  }

  /**
   * Log return creation
   */
  logReturnCreate(returnRecord, userId) {
    return this.log({
      action: 'create',
      entity_type: 'return',
      entity_id: returnRecord.id,
      new_values: {
        return_number: returnRecord.return_number,
        order_id: returnRecord.order_id,
        total_amount: returnRecord.total_amount,
      },
      user_id: userId,
    });
  }

  /**
   * Get audit log entries
   */
  getLogs(filters = {}) {
    let query = `
      SELECT al.*, u.username as user_username
      FROM audit_log al
      LEFT JOIN users u ON al.user_id = u.id
      WHERE 1=1
    `;
    const params = [];

    if (filters.user_id) {
      query += ' AND al.user_id = ?';
      params.push(filters.user_id);
    }

    if (filters.action) {
      query += ' AND al.action = ?';
      params.push(filters.action);
    }

    if (filters.entity_type) {
      query += ' AND al.entity_type = ?';
      params.push(filters.entity_type);
    }

    if (filters.entity_id) {
      query += ' AND al.entity_id = ?';
      params.push(filters.entity_id);
    }

    if (filters.date_from) {
      query += ' AND al.created_at >= ?';
      params.push(filters.date_from);
    }

    if (filters.date_to) {
      query += ' AND al.created_at <= ?';
      params.push(filters.date_to);
    }

    query += ' ORDER BY al.created_at DESC';

    if (filters.limit) {
      query += ' LIMIT ?';
      params.push(filters.limit);
      if (filters.offset) {
        query += ' OFFSET ?';
        params.push(filters.offset);
      }
    }

    const logs = this.db.prepare(query).all(params);

    // Parse JSON values
    return logs.map(log => ({
      ...log,
      old_values: log.old_values ? JSON.parse(log.old_values) : null,
      new_values: log.new_values ? JSON.parse(log.new_values) : null,
    }));
  }
}

module.exports = AuditService;






















































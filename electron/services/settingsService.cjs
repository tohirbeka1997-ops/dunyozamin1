const { ERROR_CODES, createError } = require('../lib/errors.cjs');
const { randomUUID } = require('crypto');

/**
 * Settings Service
 * Handles application settings (key-value store)
 */
class SettingsService {
  constructor(db) {
    this.db = db;
  }

  /**
   * Get setting value by key
   */
  get(key) {
    if (!key) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Setting key is required');
    }

    const setting = this.db.prepare('SELECT * FROM settings WHERE key = ?').get(key);
    if (!setting) {
      return null;
    }

    // Parse value based on type
    return this._parseValue(setting.value, setting.type);
  }

  /**
   * Set setting value
   */
  set(key, value, type = 'string', updatedBy = null) {
    if (!key) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Setting key is required');
    }

    // Validate type
    const allowedTypes = ['string', 'number', 'boolean', 'json'];
    if (!allowedTypes.includes(type)) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, `Invalid setting type. Must be one of: ${allowedTypes.join(', ')}`);
    }

    // Serialize value
    const serializedValue = this._serializeValue(value, type);
    const now = new Date().toISOString();

    // Check if setting exists
    const existing = this.db.prepare('SELECT * FROM settings WHERE key = ?').get(key);
    // Derive category from key prefix (e.g. "receipt.auto_print" -> "receipt")
    const derivedCategory = (() => {
      const k = String(key || '').trim();
      if (k.includes('.')) return k.split('.')[0] || null;
      return existing?.category || null;
    })();

    if (existing) {
      // Update
      this.db.prepare(`
        UPDATE settings 
        SET value = ?, type = ?, category = COALESCE(category, ?), updated_by = ?, updated_at = ?
        WHERE key = ?
      `).run(serializedValue, type, derivedCategory, updatedBy, now, key);
    } else {
      // Create
      this.db.prepare(`
        INSERT INTO settings (id, key, value, type, category, updated_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(randomUUID(), key, serializedValue, type, derivedCategory, updatedBy, now, now);
    }

    return this.get(key);
  }

  /**
   * Get all settings (optionally filtered by category or public flag)
   */
  getAll(filters = {}) {
    let query = 'SELECT * FROM settings WHERE 1=1';
    const params = [];

    if (filters.category) {
      query += ' AND category = ?';
      params.push(filters.category);
    }

    if (filters.is_public !== undefined) {
      query += ' AND is_public = ?';
      params.push(filters.is_public ? 1 : 0);
    }

    query += ' ORDER BY category, key';

    const settings = this.db.prepare(query).all(params);
    
    // Parse values
    return settings.map(s => ({
      ...s,
      value: this._parseValue(s.value, s.type),
    }));
  }

  /**
   * Delete setting
   */
  delete(key) {
    if (!key) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Setting key is required');
    }

    const result = this.db.prepare('DELETE FROM settings WHERE key = ?').run(key);
    
    if (result.changes === 0) {
      throw createError(ERROR_CODES.NOT_FOUND, `Setting ${key} not found`);
    }

    return { success: true };
  }

  /**
   * Parse value based on type
   */
  _parseValue(value, type) {
    if (value === null) return null;

    switch (type) {
      case 'number':
        return parseFloat(value);
      case 'boolean':
        return value === '1' || value === 'true' || value === true;
      case 'json':
        try {
          return JSON.parse(value);
        } catch {
          return value;
        }
      default:
        return value;
    }
  }

  /**
   * Serialize value based on type
   */
  _serializeValue(value, type) {
    switch (type) {
      case 'number':
        return String(value);
      case 'boolean':
        return value ? '1' : '0';
      case 'json':
        return JSON.stringify(value);
      default:
        return String(value);
    }
  }
}

module.exports = SettingsService;






















































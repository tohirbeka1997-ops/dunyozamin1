const { ERROR_CODES, createError } = require('../lib/errors.cjs');
const { randomUUID } = require('crypto');

/**
 * Categories Service
 * Handles category CRUD operations
 */
class CategoriesService {
  constructor(db) {
    this.db = db;
  }

  _ensureValidParentForCreate(parentId) {
    if (!parentId) return null;
    const parent = this.db.prepare('SELECT id FROM categories WHERE id = ?').get(parentId);
    if (!parent?.id) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, `Parent category ${parentId} not found`);
    }
    return parentId;
  }

  _assertNoParentCycle(categoryId, parentId) {
    if (!parentId) return;
    if (String(parentId) === String(categoryId)) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Category cannot be its own parent');
    }
    let current = String(parentId);
    const seen = new Set([String(categoryId)]);
    while (current) {
      if (seen.has(current)) {
        throw createError(ERROR_CODES.VALIDATION_ERROR, 'Category hierarchy cycle detected');
      }
      seen.add(current);
      const row = this.db.prepare('SELECT parent_id FROM categories WHERE id = ?').get(current);
      if (!row) {
        throw createError(ERROR_CODES.VALIDATION_ERROR, `Parent category ${current} not found`);
      }
      current = row.parent_id ? String(row.parent_id) : '';
    }
  }

  _normalizeCategory(row) {
    if (!row) return row;
    return {
      ...row,
      sort_order: Number(row.sort_order) || 0,
      is_active: row.is_active === 1 || row.is_active === true,
      show_in_marketplace:
        row.show_in_marketplace === undefined || row.show_in_marketplace === null
          ? true
          : row.show_in_marketplace === 1 || row.show_in_marketplace === true,
      products_count:
        row.products_count !== undefined && row.products_count !== null
          ? Number(row.products_count)
          : undefined,
    };
  }

  /**
   * List all categories with product counts
   */
  list(filters = {}) {
    // CRITICAL FIX: Include product counts in categories list
    // Using LEFT JOIN with GROUP BY for accurate counting
    let query = `
      SELECT 
        c.*,
        COALESCE(COUNT(p.id), 0) AS products_count
      FROM categories c
      LEFT JOIN products p ON p.category_id = c.id
      WHERE 1=1
    `;
    const params = [];
    
    console.log('📦 CategoriesService.list: Query will count products per category using LEFT JOIN');

    if (filters.parent_id !== undefined) {
      if (filters.parent_id === null) {
        query += ' AND c.parent_id IS NULL';
      } else {
        query += ' AND c.parent_id = ?';
        params.push(filters.parent_id);
      }
    }

    if (filters.is_active !== undefined) {
      query += ' AND c.is_active = ?';
      params.push(filters.is_active ? 1 : 0);
    }

    // CRITICAL: GROUP BY is required when using COUNT with LEFT JOIN
    query += ' GROUP BY c.id';
    query += ' ORDER BY c.sort_order ASC, c.name ASC';

    const categories = this.db.prepare(query).all(params);
    
    // CRITICAL: Log the results to verify products_count is included
    console.log(`📦 CategoriesService.list returned ${categories.length} categories`);
    if (categories.length > 0) {
      const sample = categories[0];
      console.log(`📦 Sample category: ${sample.name} has ${sample.products_count} products`);
    }
    
    return categories.map((r) => this._normalizeCategory(r));
  }

  /**
   * Get category by ID
   */
  getById(id) {
    if (!id) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Category ID is required');
    }

    const category = this.db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
    
    if (!category) {
      throw createError(ERROR_CODES.NOT_FOUND, `Category with id ${id} not found`);
    }

    return this._normalizeCategory(category);
  }

  /**
   * Create category
   */
  create(data) {
    if (!data.name || !data.name.trim()) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Category name is required');
    }

    const id = randomUUID();
    const now = new Date().toISOString();

    try {
      this.db.prepare(`
        INSERT INTO categories (id, parent_id, name, description, color, icon, sort_order, is_active, image_url, show_in_marketplace, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        this._ensureValidParentForCreate(data.parent_id || null),
        data.name.trim(),
        data.description || null,
        data.color || null,
        data.icon || null,
        data.sort_order || 0,
        data.is_active !== undefined ? (data.is_active ? 1 : 0) : 1,
        data.image_url != null && String(data.image_url).trim() ? String(data.image_url).trim() : null,
        data.show_in_marketplace !== undefined ? (data.show_in_marketplace ? 1 : 0) : 1,
        now,
        now
      );

      return this.getById(id);
    } catch (error) {
      if (error.code === 'SQLITE_CONSTRAINT') {
        throw createError(ERROR_CODES.VALIDATION_ERROR, 'Category name must be unique');
      }
      throw error;
    }
  }

  /**
   * Update category
   */
  update(id, data) {
    if (!id) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Category ID is required');
    }

    const existing = this.getById(id);

    const updates = [];
    const params = [];

    if (data.name !== undefined) {
      if (!data.name || !data.name.trim()) {
        throw createError(ERROR_CODES.VALIDATION_ERROR, 'Category name cannot be empty');
      }
      updates.push('name = ?');
      params.push(data.name.trim());
    }

    if (data.parent_id !== undefined) {
      const normalizedParent = data.parent_id || null;
      this._assertNoParentCycle(id, normalizedParent);
      updates.push('parent_id = ?');
      params.push(normalizedParent);
    }

    if (data.description !== undefined) {
      updates.push('description = ?');
      params.push(data.description || null);
    }

    if (data.color !== undefined) {
      updates.push('color = ?');
      params.push(data.color || null);
    }

    if (data.icon !== undefined) {
      updates.push('icon = ?');
      params.push(data.icon || null);
    }

    if (data.sort_order !== undefined) {
      updates.push('sort_order = ?');
      params.push(data.sort_order);
    }

    if (data.is_active !== undefined) {
      updates.push('is_active = ?');
      params.push(data.is_active ? 1 : 0);
    }

    if (data.image_url !== undefined) {
      updates.push('image_url = ?');
      params.push(data.image_url != null && String(data.image_url).trim() ? String(data.image_url).trim() : null);
    }

    if (data.show_in_marketplace !== undefined) {
      updates.push('show_in_marketplace = ?');
      params.push(data.show_in_marketplace ? 1 : 0);
    }

    if (updates.length === 0) {
      return existing;
    }

    updates.push('updated_at = ?');
    params.push(new Date().toISOString());
    params.push(id);

    try {
      this.db.prepare(`
        UPDATE categories 
        SET ${updates.join(', ')}
        WHERE id = ?
      `).run(...params);

      return this.getById(id);
    } catch (error) {
      if (error.code === 'SQLITE_CONSTRAINT') {
        throw createError(ERROR_CODES.VALIDATION_ERROR, 'Category name must be unique');
      }
      throw error;
    }
  }

  /**
   * Delete category
   */
  delete(id) {
    if (!id) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Category ID is required');
    }

    const existing = this.getById(id);

    // CRITICAL: Check if category has products BEFORE attempting deletion
    const productCountResult = this.db.prepare('SELECT COUNT(*) as count FROM products WHERE category_id = ?').get(id);
    const productCount = productCountResult?.count || 0;
    
    console.log(`📦 Checking if category ${id} (${existing.name}) can be deleted:`, {
      productCount,
      hasProducts: productCount > 0,
    });
    
    if (productCount > 0) {
      // CRITICAL: Throw a distinct, user-friendly error message
      const errorMessage = `Cannot delete category "${existing.name}" because it contains ${productCount} product(s). Please delete or move the products first.`;
      console.log(`❌ Category deletion blocked: ${errorMessage}`);
      throw createError(ERROR_CODES.VALIDATION_ERROR, errorMessage);
    }

    // Check if category has child categories
    const childCountResult = this.db.prepare('SELECT COUNT(*) as count FROM categories WHERE parent_id = ?').get(id);
    const childCount = childCountResult?.count || 0;
    
    if (childCount > 0) {
      const errorMessage = `Cannot delete category "${existing.name}" because it has ${childCount} child categor(ies). Please delete or move the child categories first.`;
      console.log(`❌ Category deletion blocked: ${errorMessage}`);
      throw createError(ERROR_CODES.VALIDATION_ERROR, errorMessage);
    }

    // All checks passed - proceed with deletion
    console.log(`✅ Deleting category ${id} (${existing.name})`);
    this.db.prepare('DELETE FROM categories WHERE id = ?').run(id);
    console.log(`✅ Category ${id} deleted successfully`);

    return { success: true };
  }
}

module.exports = CategoriesService;








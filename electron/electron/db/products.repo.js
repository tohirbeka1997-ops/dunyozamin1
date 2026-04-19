"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listProducts = listProducts;
exports.getProductById = getProductById;
exports.createProduct = createProduct;
exports.updateProduct = updateProduct;
exports.removeProduct = removeProduct;
const index_1 = require("./index");
/**
 * List products with optional filtering and pagination
 */
function listProducts(params = {}) {
    const database = (0, index_1.getDb)();
    const { search, categoryId, status = 'all', limit = 1000, offset = 0, } = params;
    let query = 'SELECT * FROM products WHERE 1=1';
    const conditions = [];
    const values = [];
    // Search filter
    if (search) {
        conditions.push('(name LIKE ? OR sku LIKE ? OR barcode LIKE ?)');
        const searchPattern = `%${search}%`;
        values.push(searchPattern, searchPattern, searchPattern);
    }
    // Category filter
    if (categoryId) {
        conditions.push('category_id = ?');
        values.push(categoryId);
    }
    // Status filter
    if (status === 'active') {
        conditions.push('is_active = 1');
    }
    else if (status === 'inactive') {
        conditions.push('is_active = 0');
    }
    if (conditions.length > 0) {
        query += ' AND ' + conditions.join(' AND ');
    }
    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    values.push(limit, offset);
    const rows = database.prepare(query).all(...values);
    // Convert to Product type (handle SQLite INTEGER to boolean conversion)
    return rows.map(row => ({
        ...row,
        is_active: row.is_active === 1,
    }));
}
/**
 * Get product by ID
 */
function getProductById(id) {
    const database = (0, index_1.getDb)();
    const row = database.prepare('SELECT * FROM products WHERE id = ?').get(id);
    if (!row) {
        return null;
    }
    return {
        ...row,
        is_active: row.is_active === 1,
    };
}
/**
 * Create a new product
 */
function createProduct(payload) {
    const database = (0, index_1.getDb)();
    const id = `prod_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const now = new Date().toISOString();
    const product = {
        id,
        sku: payload.sku,
        barcode: payload.barcode || null,
        name: payload.name,
        description: payload.description || null,
        category_id: payload.category_id || null,
        unit: payload.unit,
        purchase_price: payload.purchase_price,
        sale_price: payload.sale_price,
        current_stock: payload.current_stock || 0,
        min_stock_level: payload.min_stock_level,
        image_url: payload.image_url || null,
        is_active: payload.is_active !== false,
        created_at: now,
        updated_at: now,
    };
    database.prepare(`
    INSERT INTO products (
      id, sku, barcode, name, description, category_id, unit,
      purchase_price, sale_price, current_stock, min_stock_level,
      image_url, is_active, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(product.id, product.sku, product.barcode, product.name, product.description, product.category_id, product.unit, product.purchase_price, product.sale_price, product.current_stock, product.min_stock_level, product.image_url, product.is_active ? 1 : 0, product.created_at, product.updated_at);
    return product;
}
/**
 * Update an existing product
 */
function updateProduct(payload) {
    const database = (0, index_1.getDb)();
    const existing = getProductById(payload.id);
    if (!existing) {
        throw new Error(`Product with id ${payload.id} not found`);
    }
    const updated = {
        ...existing,
        ...payload,
        updated_at: new Date().toISOString(),
    };
    database.prepare(`
    UPDATE products SET
      sku = ?,
      barcode = ?,
      name = ?,
      description = ?,
      category_id = ?,
      unit = ?,
      purchase_price = ?,
      sale_price = ?,
      current_stock = ?,
      min_stock_level = ?,
      image_url = ?,
      is_active = ?,
      updated_at = ?
    WHERE id = ?
  `).run(updated.sku, updated.barcode, updated.name, updated.description, updated.category_id, updated.unit, updated.purchase_price, updated.sale_price, updated.current_stock, updated.min_stock_level, updated.image_url, updated.is_active ? 1 : 0, updated.updated_at, updated.id);
    return updated;
}
/**
 * Delete a product
 */
function removeProduct(id) {
    const database = (0, index_1.getDb)();
    const result = database.prepare('DELETE FROM products WHERE id = ?').run(id);
    if (result.changes === 0) {
        throw new Error(`Product with id ${id} not found`);
    }
}

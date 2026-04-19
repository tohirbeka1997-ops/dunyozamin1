import { getDb } from './index';
// @ts-ignore - Type import from outside electron dir
import type { Product } from '../../src/types/database';

export interface ListProductsParams {
  search?: string;
  categoryId?: string;
  status?: 'active' | 'inactive' | 'all';
  warehouseId?: string; // Reserved for future use
  limit?: number;
  offset?: number;
}

export interface CreateProductPayload {
  sku: string;
  barcode?: string | null;
  name: string;
  description?: string | null;
  category_id?: string | null;
  unit: string;
  purchase_price: number;
  sale_price: number;
  current_stock?: number;
  min_stock_level: number;
  image_url?: string | null;
  is_active?: boolean;
}

export interface UpdateProductPayload extends Partial<CreateProductPayload> {
  id: string;
}

/**
 * List products with optional filtering and pagination
 */
export function listProducts(params: ListProductsParams = {}): Product[] {
  const database = getDb();
  const {
    search,
    categoryId,
    status = 'all',
    limit = 1000,
    offset = 0,
  } = params;

  let query = 'SELECT * FROM products WHERE 1=1';
  const conditions: string[] = [];
  const values: any[] = [];

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
  } else if (status === 'inactive') {
    conditions.push('is_active = 0');
  }

  if (conditions.length > 0) {
    query += ' AND ' + conditions.join(' AND ');
  }

  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  values.push(limit, offset);

  const rows = database.prepare(query).all(...values) as any[];

  // Convert to Product type (handle SQLite INTEGER to boolean conversion)
  return rows.map(row => ({
    ...row,
    is_active: row.is_active === 1,
  })) as Product[];
}

/**
 * Get product by ID
 */
export function getProductById(id: string): Product | null {
  const database = getDb();
  const row = database.prepare('SELECT * FROM products WHERE id = ?').get(id) as any;
  
  if (!row) {
    return null;
  }

  return {
    ...row,
    is_active: row.is_active === 1,
  } as Product;
}

/**
 * Create a new product
 */
export function createProduct(payload: CreateProductPayload): Product {
  const database = getDb();
  const id = `prod_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const now = new Date().toISOString();

  const product: Product = {
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
  `).run(
    product.id,
    product.sku,
    product.barcode,
    product.name,
    product.description,
    product.category_id,
    product.unit,
    product.purchase_price,
    product.sale_price,
    product.current_stock,
    product.min_stock_level,
    product.image_url,
    product.is_active ? 1 : 0,
    product.created_at,
    product.updated_at,
  );

  return product;
}

/**
 * Update an existing product
 */
export function updateProduct(payload: UpdateProductPayload): Product {
  const database = getDb();
  const existing = getProductById(payload.id);
  
  if (!existing) {
    throw new Error(`Product with id ${payload.id} not found`);
  }

  const updated: Product = {
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
  `).run(
    updated.sku,
    updated.barcode,
    updated.name,
    updated.description,
    updated.category_id,
    updated.unit,
    updated.purchase_price,
    updated.sale_price,
    updated.current_stock,
    updated.min_stock_level,
    updated.image_url,
    updated.is_active ? 1 : 0,
    updated.updated_at,
    updated.id,
  );

  return updated;
}

/**
 * Delete a product
 */
export function removeProduct(id: string): void {
  const database = getDb();
  const result = database.prepare('DELETE FROM products WHERE id = ?').run(id);
  
  if (result.changes === 0) {
    throw new Error(`Product with id ${id} not found`);
  }
}


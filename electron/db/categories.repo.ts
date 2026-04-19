import { getDb } from './index';
// @ts-ignore - Type import from outside electron dir
import type { Category } from '../../src/types/database';

export interface CreateCategoryPayload {
  name: string;
  description?: string | null;
  color?: string | null;
  icon?: string | null;
  parent_id?: string | null;
}

export interface UpdateCategoryPayload extends Partial<CreateCategoryPayload> {
  id: string;
}

export function listCategories(): Category[] {
  const database = getDb();
  const rows = database.prepare('SELECT * FROM categories ORDER BY name').all() as any[];
  return rows;
}

export function getCategoryById(id: string): Category | null {
  const database = getDb();
  const row = database.prepare('SELECT * FROM categories WHERE id = ?').get(id) as any;
  return row || null;
}

export function createCategory(payload: CreateCategoryPayload): Category {
  const database = getDb();
  const id = `cat_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const now = new Date().toISOString();

  const category: Category = {
    id,
    name: payload.name,
    description: payload.description || null,
    color: payload.color || null,
    icon: payload.icon || null,
    parent_id: payload.parent_id || null,
    created_at: now,
  };

  database.prepare(`
    INSERT INTO categories (id, name, description, color, icon, parent_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    category.id,
    category.name,
    category.description,
    category.color,
    category.icon,
    category.parent_id,
    category.created_at,
  );

  return category;
}

export function updateCategory(payload: UpdateCategoryPayload): Category {
  const database = getDb();
  const existing = getCategoryById(payload.id);
  
  if (!existing) {
    throw new Error(`Category with id ${payload.id} not found`);
  }

  const updated: Category = {
    ...existing,
    ...payload,
  };

  database.prepare(`
    UPDATE categories SET
      name = ?,
      description = ?,
      color = ?,
      icon = ?,
      parent_id = ?
    WHERE id = ?
  `).run(
    updated.name,
    updated.description,
    updated.color,
    updated.icon,
    updated.parent_id,
    updated.id,
  );

  return updated;
}

export function removeCategory(id: string): void {
  const database = getDb();
  const result = database.prepare('DELETE FROM categories WHERE id = ?').run(id);
  
  if (result.changes === 0) {
    throw new Error(`Category with id ${id} not found`);
  }
}

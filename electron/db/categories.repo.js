"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listCategories = listCategories;
exports.getCategoryById = getCategoryById;
exports.createCategory = createCategory;
exports.updateCategory = updateCategory;
exports.removeCategory = removeCategory;
const index_1 = require("./index");
function listCategories() {
    const database = (0, index_1.getDb)();
    const rows = database.prepare('SELECT * FROM categories ORDER BY name').all();
    return rows;
}
function getCategoryById(id) {
    const database = (0, index_1.getDb)();
    const row = database.prepare('SELECT * FROM categories WHERE id = ?').get(id);
    return row || null;
}
function createCategory(payload) {
    const database = (0, index_1.getDb)();
    const id = `cat_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const now = new Date().toISOString();
    const category = {
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
  `).run(category.id, category.name, category.description, category.color, category.icon, category.parent_id, category.created_at);
    return category;
}
function updateCategory(payload) {
    const database = (0, index_1.getDb)();
    const existing = getCategoryById(payload.id);
    if (!existing) {
        throw new Error(`Category with id ${payload.id} not found`);
    }
    const updated = {
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
  `).run(updated.name, updated.description, updated.color, updated.icon, updated.parent_id, updated.id);
    return updated;
}
function removeCategory(id) {
    const database = (0, index_1.getDb)();
    const result = database.prepare('DELETE FROM categories WHERE id = ?').run(id);
    if (result.changes === 0) {
        throw new Error(`Category with id ${id} not found`);
    }
}

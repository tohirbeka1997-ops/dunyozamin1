const { ERROR_CODES, createError } = require('../lib/errors.cjs');
const { randomUUID } = require('crypto');
const crypto = require('crypto');

/**
 * Users Service
 * Handles employee/user CRUD and role assignment (RBAC via roles/user_roles).
 *
 * Tables:
 * - users (no role column)
 * - roles
 * - user_roles
 */
class UsersService {
  constructor(db) {
    this.db = db;
  }

  _hashPassword(password) {
    if (!password || !String(password).trim()) return null;
    // Keep consistent with AuthService/login (SHA-256)
    return crypto.createHash('sha256').update(String(password).trim()).digest('hex');
  }

  _ensureRoleExists(code) {
    const roleCode = String(code || '').trim().toLowerCase();
    if (!roleCode) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Role is required');
    }

    let role = this.db.prepare(`SELECT id, code FROM roles WHERE code = ?`).get(roleCode);
    if (role) return role;

    // Create role on demand
    const id = `role-${roleCode}-${randomUUID().slice(0, 8)}`;
    const name =
      roleCode === 'admin'
        ? 'Administrator'
        : roleCode === 'manager'
          ? 'Manager'
          : roleCode === 'cashier'
            ? 'Kassir'
            : roleCode === 'warehouse'
              ? 'Ombor xodimi'
              : roleCode;

    this.db.prepare(
      `
      INSERT INTO roles (id, code, name, description, is_active, created_at)
      VALUES (?, ?, ?, ?, 1, datetime('now'))
    `
    ).run(id, roleCode, name, null);

    role = { id, code: roleCode };
    return role;
  }

  _getPrimaryRoleCode(userId) {
    try {
      const row = this.db
        .prepare(
          `
          SELECT r.code
          FROM user_roles ur
          INNER JOIN roles r ON r.id = ur.role_id
          WHERE ur.user_id = ? AND r.is_active = 1
          ORDER BY ur.assigned_at DESC
          LIMIT 1
        `
        )
        .get(userId);
      return row?.code || null;
    } catch {
      return null;
    }
  }

  list(filters = {}) {
    const params = [];
    let where = `WHERE 1=1`;

    if (filters.search) {
      const q = `%${String(filters.search).trim()}%`;
      where += ' AND (u.username LIKE ? OR u.full_name LIKE ? OR u.email LIKE ? OR u.phone LIKE ?)';
      params.push(q, q, q, q);
    }

    if (filters.is_active === 0 || filters.is_active === 1) {
      where += ' AND u.is_active = ?';
      params.push(filters.is_active);
    }

    // Primary role: latest assignment
    const rows =
      this.db
        .prepare(
          `
          SELECT
            u.id,
            u.username,
            u.full_name,
            u.email,
            u.phone,
            u.is_active,
            u.last_login,
            u.created_at,
            u.updated_at,
            (
              SELECT r.code
              FROM user_roles ur
              INNER JOIN roles r ON r.id = ur.role_id
              WHERE ur.user_id = u.id AND r.is_active = 1
              ORDER BY ur.assigned_at DESC
              LIMIT 1
            ) AS role
          FROM users u
          ${where}
          ORDER BY u.created_at DESC
        `
        )
        .all(...params) || [];

    return rows.map((u) => ({
      ...u,
      role: u.role || 'cashier',
    }));
  }

  get(id) {
    if (!id) throw createError(ERROR_CODES.VALIDATION_ERROR, 'User ID is required');

    const user = this.db
      .prepare(
        `
        SELECT
          id, username, full_name, email, phone, is_active, last_login, created_at, updated_at
        FROM users
        WHERE id = ?
      `
      )
      .get(id);

    if (!user) throw createError(ERROR_CODES.NOT_FOUND, 'User not found');

    const role = this._getPrimaryRoleCode(id) || 'cashier';
    return { ...user, role };
  }

  create(data) {
    if (!data?.username || !String(data.username).trim()) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Username is required');
    }
    if (!data?.password || String(data.password).length < 6) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Password must be at least 6 characters');
    }

    const id = randomUUID();
    const username = String(data.username).trim();
    const full_name = data.full_name ? String(data.full_name).trim() : null;
    const email = data.email ? String(data.email).trim() : null;
    const phone = data.phone ? String(data.phone).trim() : null;
    const is_active = data.is_active === 0 ? 0 : 1;

    const password_hash = this._hashPassword(data.password);
    const now = new Date().toISOString().replace('T', ' ').replace('Z', '').substring(0, 19);

    const role = this._ensureRoleExists(data.role);

    try {
      this.db.prepare(
        `
        INSERT INTO users (id, username, email, phone, full_name, password_hash, is_active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
      ).run(id, username, email, phone, full_name, password_hash, is_active, now, now);

      // Assign role (replace any existing role assignments for this user)
      this.db.prepare(`DELETE FROM user_roles WHERE user_id = ?`).run(id);
      this.db.prepare(
        `
        INSERT OR REPLACE INTO user_roles (id, user_id, role_id, assigned_at)
        VALUES (?, ?, ?, datetime('now'))
      `
      ).run(`ur-${id}`, id, role.id);

      return this.get(id);
    } catch (error) {
      if (error?.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        throw createError(ERROR_CODES.VALIDATION_ERROR, 'Username already exists');
      }
      throw createError(ERROR_CODES.DB_ERROR, `Failed to create user: ${error.message || error}`);
    }
  }

  update(id, data) {
    if (!id) throw createError(ERROR_CODES.VALIDATION_ERROR, 'User ID is required');
    const existing = this.get(id);

    const updates = [];
    const params = [];

    if (data.full_name !== undefined) {
      updates.push('full_name = ?');
      params.push(data.full_name ? String(data.full_name).trim() : null);
    }
    if (data.email !== undefined) {
      updates.push('email = ?');
      params.push(data.email ? String(data.email).trim() : null);
    }
    if (data.phone !== undefined) {
      updates.push('phone = ?');
      params.push(data.phone ? String(data.phone).trim() : null);
    }
    if (data.is_active !== undefined) {
      updates.push('is_active = ?');
      params.push(data.is_active ? 1 : 0);
    }
    if (data.password) {
      if (String(data.password).length < 6) {
        throw createError(ERROR_CODES.VALIDATION_ERROR, 'Password must be at least 6 characters');
      }
      updates.push('password_hash = ?');
      params.push(this._hashPassword(data.password));
    }

    updates.push("updated_at = datetime('now')");

    try {
      if (updates.length > 0) {
        params.push(id);
        this.db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params);
      }

      if (data.role) {
        const role = this._ensureRoleExists(data.role);
        this.db.prepare(`DELETE FROM user_roles WHERE user_id = ?`).run(id);
        this.db.prepare(
          `INSERT OR REPLACE INTO user_roles (id, user_id, role_id, assigned_at) VALUES (?, ?, ?, datetime('now'))`
        ).run(`ur-${id}`, id, role.id);
      }

      return this.get(id);
    } catch (error) {
      throw createError(ERROR_CODES.DB_ERROR, `Failed to update user: ${error.message || error}`);
    }
  }

  delete(id) {
    if (!id) throw createError(ERROR_CODES.VALIDATION_ERROR, 'User ID is required');
    // Prevent deleting default admin
    if (String(id) === 'default-admin-001') {
      throw createError(ERROR_CODES.PERMISSION_DENIED, 'Cannot delete default admin user');
    }
    this.db.prepare('DELETE FROM users WHERE id = ?').run(id);
    return { success: true };
  }
}

module.exports = UsersService;



























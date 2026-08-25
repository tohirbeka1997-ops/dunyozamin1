#!/usr/bin/env node
'use strict';

/**
 * ADDITIVE, non-destructive staff provisioning for the REAL POS database.
 *
 * Unlike seed-staff-dev.cjs (which also inserts a demo product and runs full
 * migrations), this script is safe to run against the LIVE Electron pos.db:
 *   - It does NOT run migrations and does NOT touch products, orders, stock,
 *     customers, or any business data.
 *   - It only ensures the staff auth schema (staff_refresh_tokens table + the
 *     'sales' role) via CREATE TABLE IF NOT EXISTS / INSERT OR IGNORE, and
 *     creates/updates exactly ONE staff user with the 'sales' role.
 *   - Idempotent: safe to re-run.
 *
 * DB target: the SAME file the public-api resolves at runtime
 * (PUBLIC_API_DB_PATH / POS_DATA_DIR / multi-tenant rules — see
 * electron/lib/resolvePosDbPath.cjs). It loads the repo root .env so the path
 * matches `npm run public-api`.
 *
 * Env overrides (all optional):
 *   STAFF_SEED_USERNAME   default: sotuvchi
 *   STAFF_SEED_PASSWORD   default: Sotuvchi#2026
 *   STAFF_SEED_FULLNAME   default: Sotuvchi (POS)
 *   STAFF_SEED_ROLE       default: sales   (must be admin|manager|sales|cashier)
 *
 * Usage (PowerShell, repo root):
 *   node public-api/scripts/ensure-staff-user.cjs
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { randomUUID } = crypto;
const Database = require('better-sqlite3');

// Load repo-root .env so PUBLIC_API_DB_PATH matches the running public-api.
try {
  require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
} catch {
  /* dotenv optional */
}

const { hashPassword } = require('../../electron/lib/password.cjs');
const { ensureStaffSchema } = require('../lib/staffDb.cjs');
const { isStaffRoleAllowed } = require('../lib/staffRoles.cjs');
const { resolvePosDbPath } = require('../../electron/lib/resolvePosDbPath.cjs');

const USERNAME = String(process.env.STAFF_SEED_USERNAME || 'sotuvchi').trim();
const PASSWORD = String(process.env.STAFF_SEED_PASSWORD || 'Sotuvchi#2026');
const FULL_NAME = String(process.env.STAFF_SEED_FULLNAME || 'Sotuvchi (POS)').trim();
const ROLE = String(process.env.STAFF_SEED_ROLE || 'sales').trim().toLowerCase();

const ROLE_IDS = { sales: 'role-sales-001', manager: 'role-manager-001', admin: 'role-admin-001' };

function fail(msg) {
  console.error(`[ensure-staff-user] ${msg}`);
  process.exit(1);
}

function main() {
  if (!isStaffRoleAllowed(ROLE)) {
    fail(`STAFF_SEED_ROLE="${ROLE}" not allowed. Use admin | manager | sales | cashier.`);
  }

  const dbPath = resolvePosDbPath();
  console.log('[ensure-staff-user] resolved DB path:', dbPath);

  if (!fs.existsSync(dbPath)) {
    fail(
      `DB file does not exist: ${dbPath}\n` +
        '  Refusing to create a new database. Verify PUBLIC_API_DB_PATH / POS_DATA_DIR point at the REAL pos.db.',
    );
  }

  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  // Guard: the real POS DB must already have the core auth tables. If they are
  // missing we are almost certainly pointed at the wrong file — back off rather
  // than risk creating a malformed database.
  const requiredTables = ['users', 'roles', 'user_roles'];
  for (const tbl of requiredTables) {
    const exists = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name = ?`)
      .get(tbl);
    if (!exists) {
      db.close();
      fail(
        `Required table "${tbl}" not found in ${dbPath}.\n` +
          '  This does not look like the real POS DB. Aborting (no changes made).',
      );
    }
  }

  // Additive: staff_refresh_tokens + 'sales' role (CREATE IF NOT EXISTS / INSERT OR IGNORE).
  ensureStaffSchema(db);

  // Ensure the requested role row exists (sales is created by ensureStaffSchema;
  // admin/manager normally already exist in a real POS DB).
  const roleId = ROLE_IDS[ROLE] || `role-${ROLE}-001`;
  let roleRow = db.prepare(`SELECT id FROM roles WHERE code = ? AND is_active = 1`).get(ROLE);
  if (!roleRow) {
    db.prepare(
      `INSERT OR IGNORE INTO roles (id, code, name, description, is_active, created_at)
       VALUES (?, ?, ?, ?, 1, datetime('now'))`,
    ).run(roleId, ROLE, ROLE, `${ROLE} role (staff app)`);
    roleRow = db.prepare(`SELECT id FROM roles WHERE code = ? AND is_active = 1`).get(ROLE);
  }
  if (!roleRow) {
    db.close();
    fail(`Could not find or create role "${ROLE}".`);
  }

  // Create/update exactly one staff user (scrypt hash via shared password lib).
  const existing = db.prepare('SELECT id FROM users WHERE username = ? OR email = ?').get(USERNAME, USERNAME);
  let userId = existing?.id;
  if (userId) {
    db.prepare(
      `UPDATE users SET password_hash = ?, is_active = 1, updated_at = datetime('now') WHERE id = ?`,
    ).run(hashPassword(PASSWORD), userId);
    console.log('[ensure-staff-user] updated existing user:', USERNAME);
  } else {
    userId = `staff-${randomUUID()}`;
    db.prepare(
      `INSERT INTO users (id, username, full_name, email, password_hash, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, datetime('now'), datetime('now'))`,
    ).run(userId, USERNAME, FULL_NAME, USERNAME, hashPassword(PASSWORD));
    console.log('[ensure-staff-user] created user:', USERNAME);
  }

  // Assign role (idempotent).
  const hasRole = db
    .prepare('SELECT 1 FROM user_roles WHERE user_id = ? AND role_id = ?')
    .get(userId, roleRow.id);
  if (!hasRole) {
    db.prepare(
      `INSERT INTO user_roles (id, user_id, role_id, assigned_at)
       VALUES (?, ?, ?, datetime('now'))`,
    ).run(`ur-${randomUUID()}`, userId, roleRow.id);
    console.log('[ensure-staff-user] assigned role:', ROLE);
  } else {
    console.log('[ensure-staff-user] role already assigned:', ROLE);
  }

  db.close();

  console.log('\n[ensure-staff-user] DONE. Log in from the staff app with:');
  console.log('       tenant  : default');
  console.log('       username:', USERNAME);
  console.log('       password:', PASSWORD);
  console.log('       role    :', ROLE);
}

main();

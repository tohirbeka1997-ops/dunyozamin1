#!/usr/bin/env node
'use strict';

/**
 * Seed a local DEV database for the staff mobile POS app (sales-mobile).
 *
 * Mirrors the seeding in public-api/staffSales.test.cjs so a physical phone can
 * log in and run the full flow against a locally-running public-api:
 *   - a `sales`-role user (allowed by staffRoles.cjs)
 *   - one stocked product (stock truth = SUM(inventory_movements.quantity))
 *
 * It writes to the SAME database public-api resolves at runtime
 * (PUBLIC_API_DB_PATH / POS_DATA_DIR / multi-tenant rules), so run it with the
 * same env as `npm run public-api:dev` (which sets POS_DATA_DIR=./.pos-data-dev).
 *
 * Idempotent: safe to re-run.
 *
 * Env overrides (all optional):
 *   STAFF_SEED_USERNAME   default: seller@dz.local
 *   STAFF_SEED_PASSWORD   default: secret123
 *   STAFF_SEED_FULLNAME   default: Dev Seller
 *
 * Usage (PowerShell, from repo root):
 *   $env:POS_DATA_DIR="./.pos-data-dev"; node public-api/scripts/seed-staff-dev.cjs
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { randomUUID } = crypto;
const Database = require('better-sqlite3');

const { runMigrations } = require('../../electron/db/migrate.cjs');
const { hashPassword } = require('../../electron/lib/password.cjs');
const { ensureStaffSchema } = require('../lib/staffDb.cjs');
// Shared canonical DB-path resolver (respects PUBLIC_API_DB_PATH / POS_DATA_DIR).
const { resolvePosDbPath: resolveDbPath } = require('../../electron/lib/resolvePosDbPath.cjs');

const USERNAME = String(process.env.STAFF_SEED_USERNAME || 'seller@dz.local').trim();
const PASSWORD = String(process.env.STAFF_SEED_PASSWORD || 'secret123');
const FULL_NAME = String(process.env.STAFF_SEED_FULLNAME || 'Dev Seller').trim();

const SALES_ROLE_ID = 'role-sales-001';
const PRODUCT_ID = 'prod-dev-cola-001';
const WAREHOUSE_ID = 'main-warehouse-001';

function main() {
  const dbPath = resolveDbPath();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  console.log('[seed] DB path:', dbPath);

  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  ensureStaffSchema(db);

  // 1. sales role (ensureStaffSchema also inserts it; keep explicit for clarity)
  db.prepare(
    `INSERT OR IGNORE INTO roles (id, code, name, description, is_active, created_at)
     VALUES (?, 'sales', 'Sales / Online orders', 'Web orders and field sales', 1, datetime('now'))`,
  ).run(SALES_ROLE_ID);

  // 2. staff user (scrypt hash via shared password lib)
  const existingUser = db
    .prepare('SELECT id FROM users WHERE username = ? OR email = ?')
    .get(USERNAME, USERNAME);
  let userId = existingUser?.id;
  if (userId) {
    db.prepare('UPDATE users SET password_hash = ?, is_active = 1, updated_at = datetime(\'now\') WHERE id = ?')
      .run(hashPassword(PASSWORD), userId);
    console.log('[seed] updated existing user:', USERNAME);
  } else {
    userId = `staff-${randomUUID()}`;
    db.prepare(
      `INSERT INTO users (id, username, full_name, email, password_hash, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, datetime('now'), datetime('now'))`,
    ).run(userId, USERNAME, FULL_NAME, USERNAME, hashPassword(PASSWORD));
    console.log('[seed] created user:', USERNAME);
  }

  // 3. assign sales role (idempotent)
  const hasRole = db
    .prepare('SELECT 1 FROM user_roles WHERE user_id = ? AND role_id = ?')
    .get(userId, SALES_ROLE_ID);
  if (!hasRole) {
    db.prepare(
      `INSERT INTO user_roles (id, user_id, role_id, assigned_at)
       VALUES (?, ?, ?, datetime('now'))`,
    ).run(`ur-${randomUUID()}`, userId, SALES_ROLE_ID);
  }

  // 4. one stocked product (stock truth = SUM(inventory_movements))
  const hasProduct = db.prepare('SELECT 1 FROM products WHERE id = ?').get(PRODUCT_ID);
  if (!hasProduct) {
    db.prepare(
      `INSERT INTO products (id, sku, name, unit, sale_price, purchase_price, current_stock, track_stock, is_active, created_at, updated_at)
       VALUES (?, 'SKU-DEV-1', 'Test Cola', 'pcs', 10000, 6000, 50, 1, 1, datetime('now'), datetime('now'))`,
    ).run(PRODUCT_ID);

    db.prepare(
      `INSERT INTO stock_balances (id, product_id, warehouse_id, quantity, created_at, updated_at)
       VALUES (?, ?, ?, 50, datetime('now'), datetime('now'))`,
    ).run(randomUUID(), PRODUCT_ID, WAREHOUSE_ID);

    db.prepare(
      `INSERT INTO inventory_movements (
         id, product_id, warehouse_id, movement_number, movement_type, quantity,
         before_quantity, after_quantity, reference_type, reference_id, reason, created_at
       ) VALUES (?, ?, ?, ?, 'purchase', 50, 0, 50, 'seed', 'seed', 'dev seed stock', datetime('now'))`,
    ).run(randomUUID(), PRODUCT_ID, WAREHOUSE_ID, `MOV-DEVSEED-${Date.now()}`);
    console.log('[seed] created product: Test Cola (SKU-DEV-1), stock 50');
  } else {
    console.log('[seed] product already exists: SKU-DEV-1');
  }

  db.close();

  console.log('\n[seed] DONE. Log in from the app with:');
  console.log('       tenant  : default');
  console.log('       username:', USERNAME);
  console.log('       password:', PASSWORD);
}

main();

'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { resolvePosDataDir, resolvePosDbPath } = require('../../electron/lib/resolvePosDbPath.cjs');

const tenantDbCache = new Map();

function normalizeTenantSlug(raw) {
  const slug = String(raw || '').trim().toLowerCase();
  return slug || 'default';
}

function resolveTenantDbPath(tenantSlug) {
  const slug = normalizeTenantSlug(tenantSlug);

  // For the default tenant, an explicit PUBLIC_API_DB_PATH MUST win so the
  // staff API opens the SAME database file as the main public-api `db.cjs`
  // (which uses resolvePosDbPath → PUBLIC_API_DB_PATH first). Otherwise a
  // POS_DATA_DIR legacy pos.db could shadow the explicitly-configured real DB,
  // leaving staff login pointed at a different database than the rest of the API.
  if (
    slug === 'default' &&
    process.env.PUBLIC_API_DB_PATH &&
    String(process.env.PUBLIC_API_DB_PATH).trim()
  ) {
    const canonical = resolvePosDbPath();
    if (canonical && fs.existsSync(canonical)) return canonical;
  }

  const dataDir = resolvePosDataDir();
  const tenantPath = path.join(dataDir, 'tenants', slug, 'pos.db');
  if (fs.existsSync(tenantPath)) return tenantPath;

  const legacyPath = path.join(dataDir, 'pos.db');
  if (slug === 'default' && fs.existsSync(legacyPath)) return legacyPath;

  // Final fallback (also covers POS_MULTI_TENANT) so the staff API still finds
  // the canonical DB when neither tenant nor legacy paths exist on disk.
  if (slug === 'default') {
    const canonical = resolvePosDbPath();
    if (canonical && fs.existsSync(canonical)) return canonical;
  }

  return null;
}

function ensureStaffSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS staff_refresh_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      jti TEXT NOT NULL UNIQUE,
      device_id TEXT,
      platform TEXT,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_staff_refresh_jti ON staff_refresh_tokens(jti);
    CREATE INDEX IF NOT EXISTS idx_staff_refresh_user ON staff_refresh_tokens(user_id);
    CREATE TABLE IF NOT EXISTS staff_devices (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      device_id TEXT,
      fcm_token TEXT NOT NULL,
      platform TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_staff_devices_user ON staff_devices(user_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_devices_user_token ON staff_devices(user_id, fcm_token);
    INSERT OR IGNORE INTO roles (id, code, name, description, is_active, created_at)
    VALUES ('role-sales-001', 'sales', 'Sales / Online orders', 'Web orders and field sales', 1, datetime('now'));
  `);
}

function openTenantDatabase(tenantSlug) {
  const slug = normalizeTenantSlug(tenantSlug);
  if (tenantDbCache.has(slug)) return tenantDbCache.get(slug);

  const filePath = resolveTenantDbPath(slug);
  if (!filePath) {
    const err = new Error(`Tenant database not found: ${slug}`);
    err.code = 'TENANT_NOT_FOUND';
    throw err;
  }

  const db = new Database(filePath);
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  ensureStaffSchema(db);
  tenantDbCache.set(slug, db);
  return db;
}

function clearTenantDbCache() {
  for (const db of tenantDbCache.values()) {
    try {
      db.close();
    } catch {
      /* ignore */
    }
  }
  tenantDbCache.clear();
}

module.exports = {
  normalizeTenantSlug,
  resolveTenantDbPath,
  openTenantDatabase,
  ensureStaffSchema,
  clearTenantDbCache,
};

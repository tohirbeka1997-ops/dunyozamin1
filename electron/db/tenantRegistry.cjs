// =============================================================================
// Multi-tenant registry + per-tenant SQLite DB cache
// =============================================================================
// Architecture:
//   * One "master" DB (POS_DATA_DIR/master.db) — catalog of tenants, super-
//     admin users, and the master session store. Single file, small.
//   * One "tenant" DB per store  (POS_DATA_DIR/tenants/<slug>/pos.db). Holds
//     ALL business data (products, sales, inventory, …). Schema is identical
//     to legacy single-tenant mode — migrations reuse `electron/db/migrate.cjs`
//     untouched.
//
// Isolation rationale:
//   * Row-level multi-tenancy (tenant_id on every table) is tempting but
//     scary: one missed WHERE clause leaks cross-tenant data. A separate DB
//     file makes that class of bug impossible.
//   * Per-tenant backups/restore drills trivially map to one file.
//   * "Noisy neighbor" is a non-issue at our scale (≤100 stores, ≤30 RPS each).
//
// Backwards compatibility:
//   * When POS_MULTI_TENANT=0 (default), this module is NOT loaded by the
//     server. The single-tenant code paths remain the primary, tested path.
//   * When POS_MULTI_TENANT=1, bootstrap auto-imports `POS_DATA_DIR/pos.db`
//     (if present) as the tenant with slug=`default` on first start so
//     operators can flip the switch without data loss.
// =============================================================================
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

// ---- Master DB schema (ONE file) -------------------------------------------
// Kept tiny on purpose; master DB should never hold business data.
const MASTER_SCHEMA_SQL = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS tenants (
  id            TEXT PRIMARY KEY,
  slug          TEXT UNIQUE NOT NULL,
  display_name  TEXT NOT NULL,
  db_path       TEXT NOT NULL,
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL,
  disabled_at   TEXT,
  meta_json     TEXT
);

CREATE INDEX IF NOT EXISTS idx_tenants_active ON tenants(is_active);

-- Super-admin accounts. Can impersonate into tenants and run cross-tenant
-- admin RPCs. Kept here (not in any tenant DB) so a single super-admin can
-- never be silently removed by a misbehaving tenant.
CREATE TABLE IF NOT EXISTS master_users (
  id            TEXT PRIMARY KEY,
  username      TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL,
  last_login_at TEXT
);

-- Session store. Note the tenant_id column:
--   * tenant session → tenant_id set, user_scope='tenant'
--   * super-admin    → tenant_id NULL, user_scope='master'
-- We keep sessions in MASTER (not per-tenant) so the routing layer only
-- needs ONE SELECT to verify+resolve any token, independent of how many
-- tenants exist.
CREATE TABLE IF NOT EXISTS master_sessions (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT,
  user_id      TEXT NOT NULL,
  user_scope   TEXT NOT NULL CHECK(user_scope IN ('tenant','master')),
  token        TEXT UNIQUE NOT NULL,
  ip_address   TEXT,
  user_agent   TEXT,
  expires_at   TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  FOREIGN KEY(tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_master_sessions_token   ON master_sessions(token);
CREATE INDEX IF NOT EXISTS idx_master_sessions_expires ON master_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_master_sessions_tenant  ON master_sessions(tenant_id);
`;

function now() { return new Date().toISOString(); }

function uid() {
  // URL/token-safe 24-byte identifier. Not used as a credential — just unique.
  return crypto.randomBytes(16).toString('hex');
}

/**
 * A single shared cache — opened tenant DBs keyed by tenant id. A tenant DB
 * handle is a full better-sqlite3 instance; we keep one-per-tenant open for
 * the lifetime of the process.
 *
 * If a tenant is disabled or deleted, its handle is closed on demand.
 */
function createTenantRegistry({
  dataDir,
  migrate,               // injected: (db) => { applied, skipped }
  pragmas,               // injected: (db) => void — wraps db in same pragmas open.cjs applies
  now: clock = now,
} = {}) {
  if (!dataDir) throw new Error('dataDir is required');
  if (typeof migrate !== 'function') throw new Error('migrate(db) fn required');
  fs.mkdirSync(dataDir, { recursive: true });

  const masterPath = path.join(dataDir, 'master.db');
  const tenantsRoot = path.join(dataDir, 'tenants');
  fs.mkdirSync(tenantsRoot, { recursive: true });

  const master = new Database(masterPath);
  master.pragma('journal_mode = DELETE');
  master.pragma('foreign_keys = ON');
  master.pragma('busy_timeout = 5000');
  master.exec(MASTER_SCHEMA_SQL);

  // Prepared statements for hot paths.
  const qTenantBySlug  = master.prepare('SELECT * FROM tenants WHERE slug = ?');
  const qTenantById    = master.prepare('SELECT * FROM tenants WHERE id = ?');
  const qTenantsActive = master.prepare('SELECT * FROM tenants WHERE is_active = 1 ORDER BY created_at');
  const qTenantsAll    = master.prepare('SELECT * FROM tenants ORDER BY created_at');
  const insertTenant   = master.prepare(`
    INSERT INTO tenants(id, slug, display_name, db_path, is_active, created_at, meta_json)
    VALUES (?, ?, ?, ?, 1, ?, ?)
  `);
  const disableTenantStmt = master.prepare(
    `UPDATE tenants SET is_active = 0, disabled_at = ? WHERE id = ?`,
  );
  const enableTenantStmt  = master.prepare(
    `UPDATE tenants SET is_active = 1, disabled_at = NULL WHERE id = ?`,
  );
  const updateMetaJsonStmt = master.prepare(
    `UPDATE tenants SET meta_json = ? WHERE id = ?`,
  );

  /** Cache of open tenant DB handles keyed by tenant id. */
  const dbCache = new Map();

  // ---- Slug validation ------------------------------------------------------
  // Slugs appear in filesystem paths AND session tokens; be strict.
  function assertValidSlug(slug) {
    if (typeof slug !== 'string' || !/^[a-z0-9][a-z0-9_-]{1,39}$/.test(slug)) {
      throw new Error(
        `invalid tenant slug: ${JSON.stringify(slug)} ` +
        `(must match /^[a-z0-9][a-z0-9_-]{1,39}$/)`,
      );
    }
    if (slug === 'master' || slug === 'tenants' || slug.startsWith('_')) {
      throw new Error(`reserved tenant slug: ${slug}`);
    }
  }

  // ---- Tenant CRUD ----------------------------------------------------------

  function listTenants({ includeInactive = false } = {}) {
    return (includeInactive ? qTenantsAll : qTenantsActive).all();
  }

  function getTenantBySlug(slug) {
    return qTenantBySlug.get(slug) || null;
  }
  function getTenantById(id) {
    return qTenantById.get(id) || null;
  }

  /**
   * Create a new tenant. Creates the tenant DB file + runs migrations to
   * produce an empty, ready-to-use schema. Fails FAST if the slug collides
   * or the DB directory already exists — operator must explicitly remove
   * conflicting state.
   *
   * @returns {{ id, slug, display_name, db_path, is_active, created_at }}
   */
  function createTenant({ slug, display_name, meta = null, dbPath: overrideDbPath } = {}) {
    assertValidSlug(slug);
    if (!display_name || typeof display_name !== 'string') {
      throw new Error('display_name required');
    }
    if (qTenantBySlug.get(slug)) {
      throw new Error(`tenant slug already exists: ${slug}`);
    }
    const id = uid();
    const dbPath = overrideDbPath || path.join(tenantsRoot, slug, 'pos.db');
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    if (fs.existsSync(dbPath) && !overrideDbPath) {
      // Explicit guard: if the file already exists but no tenant row does,
      // something odd happened — refuse silently overwriting data.
      throw new Error(`tenant DB already exists at ${dbPath} (remove manually or pass overrideDbPath)`);
    }
    // Create + migrate the empty DB. Do this BEFORE inserting the row so a
    // migration failure doesn't leave a dangling registry entry.
    const newDb = new Database(dbPath);
    try {
      if (pragmas) pragmas(newDb);
      migrate(newDb);
    } catch (err) {
      newDb.close();
      try { fs.unlinkSync(dbPath); } catch { /* ignore */ }
      throw err;
    }
    newDb.close();

    insertTenant.run(
      id, slug, display_name, dbPath, clock(),
      meta ? JSON.stringify(meta) : null,
    );
    return qTenantById.get(id);
  }

  function disableTenant(id) {
    const t = qTenantById.get(id);
    if (!t) throw new Error(`unknown tenant id: ${id}`);
    disableTenantStmt.run(clock(), id);
    // Eagerly drop the cached handle so in-flight requests see the new state
    // on next access.
    closeTenantDb(id);
    return qTenantById.get(id);
  }
  function enableTenant(id) {
    const t = qTenantById.get(id);
    if (!t) throw new Error(`unknown tenant id: ${id}`);
    enableTenantStmt.run(id);
    return qTenantById.get(id);
  }

  function parseMetaJson(row) {
    if (!row?.meta_json) return {};
    try {
      return JSON.parse(row.meta_json);
    } catch {
      return {};
    }
  }

  /**
   * Strip branding to values safe to expose on the public login page.
   * (https logo URLs only, #RRGGBB colours.)
   */
  function sanitizeBrandingForPublic(branding) {
    const out = {};
    const b = branding && typeof branding === 'object' ? branding : {};
    if (typeof b.logoUrl === 'string') {
      const u = b.logoUrl.trim().slice(0, 512);
      if (/^https:\/\//i.test(u)) out.logoUrl = u;
    }
    for (const key of ['primaryColor', 'accentColor']) {
      const v = b[key];
      if (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v.trim())) {
        out[key] = v.trim().toLowerCase();
      }
    }
    return out;
  }

  /**
   * Merge branding keys into tenants.meta_json (super-admin only).
   * Pass `null` or `''` for a key to remove it.
   */
  function mergeTenantBranding(slug, brandingPatch = {}) {
    assertValidSlug(slug);
    const t = qTenantBySlug.get(slug);
    if (!t) throw new Error(`unknown tenant: ${slug}`);
    const meta = parseMetaJson(t);
    const prevB = meta.branding && typeof meta.branding === 'object' ? { ...meta.branding } : {};
    const nextB = { ...prevB };

    function normLogo(v) {
      if (v == null || v === '') return null;
      const s = String(v).trim().slice(0, 512);
      if (!/^https:\/\//i.test(s)) {
        throw new Error('logoUrl must be an https:// URL');
      }
      return s;
    }
    function normHex(v) {
      if (v == null || v === '') return null;
      const s = String(v).trim();
      if (!/^#[0-9a-fA-F]{6}$/.test(s)) {
        throw new Error('color must be #RRGGBB');
      }
      return s.toLowerCase();
    }

    if ('logoUrl' in brandingPatch) {
      const n = normLogo(brandingPatch.logoUrl);
      if (n == null) delete nextB.logoUrl;
      else nextB.logoUrl = n;
    }
    if ('primaryColor' in brandingPatch) {
      const n = normHex(brandingPatch.primaryColor);
      if (n == null) delete nextB.primaryColor;
      else nextB.primaryColor = n;
    }
    if ('accentColor' in brandingPatch) {
      const n = normHex(brandingPatch.accentColor);
      if (n == null) delete nextB.accentColor;
      else nextB.accentColor = n;
    }

    meta.branding = nextB;
    updateMetaJsonStmt.run(JSON.stringify(meta), t.id);
    return qTenantById.get(t.id);
  }

  /** Public login-page payload — no secrets. */
  function getPublicTenantProfile(slug) {
    const s = String(slug || '').trim().toLowerCase();
    if (!s) return null;
    const t = qTenantBySlug.get(s);
    if (!t || !t.is_active) return null;
    const meta = parseMetaJson(t);
    return {
      slug: t.slug,
      display_name: t.display_name,
      branding: sanitizeBrandingForPublic(meta.branding),
    };
  }

  // ---- Tenant DB handle cache -----------------------------------------------

  /**
   * Get (and lazily open) the SQLite handle for a tenant. Throws if the
   * tenant is disabled or missing — callers should NEVER silently fall back
   * to another tenant.
   */
  function openTenantDb(tenantId) {
    let handle = dbCache.get(tenantId);
    if (handle) return handle;
    const row = qTenantById.get(tenantId);
    if (!row) throw new Error(`unknown tenant id: ${tenantId}`);
    if (!row.is_active) throw new Error(`tenant is disabled: ${row.slug}`);
    if (!fs.existsSync(row.db_path)) {
      throw new Error(`tenant DB file missing: ${row.db_path}`);
    }
    const db = new Database(row.db_path);
    if (pragmas) pragmas(db);
    // Migrations are idempotent. Running them on open handles the case where
    // a new tenant was created while the server was offline upgraded.
    migrate(db);
    dbCache.set(tenantId, db);
    return db;
  }

  function closeTenantDb(tenantId) {
    const db = dbCache.get(tenantId);
    if (db) {
      try { db.close(); } catch { /* ignore */ }
      dbCache.delete(tenantId);
    }
  }

  // ---- Import / adopt an existing DB file as a tenant ----------------------
  // Used by the server bootstrap to convert a pre-existing `pos.db` into a
  // tenant named `default` on first multi-tenant start.
  function adoptExistingDb({ slug, display_name, sourceDbPath, move = false }) {
    assertValidSlug(slug);
    if (qTenantBySlug.get(slug)) return qTenantBySlug.get(slug);   // already adopted
    if (!fs.existsSync(sourceDbPath)) {
      throw new Error(`source DB not found: ${sourceDbPath}`);
    }
    const destDir = path.join(tenantsRoot, slug);
    fs.mkdirSync(destDir, { recursive: true });
    const destPath = path.join(destDir, 'pos.db');
    if (fs.existsSync(destPath)) {
      throw new Error(`destination tenant DB already exists: ${destPath}`);
    }
    if (move) {
      fs.renameSync(sourceDbPath, destPath);
    } else {
      fs.copyFileSync(sourceDbPath, destPath);
    }
    const id = uid();
    insertTenant.run(id, slug, display_name, destPath, clock(), null);
    return qTenantById.get(id);
  }

  // ---- Teardown -------------------------------------------------------------
  function close() {
    for (const id of [...dbCache.keys()]) closeTenantDb(id);
    try { master.close(); } catch { /* ignore */ }
  }

  // ---- Introspection (for health/admin endpoints) --------------------------
  function stats() {
    return {
      masterPath,
      tenantsRoot,
      openHandles: dbCache.size,
      tenants: listTenants({ includeInactive: true }).length,
      active:   listTenants().length,
    };
  }

  return {
    master,                  // exposed for session store / admin queries
    masterPath,
    tenantsRoot,
    listTenants,
    getTenantBySlug,
    getTenantById,
    createTenant,
    disableTenant,
    enableTenant,
    openTenantDb,
    closeTenantDb,
    adoptExistingDb,
    mergeTenantBranding,
    getPublicTenantProfile,
    sanitizeBrandingForPublic,
    stats,
    close,
  };
}

module.exports = { createTenantRegistry, MASTER_SCHEMA_SQL };

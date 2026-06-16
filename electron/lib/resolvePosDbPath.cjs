'use strict';

const fs = require('fs');
const path = require('path');

function parseBoolEnv(raw) {
  return ['1', 'true', 'yes'].includes(String(raw || '').trim().toLowerCase());
}

function resolvePosDataDir() {
  const dataDir = process.env.POS_DATA_DIR && String(process.env.POS_DATA_DIR).trim();
  if (dataDir) return path.resolve(dataDir);
  return process.cwd();
}

/**
 * Canonical SQLite path for marketplace / public-api / migrate scripts.
 *
 * Priority:
 * 1. PUBLIC_API_DB_PATH (explicit override)
 * 2. POS_MULTI_TENANT=1 or master.db present → tenants/<slug>/pos.db
 * 3. POS_DATA_DIR/pos.db (legacy single-tenant)
 * 4. cwd/pos.db
 */
function resolvePosDbPath() {
  const explicit = process.env.PUBLIC_API_DB_PATH && String(process.env.PUBLIC_API_DB_PATH).trim();
  if (explicit) return path.resolve(explicit);

  const dataDir = resolvePosDataDir();
  const legacyPath = path.join(dataDir, 'pos.db');
  const tenantSlug =
    (process.env.POS_TENANT_SLUG && String(process.env.POS_TENANT_SLUG).trim()) || 'default';
  const tenantPath = path.join(dataDir, 'tenants', tenantSlug, 'pos.db');
  const masterPath = path.join(dataDir, 'master.db');

  const multiTenant =
    parseBoolEnv(process.env.POS_MULTI_TENANT) ||
    (fs.existsSync(masterPath) && fs.existsSync(tenantPath));

  if (multiTenant && fs.existsSync(tenantPath)) {
    return tenantPath;
  }

  return legacyPath;
}

module.exports = { resolvePosDbPath, resolvePosDataDir, parseBoolEnv };

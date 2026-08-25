'use strict';

const fs = require('fs');
const path = require('path');
const {
  resolvePosDbPath,
  resolvePosDataDir,
  parseBoolEnv,
} = require('../../electron/lib/resolvePosDbPath.cjs');

/**
 * Compute the DB path POS server is expected to use for the current tenant.
 * Mirrors resolvePosDbPath without PUBLIC_API_DB_PATH override.
 */
function expectedPosServerDbPath() {
  const prev = process.env.PUBLIC_API_DB_PATH;
  delete process.env.PUBLIC_API_DB_PATH;
  try {
    return path.resolve(resolvePosDbPath());
  } finally {
    if (prev == null) delete process.env.PUBLIC_API_DB_PATH;
    else process.env.PUBLIC_API_DB_PATH = prev;
  }
}

/**
 * @param {import('better-sqlite3').Database} [_db]
 * @returns {{
 *   db_path: string,
 *   expected_pos_db_path: string,
 *   db_in_sync: boolean,
 *   issues: string[],
 * }}
 */
function assessDbPathSync(_db) {
  const resolved = path.resolve(resolvePosDbPath());
  const expected = expectedPosServerDbPath();
  const dataRoot = resolvePosDataDir();
  const legacyDb = path.join(dataRoot, 'pos.db');
  const tenantSlug =
    (process.env.POS_TENANT_SLUG && String(process.env.POS_TENANT_SLUG).trim()) || 'default';
  const tenantDb = path.join(dataRoot, 'tenants', tenantSlug, 'pos.db');
  const masterDb = path.join(dataRoot, 'master.db');
  const issues = [];

  if (!fs.existsSync(resolved)) {
    issues.push(`database file not found: ${resolved}`);
  }

  const multiTenant =
    parseBoolEnv(process.env.POS_MULTI_TENANT) ||
    (fs.existsSync(masterDb) && fs.existsSync(tenantDb));

  if (multiTenant && fs.existsSync(masterDb) && fs.existsSync(tenantDb)) {
    const tenantResolved = path.resolve(tenantDb);
    if (resolved !== tenantResolved && resolved === path.resolve(legacyDb)) {
      issues.push(
        'multi-tenant master.db detected but public-api resolves to legacy pos.db; set POS_MULTI_TENANT=1 or PUBLIC_API_DB_PATH to the tenant DB',
      );
    }
  }

  if (resolved !== expected) {
    issues.push(
      `PUBLIC_API_DB_PATH override (${resolved}) does not match POS server expected path (${expected})`,
    );
  }

  return {
    db_path: resolved,
    expected_pos_db_path: expected,
    tenant_slug: tenantSlug,
    multi_tenant: multiTenant,
    db_in_sync: issues.length === 0,
    issues,
  };
}

/**
 * Optional HTTP probe of POS /health to compare db_path fields.
 * @param {string} [posBaseUrl]
 * @returns {Promise<{ pos_db_path?: string, pos_health_ok?: boolean, pos_db_match?: boolean, pos_health_error?: string }>}
 */
async function probePosServerDbPath(posBaseUrl) {
  const base = String(posBaseUrl || '').trim().replace(/\/+$/, '');
  if (!base) return {};

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const res = await fetch(`${base}/health`, { signal: controller.signal });
    if (!res.ok) {
      return { pos_health_ok: false, pos_health_error: `HTTP ${res.status}` };
    }
    const body = await res.json();
    const posDbPath = body?.db_path ? path.resolve(String(body.db_path)) : null;
    const localPath = path.resolve(resolvePosDbPath());
    return {
      pos_health_ok: true,
      pos_db_path: posDbPath || undefined,
      pos_db_match: posDbPath ? posDbPath === localPath : undefined,
    };
  } catch (e) {
    return { pos_health_ok: false, pos_health_error: String(e?.message || e) };
  } finally {
    clearTimeout(timer);
  }
}

function resolvePosHealthUrl() {
  const explicit = String(process.env.POS_RPC_HEALTH_URL || '').trim();
  if (explicit) return explicit.replace(/\/+$/, '');
  const rpc = String(process.env.POS_RPC_URL || process.env.VITE_POS_RPC_URL || '').trim();
  if (rpc) return rpc.replace(/\/+$/, '').replace(/\/rpc\/?$/i, '');
  const port = String(process.env.POS_HOST_PORT || '3333').trim();
  const bind = String(process.env.POS_HOST_BIND || '127.0.0.1').trim();
  const host = bind === '0.0.0.0' ? '127.0.0.1' : bind;
  return `http://${host}:${port}`;
}

module.exports = {
  assessDbPathSync,
  expectedPosServerDbPath,
  probePosServerDbPath,
  resolvePosHealthUrl,
};

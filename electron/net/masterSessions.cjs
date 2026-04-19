// =============================================================================
// Multi-tenant session store
// =============================================================================
// Single source of truth for ALL session tokens in the fleet:
//   * tenant sessions → `master_sessions` row with (tenant_id, user_id=<tenant user id>, user_scope='tenant')
//   * super-admin     → `master_sessions` row with (tenant_id=NULL, user_id=<master user id>, user_scope='master')
//
// Why keep session state in the MASTER DB (not each tenant DB)?
//   1. Token verification is ONE SELECT regardless of tenant count.
//   2. An admin can list / revoke sessions across the whole fleet with one
//      query.
//   3. Logout and expiry cleanup do not race against per-tenant connections.
//
// User records (username, role, is_active) still live in their HOME DB:
//   * tenant users in tenants/<slug>/pos.db `users` table
//   * master users in master.db `master_users` table
// After resolving the session row we fetch the user record from the right
// DB. A per-process LRU cache keeps the verify() hot-path free of DB hits.
// =============================================================================
'use strict';

const { randomUUID, createHash } = require('crypto');

const DEFAULT_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_TTL_MS     = 30 * 24 * 60 * 60 * 1000;
const CACHE_MAX      = 1024;

function nowIsoSqlite()   { return new Date().toISOString().replace('T',' ').replace('Z','').substring(0,19); }
function plusMsSqlite(ms) { return new Date(Date.now()+ms).toISOString().replace('T',' ').replace('Z','').substring(0,19); }
function parseSqliteIso(s){ if(!s) return 0; const t = Date.parse(String(s).replace(' ','T')+'Z'); return Number.isFinite(t)?t:0; }
function hashToken(t)     { return createHash('sha256').update(String(t)).digest('hex'); }

/**
 * @param {{
 *   registry: ReturnType<typeof import('../db/tenantRegistry.cjs').createTenantRegistry>,
 * }} opts
 */
function createMasterSessionStore({ registry }) {
  if (!registry || !registry.master) throw new Error('registry with master DB required');
  const master = registry.master;

  // Hot-path prepared statements.
  const sInsert = master.prepare(`
    INSERT INTO master_sessions
      (id, tenant_id, user_id, user_scope, token, ip_address, user_agent, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const sFind = master.prepare(`
    SELECT id, tenant_id, user_id, user_scope, expires_at
      FROM master_sessions WHERE token = ?
  `);
  const sDelete       = master.prepare(`DELETE FROM master_sessions WHERE token = ?`);
  const sDeleteUser   = master.prepare(`DELETE FROM master_sessions WHERE user_id = ? AND user_scope = ?`);
  const sDeleteTenant = master.prepare(`DELETE FROM master_sessions WHERE tenant_id = ?`);
  const sPurge        = master.prepare(`DELETE FROM master_sessions WHERE expires_at < ?`);
  const sMasterUser   = master.prepare(`SELECT id, username, is_active FROM master_users WHERE id = ?`);

  /** token-hash → cached AuthContext */
  const cache = new Map();
  const cacheGet = (k) => {
    const v = cache.get(k);
    if (!v) return null;
    cache.delete(k); cache.set(k, v);
    return v;
  };
  const cacheSet = (k, v) => {
    if (cache.size >= CACHE_MAX) {
      const first = cache.keys().next().value;
      if (first !== undefined) cache.delete(first);
    }
    cache.set(k, v);
  };

  /**
   * @param {{
   *   user: { id: string|number, username?: string, role?: string },
   *   tenantId?: string | null,
   *   scope?: 'tenant' | 'master',
   *   ttlMs?: number, ip?: string, userAgent?: string,
   * }} opts
   * @returns {{ token, expiresAt, userId, username, role, tenantId, tenantSlug, scope, expiresAtMs }}
   */
  function create({ user, tenantId = null, scope = 'tenant', ttlMs, ip, userAgent } = {}) {
    if (!user || !user.id) throw new Error('create: user.id required');
    if (scope === 'tenant' && !tenantId) throw new Error('tenant scope requires tenantId');
    if (scope === 'master' && tenantId) throw new Error('master scope must not have tenantId');

    const token = randomUUID() + randomUUID().replace(/-/g, '');
    const tokenHash = hashToken(token);
    const ms = Math.max(60_000, Math.min(Number(ttlMs) || DEFAULT_TTL_MS, MAX_TTL_MS));
    const expiresAt = plusMsSqlite(ms);
    const createdAt = nowIsoSqlite();

    sInsert.run(
      randomUUID(), tenantId, String(user.id), scope, tokenHash,
      ip ? String(ip).slice(0, 64) : null,
      userAgent ? String(userAgent).slice(0, 255) : null,
      expiresAt, createdAt,
    );
    const tenant = tenantId ? registry.getTenantById(tenantId) : null;
    const ctx = {
      userId: String(user.id),
      username: user.username || null,
      role: user.role || (scope === 'master' ? 'master' : null),
      tenantId, tenantSlug: tenant?.slug || null,
      scope,
      expiresAtMs: Date.parse(expiresAt.replace(' ','T')+'Z'),
    };
    cacheSet(tokenHash, ctx);
    return { token, expiresAt, ...ctx };
  }

  /**
   * Verify + resolve a token. Returns null if the token is unknown, expired,
   * or the underlying user is disabled/missing.
   */
  function verify(token) {
    if (!token || typeof token !== 'string') return null;
    const tokenHash = hashToken(token);
    const cached = cacheGet(tokenHash);
    if (cached) {
      if (cached.expiresAtMs > Date.now()) return cached;
      cache.delete(tokenHash);
    }
    const row = sFind.get(tokenHash);
    if (!row) return null;
    const expMs = parseSqliteIso(row.expires_at);
    if (!expMs || expMs <= Date.now()) {
      try { sDelete.run(tokenHash); } catch { /* ignore */ }
      return null;
    }

    // Resolve the backing user record from the right DB.
    let user; let tenant = null;
    if (row.user_scope === 'master') {
      user = sMasterUser.get(row.user_id);
      if (!user || user.is_active === 0) { try { sDelete.run(tokenHash); } catch { /* ignore */ } return null; }
      user = { id: user.id, username: user.username, role: 'master', is_active: user.is_active };
    } else {
      tenant = registry.getTenantById(row.tenant_id);
      if (!tenant || !tenant.is_active) {
        // Revoke all sessions for a disabled tenant — hygiene.
        try { sDeleteTenant.run(row.tenant_id); } catch { /* ignore */ }
        return null;
      }
      const tdb = registry.openTenantDb(row.tenant_id);
      user = tdb.prepare(
        'SELECT id, username, role, is_active FROM users WHERE id = ?',
      ).get(row.user_id);
      if (!user || user.is_active === 0) {
        try { sDeleteUser.run(row.user_id, 'tenant'); } catch { /* ignore */ }
        return null;
      }
    }

    const ctx = {
      userId: String(user.id),
      username: user.username || null,
      role: user.role || null,
      tenantId: row.tenant_id || null,
      tenantSlug: tenant?.slug || null,
      scope: row.user_scope,
      expiresAtMs: expMs,
    };
    cacheSet(tokenHash, ctx);
    return ctx;
  }

  function destroy(token) {
    if (!token) return false;
    const h = hashToken(token);
    cache.delete(h);
    try { return sDelete.run(h).changes > 0; } catch { return false; }
  }

  function destroyAllForUser(userId, scope = 'tenant') {
    if (!userId) return 0;
    cache.clear();
    try { return sDeleteUser.run(String(userId), scope).changes; } catch { return 0; }
  }

  function destroyAllForTenant(tenantId) {
    if (!tenantId) return 0;
    cache.clear();
    try { return sDeleteTenant.run(tenantId).changes; } catch { return 0; }
  }

  function purgeExpired() {
    try {
      const n = sPurge.run(nowIsoSqlite()).changes;
      if (n > 0) cache.clear();
      return n;
    } catch { return 0; }
  }

  // Background cleanup — 30 min.
  const timer = setInterval(() => { purgeExpired(); }, 30 * 60 * 1000);
  if (timer.unref) timer.unref();

  function stop() { try { clearInterval(timer); } catch { /* ignore */ } }

  return {
    create, verify,
    destroy, destroyAllForUser, destroyAllForTenant,
    purgeExpired, stop,
    _internal: { hashToken, cache },
  };
}

module.exports = { createMasterSessionStore };

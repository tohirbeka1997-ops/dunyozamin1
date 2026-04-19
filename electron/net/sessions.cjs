/**
 * SESSION STORE (HOST SERVER)
 * ============================================================================
 * - Maps opaque session tokens to { userId, username, role, expiresAt }
 * - Persists to the `sessions` SQLite table (schema: id, user_id, token,
 *   ip_address, user_agent, expires_at, created_at) so sessions survive restart.
 * - Has an in-memory LRU cache to avoid a DB query on every RPC request.
 *
 * The host server accepts EITHER:
 *   1. the shared `POS_HOST_SECRET`  (legacy / admin-only / service-to-service)
 *   2. a session token issued by `pos:auth:login`
 *
 * When a session token is used the dispatcher receives an `authContext`
 * with `{ userId, username, role }` so handlers can enforce role checks.
 */

const { randomUUID, createHash } = require('crypto');

const DEFAULT_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
const MAX_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days (DB constraint alignment)
const CACHE_MAX = 512;

function nowIsoSqlite() {
  return new Date().toISOString().replace('T', ' ').replace('Z', '').substring(0, 19);
}

function plusMsIsoSqlite(ms) {
  return new Date(Date.now() + ms).toISOString().replace('T', ' ').replace('Z', '').substring(0, 19);
}

function parseSqliteIso(s) {
  if (!s) return 0;
  // "YYYY-MM-DD HH:MM:SS" -> ms epoch (treated as UTC; matches datetime('now'))
  const t = Date.parse(String(s).replace(' ', 'T') + 'Z');
  return Number.isFinite(t) ? t : 0;
}

function hashToken(token) {
  // We only store a SHA-256 of the token in DB so that a stolen backup cannot
  // be replayed against a live server. The token itself only lives in the
  // client's memory / localStorage and in this process's LRU cache.
  return createHash('sha256').update(String(token)).digest('hex');
}

function createSessionStore({ db }) {
  if (!db) throw new Error('createSessionStore: db is required');

  // --- best-effort schema ensure (existing installs already have it) ---
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        token TEXT NOT NULL UNIQUE,
        ip_address TEXT,
        user_agent TEXT,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
      CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
    `);
  } catch {
    // ignore — migrations already created it
  }

  const stmtInsert = db.prepare(
    `INSERT INTO sessions (id, user_id, token, ip_address, user_agent, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const stmtFind = db.prepare(
    `SELECT s.id, s.user_id, s.expires_at, u.username, u.role, u.is_active
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token = ?`,
  );
  const stmtDelete = db.prepare(`DELETE FROM sessions WHERE token = ?`);
  const stmtDeleteUser = db.prepare(`DELETE FROM sessions WHERE user_id = ?`);
  const stmtPurge = db.prepare(`DELETE FROM sessions WHERE expires_at < ?`);

  // Simple LRU cache: token -> { userId, username, role, expiresAtMs }
  const cache = new Map();
  function cacheGet(token) {
    const v = cache.get(token);
    if (!v) return null;
    cache.delete(token);
    cache.set(token, v);
    return v;
  }
  function cacheSet(token, v) {
    if (cache.size >= CACHE_MAX) {
      const firstKey = cache.keys().next().value;
      if (firstKey !== undefined) cache.delete(firstKey);
    }
    cache.set(token, v);
  }

  function create({ user, ttlMs, ip, userAgent } = {}) {
    if (!user || !user.id) throw new Error('createSession: user.id required');
    const token = randomUUID() + randomUUID().replace(/-/g, '');
    const tokenHash = hashToken(token);
    const ms = Math.max(60_000, Math.min(Number(ttlMs) || DEFAULT_TTL_MS, MAX_TTL_MS));
    const expiresAt = plusMsIsoSqlite(ms);
    const createdAt = nowIsoSqlite();
    try {
      stmtInsert.run(
        randomUUID(),
        String(user.id),
        tokenHash,
        ip ? String(ip).slice(0, 64) : null,
        userAgent ? String(userAgent).slice(0, 255) : null,
        expiresAt,
        createdAt,
      );
    } catch (e) {
      throw new Error('sessions.create failed: ' + (e?.message || e));
    }
    const ctx = {
      userId: String(user.id),
      username: user.username || null,
      role: user.role || null,
      expiresAtMs: Date.parse(expiresAt.replace(' ', 'T') + 'Z'),
    };
    cacheSet(tokenHash, ctx);
    return { token, expiresAt, ...ctx };
  }

  function verify(token) {
    if (!token || typeof token !== 'string') return null;
    const tokenHash = hashToken(token);
    // 1. cache
    const cached = cacheGet(tokenHash);
    if (cached) {
      if (cached.expiresAtMs > Date.now()) return cached;
      cache.delete(tokenHash);
    }
    // 2. DB
    const row = stmtFind.get(tokenHash);
    if (!row) return null;
    if (row.is_active === 0) {
      // revoke everything for disabled user
      try { stmtDeleteUser.run(row.user_id); } catch { /* ignore */ }
      return null;
    }
    const expMs = parseSqliteIso(row.expires_at);
    if (!expMs || expMs <= Date.now()) {
      try { stmtDelete.run(tokenHash); } catch { /* ignore */ }
      return null;
    }
    const ctx = {
      userId: String(row.user_id),
      username: row.username || null,
      role: row.role || null,
      expiresAtMs: expMs,
    };
    cacheSet(tokenHash, ctx);
    return ctx;
  }

  function destroy(token) {
    if (!token) return false;
    const tokenHash = hashToken(token);
    cache.delete(tokenHash);
    try {
      const info = stmtDelete.run(tokenHash);
      return info.changes > 0;
    } catch {
      return false;
    }
  }

  function destroyAllForUser(userId) {
    if (!userId) return 0;
    cache.clear(); // simplest: flush all cache
    try {
      const info = stmtDeleteUser.run(String(userId));
      return info.changes;
    } catch {
      return 0;
    }
  }

  function purgeExpired() {
    try {
      const n = stmtPurge.run(nowIsoSqlite()).changes;
      if (n > 0) cache.clear();
      return n;
    } catch {
      return 0;
    }
  }

  // Periodic cleanup (every 30 min); ignored if host server is short-lived.
  const purgeTimer = setInterval(() => { purgeExpired(); }, 30 * 60 * 1000);
  if (purgeTimer.unref) purgeTimer.unref();

  return {
    create,
    verify,
    destroy,
    destroyAllForUser,
    purgeExpired,
    _internal: { hashToken, cache },
  };
}

module.exports = { createSessionStore };

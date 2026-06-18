'use strict';

/**
 * Centralized authorization helpers for IPC handlers.
 *
 * Goal: a renderer compromise (XSS in a webview, malicious extension, leaked
 * preload bridge) MUST NOT be able to call destructive privileged channels
 * unless the currently authenticated POS user is an admin.
 *
 * This complements (not replaces) the LAN/RPC role enforcement done in
 * `electron/net/rpcDispatch.cjs` — those rules apply to remote callers,
 * while this module guards local IPC.
 */

const { getCurrentUserId, getCurrentUserRoleCache } = require('./currentUser.cjs');
const { createError, ERROR_CODES } = require('./errors.cjs');

function getCurrentUserRole(db) {
  const userId = getCurrentUserId();
  if (!userId) return null;

  // Primary source of truth: canonical RBAC via user_roles -> roles (matches
  // AuthService.login). Most installs have NO `users.role` column.
  try {
    const row = db
      .prepare(
        `
        SELECT r.code AS code
        FROM user_roles ur
        INNER JOIN roles r ON ur.role_id = r.id
        INNER JOIN users u ON u.id = ur.user_id
        WHERE ur.user_id = ? AND r.is_active = 1 AND u.is_active = 1
        ORDER BY CASE r.code
          WHEN 'admin' THEN 0
          WHEN 'manager' THEN 1
          ELSE 2
        END, r.code
        LIMIT 1
      `,
      )
      .get(userId);
    if (row?.code) return String(row.code).toLowerCase();
  } catch {
    // user_roles/roles may be missing on some schemas — fall through.
  }

  // Legacy fallback: single-tenant DBs bootstrapped with a `users.role` column
  // (e.g. multi-tenant master-admin seeding).
  try {
    const row = db.prepare('SELECT role FROM users WHERE id = ? AND is_active = 1').get(userId);
    return row?.role ? String(row.role).toLowerCase() : null;
  } catch {
    return null;
  }
}

function requireAuthenticated(db) {
  const role = getCurrentUserRole(db);
  if (!role) {
    throw createError(ERROR_CODES.PERMISSION_DENIED, 'Authentication required');
  }
  return role;
}

function requireRole(db, allowedRoles) {
  const role = requireAuthenticated(db);
  const allowed = new Set((allowedRoles || []).map((r) => String(r).toLowerCase()));
  if (!allowed.has(role)) {
    throw createError(
      ERROR_CODES.PERMISSION_DENIED,
      `Role "${role}" is not allowed for this operation`
    );
  }
  return role;
}

function requireAdmin(db) {
  return requireRole(db, ['admin']);
}

/**
 * Resolve the acting user's role for IPC authorization.
 * Prefers live DB RBAC when a user id is set; falls back to the session
 * cache synced from the renderer (pos:auth:setSessionUser / login).
 */
function resolveActorRole(db) {
  if (db && getCurrentUserId()) {
    const fromDb = getCurrentUserRole(db);
    if (fromDb) return fromDb;
  }
  const cached = getCurrentUserRoleCache();
  return cached ? String(cached).toLowerCase() : null;
}

/**
 * Keys in `pos-config.json` that, if changed, can effectively pivot to host
 * admin (the host secret is also the LAN "adminBypass" token). These must
 * never be writable by anything below `admin`.
 */
const SENSITIVE_APP_CONFIG_KEYS = Object.freeze([
  'host.secret',
  'host.bind',
  'host.port',
  'host.corsOrigins',
  'host.metricsSecret',
  'host.trustProxy',
]);

function getNested(obj, dottedKey) {
  if (!obj || typeof obj !== 'object') return undefined;
  return dottedKey.split('.').reduce((acc, k) => (acc == null ? acc : acc[k]), obj);
}

function patchTouchesSensitiveKeys(patch) {
  if (!patch || typeof patch !== 'object') return [];
  return SENSITIVE_APP_CONFIG_KEYS.filter((k) => getNested(patch, k) !== undefined);
}

/**
 * Throws PERMISSION_DENIED if `patch` writes a sensitive key while `role`
 * is not 'admin'. Use from both Electron IPC and LAN RPC paths.
 *
 * @param {object} patch
 * @param {string|null} role
 */
function assertAppConfigPatchAllowed(patch, role) {
  const touched = patchTouchesSensitiveKeys(patch);
  if (touched.length === 0) return;
  if (String(role || '').toLowerCase() === 'admin') return;
  throw createError(
    ERROR_CODES.PERMISSION_DENIED,
    `Bu sozlamalarni faqat administrator o'zgartira oladi: ${touched.join(', ')}`
  );
}

module.exports = {
  getCurrentUserRole,
  resolveActorRole,
  requireAuthenticated,
  requireRole,
  requireAdmin,
  SENSITIVE_APP_CONFIG_KEYS,
  patchTouchesSensitiveKeys,
  assertAppConfigPatchAllowed,
};

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

const { getCurrentUserId } = require('./currentUser.cjs');
const { createError, ERROR_CODES } = require('./errors.cjs');

function getCurrentUserRole(db) {
  const userId = getCurrentUserId();
  if (!userId) return null;
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
    `Only admins may change ${touched.join(', ')}`
  );
}

module.exports = {
  getCurrentUserRole,
  requireAuthenticated,
  requireRole,
  requireAdmin,
  SENSITIVE_APP_CONFIG_KEYS,
  patchTouchesSensitiveKeys,
  assertAppConfigPatchAllowed,
};

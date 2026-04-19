// =============================================================================
// Append-only audit trail for sensitive operations
// =============================================================================
// Why separate from pino/console logs?
//   * Auditors care about completeness + tamper-evidence, not readability.
//   * We ship a single `audit.log` (JSONL) — one event per line, never mutated.
//   * Log rotation is handled by the OS (logrotate) using a size trigger.
//   * All rows are UTC ISO-8601 timestamped and include the actor, channel,
//     source IP, outcome, and (for denials) the reason.
//
// Events recorded:
//   * auth.login               (success / failure)
//   * auth.logout
//   * auth.denied              (permission denied for RPC channel)
//   * rate_limit.blocked       (per-IP or per-login limit hit)
//   * rpc.admin                (any channel that required admin bypass)
//   * rpc.dangerous            (explicit allowlist: user mutations, DB wipe, etc.)
//
// We do NOT log full RPC payloads by default — they can contain customer PII
// (phone numbers, names). The code records only channel names + small metadata.
// =============================================================================
'use strict';

const fs = require('fs');
const path = require('path');

const DANGEROUS_CHANNELS = new Set([
  'pos:database:wipeDataOnly',
  'pos:database:wipeAllData',
  'pos:database:backup',
  'pos:users:create',
  'pos:users:update',
  'pos:users:delete',
  'pos:users:resetPassword',
  'pos:users:setRole',
  'pos:settings:update',
  'pos:appConfig:set',
  'pos:appConfig:reset',
]);

/**
 * @param {{
 *   filePath?: string | null,
 *   enabled?: boolean,
 *   now?: () => Date,
 *   maxBufferBytes?: number,   // soft buffer limit in case of slow disk
 * }} [opts]
 */
function createAuditLogger(opts = {}) {
  const enabled = opts.enabled !== false;
  const filePath = opts.filePath || null;
  const now = opts.now || (() => new Date());

  let stream = null;
  let warnedOpenFailure = false;

  function openStream() {
    if (!enabled || !filePath) return null;
    if (stream) return stream;
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      stream = fs.createWriteStream(filePath, { flags: 'a', mode: 0o640 });
      stream.on('error', (err) => {
        if (!warnedOpenFailure) {
          warnedOpenFailure = true;
          console.error('[audit] write stream error:', err.message);
        }
      });
      return stream;
    } catch (err) {
      if (!warnedOpenFailure) {
        warnedOpenFailure = true;
        console.error('[audit] cannot open file:', err.message);
      }
      return null;
    }
  }

  /**
   * Record one event. Non-blocking (write is buffered by Node). If the writer
   * is unavailable (no filePath, disk full), the call is a no-op — auditing
   * must never crash the request path.
   *
   * @param {string} type - e.g. 'auth.login.failure'
   * @param {Object} [fields]
   */
  function record(type, fields = {}) {
    if (!enabled) return;
    const out = openStream();
    if (!out) return;
    const row = {
      t: now().toISOString(),
      type,
      ...redact(fields),
    };
    try {
      out.write(JSON.stringify(row) + '\n');
    } catch (err) {
      // stream went bad — swallow, next openStream() will try again.
    }
  }

  // ---- Convenience emitters -------------------------------------------------
  function loginSuccess({ username, userId, ip, ua }) {
    record('auth.login.success', { username, userId, ip, ua: clampUa(ua) });
  }
  function loginFailure({ username, ip, reason, ua }) {
    record('auth.login.failure', { username, ip, reason, ua: clampUa(ua) });
  }
  function logout({ username, userId, ip }) {
    record('auth.logout', { username, userId, ip });
  }
  function denied({ channel, ip, auth, role, reason }) {
    record('auth.denied', { channel, ip, auth, role, reason });
  }
  function rateLimitBlocked({ key, kind, ip, channel }) {
    record('rate_limit.blocked', { key: shortKey(key), kind, ip, channel });
  }
  function rpcDangerous({ channel, ip, auth, userId }) {
    record('rpc.dangerous', { channel, ip, auth, userId });
  }
  function rpcAdmin({ channel, ip }) {
    record('rpc.admin', { channel, ip });
  }

  function isDangerous(channel) {
    return DANGEROUS_CHANNELS.has(channel);
  }

  async function close() {
    if (!stream) return;
    await new Promise((resolve) => stream.end(resolve));
    stream = null;
  }

  return {
    record,
    loginSuccess, loginFailure, logout,
    denied, rateLimitBlocked,
    rpcDangerous, rpcAdmin,
    isDangerous,
    close,
    _internal: { openStream }, // tests only
  };
}

// Strip obvious secrets/PII before recording. This is defense-in-depth — we
// already choose which fields we pass in — but guards against future mistakes.
const SECRET_KEYS = ['password', 'password_hash', 'token', 'secret', 'authorization'];
function redact(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (SECRET_KEYS.includes(k.toLowerCase())) {
      out[k] = '[REDACTED]';
      continue;
    }
    if (typeof v === 'string' && v.length > 256) {
      out[k] = v.slice(0, 256) + '…';
    } else {
      out[k] = v;
    }
  }
  return out;
}

function shortKey(k) {
  if (!k) return null;
  return String(k).length > 64 ? String(k).slice(0, 64) + '…' : String(k);
}

function clampUa(ua) {
  if (!ua) return undefined;
  return String(ua).slice(0, 200);
}

module.exports = { createAuditLogger, DANGEROUS_CHANNELS };

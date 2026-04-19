// =============================================================================
// In-process rate limiter for the POS HTTP RPC server
// =============================================================================
// Goals:
//   * Blunt brute-force against pos:auth:login (the only externally-interesting
//     surface we expose).
//   * Cap runaway clients hammering /rpc so one buggy cashier terminal can't
//     starve the rest of the fleet.
//   * Work WITHOUT a shared state store (Redis) — we have one pos-server, in
//     one process. Everything is a bounded Map with periodic GC.
//
// Algorithm: fixed-window counter with sliding reset. Simple, cheap, good
// enough for the volumes we see (10-30 RPS total). For higher scale, swap to
// Redis + token-bucket, but the public API of this module stays the same.
// =============================================================================
'use strict';

/**
 * Create a rate limiter.
 *
 * @typedef {Object} Limit
 * @property {number} windowMs   Reset window in ms.
 * @property {number} max        Max requests per key per window.
 *
 * @param {{
 *   rpc?: Limit,        // Overall /rpc per-IP budget. Default: 600/min
 *   login?: Limit,      // pos:auth:login per-IP budget. Default: 10/15min
 *   gcIntervalMs?: number,
 *   now?: () => number,  // injectable for tests
 * }} [opts]
 */
function createRateLimiter(opts = {}) {
  const rpcLimit = {
    windowMs: 60_000,
    max: 600,
    ...(opts.rpc || {}),
  };
  const loginLimit = {
    windowMs: 15 * 60_000,
    max: 10,
    ...(opts.login || {}),
  };
  const now = opts.now || (() => Date.now());

  // Key → { count, resetAt }
  const rpcBuckets = new Map();
  const loginBuckets = new Map();

  function _hit(map, key, limit) {
    if (!key) return { allowed: true, remaining: limit.max, retryAfterMs: 0 };
    const t = now();
    let b = map.get(key);
    if (!b || b.resetAt <= t) {
      b = { count: 0, resetAt: t + limit.windowMs };
      map.set(key, b);
    }
    b.count += 1;
    const allowed = b.count <= limit.max;
    const remaining = Math.max(0, limit.max - b.count);
    const retryAfterMs = allowed ? 0 : Math.max(0, b.resetAt - t);
    return { allowed, remaining, retryAfterMs, resetAt: b.resetAt, limit: limit.max };
  }

  // GC old buckets so the Map can't grow unbounded. Critical on long-lived
  // servers — 1 bucket per IP × 15min window × thousands of IPs can add up.
  let gcTimer = null;
  const gcIntervalMs = opts.gcIntervalMs ?? 60_000;

  function gcOnce() {
    const t = now();
    for (const [m] of [[rpcBuckets], [loginBuckets]]) {
      for (const [k, v] of m.entries()) {
        if (v.resetAt <= t) m.delete(k);
      }
    }
  }

  function start() {
    if (gcTimer) return;
    gcTimer = setInterval(gcOnce, gcIntervalMs);
    if (typeof gcTimer.unref === 'function') gcTimer.unref();
  }

  function stop() {
    if (gcTimer) clearInterval(gcTimer);
    gcTimer = null;
  }

  return {
    /**
     * Check whether an /rpc request is allowed, regardless of channel.
     * @param {string} key - usually client IP
     */
    checkRpc(key) {
      return _hit(rpcBuckets, key, rpcLimit);
    },
    /**
     * Additional check for pos:auth:login — stricter, separate bucket so a
     * legit cashier terminal doing many reads doesn't exhaust login attempts.
     * Call this ONLY when channel === 'pos:auth:login'.
     * @param {string} key - ideally `${ip}|${username}` so distributed
     *   enumeration attacks are throttled per-target-user, not per-IP.
     */
    checkLogin(key) {
      return _hit(loginBuckets, key, loginLimit);
    },
    /**
     * Introspection for tests / metrics / `/debug` endpoints.
     */
    stats() {
      return {
        rpcBuckets: rpcBuckets.size,
        loginBuckets: loginBuckets.size,
        rpcLimit,
        loginLimit,
      };
    },
    /** Clear all buckets — used by tests. */
    reset() {
      rpcBuckets.clear();
      loginBuckets.clear();
    },
    start,
    stop,
    gcOnce,
  };
}

/**
 * Pull a caller-identifying key from a Node http.IncomingMessage. Respects
 * X-Forwarded-For only if POS_TRUST_PROXY=1 (nginx in front of us). Never
 * trust remote-provided headers by default.
 */
function keyForRequest(req, { trustProxy = false } = {}) {
  if (trustProxy) {
    const xff = req.headers['x-forwarded-for'];
    if (typeof xff === 'string' && xff.length) {
      // first IP in the chain is the original client
      return xff.split(',')[0].trim();
    }
  }
  // req.socket.remoteAddress is never undefined on a real request, but be safe.
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

module.exports = { createRateLimiter, keyForRequest };

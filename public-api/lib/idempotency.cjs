'use strict';

/**
 * Lightweight in-memory idempotency cache for POST endpoints.
 *
 * Goal: a Telegram mini-app user double-tapping "Buyurtma" must NOT create
 * two orders. The client sends a fresh UUID in `Idempotency-Key`; the
 * server stores the first response for ~5 minutes and replays it for any
 * follow-up call with the same key (and same scope, e.g. customer id) so
 * retries are safe.
 *
 * The cache is intentionally process-local. For multi-instance deployments
 * upgrade to Redis / DB-backed once horizontal scale is needed.
 */

const TTL_MS = Number.parseInt(process.env.IDEMPOTENCY_TTL_MS || '', 10) || 5 * 60 * 1000;
const MAX_ENTRIES = Number.parseInt(process.env.IDEMPOTENCY_MAX_ENTRIES || '', 10) || 5000;

const store = new Map();
const inFlight = new Map();

function nowMs() { return Date.now(); }

function evictExpiredAndCap() {
  const now = nowMs();
  for (const [k, entry] of store) {
    if (entry.expiresAt <= now) store.delete(k);
  }
  while (store.size > MAX_ENTRIES) {
    const oldestKey = store.keys().next().value;
    if (oldestKey === undefined) break;
    store.delete(oldestKey);
  }
}

function buildKey(scope, idempotencyKey) {
  return `${scope}::${idempotencyKey}`;
}

function readKey(req) {
  const v = req.headers?.['idempotency-key'] || req.headers?.['x-idempotency-key'];
  if (!v) return null;
  const s = String(v).trim();
  if (!s || s.length > 200) return null;
  return s;
}

/**
 * Express middleware factory.
 *
 *   app.post('/orders', idempotency('orders', (req) => req.customerId), handler);
 *
 * Behaviour:
 *   - No `Idempotency-Key` header → pass through (no caching).
 *   - First request with a given (scope, key) → run handler, cache the
 *     final response (status + JSON body), then send.
 *   - Concurrent duplicate while the first is still in flight → wait for
 *     the first to finish, then replay its response.
 *   - Subsequent request after success → replay cached response within TTL.
 *
 * @param {string} bucket - Logical scope (e.g. 'orders').
 * @param {(req:any)=>string|number|null} scopeFn - Per-tenant/customer scope
 *   so two different users can re-use the same key without cross-leak.
 */
function idempotency(bucket, scopeFn) {
  return async function idempotencyMiddleware(req, res, next) {
    const key = readKey(req);
    if (!key) return next();

    const scopeRaw = typeof scopeFn === 'function' ? scopeFn(req) : null;
    const scope = `${bucket}:${scopeRaw == null ? 'anon' : String(scopeRaw)}`;
    const cacheKey = buildKey(scope, key);

    evictExpiredAndCap();

    const cached = store.get(cacheKey);
    if (cached && cached.expiresAt > nowMs()) {
      res.setHeader('Idempotent-Replay', 'true');
      res.status(cached.status).json(cached.body);
      return;
    }

    const pending = inFlight.get(cacheKey);
    if (pending) {
      try {
        const result = await pending;
        res.setHeader('Idempotent-Replay', 'true');
        res.status(result.status).json(result.body);
      } catch (e) {
        next(e);
      }
      return;
    }

    let resolveOuter;
    let rejectOuter;
    const promise = new Promise((resolve, reject) => {
      resolveOuter = resolve;
      rejectOuter = reject;
    });
    inFlight.set(cacheKey, promise);

    const originalJson = res.json.bind(res);
    let captured = null;
    res.json = (body) => {
      captured = { status: res.statusCode || 200, body };
      return originalJson(body);
    };

    res.on('finish', () => {
      try {
        if (captured && captured.status >= 200 && captured.status < 300) {
          store.set(cacheKey, { ...captured, expiresAt: nowMs() + TTL_MS });
          resolveOuter(captured);
        } else if (captured) {
          // Don't cache 4xx/5xx — let client retry with corrections.
          resolveOuter(captured);
        } else {
          resolveOuter({ status: res.statusCode || 200, body: null });
        }
      } catch (e) {
        rejectOuter(e);
      } finally {
        inFlight.delete(cacheKey);
      }
    });
    res.on('close', () => {
      inFlight.delete(cacheKey);
      try { rejectOuter(new Error('connection closed')); } catch { /* ignore */ }
    });

    next();
  };
}

function _resetForTests() {
  store.clear();
  inFlight.clear();
}

module.exports = { idempotency, _resetForTests };

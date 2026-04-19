const http = require('http');
const { createRpcDispatcher } = require('./rpcDispatch.cjs');
const { createSessionStore } = require('./sessions.cjs');
const { metrics, startTimer, renderMetrics } = require('./metrics.cjs');
const { createRateLimiter } = require('./rateLimit.cjs');
const { createAuditLogger } = require('./auditLog.cjs');

function normalizeUrl(url) {
  if (!url) return '';
  return String(url).replace(/\/+$/, '');
}

function parseAuth(req) {
  const h = req.headers?.authorization || req.headers?.Authorization;
  if (!h) return null;
  const s = String(h);
  if (!s.toLowerCase().startsWith('bearer ')) return null;
  return s.slice('bearer '.length).trim();
}

function clientIp(req, { trustProxy = false } = {}) {
  // Security: trusting X-Forwarded-For from the outside lets any client spoof
  // their IP. We only read it when the operator has explicitly declared that
  // nginx/cloudflare sits in front (POS_TRUST_PROXY=1).
  if (trustProxy) {
    const xff = req.headers?.['x-forwarded-for'];
    if (xff) return String(xff).split(',')[0].trim().slice(0, 64);
  }
  return (req.socket?.remoteAddress || '').replace(/^::ffff:/, '').slice(0, 64);
}

async function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 2_000_000) {
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function json(res, status, payload, extraHeaders = {}) {
  const text = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    ...extraHeaders,
  });
  res.end(text);
}

/** @param {string[]|undefined|null} corsOrigins — empty / missing => allow any origin (`*`). */
function corsHeadersForRequest(req, corsOrigins) {
  const origin = req.headers?.origin ? String(req.headers.origin) : '';
  const list = Array.isArray(corsOrigins) ? corsOrigins.map((s) => String(s).trim()).filter(Boolean) : [];
  const allowAll = list.length === 0 || list.includes('*');
  let allowOrigin = '*';
  if (!allowAll) {
    if (origin && list.includes(origin)) allowOrigin = origin;
    else return null;
  }
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Client-Version',
    'Access-Control-Max-Age': '86400',
  };
}

/**
 * Channels that are always callable — they must work BEFORE login.
 * Any other channel requires a valid session token (or the shared secret).
 */
const PUBLIC_CHANNELS = new Set([
  'pos:auth:login',
  'pos:auth:requestPasswordReset',
  'pos:auth:confirmPasswordReset',
  'pos:health',
  'pos:appConfig:get',
]);

/**
 * Channels a regular authenticated user may NOT call even with a session —
 * reserved for the shared admin secret (bootstrap/scripts/emergency).
 */
const ADMIN_ONLY_CHANNELS = new Set([
  'pos:settings:resetDatabase',
  'pos:database:wipe',
  'pos:database:wipeTransactional',
]);

/**
 * Start HOST RPC server for browser/LAN clients.
 *
 * Endpoints:
 * - GET  /health
 * - POST /rpc   { channel, args }    Authorization: Bearer <token|secret>
 */
function startHostServer({
  services,
  db,
  bind = '0.0.0.0',
  port = 3333,
  secret,
  corsOrigins,
  metricsSecret, // optional; falls back to `secret` for backward-compat
  trustProxy = false,      // set true when behind nginx/cloudflare
  rateLimit: rateLimitOpts,
  auditLogPath,            // e.g. /var/lib/pos/logs/audit.log
  auditEnabled = true,
  // ---- Multi-tenant (Bosqich 15) -------------------------------------------
  // When `multiTenant` is provided, `services`/`db` may be null — the server
  // resolves tenants dynamically via the registry. The caller wires:
  //   registry, servicesCache, masterSessions, dispatcher
  multiTenant = null,
}) {
  if (!secret) throw new Error('host secret is required');
  if (!multiTenant && (!services || !db)) {
    throw new Error('services/db required in single-tenant mode');
  }

  // Session store: single-tenant uses the legacy per-DB store; multi-tenant
  // uses the master store (passed in). We alias `sessions` to whichever is
  // active so downstream code stays identical.
  const sessions = multiTenant?.masterSessions || createSessionStore({ db });
  const dispatch = multiTenant?.dispatcher?.dispatch
    ? multiTenant.dispatcher.dispatch
    : createRpcDispatcher({ services, db, sessions });
  const effectiveMetricsSecret = metricsSecret || secret;

  const limiter = createRateLimiter(rateLimitOpts);
  limiter.start();

  const audit = createAuditLogger({
    filePath: auditLogPath || null,
    enabled: auditEnabled && !!auditLogPath,
  });

  // Emit a metric every time we write an audit event. Cheap proxy tied to the
  // same lifecycle as the underlying writer — no separate bookkeeping.
  const auditRecord = audit.record;
  audit.record = function wrappedRecord(type, fields) {
    try { metrics.auditEventsTotal.inc({ type }); } catch { /* ignore */ }
    return auditRecord(type, fields);
  };

  // Count a served HTTP response into Prometheus counters + histogram.
  // Routes that aren't matched (404) are lumped as 'other' so we don't leak
  // user-controlled URL strings into label cardinality.
  function observeHttp(route, method, status, stopTimer) {
    try {
      metrics.httpRequestsTotal.inc({ route, method, status: String(status) });
      if (stopTimer) metrics.httpRequestDurationSeconds.observe({ route, method }, stopTimer());
    } catch { /* never fail the response because of metrics */ }
  }

  const server = http.createServer(async (req, res) => {
    const method = req.method || 'GET';
    const url = req.url || '/';
    const stop = startTimer();
    // Route label is a closure var so per-handler code can mutate it and the
    // single `finish` observer picks the final value.
    const routeRef = { value: 'other' };
    // Observe once per response (including error paths) — avoids sprinkling
    // `observeHttp` across every return.
    res.once('finish', () => observeHttp(routeRef.value, method, res.statusCode, stop));
    res.once('close', () => {
      // Client aborted before finish; still record something.
      if (!res.writableFinished) observeHttp(routeRef.value, method, 0, stop);
    });
    try {
      const cors = corsHeadersForRequest(req, corsOrigins);
      const c = cors || {};

      if (method === 'OPTIONS' && (url === '/health' || url === '/rpc' || url === '/metrics')) {
        routeRef.value = url.slice(1);
        if (!cors) {
          res.writeHead(403).end();
          return;
        }
        res.writeHead(204, c).end();
        return;
      }

      if (method === 'GET' && url === '/health') {
        routeRef.value = 'health';
        return json(res, 200, { ok: true, status: 'ok', time: new Date().toISOString() }, c);
      }

      // ---- /metrics — Prometheus scrape endpoint ----
      // Loopback is always allowed (so a sidecar Prometheus on the same host
      // or docker network can scrape without a secret). External requests
      // must supply `Authorization: Bearer <metricsSecret>`.
      if (method === 'GET' && url === '/metrics') {
        routeRef.value = 'metrics';
        // Honor `trustProxy` here too so the loopback-bypass works correctly
        // when nginx (expected to deny /metrics publicly) has to reach the
        // pod on a non-loopback interface in a container network.
        const ip = clientIp(req, { trustProxy });
        const isLoopback = ip === '127.0.0.1' || ip === '::1' || ip === '';
        if (!isLoopback) {
          const token = parseAuth(req);
          if (token !== effectiveMetricsSecret) {
            res.writeHead(401, { 'Content-Type': 'text/plain' });
            res.end('unauthorized');
            return;
          }
        }
        try {
          const body = await renderMetrics({
            db,
            sessions,
            tenantRegistry: multiTenant?.registry || null,
          });
          res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' });
          res.end(body);
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end(`metrics error: ${err?.message || err}`);
        }
        return;
      }

      if (method === 'POST' && url === '/rpc') {
        routeRef.value = 'rpc';

        // ---- Global per-IP rate limit (denies loopback bypass intentionally
        // — rate limiting local RPC is a nice safety net against runaway
        // scripts on the same host). Loopback volumes are never close to the
        // default 600/min so this is effectively free in normal operation.
        const ip = clientIp(req, { trustProxy });
        const gate = limiter.checkRpc(ip);
        if (!gate.allowed) {
          try { metrics.rateLimitBlockedTotal.inc({ kind: 'rpc' }); } catch { /* ignore */ }
          audit.rateLimitBlocked({ key: ip, kind: 'rpc', ip });
          res.setHeader('Retry-After', Math.ceil(gate.retryAfterMs / 1000));
          return json(
            res,
            429,
            { ok: false, error: { code: 'RATE_LIMITED', message: 'Too many requests' } },
            c,
          );
        }

        const token = parseAuth(req);
        if (!token) {
          return json(res, 401, { ok: false, error: { code: 'AUTH_ERROR', message: 'Unauthorized' } }, c);
        }

        // Resolve auth context:
        //  - `adminBypass`   = shared POS_HOST_SECRET (no user context)
        //  - `authContext`   = session-based (userId, username, role)
        let adminBypass = false;
        let authContext = null;
        if (token === secret) {
          adminBypass = true;
        } else {
          authContext = sessions.verify(token);
          if (!authContext) {
            return json(
              res,
              401,
              { ok: false, error: { code: 'AUTH_ERROR', message: 'Invalid or expired session' } },
              c,
            );
          }
        }

        const payload = await readJson(req);
        const channel = payload?.channel;
        const args = payload?.args;
        // `tenant` — optional string (slug) when caller wants to target a
        // specific tenant. Only trusted in multi-tenant mode; silently
        // ignored in single-tenant mode.
        const payloadTenant = typeof payload?.tenant === 'string' ? payload.tenant : null;

        if (!channel || typeof channel !== 'string') {
          return json(
            res,
            400,
            { ok: false, error: { code: 'VALIDATION_ERROR', message: 'channel is required' } },
            c,
          );
        }

        // ---- Stricter rate limit for pos:auth:login: key = ip|username so
        // distributed attempts against a single user (credential stuffing) are
        // throttled even across different IPs, while one IP trying many users
        // is also bounded. We intentionally DO NOT return a different error
        // from "invalid credentials" — the attacker learns nothing.
        //
        // Supports both positional (`[username, password]`) and object
        // (`[{ username, password }]`) shapes; older frontends may still send
        // either.
        if (channel === 'pos:auth:login') {
          const firstArg = args?.[0];
          const rawUname = typeof firstArg === 'string'
            ? firstArg
            : (firstArg && typeof firstArg === 'object' ? firstArg.username : '') || '';
          const uname = String(rawUname).slice(0, 80).toLowerCase();
          const loginKey = `${ip}|${uname}`;
          const loginGate = limiter.checkLogin(loginKey);
          if (!loginGate.allowed) {
            try { metrics.rateLimitBlockedTotal.inc({ kind: 'login' }); } catch { /* ignore */ }
            audit.rateLimitBlocked({ key: loginKey, kind: 'login', ip, channel });
            try { metrics.authLoginsTotal.inc({ outcome: 'rate_limited' }); } catch { /* ignore */ }
            res.setHeader('Retry-After', Math.ceil(loginGate.retryAfterMs / 1000));
            return json(
              res,
              429,
              { ok: false, error: { code: 'RATE_LIMITED', message: 'Too many login attempts' } },
              c,
            );
          }
        }

        // Admin-only channels: reject regular users even if authenticated.
        if (ADMIN_ONLY_CHANNELS.has(channel) && !adminBypass) {
          audit.denied({
            channel, ip, auth: authContext ? 'session' : 'anon',
            role: authContext?.role || null,
            reason: 'admin_only_channel',
          });
          return json(
            res,
            200,
            { ok: false, error: { code: 'PERMISSION_DENIED', message: 'Admin-only channel' } },
            c,
          );
        }

        // Dangerous + admin-bypass-hit channels get audit trails.
        if (adminBypass) {
          audit.rpcAdmin({ channel, ip });
        }
        if (audit.isDangerous(channel)) {
          audit.rpcDangerous({
            channel, ip,
            auth: adminBypass ? 'admin' : 'session',
            userId: authContext?.userId || null,
          });
        }

        // Public channels (login, health, appConfig:get) — always allowed.
        // Everything else requires EITHER the shared secret OR a valid session.
        // (`adminBypass` and `authContext` above already enforce this; no extra
        //  check is needed here, just pass context through.)
        void PUBLIC_CHANNELS;

        try {
          const data = await dispatch(channel, args, {
            authContext,
            adminBypass,
            payloadTenant,
            ip,
            userAgent: String(req.headers?.['user-agent'] || '').slice(0, 255),
          });
          if (channel === 'pos:auth:login') {
            // The service returns `{success:false}` for bad credentials
            // instead of throwing — inspect the result to pick the label.
            try {
              const outcome = data && data.success === false
                ? 'invalid_credentials'
                : 'success';
              metrics.authLoginsTotal.inc({ outcome });
              const firstArg = args?.[0];
              const uname = String(
                typeof firstArg === 'string'
                  ? firstArg
                  : (firstArg && typeof firstArg === 'object' ? firstArg.username : '') || '',
              ).slice(0, 80);
              const ua = req.headers?.['user-agent'];
              if (outcome === 'success') {
                audit.loginSuccess({
                  username: uname,
                  userId: data?.user?.id || null,
                  ip, ua,
                });
              } else {
                audit.loginFailure({
                  username: uname, ip, ua,
                  reason: data?.error?.code || data?.reason || 'invalid_credentials',
                });
              }
            } catch { /* ignore */ }
          }
          if (channel === 'pos:auth:logout' && authContext) {
            audit.logout({
              username: authContext.username || null,
              userId: authContext.userId || null,
              ip,
            });
          }
          return json(res, 200, { ok: true, data }, c);
        } catch (err) {
          if (channel === 'pos:auth:login') {
            const outcome = (err && err.code === 'VALIDATION_ERROR')
              ? 'invalid_credentials'
              : 'error';
            try { metrics.authLoginsTotal.inc({ outcome }); } catch { /* ignore */ }
            try {
              const firstArg = args?.[0];
              const uname = String(
                typeof firstArg === 'string'
                  ? firstArg
                  : (firstArg && typeof firstArg === 'object' ? firstArg.username : '') || '',
              ).slice(0, 80);
              audit.loginFailure({
                username: uname,
                ip,
                ua: req.headers?.['user-agent'],
                reason: err?.code || 'server_error',
              });
            } catch { /* ignore */ }
          }
          if (err && typeof err === 'object' && err.code === 'PERMISSION_DENIED') {
            try {
              audit.denied({
                channel, ip,
                auth: adminBypass ? 'admin' : (authContext ? 'session' : 'anon'),
                role: authContext?.role || null,
                reason: err.message || 'denied',
              });
            } catch { /* ignore */ }
          }
          if (err && typeof err === 'object' && 'code' in err && 'message' in err) {
            return json(res, 200, { ok: false, error: err }, c);
          }
          return json(
            res,
            200,
            {
              ok: false,
              error: {
                code: 'INTERNAL_ERROR',
                message: err?.message || String(err),
                details: err?.stack || null,
              },
            },
            c,
          );
        }
      }

      return json(res, 404, { ok: false, error: { code: 'NOT_FOUND', message: 'Not Found' } }, c);
    } catch (e) {
      const cors = corsHeadersForRequest(req, corsOrigins) || {};
      return json(
        res,
        500,
        { ok: false, error: { code: 'INTERNAL_ERROR', message: e?.message || String(e) } },
        cors,
      );
    }
  });

  server.listen(port, bind, () => {
    console.log(`[POSNET] HOST server listening on http://${bind}:${port}`);
  });

  return {
    port,
    bind,
    url: normalizeUrl(`http://${bind}:${port}`),
    sessions,     // exposed for tests / admin tooling
    limiter,      // exposed for tests (reset/stats) and admin introspection
    audit,        // exposed for tests
    close: () =>
      new Promise((resolve) => {
        try {
          limiter.stop();
        } catch { /* ignore */ }
        audit.close().catch(() => { /* ignore */ });
        try {
          server.close(() => resolve());
        } catch {
          resolve();
        }
      }),
  };
}

module.exports = { startHostServer, PUBLIC_CHANNELS, ADMIN_ONLY_CHANNELS };

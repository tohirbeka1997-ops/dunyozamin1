/**
 * Smoke test for /metrics endpoint.
 *   node electron/net/metrics.test.cjs
 *
 * Covers:
 *   - GET /metrics from loopback returns 200 with text/plain;version=0.0.4
 *   - Response contains expected metric names
 *   - RPC call bumps pos_rpc_calls_total{channel="...", outcome="ok"}
 *   - Auth login failure increments pos_auth_logins_total{outcome="invalid_credentials"}
 *   - Non-loopback request without bearer is 401
 *   - Valid bearer allows non-loopback scrape
 */
const http = require('http');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { startHostServer } = require('./hostServer.cjs');

// ----- test mocks (tiny, inline) --------------------------------------------

function makeMockDb(dbFile) {
  const sessions = new Map();
  const users = new Map([
    ['u-admin', { id: 'u-admin', username: 'admin', role: 'admin', password_hash: 'x', is_active: 1, email: null, full_name: 'Admin' }],
  ]);

  function run(sql, args) {
    if (/INSERT INTO sessions/i.test(sql)) {
      const [id, user_id, token, ip, ua, exp, created] = args;
      sessions.set(id, { id, user_id, token, expires_at: exp });
      return { changes: 1 };
    }
    if (/SELECT s\.id, s\.user_id, s\.expires_at, u\.username, u\.role, u\.is_active/i.test(sql)) {
      const [token] = args;
      for (const s of sessions.values()) {
        if (s.token === token) {
          const u = users.get(s.user_id);
          return { id: s.id, user_id: s.user_id, expires_at: s.expires_at, username: u.username, role: u.role, is_active: 1 };
        }
      }
      return undefined;
    }
    if (/DELETE FROM sessions/i.test(sql)) return { changes: 0 };
    if (/UPDATE users SET last_login/i.test(sql)) return { changes: 1 };
    if (/SELECT id, username, role, email, full_name, is_active FROM users WHERE id = \?/i.test(sql)) {
      const u = users.get(args[0]);
      return u ? { id: u.id, username: u.username, role: u.role, email: null, full_name: u.full_name, is_active: 1 } : undefined;
    }
    // Business gauges queries — return zero rows safely.
    if (/sales_orders/i.test(sql)) return { n: 0, rev: 0 };
    if (/FROM shifts/i.test(sql)) return { n: 0 };
    return undefined;
  }

  return {
    // Setting `name` to a real path lets the metrics module derive the
    // backup directory (same parent) and report pos_backup_* gauges.
    name: dbFile || null,
    exec() {},
    prepare(sql) {
      return {
        run: (...args) => run(sql, args),
        get: (...args) => run(sql, args),
        all: (...args) => {
          const r = run(sql, args);
          return Array.isArray(r) ? r : r ? [r] : [];
        },
      };
    },
  };
}

function makeMockServices() {
  return {
    auth: {
      login: (username) => {
        if (username === 'admin') {
          return { success: true, user: { id: 'u-admin', username: 'admin', role: 'admin', full_name: 'Admin', email: null, is_active: 1 } };
        }
        return { success: false, error: 'Invalid credentials' };
      },
      requestPasswordReset: () => ({ success: true }),
      confirmPasswordReset: () => ({ success: true }),
    },
    settings: { get: () => null, getAll: () => ({}) },
  };
}

// ----- http helpers ----------------------------------------------------------

function get(baseUrl, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(baseUrl + path);
    const req = http.request({ method: 'GET', hostname: u.hostname, port: u.port, path: u.pathname, headers }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

function rpcCall(baseUrl, bearer, channel, args = []) {
  return new Promise((resolve, reject) => {
    const u = new URL(baseUrl + '/rpc');
    const body = JSON.stringify({ channel, args });
    const req = http.request(
      {
        method: 'POST',
        hostname: u.hostname,
        port: u.port,
        path: u.pathname,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          Authorization: `Bearer ${bearer}`,
        },
      },
      (res) => {
        let buf = '';
        res.on('data', (c) => (buf += c));
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(buf || '{}') }));
      },
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ----- test runner -----------------------------------------------------------

(async () => {
  const secret = 'TEST-HOST-SECRET';
  const metricsSecret = 'TEST-METRICS-SECRET';

  // Build a disposable data dir with a fake DB file + a backup snapshot.
  // The metrics module reads:
  //   <dbDir>/backups/pos-YYYYMMDD-HHMMSS.db  (gauge: pos_backup_last_age_seconds)
  //   <dbDir>/backups/.last-offsite-sync      (gauge: pos_backup_offsite_last_age_seconds)
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-metrics-test-'));
  const dbFile = path.join(tmpDir, 'pos.db');
  fs.writeFileSync(dbFile, 'not-a-real-sqlite-but-exists');
  const backupDir = path.join(tmpDir, 'backups');
  fs.mkdirSync(backupDir);
  fs.writeFileSync(path.join(backupDir, 'pos-20260101-000000.db'), 'x'.repeat(1024));
  fs.writeFileSync(path.join(backupDir, 'pos-20260102-000000.db'), 'x'.repeat(2048));

  const db = makeMockDb(dbFile);
  const services = makeMockServices();
  const server = startHostServer({
    services,
    db,
    bind: '127.0.0.1',
    port: 39401,
    secret,
    metricsSecret,
    corsOrigins: [],
    // Test simulates "behind nginx" mode so X-Forwarded-For is honored;
    // without this, XFF is ignored and the "non-loopback" simulation below
    // cannot trigger the auth path.
    trustProxy: true,
    // Disable audit writer and use a huge rate-limit budget so existing
    // assertions (which make many requests in a tight loop) aren't affected.
    auditEnabled: false,
    rateLimit: {
      rpc:   { windowMs: 60_000, max: 10_000 },
      login: { windowMs: 60_000, max: 10_000 },
    },
  });
  const url = `http://127.0.0.1:39401`;

  try {
    // ---- baseline scrape works over loopback, no bearer ------------------
    let r = await get(url, '/metrics');
    assert.strictEqual(r.status, 200, 'loopback /metrics should be 200');
    assert.match(r.headers['content-type'] || '', /text\/plain/);
    assert.match(r.body, /pos_http_requests_total/);
    assert.match(r.body, /pos_rpc_calls_total/);
    assert.match(r.body, /pos_sessions_active/);
    console.log('  ✓ loopback scrape works');

    // ---- RPC call increments the counter ---------------------------------
    const before = parseMetric(r.body, 'pos_rpc_calls_total', { channel: 'pos:appConfig:get', outcome: 'ok' }) ?? 0;
    await rpcCall(url, secret, 'pos:appConfig:get', []);
    r = await get(url, '/metrics');
    const after = parseMetric(r.body, 'pos_rpc_calls_total', { channel: 'pos:appConfig:get', outcome: 'ok' }) ?? 0;
    assert.ok(after >= before + 1, `rpc counter should grow (before=${before}, after=${after})`);
    console.log('  ✓ rpc counter increments');

    // ---- histogram has samples -------------------------------------------
    assert.match(r.body, /pos_rpc_call_duration_seconds_count\{[^}]*channel="pos:appConfig:get"/);
    console.log('  ✓ rpc latency histogram observed');

    // ---- failed login increments invalid_credentials ---------------------
    // Use shared secret so AUTH layer passes; the service layer returns
    // `success:false` which `pos:auth:login` surfaces as VALIDATION_ERROR.
    const loginResp = await rpcCall(url, secret, 'pos:auth:login', ['no-such-user', 'wrong']);
    assert.strictEqual(loginResp.status, 200);
    // Service returns {success:false} as DATA (transport-level ok is still true).
    assert.strictEqual(loginResp.body.ok, true);
    assert.strictEqual(loginResp.body.data.success, false);
    r = await get(url, '/metrics');
    const invalid = parseMetric(r.body, 'pos_auth_logins_total', { outcome: 'invalid_credentials' }) ?? 0;
    assert.ok(invalid >= 1, `invalid_credentials counter should be >=1, got ${invalid}`);
    console.log('  ✓ invalid login counter increments');

    // ---- successful login counter ----------------------------------------
    await rpcCall(url, secret, 'pos:auth:login', ['admin', 'anything']);
    r = await get(url, '/metrics');
    const success = parseMetric(r.body, 'pos_auth_logins_total', { outcome: 'success' }) ?? 0;
    assert.ok(success >= 1, `success login counter should be >=1, got ${success}`);
    console.log('  ✓ successful login counter increments');

    // ---- non-loopback path: we simulate by sending X-Forwarded-For that
    //      NOT matches loopback. clientIp() trusts X-Forwarded-For first.
    r = await get(url, '/metrics', { 'x-forwarded-for': '8.8.8.8' });
    assert.strictEqual(r.status, 401, 'non-loopback without bearer must be 401');
    console.log('  ✓ non-loopback scrape requires auth');

    // ---- with correct bearer: 200 ----------------------------------------
    r = await get(url, '/metrics', {
      'x-forwarded-for': '8.8.8.8',
      authorization: `Bearer ${metricsSecret}`,
    });
    assert.strictEqual(r.status, 200, 'non-loopback with bearer must be 200');
    console.log('  ✓ non-loopback scrape accepted with bearer');

    // ---- wrong bearer: 401 -----------------------------------------------
    r = await get(url, '/metrics', {
      'x-forwarded-for': '8.8.8.8',
      authorization: 'Bearer NOPE',
    });
    assert.strictEqual(r.status, 401);
    console.log('  ✓ non-loopback scrape rejected with wrong bearer');

    // ---- backup gauges ---------------------------------------------------
    r = await get(url, '/metrics');
    const count = parseMetric(r.body, 'pos_backup_local_count', {}) ?? -1;
    const age = parseMetric(r.body, 'pos_backup_last_age_seconds', {}) ?? -1;
    const bytes = parseMetric(r.body, 'pos_backup_local_bytes', {}) ?? -1;
    const offsite = parseMetric(r.body, 'pos_backup_offsite_last_age_seconds', {}) ?? -99;
    assert.strictEqual(count, 2, `local_count expected 2, got ${count}`);
    assert.ok(age >= 0, `last_age should be >=0, got ${age}`);
    assert.strictEqual(bytes, 1024 + 2048, `local_bytes wrong: ${bytes}`);
    assert.strictEqual(offsite, -1, `offsite sentinel absent -> -1, got ${offsite}`);
    console.log('  ✓ backup gauges: count=2, bytes=3072, offsite=missing');

    // Touch the sentinel and recheck offsite gauge.
    fs.writeFileSync(path.join(backupDir, '.last-offsite-sync'), new Date().toISOString());
    r = await get(url, '/metrics');
    const offsite2 = parseMetric(r.body, 'pos_backup_offsite_last_age_seconds', {}) ?? -99;
    assert.ok(offsite2 >= 0 && offsite2 < 10, `offsite age should be fresh (<10s), got ${offsite2}`);
    console.log('  ✓ offsite sentinel picked up after touch');

    console.log('\nOK — metrics smoke passed');
  } finally {
    await server.close();
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
})().catch((err) => {
  console.error('FAIL:', err);
  process.exit(1);
});

/**
 * Parse a single-value counter/gauge line matching the given labels.
 * Returns undefined if the sample is not present.
 */
function parseMetric(text, name, wantLabels) {
  // Prometheus text format:
  //   with labels:    name{k1="v1",k2="v2"} 123
  //   no labels:      name 123
  const re = new RegExp(`^${escape(name)}(?:\\{([^}]*)\\})?\\s+([0-9eE+\\-.]+)`, 'gm');
  let m;
  while ((m = re.exec(text))) {
    const labels = m[1]
      ? Object.fromEntries(
          m[1].split(',').map((kv) => {
            const eq = kv.indexOf('=');
            return [kv.slice(0, eq).trim(), kv.slice(eq + 1).trim().replace(/^"|"$/g, '')];
          }),
        )
      : {};
    const ok = Object.entries(wantLabels).every(([k, v]) => labels[k] === v);
    if (ok) return Number(m[2]);
  }
  return undefined;
}
function escape(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

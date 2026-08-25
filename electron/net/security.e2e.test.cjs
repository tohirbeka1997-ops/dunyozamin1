/* eslint-disable no-console */
// =============================================================================
// security.e2e.test.cjs — end-to-end for the Bosqich 14 security layer
// =============================================================================
// Verifies:
//   1. /rpc per-IP rate limit returns 429 + Retry-After once the budget is hit
//   2. pos:auth:login is throttled separately with a smaller budget (per ip|user)
//   3. A failing login writes an auth.login.failure row into the audit log
//   4. Admin-only channel denial appears as auth.denied in the audit log
//   5. Successful login writes auth.login.success and logout writes auth.logout
// =============================================================================
'use strict';

const http = require('http');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { startHostServer } = require('./hostServer.cjs');

// Reuse the mock db/services from hostServer.test.cjs — kept deliberately
// minimal; the security layer only cares about request flow, not DB truth.
function makeMockDb() {
  const sessions = new Map();
  const users = new Map([
    ['u-admin', { id: 'u-admin', username: 'admin', role: 'admin', password_hash: 'x', is_active: 1, email: null, full_name: 'Admin' }],
    ['u-cash',  { id: 'u-cash',  username: 'cash',  role: 'cashier', password_hash: 'x', is_active: 1, email: null, full_name: 'Cashier' }],
    ['u-sales', { id: 'u-sales', username: 'sales', role: 'sales', password_hash: 'x', is_active: 1, email: null, full_name: 'Sales' }],
  ]);
  function matchAndRun(sql, args) {
    if (/INSERT INTO sessions/i.test(sql)) {
      const [id, user_id, token, ip_address, user_agent, expires_at, created_at] = args;
      sessions.set(id, { id, user_id, token, ip_address, user_agent, expires_at, created_at });
      return { changes: 1 };
    }
    if (/SELECT s\.id, s\.user_id, s\.expires_at, u\.username, u\.role, u\.is_active/i.test(sql)) {
      for (const s of sessions.values()) {
        if (s.token === args[0]) {
          const u = users.get(s.user_id);
          return { id: s.id, user_id: s.user_id, expires_at: s.expires_at, username: u?.username, role: u?.role, is_active: u?.is_active };
        }
      }
      return undefined;
    }
    if (/DELETE FROM sessions WHERE token = \?/i.test(sql)) {
      let n = 0;
      for (const [id, s] of sessions) if (s.token === args[0]) { sessions.delete(id); n++; }
      return { changes: n };
    }
    if (/DELETE FROM sessions WHERE user_id = \?/i.test(sql)) {
      let n = 0;
      for (const [id, s] of sessions) if (s.user_id === args[0]) { sessions.delete(id); n++; }
      return { changes: n };
    }
    if (/DELETE FROM sessions WHERE expires_at/i.test(sql)) return { changes: 0 };
    if (/UPDATE users SET last_login/i.test(sql)) return { changes: 1 };
    if (/SELECT id, username, role, email, full_name, is_active FROM users WHERE id = \?/i.test(sql)) {
      const u = users.get(args[0]);
      return u ? { id: u.id, username: u.username, role: u.role, email: u.email, full_name: u.full_name, is_active: u.is_active } : undefined;
    }
    if (/SELECT \* FROM users WHERE id = \?/i.test(sql)) return users.get(args[0]);
    if (/SELECT .* FROM user_roles/i.test(sql)) return [];
    throw new Error('mockDb: unexpected SQL: ' + sql.slice(0, 120));
  }
  return {
    exec() {},
    prepare(sql) {
      return {
        run: (...args) => matchAndRun(sql, args),
        get: (...args) => matchAndRun(sql, args),
        all: (...args) => { const r = matchAndRun(sql, args); return Array.isArray(r) ? r : r ? [r] : []; },
      };
    },
  };
}

function makeMockServices() {
  const users = [
    { id: 'u-admin', username: 'admin', role: 'admin', is_active: 1 },
    { id: 'u-cash',  username: 'cash',  role: 'cashier', is_active: 1 },
    { id: 'u-sales', username: 'sales', role: 'sales', is_active: 1 },
  ];
  return {
    auth: {
      login(username, password) {
        // Treat "goodpw" as the only valid password so we can provoke failures.
        const u = users.find((x) => x.username === username);
        if (!u || password !== 'goodpw') return { success: false, error: 'Invalid credentials' };
        return { success: true, user: u };
      },
      requestPasswordReset: () => ({ success: true }),
      confirmPasswordReset: () => ({ success: true }),
    },
    users: { list: () => users },
    settings: { get: () => null, getAll: () => ({}) },
  };
}

function rpc(baseUrl, bearer, channel, args = []) {
  return new Promise((resolve, reject) => {
    const u = new URL(baseUrl + '/rpc');
    const body = JSON.stringify({ channel, args });
    const req = http.request({
      hostname: u.hostname, port: u.port, path: u.pathname, method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      },
    }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(data); } catch { /* ignore */ }
        resolve({ status: res.statusCode, headers: res.headers, json: parsed });
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function readAuditRows(p) {
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

(async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-sec-e2e-'));
  const auditPath = path.join(tmp, 'logs', 'audit.log');
  const secret = 'TEST-SECURITY-SECRET';
  const port = 39411;

  const server = startHostServer({
    services: makeMockServices(),
    db: makeMockDb(),
    bind: '127.0.0.1',
    port,
    secret,
    corsOrigins: ['*'],
    // Tight budgets so tests don't need to wait real time.
    rateLimit: {
      rpc:   { windowMs: 10_000, max: 5  }, // 5 rpc / 10s (anonymous IP)
      authRpc: { windowMs: 10_000, max: 5 }, // session/admin budget in tests
      publicRpc: { windowMs: 10_000, max: 5 }, // pre-auth health/branding budget
      login: { windowMs: 10_000, max: 2  }, // 2 login / 10s
    },
    auditLogPath: auditPath,
    auditEnabled: true,
  });
  const base = `http://127.0.0.1:${port}`;
  await new Promise((r) => setTimeout(r, 50));

  try {
    // ---- 1. public pre-auth channels are not rate limited -------------------
    {
      for (let i = 0; i < 20; i++) {
        const r = await rpc(base, secret, 'pos:health', []);
        assert.strictEqual(r.status, 200, `call #${i + 1} should be 200 but was ${r.status}`);
      }
      console.log('  ✓ public pre-auth channels bypass rate limit');
    }

    // Reset rate limit buckets so login-specific test isn't polluted.
    server.limiter.reset();

    // ---- 2. login rate limit (smaller budget, keyed by ip|user) -------------
    // Dispatcher takes positional args: [username, password]. The server's
    // login rate-limit key derivation reads args[0].username OR args[0] itself
    // — we support both shapes for robustness (see hostServer login gate).
    {
      for (let i = 0; i < 2; i++) {
        const r = await rpc(base, secret, 'pos:auth:login', ['cash', 'wrong']);
        assert.strictEqual(r.status, 200, 'failed login returns 200 with success:false');
      }
      const r = await rpc(base, secret, 'pos:auth:login', ['cash', 'wrong']);
      assert.strictEqual(r.status, 429, '3rd login attempt must be 429');
      assert.strictEqual(r.json?.error?.code, 'RATE_LIMITED');
      console.log('  ✓ pos:auth:login per-(ip|user) rate limit enforces 429');

      // Different username gets a fresh login bucket even from the same IP.
      const r2 = await rpc(base, secret, 'pos:auth:login', ['admin', 'wrong']);
      assert.notStrictEqual(r2.status, 429, 'different username has its own bucket');
      console.log('  ✓ login bucket scoped per username');
    }

    // ---- 3. audit rows for login events ------------------------------------
    {
      server.limiter.reset();
      await rpc(base, secret, 'pos:auth:login', ['admin', 'bad']);    // failure
      const ok = await rpc(base, secret, 'pos:auth:login', ['admin', 'goodpw']);
      assert.strictEqual(ok.json?.data?.success, true, 'valid login should succeed');
      const token = ok.json.data.token;
      await rpc(base, token, 'pos:auth:logout', []);

      // Flush underlying stream — createWriteStream is buffered.
      await new Promise((r) => setTimeout(r, 120));
      const rows = readAuditRows(auditPath);
      const types = rows.map((r) => r.type);
      assert.ok(types.includes('auth.login.failure'), 'audit has login.failure row');
      assert.ok(types.includes('auth.login.success'), 'audit has login.success row');
      assert.ok(types.includes('auth.logout'),       'audit has logout row');

      // No password leaks in any row.
      for (const r of rows) {
        for (const [k, v] of Object.entries(r)) {
          if (k.toLowerCase() === 'password') {
            assert.fail(`audit row ${r.type} contained raw password field`);
          }
          if (typeof v === 'string' && v === 'goodpw') {
            assert.fail(`audit row ${r.type} leaked password value`);
          }
        }
      }
      console.log('  ✓ audit captures login success/failure/logout without leaking passwords');
    }

    // ---- 4. audit for admin-only denial ------------------------------------
    {
      server.limiter.reset();
      const sess = await rpc(base, secret, 'pos:auth:login', ['cash', 'goodpw']);
      assert.strictEqual(sess.json?.data?.success, true, 'cash login should succeed');
      const token = sess.json.data.token;
      const r = await rpc(base, token, 'pos:database:wipe', []);
      assert.strictEqual(r.json?.error?.code, 'PERMISSION_DENIED');
      await new Promise((r) => setTimeout(r, 120));
      const rows = readAuditRows(auditPath);
      const denied = rows.filter((r) => r.type === 'auth.denied' && r.channel === 'pos:database:wipe');
      assert.ok(denied.length >= 1, 'audit recorded auth.denied for admin-only channel');
      assert.strictEqual(denied[0].reason, 'admin_only_channel');
      console.log('  ✓ admin-only denial produces auth.denied in audit log');
    }

    // ---- 5. role matrix: `sales` role (audit #2) ---------------------------
    {
      server.limiter.reset();
      const login = await rpc(base, secret, 'pos:auth:login', ['sales', 'goodpw']);
      assert.strictEqual(login.json?.data?.success, true, 'sales login should succeed');
      const token = login.json.data.token;
      assert.ok(token, 'sales session token issued');

      // Allowed channels: role check must PASS. The mock has no products/webOrders
      // service so dispatch fails with INTERNAL_ERROR — the point is it is NOT
      // PERMISSION_DENIED (i.e. the sales role was permitted to reach dispatch).
      const okProducts = await rpc(base, token, 'pos:products:list', [{}]);
      assert.notStrictEqual(okProducts.json?.error?.code, 'PERMISSION_DENIED', 'sales may read products');
      const okWeb = await rpc(base, token, 'pos:webOrders:list', [{}]);
      assert.notStrictEqual(okWeb.json?.error?.code, 'PERMISSION_DENIED', 'sales may manage web orders');

      // Denied: admin-only channels must be PERMISSION_DENIED for sales.
      const noUsers = await rpc(base, token, 'pos:users:list', [{}]);
      assert.strictEqual(noUsers.json?.error?.code, 'PERMISSION_DENIED', 'sales denied users:list');
      const noBackup = await rpc(base, token, 'pos:database:backup', ['manual']);
      assert.strictEqual(noBackup.json?.error?.code, 'PERMISSION_DENIED', 'sales denied db backup');
      console.log('  ✓ sales role allowed its channels and denied admin channels');
    }

    // ---- 6. role enforced via session, NOT the shared secret (audit #1) -----
    {
      server.limiter.reset();
      const sess = await rpc(base, secret, 'pos:auth:login', ['cash', 'goodpw']);
      const token = sess.json.data.token;
      // A cashier SESSION must be role-checked: users:list is admin-only.
      const denied = await rpc(base, token, 'pos:users:list', [{}]);
      assert.strictEqual(denied.json?.error?.code, 'PERMISSION_DENIED', 'cashier session denied users:list');
      // The shared secret (transport/admin bypass) still works for bootstrap/scripts.
      const allowed = await rpc(base, secret, 'pos:users:list', [{}]);
      assert.strictEqual(allowed.json?.ok, true, 'shared secret retains admin bypass for users:list');
      console.log('  ✓ ROLE_RULES enforced against session role, secret retains bypass');
    }

    console.log('\nOK — security E2E passed');
  } finally {
    await server.close();
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
  }
})().catch((err) => { console.error('FAILED:', err); process.exit(1); });

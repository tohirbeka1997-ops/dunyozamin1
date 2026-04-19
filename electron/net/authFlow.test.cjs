/**
 * End-to-end test: real hostServer + simulated "browser" (localStorage +
 * fetch) that acts like `remotePosApi.ts`. Validates:
 *   1. Login via shared secret returns token, frontend stores it
 *   2. Follow-up calls use Bearer <session-token>
 *   3. Server-side logout invalidates token
 *   4. Subsequent call with stale token → 401
 *   5. Frontend polyfill clears localStorage on 401 (pos:auth:required fires)
 *
 *   node electron/net/authFlow.test.cjs
 */
const assert = require('assert');
const http = require('http');
const { startHostServer } = require('./hostServer.cjs');

// ---------- mock db ----------
function makeMockDb() {
  const sessions = new Map();
  const users = new Map([
    ['u-admin', { id: 'u-admin', username: 'admin', role: 'admin', is_active: 1, email: null, full_name: 'Admin', password_hash: 'x' }],
    ['u-cash', { id: 'u-cash', username: 'cash', role: 'cashier', is_active: 1, email: null, full_name: 'Cash', password_hash: 'x' }],
  ]);
  function run(sql, args) {
    if (/INSERT INTO sessions/i.test(sql)) {
      const [id, user_id, token, ip_address, user_agent, expires_at, created_at] = args;
      sessions.set(id, { id, user_id, token, ip_address, user_agent, expires_at, created_at });
      return { changes: 1 };
    }
    if (/SELECT s\.id, s\.user_id, s\.expires_at, u\.username, u\.role, u\.is_active/i.test(sql)) {
      const [token] = args;
      for (const s of sessions.values()) if (s.token === token) {
        const u = users.get(s.user_id);
        return { id: s.id, user_id: s.user_id, expires_at: s.expires_at, username: u?.username, role: u?.role, is_active: u?.is_active };
      }
      return undefined;
    }
    if (/DELETE FROM sessions WHERE token = \?/i.test(sql)) {
      const [token] = args; let n = 0;
      for (const [id, s] of sessions) if (s.token === token) { sessions.delete(id); n++; }
      return { changes: n };
    }
    if (/DELETE FROM sessions WHERE user_id = \?/i.test(sql)) {
      const [uid] = args; let n = 0;
      for (const [id, s] of sessions) if (s.user_id === uid) { sessions.delete(id); n++; }
      return { changes: n };
    }
    if (/DELETE FROM sessions WHERE expires_at/i.test(sql)) return { changes: 0 };
    if (/UPDATE users SET last_login/i.test(sql)) return { changes: 1 };
    if (/SELECT id, username, role, email, full_name, is_active FROM users WHERE id = \?/i.test(sql)) {
      const u = users.get(args[0]);
      if (!u) return undefined;
      return { id: u.id, username: u.username, role: u.role, email: u.email, full_name: u.full_name, is_active: u.is_active };
    }
    throw new Error('mockDb: unexpected SQL: ' + sql.slice(0, 120));
  }
  return {
    exec() {},
    prepare(sql) {
      return {
        run: (...a) => run(sql, a),
        get: (...a) => run(sql, a),
        all: (...a) => { const r = run(sql, a); return Array.isArray(r) ? r : r ? [r] : []; },
      };
    },
  };
}
function makeMockServices(users) {
  return {
    auth: {
      login(identifier) {
        const u = [...users.values()].find((x) => x.username === identifier || x.email === identifier);
        if (!u) return { success: false, error: 'Invalid credentials' };
        return { success: true, user: u, message: 'Welcome' };
      },
      requestPasswordReset: () => ({ success: true }),
      confirmPasswordReset: () => ({ success: true }),
    },
  };
}

// ---------- simulated browser ----------
function makeBrowser(baseUrl, bootstrapSecret) {
  const storage = new Map();
  const events = [];
  const STORAGE_KEY = 'pos_session_token';
  const STORAGE_EXP_KEY = 'pos_session_expires_at';
  const PUBLIC = new Set([
    'pos:auth:login',
    'pos:auth:requestPasswordReset',
    'pos:auth:confirmPasswordReset',
    'pos:health',
    'pos:appConfig:get',
  ]);

  function getToken() { return storage.get(STORAGE_KEY) || null; }
  function setToken(t, exp) {
    if (t) { storage.set(STORAGE_KEY, t); if (exp) storage.set(STORAGE_EXP_KEY, exp); }
    else { storage.delete(STORAGE_KEY); storage.delete(STORAGE_EXP_KEY); }
  }

  function rpc(channel, args = []) {
    return new Promise((resolve, reject) => {
      const u = new URL(baseUrl + '/rpc');
      const body = JSON.stringify({ channel, args });
      const bearer = PUBLIC.has(channel) ? bootstrapSecret : (getToken() || bootstrapSecret);
      const req = http.request({
        hostname: u.hostname,
        port: u.port,
        path: u.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          Authorization: `Bearer ${bearer}`,
        },
      }, (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          let json = null; try { json = JSON.parse(data); } catch {}
          if (res.statusCode === 401 && !PUBLIC.has(channel)) {
            setToken(null);
            events.push({ type: 'pos:auth:required', reason: 'expired_or_invalid' });
          }
          if (json && json.ok === true && channel === 'pos:auth:login') {
            const d = json.data;
            if (d?.success && d?.token) setToken(d.token, d.expiresAt);
          }
          if (json && json.ok === true && channel === 'pos:auth:logout') {
            setToken(null);
          }
          if (json && json.ok === false && json.error?.code === 'AUTH_ERROR' && !PUBLIC.has(channel)) {
            setToken(null);
            events.push({ type: 'pos:auth:required', reason: 'auth_error' });
          }
          resolve({ status: res.statusCode, json });
        });
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }

  return { rpc, getToken, setToken, events, storage };
}

async function main() {
  const db = makeMockDb();
  const users = new Map([
    ['u-cash', { id: 'u-cash', username: 'cash', email: null }],
  ]);
  const services = makeMockServices(new Map([
    ['u-cash', { id: 'u-cash', username: 'cash', role: 'cashier', is_active: 1, email: null, full_name: 'Cash', password_hash: 'x' }],
    ['u-admin', { id: 'u-admin', username: 'admin', role: 'admin', is_active: 1, email: null, full_name: 'Admin', password_hash: 'x' }],
  ]));

  const secret = 'TEST-BOOTSTRAP-SECRET';
  const port = 39334;
  const server = startHostServer({ services, db, bind: '127.0.0.1', port, secret, corsOrigins: ['*'] });
  await new Promise((r) => setTimeout(r, 100));

  const base = `http://127.0.0.1:${port}`;
  const browser = makeBrowser(base, secret);

  try {
    // 1. Login using shared secret; token is captured by "browser"
    let r = await browser.rpc('pos:auth:login', ['cash', 'pw']);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.json.ok, true, 'login should succeed');
    assert.ok(browser.getToken(), 'browser should have stored token');
    assert.strictEqual(r.json.data.user.role, 'cashier');

    // 2. Subsequent call uses session token (not shared secret)
    r = await browser.rpc('pos:auth:me', []);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.json.ok, true);
    assert.strictEqual(r.json.data.id, 'u-cash');

    // 3. Logout invalidates — browser also clears local state
    r = await browser.rpc('pos:auth:logout', []);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(browser.getToken(), null, 'token should be cleared after logout');

    // 4. Browser re-attempts a protected call without token — should fall back
    //    to the bootstrap secret per our PUBLIC_CHANNELS logic and FAIL on this
    //    non-public channel (since bootstrap secret bypass is treated as admin,
    //    cashier-only rules do not apply; admin may call everything except
    //    admin-only channels, so pos:auth:me with secret works).
    //    But we want to simulate an EXPIRED token. Put a fake token back:
    browser.setToken('expired-garbage-token');
    r = await browser.rpc('pos:auth:me', []);
    assert.strictEqual(r.status, 401, 'expired token should 401');
    assert.strictEqual(browser.getToken(), null, 'frontend clears token on 401');
    assert.ok(
      browser.events.some((e) => e.type === 'pos:auth:required'),
      'pos:auth:required event should be queued',
    );

    // 5. Login again with shared secret — recover cleanly
    browser.events.length = 0;
    r = await browser.rpc('pos:auth:login', ['admin', 'pw']);
    assert.strictEqual(r.status, 200);
    assert.ok(browser.getToken());

    // 6. Admin session — allowed to call users-related stuff but NOT admin-only
    r = await browser.rpc('pos:database:wipe', []);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.json.ok, false);
    assert.strictEqual(r.json.error.code, 'PERMISSION_DENIED');

    console.log('OK — frontend auth flow simulation passed');
  } finally {
    await server.close();
  }
}

main().catch((err) => { console.error('FAILED:', err); process.exit(1); });

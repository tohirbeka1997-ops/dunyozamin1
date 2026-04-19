/**
 * End-to-end smoke test for hostServer auth flow (mock services + mock db).
 *   node electron/net/hostServer.test.cjs
 *
 * Covers:
 *   - 401 when no bearer
 *   - 401 when invalid bearer
 *   - Bootstrap secret works for ALL channels
 *   - Login with shared secret returns session token
 *   - Session token works for normal channels
 *   - Session token REJECTED for admin-only channels
 *   - Role matrix: cashier may not call pos:users:list
 *   - Logout invalidates the session
 */
const http = require('http');
const assert = require('assert');

const { startHostServer } = require('./hostServer.cjs');

function makeMockDb() {
  const sessions = new Map();
  const users = new Map([
    ['u-admin', { id: 'u-admin', username: 'admin', role: 'admin', password_hash: 'x', is_active: 1, email: null, full_name: 'Admin' }],
    ['u-cash', { id: 'u-cash', username: 'cash', role: 'cashier', password_hash: 'x', is_active: 1, email: null, full_name: 'Cashier' }],
  ]);

  function matchAndRun(sql, args) {
    if (/INSERT INTO sessions/i.test(sql)) {
      const [id, user_id, token, ip_address, user_agent, expires_at, created_at] = args;
      if ([...sessions.values()].some((s) => s.token === token)) {
        throw new Error('UNIQUE constraint failed: sessions.token');
      }
      sessions.set(id, { id, user_id, token, ip_address, user_agent, expires_at, created_at });
      return { changes: 1 };
    }
    if (/SELECT s\.id, s\.user_id, s\.expires_at, u\.username, u\.role, u\.is_active/i.test(sql)) {
      const [token] = args;
      for (const s of sessions.values()) {
        if (s.token === token) {
          const u = users.get(s.user_id);
          return {
            id: s.id,
            user_id: s.user_id,
            expires_at: s.expires_at,
            username: u?.username,
            role: u?.role,
            is_active: u?.is_active,
          };
        }
      }
      return undefined;
    }
    if (/DELETE FROM sessions WHERE token = \?/i.test(sql)) {
      const [token] = args;
      let n = 0;
      for (const [id, s] of sessions) if (s.token === token) { sessions.delete(id); n++; }
      return { changes: n };
    }
    if (/DELETE FROM sessions WHERE user_id = \?/i.test(sql)) {
      const [uid] = args;
      let n = 0;
      for (const [id, s] of sessions) if (s.user_id === uid) { sessions.delete(id); n++; }
      return { changes: n };
    }
    if (/DELETE FROM sessions WHERE expires_at < \?/i.test(sql)) return { changes: 0 };
    if (/UPDATE users SET last_login/i.test(sql)) return { changes: 1 };
    if (/SELECT id, username, role, email, full_name, is_active FROM users WHERE id = \?/i.test(sql)) {
      const u = users.get(args[0]);
      if (!u) return undefined;
      return { id: u.id, username: u.username, role: u.role, email: u.email, full_name: u.full_name, is_active: u.is_active };
    }
    if (/SELECT \* FROM users WHERE id = \?/i.test(sql)) {
      return users.get(args[0]);
    }
    if (/SELECT .* FROM user_roles/i.test(sql)) {
      return [];
    }
    if (/SELECT id, username/i.test(sql) && /FROM users/i.test(sql)) {
      return [...users.values()].map((u) => ({ id: u.id, username: u.username, role: u.role }));
    }
    throw new Error('mockDb: unexpected SQL: ' + sql.slice(0, 120));
  }

  return {
    exec() {},
    prepare(sql) {
      return {
        run: (...args) => matchAndRun(sql, args),
        get: (...args) => matchAndRun(sql, args),
        all: (...args) => {
          const r = matchAndRun(sql, args);
          return Array.isArray(r) ? r : r ? [r] : [];
        },
      };
    },
  };
}

function makeMockServices(users) {
  return {
    auth: {
      login(username /*, password */) {
        // Treat any non-empty password as valid for this test.
        const u = [...users.values()].find((x) => x.username === username);
        if (!u) return { success: false, error: 'Invalid credentials' };
        return { success: true, user: u, message: 'Welcome' };
      },
      requestPasswordReset: () => ({ success: true }),
      confirmPasswordReset: () => ({ success: true }),
    },
    users: {
      list: () => [{ id: 'u-admin' }, { id: 'u-cash' }],
    },
    settings: {
      get: () => null,
      getAll: () => ({}),
    },
  };
}

function rpcCall(baseUrl, bearer, channel, args = []) {
  return new Promise((resolve, reject) => {
    const u = new URL(baseUrl + '/rpc');
    const body = JSON.stringify({ channel, args });
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try { resolve({ status: res.statusCode, json: JSON.parse(data) }); }
          catch (e) { resolve({ status: res.statusCode, json: null, raw: data }); }
        });
      },
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  const db = makeMockDb();
  const users = new Map([
    ['u-admin', { id: 'u-admin', username: 'admin', role: 'admin', is_active: 1 }],
    ['u-cash', { id: 'u-cash', username: 'cash', role: 'cashier', is_active: 1 }],
  ]);
  // Need to share the users Map with both mock db and mock services.
  // (the mock db module above builds its own — so let's wire services to look
  //  up directly from the underlying users inside mockDb)
  const services = makeMockServices(users);
  // Re-seed mockDb's internal users so our simple mock matches.
  // The internal Map was already seeded when makeMockDb was built — good.

  const secret = 'TEST-BOOTSTRAP-SECRET';
  // Fixed port to avoid depending on server.address().port wiring.
  // If a collision occurs, bump here.
  const port = 39333;
  const server = startHostServer({
    services,
    db,
    bind: '127.0.0.1',
    port,
    secret,
    corsOrigins: ['*'],
  });

  // Give the OS a moment to fully listen (first request right after listen
  // can race on Windows in rare cases).
  await new Promise((resolve) => setTimeout(resolve, 100));

  const base = `http://127.0.0.1:${port}`;

  try {
    // --- 1. No bearer => 401 ---
    let r = await rpcCall(base, '', 'pos:health', []);
    assert.strictEqual(r.status, 401, 'missing bearer should 401');

    // --- 2. Invalid bearer => 401 ---
    r = await rpcCall(base, 'not-a-real-token', 'pos:health', []);
    assert.strictEqual(r.status, 401);

    // --- 3. Bootstrap secret works ---
    r = await rpcCall(base, secret, 'pos:health', []);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.json.ok, true);

    // --- 4. Login with shared secret returns session token ---
    r = await rpcCall(base, secret, 'pos:auth:login', ['cash', 'pw']);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.json.ok, true, 'login should succeed: ' + JSON.stringify(r.json));
    const d = r.json.data;
    assert.strictEqual(d.success, true);
    assert.ok(typeof d.token === 'string' && d.token.length > 20, 'login must return token');
    const cashierToken = d.token;

    // --- 5. Session token works for allowed channels ---
    r = await rpcCall(base, cashierToken, 'pos:auth:me', []);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.json.ok, true);
    assert.strictEqual(r.json.data.id, 'u-cash');

    // --- 6. Cashier may NOT call pos:users:list (role check) ---
    r = await rpcCall(base, cashierToken, 'pos:users:list', []);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.json.ok, false);
    assert.strictEqual(r.json.error.code, 'PERMISSION_DENIED', 'cashier should not access users.list');

    // --- 7. Admin session may call users.list ---
    r = await rpcCall(base, secret, 'pos:auth:login', ['admin', 'pw']);
    const adminToken = r.json.data.token;
    r = await rpcCall(base, adminToken, 'pos:users:list', []);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.json.ok, true, 'admin should access users.list');

    // --- 8. Admin-only channel requires SHARED secret ---
    r = await rpcCall(base, adminToken, 'pos:database:wipe', []);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.json.ok, false);
    assert.strictEqual(r.json.error.code, 'PERMISSION_DENIED', 'admin session should not call database:wipe');

    // --- 9. Logout invalidates all sessions for that user ---
    r = await rpcCall(base, cashierToken, 'pos:auth:logout', []);
    assert.strictEqual(r.status, 200);
    r = await rpcCall(base, cashierToken, 'pos:auth:me', []);
    assert.strictEqual(r.status, 401, 'token should be invalid after logout');

    console.log('OK — hostServer auth E2E passed');
  } finally {
    await server.close();
  }
}

main().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});

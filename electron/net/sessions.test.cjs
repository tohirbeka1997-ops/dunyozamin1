/**
 * Offline smoke test for session store with a MOCK DB (no native modules).
 *   node electron/net/sessions.test.cjs
 */
const path = require('path');
const assert = require('assert');

const { createSessionStore } = require(path.join(__dirname, 'sessions.cjs'));

/** Minimal better-sqlite3 shim good enough for sessions.cjs. */
function makeMockDb() {
  /** @type {Map<string, { id: string, user_id: string, token: string, ip_address: string|null, user_agent: string|null, expires_at: string, created_at: string }>} */
  const sessions = new Map();
  const users = new Map(); // id -> { username, role, is_active }

  const stmts = {
    // INSERT INTO sessions
    [/INSERT INTO sessions/i.source]: (args) => {
      const [id, user_id, token, ip_address, user_agent, expires_at, created_at] = args;
      if ([...sessions.values()].some((s) => s.token === token)) {
        const err = new Error('UNIQUE constraint failed: sessions.token');
        throw err;
      }
      sessions.set(id, { id, user_id, token, ip_address, user_agent, expires_at, created_at });
      return { changes: 1 };
    },
    // sessions JOIN users ... WHERE s.token (role — user_roles subquery; mockda u.role)
    [/JOIN users u ON u\.id = s\.user_id\s+WHERE s\.token = \?/i.source]: (args) => {
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
    },
    [/DELETE FROM sessions WHERE token = \?/i.source]: (args) => {
      const [token] = args;
      let n = 0;
      for (const [id, s] of sessions) {
        if (s.token === token) { sessions.delete(id); n++; }
      }
      return { changes: n };
    },
    [/DELETE FROM sessions WHERE user_id = \?/i.source]: (args) => {
      const [uid] = args;
      let n = 0;
      for (const [id, s] of sessions) {
        if (s.user_id === uid) { sessions.delete(id); n++; }
      }
      return { changes: n };
    },
    [/DELETE FROM sessions WHERE expires_at < \?/i.source]: () => ({ changes: 0 }),
  };

  return {
    _users: users,
    _sessions: sessions,
    exec() { /* no-op */ },
    prepare(sql) {
      const key = Object.keys(stmts).find((k) => new RegExp(k, 'i').test(sql));
      if (!key) throw new Error('Unexpected SQL in mock: ' + sql);
      const fn = stmts[key];
      return {
        run: (...args) => fn(args),
        get: (...args) => fn(args),
      };
    },
  };
}

function main() {
  const db = makeMockDb();
  db._users.set('u1', { username: 'admin', role: 'admin', is_active: 1 });
  db._users.set('u2', { username: 'cash', role: 'cashier', is_active: 1 });
  db._users.set('u3', { username: 'disabled', role: 'cashier', is_active: 0 });

  const store = createSessionStore({ db });

  // 1. Create and verify a session
  const s = store.create({ user: { id: 'u1', username: 'admin', role: 'admin' } });
  assert.ok(s.token && s.token.length > 16, 'token should be generated');
  const ctx = store.verify(s.token);
  assert.ok(ctx, 'valid token should resolve');
  assert.strictEqual(ctx.userId, 'u1');
  assert.strictEqual(ctx.role, 'admin');

  // 2. Hash is stored, not raw token (SHA-256 => 64 hex chars)
  const row = [...db._sessions.values()][0];
  assert.notStrictEqual(row.token, s.token, 'DB should store hashed token');
  assert.strictEqual(row.token.length, 64, 'SHA-256 hex is 64 chars');

  // 3. Invalid token fails
  assert.strictEqual(store.verify('not-a-token'), null);
  assert.strictEqual(store.verify(''), null);
  assert.strictEqual(store.verify(null), null);

  // 4. Disabled user sessions don't verify (force cache miss)
  const s2 = store.create({ user: { id: 'u3', username: 'disabled', role: 'cashier' } });
  store._internal.cache.clear();
  assert.strictEqual(store.verify(s2.token), null, 'disabled user sessions should not verify');

  // 5. destroy removes the session
  const s3 = store.create({ user: { id: 'u2', username: 'cash', role: 'cashier' } });
  assert.ok(store.verify(s3.token));
  assert.strictEqual(store.destroy(s3.token), true);
  assert.strictEqual(store.verify(s3.token), null);

  // 6. destroyAllForUser kills all sessions of a user
  const a = store.create({ user: { id: 'u1', username: 'admin', role: 'admin' } });
  const b = store.create({ user: { id: 'u1', username: 'admin', role: 'admin' } });
  const n = store.destroyAllForUser('u1');
  assert.ok(n >= 2, 'should delete all user sessions');
  assert.strictEqual(store.verify(a.token), null);
  assert.strictEqual(store.verify(b.token), null);

  // 7. Expired session gets cleaned up on verify
  const s4 = store.create({ user: { id: 'u2', username: 'cash', role: 'cashier' }, ttlMs: 60_000 });
  // Force expiry by rewriting the row
  for (const row of db._sessions.values()) row.expires_at = '2000-01-01 00:00:00';
  store._internal.cache.clear();
  assert.strictEqual(store.verify(s4.token), null, 'expired session should not verify');

  console.log('OK — all session store assertions passed');
}

main();

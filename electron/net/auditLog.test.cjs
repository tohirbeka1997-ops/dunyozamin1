/* eslint-disable no-console */
// =============================================================================
// auditLog.test.cjs — unit tests for the append-only audit logger
// =============================================================================
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { createAuditLogger, DANGEROUS_CHANNELS } = require('./auditLog.cjs');

function readLines(p) {
  return fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map(JSON.parse);
}

(async function run() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-audit-'));
  const logFile = path.join(tmp, 'logs', 'audit.log');

  try {
    // --- 1. Disabled logger is a silent no-op -------------------------------
    {
      const a = createAuditLogger({ enabled: false, filePath: logFile });
      a.loginSuccess({ username: 'x', userId: 1, ip: '1.1.1.1' });
      assert.strictEqual(fs.existsSync(logFile), false, 'disabled writer creates nothing');
      console.log('  ✓ disabled logger is silent');
    }

    // --- 2. record() with secret-looking keys is redacted -------------------
    {
      const a = createAuditLogger({ filePath: logFile });
      a.record('auth.login.success', {
        username: 'admin',
        password: 'super-s3cret',
        token: 'abc123',
        ip: '127.0.0.1',
      });
      await a.close();
      const rows = readLines(logFile);
      assert.strictEqual(rows.length, 1);
      assert.strictEqual(rows[0].password, '[REDACTED]');
      assert.strictEqual(rows[0].token, '[REDACTED]');
      assert.strictEqual(rows[0].username, 'admin');
      assert.strictEqual(rows[0].ip, '127.0.0.1');
      assert.ok(rows[0].t, 'timestamp present');
      console.log('  ✓ redacts secret-looking fields');
      fs.unlinkSync(logFile);
    }

    // --- 3. Convenience emitters produce the right event types --------------
    {
      const a = createAuditLogger({ filePath: logFile });
      a.loginSuccess({ username: 'u1', userId: 7, ip: '1.1.1.1', ua: 'Mozilla' });
      a.loginFailure({ username: 'u1', ip: '1.1.1.1', reason: 'bad_pw' });
      a.logout({ username: 'u1', userId: 7, ip: '1.1.1.1' });
      a.denied({ channel: 'pos:users:delete', ip: '1.1.1.1', auth: 'session', role: 'cashier', reason: 'not_admin' });
      a.rateLimitBlocked({ key: 'ip|user', kind: 'login', ip: '1.1.1.1', channel: 'pos:auth:login' });
      a.rpcDangerous({ channel: 'pos:database:wipeAllData', ip: '1.1.1.1', auth: 'admin' });
      a.rpcAdmin({ channel: 'pos:settings:update', ip: '1.1.1.1' });
      await a.close();
      const rows = readLines(logFile);
      const types = rows.map((r) => r.type);
      assert.deepStrictEqual(types, [
        'auth.login.success',
        'auth.login.failure',
        'auth.logout',
        'auth.denied',
        'rate_limit.blocked',
        'rpc.dangerous',
        'rpc.admin',
      ]);
      console.log('  ✓ convenience emitters cover all event types');
      fs.unlinkSync(logFile);
    }

    // --- 4. isDangerous() covers the expected list --------------------------
    {
      const a = createAuditLogger({ filePath: logFile });
      assert.strictEqual(a.isDangerous('pos:database:wipeAllData'), true);
      assert.strictEqual(a.isDangerous('pos:users:create'), true);
      assert.strictEqual(a.isDangerous('pos:products:list'), false);
      assert.ok(DANGEROUS_CHANNELS.size >= 8, 'at least 8 dangerous channels listed');
      await a.close();
      console.log('  ✓ isDangerous() matches DANGEROUS_CHANNELS');
    }

    // --- 5. Very long strings are clamped (no 10 MB log lines) ---------------
    {
      const a = createAuditLogger({ filePath: logFile });
      a.record('rpc.admin', { channel: 'x', note: 'A'.repeat(1000) });
      await a.close();
      const rows = readLines(logFile);
      assert.ok(rows[0].note.length <= 257, 'long strings truncated');
      console.log('  ✓ long strings clamped');
    }

    console.log('\nOK — auditLog unit tests passed');
  } finally {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch { /* ignore */ }
  }
})().catch((e) => {
  console.error('FAIL:', e);
  process.exit(1);
});

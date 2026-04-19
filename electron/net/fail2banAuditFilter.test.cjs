/**
 * Contract test — fail2ban pos-audit filters vs audit.log JSONL (Bosqich 19).
 *   node electron/net/fail2banAuditFilter.test.cjs
 *
 * Mirrors the failregex in deploy/security/fail2ban/filter.d/*.conf using
 * JavaScript RegExp — catches drift when someone edits one side without the
 * other. Does NOT run fail2ban itself (no apt / docker in the fast path).
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const FILTER_MAIN = path.join(ROOT, 'deploy/security/fail2ban/filter.d/pos-audit.conf');
const FILTER_PROBE = path.join(ROOT, 'deploy/security/fail2ban/filter.d/pos-audit-probe.conf');
const JAIL = path.join(ROOT, 'deploy/security/fail2ban/jail.d/pos-audit.local');
const INSTALL_SH = path.join(ROOT, 'deploy/scripts/install-fail2ban-pos.sh');

// Same semantics as fail2ban <HOST> for our tests (IPv4 + common IPv6).
const HOST = '((?:\\d{1,3}\\.){3}\\d{1,3}|[0-9a-fA-F:]{2,})';

const RE_LOGIN_FAIL = new RegExp(
  `^\\{"t":"[^"]+","type":"auth\\.login\\.failure".*?"ip":"${HOST}"`,
);
const RE_RL_LOGIN = new RegExp(
  `^\\{"t":"[^"]+","type":"rate_limit\\.blocked".*?"kind":"login".*?"ip":"${HOST}"|` +
  `^\\{"t":"[^"]+","type":"rate_limit\\.blocked".*?"ip":"${HOST}".*?"kind":"login"`,
);
const RE_DENIED = new RegExp(
  `^\\{"t":"[^"]+","type":"auth\\.denied".*?"ip":"${HOST}"`,
);

function extractIp(line, re) {
  const m = line.match(re);
  if (!m) return null;
  // Alternation has two capture groups — only one is ever filled.
  return m[1] || m[2] || null;
}

let passed = 0;
let failed = 0;

function run(name, fn) {
  try {
    fn();
    console.log(`  ok  - ${name}`);
    passed++;
  } catch (e) {
    console.error(`  FAIL - ${name}\n    ${e.message}`);
    failed++;
  }
}

(async () => {
  console.log('# fail2ban / audit.log filter contract');

  run('filter + jail + install script exist', () => {
    for (const p of [FILTER_MAIN, FILTER_PROBE, JAIL, INSTALL_SH]) {
      assert.ok(fs.existsSync(p), `missing: ${p}`);
    }
  });

  run('jail file must not define a global [DEFAULT] section', () => {
    const j = fs.readFileSync(JAIL, 'utf8');
    assert.ok(!/^\[DEFAULT\]\s*$/m.test(j),
      'pos-audit.local must not contain [DEFAULT] — it merges into ALL jails');
  });

  run('pos-audit: login.failure extracts IP', () => {
    const line = '{"t":"2030-01-01T00:00:00.000Z","type":"auth.login.failure","username":"x","ip":"198.51.100.77","reason":"bad"}';
    assert.strictEqual(extractIp(line, RE_LOGIN_FAIL), '198.51.100.77');
  });

  run('pos-audit: rate_limit blocked login extracts IP', () => {
    const line = '{"t":"2030-01-01T00:00:01.000Z","type":"rate_limit.blocked","key":"k","kind":"login","ip":"198.51.100.88","channel":"pos:auth:login"}';
    assert.strictEqual(extractIp(line, RE_RL_LOGIN), '198.51.100.88');
  });

  run('pos-audit: key order independence (ip before kind)', () => {
    const line = '{"t":"2030-01-01T00:00:01.000Z","type":"rate_limit.blocked","ip":"10.0.0.5","key":"k","kind":"login","channel":"x"}';
    assert.strictEqual(extractIp(line, RE_RL_LOGIN), '10.0.0.5');
  });

  run('pos-audit: does NOT match rate_limit kind=rpc', () => {
    const line = '{"t":"2030-01-01T00:00:01.000Z","type":"rate_limit.blocked","key":"1.1.1.1","kind":"rpc","ip":"1.1.1.1"}';
    assert.strictEqual(extractIp(line, RE_RL_LOGIN), null);
  });

  run('pos-audit: does NOT match auth.login.success', () => {
    const line = '{"t":"2030-01-01T00:00:00.000Z","type":"auth.login.success","username":"u","userId":1,"ip":"1.1.1.1"}';
    assert.strictEqual(extractIp(line, RE_LOGIN_FAIL), null);
  });

  run('pos-audit-probe: auth.denied extracts IP', () => {
    const line = '{"t":"2030-01-01T00:00:00.000Z","type":"auth.denied","channel":"pos:x","ip":"192.0.2.1","auth":"session","role":"cashier","reason":"nope"}';
    assert.strictEqual(extractIp(line, RE_DENIED), '192.0.2.1');
  });

  run('filter file failregex lines match the JS patterns (sanity)', () => {
    const f = fs.readFileSync(FILTER_MAIN, 'utf8');
    assert.ok(f.includes('"auth\\.login\\.failure"'), 'pos-audit.conf missing login.failure regex fragment');
    assert.ok(f.includes('"rate_limit\\.blocked"'), 'pos-audit.conf missing rate_limit fragment');
    assert.ok(f.includes('"kind":"login"'), 'pos-audit.conf must require kind login for rate_limit');
    assert.ok(f.includes('<HOST>'), 'pos-audit.conf must use fail2ban <HOST> token');
  });

  console.log(`\n# results: ${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})();

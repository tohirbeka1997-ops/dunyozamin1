/* eslint-disable no-console */
// =============================================================================
// rateLimit.test.cjs — unit tests for the in-process rate limiter
// =============================================================================
'use strict';
const assert = require('assert');
const { createRateLimiter, keyForRequest } = require('./rateLimit.cjs');

(async function run() {
  // --- 1. Empty key is always allowed (anonymous path passes through) -------
  {
    const rl = createRateLimiter({ rpc: { windowMs: 1000, max: 2 } });
    const r = rl.checkRpc('');
    assert.strictEqual(r.allowed, true, 'empty key must be allowed');
  }

  // --- 2. Basic fixed-window counter behavior -------------------------------
  {
    let t = 1_000_000;
    const rl = createRateLimiter({
      rpc:   { windowMs: 1000, max: 3 },
      login: { windowMs: 1000, max: 1 },
      now: () => t,
    });
    assert.strictEqual(rl.checkRpc('1.2.3.4').allowed, true);
    assert.strictEqual(rl.checkRpc('1.2.3.4').allowed, true);
    assert.strictEqual(rl.checkRpc('1.2.3.4').allowed, true);
    const r = rl.checkRpc('1.2.3.4');
    assert.strictEqual(r.allowed, false, '4th call must be blocked');
    assert.ok(r.retryAfterMs > 0 && r.retryAfterMs <= 1000, 'retryAfter sensible');
    console.log('  ✓ basic window counting');

    // Window rolls over — after the window resets, budget resets too.
    t += 1001;
    assert.strictEqual(rl.checkRpc('1.2.3.4').allowed, true, 'budget resets after window');
    console.log('  ✓ window reset');
  }

  // --- 3. Per-key isolation (two IPs don't share a bucket) ------------------
  {
    const rl = createRateLimiter({ rpc: { windowMs: 1000, max: 1 } });
    assert.strictEqual(rl.checkRpc('a').allowed, true);
    assert.strictEqual(rl.checkRpc('a').allowed, false);
    assert.strictEqual(rl.checkRpc('b').allowed, true, 'different key has its own bucket');
    console.log('  ✓ per-key isolation');
  }

  // --- 4. Login bucket is independent from rpc bucket -----------------------
  {
    const rl = createRateLimiter({
      rpc:   { windowMs: 1000, max: 10 },
      login: { windowMs: 1000, max: 2 },
    });
    assert.strictEqual(rl.checkLogin('ip|user').allowed, true);
    assert.strictEqual(rl.checkLogin('ip|user').allowed, true);
    assert.strictEqual(rl.checkLogin('ip|user').allowed, false, 'login bucket exhausted');
    assert.strictEqual(rl.checkRpc('ip').allowed, true, 'rpc bucket untouched');
    console.log('  ✓ login / rpc buckets independent');
  }

  // --- 5. GC purges expired buckets -----------------------------------------
  {
    let t = 0;
    const rl = createRateLimiter({
      rpc: { windowMs: 100, max: 5 },
      now: () => t,
    });
    rl.checkRpc('x'); rl.checkRpc('y'); rl.checkRpc('z');
    assert.strictEqual(rl.stats().rpcBuckets, 3);
    t += 101; // windows expired
    rl.gcOnce();
    assert.strictEqual(rl.stats().rpcBuckets, 0, 'gc removes expired buckets');
    console.log('  ✓ gc purges expired buckets');
  }

  // --- 6. keyForRequest: trustProxy flag ------------------------------------
  {
    const fakeReq = (headers, remoteAddress) => ({
      headers: headers || {},
      socket: { remoteAddress },
    });
    assert.strictEqual(
      keyForRequest(fakeReq({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8' }, '10.0.0.1')),
      '10.0.0.1',
      'default (trustProxy=false) uses socket.remoteAddress',
    );
    assert.strictEqual(
      keyForRequest(
        fakeReq({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8' }, '10.0.0.1'),
        { trustProxy: true },
      ),
      '1.2.3.4',
      'trustProxy=true returns first XFF IP',
    );
    assert.strictEqual(
      keyForRequest(fakeReq({}, undefined)),
      'unknown',
      'missing remoteAddress → "unknown" (never throws)',
    );
    console.log('  ✓ keyForRequest trustProxy behavior');
  }

  console.log('\nOK — rateLimit unit tests passed');
})().catch((e) => {
  console.error('FAIL:', e);
  process.exit(1);
});

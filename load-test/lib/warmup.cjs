#!/usr/bin/env node
/* eslint-disable no-console */
// =============================================================================
// Load-test warm-up & sanity check (runs BEFORE k6/autocannon)
// =============================================================================
// Responsibilities:
//   1. Verify pos-server is reachable at LOAD_TARGET.
//   2. Acquire an admin shared-secret and use it to:
//        a) list products (ensures catalog has >= LOAD_MIN_PRODUCTS rows),
//        b) check that at least one cashier user exists,
//        c) open a shift for the cashier (required for sales RPC).
//   3. Emit a JSON bundle to stdout that k6/autocannon can pick up:
//        {
//          "url": "http://…",
//          "admin_secret": "…",
//          "cashier": { "id":"…", "username":"cashier1", "password":"test" },
//          "product_ids": ["…", "…"],
//          "shift_id": "…"
//        }
//
// The script is IDEMPOTENT — safe to re-run. It never deletes data; it only
// inserts what the load test needs to exercise realistic paths.
// =============================================================================

const http = require('http');
const https = require('https');
const { URL } = require('url');

const TARGET = process.env.LOAD_TARGET || process.env.VITE_POS_RPC_URL || 'http://127.0.0.1:3333';
const SECRET = process.env.POS_HOST_SECRET || process.env.VITE_POS_RPC_SECRET;
const MIN_PRODUCTS = Number(process.env.LOAD_MIN_PRODUCTS || 10);
const CASHIER_USERNAME = process.env.LOAD_CASHIER_USER || 'loadtest_cashier';
const CASHIER_PASSWORD = process.env.LOAD_CASHIER_PASS || 'LoadTest123!';

if (!SECRET) {
  console.error('ERROR: POS_HOST_SECRET (or VITE_POS_RPC_SECRET) is required.');
  process.exit(1);
}

function rpc(channel, args = [], auth = `Bearer ${SECRET}`) {
  return new Promise((resolve, reject) => {
    const u = new URL(`${TARGET}/rpc`);
    const body = JSON.stringify({ channel, args });
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(
      {
        method: 'POST',
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          Authorization: auth,
        },
        timeout: 15000,
      },
      (res) => {
        let buf = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (buf += c));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(buf || '{}');
            resolve({ status: res.statusCode, body: parsed });
          } catch (e) {
            reject(new Error(`Non-JSON from ${channel}: ${buf.slice(0, 200)}`));
          }
        });
      },
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.write(body);
    req.end();
  });
}

async function must(channel, args) {
  const r = await rpc(channel, args);
  if (r.status !== 200 || !r.body || r.body.ok === false) {
    throw new Error(`${channel} failed: ${JSON.stringify(r)}`);
  }
  return r.body.data;
}

async function main() {
  // 1) /health
  const healthRes = await new Promise((resolve, reject) => {
    const u = new URL(`${TARGET}/health`);
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.get(u, (res) => {
      let buf = '';
      res.on('data', (c) => (buf += c));
      res.on('end', () => resolve({ status: res.statusCode, body: buf }));
    });
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('timeout')));
  });
  if (healthRes.status !== 200) throw new Error(`/health returned ${healthRes.status}`);
  console.error(`[warmup] target OK: ${TARGET}`);

  // 2) products — must be plenty to avoid cache-hit bias.
  const products = await must('pos:products:list', [{ limit: 200 }]);
  const list = Array.isArray(products) ? products : products?.items || products?.rows || [];
  if (list.length < MIN_PRODUCTS) {
    throw new Error(
      `Need at least ${MIN_PRODUCTS} products for realistic load; have ${list.length}. ` +
        'Seed the DB first (see README).',
    );
  }
  const productIds = list.slice(0, Math.min(50, list.length)).map((p) => p.id).filter(Boolean);
  console.error(`[warmup] catalog OK: ${list.length} products, sampling ${productIds.length}`);

  // 3) cashier user — create if missing.
  const existing = await must('pos:users:list', []);
  const users = Array.isArray(existing) ? existing : existing?.items || [];
  let cashier = users.find((u) => u.username === CASHIER_USERNAME);
  if (!cashier) {
    console.error(`[warmup] creating cashier user "${CASHIER_USERNAME}"`);
    cashier = await must('pos:users:create', [
      {
        username: CASHIER_USERNAME,
        full_name: 'Load Test Cashier',
        password: CASHIER_PASSWORD,
        role: 'cashier',
        is_active: 1,
      },
    ]);
  }
  if (!cashier?.id) throw new Error(`Could not obtain cashier id: ${JSON.stringify(cashier)}`);

  // 4) shift — open one if not already open. Some builds of pos:shifts:open
  //    require a user_id + opening_cash. We soft-fail here because not all
  //    scenarios need a shift; sales tests will skip if missing.
  let shiftId = null;
  try {
    const active = await rpc('pos:shifts:getActive', [{ user_id: cashier.id }]);
    if (active?.body?.ok && active.body.data?.id) {
      shiftId = active.body.data.id;
    } else {
      const opened = await rpc('pos:shifts:open', [{ user_id: cashier.id, opening_cash: 0 }]);
      if (opened?.body?.ok && opened.body.data?.id) shiftId = opened.body.data.id;
    }
  } catch (e) {
    console.error(`[warmup] shift setup skipped: ${e.message}`);
  }

  // 5) Login once with session creds — proves the cashier can actually auth
  //    (so k6 sessions won't spin on 401).
  const login = await rpc('pos:auth:login', [{ username: CASHIER_USERNAME, password: CASHIER_PASSWORD }]);
  if (!(login.body && login.body.ok && login.body.data?.success)) {
    throw new Error(`cashier login failed — check credentials: ${JSON.stringify(login.body)}`);
  }
  console.error(`[warmup] cashier login OK (token=${String(login.body.data.token).slice(0, 8)}…)`);

  const bundle = {
    url: TARGET,
    admin_secret: SECRET,
    cashier: {
      id: cashier.id,
      username: CASHIER_USERNAME,
      password: CASHIER_PASSWORD,
    },
    product_ids: productIds,
    shift_id: shiftId,
  };
  process.stdout.write(JSON.stringify(bundle, null, 2) + '\n');
}

main().catch((e) => {
  console.error('[warmup] FAILED:', e.message);
  process.exit(1);
});

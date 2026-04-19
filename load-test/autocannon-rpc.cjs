#!/usr/bin/env node
/* eslint-disable no-console */
// =============================================================================
// autocannon-rpc.cjs — lightweight alternative to k6 (pure Node.js)
// =============================================================================
// Use when k6 binary is unavailable (e.g. inside a Docker container, constrained
// CI, or just to get quick numbers during dev).  Covers the SAME two shapes
// k6/rpc-read.js and k6/rpc-mixed.js expose, but without thresholds/stages.
//
//   node load-test/autocannon-rpc.cjs --scenario=read  --connections=30 --duration=60
//   node load-test/autocannon-rpc.cjs --scenario=mixed --connections=20 --duration=180
//
// Output: markdown-ish summary + JSON file under load-test/results/.
// =============================================================================
const autocannon = require('autocannon');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// --- CLI ---------------------------------------------------------------------
const args = process.argv.slice(2).reduce((a, raw) => {
  const [k, v = 'true'] = raw.replace(/^--/, '').split('=');
  a[k] = v;
  return a;
}, {});
const SCENARIO = args.scenario || 'read';
const CONNECTIONS = Number(args.connections || 20);
const DURATION = Number(args.duration || 60);
const PIPELINING = Number(args.pipelining || 1);
const TARGET = process.env.LOAD_TARGET || args.target || 'http://127.0.0.1:3333';
const SECRET = process.env.POS_HOST_SECRET || process.env.VITE_POS_RPC_SECRET;

if (!SECRET) {
  console.error('ERROR: POS_HOST_SECRET is required.');
  process.exit(1);
}

// --- Warm-up + bundle --------------------------------------------------------
console.error('[autocannon] running warmup…');
const bundleRaw = execSync(`node "${path.join(__dirname, 'lib', 'warmup.cjs')}"`, {
  env: { ...process.env, POS_HOST_SECRET: SECRET, LOAD_TARGET: TARGET },
  stdio: ['ignore', 'pipe', 'inherit'],
}).toString('utf8');
const bundle = JSON.parse(bundleRaw);
const PRODUCT_IDS = bundle.product_ids;
if (!PRODUCT_IDS || PRODUCT_IDS.length < 5) {
  console.error(`[autocannon] warmup returned too few products: ${PRODUCT_IDS?.length}`);
  process.exit(1);
}

// --- Request templates (autocannon requires a static mix, so we pre-compute) -
function makeRequest(channel, args = []) {
  return {
    method: 'POST',
    path: '/rpc',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SECRET}`,
    },
    body: JSON.stringify({ channel, args }),
  };
}

let requests;
if (SCENARIO === 'read') {
  requests = [
    // weights sum to 100 (autocannon weights are integers)
    { weight: 40, ...makeRequest('pos:products:list', [{ limit: 50 }]) },
    { weight: 20, ...makeRequest('pos:products:get',  [PRODUCT_IDS[0]]) },
    { weight: 20, ...makeRequest('pos:products:get',  [PRODUCT_IDS[PRODUCT_IDS.length - 1]]) },
    { weight: 10, ...makeRequest('pos:categories:list', []) },
    { weight: 10, ...makeRequest('pos:customers:list', [{ limit: 25 }]) },
  ];
} else if (SCENARIO === 'mixed') {
  // Note: autocannon can't easily do stateful sessions (login → use token), so
  // `mixed` here uses the admin shared secret for everything. Prefer k6 for a
  // truly session-accurate test.
  requests = [
    { weight: 30, ...makeRequest('pos:products:list', [{ limit: 30 }]) },
    { weight: 15, ...makeRequest('pos:products:get',  [PRODUCT_IDS[0]]) },
    { weight: 10, ...makeRequest('pos:categories:list', []) },
    { weight: 10, ...makeRequest('pos:customers:list', [{ limit: 25 }]) },
    { weight: 10, ...makeRequest('pos:inventory:getBalances', [{ limit: 25 }]) },
    { weight: 15, ...makeRequest('pos:sales:list', [{ limit: 10 }]) },
    // Intentionally no createDraftOrder here — autocannon would race on the
    // returned id. Use the k6 scenario for write-heavy validation.
    { weight: 10, ...makeRequest('pos:shifts:getActive', [{ user_id: bundle.cashier.id }]) },
  ];
} else {
  console.error(`Unknown scenario: ${SCENARIO} (expected: read | mixed)`);
  process.exit(2);
}

// --- Run ---------------------------------------------------------------------
console.error(`[autocannon] scenario=${SCENARIO} connections=${CONNECTIONS} duration=${DURATION}s target=${TARGET}`);

const instance = autocannon({
  url: TARGET,
  connections: CONNECTIONS,
  pipelining: PIPELINING,
  duration: DURATION,
  timeout: 30,
  requests,
  // Consider 4xx/5xx as errors (default only counts socket errors).
  expectedResponses: { body: '"ok":true' },
}, (err, result) => {
  if (err) {
    console.error('[autocannon] error:', err);
    process.exit(1);
  }

  const outDir = path.join(__dirname, 'results');
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, `autocannon-${SCENARIO}.json`);
  fs.writeFileSync(file, JSON.stringify(result, null, 2));

  // Markdown summary to stdout.
  const lat = result.latency;
  const req = result.requests;
  const ok2xx = result['2xx'] || 0;
  const nonOk = result.non2xx || 0;
  const errs = result.errors || 0;

  console.log();
  console.log(`## autocannon — ${SCENARIO}`);
  console.log(`- duration:     ${DURATION}s`);
  console.log(`- connections:  ${CONNECTIONS}`);
  console.log(`- req total:    ${req.total}`);
  console.log(`- req/sec avg:  ${req.average.toFixed(1)}`);
  console.log(`- latency p50:  ${lat.p50} ms`);
  console.log(`- latency p95:  ${lat.p95} ms`);
  console.log(`- latency p99:  ${lat.p99} ms`);
  console.log(`- latency max:  ${lat.max} ms`);
  console.log(`- 2xx:          ${ok2xx}`);
  console.log(`- non-2xx:      ${nonOk}`);
  console.log(`- errors:       ${errs}`);
  console.log(`- json:         ${file}`);

  // Fail CI if the run was catastrophic.
  const errRate = req.total > 0 ? (nonOk + errs) / req.total : 1;
  if (errRate > 0.05) {
    console.error(`[autocannon] FAIL — error rate ${(errRate * 100).toFixed(2)}% > 5%`);
    process.exit(3);
  }
});

autocannon.track(instance, { renderProgressBar: true, renderResultsTable: false });

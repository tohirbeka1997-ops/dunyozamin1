// =============================================================================
// k6 — read-heavy baseline
// =============================================================================
// Goal: establish a floor for how fast the RPC layer can serve cached/indexed
// reads (products, categories, customers, inventory balances). If THIS test
// struggles at 30 TPS, the mixed test won't have a chance — fix the read path
// first.
//
// Run:
//   k6 run \
//     -e TARGET=http://127.0.0.1:3333 \
//     -e ADMIN_SECRET=$POS_HOST_SECRET \
//     -e PRODUCT_IDS=$(node load-test/lib/warmup.cjs | jq -r '.product_ids | join(",")') \
//     load-test/k6/rpc-read.js
//
// Shape: ramp 1 → 30 VUs over 30s, hold 30 VUs for 2m, ramp to 0 over 30s.
// =============================================================================
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Counter } from 'k6/metrics';

const TARGET = __ENV.TARGET || 'http://127.0.0.1:3333';
const SECRET = __ENV.ADMIN_SECRET;
const PRODUCT_IDS = (__ENV.PRODUCT_IDS || '').split(',').filter(Boolean);

if (!SECRET) throw new Error('ADMIN_SECRET is required (export POS_HOST_SECRET)');

export const options = {
  // Default VU shape — override with  -e STAGES=short  for CI smoke.
  stages: __ENV.STAGES === 'short' ? [
    { duration: '10s', target: 5 },
    { duration: '20s', target: 5 },
    { duration: '5s',  target: 0 },
  ] : [
    { duration: '30s', target: Number(__ENV.VUS || 30) },
    { duration: '2m',  target: Number(__ENV.VUS || 30) },
    { duration: '30s', target: 0 },
  ],
  // Fail the run if thresholds are breached. p95 budgets chosen to match the
  // Grafana alert `PosRpcLatencyP95High` (>500ms @ 5min).
  thresholds: {
    http_req_failed:     ['rate<0.01'],         // <1% errors
    http_req_duration:   ['p(95)<500', 'p(99)<1000'],
    rpc_latency_ms:      ['p(95)<500'],
    rpc_errors:          ['count<50'],
  },
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
  noConnectionReuse: false,
};

const rpcLatency = new Trend('rpc_latency_ms', true);
const rpcErrors = new Counter('rpc_errors');

const headers = {
  'Content-Type': 'application/json',
  Authorization: `Bearer ${SECRET}`,
};

function call(channel, args = []) {
  const payload = JSON.stringify({ channel, args });
  const res = http.post(`${TARGET}/rpc`, payload, { headers, tags: { channel } });
  rpcLatency.add(res.timings.duration, { channel });

  const ok = check(res, {
    'status 200': (r) => r.status === 200,
    'ok=true':    (r) => {
      try { return JSON.parse(r.body).ok === true; } catch { return false; }
    },
  });
  if (!ok) rpcErrors.add(1, { channel });
  return res;
}

export default function () {
  // Mix of read channels that mirror what the POS UI polls constantly.
  const pick = Math.random();
  if (pick < 0.40) {
    // 40% — paginated product list (the dashboard + catalog page)
    call('pos:products:list', [{ limit: 50, offset: Math.floor(Math.random() * 3) * 50 }]);
  } else if (pick < 0.60) {
    // 20% — single product lookup (POS terminal after barcode scan)
    if (PRODUCT_IDS.length > 0) {
      const id = PRODUCT_IDS[Math.floor(Math.random() * PRODUCT_IDS.length)];
      call('pos:products:get', [id]);
    } else {
      call('pos:products:list', [{ limit: 20 }]);
    }
  } else if (pick < 0.75) {
    // 15% — categories (loaded on every terminal open)
    call('pos:categories:list', []);
  } else if (pick < 0.90) {
    // 15% — customer search
    call('pos:customers:list', [{ limit: 25 }]);
  } else {
    // 10% — inventory balance check
    call('pos:inventory:getBalances', [{ limit: 25 }]);
  }

  // Small think-time — real cashier UI calls are not back-to-back.
  sleep(Math.random() * 0.3);
}

export function handleSummary(data) {
  // Also emit a compact JSON for CI ingestion.
  return {
    stdout: textSummary(data),
    'load-test/results/rpc-read.json': JSON.stringify(data, null, 2),
  };
}

function textSummary(d) {
  const m = d.metrics;
  const get = (name, stat) => (m[name] && m[name].values ? m[name].values[stat] : undefined);
  const fmt = (v) => (typeof v === 'number' ? v.toFixed(1) + 'ms' : 'n/a');
  return [
    '',
    '== rpc-read baseline ==',
    `  p50:  ${fmt(get('http_req_duration', 'med'))}`,
    `  p95:  ${fmt(get('http_req_duration', 'p(95)'))}`,
    `  p99:  ${fmt(get('http_req_duration', 'p(99)'))}`,
    `  max:  ${fmt(get('http_req_duration', 'max'))}`,
    `  rps:  ${(get('http_reqs', 'rate') || 0).toFixed(1)}`,
    `  errs: ${get('rpc_errors', 'count') || 0}`,
    '',
  ].join('\n');
}

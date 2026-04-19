// =============================================================================
// k6 — mixed workload (realistic cashier session)
// =============================================================================
// Simulates: 20-30 concurrent cashier sessions, each doing a tight loop of
//   1. login (once per VU, at iteration 0)
//   2. list products / lookup by id   (x ~6 per minute)
//   3. createDraftOrder → addItem (3-5x) → finalizeOrder  (~1 per minute)
//
// Writes hit the *biggest* bottleneck first: SQLite serial writers. The
// default of 20 VUs @ ~1 tx/min = ~20 writes/min = ~0.33 TPS of write churn,
// which is a realistic multi-terminal store. Push with VUS= and WRITE_RATIO=
// to find the ceiling on YOUR hardware.
//
// Run:
//   BUNDLE=$(node load-test/lib/warmup.cjs)
//   k6 run \
//     -e TARGET=$(echo $BUNDLE | jq -r .url) \
//     -e ADMIN_SECRET=$POS_HOST_SECRET \
//     -e CASHIER_USER=$(echo $BUNDLE | jq -r .cashier.username) \
//     -e CASHIER_PASS=$(echo $BUNDLE | jq -r .cashier.password) \
//     -e PRODUCT_IDS=$(echo $BUNDLE | jq -r '.product_ids | join(",")') \
//     load-test/k6/rpc-mixed.js
// =============================================================================
import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Trend, Counter, Rate } from 'k6/metrics';

const TARGET = __ENV.TARGET || 'http://127.0.0.1:3333';
const ADMIN_SECRET = __ENV.ADMIN_SECRET;
const CASHIER_USER = __ENV.CASHIER_USER || 'loadtest_cashier';
const CASHIER_PASS = __ENV.CASHIER_PASS || 'LoadTest123!';
const PRODUCT_IDS = (__ENV.PRODUCT_IDS || '').split(',').filter(Boolean);
const WRITE_RATIO = Number(__ENV.WRITE_RATIO || 0.20);  // 20% of iterations do a full sale

if (!ADMIN_SECRET) throw new Error('ADMIN_SECRET is required');
if (PRODUCT_IDS.length === 0) throw new Error('PRODUCT_IDS is required (see warmup.cjs)');

export const options = {
  stages: __ENV.STAGES === 'short' ? [
    { duration: '10s', target: 5 },
    { duration: '30s', target: 5 },
    { duration: '5s',  target: 0 },
  ] : [
    { duration: '30s', target: Number(__ENV.VUS || 20) },
    { duration: '3m',  target: Number(__ENV.VUS || 20) },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    'http_req_failed':             ['rate<0.02'],
    'http_req_duration':           ['p(95)<800', 'p(99)<1500'],
    'rpc_latency_ms{kind:read}':   ['p(95)<400'],
    'rpc_latency_ms{kind:write}':  ['p(95)<1200'],
    'login_success_rate':          ['rate>0.98'],
    'sale_success_rate':           ['rate>0.95'],
  },
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
  noConnectionReuse: false,
};

const rpcLatency = new Trend('rpc_latency_ms', true);
const rpcErrors = new Counter('rpc_errors');
const loginOK = new Rate('login_success_rate');
const saleOK = new Rate('sale_success_rate');

function call(channel, args, token, kind) {
  const payload = JSON.stringify({ channel, args });
  const res = http.post(`${TARGET}/rpc`, payload, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    tags: { channel, kind },
  });
  rpcLatency.add(res.timings.duration, { channel, kind });

  let body = null;
  try { body = JSON.parse(res.body); } catch { /* ignore */ }
  const ok = res.status === 200 && body && body.ok === true;
  if (!ok) rpcErrors.add(1, { channel, kind });
  return { ok, body, res };
}

// -----------------------------------------------------------------------------
// Setup runs ONCE (k6 main) — nothing to do here; each VU logs in itself.
// -----------------------------------------------------------------------------
export function setup() {
  // sanity: ping /health
  const r = http.get(`${TARGET}/health`, { timeout: '5s' });
  if (r.status !== 200) throw new Error(`/health returned ${r.status}`);
  return {};
}

// -----------------------------------------------------------------------------
// Per-VU initialization: login and cache token between iterations.
// k6 gives each VU a unique __VU index + an __ITER counter. We (ab)use
// globalThis to persist the token between iterations for the same VU.
// -----------------------------------------------------------------------------
function ensureToken() {
  if (globalThis.__token) return globalThis.__token;

  // Use the admin shared secret to call pos:auth:login. The handler issues a
  // real session token bound to the cashier account.
  const r = call('pos:auth:login', [{ username: CASHIER_USER, password: CASHIER_PASS }],
                 ADMIN_SECRET, 'read');
  const success = r.ok && r.body?.data?.success && r.body?.data?.token;
  loginOK.add(success);
  if (!success) {
    console.error(`login failed for VU ${__VU}: ${JSON.stringify(r.body)}`);
    return null;
  }
  globalThis.__token = r.body.data.token;
  return globalThis.__token;
}

export default function () {
  const token = ensureToken();
  if (!token) {
    sleep(1);
    return;
  }

  // 3-5 read calls per iteration (mimics a cashier browsing before each sale)
  group('reads', () => {
    const n = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const pick = Math.random();
      if (pick < 0.5) {
        call('pos:products:list', [{ limit: 20 }], token, 'read');
      } else if (pick < 0.8) {
        const id = PRODUCT_IDS[Math.floor(Math.random() * PRODUCT_IDS.length)];
        call('pos:products:get', [id], token, 'read');
      } else {
        call('pos:categories:list', [], token, 'read');
      }
      sleep(0.1 + Math.random() * 0.2);
    }
  });

  // ~20% of iterations push a full sale transaction through.
  if (Math.random() < WRITE_RATIO) {
    group('sale', () => {
      const draft = call('pos:sales:createDraftOrder', [{}], token, 'write');
      const orderId = draft.ok && (draft.body?.data?.id || draft.body?.data?.order_id);
      if (!orderId) { saleOK.add(false); return; }

      // Add 1-3 line items
      const items = 1 + Math.floor(Math.random() * 3);
      let addedAll = true;
      for (let i = 0; i < items; i++) {
        const productId = PRODUCT_IDS[Math.floor(Math.random() * PRODUCT_IDS.length)];
        const r = call('pos:sales:addItem',
          [{ order_id: orderId, product_id: productId, quantity: 1 }],
          token, 'write');
        if (!r.ok) { addedAll = false; break; }
      }

      if (!addedAll) { saleOK.add(false); return; }

      const finalized = call('pos:sales:finalizeOrder',
        [{ order_id: orderId, payment_method: 'cash', paid_amount: 100000 }],
        token, 'write');
      saleOK.add(finalized.ok === true);
    });
  }

  sleep(0.5 + Math.random() * 0.5);
}

export function handleSummary(data) {
  return {
    stdout: textSummary(data),
    'load-test/results/rpc-mixed.json': JSON.stringify(data, null, 2),
  };
}

function textSummary(d) {
  const m = d.metrics;
  const get = (name, stat) => (m[name] && m[name].values ? m[name].values[stat] : undefined);
  const fmt = (v) => (typeof v === 'number' ? v.toFixed(1) + 'ms' : 'n/a');
  return [
    '',
    '== rpc-mixed workload ==',
    `  VUs peak:      ${get('vus_max', 'value')}`,
    `  http p95:      ${fmt(get('http_req_duration', 'p(95)'))}`,
    `  http p99:      ${fmt(get('http_req_duration', 'p(99)'))}`,
    `  http rps:      ${(get('http_reqs', 'rate') || 0).toFixed(1)}`,
    `  err rate:      ${((get('http_req_failed', 'rate') || 0) * 100).toFixed(2)} %`,
    `  login success: ${((get('login_success_rate', 'rate') || 0) * 100).toFixed(1)} %`,
    `  sale success:  ${((get('sale_success_rate', 'rate') || 0) * 100).toFixed(1)} %`,
    '',
  ].join('\n');
}

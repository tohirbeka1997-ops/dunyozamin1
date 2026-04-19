# Load testing — POS RPC

Quick way to stress `/rpc` on a staging or production pos-server, confirm SLA
budgets, and identify bottlenecks using the existing Prometheus + Grafana stack.

## Scripts at a glance

| Script | Tool | Stateful login | Write path | When to use |
|--------|------|----------------|------------|-------------|
| `k6/rpc-read.js`  | [k6](https://k6.io)          | no (admin secret) | no | Baseline read throughput |
| `k6/rpc-mixed.js` | k6                                  | **yes** (session token) | **yes** (sale flow) | Realistic cashier simulation |
| `autocannon-rpc.cjs` | [autocannon](https://github.com/mcollina/autocannon) | no | no (read-only mixed) | Quick check, no extra binary needed |
| `lib/warmup.cjs`  | pure Node.js                        | n/a | seed only | Runs before every test — idempotent |

## Prerequisites

- `POS_HOST_SECRET` exported in your shell (same as `.env` on the server).
- A staging `pos-server` on port 3333 (or override via `LOAD_TARGET`).
- At least 10 products in the DB (warmup will refuse to start otherwise).
- For k6: `k6` binary on `$PATH` — install via <https://k6.io/docs/get-started/installation/>.
- For autocannon: just `npm install` at the repo root.

> **Never run these against the live production DB during business hours.**
> The mixed scenario creates real sales orders; run it on staging or a restored
> snapshot (see `deploy/scripts/restore-drill.sh`).

## 1. Quick smoke (CI friendly, ~15s)

```bash
export POS_HOST_SECRET=...
npm run load:smoke
```

Runs autocannon at 5 connections for 10s against the read scenario. Fails CI
if error rate > 5%. Does *not* hit writes.

## 2. Baseline — read only

```bash
export POS_HOST_SECRET=...
export LOAD_TARGET=http://127.0.0.1:3333

# autocannon (no extra binary)
npm run load:autocannon:read

# OR k6 (richer thresholds + per-channel stats)
BUNDLE=$(node load-test/lib/warmup.cjs)
PRODUCT_IDS=$(echo "$BUNDLE" | jq -r '.product_ids | join(",")')
k6 run \
  -e TARGET=$LOAD_TARGET \
  -e ADMIN_SECRET=$POS_HOST_SECRET \
  -e PRODUCT_IDS=$PRODUCT_IDS \
  load-test/k6/rpc-read.js
```

Reads what a 30-cashier fleet looks like when nobody's selling. Expect p95 well
below the Grafana `PosRpcLatencyP95High` alert threshold (500 ms).

## 3. Realistic — mixed reads + writes (k6 only)

```bash
export POS_HOST_SECRET=...
BUNDLE=$(node load-test/lib/warmup.cjs)
k6 run \
  -e TARGET=$(echo "$BUNDLE" | jq -r .url) \
  -e ADMIN_SECRET=$POS_HOST_SECRET \
  -e CASHIER_USER=$(echo "$BUNDLE" | jq -r .cashier.username) \
  -e CASHIER_PASS=$(echo "$BUNDLE" | jq -r .cashier.password) \
  -e PRODUCT_IDS=$(echo "$BUNDLE" | jq -r '.product_ids | join(",")') \
  -e VUS=20 \
  -e WRITE_RATIO=0.20 \
  load-test/k6/rpc-mixed.js
```

Each VU logs in once (real session token), does 3-5 read calls, then with
`WRITE_RATIO` probability pushes a full `createDraftOrder → addItem × N →
finalizeOrder`. Sales accumulate, so re-run against a scratch DB for clean
baselines.

## 4. Watching it happen — Grafana

While the test runs, open:

- **Grafana → POS / Load test** (provisioned from
  `deploy/monitoring/grafana/dashboards/pos-load-test.json`). Auto-refreshes
  every 10 s.
- Panels show: RPC throughput by channel, p50/p95/p99 latency, error / denied
  rate, HTTP 5xx/4xx, host load average and memory, active sessions, DB size.

Key Prometheus queries you can type in Explore:

| Signal | Query |
|--------|-------|
| Total RPS        | `sum(rate(pos_rpc_calls_total[30s]))` |
| p95 latency      | `histogram_quantile(0.95, sum by (le) (rate(pos_rpc_call_duration_seconds_bucket[30s])))` |
| Error rate       | `sum(rate(pos_rpc_calls_total{outcome="error"}[30s])) / sum(rate(pos_rpc_calls_total[30s]))` |
| Slowest channel  | `topk(5, histogram_quantile(0.95, sum by (le, channel) (rate(pos_rpc_call_duration_seconds_bucket[1m]))))` |
| DB write errors  | `sum(rate(pos_db_query_errors_total[1m]))` |
| Login failures   | `sum(rate(pos_auth_logins_total{outcome="invalid_credentials"}[1m]))` |

## 5. Interpreting results

| Symptom | Likely cause | Next step |
|---------|--------------|-----------|
| p99 >> p95 latency on reads | Node event-loop blocked (long sync SQLite query) | Add index for the dominant query; profile with `NODE_OPTIONS=--cpu-prof` |
| p95 writes > 1.5 s under mild load | SQLite write lock contention | Verify `journal_mode=WAL`; batch inserts; check disk I/O on host |
| HTTP 5xx rises during write spikes | Unhandled service-layer exception | Tail `pos-server` logs; check `pos_db_query_errors_total` |
| `denied` outcome spikes | Role mismatch between warmup cashier and channel ACL | Use admin secret OR a role with higher privileges |
| Host load > vCPU count, p95 climbs | CPU-bound (expected at some VUs) | Scale up VM or add pos-server replicas behind nginx |
| DB size grows >200 MB in 5 min during run | Test wrote too much data | Restore from backup before next run |

## 6. Recording a baseline

After a clean run, keep `load-test/results/*.json` alongside the git commit:

```bash
mkdir -p load-test/baselines
cp load-test/results/rpc-mixed.json \
   load-test/baselines/rpc-mixed-$(git rev-parse --short HEAD).json
```

This lets future PRs regression-check (a 20% p95 jump is something reviewers
want to catch **before** merging).

## 7. FAQ

**Q: `cashier login failed — check credentials`**
The warmup user exists but the password on disk differs (e.g. an older run
used a different `LOAD_CASHIER_PASS`). Delete the user via the admin UI, or
change `LOAD_CASHIER_USER` to a new name and re-run warmup.

**Q: Can I run this against production?**
Only the read scenarios, and only during off-hours. Write scenarios create real
sales orders. Use `deploy/scripts/restore-drill.sh` to spin up a disposable
pos-server from the latest backup — safe stress target.

**Q: Why not use `ab` / `wrk` / `hey`?**
They don't understand JSON-body POSTs with per-request variation or thresholds.
k6 + autocannon give everything we need for ~200 LOC total.

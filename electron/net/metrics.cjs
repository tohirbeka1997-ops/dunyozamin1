// =============================================================================
// POS server — Prometheus metrics
// =============================================================================
// Exposes a singleton `registry` plus typed metrics used by hostServer and
// rpcDispatch. Keep this file tiny and dependency-free beyond `prom-client`
// so the import cost is negligible when metrics are disabled.
// =============================================================================
const client = require('prom-client');

const registry = new client.Registry();

// Default process/Node.js metrics (event loop lag, RSS, GC pause…). Low
// cardinality, always useful.
client.collectDefaultMetrics({
  register: registry,
  prefix: 'pos_',
});

// ---- HTTP layer -------------------------------------------------------------

const httpRequestsTotal = new client.Counter({
  name: 'pos_http_requests_total',
  help: 'Total HTTP requests served by hostServer.',
  labelNames: ['route', 'method', 'status'],
  registers: [registry],
});

const httpRequestDurationSeconds = new client.Histogram({
  name: 'pos_http_request_duration_seconds',
  help: 'Latency of HTTP requests served by hostServer.',
  labelNames: ['route', 'method'],
  // Tuned for local LAN POS traffic — most requests under 200 ms.
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [registry],
});

// ---- RPC layer --------------------------------------------------------------

const rpcCallsTotal = new client.Counter({
  name: 'pos_rpc_calls_total',
  help: 'Total RPC calls dispatched.',
  // `outcome` = ok | error | denied (permission), `auth` = session | admin
  labelNames: ['channel', 'outcome', 'auth'],
  registers: [registry],
});

const rpcCallDurationSeconds = new client.Histogram({
  name: 'pos_rpc_call_duration_seconds',
  help: 'Latency of RPC dispatcher calls (service layer).',
  labelNames: ['channel'],
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [registry],
});

// ---- Auth / sessions --------------------------------------------------------

const authLoginsTotal = new client.Counter({
  name: 'pos_auth_logins_total',
  help: 'Login attempts grouped by outcome.',
  labelNames: ['outcome'], // success | invalid_credentials | error
  registers: [registry],
});

const activeSessions = new client.Gauge({
  name: 'pos_sessions_active',
  help: 'Number of non-expired sessions in the store.',
  registers: [registry],
});

// ---- SQLite / storage -------------------------------------------------------

const dbSizeBytes = new client.Gauge({
  name: 'pos_db_size_bytes',
  help: 'Size of the SQLite main DB file in bytes.',
  registers: [registry],
});

const dbQueryErrorsTotal = new client.Counter({
  name: 'pos_db_query_errors_total',
  help: 'DB errors observed by the dispatcher.',
  labelNames: ['channel'],
  registers: [registry],
});

// ---- Backups ----------------------------------------------------------------

const backupLocalCount = new client.Gauge({
  name: 'pos_backup_local_count',
  help: 'Number of SQLite snapshot files in the local backup directory.',
  registers: [registry],
});

const backupLastAgeSeconds = new client.Gauge({
  name: 'pos_backup_last_age_seconds',
  help: 'Age (seconds) of the most recent local backup file. -1 if none.',
  registers: [registry],
});

const backupLocalBytes = new client.Gauge({
  name: 'pos_backup_local_bytes',
  help: 'Total bytes stored in the local backup directory.',
  registers: [registry],
});

const backupOffsiteLastAgeSeconds = new client.Gauge({
  name: 'pos_backup_offsite_last_age_seconds',
  help: 'Age (seconds) since last successful off-site rclone sync (via sentinel file). -1 if never run.',
  registers: [registry],
});

// ---- Multi-tenant (Bosqich 15) ---------------------------------------------
// Cardinality stays bounded: fleet gauges + one gauge per tenant DB file +
// one counter family {tenant,outcome} incremented only in mtDispatch for
// tenant-scoped RPCs (see deploy/monitoring/grafana/dashboards/pos-tenants.json).

const tenantsTotal = new client.Gauge({
  name: 'pos_tenants_total',
  help: 'Number of tenants, broken down by state.',
  labelNames: ['state'], // "active" | "disabled"
  registers: [registry],
});

const tenantDbSizeBytes = new client.Gauge({
  name: 'pos_tenant_db_size_bytes',
  help: 'Size of each tenant SQLite file in bytes. Label cardinality = tenant count.',
  labelNames: ['tenant'],
  registers: [registry],
});

const tenantRpcCallsTotal = new client.Counter({
  name: 'pos_tenant_rpc_calls_total',
  help: 'RPC calls per tenant (OPT-IN; enable only when fleet is small).',
  labelNames: ['tenant', 'outcome'], // outcome = ok | error | denied
  registers: [registry],
});

// ---- Security / rate limiting ----------------------------------------------

const rateLimitBlockedTotal = new client.Counter({
  name: 'pos_rate_limit_blocked_total',
  help: 'Requests rejected by the in-process rate limiter.',
  // kind: "rpc" (global per-IP) or "login" (per-IP+username).
  labelNames: ['kind'],
  registers: [registry],
});

const auditEventsTotal = new client.Counter({
  name: 'pos_audit_events_total',
  help: 'Events written to the audit log.',
  labelNames: ['type'],
  registers: [registry],
});

// ---- Business gauges (cheap, read-on-scrape) --------------------------------

const businessGauges = {
  salesToday: new client.Gauge({
    name: 'pos_sales_today_total',
    help: 'Number of completed sales created in the current local day.',
    registers: [registry],
  }),
  salesTodayRevenue: new client.Gauge({
    name: 'pos_sales_today_revenue',
    help: 'Total revenue of completed sales created today (base currency).',
    registers: [registry],
  }),
  openShifts: new client.Gauge({
    name: 'pos_shifts_open',
    help: 'Number of currently open shifts.',
    registers: [registry],
  }),
};

// ---- Helpers ----------------------------------------------------------------

/** Convenience timer returning elapsed seconds (high-resolution). */
function startTimer() {
  const t0 = process.hrtime.bigint();
  return () => Number(process.hrtime.bigint() - t0) / 1e9;
}

/**
 * Snapshot cheap "business" gauges right before a scrape. Designed to fail
 * silently — we never let a monitoring glitch poison the actual product.
 */
function refreshBusinessGauges({ db, sessions }) {
  try {
    if (sessions && typeof sessions.size === 'function') {
      activeSessions.set(sessions.size());
    }
  } catch { /* ignore */ }

  if (!db) return;

  try {
    const row = db.prepare(
      `SELECT COUNT(*) AS n,
              COALESCE(SUM(total), 0) AS rev
       FROM sales_orders
       WHERE status = 'completed'
         AND DATE(created_at, 'localtime') = DATE('now', 'localtime')`,
    ).get();
    if (row) {
      businessGauges.salesToday.set(Number(row.n || 0));
      businessGauges.salesTodayRevenue.set(Number(row.rev || 0));
    }
  } catch { /* table may not exist on fresh DB; ignore */ }

  try {
    const row = db.prepare(
      `SELECT COUNT(*) AS n FROM shifts WHERE closed_at IS NULL`,
    ).get();
    if (row) businessGauges.openShifts.set(Number(row.n || 0));
  } catch { /* ignore */ }

  try {
    const fs = require('fs');
    const path = require('path');
    // better-sqlite3 exposes the DB filename on the connection object.
    const file = db.name || db.filename || null;
    if (file && fs.existsSync(file)) {
      dbSizeBytes.set(fs.statSync(file).size);
      const wal = path.join(path.dirname(file), `${path.basename(file)}-wal`);
      if (fs.existsSync(wal)) dbSizeBytes.inc(fs.statSync(wal).size);
    }
  } catch { /* ignore */ }

  // ---- Backup freshness -----------------------------------------------------
  // The backup directory is derived from the DB file location: `<dir>/backups`.
  // A sentinel file `.last-offsite-sync` (touched by backup-offsite.sh) tracks
  // the remote upload cadence separately from local snapshots.
  try {
    const fs = require('fs');
    const path = require('path');
    const file = db.name || db.filename || null;
    if (!file) return;
    const backupDir = path.join(path.dirname(file), 'backups');
    if (!fs.existsSync(backupDir)) {
      backupLocalCount.set(0);
      backupLastAgeSeconds.set(-1);
      backupLocalBytes.set(0);
    } else {
      const entries = fs
        .readdirSync(backupDir)
        .filter((f) => /^pos-\d{8}-\d{6}\.db$/i.test(f))
        .map((f) => {
          const st = fs.statSync(path.join(backupDir, f));
          return { mtimeMs: st.mtimeMs, size: st.size };
        });
      backupLocalCount.set(entries.length);
      if (entries.length === 0) {
        backupLastAgeSeconds.set(-1);
        backupLocalBytes.set(0);
      } else {
        const newest = entries.reduce((a, b) => (a.mtimeMs > b.mtimeMs ? a : b));
        const ageSec = Math.max(0, (Date.now() - newest.mtimeMs) / 1000);
        backupLastAgeSeconds.set(ageSec);
        backupLocalBytes.set(entries.reduce((s, e) => s + e.size, 0));
      }
    }

    const sentinel = path.join(backupDir, '.last-offsite-sync');
    if (fs.existsSync(sentinel)) {
      const st = fs.statSync(sentinel);
      backupOffsiteLastAgeSeconds.set(Math.max(0, (Date.now() - st.mtimeMs) / 1000));
    } else {
      backupOffsiteLastAgeSeconds.set(-1);
    }
  } catch { /* ignore */ }
}

/**
 * Refresh multi-tenant gauges from the registry. Low-cost even at 1k tenants:
 * one directory stat per tenant and a single COUNT query on the master DB.
 */
function refreshTenantGauges({ tenantRegistry } = {}) {
  if (!tenantRegistry) return;
  try {
    const all = tenantRegistry.listTenants({ includeInactive: true });
    const active = all.filter((t) => t.is_active).length;
    tenantsTotal.set({ state: 'active' }, active);
    tenantsTotal.set({ state: 'disabled' }, all.length - active);

    const fs = require('fs');
    // Always reset (some tenants may have been removed). We rebuild from
    // the current list so disappeared tenants get garbage-collected.
    tenantDbSizeBytes.reset();
    for (const t of all) {
      try {
        if (fs.existsSync(t.db_path)) {
          tenantDbSizeBytes.set({ tenant: t.slug }, fs.statSync(t.db_path).size);
        }
      } catch { /* ignore single-tenant failure */ }
    }
  } catch { /* ignore */ }
}

/** Render Prometheus text exposition. Also refreshes business gauges first. */
async function renderMetrics({ db, sessions, tenantRegistry } = {}) {
  refreshBusinessGauges({ db, sessions });
  refreshTenantGauges({ tenantRegistry });
  return registry.metrics();
}

module.exports = {
  registry,
  metrics: {
    httpRequestsTotal,
    httpRequestDurationSeconds,
    rpcCallsTotal,
    rpcCallDurationSeconds,
    authLoginsTotal,
    activeSessions,
    dbSizeBytes,
    dbQueryErrorsTotal,
    backupLocalCount,
    backupLastAgeSeconds,
    backupLocalBytes,
    backupOffsiteLastAgeSeconds,
    rateLimitBlockedTotal,
    auditEventsTotal,
    tenantsTotal,
    tenantDbSizeBytes,
    tenantRpcCallsTotal,
    ...businessGauges,
  },
  startTimer,
  renderMetrics,
};

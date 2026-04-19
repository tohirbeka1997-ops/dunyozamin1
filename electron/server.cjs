#!/usr/bin/env node
/**
 * POS Server Mode — Hetzner / Linux VPS uchun Electron'siz HTTP RPC server.
 *
 * Electron desktop ilovasi o'rniga, bu entry-point faqat Node.js jarayoni
 * sifatida ishlaydi: SQLite'ni ochadi, services layer'ni ko'taradi, va
 * `hostServer.cjs` orqali HTTP RPC xizmatini taqdim etadi.
 *
 * Foydalanish:
 *   # Lokal test
 *   POS_SERVER_MODE=1 node electron/server.cjs
 *
 *   # Hetznerda (PM2 bilan)
 *   pm2 start electron/server.cjs --name pos-server \
 *     --update-env -- --port 3333
 *
 * Muhim ENV o'zgaruvchilari (loyiha root `.env` faylidan o'qiladi):
 *   POS_SERVER_MODE=1                Majburiy — server rejimini yoqadi
 *   POS_DATA_DIR=/var/lib/pos        DB va config fayllar katalogi
 *   POS_HOST_PORT=3333               HTTP port (default 3333)
 *   POS_HOST_BIND=0.0.0.0            Interface (reverse proxy ortida — 127.0.0.1)
 *   POS_HOST_SECRET=<uuid>           Bearer token (xavfsiz tasodifiy qator)
 *   POS_CORS_ORIGINS=https://app.example.com,https://admin.example.com
 *   POS_BACKUP_ENABLED=1             Auto-backup (default 1)
 *   POS_BACKUP_INTERVAL_MIN=30       Backup oralig'i (daqiqa)
 *   POS_BACKUP_MAX=30                Saqlanadigan maks. nusxa
 *
 * Frontend uchun:
 *   VITE_POS_RPC_URL=https://api.example.com   # shu serverga ishora
 *   VITE_POS_RPC_SECRET=<uuid>                 # same as POS_HOST_SECRET
 */

'use strict';

// Server rejimini darhol yoqamiz (`runtime.cjs` shuni tekshiradi).
if (!process.env.POS_SERVER_MODE) {
  process.env.POS_SERVER_MODE = '1';
}

const path = require('path');
const fs = require('fs');

require('./config/loadRootEnv.cjs').loadRootEnv();

const { getAppLike, isServerMode, getUserDataDir } = require('./lib/runtime.cjs');

if (!isServerMode()) {
  console.error('[server] POS_SERVER_MODE is not set. Refusing to start Electron-free server.');
  process.exit(1);
}

const app = getAppLike();
const userData = getUserDataDir();

// Fayl log (userData/server.log) — PM2/systemd stdoutga qo'shimcha
function setupFileLogging() {
  try {
    if (!fs.existsSync(userData)) fs.mkdirSync(userData, { recursive: true });
    const logFile = path.join(userData, 'server.log');
    try {
      if (fs.existsSync(logFile)) {
        const { size } = fs.statSync(logFile);
        if (size > 10 * 1024 * 1024) fs.unlinkSync(logFile);
      }
    } catch (_e) {
      // ignore
    }
    fs.appendFileSync(logFile, `\n===== SERVER START ${new Date().toISOString()} =====\n`, 'utf8');

    const write = (level, args) => {
      try {
        const msg = args
          .map((a) => {
            if (a instanceof Error) return `${a.message}\n${a.stack || ''}`;
            if (typeof a === 'object') {
              try {
                return JSON.stringify(a);
              } catch {
                return String(a);
              }
            }
            return String(a);
          })
          .join(' ');
        fs.appendFileSync(logFile, `[${new Date().toISOString()}] [${level}] ${msg}\n`, 'utf8');
      } catch (_e) {
        // ignore
      }
    };

    const origLog = console.log.bind(console);
    const origWarn = console.warn.bind(console);
    const origErr = console.error.bind(console);
    console.log = (...args) => {
      write('LOG', args);
      origLog(...args);
    };
    console.warn = (...args) => {
      write('WARN', args);
      origWarn(...args);
    };
    console.error = (...args) => {
      write('ERROR', args);
      origErr(...args);
    };

    console.log('[server] File logging enabled:', logFile);
    console.log('[server] POS_DATA_DIR:', userData);
  } catch (_e) {
    // ignore
  }
}

setupFileLogging();

function parseIntEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || String(raw).trim() === '') return fallback;
  const n = Number.parseInt(String(raw).trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function parseBoolEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const v = String(raw).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(v)) return true;
  if (['0', 'false', 'no', 'off', ''].includes(v)) return false;
  return fallback;
}

function parseCsvEnv(name) {
  const raw = process.env[name];
  if (!raw || !String(raw).trim()) return [];
  return String(raw)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Multi-tenant bootstrap (Bosqich 15)
// ---------------------------------------------------------------------------
// Called only when POS_MULTI_TENANT=1. Creates the registry, adopts any
// pre-existing single-tenant pos.db as `default`, seeds the first super-
// admin, and returns a fully-wired { registry, servicesCache, masterSessions,
// dispatcher } bag for the host server.
async function bootstrapMultiTenant({ dataDir }) {
  const crypto = require('crypto');
  const { randomUUID, createHash } = crypto;
  const { createTenantRegistry } = require('./db/tenantRegistry.cjs');
  const { runMigrations } = require('./db/migrate.cjs');
  const { createTenantServicesCache } = require('./services/tenantServices.cjs');
  const { createMasterSessionStore } = require('./net/masterSessions.cjs');
  const { createMultiTenantDispatcher } = require('./net/mtDispatch.cjs');

  const hashPassword = (plain) => createHash('sha256').update(String(plain)).digest('hex');
  const verifyPassword = (plain, hash) => hashPassword(plain) === hash;

  // Pragmas: keep tenant DBs aligned with single-tenant open.cjs settings.
  function applyPragmas(db) {
    db.pragma('journal_mode = DELETE');
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');
    db.pragma('synchronous = NORMAL');
    db.pragma('temp_store = MEMORY');
    db.pragma('cache_size = -20000');
    db.pragma('mmap_size = 268435456');
  }

  const registry = createTenantRegistry({
    dataDir,
    migrate: runMigrations,
    pragmas: applyPragmas,
  });

  // Auto-adopt an existing single-tenant pos.db as the `default` tenant so
  // upgrading a live installation does not lose data.
  const legacyDbPath = path.join(dataDir, 'pos.db');
  if (fs.existsSync(legacyDbPath) && !registry.getTenantBySlug('default')) {
    // `move=false` — safer default. The old file stays in place until the
    // operator manually removes it after verifying the adopted tenant works.
    const copyPath = path.join(dataDir, 'tenants', 'default', 'pos.db');
    if (!fs.existsSync(copyPath)) {
      registry.adoptExistingDb({
        slug: 'default',
        display_name: 'Default Store',
        sourceDbPath: legacyDbPath,
        move: false,
      });
      console.log(`[server] multi-tenant: adopted legacy DB as tenant "default" (copied to ${copyPath})`);
    }
  }

  // Seed the first super-admin from env on an empty master DB — otherwise
  // no one can log in to the admin RPCs even with the shared secret would be
  // available (shared secret grants adminBypass, but user-facing ops still
  // need a master session for audit attribution).
  const masterUserCount = registry.master
    .prepare('SELECT COUNT(*) AS n FROM master_users').get().n;
  if (masterUserCount === 0) {
    const envUser = process.env.POS_MASTER_ADMIN_USER;
    const envPass = process.env.POS_MASTER_ADMIN_PASS;
    if (envUser && envPass && envPass.length >= 8) {
      registry.master.prepare(`
        INSERT INTO master_users (id, username, password_hash, is_active, created_at)
        VALUES (?, ?, ?, 1, datetime('now'))
      `).run(randomUUID(), String(envUser), hashPassword(envPass));
      console.log(`[server] multi-tenant: seeded master admin "${envUser}" from env`);
    } else {
      console.warn(
        '[server] multi-tenant: master_users table is empty and ' +
        'POS_MASTER_ADMIN_USER/POS_MASTER_ADMIN_PASS are not set. ' +
        'pos:master:login will fail until you seed one (see MIGRATION §7.14).',
      );
    }
  }

  const servicesCache  = createTenantServicesCache({ registry });
  const masterSessions = createMasterSessionStore({ registry });
  const dispatcher     = createMultiTenantDispatcher({
    registry, servicesCache, masterSessions,
    hashPassword, verifyPassword,
  });

  return { registry, servicesCache, masterSessions, dispatcher };
}

function requireSecret() {
  const secret = process.env.POS_HOST_SECRET;
  if (!secret || String(secret).trim().length < 16) {
    console.error(
      '\n[server] POS_HOST_SECRET is missing or too short (<16 chars).\n' +
      '        Generate one with: node -e "console.log(require(\'crypto\').randomUUID())"\n' +
      '        and set it in your .env (and VITE_POS_RPC_SECRET for the frontend).\n'
    );
    process.exit(1);
  }
  return String(secret).trim();
}

async function main() {
  console.log('');
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║           POS SERVER MODE — HTTP RPC bootstrap                ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝');

  const port = parseIntEnv('POS_HOST_PORT', 3333);
  const bind = process.env.POS_HOST_BIND || '0.0.0.0';
  const secret = requireSecret();
  const corsOrigins = parseCsvEnv('POS_CORS_ORIGINS');
  const backupEnabled = parseBoolEnv('POS_BACKUP_ENABLED', true);
  const backupIntervalMin = parseIntEnv('POS_BACKUP_INTERVAL_MIN', 30);
  const backupMax = parseIntEnv('POS_BACKUP_MAX', 30);

  console.log(`[server] bind=${bind} port=${port} cors=${corsOrigins.length ? corsOrigins.join(',') : '*'}`);

  // --------------------------------------------------------------------------
  // Multi-tenant toggle (Bosqich 15)
  // --------------------------------------------------------------------------
  const multiTenantMode = parseBoolEnv('POS_MULTI_TENANT', false);

  const dbModule = require('./db/open.cjs');
  let db = null;
  let services = null;
  let mt = null;

  if (!multiTenantMode) {
    db = dbModule.open();
    const { createServices } = require('./services/index.cjs');
    services = createServices(db);
  } else {
    mt = await bootstrapMultiTenant({ dataDir: userData });
    console.log(
      `[server] multi-tenant: tenants=${mt.registry.listTenants({ includeInactive: true }).length} ` +
      `active=${mt.registry.listTenants().length} master=${mt.registry.masterPath}`,
    );
  }

  const { startHostServer } = require('./net/hostServer.cjs');
  // If POS_METRICS_SECRET is set, use a dedicated bearer for /metrics scrapes.
  // Otherwise Prometheus can reuse POS_HOST_SECRET (which is fine on a private
  // network but NOT ideal for exposing metrics publicly).
  const metricsSecret = process.env.POS_METRICS_SECRET || secret;

  // Security layer (Bosqich 14):
  //  - trustProxy: enable only when nginx/cloudflare terminates TLS for us.
  //  - rateLimit:  override defaults via POS_RATE_LIMIT_* env vars.
  //  - auditLogPath: /var/lib/pos/logs/audit.log by default (under POS_DATA_DIR).
  const trustProxy = parseBoolEnv('POS_TRUST_PROXY', false);
  const rateLimit = {
    rpc: {
      windowMs: parseIntEnv('POS_RATE_LIMIT_RPC_WINDOW_MS', 60_000),
      max: parseIntEnv('POS_RATE_LIMIT_RPC_MAX', 600),
    },
    login: {
      windowMs: parseIntEnv('POS_RATE_LIMIT_LOGIN_WINDOW_MS', 15 * 60_000),
      max: parseIntEnv('POS_RATE_LIMIT_LOGIN_MAX', 10),
    },
  };
  const auditEnabled = parseBoolEnv('POS_AUDIT_ENABLED', true);
  const defaultAuditPath = require('path').join(
    process.env.POS_DATA_DIR || '/var/lib/pos',
    'logs', 'audit.log',
  );
  const auditLogPath = process.env.POS_AUDIT_LOG_PATH || defaultAuditPath;

  console.log(
    `[server] security: trustProxy=${trustProxy} ` +
    `rpcLimit=${rateLimit.rpc.max}/${rateLimit.rpc.windowMs}ms ` +
    `loginLimit=${rateLimit.login.max}/${rateLimit.login.windowMs}ms ` +
    `audit=${auditEnabled ? auditLogPath : 'OFF'}`,
  );

  const handle = startHostServer({
    services,
    db,
    bind,
    port,
    secret,
    metricsSecret,
    corsOrigins,
    trustProxy,
    rateLimit,
    auditLogPath,
    auditEnabled,
    // When multiTenantMode is on, `services`/`db` are null and the host
    // server routes every request through the MT dispatcher instead.
    multiTenant: mt && {
      registry: mt.registry,
      servicesCache: mt.servicesCache,
      masterSessions: mt.masterSessions,
      dispatcher: mt.dispatcher,
    },
  });

  let backupRunner = null;
  if (backupEnabled) {
    try {
      const { createBackupRunner } = require('./services/backupManager.cjs');
      backupRunner = createBackupRunner({
        app,
        intervalMs: backupIntervalMin * 60 * 1000,
        maxBackups: backupMax,
        enabled: true,
        // Pass the tenant registry so the backup runner can iterate EVERY
        // tenant DB when we're in multi-tenant mode. In single-tenant mode
        // the field is null and the runner falls back to legacy behavior.
        tenantRegistry: mt?.registry || null,
      });
      if (typeof backupRunner.start === 'function') backupRunner.start();
      // Expose backupRunner.backupOnce via the `pos:database:backup` RPC
      // channel (admin-only). Only attach in single-tenant mode — in MT
      // mode, the RPC layer opens per-tenant service bags on demand and
      // we don't have a single `services` global here.
      if (services) services.backup = backupRunner;
      console.log(`[server] backup runner: every ${backupIntervalMin}min, keep ${backupMax}`);
    } catch (e) {
      console.warn('[server] backup runner failed to start:', e?.message || e);
    }
  } else {
    console.log('[server] backup runner: DISABLED');
  }

  const shutdown = async (sig) => {
    console.log(`[server] ${sig} received — shutting down…`);
    try {
      if (backupRunner && typeof backupRunner.stop === 'function') backupRunner.stop();
    } catch (_e) {
      // ignore
    }
    try {
      await handle.close();
    } catch (_e) {
      // ignore
    }
    try {
      if (mt && typeof mt.registry.close === 'function') mt.registry.close();
      if (db) dbModule.close();
    } catch (_e) {
      // ignore
    }
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('uncaughtException', (err) => {
    console.error('[server] uncaughtException:', err?.stack || err);
  });
  process.on('unhandledRejection', (reason) => {
    console.error('[server] unhandledRejection:', reason);
  });

  console.log(`[server] ready → http://${bind}:${port}   (health: /health, rpc: POST /rpc)`);
}

main().catch((err) => {
  console.error('[server] fatal:', err?.stack || err);
  process.exit(1);
});

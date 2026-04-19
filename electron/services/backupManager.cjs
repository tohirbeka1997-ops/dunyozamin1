const fs = require('fs');
const path = require('path');

/**
 * Auto-backup manager for SQLite database (pos.db).
 *
 * Goals:
 * - Survive power loss / crashes (restore from recent backup)
 * - Keep backups inside userData for security & portability
 * - Avoid UI freezes (runs in main process, async where possible)
 *
 * Strategy:
 * - Prefer better-sqlite3's online backup API: db.backup(targetPath)
 * - Fallback to file copy if backup API isn't available (should be rare)
 * - Prune old backups (keep latest N)
 */

function pad2(n) {
  return String(n).padStart(2, '0');
}

function timestampForFilename(d = new Date()) {
  // YYYYMMDD-HHMMSS
  return (
    String(d.getFullYear()) +
    pad2(d.getMonth() + 1) +
    pad2(d.getDate()) +
    '-' +
    pad2(d.getHours()) +
    pad2(d.getMinutes()) +
    pad2(d.getSeconds())
  );
}

function safeMkdir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function listBackupFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => /^pos-\d{8}-\d{6}\.db$/i.test(f))
    .map((f) => path.join(dir, f));
}

function pruneBackups(dir, maxBackups) {
  try {
    const files = listBackupFiles(dir)
      .map((p) => ({ p, mtimeMs: fs.statSync(p).mtimeMs }))
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
    const toDelete = files.slice(maxBackups);
    for (const f of toDelete) {
      try {
        fs.unlinkSync(f.p);
      } catch (e) {
        // ignore
      }
    }
  } catch (e) {
    // ignore prune errors
  }
}

function createBackupRunner({
  app,
  intervalMs = 30 * 60 * 1000,
  maxBackups = 30,
  enabled = true,
  // Multi-tenant (Bosqich 15): when provided, the runner iterates every
  // active tenant and writes backups to `<tenantDir>/backups/`. In this
  // mode we do NOT touch the legacy top-level `userData/backups/` path.
  tenantRegistry = null,
} = {}) {
  if (!app) throw new Error('backupManager: Electron app instance is required');

  let timer = null;
  let inFlight = false;

  const getPaths = () => {
    const userData = app.getPath('userData');
    const backupDir = path.join(userData, 'backups');
    safeMkdir(backupDir);
    return { backupDir };
  };

  // Backup ONE tenant (opened DB handle + its on-disk path). Isolated per
  // tenant — a single failure never blocks the remaining tenants.
  const backupDb = async ({ db, dbPath, backupDir, tenantLabel = '' }) => {
    safeMkdir(backupDir);
    const ts = timestampForFilename();
    const target = path.join(backupDir, `pos-${ts}.db`);
    if (db && typeof db.backup === 'function') {
      await db.backup(target);
    } else {
      fs.copyFileSync(dbPath, target);
    }
    pruneBackups(backupDir, maxBackups);
    const prefix = tenantLabel ? `[${tenantLabel}] ` : '';
    console.log(`[Backup] ✅ ${prefix}backup created: ${target}`);
    return target;
  };

  const backupOnce = async (reason = 'scheduled') => {
    if (!enabled) return { skipped: true, reason: 'disabled' };
    if (inFlight) return { skipped: true, reason: 'in_flight' };
    inFlight = true;

    try {
      // --- Multi-tenant branch ----------------------------------------------
      if (tenantRegistry) {
        const tenants = tenantRegistry.listTenants();   // active only
        const outcomes = [];
        for (const t of tenants) {
          try {
            const db = tenantRegistry.openTenantDb(t.id);
            const tenantDir = path.dirname(t.db_path);
            const backupDir = path.join(tenantDir, 'backups');
            const target = await backupDb({
              db, dbPath: t.db_path, backupDir, tenantLabel: t.slug,
            });
            outcomes.push({ tenant: t.slug, ok: true, path: target });
          } catch (e) {
            console.error(`[Backup] ❌ tenant ${t.slug} failed:`, e?.message || e);
            outcomes.push({ tenant: t.slug, ok: false, error: e?.message || String(e) });
          }
        }
        return { ok: outcomes.every((o) => o.ok), tenants: outcomes };
      }

      // --- Single-tenant branch (legacy) -----------------------------------
      const { backupDir } = getPaths();
      const { getDb, getDbPath } = require('../db/open.cjs');
      const db = getDb();
      const dbPath = getDbPath();
      const target = await backupDb({ db, dbPath, backupDir });
      return { ok: true, path: target };
    } catch (e) {
      console.error('[Backup] ❌ Backup failed:', e);
      return { ok: false, error: e?.message || String(e) };
    } finally {
      inFlight = false;
    }
  };

  const start = () => {
    if (!enabled) return;
    if (timer) return;
    timer = setInterval(() => {
      backupOnce('scheduled').catch(() => {});
    }, intervalMs);
    // Don't keep the process alive just for the timer
    if (typeof timer.unref === 'function') timer.unref();
    console.log(`[Backup] 🕒 Auto-backup enabled: every ${Math.round(intervalMs / 60000)} min, keep ${maxBackups}`);
  };

  const stop = () => {
    if (timer) clearInterval(timer);
    timer = null;
  };

  return { start, stop, backupOnce };
}

module.exports = { createBackupRunner };
























const fs = require('fs');
const path = require('path');
const { getDbPath, assertDbPathSafe, getUserDataPath, listDatabaseCandidates } = require('../db/dbPath.cjs');

function getResetFlagPath(app) {
  const userData = getUserDataPath(app);
  return path.join(userData, 'reset-db.flag.json');
}

function hasResetFlag(app) {
  try {
    return fs.existsSync(getResetFlagPath(app));
  } catch {
    return false;
  }
}

function scheduleDbReset(app, meta = {}) {
  const userData = getUserDataPath(app);
  if (!userData) throw new Error('userData path not available');
  if (!fs.existsSync(userData)) fs.mkdirSync(userData, { recursive: true });

  const flagPath = getResetFlagPath(app);
  const payload = {
    scheduledAt: new Date().toISOString(),
    meta: meta || {},
  };
  fs.writeFileSync(flagPath, JSON.stringify(payload, null, 2), 'utf8');
  return flagPath;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function safeDeleteFile(filePath, { attempts = 8, baseDelayMs = 40 } = {}) {
  for (let i = 0; i < attempts; i++) {
    try {
      if (!fs.existsSync(filePath)) return { ok: true, deleted: false };
      fs.unlinkSync(filePath);
      return { ok: true, deleted: true };
    } catch (e) {
      const code = e?.code;
      // Windows often throws EPERM/EBUSY/EACCES for recently closed sqlite files
      const retryable = code === 'EBUSY' || code === 'EPERM' || code === 'EACCES';
      if (!retryable || i === attempts - 1) {
        return { ok: false, error: e };
      }
      await sleep(baseDelayMs * Math.pow(2, i));
    }
  }
  return { ok: false, error: new Error('Unknown delete failure') };
}

async function safeRenameFileIfExists(filePath, suffix, { attempts = 8, baseDelayMs = 40 } = {}) {
  for (let i = 0; i < attempts; i++) {
    try {
      if (!fs.existsSync(filePath)) return null;
      const dir = path.dirname(filePath);
      const base = path.basename(filePath);
      const renamed = path.join(dir, `${base}.${suffix}.bak`);
      fs.renameSync(filePath, renamed);
      return renamed;
    } catch (e) {
      const code = e?.code;
      const retryable = code === 'EBUSY' || code === 'EPERM' || code === 'EACCES';
      if (!retryable || i === attempts - 1) return null;
      await sleep(baseDelayMs * Math.pow(2, i));
    }
  }
  return null;
}

/**
 * Perform a pending database reset BEFORE the DB is opened.
 * This is the most reliable approach on Windows to avoid EBUSY locks.
 *
 * @returns {Promise<{performed: boolean, deleted: string[], renamed: string[]}>}
 */
async function performPendingDbReset(app) {
  const argvWantsReset = process.argv.includes('--reset-db') || process.argv.includes('--resetDatabase');
  const flagPath = getResetFlagPath(app);
  const flagExists = hasResetFlag(app);

  if (!argvWantsReset && !flagExists) {
    return { performed: false, deleted: [], renamed: [] };
  }

  // If we were relaunched immediately after scheduling a reset, the previous instance
  // may still be shutting down and keeping file handles open (Windows). Give it time.
  await sleep(1500);

  const userDataPath = getUserDataPath(app);
  const assertPathInsideUserData = (filePath) => {
    const resolvedFile = path.resolve(filePath);
    const resolvedUserData = path.resolve(userDataPath);
    const rel = path.relative(resolvedUserData, resolvedFile);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error(`SECURITY: Refusing to delete file outside userData: ${filePath}`);
    }
  };

  // Best-effort close (in case any module opened DB early)
  try {
    const { close } = require('../db/open.cjs');
    close();
  } catch {}

  const dbPath = getDbPath(app);
  assertDbPathSafe(dbPath, app);

  // Delete canonical DB and any legacy .db files that may exist in userData from older builds.
  const candidates = listDatabaseCandidates(app).map((c) => c.path);
  const knownLegacy = [
    path.join(userDataPath, 'pos-database.db'),
    path.join(userDataPath, 'pos.legacy.db'),
    path.join(userDataPath, 'pos.dev.db'),
  ];
  const dbFiles = Array.from(new Set([dbPath, ...candidates, ...knownLegacy]));
  const filesToDelete = [];
  for (const f of dbFiles) {
    filesToDelete.push(f, f + '-wal', f + '-shm', f + '-journal');
  }

  const deleted = [];
  const renamed = [];
  const suffix = Date.now();

  for (const f of filesToDelete) {
    try {
      assertPathInsideUserData(f);
      const r = await safeDeleteFile(f, { attempts: 12, baseDelayMs: 100 });
      if (r.ok) {
        if (r.deleted) deleted.push(f);
        continue;
      }

      // If we still can't delete, rename it out of the way so a fresh DB can be created.
      const renamedTo = await safeRenameFileIfExists(f, suffix, { attempts: 12, baseDelayMs: 100 });
      if (renamedTo) {
        renamed.push(renamedTo);
        continue;
      }

      // Last resort: throw for visibility (flag will remain so user can retry)
      const msg = r.error?.message || String(r.error);
      throw new Error(`Failed to delete DB file: ${f}. ${msg}`);
    } catch (e) {
      // Keep flag for next run; surface error in logs
      console.error('[DBReset] Failed during pending reset:', e?.message || e);
      throw e;
    }
  }

  // Clear the flag (reset performed)
  try {
    if (fs.existsSync(flagPath)) fs.unlinkSync(flagPath);
  } catch {}

  return { performed: true, deleted, renamed };
}

module.exports = {
  getResetFlagPath,
  hasResetFlag,
  scheduleDbReset,
  performPendingDbReset,
};


'use strict';

const { randomUUID } = require('crypto');

const LOCK_NAME = 'payment_reminder_scheduler';
const DEFAULT_TTL_MS = 90_000;

/**
 * Try to acquire a DB-backed scheduler lock. Only the holder should run tick work.
 * Returns false when another instance holds a non-expired lock.
 */
function tryAcquireSchedulerLock(db, options = {}) {
  const lockName = options.name || LOCK_NAME;
  const ttlMs = Number(options.ttlMs) > 0 ? Number(options.ttlMs) : DEFAULT_TTL_MS;
  const owner = options.owner || randomUUID();
  const now = new Date();
  const nowIso = now.toISOString();
  const untilIso = new Date(now.getTime() + ttlMs).toISOString();

  const tx = db.transaction(() => {
    const row = db.prepare('SELECT locked_until, locked_by FROM scheduler_locks WHERE name = ?').get(lockName);
    if (!row || String(row.locked_until) <= nowIso) {
      db.prepare(
        `INSERT INTO scheduler_locks (name, locked_until, locked_by)
         VALUES (?, ?, ?)
         ON CONFLICT(name) DO UPDATE SET locked_until = excluded.locked_until, locked_by = excluded.locked_by`,
      ).run(lockName, untilIso, owner);
      return true;
    }
    return String(row.locked_by) === owner;
  });

  return tx() ? owner : null;
}

function shouldRunScheduler() {
  const flag = String(process.env.PUBLIC_API_RUN_SCHEDULER || '').trim().toLowerCase();
  if (flag === '0' || flag === 'false' || flag === 'no') return false;
  return true;
}

module.exports = {
  LOCK_NAME,
  tryAcquireSchedulerLock,
  shouldRunScheduler,
};

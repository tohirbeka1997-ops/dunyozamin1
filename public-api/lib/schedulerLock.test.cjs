'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { runMigrations } = require('../../electron/db/migrate.cjs');
const { tryAcquireSchedulerLock, shouldRunScheduler } = require('./schedulerLock.cjs');

function withTempDb(fn) {
  const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'scheduler-lock-'));
  const dbPath = path.join(tmpDir, 'pos.db');
  const db = new Database(dbPath);
  runMigrations(db);
  return Promise.resolve()
    .then(() => fn(db))
    .finally(() => {
      db.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });
}

test('tryAcquireSchedulerLock allows only one owner at a time', () =>
  withTempDb((db) => {
    const ownerA = 'instance-a';
    const ownerB = 'instance-b';

    const first = tryAcquireSchedulerLock(db, { owner: ownerA, ttlMs: 60_000 });
    assert.equal(first, ownerA);

    const second = tryAcquireSchedulerLock(db, { owner: ownerB, ttlMs: 60_000 });
    assert.equal(second, null);

    const renew = tryAcquireSchedulerLock(db, { owner: ownerA, ttlMs: 60_000 });
    assert.equal(renew, ownerA);
  }));

test('tryAcquireSchedulerLock grants lock after expiry', () =>
  withTempDb((db) => {
    const ownerA = 'instance-a';
    const ownerB = 'instance-b';

    db.prepare(
      `INSERT INTO scheduler_locks (name, locked_until, locked_by) VALUES ('payment_reminder_scheduler', datetime('now', '-1 minute'), ?)`,
    ).run(ownerA);

    const acquired = tryAcquireSchedulerLock(db, { owner: ownerB, ttlMs: 60_000 });
    assert.equal(acquired, ownerB);
  }));

test('shouldRunScheduler respects PUBLIC_API_RUN_SCHEDULER=0', () => {
  const prev = process.env.PUBLIC_API_RUN_SCHEDULER;
  process.env.PUBLIC_API_RUN_SCHEDULER = '0';
  try {
    assert.equal(shouldRunScheduler(), false);
  } finally {
    if (prev === undefined) delete process.env.PUBLIC_API_RUN_SCHEDULER;
    else process.env.PUBLIC_API_RUN_SCHEDULER = prev;
  }
});

/**
 * Legacy DB entrypoint (TypeScript) — unified to canonical DB.
 *
 * IMPORTANT:
 * This file used to open `pos-database.db` directly. That caused multiple DB files
 * in userData and “data remaining after reset” issues.
 *
 * Now it delegates to the canonical implementation in `electron/db/open.cjs`
 * which ALWAYS uses `<userData>/pos.db`.
 */

import type Database from 'better-sqlite3';

export function getDb(): Database.Database {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { getDb } = require('./open.cjs');
  return getDb();
}

export function closeDb(): void {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { close } = require('./open.cjs');
  close();
}

export function getDbPath(): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { getDbPath } = require('./open.cjs');
  return getDbPath();
}


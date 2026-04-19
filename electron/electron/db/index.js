"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDb = getDb;
exports.closeDb = closeDb;
exports.getDbPath = getDbPath;
function getDb() {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getDb } = require('./open.cjs');
    return getDb();
}
function closeDb() {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { close } = require('./open.cjs');
    close();
}
function getDbPath() {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getDbPath } = require('./open.cjs');
    return getDbPath();
}

"use strict";
/**
 * Legacy DB entrypoint (compiled JS) — unified to canonical DB.
 *
 * This file used to open `pos-database.db`. It now delegates to `open.cjs`
 * which ALWAYS uses `<userData>/pos.db`.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDbPath = exports.closeDb = exports.getDb = void 0;
function getDb() {
    // Delegate to canonical DB connection
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getDb } = require("./open.cjs");
    return getDb();
}
exports.getDb = getDb;
function closeDb() {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { close } = require("./open.cjs");
    return close();
}
exports.closeDb = closeDb;
function getDbPath() {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getDbPath } = require("./open.cjs");
    return getDbPath();
}
exports.getDbPath = getDbPath;

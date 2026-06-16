'use strict';

const fs = require('fs');
const Database = require('better-sqlite3');
const { resolvePosDbPath } = require('../../electron/lib/resolvePosDbPath.cjs');

let dbInstance = null;

/** Same rules as POS server + migrate-pos-db (see resolvePosDbPath.cjs). */
function resolveDbPath() {
  return resolvePosDbPath();
}

function openDatabase() {
  if (dbInstance) return dbInstance;

  const filePath = resolveDbPath();
  if (!fs.existsSync(filePath)) {
    const err = new Error(`Database file not found: ${filePath}`);
    err.code = 'DB_NOT_FOUND';
    throw err;
  }

  const db = new Database(filePath);
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  dbInstance = db;
  return db;
}

function getDb() {
  return openDatabase();
}

module.exports = { getDb, resolveDbPath, openDatabase };

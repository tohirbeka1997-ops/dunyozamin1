'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

let dbInstance = null;

/**
 * PUBLIC_API_DB_PATH — to'g'ridan-to'g'ri pos.db ga yo'l
 * yoki POS_DATA_DIR/pos.db (POS server bilan bir xil qoida)
 */
function resolveDbPath() {
  const explicit = process.env.PUBLIC_API_DB_PATH && String(process.env.PUBLIC_API_DB_PATH).trim();
  if (explicit) return path.resolve(explicit);

  const dataDir = process.env.POS_DATA_DIR && String(process.env.POS_DATA_DIR).trim();
  if (dataDir) return path.join(path.resolve(dataDir), 'pos.db');

  return path.join(process.cwd(), 'pos.db');
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

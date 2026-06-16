#!/usr/bin/env node
'use strict';
/**
 * Reset default admin password in the local Electron pos.db (host mode DB).
 * Usage: npm run electron -- scripts/reset-admin-password.cjs
 * Env: ADMIN_IDENTIFIER (default admin@pos.com), ADMIN_PASSWORD (default 12345)
 */
const { app } = require('electron');
const Database = require('better-sqlite3');
const { getDbPath, assertDbPathSafe, clearCache } = require('../electron/db/dbPath.cjs');
const { hashPassword } = require('../electron/lib/password.cjs');
const AuthService = require('../electron/services/authService.cjs');

const IDENT = String(process.env.ADMIN_IDENTIFIER || 'admin@pos.com').trim().toLowerCase();
const PASSWORD = String(process.env.ADMIN_PASSWORD || '12345');

function run() {
  clearCache();
  const dbPath = getDbPath(app);
  assertDbPathSafe(dbPath, app);
  console.log('[reset-admin] DB:', dbPath);
  const db = new Database(dbPath);
  const row = db.prepare(
    'SELECT id, username, email FROM users WHERE LOWER(username) = ? OR LOWER(email) = ?'
  ).get(IDENT, IDENT);
  if (!row) {
    console.error('[reset-admin] User not found:', IDENT);
    db.close();
    process.exitCode = 1;
    return;
  }
  const hash = hashPassword(PASSWORD);
  db.prepare(
    'UPDATE users SET password_hash = ?, is_active = 1, updated_at = ? WHERE id = ?'
  ).run(hash, new Date().toISOString(), row.id);
  const auth = new AuthService(db);
  const check = auth.login(row.username || IDENT, PASSWORD);
  db.close();
  if (!check.success) {
    console.error('[reset-admin] Verify failed:', check.error);
    process.exitCode = 1;
    return;
  }
  console.log('[reset-admin] OK login as', check.user.username, 'role=', check.user.role);
  console.log('[reset-admin] Use:', row.username || IDENT, '/', PASSWORD);
  setTimeout(() => app.quit(), 100);
}

if (app.isReady()) run();
else app.once('ready', run);

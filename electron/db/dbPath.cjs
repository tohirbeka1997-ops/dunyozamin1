/**
 * Database Path Management Module (PRODUCTION-GRADE)
 * 
 * CRITICAL: This module enforces a SINGLE canonical database path.
 * NO dev/prod split. NO fallbacks. NO overrides. NO legacy files.
 * 
 * CANONICAL PATH:
 * - ALWAYS: <userData>/pos.db
 * - NEVER: pos.dev.db, pos.legacy.db, or any other variants
 * 
 * SECURITY:
 * - Database can ONLY be opened from userData directory
 * - Any attempt to use a database outside userData will fail-fast
 * - All env vars, CLI args, config overrides are IGNORED
 * - Filename MUST be exactly 'pos.db'
 */

const path = require('path');
const fs = require('fs');
const { getAppLike, isServerMode } = require('../lib/runtime.cjs');

let cachedDbPath = null;
let cachedUserDataPath = null;

/**
 * Resolve the Electron `app` (or server shim). We don't destructure `electron`
 * at module load because Electron is absent in server mode.
 */
function resolveApp(override) {
  return getAppLike(override || null);
}

/**
 * Get the SINGLE canonical database file path
 * 
 * PRODUCTION RULE: ALWAYS returns pos.db (NO dev/prod distinction)
 * 
 * @param {Electron.App} electronApp - Electron app instance (required)
 * @returns {string} Canonical database file path (ALWAYS pos.db)
 * @throws {Error} If app is not provided or not ready
 */
function getDbPath(electronApp = null) {
  const appInstance = resolveApp(electronApp);

  if (!appInstance) {
    throw new Error('SECURITY: app instance (Electron or server shim) is required to determine database path');
  }

  if (cachedDbPath) {
    return cachedDbPath;
  }

  if (!cachedUserDataPath) {
    try {
      cachedUserDataPath = appInstance.getPath('userData');
    } catch (error) {
      throw new Error(`SECURITY: Failed to get userData path: ${error.message}`);
    }
  }

  // SINGLE CANONICAL PATH: ALWAYS pos.db (no dev/prod split)
  cachedDbPath = path.join(cachedUserDataPath, 'pos.db');
  return cachedDbPath;
}


/**
 * Get userData path (cached)
 * @param {Electron.App} electronApp - Electron app instance
 * @returns {string} UserData directory path
 */
function getUserDataPath(electronApp = null) {
  const appInstance = resolveApp(electronApp);
  if (!cachedUserDataPath && appInstance) {
    cachedUserDataPath = appInstance.getPath('userData');
  }
  return cachedUserDataPath;
}

/**
 * Assert that a database path is safe (inside userData directory)
 * 
 * @param {string} dbPath - Database file path to validate
 * @param {Electron.App} electronApp - Electron app instance (required)
 * @throws {Error} SECURITY error with clear message if path is unsafe
 */
function assertDbPathSafe(dbPath, electronApp = null) {
  const appInstance = resolveApp(electronApp);

  if (!appInstance) {
    throw new Error('SECURITY: app instance (Electron or server shim) is required for path validation');
  }
  
  if (!dbPath || typeof dbPath !== 'string') {
    throw new Error('SECURITY: Database path must be a non-empty string');
  }
  
  const userDataPath = getUserDataPath(appInstance);
  const resolvedDbPath = path.resolve(dbPath);
  const resolvedUserDataPath = path.resolve(userDataPath);
  const relativePath = path.relative(resolvedUserDataPath, resolvedDbPath);
  
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    console.error('');
    console.error('═══════════════════════════════════════════════════════════════');
    console.error('🚨 SECURITY VIOLATION: Database Path Outside userData');
    console.error('═══════════════════════════════════════════════════════════════');
    console.error('Requested DB path:', dbPath);
    console.error('Canonical userData:', userDataPath);
    console.error('SECURITY: DB path is not inside userData. Refusing to start.');
    console.error('═══════════════════════════════════════════════════════════════');
    process.exit(1);
  }
  
  // Additional check: Ensure it's pos.db (not pos.dev.db or other variants)
  const filename = path.basename(resolvedDbPath);
  if (filename !== 'pos.db') {
    console.error('');
    console.error('═══════════════════════════════════════════════════════════════');
    console.error('🚨 INVALID DATABASE FILENAME');
    console.error('═══════════════════════════════════════════════════════════════');
    console.error('Requested DB file:', filename);
    console.error('Canonical DB file must be: pos.db');
    console.error('SECURITY: Only pos.db is allowed. Refusing to start.');
    console.error('═══════════════════════════════════════════════════════════════');
    process.exit(1);
  }
}


/**
 * Clear cached paths (useful for testing)
 */
function clearCache() {
  cachedDbPath = null;
  cachedUserDataPath = null;
}

/**
 * List database file candidates in userData directory.
 * Helpful for diagnostics and migrations.
 *
 * @returns {Array<{name: string, path: string, size: number, modified: Date}>}
 */
function listDatabaseCandidates(electronApp = null) {
  const appInstance = resolveApp(electronApp);
  const userDataPath = getUserDataPath(appInstance);
  if (!userDataPath) return [];

  try {
    const files = fs.readdirSync(userDataPath);
    const dbFiles = files.filter((f) => /\.db$/i.test(f) || /^pos(\..+)?\.db$/i.test(f));
    return dbFiles
      .map((name) => {
        const fullPath = path.join(userDataPath, name);
        try {
          const stat = fs.statSync(fullPath);
          return { name, path: fullPath, size: stat.size, modified: stat.mtime };
        } catch (e) {
          return null;
        }
      })
      .filter(Boolean);
  } catch (e) {
    return [];
  }
}

module.exports = {
  getDbPath,
  getUserDataPath,
  assertDbPathSafe,
  listDatabaseCandidates,
  clearCache,
};

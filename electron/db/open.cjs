const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { getAppLike } = require('../lib/runtime.cjs');
const {
  getDbPath,
  assertDbPathSafe,
  getUserDataPath,
} = require('./dbPath.cjs');

const app = getAppLike();

let db = null;
let cachedDbPath = null;

/**
 * Get the canonical database file path
 * 
 * PRODUCTION RULE: ALWAYS returns pos.db in userData
 * 
 * @returns {string} Canonical database file path (inside userData)
 * @throws {Error} If app is not ready or path validation fails
 */
function getDbPathInternal() {
  if (cachedDbPath) {
    return cachedDbPath;
  }
  
  // Get canonical path (ALWAYS pos.db)
  cachedDbPath = getDbPath(app);
  
  // Validate path is safe (inside userData) - fail-fast if not
  assertDbPathSafe(cachedDbPath, app);
  
  // Ensure directory exists
  const dbDir = path.dirname(cachedDbPath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }
  
  const userDataPath = getUserDataPath(app);
  
  // Database path logging
  console.log('');
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║           📁 DATABASE PATH INFORMATION                        ║');
  console.log('╠═══════════════════════════════════════════════════════════════╣');
  console.log('║ DB File:    ' + cachedDbPath);
  console.log('║ UserData:   ' + userDataPath);
  console.log('╚═══════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log('🔒 SECURITY: Database path is validated and locked to userData.');
  console.log('📋 Journal mode: DELETE (WAL disabled for production stability)');
  console.log('');
  
  return cachedDbPath;
}

/**
 * Open SQLite database with production-ready settings
 * 
 * CRITICAL PRODUCTION RULES:
 * 1. ALWAYS uses pos.db (single canonical path, no dev/prod split)
 * 2. WAL mode is DISABLED (journal_mode = DELETE)
 * 3. Runs migrations BEFORE returning DB
 * 4. NEVER uses legacy databases (pos.legacy.db, pos.dev.db)
 * 5. NEVER recreates DB silently
 * 
 * @param {string} [ignoredPath] - IGNORED for security (database MUST be in userData)
 * @returns {Database} Database instance
 * @throws {Error} If path is outside userData or database open fails
 */
function open(ignoredPath = null) {
  if (db) {
    console.log('Database already open, reusing connection');
    return db;
  }

  // SECURITY: Always use canonical path (ignore any passed parameter)
  const filePath = getDbPathInternal();
  
  // SECURITY: Validate path is safe (fail-fast if not)
  assertDbPathSafe(filePath, app);
  
  const dbExists = fs.existsSync(filePath);
  
  console.log('');
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║           🗄️  DATABASE INITIALIZATION                          ║');
  console.log('╠═══════════════════════════════════════════════════════════════╣');
  console.log('');
  console.log(`📄 Database: ${filePath}`);
  console.log(`   Exists: ${dbExists ? '✅ Yes' : '❌ No (will be created)'}`);
  console.log('');

  try {
    // Open database (creates if doesn't exist)
    console.log('🔌 Opening database...');
    db = new Database(filePath);
    console.log('✅ Database opened successfully');

    // CRITICAL: Disable WAL mode (DELETE mode for production stability)
    // WAL mode causes phantom data: data appears while app is open but disappears after close
    // This happens because WAL files are not properly checkpointed or are lost
    // DELETE mode is safer for single-writer desktop applications
    console.log('⚙️  Configuring database pragmas...');
    db.pragma('journal_mode = DELETE'); // DELETE mode (NOT WAL) for production stability
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');
    db.pragma('synchronous = NORMAL');
    db.pragma('temp_store = MEMORY');
    db.pragma('cache_size = -20000'); // ~20MB
    db.pragma('mmap_size = 268435456'); // 256MB
    
    const journalMode = db.pragma('journal_mode', { simple: true });
    if (journalMode !== 'delete') {
      console.error('');
      console.error('🚨 CRITICAL: Journal mode is not DELETE!');
      console.error(`   Current mode: ${journalMode}`);
      console.error('   This can cause data loss. Fixing...');
      db.pragma('journal_mode = DELETE');
      console.error('   ✅ Fixed to DELETE mode');
      console.error('');
    }

    console.log('✅ Pragmas configured:');
    console.log('   journal_mode: DELETE (WAL disabled)');
    console.log('   foreign_keys: ON');
    console.log('   busy_timeout: 5000ms');
    console.log('   synchronous: NORMAL');
    console.log('   temp_store: MEMORY');
    console.log('   cache_size: -20000');
    console.log('   mmap_size: 268435456');
    console.log('');

    // SQL timing instrumentation (best-effort)
    if (!db.__perfWrapped) {
      db.__perfWrapped = true;
      const originalPrepare = db.prepare.bind(db);
      db.prepare = (sql) => {
        const stmt = originalPrepare(sql);
        const wrap = (method) => {
          const original = typeof stmt[method] === 'function'
            ? stmt[method].bind(stmt)
            : null;
          if (!original) return null;
          return (...args) => {
            const start = process.hrtime.bigint();
            const res = original(...args);
            const end = process.hrtime.bigint();
          const ms = Number(end - start) / 1e6;
          const compactSql = String(sql || '').replace(/\s+/g, ' ').trim().slice(0, 140);
          let extra = '';
          if (Array.isArray(res)) extra = ` | rows=${res.length}`;
          else if (res && typeof res === 'object' && 'changes' in res) extra = ` | changes=${res.changes}`;
          console.log(`[SQL] ${method} ${Math.round(ms)}ms | ${compactSql}${extra}`);
          return res;
          };
        };
        const runWrapped = wrap('run');
        const getWrapped = wrap('get');
        const allWrapped = wrap('all');
        const iterateWrapped = wrap('iterate');
        if (runWrapped) stmt.run = runWrapped;
        if (getWrapped) stmt.get = getWrapped;
        if (allWrapped) stmt.all = allWrapped;
        if (iterateWrapped) stmt.iterate = iterateWrapped;
        return stmt;
      };
    }

    // Run integrity check on first run only (can be slow)
    if (!dbExists) {
      try {
        console.log('🔍 Running integrity check on new database...');
        const integrityResult = db.pragma('integrity_check', { simple: true });
        if (integrityResult === 'ok') {
          console.log('   ✅ Integrity check passed');
        } else {
          console.warn('   ⚠️  Integrity check warnings:', integrityResult);
        }
        console.log('');
      } catch (error) {
        console.warn('   ⚠️  Could not run integrity check:', error.message);
        console.log('');
      }
    }

    // CRITICAL: Run migrations BEFORE any other operations
    console.log('🔄 Running migrations...');
    const { runMigrations } = require('./migrate.cjs');
    const migrationResult = runMigrations(db);
    console.log(`✅ Migrations complete (${migrationResult.applied} applied, ${migrationResult.skipped} skipped)`);
    console.log('');

    // Test database connection
    try {
      const testResult = db.prepare('SELECT 1 as test').get();
      console.log('✅ Database connection test passed');
    } catch (testError) {
      console.error('⚠️  Database connection test failed:', testError.message);
      throw testError;
    }

    console.log('╚═══════════════════════════════════════════════════════════════╝');
    console.log('');

    return db;
  } catch (error) {
    console.error('❌ Failed to open database:', error.message);
    
    // Check for NODE_MODULE_VERSION mismatch
    if (error.message && (
      error.message.includes('NODE_MODULE_VERSION') ||
      error.message.includes('module version') ||
      error.message.includes('was compiled against') ||
      error.message.includes('Cannot find module')
    )) {
      console.error('');
      console.error('═══════════════════════════════════════════════════════════');
      console.error('⚠️  NATIVE MODULE MISMATCH DETECTED');
      console.error('═══════════════════════════════════════════════════════════');
      console.error('The better-sqlite3 module needs to be rebuilt for your Electron version.');
      console.error('');
      console.error('To fix this, run:');
      console.error('  npm run rebuild:electron');
      console.error('');
      console.error('Or manually:');
      console.error('  npx electron-rebuild -f -w better-sqlite3');
      console.error('═══════════════════════════════════════════════════════════');
      console.error('');
    }
    
    throw error;
  }
}

/**
 * Get database instance (opens if not already open)
 * @returns {Database} Database instance
 */
function getDb() {
  if (!db) {
    return open();
  }
  return db;
}

/**
 * Close database connection
 */
function close() {
  if (db) {
    try {
      db.close();
      console.log('Database closed');
    } catch (error) {
      console.error('Error closing database:', error);
    } finally {
      db = null;
    }
  }
}

/**
 * Check if database is open
 * @returns {boolean} True if database is open
 */
function isOpen() {
  return db !== null;
}

module.exports = {
  open,
  getDb,
  close,
  isOpen,
  getDbPath: getDbPathInternal,
};

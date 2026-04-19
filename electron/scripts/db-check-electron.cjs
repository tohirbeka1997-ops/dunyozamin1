/**
 * Database Check Script (Electron Runtime)
 * 
 * Checks either new or legacy database:
 * - Lists tables and views
 * - Shows row counts
 * - Shows applied migrations
 * - Shows database configuration
 * 
 * Usage: 
 *   npm run db:check:new (checks pos.db)
 *   npm run db:check:legacy (checks pos.legacy.db)
 */

const { app } = require('electron');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Get database type from command line or default to 'new'
const dbType = process.argv[2] === 'legacy' ? 'legacy' : 'new';

function checkDatabase() {
  console.log('');
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log(`║              DATABASE CHECK (${dbType.toUpperCase()})                        ║`);
  console.log('╠═══════════════════════════════════════════════════════════════╣');
  console.log('');
  
  try {
    const userDataPath = app.getPath('userData');
    let dbPath;
    
    if (dbType === 'legacy') {
      const { getLegacyDbPath } = require('../db/dbPath.cjs');
      dbPath = getLegacyDbPath(app);
    } else {
      const { getNewDbPath } = require('../db/dbPath.cjs');
      dbPath = getNewDbPath(app);
    }
    
    console.log('📁 UserData Directory:');
    console.log('   ' + userDataPath);
    console.log('');
    console.log('📄 Database File:');
    console.log('   ' + dbPath);
    console.log('');
    
    if (!fs.existsSync(dbPath)) {
      console.log('❌ Database file does not exist');
      console.log('');
      return;
    }
    
    const stat = fs.statSync(dbPath);
    console.log('   ✅ EXISTS');
    console.log('   Size: ' + (stat.size / 1024).toFixed(2) + ' KB');
    console.log('   Modified: ' + stat.mtime.toISOString());
    console.log('');
    
    // Open database
    const options = dbType === 'legacy' 
      ? { readonly: true, fileMustExist: true }
      : { fileMustExist: true };
    
    const db = new Database(dbPath, options);
    
    if (dbType === 'legacy') {
      db.pragma('query_only = ON');
    }
    
    // Get tables and views
    const schemaObjects = db.prepare(`
      SELECT name, type 
      FROM sqlite_master 
      WHERE type IN ('table', 'view') 
        AND name NOT LIKE 'sqlite_%'
      ORDER BY type, name
    `).all();
    
    console.log('📊 Database Schema:');
    console.log('');
    
    const tables = schemaObjects.filter(obj => obj.type === 'table');
    const views = schemaObjects.filter(obj => obj.type === 'view');
    
    console.log('   Tables (' + tables.length + '):');
    if (tables.length === 0) {
      console.log('      (none)');
    } else {
      tables.forEach(t => {
        try {
          const count = db.prepare(`SELECT COUNT(*) as count FROM ${t.name}`).get().count;
          console.log(`      ${t.name.padEnd(30)} ${String(count).padStart(8)} rows`);
        } catch (error) {
          console.log(`      ${t.name.padEnd(30)} (error: ${error.message})`);
        }
      });
    }
    
    console.log('');
    console.log('   Views (' + views.length + '):');
    if (views.length === 0) {
      console.log('      (none)');
    } else {
      views.forEach(v => console.log(`      ${v.name}`));
    }
    console.log('');
    
    // Check migrations (only for new DB)
    if (dbType === 'new') {
      try {
        const migrations = db.prepare(`
          SELECT id, applied_at 
          FROM schema_migrations 
          ORDER BY id
        `).all();
        
        console.log('🔄 Applied Migrations:');
        if (migrations.length === 0) {
          console.log('   (none)');
        } else {
          console.log(`   Total: ${migrations.length}`);
          migrations.slice(0, 10).forEach(m => {
            console.log(`   ✓ ${m.id.padEnd(35)} ${m.applied_at}`);
          });
          if (migrations.length > 10) {
            console.log(`   ... and ${migrations.length - 10} more`);
          }
        }
        console.log('');
      } catch (error) {
        console.log('🔄 Applied Migrations:');
        console.log('   ⚠️  Could not read schema_migrations table');
        console.log('');
      }
    }
    
    // Check database configuration
    console.log('⚙️  Database Configuration:');
    const pragmas = {
      'journal_mode': db.pragma('journal_mode', { simple: true }),
      'foreign_keys': db.pragma('foreign_keys', { simple: true }),
      'busy_timeout': db.pragma('busy_timeout', { simple: true }),
      'synchronous': db.pragma('synchronous', { simple: true }),
    };
    
    for (const [key, value] of Object.entries(pragmas)) {
      console.log(`   ${key.padEnd(20)} ${value}`);
    }
    console.log('');
    
    // Check initialization status (new DB only)
    if (dbType === 'new') {
      try {
        const { isNewDbInitialized } = require('../db/dbPath.cjs');
        const initialized = isNewDbInitialized(db);
        console.log('📋 Initialization Status:');
        console.log('   ' + (initialized ? '✅ Initialized' : '⚠️  Not initialized'));
        console.log('');
      } catch (error) {
        // Ignore
      }
    }
    
    db.close();
    console.log('✅ Database check completed');
    console.log('');
    console.log('╚═══════════════════════════════════════════════════════════════╝');
    console.log('');
    
  } catch (error) {
    console.error('');
    console.error('❌ Database check failed:');
    console.error('   ' + error.message);
    if (error.stack) {
      console.error('');
      console.error('Stack trace:');
      console.error(error.stack);
    }
    console.error('');
    process.exit(1);
  }
}

// Run check when Electron app is ready
if (app.isReady()) {
  checkDatabase();
  setTimeout(() => app.quit(), 500);
} else {
  app.once('ready', () => {
    checkDatabase();
    setTimeout(() => app.quit(), 500);
  });
}

module.exports = checkDatabase;





































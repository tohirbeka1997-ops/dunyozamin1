/**
 * Database Check Script
 * 
 * This script uses Electron runtime (NOT system Node) to check:
 * - Canonical database path
 * - UserData directory
 * - Table counts for all major tables
 * 
 * Usage: npm run db:check
 * 
 * NOTE: This MUST run via Electron to ensure better-sqlite3 ABI compatibility
 * and to access the correct database path using app.getPath('userData').
 */

const { app } = require('electron');
const Database = require('better-sqlite3');
const { getDbPath, getUserDataPath, assertDbPathSafe } = require('../db/dbPath.cjs');

function checkDatabase() {
  console.log('');
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║                  DATABASE HEALTH CHECK                         ║');
  console.log('╠═══════════════════════════════════════════════════════════════╣');
  console.log('');
  
  try {
    // Get canonical paths
    const userDataPath = getUserDataPath(app);
    const dbPath = getDbPath(app);
    
    console.log('📁 UserData Directory:');
    console.log('   ' + userDataPath);
    console.log('');
    console.log('📄 Database File:');
    console.log('   ' + dbPath);
    console.log('');
    console.log('🔒 Mode: ' + (app.isPackaged ? 'PRODUCTION' : 'DEVELOPMENT'));
    console.log('   Using canonical filename: pos.db (same for dev/prod)');
    console.log('');
    
    // Validate path security
    try {
      assertDbPathSafe(dbPath, app);
      console.log('✅ Path Security: VALID (database is inside userData)');
    } catch (error) {
      console.error('❌ Path Security: FAILED');
      console.error('   ' + error.message);
      return;
    }
    console.log('');
    
    // Check if database file exists
    const fs = require('fs');
    if (!fs.existsSync(dbPath)) {
      console.log('⚠️  Database file does not exist yet (will be created on first run)');
      console.log('');
      return;
    }
    
    // Open database
    console.log('🔌 Opening database connection...');
    const db = new Database(dbPath);
    console.log('✅ Database connection opened');
    console.log('');
    
    // Check schema (tables and views)
    console.log('📊 Database Schema:');
    console.log('');
    
    const schemaObjects = db.prepare(`
      SELECT name, type 
      FROM sqlite_master 
      WHERE type IN ('table', 'view') 
        AND name NOT LIKE 'sqlite_%'
      ORDER BY type, name
    `).all();
    
    console.log('   Tables:');
    const tables = schemaObjects.filter(obj => obj.type === 'table');
    if (tables.length === 0) {
      console.log('   ⚠️  No tables found (migrations may not have run)');
    } else {
      tables.forEach(t => console.log(`      ${t.name}`));
    }
    
    console.log('');
    console.log('   Views:');
    const views = schemaObjects.filter(obj => obj.type === 'view');
    if (views.length === 0) {
      console.log('      (none)');
    } else {
      views.forEach(v => console.log(`      ${v.name}`));
    }
    
    console.log('');
    
    // Check table counts
    console.log('📊 Table Row Counts:');
    console.log('');
    
    const expectedTables = [
      'products',
      'categories',
      'customers',
      'suppliers',
      'purchase_orders',
      'orders',
      'inventory_movements',
      'warehouses',
      'units',
      'expenses',
    ];
    
    let totalRows = 0;
    let missingTables = [];
    
    for (const table of expectedTables) {
      try {
        // Check if table exists
        const tableExists = db.prepare(`
          SELECT name FROM sqlite_master 
          WHERE type='table' AND name=?
        `).get(table);
        
        if (tableExists) {
          const count = db.prepare(`SELECT COUNT(*) as count FROM ${table}`).get().count;
          console.log(`   ${table.padEnd(25)} ${String(count).padStart(8)} rows`);
          totalRows += count;
        } else {
          console.log(`   ${table.padEnd(25)} ⚠️  MISSING`);
          missingTables.push(table);
        }
      } catch (error) {
        console.log(`   ${table.padEnd(25)} ❌ ERROR: ${error.message}`);
        missingTables.push(table);
      }
    }
    
    console.log('');
    console.log(`   ${'TOTAL'.padEnd(25)} ${String(totalRows).padStart(8)} rows`);
    
    if (missingTables.length > 0) {
      console.log('');
      console.log('⚠️  WARNING: Some expected tables are missing!');
      console.log('   This indicates migrations may not have run.');
      console.log('   Missing tables:', missingTables.join(', '));
    }
    
    console.log('');
    
    // Check applied migrations
    console.log('🔄 Applied Migrations:');
    try {
      const migrations = db.prepare(`
        SELECT id, applied_at 
        FROM schema_migrations 
        ORDER BY id
      `).all();
      
      if (migrations.length === 0) {
        console.log('   ⚠️  No migrations recorded (migrations may not have run)');
      } else {
        console.log(`   Total: ${migrations.length} migration(s)`);
        // Show first 10 and last 5
        const showCount = Math.min(10, migrations.length);
        migrations.slice(0, showCount).forEach(m => {
          console.log(`   ✓ ${m.id.padEnd(35)} ${m.applied_at}`);
        });
        if (migrations.length > showCount) {
          console.log(`   ... and ${migrations.length - showCount} more`);
        }
      }
    } catch (error) {
      console.log('   ❌ ERROR: Could not read schema_migrations table');
      console.log('   Error:', error.message);
    }
    console.log('');
    
    // Check database pragmas
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
    
    // Close database
    db.close();
    console.log('✅ Database check completed successfully');
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
    // Exit after check completes
    setTimeout(() => {
      app.quit();
    }, 500);
  });
}

// If running as main module (via electron -e), ensure app quits after completion
if (require.main === module) {
  // App will quit automatically after checkDatabase completes
}

module.exports = checkDatabase;


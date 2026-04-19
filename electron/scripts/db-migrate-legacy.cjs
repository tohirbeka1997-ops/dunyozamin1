/**
 * Manual Legacy Migration Script
 * 
 * Runs legacy data migration without launching UI.
 * 
 * Usage: npm run db:migrate:legacy
 */

const { app } = require('electron');
const Database = require('better-sqlite3');
const { getNewDbPath, getLegacyDbPath } = require('../db/dbPath.cjs');
const { migrateLegacyData } = require('../db/legacyMigrate.cjs');

function runMigration() {
  console.log('');
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║           MANUAL LEGACY MIGRATION                             ║');
  console.log('╠═══════════════════════════════════════════════════════════════╣');
  console.log('');
  
  try {
    const newDbPath = getNewDbPath(app);
    const legacyDbPath = getLegacyDbPath(app);
    
    console.log('📄 New DB: ' + newDbPath);
    console.log('📄 Legacy DB: ' + legacyDbPath);
    console.log('');
    
    // Open new database
    const newDb = new Database(newDbPath);
    newDb.pragma('journal_mode = DELETE');
    newDb.pragma('foreign_keys = ON');
    
    // Run migration
    const result = migrateLegacyData(legacyDbPath, newDb);
    
    if (result.migrated) {
      console.log('✅ Migration completed successfully');
      console.log(`   Total rows migrated: ${result.totalRows}`);
    } else {
      console.log('⚠️  Migration skipped: ' + result.reason);
    }
    
    newDb.close();
    
    console.log('');
    console.log('╚═══════════════════════════════════════════════════════════════╝');
    console.log('');
    
  } catch (error) {
    console.error('');
    console.error('❌ Migration failed:');
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

// Run when Electron app is ready
if (app.isReady()) {
  runMigration();
  setTimeout(() => app.quit(), 1000);
} else {
  app.once('ready', () => {
    runMigration();
    setTimeout(() => app.quit(), 1000);
  });
}

module.exports = runMigration;





































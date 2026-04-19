/**
 * Database Reset Script
 * 
 * ⚠️  WARNING: This script will DELETE the entire database file!
 * 
 * This permanently removes all data:
 * - Products, categories, customers, suppliers
 * - Orders, purchase orders, inventory movements
 * - All other data in the database
 * 
 * The database will be recreated on next app launch with fresh seed data.
 * 
 * SECURITY: This script only works with the canonical database path
 * (inside userData). It will NEVER delete files outside userData.
 * 
 * Usage: npm run db:reset
 * 
 * NOTE: This MUST run via Electron to ensure path security and
 * better-sqlite3 ABI compatibility.
 * 
 * ⚠️  IMPORTANT: This is a destructive operation. Make sure you have
 * backups if you need to preserve data!
 */

const { app, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const { getDbPath, assertDbPathSafe, getUserDataPath, listDatabaseCandidates } = require('../db/dbPath.cjs');

async function resetDatabase() {
  console.log('');
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║                  DATABASE RESET                                ║');
  console.log('╠═══════════════════════════════════════════════════════════════╣');
  console.log('');
  
  try {
    // Get canonical database path
    const dbPath = getDbPath(app);
    
    console.log('📄 Target Database File:');
    console.log('   ' + dbPath);
    console.log('');
    
    // Validate path security (fail-fast if not in userData)
    try {
      assertDbPathSafe(dbPath, app);
      console.log('✅ Path Security: VALID (database is inside userData)');
    } catch (error) {
      console.error('❌ Path Security: FAILED');
      console.error('   ' + error.message);
      console.error('');
      console.error('🚨 SECURITY: Cannot delete database outside userData');
      process.exit(1);
    }
    console.log('');
    
    const userDataPath = getUserDataPath(app);
    const assertPathInsideUserData = (filePath) => {
      const resolvedFile = path.resolve(filePath);
      const resolvedUserData = path.resolve(userDataPath);
      const rel = path.relative(resolvedUserData, resolvedFile);
      if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
        throw new Error(`SECURITY: Refusing to delete file outside userData: ${filePath}`);
      }
    };

    // Determine db files to delete: canonical + any legacy .db files inside userData.
    const candidates = listDatabaseCandidates(app).map((c) => c.path);
    const knownLegacy = [
      path.join(userDataPath, 'pos-database.db'),
      path.join(userDataPath, 'pos.legacy.db'),
      path.join(userDataPath, 'pos.dev.db'),
    ];
    const dbFiles = Array.from(new Set([dbPath, ...candidates, ...knownLegacy]));
    const anyExists = dbFiles.some((f) => fs.existsSync(f));
    if (!anyExists) {
      console.log('ℹ️  No database files found in userData. Nothing to delete.');
      console.log('');
      return;
    }
    
    // Get file size for display (canonical file only, if present)
    let fileSizeMB = '0.00';
    try {
      if (fs.existsSync(dbPath)) {
        const stats = fs.statSync(dbPath);
        fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);
      }
    } catch {}
    console.log('📊 Database File Size:');
    console.log('   ' + fileSizeMB + ' MB');
    console.log('');
    
    // Show warning
    console.log('⚠️  WARNING: This will PERMANENTLY DELETE all database data!');
    console.log('');
    console.log('   This includes:');
    console.log('   - Products, categories, customers, suppliers');
    console.log('   - Orders, purchase orders, inventory movements');
    console.log('   - All other data in the database');
    console.log('');
    console.log('   The database will be recreated with fresh seed data');
    console.log('   on the next app launch.');
    console.log('');
    
    // For CLI usage, show instructions
    if (!app.isReady()) {
      console.log('ℹ️  To reset the database:');
      console.log('   1. Close the application if it is running');
      console.log('   2. Delete the file manually:');
      console.log('      ' + dbPath);
      console.log('   3. Restart the application');
      console.log('');
      console.log('   Or use the GUI confirmation dialog when app is ready.');
      console.log('');
      return;
    }
    
    // Show confirmation dialog (GUI)
    const result = await dialog.showMessageBox({
      type: 'warning',
      title: 'Reset Database',
      message: 'Are you sure you want to reset the database?',
      detail: `This will permanently delete all data from:\n\n${dbPath}\n\n(${fileSizeMB} MB)\n\nThe database will be recreated with fresh seed data on next launch.`,
      buttons: ['Cancel', 'Delete Database'],
      defaultId: 0,
      cancelId: 0,
    });
    
    if (result.response === 0) {
      console.log('❌ Database reset cancelled by user');
      console.log('');
      return;
    }
    
    console.log('🗑️  Deleting database file...');
    
    // Close database connection if open
    try {
      const { getDb, close } = require('../db/open.cjs');
      const db = getDb();
      if (db) {
        close();
        console.log('   Closed database connection');
      }
    } catch (error) {
      // Database might not be open, that's okay
    }
    
    // Delete database files and related files (WAL, SHM, journal)
    const filesToDelete = [];
    for (const f of dbFiles) {
      filesToDelete.push(f, f + '-wal', f + '-shm', f + '-journal');
    }
    
    let deletedCount = 0;
    for (const file of filesToDelete) {
      if (fs.existsSync(file)) {
        assertPathInsideUserData(file);
        fs.unlinkSync(file);
        deletedCount++;
        console.log('   Deleted: ' + file);
      }
    }
    
    if (deletedCount === 0) {
      console.log('   ⚠️  No files were deleted (file might have been deleted already)');
    } else {
      console.log('');
      console.log(`✅ Successfully deleted ${deletedCount} file(s)`);
    }
    
    console.log('');
    console.log('✅ Database reset completed');
    console.log('');
    console.log('💡 The database will be recreated with fresh seed data');
    console.log('   on the next application launch.');
    console.log('');
    console.log('╚═══════════════════════════════════════════════════════════════╝');
    console.log('');
    
  } catch (error) {
    console.error('');
    console.error('❌ Database reset failed:');
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

// Run reset when Electron app is ready
if (app.isReady()) {
  resetDatabase().then(() => {
    setTimeout(() => app.quit(), 500);
  }).catch(() => {
    setTimeout(() => app.quit(), 500);
  });
} else {
  app.once('ready', () => {
    resetDatabase().then(() => {
      setTimeout(() => app.quit(), 500);
    }).catch(() => {
      setTimeout(() => app.quit(), 500);
    });
  });
}

// If running as main module (via electron -e), ensure app quits after completion
if (require.main === module) {
  // App will quit automatically after resetDatabase completes
}

module.exports = resetDatabase;


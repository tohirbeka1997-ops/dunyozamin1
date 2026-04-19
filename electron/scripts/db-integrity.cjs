/**
 * Database Integrity Check Script
 * 
 * Runs PRAGMA integrity_check
 * 
 * Usage: npm run db:integrity
 */

const { app } = require('electron');
const Database = require('better-sqlite3');
const { getNewDbPath } = require('../db/dbPath.cjs');
const fs = require('fs');

function checkIntegrity() {
  console.log('');
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║              DATABASE INTEGRITY CHECK                           ║');
  console.log('╠═══════════════════════════════════════════════════════════════╣');
  console.log('');
  
  try {
    const dbPath = getNewDbPath(app);
    
    if (!fs.existsSync(dbPath)) {
      console.log('❌ Database file does not exist');
      console.log('');
      return;
    }
    
    console.log('📄 Database:', dbPath);
    console.log('');
    console.log('🔍 Running integrity check (this may take a moment)...');
    console.log('');
    
    const db = new Database(dbPath, { readonly: true });
    
    const result = db.pragma('integrity_check', { simple: true });
    
    if (result === 'ok') {
      console.log('✅ Integrity check: OK');
    } else {
      console.log('⚠️  Integrity check found issues:');
      console.log(result);
    }
    
    // Also check foreign keys
    console.log('');
    console.log('🔍 Checking foreign key constraints...');
    const fkCheck = db.pragma('foreign_key_check');
    if (fkCheck.length === 0) {
      console.log('✅ Foreign key constraints: OK');
    } else {
      console.log(`⚠️  Foreign key violations found: ${fkCheck.length}`);
      fkCheck.slice(0, 10).forEach(violation => {
        console.log(`   Table: ${violation.table}, Row: ${violation.rowid}, FK: ${violation.from}`);
      });
      if (fkCheck.length > 10) {
        console.log(`   ... and ${fkCheck.length - 10} more`);
      }
    }
    
    db.close();
    
    console.log('');
    console.log('╚═══════════════════════════════════════════════════════════════╝');
    console.log('');
    
  } catch (error) {
    console.error('');
    console.error('❌ Error:', error.message);
    console.error('');
    process.exit(1);
  }
}

if (app.isReady()) {
  checkIntegrity();
  setTimeout(() => app.quit(), 2000);
} else {
  app.once('ready', () => {
    checkIntegrity();
    setTimeout(() => app.quit(), 2000);
  });
}

module.exports = checkIntegrity;





































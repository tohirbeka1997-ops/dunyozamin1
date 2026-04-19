/**
 * Database Counts Script
 * 
 * Prints row counts for key tables
 * 
 * Usage: npm run db:counts
 */

const { app } = require('electron');
const Database = require('better-sqlite3');
const { getNewDbPath } = require('../db/dbPath.cjs');
const fs = require('fs');

function showCounts() {
  console.log('');
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║              DATABASE ROW COUNTS                               ║');
  console.log('╠═══════════════════════════════════════════════════════════════╣');
  console.log('');
  
  try {
    const dbPath = getNewDbPath(app);
    
    if (!fs.existsSync(dbPath)) {
      console.log('❌ Database file does not exist');
      console.log('');
      return;
    }
    
    const db = new Database(dbPath, { readonly: true });
    
    const tables = [
      'products',
      'categories',
      'customers',
      'suppliers',
      'orders',
      'purchase_orders',
      'inventory_movements',
      'shifts',
      'expenses',
    ];
    
    console.log('📊 Row Counts:');
    console.log('');
    
    let totalRows = 0;
    for (const table of tables) {
      try {
        const count = db.prepare(`SELECT COUNT(*) as count FROM ${table}`).get().count;
        console.log(`   ${table.padEnd(25)} ${String(count).padStart(8)} rows`);
        totalRows += count;
      } catch (error) {
        console.log(`   ${table.padEnd(25)} (error: ${error.message})`);
      }
    }
    
    console.log('');
    console.log(`   ${'TOTAL'.padEnd(25)} ${String(totalRows).padStart(8)} rows`);
    console.log('');
    
    db.close();
    
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
  showCounts();
  setTimeout(() => app.quit(), 500);
} else {
  app.once('ready', () => {
    showCounts();
    setTimeout(() => app.quit(), 500);
  });
}

module.exports = showCounts;





































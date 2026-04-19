/**
 * Database Wipe Script
 * 
 * This script wipes all transactional and master data from the database
 * while preserving the users table.
 * 
 * Usage:
 *   node scripts/wipe_database.cjs
 * 
 * WARNING: This is a DESTRUCTIVE operation!
 */

const { getDb } = require('../electron/db/open.cjs');
const DatabaseService = require('../electron/services/databaseService.cjs');

async function wipeDatabase() {
  try {
    console.log('🗑️  Starting database wipe...');
    console.log('');
    
    const db = getDb();
    const databaseService = new DatabaseService(db);
    
    const result = await databaseService.wipeAllData();
    
    console.log('');
    console.log('✅ Database wipe completed successfully!');
    console.log('');
    console.log('Final counts:', result.counts);
    console.log('');
    console.log('⚠️  Note: Users table was preserved. You can still log in.');
    
    process.exit(0);
  } catch (error) {
    console.error('');
    console.error('❌ Database wipe failed!');
    console.error('');
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
    console.error('');
    process.exit(1);
  }
}

// Run the wipe
wipeDatabase();


































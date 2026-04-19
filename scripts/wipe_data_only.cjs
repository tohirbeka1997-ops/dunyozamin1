/**
 * Data-Only Wipe Script
 * 
 * This script performs a data-only wipe that:
 * - Clears all transactional and master data
 * - Preserves main warehouse (main-warehouse-001)
 * - Preserves admin user (admin@pos.com)
 * - Keeps all table structures (schema unchanged)
 * - Resets auto-increment sequences
 * 
 * Usage:
 *   node scripts/wipe_data_only.cjs
 * 
 * WARNING: This is a DESTRUCTIVE operation!
 */

const { getDb } = require('../electron/db/open.cjs');
const DatabaseService = require('../electron/services/databaseService.cjs');

async function wipeDataOnly() {
  try {
    console.log('🗑️  Starting data-only wipe...');
    console.log('');
    console.log('This will:');
    console.log('  ✓ Delete all orders, products, categories, customers, shifts');
    console.log('  ✓ Delete all inventory movements and stock balances');
    console.log('  ✓ Keep main warehouse (main-warehouse-001)');
    console.log('  ✓ Keep admin user (admin@pos.com)');
    console.log('  ✓ Reset all auto-increment sequences');
    console.log('  ✓ Preserve all table structures');
    console.log('');
    
    const db = getDb();
    const databaseService = new DatabaseService(db);
    
    const result = await databaseService.wipeDataOnly();
    
    console.log('');
    console.log('✅ Data-only wipe completed successfully!');
    console.log('');
    console.log('Final counts:', result.counts);
    console.log('');
    console.log('✅ Main warehouse preserved: main-warehouse-001');
    console.log('✅ Admin user preserved: admin@pos.com');
    console.log('');
    console.log('⚠️  Dashboard should now show 0 so\'m (empty state)');
    
    process.exit(0);
  } catch (error) {
    console.error('');
    console.error('❌ Data-only wipe failed!');
    console.error('');
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
    console.error('');
    process.exit(1);
  }
}

// Run the wipe
wipeDataOnly();


































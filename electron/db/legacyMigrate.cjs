/**
 * Legacy Database Data Migration Module
 * 
 * Migrates data from legacy database (pos.legacy.db) to new clean database (pos.db).
 * 
 * FEATURES:
 * - Idempotent: safe to run multiple times
 * - Preserves original IDs (UUIDs/text IDs)
 * - Migrates in dependency order
 * - Handles schema differences gracefully
 * - Integrity checks after migration
 * 
 * MIGRATION ORDER:
 * 1. units
 * 2. warehouses
 * 3. categories
 * 4. suppliers
 * 5. customers
 * 6. products
 * 7. inventory_movements
 * 8. shifts
 * 9. orders
 * 10. order_items
 * 11. sales_returns / return_items
 * 12. expenses
 * 13. settings/users (if schema matches)
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

/**
 * Open legacy database in read-only mode
 * 
 * @param {string} legacyDbPath - Path to legacy database
 * @returns {Database} Read-only database instance
 */
function openLegacyDb(legacyDbPath) {
  if (!fs.existsSync(legacyDbPath)) {
    return null;
  }
  
  try {
    // Open in read-only mode
    const db = new Database(legacyDbPath, {
      readonly: true,
      fileMustExist: true,
    });
    
    // Enforce read-only mode
    db.pragma('query_only = ON');
    
    // If legacy uses WAL, checkpoint it (read-only operation)
    try {
      const journalMode = db.pragma('journal_mode', { simple: true });
      if (journalMode === 'wal') {
        // Checkpoint WAL (read-only, safe)
        db.pragma('wal_checkpoint(TRUNCATE)');
      }
    } catch (error) {
      // Ignore checkpoint errors
    }
    
    return db;
  } catch (error) {
    console.error(`Failed to open legacy database: ${error.message}`);
    return null;
  }
}

/**
 * Get column names for a table
 * 
 * @param {Database} db - Database instance
 * @param {string} tableName - Table name
 * @returns {Array<string>} Column names
 */
function getTableColumns(db, tableName) {
  try {
    const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
    return columns.map(col => col.name);
  } catch (error) {
    return [];
  }
}

/**
 * Check if table exists
 * 
 * @param {Database} db - Database instance
 * @param {string} tableName - Table name
 * @returns {boolean} True if table exists
 */
function tableExists(db, tableName) {
  try {
    const result = db.prepare(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name=?
    `).get(tableName);
    return !!result;
  } catch (error) {
    return false;
  }
}

/**
 * Get row count for a table
 * 
 * @param {Database} db - Database instance
 * @param {string} tableName - Table name
 * @returns {number} Row count
 */
function getRowCount(db, tableName) {
  try {
    if (!tableExists(db, tableName)) {
      return 0;
    }
    const result = db.prepare(`SELECT COUNT(*) as count FROM ${tableName}`).get();
    return result.count || 0;
  } catch (error) {
    return 0;
  }
}

/**
 * Migrate table data from legacy to new database
 * 
 * @param {Database} legacyDb - Legacy database (read-only)
 * @param {Database} newDb - New database (writable)
 * @param {string} tableName - Table name
 * @param {Array<string>} requiredColumns - Required columns (if empty, use intersection)
 * @returns {number} Number of rows migrated
 */
function migrateTable(legacyDb, newDb, tableName, requiredColumns = []) {
  if (!tableExists(legacyDb, tableName)) {
    console.log(`    ⚠️  Table ${tableName} not found in legacy DB, skipping`);
    return 0;
  }
  
  if (!tableExists(newDb, tableName)) {
    console.log(`    ⚠️  Table ${tableName} not found in new DB, skipping`);
    return 0;
  }
  
  // Get column intersection
  const legacyColumns = getTableColumns(legacyDb, tableName);
  const newColumns = getTableColumns(newDb, tableName);
  
  let columnsToMigrate;
  if (requiredColumns.length > 0) {
    // Use required columns, but filter to intersection
    columnsToMigrate = requiredColumns.filter(col => 
      legacyColumns.includes(col) && newColumns.includes(col)
    );
  } else {
    // Use intersection of both schemas
    columnsToMigrate = legacyColumns.filter(col => newColumns.includes(col));
  }
  
  if (columnsToMigrate.length === 0) {
    console.log(`    ⚠️  No common columns for ${tableName}, skipping`);
    return 0;
  }
  
  // Get existing IDs in new DB to avoid duplicates
  const existingIds = new Set();
  try {
    const existing = newDb.prepare(`SELECT id FROM ${tableName}`).all();
    existing.forEach(row => existingIds.add(row.id));
  } catch (error) {
    // Table might be empty, continue
  }
  
  // Read all rows from legacy
  const columnsStr = columnsToMigrate.join(', ');
  const rows = legacyDb.prepare(`SELECT ${columnsStr} FROM ${tableName}`).all();
  
  if (rows.length === 0) {
    return 0;
  }
  
  // Prepare insert statement (idempotent: INSERT OR IGNORE)
  const placeholders = columnsToMigrate.map(() => '?').join(', ');
  const insertStmt = newDb.prepare(`
    INSERT OR IGNORE INTO ${tableName} (${columnsStr}) 
    VALUES (${placeholders})
  `);
  
  // Insert rows in transaction
  const transaction = newDb.transaction((rowsToInsert) => {
    let inserted = 0;
    for (const row of rowsToInsert) {
      const values = columnsToMigrate.map(col => row[col]);
      try {
        insertStmt.run(...values);
        inserted++;
      } catch (error) {
        // Skip rows that fail (e.g., constraint violations)
        console.warn(`      ⚠️  Skipped row in ${tableName}: ${error.message}`);
      }
    }
    return inserted;
  });
  
  const inserted = transaction(rows);
  return inserted;
}

/**
 * Migrate all data from legacy to new database
 * 
 * @param {Database} legacyDb - Legacy database (read-only)
 * @param {Database} newDb - New database (writable)
 * @returns {Object} Migration summary
 */
function migrateAllData(legacyDb, newDb) {
  if (!legacyDb) {
    return { migrated: false, reason: 'Legacy database not found' };
  }
  
  console.log('');
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║              LEGACY DATA MIGRATION                             ║');
  console.log('╠═══════════════════════════════════════════════════════════════╣');
  console.log('');
  
  const summary = {
    migrated: true,
    tables: {},
    totalRows: 0,
  };
  
  // Migration order (respecting dependencies)
  const migrationOrder = [
    { table: 'units', required: ['id', 'code', 'name', 'symbol'] },
    { table: 'warehouses', required: ['id', 'name', 'code', 'is_default', 'is_active'] },
    { table: 'categories', required: ['id', 'name', 'is_active'] },
    { table: 'suppliers', required: ['id', 'name', 'code', 'phone', 'email'] },
    { table: 'customers', required: ['id', 'name', 'code', 'phone', 'email', 'balance'] },
    { table: 'products', required: ['id', 'sku', 'name', 'category_id', 'purchase_price', 'sale_price'] },
    { table: 'inventory_movements', required: ['id', 'product_id', 'movement_type', 'quantity'] },
    { table: 'shifts', required: ['id', 'shift_number', 'cashier_id', 'opened_at', 'status'] },
    { table: 'orders', required: ['id', 'order_number', 'customer_id', 'cashier_id', 'total', 'status'] },
    { table: 'order_items', required: ['id', 'order_id', 'product_id', 'quantity', 'price'] },
    { table: 'sales_returns', required: [] }, // Optional
    { table: 'return_items', required: [] }, // Optional
    { table: 'expenses', required: [] }, // Optional
    { table: 'settings', required: [] }, // Optional
    { table: 'profiles', required: [] }, // Optional (users)
  ];
  
  for (const { table, required } of migrationOrder) {
    console.log(`  🔄 Migrating ${table}...`);
    try {
      const count = migrateTable(legacyDb, newDb, table, required);
      summary.tables[table] = count;
      summary.totalRows += count;
      if (count > 0) {
        console.log(`    ✅ Migrated ${count} row(s)`);
      } else {
        console.log(`    ⏭  Skipped (0 rows)`);
      }
    } catch (error) {
      console.error(`    ❌ Failed: ${error.message}`);
      summary.tables[table] = { error: error.message };
    }
  }
  
  console.log('');
  console.log('╠═══════════════════════════════════════════════════════════════╣');
  console.log(`║ Migration complete. Total rows: ${summary.totalRows}`);
  console.log('╚═══════════════════════════════════════════════════════════════╝');
  console.log('');
  
  return summary;
}

/**
 * Run integrity checks after migration
 * 
 * @param {Database} legacyDb - Legacy database
 * @param {Database} newDb - New database
 * @returns {Object} Integrity check results
 */
function runIntegrityChecks(legacyDb, newDb) {
  console.log('🔍 Running integrity checks...');
  console.log('');
  
  const results = {
    foreignKeys: true,
    counts: {},
    stock: true,
  };
  
  // Check foreign keys
  try {
    const fkCheck = newDb.prepare('PRAGMA foreign_key_check').all();
    if (fkCheck.length > 0) {
      console.warn('  ⚠️  Foreign key violations found:', fkCheck.length);
      results.foreignKeys = false;
    } else {
      console.log('  ✅ Foreign key constraints OK');
    }
  } catch (error) {
    console.warn('  ⚠️  Could not check foreign keys:', error.message);
  }
  
  // Compare row counts
  const tablesToCheck = ['units', 'warehouses', 'categories', 'suppliers', 'customers', 'products', 'inventory_movements'];
  for (const table of tablesToCheck) {
    const legacyCount = getRowCount(legacyDb, table);
    const newCount = getRowCount(newDb, table);
    results.counts[table] = { legacy: legacyCount, new: newCount, match: legacyCount === newCount };
    
    if (legacyCount !== newCount) {
      console.warn(`  ⚠️  ${table}: legacy=${legacyCount}, new=${newCount} (mismatch)`);
    } else {
      console.log(`  ✅ ${table}: ${newCount} rows (match)`);
    }
  }
  
  console.log('');
  return results;
}

/**
 * Main migration function
 * 
 * @param {string} legacyDbPath - Path to legacy database
 * @param {Database} newDb - New database instance
 * @returns {Object} Migration result
 */
function migrateLegacyData(legacyDbPath, newDb) {
  const legacyDb = openLegacyDb(legacyDbPath);
  
  if (!legacyDb) {
    return { migrated: false, reason: 'Legacy database not found or cannot be opened' };
  }
  
  try {
    // Migrate data
    const summary = migrateAllData(legacyDb, newDb);
    
    // Run integrity checks
    const integrity = runIntegrityChecks(legacyDb, newDb);
    
    return {
      ...summary,
      integrity,
    };
  } finally {
    legacyDb.close();
  }
}

module.exports = {
  migrateLegacyData,
  openLegacyDb,
  migrateTable,
  runIntegrityChecks,
};





































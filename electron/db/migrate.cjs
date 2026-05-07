/**
 * SQLite Migration Runner (PRODUCTION-GRADE)
 * 
 * CRITICAL REQUIREMENTS:
 * - Idempotent: safe to re-run (handles duplicate columns/tables/indexes/views)
 * - Transactional: each migration runs in a transaction
 * - Deterministic: same migrations always produce same result
 * - Safe: never loses data, never blocks startup unnecessarily
 * 
 * SCHEMA:
 * - schema_migrations table: id TEXT PRIMARY KEY, applied_at TEXT NOT NULL, checksum TEXT NULL
 * - Uses migration filename as id (e.g., '022_customer_ledger_add_method.sql')
 * - Checksum stored for verification (optional)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * Check if a column exists in a table
 */
function hasColumn(db, tableName, columnName) {
  try {
    const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
    return columns.some(col => col.name === columnName);
  } catch (error) {
    return false;
  }
}

/**
 * Safely add a column to a table (idempotent)
 */
function safeAddColumn(db, tableName, columnName, columnDefinition) {
  if (hasColumn(db, tableName, columnName)) {
    return false; // Column already exists
  }
  
  try {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefinition}`);
    return true; // Column added
  } catch (error) {
    // If error is "duplicate column", column was added between check and exec
    if (error.message && error.message.includes('duplicate column')) {
      return false;
    }
    throw error;
  }
}

/**
 * Check if a table exists
 */
function hasTable(db, tableName) {
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
 * Check if an index exists
 */
function hasIndex(db, indexName) {
  try {
    const result = db.prepare(`
      SELECT name FROM sqlite_master 
      WHERE type='index' AND name=?
    `).get(indexName);
    return !!result;
  } catch (error) {
    return false;
  }
}

/**
 * Check if a view exists
 */
function hasView(db, viewName) {
  try {
    const result = db.prepare(`
      SELECT name FROM sqlite_master 
      WHERE type='view' AND name=?
    `).get(viewName);
    return !!result;
  } catch (error) {
    return false;
  }
}

/**
 * Normalize legacy numeric migration IDs to filenames
 * 
 * This handles old databases that used INTEGER IDs (1, 2, 3, ...)
 * and converts them to filename-based IDs (000_init.sql, etc.)
 */
function normalizeLegacyMigrationIds(db, migrationFiles) {
  try {
    const tableInfo = db.prepare('PRAGMA table_info(schema_migrations)').all();
    const idColumn = tableInfo.find(col => col.name === 'id');
    
    // Check if we have INTEGER IDs (legacy)
    if (idColumn && idColumn.type.toUpperCase().includes('INT')) {
      console.log('  🔄 Detected legacy INTEGER migration IDs, normalizing...');
      
      // Get existing migrations
      const legacyMigrations = db.prepare('SELECT id, name FROM schema_migrations ORDER BY CAST(id AS INTEGER)').all();
      
      // Build mapping: try to use name column if available, otherwise map by order
      const migrationMap = new Map();
      const hasNameColumn = tableInfo.some(col => col.name === 'name');
      
      if (hasNameColumn) {
        // Use name column if available (most reliable)
        const namedMigrations = db.prepare('SELECT id, name FROM schema_migrations WHERE name IS NOT NULL').all();
        for (const mig of namedMigrations) {
          if (migrationFiles.includes(mig.name)) {
            migrationMap.set(String(mig.id), mig.name);
          }
        }
      }
      
      // Fill gaps by order (best-effort)
      for (let i = 0; i < Math.min(legacyMigrations.length, migrationFiles.length); i++) {
        const legacyId = String(legacyMigrations[i].id);
        if (!migrationMap.has(legacyId)) {
          const filename = migrationFiles[i];
          migrationMap.set(legacyId, filename);
        }
      }
      
      if (migrationMap.size > 0) {
        // Create new table with TEXT IDs
        db.exec(`
          CREATE TABLE IF NOT EXISTS schema_migrations_new (
            id TEXT PRIMARY KEY,
            applied_at TEXT NOT NULL DEFAULT (datetime('now')),
            checksum TEXT NULL
          )
        `);
        
        // Copy migrations with normalized IDs
        for (const [legacyId, filename] of migrationMap.entries()) {
          // Try to get applied_at, but handle case where column doesn't exist yet
          let appliedAt = new Date().toISOString();
          try {
            const legacy = db.prepare('SELECT applied_at FROM schema_migrations WHERE id = ?').get(legacyId);
            if (legacy && legacy.applied_at) {
              appliedAt = legacy.applied_at;
            }
          } catch (error) {
            // Column might not exist, use current timestamp
            if (error.message.includes('no such column')) {
              appliedAt = new Date().toISOString();
            } else {
              throw error;
            }
          }
          
          db.prepare(`
            INSERT OR IGNORE INTO schema_migrations_new (id, applied_at) 
            VALUES (?, ?)
          `).run(filename, appliedAt);
        }
        
        // Replace old table
        db.exec('DROP TABLE schema_migrations');
        db.exec('ALTER TABLE schema_migrations_new RENAME TO schema_migrations');
        
        console.log(`    ✅ Normalized ${migrationMap.size} legacy migration IDs`);
      }
    }
  } catch (error) {
    // If normalization fails, continue (don't block startup)
    console.warn('  ⚠️  Could not normalize legacy IDs (non-fatal):', error.message);
  }
}

/**
 * Calculate checksum of migration file content
 */
function calculateChecksum(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Ensure schema_migrations table exists with all required columns
 * 
 * This function is backward-compatible: it handles old databases that
 * may have schema_migrations without the new columns (applied_at, checksum).
 * 
 * @param {Database} db - Database instance
 */
function ensureMigrationsTable(db) {
  // Create table if it doesn't exist
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now')),
      checksum TEXT NULL
    )
  `);

  // Check existing columns
  const tableInfo = db.prepare('PRAGMA table_info(schema_migrations)').all();
  const columnNames = tableInfo.map(col => col.name.toLowerCase());

  // Add applied_at column if missing
  if (!columnNames.includes('applied_at')) {
    try {
      db.exec('ALTER TABLE schema_migrations ADD COLUMN applied_at TEXT NOT NULL DEFAULT (datetime(\'now\'))');
      console.log('  ✓ Added applied_at column to schema_migrations');
      
      // Backfill applied_at for existing rows
      db.exec(`
        UPDATE schema_migrations 
        SET applied_at = datetime('now') 
        WHERE applied_at IS NULL
      `);
      console.log('  ✓ Backfilled applied_at for existing migrations');
    } catch (error) {
      // Column might have been added between check and exec
      if (!error.message.includes('duplicate column')) {
        throw error;
      }
    }
  }

  // Add checksum column if missing (nullable, so safe to add)
  if (!columnNames.includes('checksum')) {
    try {
      db.exec('ALTER TABLE schema_migrations ADD COLUMN checksum TEXT NULL');
      console.log('  ✓ Added checksum column to schema_migrations');
    } catch (error) {
      // Column might have been added between check and exec
      if (!error.message.includes('duplicate column')) {
        throw error;
      }
    }
  }
}

/**
 * Make SQL idempotent by wrapping in IF NOT EXISTS checks
 * 
 * This function processes SQL to make it safer:
 * - CREATE TABLE -> CREATE TABLE IF NOT EXISTS
 * - CREATE INDEX -> CREATE INDEX IF NOT EXISTS
 * - CREATE VIEW -> DROP VIEW IF EXISTS + CREATE VIEW
 * - ALTER TABLE ADD COLUMN -> Check first, then add
 */
function makeSqlIdempotent(sql, db) {
  // Intentional no-op.
  //
  // Historical note: earlier versions tried to rewrite migration SQL on
  // the fly to add `IF NOT EXISTS` and similar guards. That approach was
  // brittle (SQL parser edge-cases) and masked real migration defects.
  //
  // Current strategy:
  // 1) keep migration files deterministic/explicit,
  // 2) enforce idempotency at execution-time via safe `already exists`
  //    handling in `runMigrations`, and
  // 3) fail fast on semantic conflicts (e.g. UNIQUE violations) so
  //    operators can fix data instead of silently drifting schema.
  //
  // The function remains to keep call-sites stable and to document that
  // SQL text is intentionally not rewritten.
  return sql;
}

/**
 * Run all pending migrations
 * 
 * @param {Database} db - better-sqlite3 database instance
 * @throws {Error} If any migration fails (fail-fast)
 */
function runMigrations(db) {
  if (!db) {
    throw new Error('Database instance is required for migrations');
  }

  console.log('');
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║                    RUNNING MIGRATIONS                          ║');
  console.log('╠═══════════════════════════════════════════════════════════════╣');
  console.log('');

  // CRITICAL: Ensure schema_migrations table exists with all required columns
  // This must run BEFORE any queries on schema_migrations
  ensureMigrationsTable(db);

  const migrationsDir = path.join(__dirname, 'migrations');
  
  if (!fs.existsSync(migrationsDir)) {
    const error = new Error(`Migrations directory not found: ${migrationsDir}`);
    console.error('❌', error.message);
    throw error;
  }

  // Get all SQL migration files, sorted lexicographically
  const migrationFiles = fs.readdirSync(migrationsDir)
    .filter(file => file.endsWith('.sql'))
    .sort();

  if (migrationFiles.length === 0) {
    console.warn('⚠️  No migration files found');
    console.log('');
    return { applied: 0, skipped: 0, total: 0 };
  }

  console.log(`📁 Found ${migrationFiles.length} migration file(s)`);
  console.log('');

  // Normalize legacy migration IDs if needed
  normalizeLegacyMigrationIds(db, migrationFiles);

  // Get already applied migrations
  const appliedMigrations = new Set(
    db.prepare('SELECT id FROM schema_migrations')
      .all()
      .map(row => String(row.id))
  );

  console.log(`📊 Applied migrations: ${appliedMigrations.size}`);
  console.log('');

  let appliedCount = 0;
  let skippedCount = 0;

  // Run each migration in lexicographic order
  for (const file of migrationFiles) {
    // Skip if already applied
    if (appliedMigrations.has(file)) {
      console.log(`  ⏭  ${file} (already applied)`);
      skippedCount++;
      continue;
    }

    const migrationPath = path.join(migrationsDir, file);
    
    // Read migration SQL
    let sql;
    try {
      sql = fs.readFileSync(migrationPath, 'utf8');
    } catch (error) {
      const err = new Error(`Failed to read migration file ${file}: ${error.message}`);
      console.error(`  ❌ ${file} - READ FAILED`);
      console.error('     Error:', err.message);
      throw err;
    }

    if (!sql.trim()) {
      console.warn(`  ⚠️  ${file} is empty, skipping`);
      skippedCount++;
      continue;
    }

    // Calculate checksum
    const checksum = calculateChecksum(sql);

    if (file === '073_web_orders_out_for_delivery_status.sql') {
      // Drop+rebuild migrations need atomic semantics: if anything fails
      // mid-way we must NOT leave the DB with `web_orders` already dropped
      // and `web_orders_new` un-renamed. We run the whole file inside an
      // IMMEDIATE transaction and use `defer_foreign_keys` so FK checks
      // happen at COMMIT — that lets us drop a referenced table inside the
      // same tx without violating constraints temporarily.
      const tx073 = db.transaction(() => {
        db.pragma('defer_foreign_keys = 1');
        db.exec(sql);
        db.prepare(`
          INSERT INTO schema_migrations (id, applied_at, checksum)
          VALUES (?, datetime('now'), ?)
        `).run(file, checksum);
      });

      try {
        console.log(`  🔄 ${file}...`);
        tx073.immediate();
        console.log(`  ✅ ${file} applied successfully`);
        appliedCount++;
      } catch (error) {
        console.error('');
        console.error('═══════════════════════════════════════════════════════════════');
        console.error('🚨 MIGRATION FAILED - APP WILL EXIT');
        console.error('═══════════════════════════════════════════════════════════════');
        console.error('');
        console.error('Failed migration:', file);
        console.error('Error:', error.message);
        console.error('The transaction was rolled back; database is unchanged.');
        console.error('');
        throw error;
      }
      continue;
    }

    // Run migration in a transaction
    const transaction = db.transaction(() => {
      try {
        console.log(`  🔄 ${file}...`);
        
        // Special handling for known problematic migrations
        if (file === '022_customer_ledger_add_method.sql') {
          // This migration adds a column - make it idempotent
          if (!hasColumn(db, 'customer_ledger', 'method')) {
            safeAddColumn(db, 'customer_ledger', 'method', 'TEXT');
            console.log('    ✓ Added method column');
          } else {
            console.log('    ⏭  method column already exists');
          }
        } else if (file === '040_batch_receipt_metadata.sql') {
          // Ensure expected columns exist before running backfill queries
          if (!hasColumn(db, 'inventory_batches', 'opened_at')) {
            safeAddColumn(db, 'inventory_batches', 'opened_at', 'TEXT');
            console.log('    ✓ Added inventory_batches.opened_at');
          }
          if (!hasColumn(db, 'inventory_batches', 'receipt_id')) {
            safeAddColumn(db, 'inventory_batches', 'receipt_id', 'TEXT');
            console.log('    ✓ Added inventory_batches.receipt_id');
          }
          if (!hasColumn(db, 'inventory_batches', 'receipt_item_id')) {
            safeAddColumn(db, 'inventory_batches', 'receipt_item_id', 'TEXT');
            console.log('    ✓ Added inventory_batches.receipt_item_id');
          }
          if (!hasColumn(db, 'inventory_batches', 'currency')) {
            safeAddColumn(db, 'inventory_batches', 'currency', 'TEXT');
            console.log('    ✓ Added inventory_batches.currency');
          }
          if (!hasColumn(db, 'inventory_batches', 'cost_price_uzs')) {
            safeAddColumn(db, 'inventory_batches', 'cost_price_uzs', 'REAL');
            console.log('    ✓ Added inventory_batches.cost_price_uzs');
          }
          if (!hasColumn(db, 'inventory_batches', 'exchange_rate')) {
            safeAddColumn(db, 'inventory_batches', 'exchange_rate', 'REAL');
            console.log('    ✓ Added inventory_batches.exchange_rate');
          }
          if (!hasColumn(db, 'purchase_receipts', 'currency')) {
            safeAddColumn(db, 'purchase_receipts', 'currency', 'TEXT');
            console.log('    ✓ Added purchase_receipts.currency');
          }
          if (!hasColumn(db, 'purchase_receipts', 'exchange_rate')) {
            safeAddColumn(db, 'purchase_receipts', 'exchange_rate', 'REAL');
            console.log('    ✓ Added purchase_receipts.exchange_rate');
          }
          if (!hasColumn(db, 'purchase_receipt_items', 'created_at')) {
            safeAddColumn(db, 'purchase_receipt_items', 'created_at', 'TEXT');
            console.log('    ✓ Added purchase_receipt_items.created_at');
          }

          // Execute migration SQL normally
          db.exec(sql);
        } else if (file === '046_quotes_created_by_users.sql') {
          // 046: Fix quotes FK - disable FKs for DROP, then run migration
          db.pragma('foreign_keys = OFF');
          try {
            db.exec(sql);
          } finally {
            db.pragma('foreign_keys = ON');
          }
        } else if (file === '056_promotions.sql') {
          // 056: If promotions exists with wrong schema (e.g. missing status), drop and recreate
          if (hasTable(db, 'promotions') && !hasColumn(db, 'promotions', 'status')) {
            console.log('    ⚠ promotions table exists with incomplete schema, dropping for clean recreate');
            db.pragma('foreign_keys = OFF');
            try {
              db.exec(`
                DROP TABLE IF EXISTS promotion_audit;
                DROP TABLE IF EXISTS promotion_usage;
                DROP TABLE IF EXISTS promotion_reward;
                DROP TABLE IF EXISTS promotion_condition;
                DROP TABLE IF EXISTS promotion_scope;
                DROP TABLE IF EXISTS promotions;
              `);
            } finally {
              db.pragma('foreign_keys = ON');
            }
          }
          db.exec(sql);
        } else if (file === '059_manual_sales_returns.sql') {
          // 059: Older DBs may not have sales_returns.notes yet.
          // Ensure it exists before the rebuild SELECT copies rows.
          if (hasTable(db, 'sales_returns') && !hasColumn(db, 'sales_returns', 'notes')) {
            safeAddColumn(db, 'sales_returns', 'notes', 'TEXT');
            console.log('    ✓ Added sales_returns.notes');
          }
          db.exec(sql);
        } else if (file === '060_customer_bonus_loyalty.sql') {
          if (hasTable(db, 'customers') && !hasColumn(db, 'customers', 'bonus_points')) {
            safeAddColumn(db, 'customers', 'bonus_points', 'REAL NOT NULL DEFAULT 0');
            console.log('    ✓ Added customers.bonus_points');
          }
          db.exec(sql);
        } else if (file === '061_product_brand_article.sql') {
          if (hasTable(db, 'products')) {
            if (!hasColumn(db, 'products', 'brand')) {
              safeAddColumn(db, 'products', 'brand', 'TEXT');
              console.log('    ✓ Added products.brand');
            }
            if (!hasColumn(db, 'products', 'article')) {
              safeAddColumn(db, 'products', 'article', 'TEXT');
              console.log('    ✓ Added products.article');
            }
          }
          db.exec(sql);
        } else if (file === '062_loyalty_professional.sql') {
          if (hasTable(db, 'orders') && !hasColumn(db, 'orders', 'loyalty_redeem_points')) {
            safeAddColumn(db, 'orders', 'loyalty_redeem_points', 'REAL NOT NULL DEFAULT 0');
            console.log('    ✓ Added orders.loyalty_redeem_points');
          }
          db.exec(sql);
        } else if (file === '069_categories_image_marketplace.sql') {
          // ALTER ADD COLUMN — safeAddColumn bilan qayta ishga tushirish xavfsiz
          if (!hasTable(db, 'categories')) {
            throw new Error(
              'categories jadvali yo‘q — bu fayl to‘liq POS bazasi emas. To‘g‘ri pos.db yo‘lini ko‘rsating.'
            );
          }
          if (!hasColumn(db, 'categories', 'image_url')) {
            safeAddColumn(db, 'categories', 'image_url', 'TEXT');
            console.log('    ✓ Added categories.image_url');
          }
          if (!hasColumn(db, 'categories', 'show_in_marketplace')) {
            safeAddColumn(db, 'categories', 'show_in_marketplace', 'INTEGER NOT NULL DEFAULT 1');
            console.log('    ✓ Added categories.show_in_marketplace');
          }
        } else if (file === '070_customer_payments_shift_operation.sql') {
          if (hasTable(db, 'customer_payments')) {
            if (!hasColumn(db, 'customer_payments', 'shift_id')) {
              safeAddColumn(db, 'customer_payments', 'shift_id', 'TEXT');
              console.log('    ✓ Added customer_payments.shift_id');
            }
            if (!hasColumn(db, 'customer_payments', 'operation')) {
              safeAddColumn(db, 'customer_payments', 'operation', 'TEXT');
              console.log('    ✓ Added customer_payments.operation');
            }
            db.exec(
              'CREATE INDEX IF NOT EXISTS idx_customer_payments_shift ON customer_payments(shift_id);'
            );
          }
          db.exec(sql);
        } else {
          // Execute migration SQL normally
          // SQL files should use IF NOT EXISTS for tables/indexes
          db.exec(sql);
        }

        // Record migration as applied (checksum may be NULL if column doesn't exist, but ensureMigrationsTable should have added it)
        db.prepare(`
          INSERT INTO schema_migrations (id, applied_at, checksum) 
          VALUES (?, datetime('now'), ?)
        `).run(file, checksum);

        console.log(`  ✅ ${file} applied successfully`);
        appliedCount++;
      } catch (error) {
        // Check if error is genuinely idempotent (the schema is already in
        // the desired post-migration state).
        //
        // IMPORTANT: We deliberately do NOT treat `UNIQUE constraint failed`
        // as idempotent. That error usually indicates DATA-level duplicates
        // (e.g. building a unique index on a column that already has dupes),
        // not a re-run of an already-applied migration. Marking such a
        // migration as "applied" while the index never actually got created
        // leaves the database in a silently-corrupt state.
        const msg = error.message || '';
        const isIdempotentError =
          msg.includes('duplicate column') ||
          msg.includes('already exists') ||
          (msg.includes('no such table') && msg.includes('customer_ledger'));

        if (isIdempotentError) {
          console.log(`  ⚠️  ${file} - ${msg} (marking as applied - idempotent)`);
          try {
            db.prepare(`
              INSERT OR IGNORE INTO schema_migrations (id, applied_at, checksum)
              VALUES (?, datetime('now'), ?)
            `).run(file, checksum);
            skippedCount++;
          } catch {
            // Migration row already present, ignore
          }
          return;
        }

        if (msg.includes('UNIQUE constraint')) {
          console.error('');
          console.error('═══════════════════════════════════════════════════════════════');
          console.error(`🚨 MIGRATION ${file} FAILED ON UNIQUE CONSTRAINT`);
          console.error('   This usually means existing data violates the new');
          console.error('   uniqueness rule (e.g. duplicate values on a column being');
          console.error('   indexed). Resolve the duplicates and re-run — DO NOT mark');
          console.error('   this migration as applied or the index will be missing.');
          console.error('═══════════════════════════════════════════════════════════════');
          console.error('');
        }

        throw error;
      }
    });

    try {
      transaction();
    } catch (error) {
      // Transaction failed - check if it was an idempotent error we handled
      // (UNIQUE constraint is intentionally NOT in this list — see inner catch.)
      if (error.message && (
        error.message.includes('duplicate column') ||
        error.message.includes('already exists')
      )) {
        continue;
      }

      // Real error - fail-fast
      console.error('');
      console.error('═══════════════════════════════════════════════════════════════');
      console.error('🚨 MIGRATION FAILED - APP WILL EXIT');
      console.error('═══════════════════════════════════════════════════════════════');
      console.error('');
      console.error('Failed migration:', file);
      console.error('Error:', error.message);
      console.error('');
      console.error('The database transaction has been rolled back.');
      console.error('No data was lost. Please fix the migration file and restart.');
      console.error('');
      throw error;
    }
  }

  console.log('');
  console.log('╠═══════════════════════════════════════════════════════════════╣');
  console.log(`║ Migrations complete. Applied: ${appliedCount}, Skipped: ${skippedCount}`);
  console.log('╚═══════════════════════════════════════════════════════════════╝');
  console.log('');

  return {
    applied: appliedCount,
    skipped: skippedCount,
    total: migrationFiles.length,
  };
}

module.exports = {
  runMigrations,
  hasColumn,
  safeAddColumn,
  hasTable,
  hasIndex,
  hasView,
};

/**
 * Main database initialization module
 * Opens database, runs migrations, and seeds default data
 */

const { open, close, getDbPath } = require('./open.cjs');
const { runMigrations } = require('./migrate.cjs');
const { seed } = require('./seed.cjs');

/**
 * Initialize database: open, migrate, and seed
 * This is the main entry point for database setup
 */
function initialize() {
  try {
    console.log('=== DATABASE INITIALIZATION START ===');
    const dbPath = getDbPath();
    console.log('Database path:', dbPath);
    console.log('Checking if database file exists...');

    // Step 1: Open database (creates file if doesn't exist)
    console.log('Step 1: Opening database connection...');
    try {
      open();
      console.log('✅ Database connection opened successfully');
    } catch (openError) {
      console.error('❌ Failed to open database:', openError.message);
      console.error('Error details:', openError);
      throw openError;
    }

    // Step 2: Run migrations
    // NOTE: Migrations are already run automatically in open.cjs when DB opens.
    // This step is redundant but kept for backward compatibility.
    // If you call initialize() directly, migrations will run twice (harmless - they're idempotent).
    console.log('Step 2: Running database migrations...');
    try {
      const db = require('./open.cjs').getDb();
      runMigrations(db);
      console.log('✅ Migrations completed successfully');
    } catch (migrateError) {
      console.error('❌ Migration failed:', migrateError.message);
      console.error('Error details:', migrateError);
      throw migrateError;
    }

    // Step 3: Seed default data (idempotent)
    console.log('Step 3: Seeding default data...');
    try {
      seed();
      console.log('✅ Default data seeded successfully');
    } catch (seedError) {
      console.error('⚠️  Seed data failed (non-critical):', seedError.message);
      // Don't throw - seeding is optional
    }

    console.log('=== DATABASE INITIALIZATION COMPLETE ===');
    console.log('✅ Database is ready and connected');
    return true;
  } catch (error) {
    console.error('=== DATABASE INITIALIZATION FAILED ===');
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
    console.error('This may be due to:');
    console.error('  1. NODE_MODULE_VERSION mismatch (run: npm run rebuild:electron)');
    console.error('  2. Database file permissions issue');
    console.error('  3. Missing better-sqlite3 native module');
    throw error;
  }
}

/**
 * Get database instance
 */
function getDb() {
  return require('./open.cjs').getDb();
}

/**
 * Close database connection
 */
function closeDb() {
  close();
}

module.exports = {
  initialize,
  getDb,
  closeDb,
  getDbPath,
};




/**
 * Setup a test database with minimal test data for stock update QA
 * This creates a clean database with test products, warehouse, and user
 */

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

// Get test DB path
const testDbPath = path.join(__dirname, '..', 'test_pos.db');

// Remove existing test DB if it exists
if (fs.existsSync(testDbPath)) {
  console.log('Removing existing test database...');
  fs.unlinkSync(testDbPath);
}

console.log('Creating test database:', testDbPath);
const db = new Database(testDbPath);

// Set pragmas
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

// Run migrations using the proper migration system
console.log('Running migrations...');

// Create schema_migrations table
db.exec(`
  CREATE TABLE IF NOT EXISTS schema_migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    run_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

const migrationsDir = path.join(__dirname, '..', 'electron', 'db', 'migrations');
const migrationFiles = fs.readdirSync(migrationsDir)
  .filter(f => f.endsWith('.sql'))
  .sort();

for (const file of migrationFiles) {
  // Check if already applied
  const existing = db.prepare('SELECT name FROM schema_migrations WHERE name = ?').get(file);
  if (existing) {
    console.log(`  ✓ ${file} (already applied)`);
    continue;
  }
  
  const migrationPath = path.join(migrationsDir, file);
  const migrationSql = fs.readFileSync(migrationPath, 'utf8');
  
  // Run in transaction
  const transaction = db.transaction(() => {
    try {
      db.exec(migrationSql);
      db.prepare('INSERT INTO schema_migrations (name) VALUES (?)').run(file);
      console.log(`  ✓ ${file} applied`);
    } catch (error) {
      console.error(`  ✗ ${file} failed:`, error.message);
      throw error;
    }
  });
  
  try {
    transaction();
  } catch (error) {
    console.error(`Migration ${file} failed:`, error);
    throw error;
  }
}

// Create test data
console.log('Creating test data...');
const now = new Date().toISOString();

// 1. Create test warehouse
const warehouseId = randomUUID();
db.prepare(`
  INSERT INTO warehouses (id, name, code, address, is_default, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`).run(warehouseId, 'Test Warehouse', 'WH-001', 'Test Address', 1, now, now);
console.log('  ✓ Test warehouse created');

// 2. Create test user/profile
const userId = randomUUID();
db.prepare(`
  INSERT INTO profiles (id, username, full_name, email, role, is_active, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`).run(
  userId,
  'testuser',
  'Test User',
  'test@test.local',
  'cashier',
  1,
  now,
  now
);
console.log('  ✓ Test user created (username: testuser)');

// Also create in users table if it exists (for compatibility)
try {
  db.prepare(`
    INSERT INTO users (id, username, password_hash, full_name, email, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    userId,
    'testuser',
    '5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8', // SHA256('password')
    'Test User',
    'test@test.local',
    1,
    now,
    now
  );
  console.log('  ✓ Test user also added to users table (password: password)');
} catch (error) {
  // users table might not exist or have different schema, that's OK
  console.log('  ⚠ users table not available (using profiles only)');
}

// 3. Create test category
const categoryId = randomUUID();
db.prepare(`
  INSERT INTO categories (id, name, description, color, created_at)
  VALUES (?, ?, ?, ?, ?)
`).run(categoryId, 'Test Category', 'Test category for QA', '#000000', now);
console.log('  ✓ Test category created');

// 4. Create test products with stock tracking
const products = [
  { name: 'TEST-Product-A', sku: 'TEST-A', price: 10.00, stock: 10 },
  { name: 'TEST-Product-B', sku: 'TEST-B', price: 20.00, stock: 15 },
  { name: 'TEST-Product-C', sku: 'TEST-C', price: 30.00, stock: 5 },
];

const productIds = [];
for (const product of products) {
  const productId = randomUUID();
  productIds.push({ id: productId, ...product });
  
  db.prepare(`
    INSERT INTO products (
      id, name, sku, category_id, purchase_price, sale_price, 
      track_stock, min_stock_level, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    productId,
    product.name,
    product.sku,
    categoryId,
    product.price * 0.7, // 70% of sale price
    product.price,
    1, // track_stock = true
    2, // min_stock_level
    now,
    now
  );
  
  // Create stock balance
  db.prepare(`
    INSERT INTO stock_balances (
      id, product_id, warehouse_id, quantity, last_movement_at, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    randomUUID(),
    productId,
    warehouseId,
    product.stock,
    now,
    now,
    now
  );
  
  console.log(`  ✓ Created ${product.name} with stock: ${product.stock}`);
}

// 5. Set allow_negative_stock = 0 (disabled)
db.prepare(`
  INSERT OR REPLACE INTO settings (key, value, description, updated_at)
  VALUES (?, ?, ?, ?)
`).run('allow_negative_stock', '0', 'Disallow negative stock for testing', now);
console.log('  ✓ Settings: allow_negative_stock = 0');

// Save product IDs to a file for reference
const testDataPath = path.join(__dirname, '..', 'test_data.json');
fs.writeFileSync(testDataPath, JSON.stringify({
  warehouseId,
  userId,
  categoryId,
  products: productIds,
  dbPath: testDbPath
}, null, 2));
console.log(`\n✓ Test data saved to: ${testDataPath}`);

console.log('\n=== Test Database Setup Complete ===');
console.log(`Database: ${testDbPath}`);
console.log(`\nTest Products:`);
productIds.forEach(p => {
  console.log(`  - ${p.name} (${p.sku}): Stock = ${p.stock}, ID = ${p.id}`);
});
console.log(`\nTo run verification:`);
console.log(`  node scripts/run_verify_stock.cjs "${testDbPath}"`);

db.close();


const { getDb } = require('./open.cjs');
const { randomUUID } = require('crypto');

// Use Node.js built-in crypto.randomUUID() (Node 14.17.0+)
// No external dependency needed
const uuidv4 = () => randomUUID();

/**
 * Seed default data into the database
 * This function is idempotent - safe to run multiple times
 */
function seed() {
  const db = getDb();

  console.log('Seeding default data...');

  // Seed default admin user
  seedAdminUser(db);

  // Seed default categories
  seedDefaultCategories(db);

  // Seed default warehouse
  seedDefaultWarehouse(db);

  // Seed default units
  seedDefaultUnits(db);

  // Seed sample products (only if products table is empty - for development)
  seedSampleProducts(db);

  console.log('Seeding completed');
}

/**
 * Seed default admin user (idempotent)
 */
function seedAdminUser(db) {
  // Check if admin user already exists
  const existingAdmin = db
    .prepare('SELECT id FROM profiles WHERE username = ?')
    .get('admin');

  if (existingAdmin) {
    console.log('  ✓ Admin user already exists');
    return;
  }

  const adminId = uuidv4();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO profiles (
      id, username, full_name, email, role, is_active, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    adminId,
    'admin',
    'System Administrator',
    'admin@postizimi.local',
    'admin', // role
    1, // is_active = true
    now,
    now
  );

  console.log('  ✓ Admin user created (username: admin)');
}

/**
 * Seed default categories (idempotent)
 */
function seedDefaultCategories(db) {
  const defaultCategories = [
    { name: 'Uncategorized', description: 'Default category for products without a category', color: '#9CA3AF' },
    { name: 'Food & Beverages', description: 'Food and beverage products', color: '#F59E0B' },
    { name: 'Electronics', description: 'Electronic items', color: '#3B82F6' },
    { name: 'Clothing', description: 'Clothing and apparel', color: '#EC4899' },
    { name: 'Household', description: 'Household items', color: '#10B981' },
  ];

  let createdCount = 0;

  for (const category of defaultCategories) {
    // Check if category already exists
    const existing = db
      .prepare('SELECT id FROM categories WHERE name = ?')
      .get(category.name);

    if (existing) {
      continue;
    }

    const categoryId = uuidv4();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO categories (
        id, name, description, color, created_at
      ) VALUES (?, ?, ?, ?, ?)
    `).run(
      categoryId,
      category.name,
      category.description,
      category.color,
      now
    );

    createdCount++;
  }

  if (createdCount > 0) {
    console.log(`  ✓ Created ${createdCount} default category/categories`);
  } else {
    console.log('  ✓ Default categories already exist');
  }
}

/**
 * Seed default warehouse (idempotent)
 */
function seedDefaultWarehouse(db) {
  // Check if any warehouse exists
  const existingWarehouse = db
    .prepare('SELECT id FROM warehouses LIMIT 1')
    .get();

  if (existingWarehouse) {
    console.log('  ✓ Warehouse already exists');
    return;
  }

  const warehouseId = uuidv4();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO warehouses (
      id, code, name, address, is_default, is_active, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    warehouseId,
    'MAIN',
    'Asosiy ombor',
    null,
    1, // is_default = true
    1, // is_active = true
    now,
    now
  );

  console.log('  ✓ Default warehouse created (code: MAIN)');
}

/**
 * Seed default units (idempotent)
 */
function seedDefaultUnits(db) {
  const defaultUnits = [
    { code: 'pcs', name: 'Dona', symbol: 'dona', is_base: 1 },
    { code: 'kg', name: 'Kilogramm', symbol: 'kg', is_base: 0 },
    { code: 'g', name: 'Gramm', symbol: 'g', is_base: 0 },
    { code: 'L', name: 'Litr', symbol: 'L', is_base: 0 },
    { code: 'mL', name: 'Millilitr', symbol: 'mL', is_base: 0 },
    { code: 'm', name: 'Metr', symbol: 'm', is_base: 0 },
    { code: 'box', name: 'Quti', symbol: 'quti', is_base: 0 },
    { code: 'pack', name: "To'plam", symbol: "to'p", is_base: 0 },
  ];

  let createdCount = 0;

  for (const unit of defaultUnits) {
    // Check if unit already exists
    const existing = db
      .prepare('SELECT id FROM units WHERE code = ?')
      .get(unit.code);

    if (existing) {
      continue;
    }

    const unitId = uuidv4();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO units (
        id, code, name, symbol, is_base, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      unitId,
      unit.code,
      unit.name,
      unit.symbol,
      unit.is_base,
      now
    );

    createdCount++;
  }

  if (createdCount > 0) {
    console.log(`  ✓ Created ${createdCount} default unit(s)`);
  } else {
    console.log('  ✓ Default units already exist');
  }
}

/**
 * Seed sample products for development/testing (idempotent)
 * Only creates products if products table is empty
 */
function seedSampleProducts(db) {
  // Check if any products exist
  const existingProduct = db.prepare('SELECT COUNT(*) as count FROM products').get();
  if (existingProduct.count > 0) {
    console.log(`  ✓ Products already exist (${existingProduct.count}), skipping sample products`);
    return;
  }

  // Get default category
  const defaultCategory = db.prepare('SELECT id FROM categories LIMIT 1').get();
  if (!defaultCategory) {
    console.warn('  ⚠️ No categories found, cannot seed sample products');
    return;
  }

  // Get default warehouse for inventory movements
  const defaultWarehouse = db.prepare('SELECT id FROM warehouses WHERE is_default = 1 LIMIT 1').get()
    || db.prepare('SELECT id FROM warehouses LIMIT 1').get();

  const sampleProducts = [
    {
      name: 'Coca-Cola 0.5L',
      sku: 'PROD-001',
      barcode: '8690123456789',
      category_id: defaultCategory.id,
      purchase_price: 5000,
      sale_price: 8000,
      unit: 'pcs',
      min_stock_level: 10,
      track_stock: 1,
      initial_stock: 50,
    },
    {
      name: 'Pepsi 0.5L',
      sku: 'PROD-002',
      barcode: '8690123456790',
      category_id: defaultCategory.id,
      purchase_price: 4800,
      sale_price: 7500,
      unit: 'pcs',
      min_stock_level: 10,
      track_stock: 1,
      initial_stock: 30,
    },
    {
      name: 'Bread White',
      sku: 'PROD-003',
      barcode: '8690123456791',
      category_id: defaultCategory.id,
      purchase_price: 3000,
      sale_price: 5000,
      unit: 'pcs',
      min_stock_level: 20,
      track_stock: 1,
      initial_stock: 15,
    },
    {
      name: 'Milk 1L',
      sku: 'PROD-004',
      barcode: '8690123456792',
      category_id: defaultCategory.id,
      purchase_price: 12000,
      sale_price: 15000,
      unit: 'pcs',
      min_stock_level: 15,
      track_stock: 1,
      initial_stock: 25,
    },
    {
      name: 'Eggs (10 pcs)',
      sku: 'PROD-005',
      barcode: '8690123456793',
      category_id: defaultCategory.id,
      purchase_price: 15000,
      sale_price: 18000,
      unit: 'pcs',
      min_stock_level: 12,
      track_stock: 1,
      initial_stock: 20,
    },
    {
      name: 'Sugar 1kg',
      sku: 'PROD-006',
      barcode: '8690123456794',
      category_id: defaultCategory.id,
      purchase_price: 8000,
      sale_price: 10000,
      unit: 'pcs',
      min_stock_level: 10,
      track_stock: 1,
      initial_stock: 18,
    },
    {
      name: 'Tea 100g',
      sku: 'PROD-007',
      barcode: '8690123456795',
      category_id: defaultCategory.id,
      purchase_price: 12000,
      sale_price: 15000,
      unit: 'pcs',
      min_stock_level: 8,
      track_stock: 1,
      initial_stock: 12,
    },
    {
      name: 'Rice 1kg',
      sku: 'PROD-008',
      barcode: '8690123456796',
      category_id: defaultCategory.id,
      purchase_price: 10000,
      sale_price: 13000,
      unit: 'pcs',
      min_stock_level: 15,
      track_stock: 1,
      initial_stock: 22,
    },
  ];

  let createdCount = 0;
  const now = new Date().toISOString();

  for (const product of sampleProducts) {
    const productId = uuidv4();

    // Insert product
    db.prepare(`
      INSERT INTO products (
        id, sku, barcode, name, category_id, purchase_price, sale_price,
        unit, min_stock_level, track_stock, is_active, current_stock,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      productId,
      product.sku,
      product.barcode,
      product.name,
      product.category_id,
      product.purchase_price,
      product.sale_price,
      product.unit,
      product.min_stock_level,
      product.track_stock ? 1 : 0,
      1, // is_active
      product.initial_stock || 0,
      now,
      now
    );

    // Create initial inventory movement if warehouse exists and track_stock is enabled
    if (product.track_stock && defaultWarehouse && product.initial_stock > 0) {
      const movementId = uuidv4();
      const movementNumber = `MOV-${Date.now()}-${createdCount}`;

      db.prepare(`
        INSERT INTO inventory_movements (
          id, movement_number, product_id, warehouse_id, movement_type,
          quantity, before_quantity, after_quantity, reference_type,
          reason, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        movementId,
        movementNumber,
        productId,
        defaultWarehouse.id,
        'purchase', // movement_type
        product.initial_stock, // quantity (positive for purchase)
        0, // before_quantity
        product.initial_stock, // after_quantity
        'seed', // reference_type
        'Initial stock from seed data', // reason
        now
      );
    }

    createdCount++;
  }

  console.log(`  ✓ Created ${createdCount} sample products with initial stock`);
}

module.exports = {
  seed,
};

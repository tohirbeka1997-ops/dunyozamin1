/**
 * Seed N test products into the canonical database (userData/pos.db).
 *
 * Usage:
 *   npm run db:seed:testProducts -- 1000
 *
 * Notes:
 * - Runs inside Electron so userData path is correct.
 * - Inserts are done in a single transaction for speed.
 * - Products are prefixed with SKU: TESTSEED-000001 ...
 * - Safe with schema differences: detects existing columns before INSERT.
 */

const { app } = require('electron');
const path = require('path');
const { randomUUID } = require('crypto');

// IMPORTANT:
// When running via `electron <script>`, Electron's default app name is "Electron",
// which would make userData point to ...\AppData\Roaming\Electron.
// Force the same app name as our packaged app so we target the correct DB.
try {
  // electron/scripts/* -> project root
  const pkg = require(path.resolve(__dirname, '..', '..', 'package.json'));
  if (pkg?.name) {
    app.setName(pkg.name);
  }
} catch (e) {
  // ignore
}

function uuid() {
  return randomUUID();
}

function pad(num, size) {
  return String(num).padStart(size, '0');
}

function pickCategoryId(db) {
  const row = db.prepare('SELECT id FROM categories WHERE is_active = 1 ORDER BY created_at ASC LIMIT 1').get();
  return row?.id || null;
}

function pickUnit(db) {
  // Prefer unit_id if present
  const unitRow = db.prepare("SELECT id, code FROM units ORDER BY CASE WHEN code='pcs' THEN 0 ELSE 1 END, created_at ASC LIMIT 1").get();
  return unitRow ? { unit_id: unitRow.id, unit: unitRow.code } : { unit_id: null, unit: 'pcs' };
}

function getColumns(db, table) {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all();
  return new Set(rows.map((r) => r.name));
}

function buildInsertProducts(db, cols) {
  // Build dynamic INSERT based on available columns
  const fields = [];
  const placeholders = [];

  const add = (name) => {
    fields.push(name);
    placeholders.push('?');
  };

  add('id');
  add('sku');
  if (cols.has('barcode')) add('barcode');
  add('name');
  if (cols.has('description')) add('description');
  if (cols.has('category_id')) add('category_id');
  if (cols.has('unit_id')) add('unit_id');
  if (cols.has('unit')) add('unit');
  if (cols.has('purchase_price')) add('purchase_price');
  if (cols.has('sale_price')) add('sale_price');
  if (cols.has('current_stock')) add('current_stock');
  if (cols.has('min_stock_level')) add('min_stock_level');
  if (cols.has('max_stock_level')) add('max_stock_level');
  if (cols.has('track_stock')) add('track_stock');
  if (cols.has('is_active')) add('is_active');
  if (cols.has('created_at')) add('created_at');
  if (cols.has('updated_at')) add('updated_at');

  const sql = `INSERT INTO products (${fields.join(', ')}) VALUES (${placeholders.join(', ')})`;
  return { sql, fields };
}

function pickWarehouseId(db) {
  const w =
    db.prepare('SELECT id FROM warehouses WHERE is_default = 1 LIMIT 1').get() ||
    db.prepare('SELECT id FROM warehouses ORDER BY created_at ASC LIMIT 1').get();
  return w?.id || null;
}

function buildInsertMovement(cols) {
  const fields = [];
  const placeholders = [];
  const add = (name) => {
    fields.push(name);
    placeholders.push('?');
  };

  add('id');
  add('product_id');
  if (cols.has('warehouse_id')) add('warehouse_id');
  add('movement_number');
  add('movement_type');
  add('quantity');
  if (cols.has('before_quantity')) add('before_quantity');
  if (cols.has('after_quantity')) add('after_quantity');
  if (cols.has('reference_type')) add('reference_type');
  if (cols.has('reference_id')) add('reference_id');
  if (cols.has('reason')) add('reason');
  if (cols.has('notes')) add('notes');
  if (cols.has('created_by')) add('created_by');
  if (cols.has('created_at')) add('created_at');

  const sql = `INSERT INTO inventory_movements (${fields.join(', ')}) VALUES (${placeholders.join(', ')})`;
  return { sql, fields };
}

function seedTestProducts(count) {
  const { getDb } = require('../db/open.cjs');
  const db = getDb();

  const cols = getColumns(db, 'products');
  const movCols = getColumns(db, 'inventory_movements');
  const { unit_id, unit } = pickUnit(db);
  const categoryId = pickCategoryId(db);
  const warehouseId = pickWarehouseId(db);
  const now = new Date().toISOString();

  // Find next index to avoid SKU collisions
  const prefix = 'TESTSEED-';
  const existingMax = db
    .prepare(`SELECT MAX(CAST(SUBSTR(sku, ${prefix.length + 1}) AS INTEGER)) AS maxN FROM products WHERE sku LIKE ?`)
    .get(`${prefix}%`);
  const startN = Number(existingMax?.maxN || 0) + 1;

  const { sql, fields } = buildInsertProducts(db, cols);
  const stmt = db.prepare(sql);

  const { sql: movSql, fields: movFields } = buildInsertMovement(movCols);
  const movStmt = db.prepare(movSql);

  const insertMany = db.transaction((n) => {
    for (let i = 0; i < n; i++) {
      const idx = startN + i;
      const sku = `${prefix}${pad(idx, 6)}`;
      const barcode = `99${pad(idx, 10)}`; // 12 digits total, unique per idx
      const name = `Test Product ${pad(idx, 6)}`;
      const purchase = 5000 + (idx % 50) * 100;
      const sale = Math.round(purchase * 1.3);
      const stock = (idx % 20) * 3; // 0..57

      const productId = uuid();
      const row = [];
      for (const f of fields) {
        switch (f) {
          case 'id':
            row.push(productId);
            break;
          case 'sku':
            row.push(sku);
            break;
          case 'barcode':
            row.push(barcode);
            break;
          case 'name':
            row.push(name);
            break;
          case 'description':
            row.push('Auto-generated test product');
            break;
          case 'category_id':
            row.push(categoryId);
            break;
          case 'unit_id':
            row.push(unit_id);
            break;
          case 'unit':
            row.push(unit || 'pcs');
            break;
          case 'purchase_price':
            row.push(purchase);
            break;
          case 'sale_price':
            row.push(sale);
            break;
          case 'current_stock':
            row.push(stock);
            break;
          case 'min_stock_level':
            row.push(0);
            break;
          case 'max_stock_level':
            row.push(null);
            break;
          case 'track_stock':
            row.push(1);
            break;
          case 'is_active':
            row.push(1);
            break;
          case 'created_at':
            row.push(now);
            break;
          case 'updated_at':
            row.push(now);
            break;
          default:
            row.push(null);
        }
      }

      stmt.run(row);

      // Seed stock via inventory_movements so v_product_stock reflects it
      // (Stock views are computed from inventory_movements, not products.current_stock)
      const movementNumber = `MOV-TEST-${pad(idx, 6)}`;
      const movRow = [];
      for (const f of movFields) {
        switch (f) {
          case 'id':
            movRow.push(uuid());
            break;
          case 'product_id':
            movRow.push(productId);
            break;
          case 'warehouse_id':
            movRow.push(warehouseId);
            break;
          case 'movement_number':
            movRow.push(movementNumber);
            break;
          case 'movement_type':
            movRow.push('adjustment');
            break;
          case 'quantity':
            movRow.push(stock);
            break;
          case 'before_quantity':
            movRow.push(0);
            break;
          case 'after_quantity':
            movRow.push(stock);
            break;
          case 'reference_type':
            movRow.push('seed');
            break;
          case 'reference_id':
            movRow.push(null);
            break;
          case 'reason':
            movRow.push('test seed');
            break;
          case 'notes':
            movRow.push('Auto-generated test stock (seed)');
            break;
          case 'created_by':
            movRow.push(null);
            break;
          case 'created_at':
            movRow.push(now);
            break;
          default:
            movRow.push(null);
        }
      }
      movStmt.run(movRow);
    }
  });

  insertMany(count);

  const total = db.prepare('SELECT COUNT(*) AS c FROM products').get().c;
  const seeded = db.prepare("SELECT COUNT(*) AS c FROM products WHERE sku LIKE 'TESTSEED-%'").get().c;
  console.log(`✅ Seeded ${count} test products.`);
  console.log(`   Total products now: ${total}`);
  console.log(`   TESTSEED-* products: ${seeded}`);
}

function main() {
  const raw = process.argv[2];
  const n = Math.max(1, Math.min(50000, Number(raw || 1000)));
  console.log(`Seeding ${n} test products...`);
  seedTestProducts(n);
}

if (app.isReady()) {
  try {
    main();
  } finally {
    setTimeout(() => app.quit(), 300);
  }
} else {
  app.once('ready', () => {
    try {
      main();
    } finally {
      setTimeout(() => app.quit(), 300);
    }
  });
}



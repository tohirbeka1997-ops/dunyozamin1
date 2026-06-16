/**
 * Normalize product image URLs for marketplace / public API.
 *
 * - product-image://file.jpg  → /product-images/file.jpg
 * - data:image/...            → NULL (not served online)
 * - product_images.url        → same rules
 *
 * Usage: npm run db:migrate:productImages
 *        npm run db:migrate:productImages -- --dry-run
 */

const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { getNewDbPath } = require('../db/dbPath.cjs');
const { getProductImagesDir } = require('../lib/productImagesDir.cjs');

try {
  const pkg = require(path.resolve(__dirname, '..', '..', 'package.json'));
  if (pkg?.name) app.setName(pkg.name);
} catch {
  // ignore
}

function normalizeStoredUrl(url) {
  if (!url || typeof url !== 'string') return { next: null, action: 'skip' };
  const u = url.trim();
  if (!u) return { next: null, action: 'clear' };
  if (u.startsWith('data:')) return { next: null, action: 'clear_data' };
  if (u.startsWith('http://') || u.startsWith('https://')) return { next: u, action: 'ok_http' };
  if (u.startsWith('/product-images/')) return { next: u, action: 'ok_path' };
  if (u.startsWith('product-image://')) {
    const fn = path.basename(decodeURIComponent(u.replace(/^product-image:\/\//, ''))).replace(/\.\./g, '');
    if (!fn) return { next: null, action: 'clear' };
    return { next: `/product-images/${fn}`, action: 'migrate_protocol' };
  }
  if (u.startsWith('file://')) {
    const fn = path.basename(u).replace(/\.\./g, '');
    if (!fn) return { next: null, action: 'clear' };
    return { next: `/product-images/${fn}`, action: 'migrate_file' };
  }
  return { next: u, action: 'unchanged' };
}

function ensureFileInCatalogDir(fileName) {
  const imagesDir = getProductImagesDir();
  const dest = path.join(imagesDir, fileName);
  if (fs.existsSync(dest)) return true;
  const legacyDir = path.join(app.getPath('userData'), 'product-images');
  const legacy = path.join(legacyDir, fileName);
  if (legacyDir !== imagesDir && fs.existsSync(legacy)) {
    fs.mkdirSync(imagesDir, { recursive: true });
    fs.copyFileSync(legacy, dest);
    return true;
  }
  return false;
}

function migrateTable(db, table, idCol, urlCol, dryRun) {
  const stats = { scanned: 0, updated: 0, cleared: 0, missingFile: 0 };
  let rows = [];
  try {
    rows = db.prepare(`SELECT ${idCol} AS id, ${urlCol} AS url FROM ${table} WHERE ${urlCol} IS NOT NULL AND TRIM(${urlCol}) != ''`).all();
  } catch (e) {
    if (String(e.message || '').includes('no such')) return stats;
    throw e;
  }

  const update = db.prepare(`UPDATE ${table} SET ${urlCol} = ? WHERE ${idCol} = ?`);

  for (const row of rows) {
    stats.scanned += 1;
    const { next, action } = normalizeStoredUrl(row.url);
    if (action === 'ok_http' || action === 'ok_path' || action === 'unchanged') {
      if (next && next !== row.url && next.startsWith('/product-images/')) {
        const fn = path.basename(next);
        if (!ensureFileInCatalogDir(fn)) stats.missingFile += 1;
        if (!dryRun) update.run(next, row.id);
        stats.updated += 1;
      }
      continue;
    }
    if (action === 'clear' || action === 'clear_data') {
      if (!dryRun) update.run(null, row.id);
      stats.cleared += 1;
      continue;
    }
    if (next && next.startsWith('/product-images/')) {
      const fn = path.basename(next);
      if (!ensureFileInCatalogDir(fn)) stats.missingFile += 1;
      if (!dryRun && next !== row.url) update.run(next, row.id);
      if (next !== row.url) stats.updated += 1;
    }
  }
  return stats;
}

app.whenReady().then(() => {
  const dryRun = process.argv.includes('--dry-run');
  const dbPath = getNewDbPath(app);
  if (!fs.existsSync(dbPath)) {
    console.error('DB not found:', dbPath);
    process.exit(1);
  }

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  console.log(dryRun ? '[dry-run] Product image URL migration' : 'Product image URL migration');
  console.log('DB:', dbPath);
  console.log('Images dir:', getProductImagesDir());
  console.log('');

  const products = migrateTable(db, 'products', 'id', 'image_url', dryRun);
  const images = migrateTable(db, 'product_images', 'id', 'url', dryRun);

  console.log('products.image_url:', products);
  console.log('product_images.url:', images);
  console.log('');
  console.log(dryRun ? 'No changes written (dry-run).' : 'Done.');

  db.close();
  app.quit();
});

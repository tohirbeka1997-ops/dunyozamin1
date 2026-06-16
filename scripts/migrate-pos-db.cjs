/**
 * Loyiha ildizidagi pos.db uchun barcha SQL migratsiyalarni ishga tushiradi.
 * VPS: cd /opt/pos && node scripts/migrate-pos-db.cjs
 *
 * Yo'l: .env dagi PUBLIC_API_DB_PATH yoki resolvePosDbPath() (POS_DATA_DIR/pos.db yoki multi-tenant tenant DB)
 */
const path = require('path');
const fs = require('fs');

const root = path.resolve(__dirname, '..');
try {
  require('dotenv').config({ path: path.join(root, '.env') });
} catch (_) {}

const Database = require('better-sqlite3');
const { runMigrations } = require('../electron/db/migrate.cjs');
const { resolvePosDbPath } = require('../electron/lib/resolvePosDbPath.cjs');

function resolveDbPath() {
  const arg = process.argv[2];
  if (arg) return path.resolve(arg);
  return resolvePosDbPath();
}

const filePath = resolveDbPath();
if (!fs.existsSync(filePath)) {
  console.error('[migrate-pos-db] Fayl topilmadi:', filePath);
  console.error('  PUBLIC_API_DB_PATH yoki POS_DATA_DIR ni .env da yozing yoki: node scripts/migrate-pos-db.cjs /to/liq/yo/l/pos.db');
  process.exit(1);
}

console.log('[migrate-pos-db]', filePath);
const db = new Database(filePath);
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 8000');

try {
  runMigrations(db);
  console.log('[migrate-pos-db] OK');
} finally {
  db.close();
}

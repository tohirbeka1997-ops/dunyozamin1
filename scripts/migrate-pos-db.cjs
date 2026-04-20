/**
 * Loyiha ildizidagi pos.db uchun barcha SQL migratsiyalarni ishga tushiradi.
 * VPS: cd /opt/pos && node scripts/migrate-pos-db.cjs
 *
 * Yo'l: .env dagi PUBLIC_API_DB_PATH yoki POS_DATA_DIR/pos.db yoki 1-arg yoki cwd/pos.db
 */
const path = require('path');
const fs = require('fs');

const root = path.resolve(__dirname, '..');
try {
  require('dotenv').config({ path: path.join(root, '.env') });
} catch (_) {}

const Database = require('better-sqlite3');
const { runMigrations } = require('../electron/db/migrate.cjs');

function resolveDbPath() {
  const explicit = process.env.PUBLIC_API_DB_PATH && String(process.env.PUBLIC_API_DB_PATH).trim();
  if (explicit) return path.resolve(explicit);
  const dataDir = process.env.POS_DATA_DIR && String(process.env.POS_DATA_DIR).trim();
  if (dataDir) return path.join(path.resolve(dataDir), 'pos.db');
  const arg = process.argv[2];
  if (arg) return path.resolve(arg);
  return path.join(process.cwd(), 'pos.db');
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

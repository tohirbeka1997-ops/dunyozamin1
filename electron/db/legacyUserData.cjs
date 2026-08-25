'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

/**
 * Legacy Electron userData folder names from prior package.json `name` values.
 * When the app is renamed (miaoda-react-admin → pos-tizimi), Electron moves
 * userData to a new %APPDATA% folder; existing pos.db stays in the old folder.
 */
const LEGACY_USER_DATA_DIR_NAMES = ['miaoda-react-admin'];

const MIN_LEGACY_BYTES = 512 * 1024;

function pad2(n) {
  return String(n).padStart(2, '0');
}

function timestampForFilename(d = new Date()) {
  return (
    String(d.getFullYear()) +
    pad2(d.getMonth() + 1) +
    pad2(d.getDate()) +
    '-' +
    pad2(d.getHours()) +
    pad2(d.getMinutes()) +
    pad2(d.getSeconds())
  );
}

function resolveLegacyUserDataDirs(app) {
  const root = app.getPath('appData');
  return LEGACY_USER_DATA_DIR_NAMES.map((name) => path.join(root, name));
}

/**
 * Best legacy pos.db candidate (largest file wins when several exist).
 * @returns {string|null}
 */
function findLegacyDbPath(app) {
  let best = null;
  let bestSize = 0;

  for (const dir of resolveLegacyUserDataDirs(app)) {
    const dbPath = path.join(dir, 'pos.db');
    if (!fs.existsSync(dbPath)) continue;
    try {
      const size = fs.statSync(dbPath).size;
      if (size > bestSize) {
        bestSize = size;
        best = dbPath;
      }
    } catch {
      // ignore unreadable legacy paths
    }
  }

  return best;
}

function countProducts(dbPath) {
  try {
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      const row = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='products'")
        .get();
      if (!row) return 0;
      return Number(db.prepare('SELECT COUNT(*) AS c FROM products').get().c) || 0;
    } finally {
      db.close();
    }
  } catch {
    return -1;
  }
}

function shouldAdoptLegacy(targetPath, legacyPath) {
  if (!legacyPath || !fs.existsSync(legacyPath)) return false;

  const legacySize = fs.statSync(legacyPath).size;
  const legacyProducts = countProducts(legacyPath);

  if (!fs.existsSync(targetPath)) {
    return legacyProducts > 0 || legacySize >= MIN_LEGACY_BYTES;
  }

  const targetSize = fs.statSync(targetPath).size;
  const targetProducts = countProducts(targetPath);

  if (targetProducts === 0 && legacyProducts > 0) return true;
  if (targetProducts === 0 && legacySize > targetSize * 2 && legacySize >= MIN_LEGACY_BYTES) {
    return true;
  }

  return false;
}

function removeSidecarFiles(dbPath) {
  for (const suffix of ['-wal', '-shm']) {
    try {
      fs.unlinkSync(dbPath + suffix);
    } catch {
      // ignore
    }
  }
}

function safeReplaceDbFile(sourcePath, targetPath) {
  const adoptingPath = targetPath + '.adopting';
  removeSidecarFiles(adoptingPath);
  fs.copyFileSync(sourcePath, adoptingPath);
  removeSidecarFiles(targetPath);

  try {
    if (fs.existsSync(targetPath)) {
      fs.unlinkSync(targetPath);
    }
    fs.renameSync(adoptingPath, targetPath);
    return;
  } catch (renameError) {
    try {
      fs.copyFileSync(adoptingPath, targetPath);
      fs.unlinkSync(adoptingPath);
      return;
    } catch (copyError) {
      try {
        if (fs.existsSync(adoptingPath)) fs.unlinkSync(adoptingPath);
      } catch {
        // ignore cleanup failure
      }
      const err = new Error(
        `Could not replace ${targetPath}. Close other POS instances and restart. ` +
          `(${copyError.message || renameError.message})`,
      );
      err.cause = copyError;
      throw err;
    }
  }
}

function maybeAdoptLegacyProductImages(app) {
  const targetDir = path.join(app.getPath('userData'), 'product-images');
  if (fs.existsSync(targetDir)) {
    try {
      const entries = fs.readdirSync(targetDir);
      const hasImages = entries.some((name) => !name.startsWith('.') && /\.(jpe?g|png|gif|webp|bmp)$/i.test(name));
      if (hasImages) return { adopted: false, reason: 'exists' };
    } catch {
      return { adopted: false, reason: 'exists' };
    }
  }

  for (const legacyUserData of resolveLegacyUserDataDirs(app)) {
    const sourceDir = path.join(legacyUserData, 'product-images');
    if (!fs.existsSync(sourceDir)) continue;
    try {
      fs.cpSync(sourceDir, targetDir, { recursive: true });
      console.log(`[legacyUserData] Copied product-images from ${sourceDir}`);
      return { adopted: true, sourceDir, targetDir };
    } catch (error) {
      console.warn('[legacyUserData] product-images copy failed:', error?.message || error);
    }
  }

  return { adopted: false, reason: 'no_legacy_images' };
}

function backupExistingDb(targetPath) {
  const backupDir = path.join(path.dirname(targetPath), 'backups');
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
  const backupPath = path.join(backupDir, `pos-before-legacy-adopt-${timestampForFilename()}.db`);
  fs.copyFileSync(targetPath, backupPath);
  return backupPath;
}

/**
 * Copy legacy pos.db into the canonical userData path when the current DB is empty.
 * @returns {{ adopted: boolean, reason?: string, legacyPath?: string, backupPath?: string }}
 */
function maybeAdoptLegacyDatabase(app, targetPath) {
  const legacyPath = findLegacyDbPath(app);
  if (!legacyPath) {
    return { adopted: false, reason: 'no_legacy_db' };
  }

  const currentUserData = path.resolve(app.getPath('userData'));
  const resolvedLegacyDir = path.resolve(path.dirname(legacyPath));
  if (resolvedLegacyDir === currentUserData) {
    return { adopted: false, reason: 'already_in_user_data' };
  }

  if (!shouldAdoptLegacy(targetPath, legacyPath)) {
    return { adopted: false, reason: 'target_has_data', legacyPath };
  }

  const targetDir = path.dirname(targetPath);
  if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

  let backupPath = null;
  if (fs.existsSync(targetPath)) {
    backupPath = backupExistingDb(targetPath);
    removeSidecarFiles(targetPath);
  }

  console.log('');
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║        📦 ADOPTING LEGACY DATABASE (app rename)               ║');
  console.log('╠═══════════════════════════════════════════════════════════════╣');
  console.log('║ From: ' + legacyPath);
  console.log('║ To:   ' + targetPath);
  if (backupPath) console.log('║ Backup of empty DB: ' + backupPath);
  console.log('╚═══════════════════════════════════════════════════════════════╝');
  console.log('');

  safeReplaceDbFile(legacyPath, targetPath);
  removeSidecarFiles(targetPath);

  const products = countProducts(targetPath);
  console.log(`[legacyUserData] Adoption complete. products=${products}`);

  maybeAdoptLegacyProductImages(app);

  return { adopted: true, legacyPath, backupPath, products };
}

module.exports = {
  LEGACY_USER_DATA_DIR_NAMES,
  resolveLegacyUserDataDirs,
  findLegacyDbPath,
  maybeAdoptLegacyDatabase,
  countProducts,
  shouldAdoptLegacy,
  maybeAdoptLegacyProductImages,
};

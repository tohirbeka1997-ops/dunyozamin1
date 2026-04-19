/**
 * Migrate piece (non-weight) product barcodes from 20xxxxxxxxxxxxx -> 30xxxxxxxxxxxxx
 * to avoid collision with scale EAN-13 prefixes (20-29).
 *
 * This script:
 * - Runs inside Electron so userData/pos.db is targeted correctly.
 * - ONLY updates products whose barcode is a 13-digit numeric string starting with "20"
 * - Skips weight products (kg) based on unit code/symbol/name, or products.unit field
 * - Generates a deterministic new barcode by swapping the first 2 digits (20->30)
 *   and recomputing the EAN-13 check digit.
 * - If deterministic barcode collides, falls back to random 300- prefix generation.
 *
 * Usage:
 *   electron electron/scripts/migrate-piece-barcodes-to-30-prefix.cjs --dry-run
 *   electron electron/scripts/migrate-piece-barcodes-to-30-prefix.cjs
 */

const { app } = require('electron');
const path = require('path');

// Ensure we target the real app userData (same trick as seed scripts)
try {
  const pkg = require(path.resolve(__dirname, '..', '..', 'package.json'));
  if (pkg?.name) app.setName(pkg.name);
} catch {}

function parseArgs(argv) {
  const out = { dryRun: false };
  for (const a of argv) {
    if (a === '--dry-run' || a === '--dryrun') out.dryRun = true;
  }
  return out;
}

function computeEan13CheckDigit(base12) {
  const s = String(base12 ?? '');
  if (!/^\d{12}$/.test(s)) return null;
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const digit = Number(s[i]);
    const pos = i + 1; // 1-based
    sum += pos % 2 === 0 ? digit * 3 : digit;
  }
  return (10 - (sum % 10)) % 10;
}

function swap20to30Deterministic(barcode13) {
  const b = String(barcode13 ?? '').trim();
  if (!/^\d{13}$/.test(b)) return null;
  if (!b.startsWith('20')) return null;
  const base12 = `30${b.slice(2, 12)}`; // keep next 10 digits
  const check = computeEan13CheckDigit(base12);
  if (check === null) return null;
  return `${base12}${check}`;
}

function isWeightUnitToken(s) {
  const v = String(s ?? '').trim().toLowerCase();
  if (!v) return false;
  // Common representations we see in Uzbek/RU deployments
  return v === 'kg' || v === 'кг' || v === 'килограмм' || v === 'kilogram' || v === 'kilogramm';
}

function migrate() {
  const { getDb } = require('../db/open.cjs');
  const db = getDb();

  const hasUnits = (() => {
    try {
      const r = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='units'").get();
      return !!r;
    } catch {
      return false;
    }
  })();

  // Pull candidates: barcode starts with 20 and numeric 13 digits
  // Note: enforce LENGTH=13 + GLOB digits to avoid junk barcodes.
  const rows = db
    .prepare(
      `
      SELECT
        p.id,
        p.name,
        p.sku,
        p.barcode,
        p.unit AS product_unit,
        ${hasUnits ? 'u.code AS unit_code, u.name AS unit_name, u.symbol AS unit_symbol' : 'NULL AS unit_code, NULL AS unit_name, NULL AS unit_symbol'}
      FROM products p
      ${hasUnits ? 'LEFT JOIN units u ON u.id = p.unit_id' : ''}
      WHERE
        p.barcode IS NOT NULL
        AND LENGTH(p.barcode) = 13
        AND p.barcode GLOB '[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]'
        AND SUBSTR(p.barcode, 1, 2) = '20'
    `
    )
    .all();

  const stats = {
    totalCandidates: rows.length,
    skippedWeight: 0,
    skippedInvalid: 0,
    updated: 0,
    conflicts: 0,
  };

  const { dryRun } = parseArgs(process.argv.slice(2));
  console.log(`Found ${rows.length} products with 13-digit barcodes starting with "20".`);
  console.log(`Dry run: ${dryRun ? 'YES' : 'NO'}`);

  const updateStmt = db.prepare('UPDATE products SET barcode = ?, updated_at = COALESCE(updated_at, ?) WHERE id = ?');
  const now = new Date().toISOString();

  const existsStmt = db.prepare('SELECT id FROM products WHERE barcode = ? LIMIT 1');

  // Random generator fallback (300 prefix) (match ProductsService logic)
  const randomEan13 = () => {
    const nine = String(Math.floor(Math.random() * 1_000_000_000)).padStart(9, '0');
    const base12 = `300${nine}`;
    const check = computeEan13CheckDigit(base12);
    return `${base12}${check}`;
  };

  const tx = db.transaction(() => {
    for (const r of rows) {
      const unitTokens = [r.product_unit, r.unit_code, r.unit_name, r.unit_symbol];
      const isWeight = unitTokens.some(isWeightUnitToken);
      if (isWeight) {
        stats.skippedWeight++;
        continue;
      }

      const next = swap20to30Deterministic(r.barcode);
      if (!next) {
        stats.skippedInvalid++;
        continue;
      }

      // Ensure uniqueness; if collision, fall back to random 300-prefix
      let finalBarcode = next;
      const conflictRow = existsStmt.get(finalBarcode);
      if (conflictRow && conflictRow.id !== r.id) {
        stats.conflicts++;
        for (let i = 0; i < 50; i++) {
          const candidate = randomEan13();
          const e = existsStmt.get(candidate);
          if (!e) {
            finalBarcode = candidate;
            break;
          }
        }
      }

      if (dryRun) {
        stats.updated++;
        continue;
      }

      updateStmt.run(finalBarcode, now, r.id);
      stats.updated++;
    }
  });

  tx();

  console.log('---');
  console.log('Done.');
  console.log(stats);
}

function main() {
  migrate();
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


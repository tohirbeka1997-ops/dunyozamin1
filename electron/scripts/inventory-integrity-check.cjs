/**
 * Nightly inventory integrity check (read-only).
 *
 * Usage (via Electron runtime):
 *   electron ./electron/scripts/inventory-integrity-check.cjs
 */
const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { getDbPath, getUserDataPath, assertDbPathSafe } = require('../db/dbPath.cjs');
const InventoryService = require('../services/inventoryService.cjs');

function writeLog(filePath, lines) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
  } catch (error) {
    console.error('Failed to write integrity log:', error.message || error);
  }
}

function runCheck() {
  const userDataPath = getUserDataPath(app);
  const dbPath = getDbPath(app);
  assertDbPathSafe(dbPath, app);

  if (!fs.existsSync(dbPath)) {
    console.log('Database file not found:', dbPath);
    process.exit(0);
  }

  const db = new Database(dbPath);
  const inventoryService = new InventoryService(db);

  const result = inventoryService.validateInventoryIntegrity();
  const now = new Date();
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const logPath = path.join(userDataPath, 'logs', `inventory-integrity-${stamp}.log`);

  const lines = [];
  lines.push('Inventory Integrity Check');
  lines.push(`Timestamp: ${now.toISOString()}`);
  lines.push(`Database: ${dbPath}`);
  lines.push(`AllowNegative: ${result.allow_negative ? 'true' : 'false'}`);
  lines.push('');
  lines.push(`OK: ${result.ok ? 'true' : 'false'}`);
  lines.push(`Mismatches: ${result.mismatches?.length || 0}`);
  lines.push(`NegativeStocks: ${result.negative_stocks?.length || 0}`);
  lines.push(`OrphanMovements: ${result.orphan_movements?.length || 0}`);
  lines.push(`OrphanMovementWarehouses: ${result.orphan_movement_warehouses?.length || 0}`);
  lines.push(`OrphanBalances: ${result.orphan_balances?.length || 0}`);
  lines.push('');

  if (result.mismatches?.length) {
    lines.push('Mismatches:');
    for (const m of result.mismatches) {
      lines.push(`- product=${m.product_id} warehouse=${m.warehouse_id} movements=${m.movements_qty} balance=${m.balance_qty}`);
    }
    lines.push('');
  }

  if (result.negative_stocks?.length) {
    lines.push('Negative stock:');
    for (const n of result.negative_stocks) {
      lines.push(`- product=${n.product_id} warehouse=${n.warehouse_id} qty=${n.quantity} source=${n.source}`);
    }
    lines.push('');
  }

  if (result.orphan_movements?.length) {
    lines.push('Orphan movements (missing products):');
    for (const o of result.orphan_movements) {
      lines.push(`- movement=${o.id} product=${o.product_id} warehouse=${o.warehouse_id}`);
    }
    lines.push('');
  }

  if (result.orphan_movement_warehouses?.length) {
    lines.push('Orphan movements (missing warehouses):');
    for (const o of result.orphan_movement_warehouses) {
      lines.push(`- movement=${o.id} product=${o.product_id} warehouse=${o.warehouse_id}`);
    }
    lines.push('');
  }

  if (result.orphan_balances?.length) {
    lines.push('Orphan balances (missing products):');
    for (const o of result.orphan_balances) {
      lines.push(`- balance=${o.id} product=${o.product_id} warehouse=${o.warehouse_id}`);
    }
    lines.push('');
  }

  writeLog(logPath, lines);

  console.log(`Inventory integrity check complete. Log: ${logPath}`);
  process.exit(result.ok ? 0 : 2);
}

app.whenReady().then(runCheck).catch((error) => {
  console.error('Inventory integrity check failed:', error.message || error);
  process.exit(1);
});

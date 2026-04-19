/**
 * Remove test products created by seed-test-products.cjs (SKU prefix: TESTSEED-)
 *
 * Usage:
 *   npm run db:cleanup:testProducts
 */

const { app } = require('electron');
const path = require('path');

// Force packaged app name so userData points to the real app DB folder.
try {
  const pkg = require(path.resolve(__dirname, '..', '..', 'package.json'));
  if (pkg?.name) {
    app.setName(pkg.name);
  }
} catch (e) {
  // ignore
}

function cleanup() {
  const { getDb } = require('../db/open.cjs');
  const db = getDb();

  const before = db.prepare("SELECT COUNT(*) AS c FROM products WHERE sku LIKE 'TESTSEED-%'").get().c;
  const tx = db.transaction(() => {
    // Remove dependent rows first if FK exists (order_items etc.) - best effort.
    // Most of the time these test products are not used in orders.
    try {
      db.prepare(
        "DELETE FROM order_items WHERE product_id IN (SELECT id FROM products WHERE sku LIKE 'TESTSEED-%')"
      ).run();
    } catch (e) {}
    try {
      db.prepare(
        "DELETE FROM inventory_movements WHERE product_id IN (SELECT id FROM products WHERE sku LIKE 'TESTSEED-%')"
      ).run();
    } catch (e) {}

    db.prepare("DELETE FROM products WHERE sku LIKE 'TESTSEED-%'").run();
  });

  tx();
  const after = db.prepare("SELECT COUNT(*) AS c FROM products WHERE sku LIKE 'TESTSEED-%'").get().c;
  console.log(`✅ Cleanup done. Before: ${before}, after: ${after}`);
}

if (app.isReady()) {
  try {
    cleanup();
  } finally {
    setTimeout(() => app.quit(), 300);
  }
} else {
  app.once('ready', () => {
    try {
      cleanup();
    } finally {
      setTimeout(() => app.quit(), 300);
    }
  });
}



-- Inventory revision: scan-event idempotency + search indexes
-- 133_inventory_revision_scan_search.sql

CREATE TABLE IF NOT EXISTS inventory_revision_scan_events (
  scan_event_id TEXT PRIMARY KEY,
  revision_id TEXT NOT NULL,
  item_id TEXT,
  product_id TEXT,
  barcode TEXT,
  previous_counted_qty REAL,
  new_counted_qty REAL,
  user_id TEXT,
  device_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (revision_id) REFERENCES inventory_revisions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_inv_rev_scan_events_revision
  ON inventory_revision_scan_events(revision_id, created_at);

CREATE INDEX IF NOT EXISTS idx_inv_rev_items_revision_status
  ON inventory_revision_items(revision_id, counted_qty);

CREATE INDEX IF NOT EXISTS idx_inv_rev_items_revision_product
  ON inventory_revision_items(revision_id, product_id);

-- Product barcode/SKU lookups used by revision exact-match search
CREATE INDEX IF NOT EXISTS idx_products_barcode_nocase
  ON products(barcode COLLATE NOCASE);

CREATE INDEX IF NOT EXISTS idx_products_sku_nocase
  ON products(sku COLLATE NOCASE);

-- Phase 1: warehouse inventory revision (ombor reviziyasi) sessions + line items.
-- counted_qty NULL = not yet counted; only counted rows are applied on complete.

CREATE TABLE IF NOT EXISTS inventory_revisions (
  id TEXT PRIMARY KEY,
  revision_number TEXT NOT NULL UNIQUE,
  warehouse_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'in_progress', 'completed', 'cancelled')),
  notes TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS inventory_revision_items (
  id TEXT PRIMARY KEY,
  revision_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  system_qty REAL NOT NULL DEFAULT 0,
  counted_qty REAL,
  variance REAL,
  unit TEXT,
  counted_at TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (revision_id) REFERENCES inventory_revisions(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id),
  UNIQUE (revision_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_inventory_revisions_status
  ON inventory_revisions(status);

CREATE INDEX IF NOT EXISTS idx_inventory_revisions_warehouse
  ON inventory_revisions(warehouse_id);

CREATE INDEX IF NOT EXISTS idx_inventory_revisions_created
  ON inventory_revisions(created_at);

CREATE INDEX IF NOT EXISTS idx_inventory_revision_items_revision
  ON inventory_revision_items(revision_id);

CREATE INDEX IF NOT EXISTS idx_inventory_revision_items_product
  ON inventory_revision_items(product_id);

CREATE INDEX IF NOT EXISTS idx_inventory_revision_items_counted
  ON inventory_revision_items(revision_id, counted_qty);

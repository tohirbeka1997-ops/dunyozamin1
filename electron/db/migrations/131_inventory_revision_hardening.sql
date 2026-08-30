-- Inventory revision hardening: metadata, snapshot tracking, partial scope, audit fields.
-- Status adds partially_completed for scoped revision close-out.

CREATE TABLE IF NOT EXISTS inventory_revisions_new (
  id TEXT PRIMARY KEY,
  revision_number TEXT NOT NULL UNIQUE,
  warehouse_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'in_progress', 'partially_completed', 'completed', 'cancelled')),
  revision_type TEXT NOT NULL DEFAULT 'full'
    CHECK (revision_type IN ('full', 'partial')),
  scope_json TEXT,
  count_method TEXT,
  planned_date TEXT,
  responsible_user_id TEXT,
  snapshot_at TEXT,
  snapshot_version INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  cancel_reason TEXT,
  created_by TEXT,
  started_by TEXT,
  started_at TEXT,
  completed_by TEXT,
  approved_by TEXT,
  cancelled_by TEXT,
  cancelled_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
  FOREIGN KEY (created_by) REFERENCES users(id),
  FOREIGN KEY (responsible_user_id) REFERENCES users(id),
  FOREIGN KEY (started_by) REFERENCES users(id),
  FOREIGN KEY (completed_by) REFERENCES users(id),
  FOREIGN KEY (approved_by) REFERENCES users(id),
  FOREIGN KEY (cancelled_by) REFERENCES users(id)
);

INSERT INTO inventory_revisions_new (
  id, revision_number, warehouse_id, status, revision_type, notes,
  created_by, created_at, updated_at, completed_at
)
SELECT
  id,
  revision_number,
  warehouse_id,
  status,
  'full',
  notes,
  created_by,
  created_at,
  updated_at,
  completed_at
FROM inventory_revisions;

DROP TABLE inventory_revisions;
ALTER TABLE inventory_revisions_new RENAME TO inventory_revisions;

CREATE INDEX IF NOT EXISTS idx_inventory_revisions_status
  ON inventory_revisions(status);

CREATE INDEX IF NOT EXISTS idx_inventory_revisions_warehouse
  ON inventory_revisions(warehouse_id);

CREATE INDEX IF NOT EXISTS idx_inventory_revisions_created
  ON inventory_revisions(created_at);

CREATE INDEX IF NOT EXISTS idx_inventory_revisions_type_status
  ON inventory_revisions(warehouse_id, revision_type, status);

-- Link revision finalize adjustments back to session when present.
-- Per-item snapshot_version / snapshot_at added in 132_inventory_revision_item_snapshot.sql.

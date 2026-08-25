-- Monthly opening inventory balance snapshots for fast movement aggregation in reports.

CREATE TABLE IF NOT EXISTS inventory_balance_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id TEXT NOT NULL,
  warehouse_id TEXT NOT NULL,
  snapshot_ymd TEXT NOT NULL,
  quantity REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(product_id, warehouse_id, snapshot_ymd),
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  FOREIGN KEY (warehouse_id) REFERENCES warehouses(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_inv_balance_snapshots_ymd
  ON inventory_balance_snapshots(snapshot_ymd);

CREATE INDEX IF NOT EXISTS idx_inv_balance_snapshots_wh_ymd
  ON inventory_balance_snapshots(warehouse_id, snapshot_ymd);

CREATE INDEX IF NOT EXISTS idx_inventory_movements_created
  ON inventory_movements(created_at);

-- Additive purchase-planning commercial fields (non-destructive).
-- Column ALTERs for products / stock_balances are applied via migrate.cjs
-- safeAddColumn so re-runs stay idempotent.

CREATE TABLE IF NOT EXISTS product_purchase_settings (
  product_id TEXT PRIMARY KEY,
  preferred_supplier_id TEXT,
  lead_time_days INTEGER,
  moq REAL,
  order_step REAL,
  qty_precision INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  FOREIGN KEY (preferred_supplier_id) REFERENCES suppliers(id)
);

CREATE INDEX IF NOT EXISTS idx_product_purchase_settings_supplier
  ON product_purchase_settings(preferred_supplier_id);

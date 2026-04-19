-- ============================================================================
-- 037 - Purchase receipts (goods receipt) separation from purchase orders
-- ============================================================================

CREATE TABLE IF NOT EXISTS purchase_receipts (
  id TEXT PRIMARY KEY,
  receipt_number TEXT NOT NULL UNIQUE,
  purchase_order_id TEXT,
  supplier_id TEXT,
  warehouse_id TEXT,
  status TEXT NOT NULL DEFAULT 'received',
  currency TEXT NOT NULL DEFAULT 'USD',
  exchange_rate REAL,
  total_usd REAL,
  total_uzs REAL,
  invoice_number TEXT,
  received_at TEXT,
  notes TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id),
  FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
);

CREATE INDEX IF NOT EXISTS idx_purchase_receipts_po ON purchase_receipts(purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_purchase_receipts_supplier ON purchase_receipts(supplier_id);

CREATE TABLE IF NOT EXISTS purchase_receipt_items (
  id TEXT PRIMARY KEY,
  receipt_id TEXT NOT NULL,
  purchase_order_item_id TEXT,
  product_id TEXT NOT NULL,
  product_name TEXT,
  received_qty REAL NOT NULL DEFAULT 0,
  unit_cost REAL NOT NULL DEFAULT 0,
  line_total REAL NOT NULL DEFAULT 0,
  unit_cost_usd REAL,
  line_total_usd REAL,
  exchange_rate REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (receipt_id) REFERENCES purchase_receipts(id),
  FOREIGN KEY (purchase_order_item_id) REFERENCES purchase_order_items(id),
  FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE INDEX IF NOT EXISTS idx_purchase_receipt_items_receipt ON purchase_receipt_items(receipt_id);
CREATE INDEX IF NOT EXISTS idx_purchase_receipt_items_product ON purchase_receipt_items(product_id);

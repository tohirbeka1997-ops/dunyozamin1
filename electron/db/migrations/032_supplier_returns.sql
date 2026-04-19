-- Migration: 032_supplier_returns.sql
-- Adds supplier returns (credit note) to reduce supplier debt and adjust inventory.

CREATE TABLE IF NOT EXISTS supplier_returns (
  id TEXT PRIMARY KEY,
  return_number TEXT NOT NULL UNIQUE,
  supplier_id TEXT NOT NULL,
  purchase_order_id TEXT,              -- optional link to a PO
  warehouse_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'completed', -- 'draft', 'completed', 'cancelled'
  return_reason TEXT,
  notes TEXT,
  total_amount REAL NOT NULL DEFAULT 0,     -- credit note amount (in current app currency; later can be USD base)
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
  FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id),
  FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS supplier_return_items (
  id TEXT PRIMARY KEY,
  return_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  product_name TEXT NOT NULL, -- snapshot
  product_sku TEXT NOT NULL,  -- snapshot
  quantity REAL NOT NULL,
  unit_cost REAL NOT NULL,    -- credit valuation per unit
  line_total REAL NOT NULL,   -- quantity * unit_cost
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (return_id) REFERENCES supplier_returns(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE INDEX IF NOT EXISTS idx_supplier_returns_supplier ON supplier_returns(supplier_id);
CREATE INDEX IF NOT EXISTS idx_supplier_returns_po ON supplier_returns(purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_supplier_returns_created_at ON supplier_returns(created_at);

CREATE INDEX IF NOT EXISTS idx_supplier_return_items_return ON supplier_return_items(return_id);
CREATE INDEX IF NOT EXISTS idx_supplier_return_items_product ON supplier_return_items(product_id);


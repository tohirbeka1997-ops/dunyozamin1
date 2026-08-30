-- 130_purchase_orders_audit_hardening.sql
-- P0/P1 purchase audit: supplier advances, cost corrections, receive idempotency (ADDITIVE).

-- ---------------------------------------------------------------------------
-- Supplier advances (excess payment not attached as negative PO debt)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS supplier_advances (
  id TEXT PRIMARY KEY,
  advance_number TEXT NOT NULL UNIQUE,
  supplier_id TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'UZS',
  amount REAL NOT NULL,
  amount_remaining REAL NOT NULL,
  fx_rate REAL,
  fx_rate_source TEXT,
  fx_rate_date TEXT,
  basis_payment_id TEXT,
  basis_purchase_order_id TEXT,
  notes TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
  FOREIGN KEY (basis_payment_id) REFERENCES supplier_payments(id),
  FOREIGN KEY (basis_purchase_order_id) REFERENCES purchase_orders(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_supplier_advances_supplier
  ON supplier_advances(supplier_id);

CREATE INDEX IF NOT EXISTS idx_supplier_advances_remaining
  ON supplier_advances(supplier_id, amount_remaining);

-- Applying advance to a later PO requires explicit select + confirm
CREATE TABLE IF NOT EXISTS supplier_advance_applications (
  id TEXT PRIMARY KEY,
  advance_id TEXT NOT NULL,
  purchase_order_id TEXT NOT NULL,
  supplier_payment_id TEXT,
  amount REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'UZS',
  notes TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (advance_id) REFERENCES supplier_advances(id),
  FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id),
  FOREIGN KEY (supplier_payment_id) REFERENCES supplier_payments(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_supplier_advance_apps_advance
  ON supplier_advance_applications(advance_id);

CREATE INDEX IF NOT EXISTS idx_supplier_advance_apps_po
  ON supplier_advance_applications(purchase_order_id);

-- ---------------------------------------------------------------------------
-- Cost / expense correction documents (received POs not silently rewritten)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS purchase_cost_corrections (
  id TEXT PRIMARY KEY,
  correction_number TEXT NOT NULL UNIQUE,
  purchase_order_id TEXT NOT NULL,
  purchase_order_item_id TEXT,
  product_id TEXT,
  field_name TEXT NOT NULL DEFAULT 'unit_cost',
  old_value REAL,
  new_value REAL,
  reason TEXT NOT NULL,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  -- pending | approved | rejected
  created_by TEXT,
  approved_by TEXT,
  approved_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id),
  FOREIGN KEY (purchase_order_item_id) REFERENCES purchase_order_items(id),
  FOREIGN KEY (product_id) REFERENCES products(id),
  FOREIGN KEY (created_by) REFERENCES users(id),
  FOREIGN KEY (approved_by) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_purchase_cost_corrections_po
  ON purchase_cost_corrections(purchase_order_id);

CREATE INDEX IF NOT EXISTS idx_purchase_cost_corrections_status
  ON purchase_cost_corrections(status);

-- ---------------------------------------------------------------------------
-- Receipt: zero-cost types + idempotency
-- ---------------------------------------------------------------------------
ALTER TABLE purchase_receipts ADD COLUMN receive_type TEXT DEFAULT 'standard';
ALTER TABLE purchase_receipts ADD COLUMN zero_cost_reason TEXT;
ALTER TABLE purchase_receipts ADD COLUMN zero_cost_approved_by TEXT;
ALTER TABLE purchase_receipts ADD COLUMN idempotency_key TEXT;
ALTER TABLE purchase_receipts ADD COLUMN cancelled_at TEXT;
ALTER TABLE purchase_receipts ADD COLUMN cancel_reason TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_purchase_receipts_idempotency_key
  ON purchase_receipts(idempotency_key)
  WHERE idempotency_key IS NOT NULL AND TRIM(idempotency_key) != '';

-- ---------------------------------------------------------------------------
-- Supplier payments: advance link, FX, cancel, idempotency
-- ---------------------------------------------------------------------------
ALTER TABLE supplier_payments ADD COLUMN idempotency_key TEXT;
ALTER TABLE supplier_payments ADD COLUMN advance_id TEXT;
ALTER TABLE supplier_payments ADD COLUMN is_advance_portion INTEGER NOT NULL DEFAULT 0;
ALTER TABLE supplier_payments ADD COLUMN fx_rate REAL;
ALTER TABLE supplier_payments ADD COLUMN fx_rate_source TEXT;
ALTER TABLE supplier_payments ADD COLUMN fx_diff_amount REAL;
ALTER TABLE supplier_payments ADD COLUMN cancelled_at TEXT;
ALTER TABLE supplier_payments ADD COLUMN cancel_reason TEXT;
ALTER TABLE supplier_payments ADD COLUMN cancelled_by TEXT;
ALTER TABLE supplier_payments ADD COLUMN accept_as_advance INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS idx_supplier_payments_idempotency_key
  ON supplier_payments(idempotency_key)
  WHERE idempotency_key IS NOT NULL AND TRIM(idempotency_key) != '';

CREATE INDEX IF NOT EXISTS idx_supplier_payments_advance
  ON supplier_payments(advance_id);

-- ---------------------------------------------------------------------------
-- PO list / debt filters helpers
-- ---------------------------------------------------------------------------
ALTER TABLE purchase_orders ADD COLUMN has_supplier_advance INTEGER NOT NULL DEFAULT 0;

-- Migration: 033_purchase_order_expenses.sql
-- Adds purchase_order_expenses for landed cost (transport/loading/customs/etc.)

CREATE TABLE IF NOT EXISTS purchase_order_expenses (
  id TEXT PRIMARY KEY,
  purchase_order_id TEXT NOT NULL,
  title TEXT NOT NULL,                 -- e.g. "Transport", "Loader", "Customs"
  amount REAL NOT NULL CHECK(amount >= 0),
  allocation_method TEXT NOT NULL DEFAULT 'by_value' CHECK(allocation_method IN ('by_value', 'by_qty')),
  notes TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_po_expenses_po ON purchase_order_expenses(purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_po_expenses_created_at ON purchase_order_expenses(created_at);


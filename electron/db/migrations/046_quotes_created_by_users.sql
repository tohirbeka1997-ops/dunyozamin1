-- ============================================================================
-- 046 - Fix quotes.created_by: reference users(id) instead of profiles(id)
-- Auth uses users table; profiles may have different ids.
-- ============================================================================

-- Disable FK temporarily (quote_items references quotes)
PRAGMA foreign_keys = OFF;

-- Recreate quotes table with correct FK (users instead of profiles)
CREATE TABLE IF NOT EXISTS quotes_new (
  id TEXT PRIMARY KEY,
  quote_number TEXT NOT NULL UNIQUE,
  customer_id TEXT,
  customer_name TEXT NOT NULL,
  phone TEXT,
  price_type TEXT NOT NULL DEFAULT 'retail',
  status TEXT NOT NULL DEFAULT 'draft',
  subtotal REAL NOT NULL DEFAULT 0,
  discount_amount REAL NOT NULL DEFAULT 0,
  discount_percent REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  total_profit REAL,
  valid_until TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT,
  created_by TEXT NOT NULL,
  converted_order_id TEXT,
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  FOREIGN KEY (created_by) REFERENCES users(id),
  FOREIGN KEY (converted_order_id) REFERENCES orders(id)
);

-- Copy existing data if quotes exists (replace invalid created_by with default-admin-001)
INSERT OR REPLACE INTO quotes_new (
  id, quote_number, customer_id, customer_name, phone,
  price_type, status, subtotal, discount_amount, discount_percent,
  total, total_profit, valid_until, notes, created_at, updated_at, created_by, converted_order_id
)
SELECT
  id, quote_number, customer_id, customer_name, phone,
  price_type, status, subtotal, discount_amount, discount_percent,
  total, total_profit, valid_until, notes, created_at, updated_at,
  CASE
    WHEN created_by = '' OR created_by IS NULL THEN 'default-admin-001'
    WHEN created_by IN (SELECT id FROM users) THEN created_by
    ELSE 'default-admin-001'
  END,
  converted_order_id
FROM quotes;

DROP TABLE IF EXISTS quotes;
ALTER TABLE quotes_new RENAME TO quotes;

CREATE INDEX IF NOT EXISTS idx_quotes_status ON quotes(status);
CREATE INDEX IF NOT EXISTS idx_quotes_created_at ON quotes(created_at);
CREATE INDEX IF NOT EXISTS idx_quotes_created_by ON quotes(created_by);
CREATE INDEX IF NOT EXISTS idx_quotes_customer ON quotes(customer_id);

PRAGMA foreign_keys = ON;

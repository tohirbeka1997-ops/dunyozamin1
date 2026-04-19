-- ============================================================================
-- 044 - Quotes / Smeta (Estimate) module
-- Creates quotes and quote_items tables for professional estimate flow
-- ============================================================================

-- Quotes header
CREATE TABLE IF NOT EXISTS quotes (
  id TEXT PRIMARY KEY,
  quote_number TEXT NOT NULL UNIQUE,
  customer_id TEXT,
  customer_name TEXT NOT NULL,
  phone TEXT,
  price_type TEXT NOT NULL DEFAULT 'retail',   -- 'retail' | 'usta'
  status TEXT NOT NULL DEFAULT 'draft',        -- 'draft' | 'confirmed' | 'expired' | 'converted'
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
  FOREIGN KEY (created_by) REFERENCES profiles(id),
  FOREIGN KEY (converted_order_id) REFERENCES orders(id)
);

CREATE INDEX IF NOT EXISTS idx_quotes_status ON quotes(status);
CREATE INDEX IF NOT EXISTS idx_quotes_created_at ON quotes(created_at);
CREATE INDEX IF NOT EXISTS idx_quotes_created_by ON quotes(created_by);
CREATE INDEX IF NOT EXISTS idx_quotes_customer ON quotes(customer_id);

-- Quote items (snapshot: name, price at time of quote)
CREATE TABLE IF NOT EXISTS quote_items (
  id TEXT PRIMARY KEY,
  quote_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  name_snapshot TEXT NOT NULL,
  sku_snapshot TEXT,
  unit TEXT NOT NULL DEFAULT 'pcs',
  quantity REAL NOT NULL DEFAULT 1,
  unit_price REAL NOT NULL DEFAULT 0,
  price_type_used TEXT NOT NULL DEFAULT 'retail',  -- 'retail' | 'usta' | 'manual'
  override_price REAL,
  discount_percent REAL NOT NULL DEFAULT 0,
  discount_amount REAL NOT NULL DEFAULT 0,
  cost_price REAL,
  line_total REAL NOT NULL DEFAULT 0,
  line_profit REAL,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (quote_id) REFERENCES quotes(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE INDEX IF NOT EXISTS idx_quote_items_quote ON quote_items(quote_id);

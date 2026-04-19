-- Migration: 017_fix_returns_tables_safeguard.sql
-- Purpose: Ensure sales_returns and return_items tables exist with correct structure
-- This is a safeguard migration to fix any table name mismatches

-- ============================================================================
-- Ensure sales_returns table exists (correct name from 000_init.sql)
-- ============================================================================
CREATE TABLE IF NOT EXISTS sales_returns (
  id TEXT PRIMARY KEY,
  return_number TEXT NOT NULL UNIQUE,
  order_id TEXT NOT NULL,
  customer_id TEXT,
  cashier_id TEXT NOT NULL,
  user_id TEXT,                          -- Alias for cashier_id
  warehouse_id TEXT,                     -- For multi-warehouse support
  shift_id TEXT,
  return_reason TEXT,
  total_amount REAL NOT NULL DEFAULT 0,
  refund_amount REAL NOT NULL DEFAULT 0,
  refund_method TEXT, -- 'cash', 'card', 'credit'
  status TEXT NOT NULL DEFAULT 'completed',
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (order_id) REFERENCES orders(id),
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);

-- ============================================================================
-- Ensure return_items table exists (correct name from 000_init.sql)
-- ============================================================================
CREATE TABLE IF NOT EXISTS return_items (
  id TEXT PRIMARY KEY,
  return_id TEXT NOT NULL,
  order_item_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  quantity REAL NOT NULL DEFAULT 1,
  unit_price REAL NOT NULL DEFAULT 0,
  line_total REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (return_id) REFERENCES sales_returns(id) ON DELETE CASCADE,
  FOREIGN KEY (order_item_id) REFERENCES order_items(id),
  FOREIGN KEY (product_id) REFERENCES products(id)
);

-- ============================================================================
-- Create indexes if they don't exist
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_sales_returns_number ON sales_returns(return_number);
CREATE INDEX IF NOT EXISTS idx_sales_returns_order ON sales_returns(order_id);
CREATE INDEX IF NOT EXISTS idx_sales_returns_customer ON sales_returns(customer_id);
CREATE INDEX IF NOT EXISTS idx_sales_returns_status ON sales_returns(status);
CREATE INDEX IF NOT EXISTS idx_sales_returns_created_at ON sales_returns(created_at);

CREATE INDEX IF NOT EXISTS idx_return_items_return ON return_items(return_id);
CREATE INDEX IF NOT EXISTS idx_return_items_order_item ON return_items(order_item_id);
CREATE INDEX IF NOT EXISTS idx_return_items_product ON return_items(product_id);

-- ============================================================================
-- Note: If sale_returns or sale_return_items tables exist (from 005_returns.sql),
-- they should be migrated to sales_returns/return_items, but we don't do that
-- automatically here to avoid data loss. Manual migration may be needed.
-- ============================================================================














































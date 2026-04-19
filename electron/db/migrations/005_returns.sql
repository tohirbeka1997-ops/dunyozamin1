-- ============================================================================
-- RETURNS TABLES: Sale Returns and Return Items
-- ============================================================================

-- Sale Returns
CREATE TABLE IF NOT EXISTS sale_returns (
  id TEXT PRIMARY KEY,
  return_number TEXT NOT NULL UNIQUE,
  order_id TEXT NOT NULL,
  customer_id TEXT,
  user_id TEXT NOT NULL, -- User processing the return
  warehouse_id TEXT NOT NULL,
  shift_id TEXT,
  return_reason TEXT NOT NULL,
  total_amount REAL NOT NULL DEFAULT 0,
  refund_amount REAL NOT NULL DEFAULT 0,
  refund_method TEXT, -- 'cash', 'card', 'credit'
  status TEXT NOT NULL DEFAULT 'completed', -- 'draft', 'completed', 'cancelled'
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (order_id) REFERENCES orders(id),
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
  FOREIGN KEY (shift_id) REFERENCES shifts(id)
);

-- Sale Return Items
CREATE TABLE IF NOT EXISTS sale_return_items (
  id TEXT PRIMARY KEY,
  return_id TEXT NOT NULL,
  order_item_id TEXT NOT NULL, -- Original order item being returned
  product_id TEXT NOT NULL,
  product_name TEXT NOT NULL, -- Snapshot
  product_sku TEXT NOT NULL, -- Snapshot
  quantity REAL NOT NULL,
  unit_price REAL NOT NULL, -- Original sale price
  line_total REAL NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (return_id) REFERENCES sale_returns(id) ON DELETE CASCADE,
  FOREIGN KEY (order_item_id) REFERENCES order_items(id),
  FOREIGN KEY (product_id) REFERENCES products(id)
);

-- Indexes for returns tables
CREATE INDEX IF NOT EXISTS idx_sale_returns_number ON sale_returns(return_number);
CREATE INDEX IF NOT EXISTS idx_sale_returns_order ON sale_returns(order_id);
CREATE INDEX IF NOT EXISTS idx_sale_returns_customer ON sale_returns(customer_id);
CREATE INDEX IF NOT EXISTS idx_sale_returns_user ON sale_returns(user_id);
CREATE INDEX IF NOT EXISTS idx_sale_returns_warehouse ON sale_returns(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_sale_returns_shift ON sale_returns(shift_id);
CREATE INDEX IF NOT EXISTS idx_sale_returns_status ON sale_returns(status);
CREATE INDEX IF NOT EXISTS idx_sale_returns_created_at ON sale_returns(created_at);

CREATE INDEX IF NOT EXISTS idx_sale_return_items_return ON sale_return_items(return_id);
CREATE INDEX IF NOT EXISTS idx_sale_return_items_order_item ON sale_return_items(order_item_id);
CREATE INDEX IF NOT EXISTS idx_sale_return_items_product ON sale_return_items(product_id);






















































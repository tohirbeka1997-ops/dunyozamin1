-- ============================================================================
-- INVENTORY TABLES: Warehouses, Stock Balances, Stock Moves, Adjustments
-- ============================================================================

-- Warehouses/Storage locations
CREATE TABLE IF NOT EXISTS warehouses (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  address TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Stock Balances (current stock per product per warehouse)
CREATE TABLE IF NOT EXISTS stock_balances (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  warehouse_id TEXT NOT NULL,
  quantity REAL NOT NULL DEFAULT 0 CHECK(quantity >= 0), -- Cannot go negative
  reserved_quantity REAL NOT NULL DEFAULT 0 CHECK(reserved_quantity >= 0),
  available_quantity REAL GENERATED ALWAYS AS (quantity - reserved_quantity) STORED,
  last_movement_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  FOREIGN KEY (warehouse_id) REFERENCES warehouses(id) ON DELETE CASCADE,
  UNIQUE(product_id, warehouse_id)
);

-- Stock Moves (audit ledger - tracks every stock change)
CREATE TABLE IF NOT EXISTS stock_moves (
  id TEXT PRIMARY KEY,
  move_number TEXT NOT NULL UNIQUE,
  product_id TEXT NOT NULL,
  warehouse_id TEXT NOT NULL,
  move_type TEXT NOT NULL, -- 'sale', 'return', 'purchase', 'adjustment', 'transfer_in', 'transfer_out'
  quantity REAL NOT NULL, -- Positive for IN, Negative for OUT
  before_quantity REAL NOT NULL,
  after_quantity REAL NOT NULL CHECK(after_quantity >= 0),
  reference_type TEXT, -- 'order', 'return', 'purchase_order', 'adjustment', etc.
  reference_id TEXT,
  reason TEXT,
  notes TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (product_id) REFERENCES products(id),
  FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
);

-- Inventory Adjustments (for manual stock corrections)
CREATE TABLE IF NOT EXISTS inventory_adjustments (
  id TEXT PRIMARY KEY,
  adjustment_number TEXT NOT NULL UNIQUE,
  warehouse_id TEXT NOT NULL,
  adjustment_type TEXT NOT NULL, -- 'increase', 'decrease', 'set'
  reason TEXT NOT NULL,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'draft', -- 'draft', 'approved', 'completed'
  created_by TEXT,
  approved_by TEXT,
  approved_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
  FOREIGN KEY (created_by) REFERENCES users(id),
  FOREIGN KEY (approved_by) REFERENCES users(id)
);

-- Inventory Adjustment Items
CREATE TABLE IF NOT EXISTS inventory_adjustment_items (
  id TEXT PRIMARY KEY,
  adjustment_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  before_quantity REAL NOT NULL,
  adjustment_quantity REAL NOT NULL, -- Can be positive or negative
  after_quantity REAL NOT NULL CHECK(after_quantity >= 0),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (adjustment_id) REFERENCES inventory_adjustments(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id)
);

-- Indexes for inventory tables
CREATE INDEX IF NOT EXISTS idx_warehouses_code ON warehouses(code);
CREATE INDEX IF NOT EXISTS idx_warehouses_active ON warehouses(is_active);

CREATE INDEX IF NOT EXISTS idx_stock_balances_product ON stock_balances(product_id);
CREATE INDEX IF NOT EXISTS idx_stock_balances_warehouse ON stock_balances(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_stock_balances_product_warehouse ON stock_balances(product_id, warehouse_id);

CREATE INDEX IF NOT EXISTS idx_stock_moves_product ON stock_moves(product_id);
CREATE INDEX IF NOT EXISTS idx_stock_moves_warehouse ON stock_moves(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_stock_moves_type ON stock_moves(move_type);
CREATE INDEX IF NOT EXISTS idx_stock_moves_reference ON stock_moves(reference_type, reference_id);
CREATE INDEX IF NOT EXISTS idx_stock_moves_created_at ON stock_moves(created_at);
CREATE INDEX IF NOT EXISTS idx_stock_moves_move_number ON stock_moves(move_number);

CREATE INDEX IF NOT EXISTS idx_inventory_adjustments_warehouse ON inventory_adjustments(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_inventory_adjustments_status ON inventory_adjustments(status);
CREATE INDEX IF NOT EXISTS idx_inventory_adjustments_created_at ON inventory_adjustments(created_at);
CREATE INDEX IF NOT EXISTS idx_inventory_adjustments_number ON inventory_adjustments(adjustment_number);

CREATE INDEX IF NOT EXISTS idx_inventory_adjustment_items_adjustment ON inventory_adjustment_items(adjustment_id);
CREATE INDEX IF NOT EXISTS idx_inventory_adjustment_items_product ON inventory_adjustment_items(product_id);






















































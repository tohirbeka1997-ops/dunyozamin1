-- ============================================================================
-- SHIFT TABLES: Shifts and Shift Totals
-- ============================================================================

-- Shifts (cashier shifts - open/close)
CREATE TABLE IF NOT EXISTS shifts (
  id TEXT PRIMARY KEY,
  shift_number TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL, -- Cashier
  warehouse_id TEXT NOT NULL,
  opened_at TEXT NOT NULL,
  closed_at TEXT,
  opening_cash REAL NOT NULL DEFAULT 0,
  closing_cash REAL,
  expected_cash REAL,
  cash_difference REAL,
  status TEXT NOT NULL DEFAULT 'open', -- 'open', 'closed'
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (warehouse_id) REFERENCES warehouses(id)
);

-- Shift Totals (optional - aggregated totals per shift)
CREATE TABLE IF NOT EXISTS shift_totals (
  id TEXT PRIMARY KEY,
  shift_id TEXT NOT NULL UNIQUE,
  total_sales REAL NOT NULL DEFAULT 0,
  total_returns REAL NOT NULL DEFAULT 0,
  cash_sales REAL NOT NULL DEFAULT 0,
  card_sales REAL NOT NULL DEFAULT 0,
  qr_sales REAL NOT NULL DEFAULT 0,
  credit_sales REAL NOT NULL DEFAULT 0,
  total_transactions INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (shift_id) REFERENCES shifts(id) ON DELETE CASCADE
);

-- Indexes for shift tables
CREATE INDEX IF NOT EXISTS idx_shifts_number ON shifts(shift_number);
CREATE INDEX IF NOT EXISTS idx_shifts_user ON shifts(user_id);
CREATE INDEX IF NOT EXISTS idx_shifts_warehouse ON shifts(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_shifts_status ON shifts(status);
CREATE INDEX IF NOT EXISTS idx_shifts_opened_at ON shifts(opened_at);

CREATE INDEX IF NOT EXISTS idx_shift_totals_shift ON shift_totals(shift_id);






















































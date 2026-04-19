-- ============================================================================
-- CUSTOMER TABLES
-- ============================================================================

-- Customers
CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  code TEXT UNIQUE,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  address TEXT,
  type TEXT NOT NULL DEFAULT 'individual', -- 'individual', 'company'
  company_name TEXT,
  tax_number TEXT,
  credit_limit REAL NOT NULL DEFAULT 0,
  allow_credit INTEGER NOT NULL DEFAULT 0,
  balance REAL NOT NULL DEFAULT 0, -- Current credit balance (positive = owes us)
  total_sales REAL NOT NULL DEFAULT 0,
  total_orders INTEGER NOT NULL DEFAULT 0,
  last_order_date TEXT,
  status TEXT NOT NULL DEFAULT 'active', -- 'active', 'inactive'
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Customer Payments (for credit customers)
CREATE TABLE IF NOT EXISTS customer_payments (
  id TEXT PRIMARY KEY,
  payment_number TEXT NOT NULL UNIQUE,
  customer_id TEXT NOT NULL,
  order_id TEXT, -- If payment is for specific order
  amount REAL NOT NULL,
  payment_method TEXT NOT NULL, -- 'cash', 'card', 'transfer'
  reference_number TEXT,
  notes TEXT,
  received_by TEXT,
  paid_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  FOREIGN KEY (order_id) REFERENCES orders(id),
  FOREIGN KEY (received_by) REFERENCES users(id)
);

-- Indexes for customer tables
CREATE INDEX IF NOT EXISTS idx_customers_code ON customers(code);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);
CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(email);
CREATE INDEX IF NOT EXISTS idx_customers_status ON customers(status);
CREATE INDEX IF NOT EXISTS idx_customers_type ON customers(type);

CREATE INDEX IF NOT EXISTS idx_customer_payments_number ON customer_payments(payment_number);
CREATE INDEX IF NOT EXISTS idx_customer_payments_customer ON customer_payments(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_payments_order ON customer_payments(order_id);
CREATE INDEX IF NOT EXISTS idx_customer_payments_paid_at ON customer_payments(paid_at);






















































-- Payment allocations, ledger audit columns, customer credit term.
-- Additive only: does not rewrite historical money amounts.

CREATE TABLE IF NOT EXISTS customer_payment_allocations (
  id TEXT PRIMARY KEY,
  payment_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  order_id TEXT,
  applied_amount REAL NOT NULL,
  order_balance_before REAL,
  order_balance_after REAL,
  remainder_to_advance REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'UZS',
  fx_rate REAL,
  payment_method TEXT,
  cash_doc_id TEXT,
  shift_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_cpa_payment ON customer_payment_allocations(payment_id);
CREATE INDEX IF NOT EXISTS idx_cpa_customer ON customer_payment_allocations(customer_id, created_at);
CREATE INDEX IF NOT EXISTS idx_cpa_order ON customer_payment_allocations(order_id);

-- Classify existing lend rows without changing amounts.
UPDATE customer_payments
SET op_type = 'CUSTOMER_LOAN_ISSUED',
    direction = 'out'
WHERE op_type IS NULL
  AND COALESCE(operation, '') = 'payment_out'
  AND (
    COALESCE(notes, '') LIKE '%Pul berildi%'
    OR COALESCE(notes, '') LIKE '%Approved emergency lend%'
    OR COALESCE(notes, '') LIKE '%qarz ber%'
  );

UPDATE customer_payments
SET op_type = 'ADVANCE_REFUNDED',
    direction = 'out'
WHERE op_type IS NULL
  AND COALESCE(operation, '') = 'payment_out';

UPDATE customer_payments
SET op_type = 'CUSTOMER_PAYMENT',
    direction = 'in'
WHERE op_type IS NULL
  AND COALESCE(operation, 'payment_in') = 'payment_in';

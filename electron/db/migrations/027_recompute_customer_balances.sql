-- Migration: Recompute customer balances using the system-wide sign convention
-- Convention:
--   - customers.balance < 0  => customer owes us (debt)
--   - customers.balance > 0  => customer has credit/prepaid
--
-- Why:
--   Older code paths could update balance with the wrong sign for credit sales.
--   This migration recalculates balances from transactional tables to normalize existing data.
--
-- Sources:
--   1) orders.credit_amount (amount left unpaid for the order) -> creates debt => subtract
--   2) customer_ledger non-sale deltas (payments/refunds/adjustments) -> apply signed deltas
--
-- NOTE:
--   We intentionally do NOT include customer_ledger 'sale' rows here to avoid double counting.
--   (credit_amount already represents debt from sales)

-- Ensure customer_ledger exists (no-op if already created by previous migrations)
CREATE TABLE IF NOT EXISTS customer_ledger (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('sale', 'payment_in', 'payment_out', 'refund', 'adjustment')),
  ref_id TEXT,
  ref_no TEXT,
  amount INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  note TEXT,
  method TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_by TEXT,
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
);

-- Recompute balances for all customers except walk-in default
UPDATE customers
SET balance = (
  -- Debt from credit sales (negative)
  COALESCE((
    SELECT -SUM(COALESCE(o.credit_amount, 0))
    FROM orders o
    WHERE o.customer_id = customers.id
      AND o.status = 'completed'
  ), 0)
  +
  -- Non-sale deltas that affect balance (signed)
  COALESCE((
    SELECT SUM(COALESCE(cl.amount, 0))
    FROM customer_ledger cl
    WHERE cl.customer_id = customers.id
      AND cl.type IN ('payment_in', 'payment_out', 'refund', 'adjustment')
  ), 0)
)
WHERE customers.id <> 'default-customer-001';






























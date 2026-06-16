-- Customer AR multi-currency (UZS + USD), same sign convention as balance:
--   balance / balance_usd < 0  => customer owes us
--   balance / balance_usd > 0  => prepaid / credit in that currency

ALTER TABLE customers ADD COLUMN balance_usd REAL NOT NULL DEFAULT 0;

ALTER TABLE customer_payments ADD COLUMN currency TEXT NOT NULL DEFAULT 'UZS';
ALTER TABLE customer_payments ADD COLUMN fx_rate REAL;
ALTER TABLE customer_payments ADD COLUMN old_balance_usd REAL;
ALTER TABLE customer_payments ADD COLUMN new_balance_usd REAL;

ALTER TABLE customer_ledger ADD COLUMN currency TEXT NOT NULL DEFAULT 'UZS';
ALTER TABLE customer_ledger ADD COLUMN balance_after_usd REAL;

-- Fix legacy data: USD order credits were applied to balance (UZS column) in USD units.
UPDATE customers
SET balance = balance + COALESCE((
  SELECT SUM(COALESCE(o.credit_amount, 0))
  FROM orders o
  WHERE o.customer_id = customers.id
    AND o.status = 'completed'
    AND UPPER(TRIM(COALESCE(o.currency, 'UZS'))) = 'USD'
    AND COALESCE(o.credit_amount, 0) > 0
), 0)
WHERE id <> 'default-customer-001';

UPDATE customers
SET balance_usd = COALESCE((
  SELECT -SUM(COALESCE(o.credit_amount, 0))
  FROM orders o
  WHERE o.customer_id = customers.id
    AND o.status = 'completed'
    AND UPPER(TRIM(COALESCE(o.currency, 'UZS'))) = 'USD'
), 0)
  + COALESCE((
  SELECT SUM(COALESCE(cl.amount, 0))
  FROM customer_ledger cl
  WHERE cl.customer_id = customers.id
    AND UPPER(TRIM(COALESCE(cl.currency, 'UZS'))) = 'USD'
    AND cl.type IN ('payment_in', 'payment_out', 'refund', 'adjustment')
), 0)
WHERE id <> 'default-customer-001';

CREATE INDEX IF NOT EXISTS idx_customer_payments_currency ON customer_payments(currency);
CREATE INDEX IF NOT EXISTS idx_orders_customer_currency ON orders(customer_id, currency);

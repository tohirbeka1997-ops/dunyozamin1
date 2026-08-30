-- 125_sales_return_idempotency.sql
-- Client idempotency key for sales returns (ADDITIVE + IDEMPOTENT).
-- Same key must not create a second return / money / stock movement.

ALTER TABLE sales_returns ADD COLUMN idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_returns_idempotency_key
  ON sales_returns(idempotency_key)
  WHERE idempotency_key IS NOT NULL AND TRIM(idempotency_key) != '';

-- TZ: payment_allocation audit fields (additive).
-- Existing rows keep applied_amount; new writes also fill allocated_amount / type.

ALTER TABLE customer_payment_allocations ADD COLUMN allocated_amount REAL;
ALTER TABLE customer_payment_allocations ADD COLUMN allocated_at TEXT;
ALTER TABLE customer_payment_allocations ADD COLUMN allocated_by TEXT;
ALTER TABLE customer_payment_allocations ADD COLUMN allocation_type TEXT;

UPDATE customer_payment_allocations
SET allocated_amount = COALESCE(allocated_amount, applied_amount)
WHERE allocated_amount IS NULL;

UPDATE customer_payment_allocations
SET allocated_at = COALESCE(allocated_at, created_at)
WHERE allocated_at IS NULL;

UPDATE customer_payment_allocations
SET allocation_type = COALESCE(allocation_type, CASE
  WHEN order_id IS NULL THEN 'advance_used'
  ELSE 'debt_payment'
END)
WHERE allocation_type IS NULL;

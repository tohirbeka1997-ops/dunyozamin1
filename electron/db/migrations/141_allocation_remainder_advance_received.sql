-- Remainder of inbound payment is customer advance received, not advance used.
-- Also copy remainder into allocated/applied amount so history is not 0.

UPDATE customer_payment_allocations
SET
  allocation_type = 'advance_received',
  applied_amount = CASE
    WHEN COALESCE(applied_amount, 0) <= 0.009 AND COALESCE(remainder_to_advance, 0) > 0.009
      THEN remainder_to_advance
    ELSE applied_amount
  END,
  allocated_amount = CASE
    WHEN COALESCE(allocated_amount, 0) <= 0.009 AND COALESCE(remainder_to_advance, 0) > 0.009
      THEN remainder_to_advance
    ELSE allocated_amount
  END
WHERE order_id IS NULL
  AND COALESCE(remainder_to_advance, 0) > 0.009
  AND COALESCE(allocation_type, '') IN ('', 'advance_used', 'debt_payment');

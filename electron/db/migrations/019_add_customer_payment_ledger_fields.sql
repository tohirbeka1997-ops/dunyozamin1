-- ============================================================================
-- Add ledger fields to customer_payments table
-- ============================================================================

-- Add fields to track balance changes for audit trail
ALTER TABLE customer_payments ADD COLUMN old_balance REAL;
ALTER TABLE customer_payments ADD COLUMN applied_amount REAL;
ALTER TABLE customer_payments ADD COLUMN new_balance REAL;

-- Update existing records (if any) - set applied_amount = amount for backward compatibility
UPDATE customer_payments SET applied_amount = amount WHERE applied_amount IS NULL;

-- Create index on customer_id and created_at for faster queries
CREATE INDEX IF NOT EXISTS idx_customer_payments_customer_created ON customer_payments(customer_id, created_at);













































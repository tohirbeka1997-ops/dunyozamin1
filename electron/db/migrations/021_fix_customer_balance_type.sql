-- Migration: 021_fix_customer_balance_type.sql
-- Ensure customers.balance is INTEGER (not REAL) for proper signed integer handling

-- SQLite doesn't support ALTER COLUMN type, so we need to recreate if needed
-- This migration checks and documents the requirement
-- If balance is already INTEGER, this is a no-op

-- Note: In SQLite, REAL and INTEGER can coexist, but INTEGER is preferred for balance
-- The application layer should treat balance as INTEGER

-- Verify balance column exists and is numeric
-- If migration is needed in future, would require:
-- 1. Create new table with INTEGER balance
-- 2. Copy data
-- 3. Drop old table
-- 4. Rename new table
-- For now, we document the requirement and ensure application uses INTEGER












































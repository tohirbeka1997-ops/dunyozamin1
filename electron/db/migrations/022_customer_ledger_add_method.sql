-- Migration: 022_customer_ledger_add_method.sql
-- Adds method column to customer_ledger table (idempotent)
-- This migration is handled by migrate.cjs safeAddColumn() function
-- The SQL here is a fallback - the JS migrator will check and add safely

-- Note: This ALTER statement will be executed only if the column doesn't exist
-- The migrate.cjs runner uses safeAddColumn() which checks before adding
ALTER TABLE customer_ledger ADD COLUMN method TEXT;

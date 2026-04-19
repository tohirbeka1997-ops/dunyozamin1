-- Migration: 014_add_returned_quantity.sql
-- Purpose: Add support for partial refunds by tracking returned quantities per order item

-- ============================================================================
-- Add returned_quantity column to order_items table
-- ============================================================================
ALTER TABLE order_items ADD COLUMN returned_quantity REAL NOT NULL DEFAULT 0;

-- Add index for faster queries on returned items
CREATE INDEX IF NOT EXISTS idx_order_items_returned ON order_items(order_id, returned_quantity) 
WHERE returned_quantity > 0;

-- ============================================================================
-- Add refund tracking columns to orders table (if not already present)
-- ============================================================================
-- Note: These columns may already exist, but we ensure they're there
-- SQLite doesn't support IF NOT EXISTS for ALTER TABLE ADD COLUMN, so we use a workaround

-- Check and add refund_reason if missing (will fail silently if exists)
-- SQLite doesn't support conditional ALTER TABLE, so we'll handle this in application code
-- or use a separate migration check

-- ============================================================================
-- Verification queries (for manual testing)
-- ============================================================================
-- To verify the migration:
-- SELECT sql FROM sqlite_master WHERE type='table' AND name='order_items';
-- Should show returned_quantity column

















































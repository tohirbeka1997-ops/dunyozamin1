-- Migration: 018_cleanup_orphan_returns.sql
-- Purpose: Cleanup SQL to remove orphan return records (returns without return_items)
-- This can be run manually to clean up any orphaned returns created before validation fix

-- ============================================================================
-- Find orphan returns (returns with no return_items)
-- ============================================================================
-- Query to identify orphan returns:
-- SELECT sr.id, sr.return_number, sr.order_id, sr.created_at
-- FROM sales_returns sr
-- LEFT JOIN return_items ri ON sr.id = ri.return_id
-- WHERE ri.id IS NULL;

-- ============================================================================
-- Delete orphan returns (returns with no return_items)
-- ============================================================================
-- WARNING: This will permanently delete return records that have no items
-- Only run this if you are sure these are orphan records from validation failures
-- 
-- DELETE FROM sales_returns
-- WHERE id IN (
--   SELECT sr.id
--   FROM sales_returns sr
--   LEFT JOIN return_items ri ON sr.id = ri.return_id
--   WHERE ri.id IS NULL
-- );

-- ============================================================================
-- Alternative: Mark orphan returns as cancelled instead of deleting
-- ============================================================================
-- UPDATE sales_returns
-- SET status = 'cancelled',
--     notes = COALESCE(notes || '; ', '') || 'Cancelled: No return items found (orphan record)'
-- WHERE id IN (
--   SELECT sr.id
--   FROM sales_returns sr
--   LEFT JOIN return_items ri ON sr.id = ri.return_id
--   WHERE ri.id IS NULL
-- );

-- ============================================================================
-- Count orphan returns (safe query, no data modification)
-- ============================================================================
-- SELECT COUNT(*) as orphan_count
-- FROM sales_returns sr
-- LEFT JOIN return_items ri ON sr.id = ri.return_id
-- WHERE ri.id IS NULL;

-- ============================================================================
-- NOTE: This migration file is for manual cleanup only
-- It does not run automatically during migration execution
-- Run the queries manually in your SQLite client if needed
-- ============================================================================














































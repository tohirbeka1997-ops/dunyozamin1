-- ============================================================================
-- STOCK UPDATE FIX: Stock Consistency Checks and Performance Optimization
-- Migration: 011_fix_stock_update_on_order_completion.sql
-- 
-- This migration adds:
-- 1. Stock consistency check views
-- 2. Helper queries for detecting stock discrepancies
-- 3. Additional indexes for performance (if missing)
-- 4. Documentation views for stock audit
-- ============================================================================

-- ============================================================================
-- STOCK CONSISTENCY CHECK VIEWS
-- ============================================================================

-- View: Stock Balance vs Movements Consistency
-- Compares stock_balances.quantity with sum of stock_moves.quantity
-- Should return 0 rows when stock is consistent
CREATE VIEW IF NOT EXISTS vw_stock_consistency_check AS
SELECT 
  sb.product_id,
  p.name as product_name,
  p.sku as product_sku,
  sb.warehouse_id,
  w.name as warehouse_name,
  sb.quantity as balance_quantity,
  COALESCE(SUM(sm.quantity), 0) as calculated_from_movements,
  (sb.quantity - COALESCE(SUM(sm.quantity), 0)) as difference,
  CASE 
    WHEN ABS(sb.quantity - COALESCE(SUM(sm.quantity), 0)) < 0.01 THEN 'consistent'
    ELSE 'mismatch'
  END as status
FROM stock_balances sb
INNER JOIN products p ON p.id = sb.product_id
INNER JOIN warehouses w ON w.id = sb.warehouse_id
LEFT JOIN stock_moves sm ON sm.product_id = sb.product_id AND sm.warehouse_id = sb.warehouse_id
GROUP BY sb.product_id, sb.warehouse_id
HAVING ABS(sb.quantity - COALESCE(SUM(sm.quantity), 0)) >= 0.01; -- Allow small floating point differences

-- View: Negative Stock Check (when not allowed)
-- Should return 0 rows when negative stock is disabled
CREATE VIEW IF NOT EXISTS vw_negative_stock_check AS
SELECT 
  sb.product_id,
  p.name as product_name,
  p.sku as product_sku,
  sb.warehouse_id,
  w.name as warehouse_name,
  sb.quantity,
  p.min_stock_level,
  CASE 
    WHEN sb.quantity < 0 THEN 'negative'
    WHEN sb.quantity = 0 THEN 'zero'
    WHEN sb.quantity <= p.min_stock_level THEN 'low_stock'
    ELSE 'ok'
  END as stock_status
FROM stock_balances sb
INNER JOIN products p ON p.id = sb.product_id
INNER JOIN warehouses w ON w.id = sb.warehouse_id
WHERE p.track_stock = 1
  AND sb.quantity < 0; -- Only show negative stock

-- View: Orders Without Stock Movements
-- Should return 0 rows - every completed order should have stock movements
CREATE VIEW IF NOT EXISTS vw_orders_without_movements AS
SELECT DISTINCT
  o.id as order_id,
  o.order_number,
  o.status,
  o.created_at,
  oi.product_id,
  p.name as product_name,
  oi.quantity as ordered_quantity
FROM orders o
INNER JOIN order_items oi ON oi.order_id = o.id
INNER JOIN products p ON p.id = oi.product_id
WHERE o.status = 'completed'
  AND p.track_stock = 1
  AND NOT EXISTS (
    SELECT 1 
    FROM stock_moves sm
    WHERE sm.reference_type = 'order'
      AND sm.reference_id = o.id
      AND sm.product_id = oi.product_id
  );

-- View: Stock Movement Summary by Product
-- Shows stock balance and recent movement summary
CREATE VIEW IF NOT EXISTS vw_stock_summary AS
SELECT 
  sb.product_id,
  p.name as product_name,
  p.sku,
  sb.warehouse_id,
  w.name as warehouse_name,
  sb.quantity as current_stock,
  p.min_stock_level,
  CASE 
    WHEN sb.quantity <= 0 THEN 'out_of_stock'
    WHEN sb.quantity <= p.min_stock_level THEN 'low_stock'
    ELSE 'in_stock'
  END as stock_status,
  sb.last_movement_at,
  COUNT(DISTINCT sm.id) as total_movements,
  SUM(CASE WHEN sm.quantity > 0 THEN sm.quantity ELSE 0 END) as total_in,
  SUM(CASE WHEN sm.quantity < 0 THEN ABS(sm.quantity) ELSE 0 END) as total_out
FROM stock_balances sb
INNER JOIN products p ON p.id = sb.product_id
INNER JOIN warehouses w ON w.id = sb.warehouse_id
LEFT JOIN stock_moves sm ON sm.product_id = sb.product_id AND sm.warehouse_id = sb.warehouse_id
WHERE p.track_stock = 1
GROUP BY sb.product_id, sb.warehouse_id;

-- ============================================================================
-- HELPER QUERIES (Stored as comments for reference)
-- ============================================================================

/*
-- QUERY 1: Check Stock Consistency
-- Returns products where balance doesn't match sum of movements
SELECT * FROM vw_stock_consistency_check;
-- Expected: 0 rows when stock is consistent

-- QUERY 2: Check for Negative Stock
SELECT * FROM vw_negative_stock_check;
-- Expected: 0 rows when negative stock is not allowed

-- QUERY 3: Find Orders Without Stock Movements
SELECT * FROM vw_orders_without_movements;
-- Expected: 0 rows - every completed order should have movements

-- QUERY 4: Stock Summary by Product
SELECT * FROM vw_stock_summary ORDER BY product_name, warehouse_name;

-- QUERY 5: Recent Stock Movements for a Product
SELECT 
  sm.move_number,
  sm.move_type,
  sm.quantity,
  sm.before_quantity,
  sm.after_quantity,
  sm.reference_type,
  sm.reference_id,
  sm.reason,
  sm.created_at
FROM stock_moves sm
WHERE sm.product_id = ? AND sm.warehouse_id = ?
ORDER BY sm.created_at DESC
LIMIT 50;

-- QUERY 6: Stock Balance for a Product/Warehouse
SELECT 
  sb.quantity,
  sb.available_quantity,
  sb.reserved_quantity,
  p.min_stock_level,
  CASE 
    WHEN sb.quantity <= 0 THEN 'Out of Stock'
    WHEN sb.quantity <= p.min_stock_level THEN 'Low Stock'
    ELSE 'In Stock'
  END as status
FROM stock_balances sb
INNER JOIN products p ON p.id = sb.product_id
WHERE sb.product_id = ? AND sb.warehouse_id = ?;

-- QUERY 7: Verify All Sales Have Movements (Detailed)
SELECT 
  o.order_number,
  o.created_at,
  oi.product_id,
  p.name as product_name,
  oi.quantity as sold_quantity,
  CASE 
    WHEN EXISTS (
      SELECT 1 FROM stock_moves sm
      WHERE sm.reference_type = 'order'
        AND sm.reference_id = o.id
        AND sm.product_id = oi.product_id
    ) THEN 'Has Movement'
    ELSE 'MISSING MOVEMENT'
  END as movement_status
FROM orders o
INNER JOIN order_items oi ON oi.order_id = o.id
INNER JOIN products p ON p.id = oi.product_id
WHERE o.status = 'completed'
  AND p.track_stock = 1
ORDER BY o.created_at DESC;
*/

-- ============================================================================
-- ADDITIONAL INDEXES (for performance optimization)
-- ============================================================================

-- Composite index for stock_moves lookups by product and warehouse (if not exists)
-- Note: Individual indexes already exist, but composite can help with specific queries
CREATE INDEX IF NOT EXISTS idx_stock_moves_product_warehouse 
ON stock_moves(product_id, warehouse_id);

-- Index for stock_moves by reference (order lookups)
-- Note: Already exists as idx_stock_moves_reference, but adding for clarity
-- CREATE INDEX IF NOT EXISTS idx_stock_moves_reference_type_id 
-- ON stock_moves(reference_type, reference_id);

-- Index for order_items by product (for stock verification queries)
CREATE INDEX IF NOT EXISTS idx_order_items_product 
ON order_items(product_id);

-- Index for filtering stock_balances by quantity (low stock alerts)
CREATE INDEX IF NOT EXISTS idx_stock_balances_quantity 
ON stock_balances(quantity);

-- ============================================================================
-- NOTES ON SCHEMA CHOICE
-- ============================================================================

/*
SCHEMA CHOICE: Normalized Inventory (stock_balances + stock_moves ledger)

We chose a normalized inventory approach with two tables:

1. stock_balances (current state)
   - Stores current stock quantity per product/warehouse
   - Fast lookups for current stock levels
   - UNIQUE constraint on (product_id, warehouse_id)
   - CHECK constraint prevents negative stock (enforced at DB level)
   - Note: Application layer also checks allow_negative_stock setting

2. stock_moves (audit ledger)
   - Immutable log of ALL stock changes
   - Tracks before/after quantities for audit trail
   - Links to source documents (orders, returns, purchases, adjustments)
   - Can reconstruct stock balance from movements (for verification)

ADVANTAGES:
- Audit trail: Complete history of all stock changes
- Data integrity: Can verify stock_balances against stock_moves sum
- Performance: Fast current stock lookups from stock_balances
- Traceability: Know exactly when/why/how stock changed
- Reconciliation: Easy to detect discrepancies

ALTERNATIVE (current_stock on products table):
- Simpler schema
- No multi-warehouse support without additional tables
- No audit trail
- Harder to verify data integrity
- Cannot reconstruct history

The normalized approach is better for production POS systems that need:
- Multi-warehouse support
- Audit compliance
- Stock reconciliation
- Historical analysis
*/

-- ============================================================================
-- VALIDATION QUERIES (Run after migration to verify)
-- ============================================================================

/*
-- Run these queries to verify the migration:

-- 1. Check that views were created
SELECT name FROM sqlite_master WHERE type = 'view' AND name LIKE 'vw_stock%';

-- 2. Verify stock consistency (should return 0 rows if consistent)
SELECT COUNT(*) as inconsistency_count FROM vw_stock_consistency_check;
-- Expected: 0

-- 3. Check for negative stock
SELECT COUNT(*) as negative_stock_count FROM vw_negative_stock_check;
-- Expected: 0 (if negative stock not allowed)

-- 4. Verify indexes were created
SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_stock%';
*/





















































-- ============================================================================
-- DATABASE WIPE SCRIPT
-- Wipes all transactional and master data while preserving users
-- ============================================================================
-- 
-- This script:
-- 1. Deletes all transactional data (orders, sales, returns, purchases, inventory movements)
-- 2. Deletes all master data (products, categories, warehouses, shifts)
-- 3. Resets auto-increment sequences
-- 4. Preserves users table (so you can still log in)
-- 
-- NOTE: This migration is executed within a transaction by the migration runner.
-- Do NOT include BEGIN TRANSACTION or COMMIT statements.
-- ============================================================================

-- ============================================================================
-- STEP 1: DELETE TRANSACTIONAL DATA
-- ============================================================================

-- Sales/Orders related tables
DELETE FROM order_items;
DELETE FROM payments;
DELETE FROM receipts;
DELETE FROM orders;

-- Returns related tables
DELETE FROM return_items;
DELETE FROM sale_return_items;
DELETE FROM sales_returns;
DELETE FROM sale_returns;

-- Purchases related tables
DELETE FROM purchase_order_items;
DELETE FROM goods_receipt_items;
DELETE FROM goods_receipts;
DELETE FROM supplier_payments;
DELETE FROM purchase_orders;

-- Inventory movements and stock tracking
DELETE FROM inventory_adjustment_items;
DELETE FROM inventory_adjustments;
DELETE FROM stock_moves;
DELETE FROM stock_balances;
DELETE FROM inventory_movements;

-- Cash movements
DELETE FROM cash_movements;

-- Customer payments and ledger
DELETE FROM customer_ledger;
DELETE FROM customer_payments;
DELETE FROM customers; -- Delete customers too

-- Expenses
DELETE FROM expenses;

-- Held orders
DELETE FROM held_orders;

-- Shift totals
DELETE FROM shift_totals;

-- ============================================================================
-- STEP 2: DELETE MASTER DATA
-- ============================================================================

-- Products (must be deleted before categories due to foreign key)
DELETE FROM products;

-- Categories
DELETE FROM categories;

-- Warehouses
DELETE FROM warehouses;

-- Shifts
DELETE FROM shifts;

-- Suppliers
DELETE FROM suppliers;

-- Expense categories
DELETE FROM expense_categories;

-- Units (optional - you may want to keep these)
-- DELETE FROM units;

-- ============================================================================
-- STEP 3: RESET AUTO-INCREMENT SEQUENCES
-- ============================================================================

-- NOTE: sqlite_sequence table is only created when AUTOINCREMENT is used.
-- Since this database uses TEXT PRIMARY KEYs (not INTEGER AUTOINCREMENT),
-- the sqlite_sequence table may not exist. We skip resetting it.
-- If you need to reset sequences, you can do it manually after verifying
-- the table exists: DELETE FROM sqlite_sequence WHERE name IN (...);

-- ============================================================================
-- STEP 4: VERIFY USERS TABLE IS PRESERVED
-- ============================================================================

-- Users table is NOT deleted - you can still log in
-- The admin@pos.com user should remain intact
-- (Transaction is committed automatically by the migration runner)

-- ============================================================================
-- VERIFICATION QUERIES (run these after the script to verify)
-- ============================================================================
-- SELECT COUNT(*) as order_count FROM orders; -- Should be 0
-- SELECT COUNT(*) as product_count FROM products; -- Should be 0
-- SELECT COUNT(*) as category_count FROM categories; -- Should be 0
-- SELECT COUNT(*) as warehouse_count FROM warehouses; -- Should be 0
-- SELECT COUNT(*) as shift_count FROM shifts; -- Should be 0
-- SELECT COUNT(*) as user_count FROM users; -- Should be > 0 (at least admin user)
-- ============================================================================


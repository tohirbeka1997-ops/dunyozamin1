-- ============================================================================
-- DATA-ONLY WIPE SCRIPT
-- Clears all records while preserving schema, main warehouse, and admin user
-- ============================================================================
-- 
-- This script:
-- 1. Deletes all transactional data (orders, returns, inventory movements)
-- 2. Deletes all master data (products, categories, customers, shifts, expenses)
-- 3. Preserves main warehouse (main-warehouse-001)
-- 4. Preserves admin user (admin@pos.com)
-- 5. Resets auto-increment sequences
-- 
-- NOTE: This migration is executed within a transaction by the migration runner.
-- Do NOT include BEGIN TRANSACTION or COMMIT statements.
-- ============================================================================

-- ============================================================================
-- STEP 1: DELETE TRANSACTIONAL DATA
-- ============================================================================

-- Sales/Orders related tables (delete in order to respect foreign keys)
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
DELETE FROM customers;

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

-- Shifts
DELETE FROM shifts;

-- Suppliers
DELETE FROM suppliers;

-- Expense categories
DELETE FROM expense_categories;

-- ============================================================================
-- STEP 3: DELETE WAREHOUSES (EXCEPT MAIN WAREHOUSE)
-- ============================================================================

-- Keep only main-warehouse-001
DELETE FROM warehouses WHERE id != 'main-warehouse-001';

-- ============================================================================
-- STEP 4: DELETE USERS (EXCEPT ADMIN)
-- ============================================================================

-- Keep only admin@pos.com user
DELETE FROM users WHERE username != 'admin@pos.com';

-- Also clean up user_roles for deleted users (keep admin role assignment)
DELETE FROM user_roles 
WHERE user_id NOT IN (SELECT id FROM users WHERE username = 'admin@pos.com');

-- Clean up sessions for deleted users
DELETE FROM sessions 
WHERE user_id NOT IN (SELECT id FROM users WHERE username = 'admin@pos.com');

-- ============================================================================
-- STEP 5: RESET AUTO-INCREMENT SEQUENCES
-- ============================================================================

-- NOTE: sqlite_sequence table is only created when AUTOINCREMENT is used.
-- Since this database uses TEXT PRIMARY KEYs (not INTEGER AUTOINCREMENT),
-- the sqlite_sequence table may not exist. We skip resetting it.
-- If you need to reset sequences, you can do it manually after verifying
-- the table exists: DELETE FROM sqlite_sequence WHERE name IN (...);

-- ============================================================================
-- VERIFICATION NOTES
-- ============================================================================
-- After this wipe:
-- - Dashboard should show 0 so'm (no sales, no products, no customers)
-- - Main warehouse (main-warehouse-001) is preserved
-- - Admin user (admin@pos.com) is preserved and can still log in
-- - All table structures remain intact
-- - Application logic (single warehouse, manual SKU) remains unchanged
-- ============================================================================


/*
================================================================================
DELETE ALL DEMO DATA FROM SUPABASE DATABASE
================================================================================

This SQL script will PERMANENTLY DELETE all products, customers, orders,
and all transactional history from your Supabase database.

WARNING: This is IRREVERSIBLE. Make sure you want to delete everything!

The data you mentioned seeing:
- Products: "22222222", "teww", "asfsdf", "vxcv", "daasda", "3431", "admin", "asd", "olma"
- SKUs: "SKU-20251208-0009", "SKU-20251208-0008", etc.

These will all be deleted.

================================================================================
HOW TO RUN THIS SCRIPT
================================================================================

Option 1: Supabase Dashboard
1. Go to your Supabase project dashboard
2. Click on "SQL Editor" in the left sidebar
3. Click "New Query"
4. Copy and paste this entire script
5. Click "Run" (or press Ctrl+Enter)
6. Confirm the deletion

Option 2: Supabase CLI
1. Save this file as DELETE_ALL_DEMO_DATA.sql
2. Run: supabase db execute --file DELETE_ALL_DEMO_DATA.sql

Option 3: psql (if you have direct database access)
1. Connect to your database
2. Run: \i DELETE_ALL_DEMO_DATA.sql

================================================================================
*/

-- Disable foreign key checks temporarily for faster deletion
SET session_replication_role = 'replica';

-- ============================================================================
-- DELETE ALL TRANSACTIONAL DATA
-- ============================================================================

-- 1. Delete all order-related data (child tables first)
DELETE FROM order_items;
DELETE FROM payments;
DELETE FROM orders;

-- 2. Delete all sales return data
DELETE FROM sales_return_items;
DELETE FROM sales_returns;

-- 3. Delete all customer payment history
DELETE FROM customer_payments;

-- 4. Delete all inventory movements (stock history)
DELETE FROM inventory_movements;

-- 5. Delete all purchase order data
DELETE FROM purchase_order_items;
DELETE FROM purchase_orders;

-- 6. Delete all held orders (waiting orders in POS)
DELETE FROM held_orders;

-- 7. Delete all shifts (cashier shifts)
DELETE FROM shifts;

-- 8. Delete all employee activity logs
DELETE FROM employee_activity_logs;

-- 9. Delete all employee sessions
DELETE FROM employee_sessions;

-- ============================================================================
-- DELETE ALL MASTER DATA
-- ============================================================================

-- 10. Delete ALL products (including "22222222", "teww", "asfsdf", "olma", etc.)
DELETE FROM products;

-- 11. Delete ALL customers
DELETE FROM customers;

-- 12. Delete ALL suppliers
DELETE FROM suppliers;

-- 13. Delete ALL categories (optional - uncomment if you want to remove categories too)
-- DELETE FROM categories;

-- Re-enable foreign key checks
SET session_replication_role = 'origin';

-- ============================================================================
-- VERIFICATION QUERIES (Run these after deletion to confirm)
-- ============================================================================

-- Check product count (should be 0)
SELECT COUNT(*) as product_count FROM products;

-- Check customer count (should be 0)
SELECT COUNT(*) as customer_count FROM customers;

-- Check order count (should be 0)
SELECT COUNT(*) as order_count FROM orders;

-- Check inventory movement count (should be 0)
SELECT COUNT(*) as movement_count FROM inventory_movements;

-- ============================================================================
-- COMPLETION MESSAGE
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '========================================';
  RAISE NOTICE 'ALL DEMO DATA DELETED SUCCESSFULLY';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Products: 0';
  RAISE NOTICE 'Customers: 0';
  RAISE NOTICE 'Orders: 0';
  RAISE NOTICE 'Inventory Movements: 0';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Database is now clean and ready for real data.';
  RAISE NOTICE '========================================';
END $$;



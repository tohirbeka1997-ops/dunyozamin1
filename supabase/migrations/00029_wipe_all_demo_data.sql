/*
# Wipe All Demo/Test Data

This migration removes ALL demo, test, and seed data from the database
to ensure a completely clean state before production use.

## What This Does:
- Deletes all products
- Deletes all customers  
- Deletes all orders and order items
- Deletes all sales returns and return items
- Deletes all inventory movements
- Deletes all purchase orders and purchase order items
- Deletes all payments
- Deletes all customer payments
- Deletes all held orders
- Deletes all shifts
- Deletes all suppliers
- Deletes all categories (except system categories if any)
- Deletes all employee sessions and activity logs

## What This Preserves:
- User profiles (auth.users and profiles table)
- Settings table (system configuration)
- Database schema and functions
- RLS policies
- Triggers and stored procedures

## WARNING:
This will PERMANENTLY DELETE all transactional data.
Only run this on a development/test database or when setting up a fresh production instance.
*/

-- Disable foreign key checks temporarily for faster deletion
SET session_replication_role = 'replica';

-- Delete in order of dependencies (child tables first, then parent tables)

-- 1. Delete all order-related data
DELETE FROM order_items;
DELETE FROM payments;
DELETE FROM orders;

-- 2. Delete all sales return data
DELETE FROM sales_return_items;
DELETE FROM sales_returns;

-- 3. Delete all customer payment history
DELETE FROM customer_payments;

-- 4. Delete all inventory movements
DELETE FROM inventory_movements;

-- 5. Delete all purchase order data
DELETE FROM purchase_order_items;
DELETE FROM purchase_orders;

-- 6. Delete all held orders
DELETE FROM held_orders;

-- 7. Delete all shifts
DELETE FROM shifts;

-- 8. Delete all employee activity logs
DELETE FROM employee_activity_logs;

-- 9. Delete all employee sessions
DELETE FROM employee_sessions;

-- 10. Delete all products
DELETE FROM products;

-- 11. Delete all customers
DELETE FROM customers;

-- 12. Delete all suppliers
DELETE FROM suppliers;

-- 13. Delete all categories (if you want a completely clean slate)
-- Uncomment the line below if you want to remove categories too
-- DELETE FROM categories;

-- ============================================================================
-- VERIFICATION: Check that all demo data is deleted
-- ============================================================================
-- After running this migration, verify with:
-- SELECT COUNT(*) FROM products;      -- Should be 0
-- SELECT COUNT(*) FROM customers;     -- Should be 0
-- SELECT COUNT(*) FROM orders;       -- Should be 0
-- SELECT COUNT(*) FROM inventory_movements; -- Should be 0

-- Re-enable foreign key checks
SET session_replication_role = 'origin';

-- Reset sequences if any (PostgreSQL auto-increment counters)
-- Note: Most tables use UUID, but if any use serial/bigserial, reset them here
-- Example: ALTER SEQUENCE IF EXISTS products_id_seq RESTART WITH 1;

-- Log completion
DO $$
BEGIN
  RAISE NOTICE 'All demo/test data has been wiped. Database is now clean.';
END $$;


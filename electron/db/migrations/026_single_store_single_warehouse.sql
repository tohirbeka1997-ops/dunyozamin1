-- Migration: 026_single_store_single_warehouse.sql
-- Purpose: Enforce single-store + single-warehouse mode
-- - Ensure exactly one default store exists (UI should not select store)
-- - Ensure exactly one default warehouse exists and all references point to it
-- - Keep v_product_stock as the source of truth (inventory_movements)

-- ============================================================================
-- STORES: seed a single store (UI should not select store)
-- ============================================================================

-- Seed a single store
INSERT OR IGNORE INTO stores (id, code, name, address, phone, email, is_active, created_at, updated_at)
VALUES (
  'default-store-001',
  'MAIN',
  'Asosiy do''kon',
  NULL,
  NULL,
  NULL,
  1,
  datetime('now'),
  datetime('now')
);

-- Enforce single-store mode by keeping only the seeded store
DELETE FROM stores WHERE id != 'default-store-001';

-- ============================================================================
-- WAREHOUSES: seed main warehouse + normalize all references
-- ============================================================================

-- Ensure main warehouse exists
INSERT OR IGNORE INTO warehouses (id, code, name, address, is_default, is_active, created_at, updated_at)
VALUES (
  'main-warehouse-001',
  'MAIN',
  'Asosiy Ombor',
  NULL,
  1,
  1,
  datetime('now'),
  datetime('now')
);

-- Ensure only one default warehouse
UPDATE warehouses SET is_default = 0;
UPDATE warehouses SET is_default = 1, is_active = 1, updated_at = datetime('now') WHERE id = 'main-warehouse-001';

-- Normalize warehouse_id references (move everything to main warehouse)
UPDATE orders SET warehouse_id = 'main-warehouse-001' WHERE warehouse_id IS NULL OR warehouse_id != 'main-warehouse-001';
UPDATE sales_returns SET warehouse_id = 'main-warehouse-001' WHERE warehouse_id IS NULL OR warehouse_id != 'main-warehouse-001';
UPDATE shifts SET warehouse_id = 'main-warehouse-001' WHERE warehouse_id IS NULL OR warehouse_id != 'main-warehouse-001';
UPDATE purchase_orders SET warehouse_id = 'main-warehouse-001' WHERE warehouse_id IS NULL OR warehouse_id != 'main-warehouse-001';

UPDATE stock_balances SET warehouse_id = 'main-warehouse-001' WHERE warehouse_id IS NULL OR warehouse_id != 'main-warehouse-001';
UPDATE stock_moves SET warehouse_id = 'main-warehouse-001' WHERE warehouse_id IS NULL OR warehouse_id != 'main-warehouse-001';
UPDATE inventory_adjustments SET warehouse_id = 'main-warehouse-001' WHERE warehouse_id IS NULL OR warehouse_id != 'main-warehouse-001';
UPDATE inventory_movements SET warehouse_id = 'main-warehouse-001' WHERE warehouse_id IS NULL OR warehouse_id != 'main-warehouse-001';

-- Remove any other warehouses to enforce single-warehouse mode
DELETE FROM warehouses WHERE id != 'main-warehouse-001';



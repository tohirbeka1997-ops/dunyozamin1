-- ============================================================================
-- Migration: 030_inventory_analytics_indexes.sql
-- Purpose: Speed up inventory analytics queries (dead stock / turnover / reorder)
-- Notes:
-- - inventory_movements is the authoritative stock ledger.
-- - These composite indexes target common WHERE clauses:
--   movement_type + created_at + product_id
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_inventory_movements_type_date_product
ON inventory_movements(movement_type, created_at, product_id);

CREATE INDEX IF NOT EXISTS idx_inventory_movements_product_type_date
ON inventory_movements(product_id, movement_type, created_at);


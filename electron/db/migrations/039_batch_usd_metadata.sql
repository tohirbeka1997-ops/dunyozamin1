-- ============================================================================
-- 039 - Optional USD metadata for inventory batches (reporting only)
-- ============================================================================

ALTER TABLE inventory_batches ADD COLUMN usd_price REAL;
ALTER TABLE inventory_batches ADD COLUMN exchange_rate REAL;
ALTER TABLE inventory_batches ADD COLUMN usd_total REAL;

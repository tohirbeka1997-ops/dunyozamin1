-- ============================================================================
-- BATCH / FIFO: additive traceability columns (safe, non-destructive)
-- Migration: 137_batch_fifo_trace_columns.sql
--
-- Purpose:
-- - Align toward target batch model without rewriting qty/cost values
-- - batch_no / expiry_date for lot identity
-- - stock_movement_id on allocations for movement ↔ batch link (nullable)
-- - Policy setting: block costless surplus/adjustment_in in batch mode
--
-- Note: migrate.cjs uses safeAddColumn for ALTERs so re-runs are idempotent.
-- ============================================================================

INSERT OR IGNORE INTO settings (id, key, value, type, category, is_public, created_at, updated_at)
VALUES (
  lower(hex(randomblob(16))),
  'inventory.batch_require_cost_on_increase',
  '1',
  'boolean',
  'inventory',
  0,
  datetime('now'),
  datetime('now')
);

CREATE INDEX IF NOT EXISTS idx_inventory_batches_batch_no
  ON inventory_batches(batch_no);

CREATE INDEX IF NOT EXISTS idx_inventory_batches_expiry
  ON inventory_batches(expiry_date);

CREATE INDEX IF NOT EXISTS idx_inventory_batch_allocations_movement
  ON inventory_batch_allocations(stock_movement_id);

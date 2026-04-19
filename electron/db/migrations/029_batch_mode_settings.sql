-- ============================================================================
-- BATCH MODE SETTINGS DEFAULTS
-- Migration: 029_batch_mode_settings.sql
--
-- Purpose:
-- - Ensure batch-mode related settings keys exist with safe defaults.
-- - Values can be updated via SettingsService / cutover job.
-- ============================================================================

INSERT OR IGNORE INTO settings (id, key, value, type, description, category, is_public, created_at, updated_at)
VALUES
  (lower(hex(randomblob(16))), 'inventory.batch_mode_enabled', '0', 'boolean', 'Enable batch (partiya) mode after cutover', 'inventory', 0, datetime('now'), datetime('now')),
  (lower(hex(randomblob(16))), 'inventory.batch_cutover_at', '', 'string', 'Batch mode cutover datetime (YYYY-MM-DD HH:MM:SS)', 'inventory', 0, datetime('now'), datetime('now')),
  (lower(hex(randomblob(16))), 'inventory.batch_opening_cost_mode', 'last_received_po_cost', 'string', 'Opening batch cost mode (last_received_po_cost | product_purchase_price)', 'inventory', 0, datetime('now'), datetime('now'));



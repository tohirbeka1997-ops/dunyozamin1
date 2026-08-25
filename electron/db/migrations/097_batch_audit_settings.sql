-- Migration: 097_batch_audit_settings.sql
-- FIFO batch audit: strict-block toggle, auto-reconcile/repair settings.
-- allocation `note` column is added via migrate.cjs safeAddColumn handler.

INSERT OR IGNORE INTO settings (id, key, value, type, description, category, is_public, created_at, updated_at)
VALUES
  (lower(hex(randomblob(16))), 'inventory.batch_strict_block', '0', 'boolean', 'Block sales when batch coverage is insufficient (1=strict, 0=auto-batch fallback)', 'inventory', 0, datetime('now'), datetime('now')),
  (lower(hex(randomblob(16))), 'inventory.batch_auto_reconcile', '1', 'boolean', 'Run batch reconcile checks on schedule and shift close', 'inventory', 0, datetime('now'), datetime('now')),
  (lower(hex(randomblob(16))), 'inventory.batch_auto_repair', '0', 'boolean', 'Auto-run repairBatchCoverage when drift is detected', 'inventory', 0, datetime('now'), datetime('now'));

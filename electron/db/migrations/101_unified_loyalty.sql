-- ============================================================================
-- Unified loyalty: POS bonus_points as single balance source; loyalty cards
-- on all customers; earn scope default all_customers; phone mode setting.
-- Column adds + data backfill run in migrate.cjs (safeAddColumn).
-- ============================================================================

INSERT OR IGNORE INTO settings (id, key, value, type, description, category, is_public)
VALUES
  (lower(hex(randomblob(16))), 'customers.phone.mode', 'recommend', 'string', 'Telefon: optional | recommend | required', 'sales', 1);

-- New installs: earn for all customers by default.
INSERT OR IGNORE INTO settings (id, key, value, type, description, category, is_public)
VALUES
  (lower(hex(randomblob(16))), 'loyalty.earn.scope', 'all_customers', 'string', 'Yig''ish: off | master_only | all_customers | exclude_walk_in', 'sales', 1);

-- Migrate factory default from master_only → all_customers (one-time).
UPDATE settings
SET value = 'all_customers',
    description = 'Yig''ish: off | master_only | all_customers | exclude_walk_in'
WHERE key = 'loyalty.earn.scope' AND value = 'master_only';

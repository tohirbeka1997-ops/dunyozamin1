-- FIFO mode toggle for accounting-safe valuation
INSERT OR IGNORE INTO settings (id, key, value, type, description, category, is_public)
VALUES
  (lower(hex(randomblob(16))), 'inventory.fifo_enabled', '1', 'boolean', 'Enable FIFO valuation for reports', 'inventory', 1);

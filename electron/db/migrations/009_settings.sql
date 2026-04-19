-- ============================================================================
-- SETTINGS AND AUDIT TABLES
-- ============================================================================

-- Settings (key-value store for app configuration)
CREATE TABLE IF NOT EXISTS settings (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  value TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'string', -- 'string', 'number', 'boolean', 'json'
  description TEXT,
  category TEXT, -- 'general', 'inventory', 'sales', etc.
  is_public INTEGER NOT NULL DEFAULT 0, -- Whether frontend can read
  updated_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (updated_by) REFERENCES users(id)
);

-- Audit Log (for tracking important actions)
CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  action TEXT NOT NULL, -- 'create', 'update', 'delete', 'login', etc.
  entity_type TEXT NOT NULL, -- 'product', 'order', 'user', etc.
  entity_id TEXT,
  old_values TEXT, -- JSON snapshot
  new_values TEXT, -- JSON snapshot
  ip_address TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Indexes for settings and audit tables
CREATE INDEX IF NOT EXISTS idx_settings_key ON settings(key);
CREATE INDEX IF NOT EXISTS idx_settings_category ON settings(category);
CREATE INDEX IF NOT EXISTS idx_settings_public ON settings(is_public);

CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at);

-- Insert default settings
INSERT OR IGNORE INTO settings (id, key, value, type, description, category) VALUES
  (lower(hex(randomblob(16))), 'allow_negative_stock', '0', 'boolean', 'Allow negative stock quantities', 'inventory'),
  (lower(hex(randomblob(16))), 'default_warehouse', '', 'string', 'Default warehouse ID', 'inventory'),
  (lower(hex(randomblob(16))), 'currency_symbol', '$', 'string', 'Currency symbol for display', 'general'),
  (lower(hex(randomblob(16))), 'currency_code', 'USD', 'string', 'Currency code', 'general'),
  (lower(hex(randomblob(16))), 'tax_rate', '0', 'number', 'Default tax rate (decimal)', 'sales'),
  (lower(hex(randomblob(16))), 'receipt_footer', '', 'string', 'Footer text for receipts', 'sales'),
  (lower(hex(randomblob(16))), 'company_name', '', 'string', 'Company name', 'general'),
  (lower(hex(randomblob(16))), 'company_address', '', 'string', 'Company address', 'general');






















































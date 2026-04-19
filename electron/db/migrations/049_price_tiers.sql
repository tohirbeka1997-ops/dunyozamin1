-- Price tiers master table
CREATE TABLE IF NOT EXISTS price_tiers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE, -- 'retail','master','wholesale','marketplace'
  name TEXT NOT NULL,
  priority INTEGER NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1
);

-- Seed default tiers (idempotent)
INSERT OR IGNORE INTO price_tiers (code, name, priority, is_active) VALUES
  ('retail', 'Retail', 1, 1),
  ('master', 'Master/Usta', 2, 1),
  ('wholesale', 'Wholesale', 3, 1),
  ('marketplace', 'Marketplace', 4, 1);

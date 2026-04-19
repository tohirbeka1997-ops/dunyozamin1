-- ============================================================================
-- Usta (master-tier) customer loyalty: bonus_points column + optional ledger
-- ============================================================================
-- Note: customers.bonus_points is added idempotently in migrate.cjs (safeAddColumn).
-- This file creates the ledger table and default loyalty settings.

CREATE TABLE IF NOT EXISTS customer_bonus_ledger (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  type TEXT NOT NULL, -- 'earn' | 'redeem' | 'adjust'
  points REAL NOT NULL,
  order_id TEXT,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_by TEXT,
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  FOREIGN KEY (order_id) REFERENCES orders(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_customer_bonus_ledger_customer ON customer_bonus_ledger(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_bonus_ledger_order ON customer_bonus_ledger(order_id);
CREATE INDEX IF NOT EXISTS idx_customer_bonus_ledger_created ON customer_bonus_ledger(created_at);

INSERT OR IGNORE INTO settings (id, key, value, type, description, category, is_public)
VALUES
  (lower(hex(randomblob(16))), 'loyalty.master.enabled', '0', 'boolean', 'Usta (master-tier) mijozlar uchun bonus ball yoqilgan', 'sales', 1),
  (lower(hex(randomblob(16))), 'loyalty.master.points_per_uzs', '1000', 'number', 'Har qancha so''m to''langan summaga 1 ball (butun qism)', 'sales', 1);

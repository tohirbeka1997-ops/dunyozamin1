-- Customers audit hardening (2026-08-27): loyalty QR history + bonus/limit settings.

CREATE TABLE IF NOT EXISTS customer_loyalty_card_history (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  loyalty_card_code TEXT NOT NULL,
  qr_payload TEXT,
  status TEXT NOT NULL DEFAULT 'replaced',
  reason TEXT,
  replaced_by TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_customer_loyalty_card_history_customer
  ON customer_loyalty_card_history(customer_id, created_at DESC);

INSERT OR IGNORE INTO settings (id, key, value, type, description, category, is_public) VALUES
  (lower(hex(randomblob(16))), 'customers.bonus.correction_per_op', '5000', 'number',
   'Bonus korreksiya bir martalik limit', 'customers', 0),
  (lower(hex(randomblob(16))), 'customers.bonus.correction_per_day', '20000', 'number',
   'Bonus korreksiya kunlik limit', 'customers', 0),
  (lower(hex(randomblob(16))), 'customers.bonus.large_threshold', '1000', 'number',
   'Katta bonus korreksiya uchun tasdiq chegarasi', 'customers', 0),
  (lower(hex(randomblob(16))), 'customers.bonus.initial_limit', '10000', 'number',
   'Yangi mijoz boshlang''ich bonus limiti', 'customers', 0);

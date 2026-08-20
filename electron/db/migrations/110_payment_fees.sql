-- Phase 3: acquiring / payment-method commissions persisted at payment time.
-- fee_percent / fee_fixed on payment_methods are added in migrate.cjs (safeAddColumn).

CREATE TABLE IF NOT EXISTS payment_fees (
  id TEXT PRIMARY KEY,
  payment_id TEXT NOT NULL UNIQUE,
  order_id TEXT,
  payment_method TEXT NOT NULL,
  payment_amount REAL NOT NULL DEFAULT 0,
  fee_percent REAL NOT NULL DEFAULT 0,
  fee_fixed REAL NOT NULL DEFAULT 0,
  fee_amount REAL NOT NULL DEFAULT 0,
  fee_amount_uzs REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'UZS',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_payment_fees_order_id ON payment_fees(order_id);
CREATE INDEX IF NOT EXISTS idx_payment_fees_method ON payment_fees(payment_method);
CREATE INDEX IF NOT EXISTS idx_payment_fees_created_at ON payment_fees(created_at);

INSERT OR IGNORE INTO payment_methods (slug, name) VALUES
  ('cash', 'Naqd pul'),
  ('card', 'Karta'),
  ('transfer', 'O''tkazma'),
  ('bank', 'Bank'),
  ('click', 'Click'),
  ('payme', 'Payme'),
  ('marketplace', 'Marketplace');

INSERT OR IGNORE INTO settings (id, key, value, type, description, category, is_public, created_at, updated_at) VALUES
  (lower(hex(randomblob(16))), 'payment_fees.card.percent', '0', 'number', 'Card acquiring fee percent', 'sales', 0, datetime('now'), datetime('now')),
  (lower(hex(randomblob(16))), 'payment_fees.card.fixed', '0', 'number', 'Card acquiring fee fixed (sale currency)', 'sales', 0, datetime('now'), datetime('now')),
  (lower(hex(randomblob(16))), 'payment_fees.transfer.percent', '0', 'number', 'Bank transfer fee percent', 'sales', 0, datetime('now'), datetime('now')),
  (lower(hex(randomblob(16))), 'payment_fees.transfer.fixed', '0', 'number', 'Bank transfer fee fixed', 'sales', 0, datetime('now'), datetime('now')),
  (lower(hex(randomblob(16))), 'payment_fees.bank.percent', '0', 'number', 'Bank fee percent', 'sales', 0, datetime('now'), datetime('now')),
  (lower(hex(randomblob(16))), 'payment_fees.bank.fixed', '0', 'number', 'Bank fee fixed', 'sales', 0, datetime('now'), datetime('now')),
  (lower(hex(randomblob(16))), 'payment_fees.click.percent', '0', 'number', 'Click fee percent', 'sales', 0, datetime('now'), datetime('now')),
  (lower(hex(randomblob(16))), 'payment_fees.click.fixed', '0', 'number', 'Click fee fixed', 'sales', 0, datetime('now'), datetime('now')),
  (lower(hex(randomblob(16))), 'payment_fees.payme.percent', '0', 'number', 'Payme fee percent', 'sales', 0, datetime('now'), datetime('now')),
  (lower(hex(randomblob(16))), 'payment_fees.payme.fixed', '0', 'number', 'Payme fee fixed', 'sales', 0, datetime('now'), datetime('now')),
  (lower(hex(randomblob(16))), 'payment_fees.marketplace.percent', '0', 'number', 'Marketplace fee percent', 'sales', 0, datetime('now'), datetime('now')),
  (lower(hex(randomblob(16))), 'payment_fees.marketplace.fixed', '0', 'number', 'Marketplace fee fixed', 'sales', 0, datetime('now'), datetime('now'));

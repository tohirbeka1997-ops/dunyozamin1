-- Migration: 031_exchange_rates.sql
-- Adds exchange_rates table for multi-currency support (USD/UZS, etc.)

CREATE TABLE IF NOT EXISTS exchange_rates (
  id TEXT PRIMARY KEY,
  base_currency TEXT NOT NULL,  -- e.g. 'USD'
  quote_currency TEXT NOT NULL, -- e.g. 'UZS'
  rate REAL NOT NULL,           -- quote per 1 base (1 USD = rate UZS)
  effective_date TEXT NOT NULL, -- YYYY-MM-DD
  source TEXT,                  -- 'manual', 'api', etc.
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (created_by) REFERENCES users(id)
);

-- One rate per day per currency pair
CREATE UNIQUE INDEX IF NOT EXISTS idx_exchange_rates_pair_date
  ON exchange_rates(base_currency, quote_currency, effective_date);

CREATE INDEX IF NOT EXISTS idx_exchange_rates_effective_date
  ON exchange_rates(effective_date);

CREATE INDEX IF NOT EXISTS idx_exchange_rates_created_at
  ON exchange_rates(created_at);


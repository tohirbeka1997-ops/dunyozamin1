-- POS customers: optional Telegram contact for credit (nasiya) reminders
-- when Mini App marketplace binding is missing.
-- Idempotent: safe to re-run (duplicate column → migrate.cjs marks applied).

ALTER TABLE customers ADD COLUMN telegram_id INTEGER;
ALTER TABLE customers ADD COLUMN telegram_username TEXT;

CREATE INDEX IF NOT EXISTS idx_customers_telegram_id ON customers(telegram_id);
CREATE INDEX IF NOT EXISTS idx_customers_telegram_username ON customers(telegram_username);

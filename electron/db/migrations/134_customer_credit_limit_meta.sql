-- Customer credit limit audit metadata (TZ: credit_limit control)
ALTER TABLE customers ADD COLUMN credit_limit_currency TEXT DEFAULT 'UZS';
ALTER TABLE customers ADD COLUMN credit_limit_updated_at TEXT;
ALTER TABLE customers ADD COLUMN credit_limit_updated_by TEXT;

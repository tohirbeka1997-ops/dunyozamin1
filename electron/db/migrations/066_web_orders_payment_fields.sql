-- To'lov muddati (TZ F-17) va provayder
ALTER TABLE web_orders ADD COLUMN payment_expires_at TEXT;
ALTER TABLE web_orders ADD COLUMN payment_provider TEXT;

-- Sales channel for multi-platform online orders (Telegram mini-app today; others later).
ALTER TABLE web_orders ADD COLUMN sales_channel TEXT NOT NULL DEFAULT 'telegram'
  CHECK (sales_channel IN ('telegram', 'website', 'uzum', 'yandex', 'other'));

CREATE INDEX IF NOT EXISTS idx_web_orders_sales_channel ON web_orders(sales_channel);

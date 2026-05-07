-- Add fulfillment method and customer feedback for Telegram marketplace orders.

ALTER TABLE web_orders ADD COLUMN delivery_method TEXT NOT NULL DEFAULT 'courier'
  CHECK (delivery_method IN ('courier', 'pickup'));

ALTER TABLE web_orders ADD COLUMN rating INTEGER
  CHECK (rating IS NULL OR (rating >= 1 AND rating <= 5));

ALTER TABLE web_orders ADD COLUMN feedback TEXT;

ALTER TABLE web_orders ADD COLUMN rated_at TEXT;

CREATE INDEX IF NOT EXISTS idx_web_orders_delivery_method ON web_orders(delivery_method);

-- Idempotency + device tracking for multi-terminal safety
ALTER TABLE orders ADD COLUMN order_uuid TEXT;
ALTER TABLE orders ADD COLUMN device_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_order_uuid ON orders(order_uuid);

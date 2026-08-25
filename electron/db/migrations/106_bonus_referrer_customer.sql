-- POS: optional usta (referring master) for bonus routing only.
-- Sale/debt still belongs to buyer (customer_id); bonus_points accrue to bonus_referrer_customer_id when set.

ALTER TABLE orders ADD COLUMN bonus_referrer_customer_id TEXT;

CREATE INDEX IF NOT EXISTS idx_orders_bonus_referrer_customer
  ON orders(bonus_referrer_customer_id);

-- Persist discounts applied to online orders at checkout so the operator (POS
-- admin / mini-app order detail) sees what was actually charged. total_amount
-- stores the NET payable (subtotal - discount_amount).
ALTER TABLE web_orders ADD COLUMN discount_amount INTEGER NOT NULL DEFAULT 0;
ALTER TABLE web_orders ADD COLUMN promo_code TEXT;
ALTER TABLE web_orders ADD COLUMN points_redeemed INTEGER NOT NULL DEFAULT 0;

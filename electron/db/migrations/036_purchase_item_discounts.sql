-- ============================================================================
-- 036 - Purchase order item discounts
-- Adds per-item discount fields for purchase order items
-- ============================================================================

ALTER TABLE purchase_order_items ADD COLUMN discount_percent REAL;
ALTER TABLE purchase_order_items ADD COLUMN discount_amount REAL;

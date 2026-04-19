-- ============================================================================
-- 058 - Purchase order item sale price (sotish narxi)
-- Adds optional sale_price per item - used to update product.sale_price on receive
-- ============================================================================

ALTER TABLE purchase_order_items ADD COLUMN sale_price REAL;

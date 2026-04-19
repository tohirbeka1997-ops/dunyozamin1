-- ============================================================================
-- 034 - Dual pricing (Retail vs Master/Usta)
-- Adds:
--   - products.master_price, products.master_min_qty
--   - customers.pricing_tier
--   - order_items.price_tier
-- ============================================================================

-- Products: optional Master/Usta price + optional min qty threshold
ALTER TABLE products ADD COLUMN master_price REAL;
ALTER TABLE products ADD COLUMN master_min_qty REAL;

-- Customers: pricing tier separate from existing `type` (individual/company)
ALTER TABLE customers ADD COLUMN pricing_tier TEXT NOT NULL DEFAULT 'retail';

-- Order items: persist which tier was applied for each line item
ALTER TABLE order_items ADD COLUMN price_tier TEXT NOT NULL DEFAULT 'retail';


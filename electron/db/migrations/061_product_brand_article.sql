-- ============================================================================
-- Add brand and article columns to products
-- brand: free-text manufacturer/brand name
-- article: short vendor/supplier article code; multiple products may share one article
--          so typing the article in POS shows all matching products
-- ============================================================================
-- Note: safeAddColumn in migrate.cjs handles idempotency for ALTER TABLE.

ALTER TABLE products ADD COLUMN brand TEXT;
ALTER TABLE products ADD COLUMN article TEXT;

CREATE INDEX IF NOT EXISTS idx_products_article ON products(article);
CREATE INDEX IF NOT EXISTS idx_products_brand   ON products(brand);

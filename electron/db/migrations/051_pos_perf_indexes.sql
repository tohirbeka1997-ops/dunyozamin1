-- POS performance indexes + normalized_name support
ALTER TABLE products ADD COLUMN normalized_name TEXT;

UPDATE products
SET normalized_name = lower(trim(replace(replace(replace(name, '  ', ' '), '\t', ' '), '\n', ' ')))
WHERE normalized_name IS NULL OR normalized_name = '';

CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);
CREATE INDEX IF NOT EXISTS idx_products_normalized_name ON products(normalized_name);

CREATE INDEX IF NOT EXISTS idx_product_prices_product_tier_currency_unit
ON product_prices(product_id, tier_id, currency, unit);

CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);
CREATE INDEX IF NOT EXISTS idx_order_items_order_product ON order_items(order_id, product_id);

-- Pricing policy settings + order tier tracking
ALTER TABLE orders ADD COLUMN price_tier_id INTEGER;

INSERT OR IGNORE INTO settings (id, key, value, type, description, category, is_public)
VALUES
  (lower(hex(randomblob(16))), 'pricing.allow_retail_fallback', '0', 'boolean', 'Allow fallback to retail price when tier price missing', 'sales', 1),
  (lower(hex(randomblob(16))), 'pricing.max_discount_percent_by_role', '{}', 'json', 'Max discount percent by role (JSON map)', 'sales', 0);

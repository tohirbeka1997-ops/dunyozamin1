-- Product prices per tier/unit/currency
CREATE TABLE IF NOT EXISTS product_prices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id TEXT NOT NULL,
  tier_id INTEGER NOT NULL,
  unit TEXT NOT NULL, -- sale unit
  currency TEXT NOT NULL DEFAULT 'UZS',
  price NUMERIC NOT NULL,
  updated_at TEXT,
  UNIQUE(product_id, tier_id, currency, unit),
  FOREIGN KEY (product_id) REFERENCES products(id),
  FOREIGN KEY (tier_id) REFERENCES price_tiers(id)
);

CREATE INDEX IF NOT EXISTS idx_product_prices_product_tier ON product_prices(product_id, tier_id);
CREATE INDEX IF NOT EXISTS idx_product_prices_product_currency ON product_prices(product_id, currency);

-- Backfill: Retail prices from product_units.sale_price (preferred) or products.sale_price
INSERT OR IGNORE INTO product_prices (product_id, tier_id, unit, currency, price, updated_at)
SELECT
  pu.product_id,
  (SELECT id FROM price_tiers WHERE code = 'retail' LIMIT 1) AS tier_id,
  pu.unit,
  'UZS' AS currency,
  COALESCE(pu.sale_price, p.sale_price, 0) AS price,
  datetime('now') AS updated_at
FROM product_units pu
LEFT JOIN products p ON p.id = pu.product_id
WHERE pu.product_id IS NOT NULL;

-- Fallback for products without product_units
INSERT OR IGNORE INTO product_prices (product_id, tier_id, unit, currency, price, updated_at)
SELECT
  p.id AS product_id,
  (SELECT id FROM price_tiers WHERE code = 'retail' LIMIT 1) AS tier_id,
  COALESCE(p.base_unit, (SELECT code FROM units WHERE id = p.unit_id), 'pcs') AS unit,
  'UZS' AS currency,
  COALESCE(p.sale_price, 0) AS price,
  datetime('now') AS updated_at
FROM products p
WHERE NOT EXISTS (SELECT 1 FROM product_units pu WHERE pu.product_id = p.id);

-- Backfill: Master prices (scaled by ratio_to_base when units exist)
INSERT OR IGNORE INTO product_prices (product_id, tier_id, unit, currency, price, updated_at)
SELECT
  pu.product_id,
  (SELECT id FROM price_tiers WHERE code = 'master' LIMIT 1) AS tier_id,
  pu.unit,
  'UZS' AS currency,
  COALESCE(p.master_price, 0) * COALESCE(pu.ratio_to_base, 1) AS price,
  datetime('now') AS updated_at
FROM product_units pu
LEFT JOIN products p ON p.id = pu.product_id
WHERE p.master_price IS NOT NULL AND p.master_price > 0;

-- Fallback master price for products without product_units
INSERT OR IGNORE INTO product_prices (product_id, tier_id, unit, currency, price, updated_at)
SELECT
  p.id AS product_id,
  (SELECT id FROM price_tiers WHERE code = 'master' LIMIT 1) AS tier_id,
  COALESCE(p.base_unit, (SELECT code FROM units WHERE id = p.unit_id), 'pcs') AS unit,
  'UZS' AS currency,
  COALESCE(p.master_price, 0) AS price,
  datetime('now') AS updated_at
FROM products p
WHERE (p.master_price IS NOT NULL AND p.master_price > 0)
  AND NOT EXISTS (SELECT 1 FROM product_units pu WHERE pu.product_id = p.id);

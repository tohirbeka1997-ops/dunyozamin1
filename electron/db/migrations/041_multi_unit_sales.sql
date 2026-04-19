-- ============================================================================
-- 041 - Multi-unit sales (base unit + sale unit mapping)
-- ============================================================================

-- Add base_unit to products (single inventory unit)
ALTER TABLE products ADD COLUMN base_unit TEXT;

-- Map multiple sale units to a base unit
CREATE TABLE IF NOT EXISTS product_units (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  product_id TEXT NOT NULL,
  unit TEXT NOT NULL,
  ratio_to_base REAL NOT NULL DEFAULT 1,
  sale_price REAL NOT NULL DEFAULT 0,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_product_units_unique ON product_units(product_id, unit);
CREATE INDEX IF NOT EXISTS idx_product_units_product ON product_units(product_id);

-- Add multi-unit fields to order_items and return_items
ALTER TABLE order_items ADD COLUMN sale_unit TEXT;
ALTER TABLE order_items ADD COLUMN qty_sale REAL;
ALTER TABLE order_items ADD COLUMN qty_base REAL;

ALTER TABLE return_items ADD COLUMN sale_unit TEXT;
ALTER TABLE return_items ADD COLUMN qty_sale REAL;
ALTER TABLE return_items ADD COLUMN qty_base REAL;

-- Backfill base_unit from unit_id when possible
UPDATE products
SET base_unit = COALESCE(
  base_unit,
  (SELECT code FROM units WHERE id = unit_id),
  'pcs'
)
WHERE base_unit IS NULL OR base_unit = '';

-- Seed default product_units from existing products (ratio=1, default=1)
INSERT INTO product_units (id, product_id, unit, ratio_to_base, sale_price, is_default, created_at)
SELECT
  lower(hex(randomblob(16))),
  p.id,
  COALESCE(p.base_unit, 'pcs') AS unit,
  1,
  COALESCE(p.sale_price, 0),
  1,
  datetime('now')
FROM products p
WHERE NOT EXISTS (
  SELECT 1 FROM product_units pu WHERE pu.product_id = p.id
);

-- Backfill order_items + return_items quantities as sale/base
UPDATE order_items
SET
  sale_unit = COALESCE(sale_unit, (SELECT base_unit FROM products WHERE id = order_items.product_id), 'pcs'),
  qty_sale = COALESCE(qty_sale, quantity),
  qty_base = COALESCE(qty_base, quantity)
WHERE sale_unit IS NULL OR qty_sale IS NULL OR qty_base IS NULL;

UPDATE return_items
SET
  sale_unit = COALESCE(sale_unit, (SELECT base_unit FROM products WHERE id = return_items.product_id), 'pcs'),
  qty_sale = COALESCE(qty_sale, quantity),
  qty_base = COALESCE(qty_base, quantity)
WHERE sale_unit IS NULL OR qty_sale IS NULL OR qty_base IS NULL;

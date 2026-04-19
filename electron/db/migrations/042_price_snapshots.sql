-- ============================================================================
-- 042 - Price snapshots for enterprise returns
-- ============================================================================

-- Add snapshot columns to order_items
ALTER TABLE order_items ADD COLUMN base_price REAL;
ALTER TABLE order_items ADD COLUMN usta_price REAL;
ALTER TABLE order_items ADD COLUMN discount_type TEXT;
ALTER TABLE order_items ADD COLUMN discount_value REAL;
ALTER TABLE order_items ADD COLUMN final_unit_price REAL;
ALTER TABLE order_items ADD COLUMN final_total REAL;
ALTER TABLE order_items ADD COLUMN price_source TEXT;

-- Add snapshot columns to return_items
ALTER TABLE return_items ADD COLUMN base_price REAL;
ALTER TABLE return_items ADD COLUMN usta_price REAL;
ALTER TABLE return_items ADD COLUMN discount_type TEXT;
ALTER TABLE return_items ADD COLUMN discount_value REAL;
ALTER TABLE return_items ADD COLUMN final_unit_price REAL;
ALTER TABLE return_items ADD COLUMN final_total REAL;
ALTER TABLE return_items ADD COLUMN price_source TEXT;

-- Best-effort backfill for order_items
UPDATE order_items
SET
  base_price = COALESCE(base_price, unit_price),
  usta_price = COALESCE(usta_price, CASE WHEN price_tier = 'master' THEN unit_price ELSE NULL END),
  discount_type = COALESCE(discount_type, CASE WHEN discount_amount > 0 THEN 'fixed' ELSE 'none' END),
  discount_value = COALESCE(
    discount_value,
    CASE
      WHEN discount_amount > 0 AND COALESCE(qty_sale, quantity, 0) > 0 THEN discount_amount / COALESCE(qty_sale, quantity)
      ELSE 0
    END
  ),
  final_total = COALESCE(final_total, line_total),
  final_unit_price = COALESCE(
    final_unit_price,
    CASE
      WHEN COALESCE(qty_sale, quantity, 0) > 0 THEN COALESCE(line_total, unit_price * COALESCE(qty_sale, quantity)) / COALESCE(qty_sale, quantity)
      ELSE unit_price
    END
  ),
  price_source = COALESCE(price_source, CASE WHEN price_tier = 'master' THEN 'usta' ELSE 'base' END)
WHERE
  base_price IS NULL
  OR final_unit_price IS NULL
  OR final_total IS NULL
  OR price_source IS NULL;

-- Best-effort backfill for return_items
UPDATE return_items
SET
  base_price = COALESCE(base_price, unit_price),
  usta_price = COALESCE(usta_price, NULL),
  discount_type = COALESCE(discount_type, 'none'),
  discount_value = COALESCE(discount_value, 0),
  final_unit_price = COALESCE(final_unit_price, unit_price),
  final_total = COALESCE(final_total, line_total),
  price_source = COALESCE(price_source, 'base')
WHERE
  base_price IS NULL
  OR final_unit_price IS NULL
  OR final_total IS NULL
  OR price_source IS NULL;

-- Indexes for snapshot lookups
CREATE INDEX IF NOT EXISTS idx_order_items_price_source ON order_items(price_source);
CREATE INDEX IF NOT EXISTS idx_return_items_order_item_id ON return_items(order_item_id);

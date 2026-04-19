-- Migration: 016_inventory_stock_views.sql
-- Purpose: Create SQL views for real-time stock calculation from inventory_movements
-- This provides a single source of truth for stock across the application

-- Stock per product (global, across all warehouses)
DROP VIEW IF EXISTS v_product_stock;

CREATE VIEW v_product_stock AS
SELECT
  im.product_id,
  COALESCE(SUM(im.quantity), 0) AS stock
FROM inventory_movements im
GROUP BY im.product_id;

-- Stock per product per warehouse (if warehouse_id exists in inventory_movements)
-- Note: warehouse_id is now defined in 000_init.sql, so this view can be created
DROP VIEW IF EXISTS v_product_stock_by_warehouse;

CREATE VIEW v_product_stock_by_warehouse AS
SELECT
  im.product_id,
  im.warehouse_id,
  COALESCE(SUM(im.quantity), 0) AS stock
FROM inventory_movements im
WHERE im.warehouse_id IS NOT NULL
GROUP BY im.product_id, im.warehouse_id;

-- Index for better performance on inventory_movements queries
CREATE INDEX IF NOT EXISTS idx_inventory_movements_product_stock 
ON inventory_movements(product_id, quantity);

CREATE INDEX IF NOT EXISTS idx_inventory_movements_warehouse_stock 
ON inventory_movements(warehouse_id, product_id, quantity) 
WHERE warehouse_id IS NOT NULL;


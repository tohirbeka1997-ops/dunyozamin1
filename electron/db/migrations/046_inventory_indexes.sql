-- Performance indexes for inventory integrity checks
CREATE INDEX IF NOT EXISTS idx_inventory_movements_product_wh_time
ON inventory_movements(product_id, warehouse_id, created_at);

CREATE INDEX IF NOT EXISTS idx_stock_balances_product_wh
ON stock_balances(product_id, warehouse_id);

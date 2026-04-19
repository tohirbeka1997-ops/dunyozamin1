-- Indexes to speed up ledger queries
CREATE INDEX IF NOT EXISTS idx_inventory_movements_product_created
ON inventory_movements(product_id, created_at);

CREATE INDEX IF NOT EXISTS idx_inventory_movements_reference
ON inventory_movements(reference_type, reference_id);

-- Backfill order_items.cost_price where zero/missing (Phase 1 COGS fix).
-- Priority: FIFO batch allocations → latest purchase receipt → products.purchase_price.

UPDATE order_items
SET cost_price = COALESCE((
  SELECT SUM(a.quantity * a.unit_cost) / NULLIF(SUM(a.quantity), 0)
  FROM inventory_batch_allocations a
  WHERE a.reference_type = 'order_item'
    AND a.reference_id = order_items.id
    AND a.direction = 'out'
), cost_price)
WHERE COALESCE(cost_price, 0) = 0;

UPDATE order_items
SET cost_price = COALESCE((
  SELECT pri.unit_cost
  FROM purchase_receipt_items pri
  INNER JOIN purchase_receipts pr ON pr.id = pri.receipt_id
  WHERE pri.product_id = order_items.product_id
    AND COALESCE(pri.unit_cost, 0) > 0
  ORDER BY
    COALESCE(pr.received_at, pr.created_at) DESC,
    COALESCE(pr.created_at, pr.received_at) DESC,
    pri.id DESC
  LIMIT 1
), cost_price)
WHERE COALESCE(cost_price, 0) = 0;

UPDATE order_items
SET cost_price = COALESCE((
  SELECT purchase_price FROM products WHERE id = order_items.product_id
), 0)
WHERE COALESCE(cost_price, 0) = 0;

-- Recompute line_profit when column exists.
UPDATE order_items
SET line_profit = COALESCE(
  NULLIF(final_total, 0),
  NULLIF(line_total, 0),
  (unit_price * COALESCE(qty_sale, quantity, 0)) - COALESCE(discount_amount, 0)
) - (COALESCE(cost_price, 0) * ABS(COALESCE(qty_base, qty_sale, quantity, 0)))
WHERE COALESCE(cost_price, 0) > 0
  AND EXISTS (
    SELECT 1 FROM pragma_table_info('order_items') WHERE name = 'line_profit'
  );

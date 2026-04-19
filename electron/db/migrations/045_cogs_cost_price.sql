-- Enforce non-null cost_price for new order_items (legacy rows backfilled to 0)
UPDATE order_items SET cost_price = 0 WHERE cost_price IS NULL;

CREATE TRIGGER IF NOT EXISTS trg_order_items_cost_price_nn
BEFORE INSERT ON order_items
FOR EACH ROW
WHEN NEW.cost_price IS NULL
BEGIN
  SELECT RAISE(ABORT, 'order_items.cost_price is required');
END;

CREATE TRIGGER IF NOT EXISTS trg_order_items_cost_price_nn_update
BEFORE UPDATE OF cost_price ON order_items
FOR EACH ROW
WHEN NEW.cost_price IS NULL
BEGIN
  SELECT RAISE(ABORT, 'order_items.cost_price is required');
END;

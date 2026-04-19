-- ============================================================================
-- 040 - Batch receipt metadata (receipt linkage + currency snapshot)
-- ============================================================================

-- Add receipt linkage fields to inventory_batches
ALTER TABLE inventory_batches ADD COLUMN receipt_id TEXT;
ALTER TABLE inventory_batches ADD COLUMN receipt_item_id TEXT;
ALTER TABLE inventory_batches ADD COLUMN currency TEXT;
ALTER TABLE inventory_batches ADD COLUMN cost_price_uzs REAL;

-- Backfill receipt_item_id based on purchase_order_id + product_id (best-effort)
UPDATE inventory_batches
SET receipt_item_id = (
  SELECT pri.id
  FROM purchase_receipt_items pri
  INNER JOIN purchase_receipts pr ON pr.id = pri.receipt_id
  WHERE pr.purchase_order_id = inventory_batches.source_id
    AND pri.product_id = inventory_batches.product_id
  ORDER BY
    ABS(julianday(pri.created_at) - julianday(inventory_batches.opened_at)) ASC,
    pri.created_at ASC
  LIMIT 1
)
WHERE receipt_item_id IS NULL
  AND source_type = 'purchase_receive'
  AND source_id IS NOT NULL;

-- Backfill receipt_id + currency + exchange_rate from receipt
UPDATE inventory_batches
SET receipt_id = (
    SELECT pri.receipt_id
    FROM purchase_receipt_items pri
    WHERE pri.id = inventory_batches.receipt_item_id
  ),
  currency = (
    SELECT pr.currency
    FROM purchase_receipts pr
    WHERE pr.id = (
      SELECT pri2.receipt_id
      FROM purchase_receipt_items pri2
      WHERE pri2.id = inventory_batches.receipt_item_id
    )
  ),
  exchange_rate = CASE
    WHEN exchange_rate IS NULL THEN (
      SELECT pr.exchange_rate
      FROM purchase_receipts pr
      WHERE pr.id = (
        SELECT pri3.receipt_id
        FROM purchase_receipt_items pri3
        WHERE pri3.id = inventory_batches.receipt_item_id
      )
    )
    ELSE exchange_rate
  END
WHERE receipt_item_id IS NOT NULL;

-- Backfill cost_price_uzs from unit_cost
UPDATE inventory_batches
SET cost_price_uzs = unit_cost
WHERE cost_price_uzs IS NULL;

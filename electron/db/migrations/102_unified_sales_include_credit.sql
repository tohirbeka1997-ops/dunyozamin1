-- Include all completed POS sales in unified views (credit / on_credit / unpaid).
-- Idempotent: DROP + CREATE so column changes apply on re-run.

DROP VIEW IF EXISTS v_unified_sale_items;
DROP VIEW IF EXISTS v_unified_sales;

CREATE VIEW v_unified_sales AS
SELECT
  ('pos:' || o.id) AS unified_id,
  o.id AS source_id,
  'pos' AS sale_source,
  o.order_number,
  COALESCE(o.sales_channel, 'pos') AS sales_channel,
  o.customer_id,
  o.warehouse_id,
  o.user_id,
  o.cashier_id,
  o.shift_id,
  o.subtotal,
  o.discount_amount,
  o.tax_amount,
  o.total_amount,
  COALESCE(o.paid_amount, 0) AS paid_amount,
  COALESCE(o.credit_amount, 0) AS credit_amount,
  COALESCE(o.currency, 'UZS') AS currency,
  o.fx_rate,
  o.status,
  o.payment_status,
  o.created_at,
  o.updated_at
FROM orders o
WHERE o.status = 'completed'

UNION ALL

SELECT
  ('web:' || wo.id) AS unified_id,
  CAST(wo.id AS TEXT) AS source_id,
  'web' AS sale_source,
  wo.order_number,
  COALESCE(wo.sales_channel, 'telegram') AS sales_channel,
  CAST(wo.customer_id AS TEXT) AS customer_id,
  'main-warehouse-001' AS warehouse_id,
  NULL AS user_id,
  NULL AS cashier_id,
  NULL AS shift_id,
  CAST(wo.total_amount AS REAL) AS subtotal,
  CAST(COALESCE(wo.discount_amount, 0) AS REAL) AS discount_amount,
  0 AS tax_amount,
  CAST(wo.total_amount AS REAL) AS total_amount,
  CASE
    WHEN LOWER(TRIM(COALESCE(wo.payment_status, ''))) = 'paid'
      THEN CAST(wo.total_amount AS REAL)
    ELSE 0
  END AS paid_amount,
  0 AS credit_amount,
  'UZS' AS currency,
  NULL AS fx_rate,
  wo.status,
  wo.payment_status,
  wo.created_at,
  wo.updated_at
FROM web_orders wo
WHERE wo.status = 'delivered'
   OR wo.payment_status = 'paid';

CREATE VIEW v_unified_sale_items AS
SELECT
  ('pos:' || oi.id) AS unified_item_id,
  'pos' AS sale_source,
  ('pos:' || oi.order_id) AS unified_order_id,
  oi.order_id AS source_order_id,
  oi.id AS source_item_id,
  oi.product_id,
  oi.product_name,
  oi.product_sku,
  COALESCE(oi.quantity, 0) AS quantity,
  COALESCE(oi.qty_base, oi.quantity, 0) AS qty_base,
  oi.unit_price,
  oi.line_total,
  COALESCE(oi.cost_price, 0) AS cost_price
FROM order_items oi
INNER JOIN orders o ON o.id = oi.order_id
WHERE o.status = 'completed'

UNION ALL

SELECT
  ('web:' || woi.id) AS unified_item_id,
  'web' AS sale_source,
  ('web:' || woi.order_id) AS unified_order_id,
  CAST(woi.order_id AS TEXT) AS source_order_id,
  CAST(woi.id AS TEXT) AS source_item_id,
  woi.product_id,
  COALESCE(p.name, '') AS product_name,
  COALESCE(p.sku, '') AS product_sku,
  CAST(woi.quantity AS REAL) AS quantity,
  CAST(woi.quantity AS REAL) AS qty_base,
  CAST(woi.price_at_order AS REAL) AS unit_price,
  CAST(woi.quantity * woi.price_at_order AS REAL) AS line_total,
  COALESCE(woi.cost_price, 0) AS cost_price
FROM web_order_items woi
INNER JOIN web_orders wo ON wo.id = woi.order_id
LEFT JOIN products p ON p.id = woi.product_id
WHERE wo.status = 'delivered'
   OR wo.payment_status = 'paid';

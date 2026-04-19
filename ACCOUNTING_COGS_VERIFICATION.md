# COGS Verification Queries

## 1) Missing cost_price
```sql
SELECT oi.id, oi.order_id, oi.product_id, oi.quantity
FROM order_items oi
WHERE oi.cost_price IS NULL
LIMIT 50;
```

## 2) COGS by order (uses cost_price only)
```sql
SELECT
  o.id AS order_id,
  o.order_number,
  COALESCE(SUM(oi.quantity * COALESCE(oi.cost_price, 0)), 0) AS cogs
FROM orders o
JOIN order_items oi ON oi.order_id = o.id
WHERE o.status = 'completed'
GROUP BY o.id, o.order_number
ORDER BY o.created_at DESC
LIMIT 50;
```

## 3) FIFO allocation vs order_items.cost_price (audit)
```sql
SELECT
  oi.id AS order_item_id,
  oi.product_id,
  oi.quantity,
  oi.cost_price AS frozen_unit_cost,
  COALESCE(SUM(a.quantity * a.unit_cost) / NULLIF(SUM(a.quantity), 0), 0) AS allocation_unit_cost
FROM order_items oi
LEFT JOIN inventory_batch_allocations a
  ON a.reference_type = 'order_item'
 AND a.reference_id = oi.id
 AND a.direction = 'out'
GROUP BY oi.id, oi.product_id, oi.quantity, oi.cost_price
HAVING allocation_unit_cost > 0 AND ABS(allocation_unit_cost - COALESCE(oi.cost_price, 0)) > 0.0001;
```

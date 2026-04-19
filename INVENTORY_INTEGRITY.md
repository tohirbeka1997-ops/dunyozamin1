# Inventory Integrity Hardening

## Purpose
- `inventory_movements` is the source of truth.
- `stock_balances` is a cache that must match movements at all times.

## Rebuild (admin-only)
Use the service method `InventoryService.rebuildStockBalances()` to:
- Delete all `stock_balances`
- Recompute balances from `inventory_movements`
- Update `products.current_stock`

## Nightly Validation Script
Run via Electron runtime to ensure ABI compatibility with `better-sqlite3`:

```
electron ./electron/scripts/inventory-integrity-check.cjs
```

Log files are written to `<userData>/logs/inventory-integrity-<timestamp>.log`.

## Manual Audit SQL
Compare movements vs balances:

```sql
SELECT
  im.product_id,
  im.warehouse_id,
  COALESCE(SUM(im.quantity), 0) AS movements_qty,
  COALESCE(sb.quantity, 0) AS balance_qty,
  COALESCE(SUM(im.quantity), 0) - COALESCE(sb.quantity, 0) AS diff
FROM inventory_movements im
LEFT JOIN stock_balances sb
  ON sb.product_id = im.product_id AND sb.warehouse_id = im.warehouse_id
GROUP BY im.product_id, im.warehouse_id
HAVING ABS(diff) > 0.0001;
```

Check negative stock (when not allowed):

```sql
SELECT product_id, warehouse_id, SUM(quantity) AS qty
FROM inventory_movements
GROUP BY product_id, warehouse_id
HAVING qty < 0;
```

Find orphan movements (missing products):

```sql
SELECT im.id, im.product_id, im.warehouse_id
FROM inventory_movements im
LEFT JOIN products p ON p.id = im.product_id
WHERE p.id IS NULL;
```

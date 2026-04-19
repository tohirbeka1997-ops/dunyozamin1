# POS Performance Notes

## Indexes
- `products(sku)`, `products(barcode)`, `products(normalized_name)`
- `product_prices(product_id, tier_id, currency, unit)`
- `orders(created_at)`, `order_items(order_id, product_id)`

## Caching
- Main process keeps product lookups (SKU/barcode/id).
- Price cache keyed by `(product_id, tier_id, currency, unit)`.
- Invalidation on product updates and price updates.

## Benchmarks (target)
- Barcode scan → item added: <150ms average
- Search results: <200ms for 5k SKU

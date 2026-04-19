# Pricing Tiers

## Overview
- Tiers: `retail`, `master`, `wholesale`, `marketplace`
- Source of truth: `price_tiers` + `product_prices`
- Orders store tier on `orders.price_tier_id`
- Items store tier snapshot on `order_items.price_tier` and price snapshot in `order_items.unit_price`

## Tier Resolution (POS)
1. If customer has `customers.pricing_tier` → use it.
2. Else use POS-selected tier.
3. Else default to `retail`.

If a tier price is missing:
- `pricing.allow_retail_fallback = 1` → fallback to retail.
- Otherwise sale is blocked.

## Manual Overrides
- Manual price override is allowed only for `admin`/`manager` roles.
- Overrides are stored as `order_items.price_source = 'manual'`.
- Tier changes do not overwrite overridden items.

## Discount Caps
- `pricing.max_discount_percent_by_role` is a JSON map: `{ "admin": 100, "manager": 20, "cashier": 5 }`
- Server enforces per-line discount caps in `SalesService`.

## Data Model
- `price_tiers(id, code, name, priority, is_active)`
- `product_prices(product_id, tier_id, unit, currency, price, updated_at)`

## Notes
- `product_prices.unit` uses sale units from `product_units`.
- Existing `products.sale_price/master_price` remain for backward compatibility.

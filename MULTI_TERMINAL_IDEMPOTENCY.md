# Multi-Terminal Idempotency

## Goals
- Prevent duplicate orders across LAN RPC retries.
- Preserve backward compatibility for legacy clients.

## Data Model
- `orders.order_uuid` (client-generated UUID v4)
- `orders.device_id` (persistent device UUID from `pos-config.json`)
- Unique index on `order_uuid` ensures no duplicates.

## Server Behavior
- If `order_uuid` exists in DB, return the existing order and log the duplicate attempt.
- If missing, server generates a UUID to preserve schema requirements (legacy clients).

## Client Behavior
- Generate `order_uuid` once per order (UUID v4).
- Send `device_id` from `pos-config.json` with each order.

## Operational Notes
- Older clients without `order_uuid` will still work but won’t be deduplicated.
- Monitor logs for duplicate attempts to detect network retry storms.

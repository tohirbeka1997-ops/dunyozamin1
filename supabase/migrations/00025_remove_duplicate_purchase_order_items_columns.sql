/*
# Remove Duplicate Columns from purchase_order_items

## Problem
Migration 00010 added new columns (ordered_qty, unit_cost, line_total) but did not drop
the old columns (quantity, unit_price, total). This causes NOT NULL constraint violations
because the frontend sends the new column names but the old columns remain NOT NULL.

## Solution
Drop the old redundant columns:
- quantity → replaced by ordered_qty
- unit_price → replaced by unit_cost
- total → replaced by line_total

## Impact
- No data loss (new columns already contain the data)
- Fixes "null value in column 'quantity' violates not-null constraint" error
- Simplifies schema by removing duplicate columns
*/

-- Drop old redundant columns
ALTER TABLE purchase_order_items 
  DROP COLUMN IF EXISTS quantity,
  DROP COLUMN IF EXISTS unit_price,
  DROP COLUMN IF EXISTS total;

-- Add helpful comment
COMMENT ON TABLE purchase_order_items IS 'Purchase order line items. Uses ordered_qty, unit_cost, and line_total columns.';

/*
# Fix Purchase Orders Constraints

## Problem
The `received_by` column in purchase_orders table is NOT NULL, but draft orders
should not have a received_by value until they are actually received.

## Solution
1. Make `received_by` nullable
2. Add business logic: only set received_by when status = 'received'
3. Ensure supplier_id is properly handled (can be NULL for manual entry)

## Changes
1. ALTER purchase_orders.received_by to be NULLABLE
2. Update existing draft/approved orders to have NULL received_by
3. Add comments for clarity

## Business Rules
- Draft orders: received_by = NULL
- Approved orders: received_by = NULL (not yet received)
- Partially Received orders: received_by = user who started receiving
- Received orders: received_by = user who completed receiving (REQUIRED)
- Cancelled orders: received_by = NULL
*/

-- Make received_by nullable
ALTER TABLE purchase_orders ALTER COLUMN received_by DROP NOT NULL;

-- Update existing draft/approved orders to have NULL received_by if not already received
UPDATE purchase_orders 
SET received_by = NULL 
WHERE status IN ('draft', 'approved') AND received_by IS NOT NULL;

-- Add helpful comments
COMMENT ON COLUMN purchase_orders.received_by IS 'User who received the goods. NULL for draft/approved orders, required for received status.';
COMMENT ON COLUMN purchase_orders.supplier_id IS 'Reference to suppliers table. Can be NULL if supplier_name is used instead.';
COMMENT ON COLUMN purchase_orders.supplier_name IS 'Manual supplier name entry. Used when supplier_id is NULL.';
COMMENT ON COLUMN purchase_orders.status IS 'Order status: draft, approved, partially_received, received, cancelled';

-- Ensure we have proper defaults for numeric fields
ALTER TABLE purchase_orders ALTER COLUMN discount SET DEFAULT 0;
ALTER TABLE purchase_orders ALTER COLUMN tax SET DEFAULT 0;
ALTER TABLE purchase_orders ALTER COLUMN subtotal SET DEFAULT 0;
ALTER TABLE purchase_orders ALTER COLUMN total_amount SET DEFAULT 0;

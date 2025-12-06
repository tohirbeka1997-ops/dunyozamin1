/*
# Delete Sales Return with Inventory Reversal

This migration creates an RPC function to safely delete sales returns and reverse inventory changes.

## Changes
1. Create `delete_sales_return_with_inventory` RPC function
   - Reverses inventory changes (decreases stock by returned quantities)
   - Deletes inventory movement records
   - Deletes return items
   - Deletes return record
   - All operations in a transaction

## Function Parameters
- p_return_id: UUID of the return to delete

## Returns
- Boolean indicating success
*/

-- Drop function if exists
DROP FUNCTION IF EXISTS delete_sales_return_with_inventory(uuid);

-- Create function to delete sales return and reverse inventory
CREATE OR REPLACE FUNCTION delete_sales_return_with_inventory(
  p_return_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_item RECORD;
BEGIN
  -- Get all return items
  FOR v_item IN 
    SELECT product_id, quantity 
    FROM sales_return_items 
    WHERE return_id = p_return_id
  LOOP
    -- Reverse inventory (decrease stock by returned quantity)
    UPDATE products
    SET 
      current_stock = current_stock - v_item.quantity,
      updated_at = now()
    WHERE id = v_item.product_id;
  END LOOP;
  
  -- Delete inventory movements related to this return
  DELETE FROM inventory_movements
  WHERE reference_type = 'sales_return' 
    AND reference_id = p_return_id;
  
  -- Delete return items (cascade will handle this, but explicit is better)
  DELETE FROM sales_return_items
  WHERE return_id = p_return_id;
  
  -- Delete the return record
  DELETE FROM sales_returns
  WHERE id = p_return_id;
  
  RETURN true;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION delete_sales_return_with_inventory(uuid) TO authenticated;

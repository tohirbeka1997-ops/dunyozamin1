/*
# Add refund_method to Sales Return RPC Function

This migration updates the `create_sales_return_with_inventory` RPC function to include the required `refund_method` parameter.

## Changes
1. Drop the old function signature
2. Create new function with refund_method parameter
3. Update INSERT statement to include refund_method

## Function Parameters (Updated)
- p_order_id: UUID of the original order
- p_customer_id: UUID of the customer (nullable)
- p_total_amount: Total refund amount
- p_refund_method: Refund method (cash, card, or credit) - REQUIRED
- p_reason: Reason for return
- p_notes: Additional notes (nullable)
- p_cashier_id: UUID of the cashier processing the return
- p_items: JSONB array of return items with product_id, quantity, unit_price, line_total

## Database Constraint
- refund_method must be one of: 'cash', 'card', 'credit'
- This is enforced by CHECK constraint in the sales_returns table
*/

-- Drop old function signatures
DROP FUNCTION IF EXISTS create_sales_return_with_inventory(uuid, uuid, numeric, text, text, uuid, jsonb);
DROP FUNCTION IF EXISTS create_sales_return_with_inventory(uuid, uuid, numeric, text, text, text, uuid, jsonb);

-- Create updated function with refund_method parameter
CREATE OR REPLACE FUNCTION create_sales_return_with_inventory(
  p_order_id uuid,
  p_customer_id uuid,
  p_total_amount numeric,
  p_refund_method text,
  p_reason text,
  p_notes text,
  p_cashier_id uuid,
  p_items jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_return_id uuid;
  v_return_number text;
  v_item jsonb;
  v_product_id uuid;
  v_quantity integer;
  v_unit_price numeric;
  v_line_total numeric;
  v_movement_number text;
  v_result jsonb;
BEGIN
  -- Validate refund_method
  IF p_refund_method NOT IN ('cash', 'card', 'credit') THEN
    RAISE EXCEPTION 'Invalid refund_method. Must be one of: cash, card, credit';
  END IF;

  -- Generate return number
  SELECT generate_return_number() INTO v_return_number;
  
  -- Create sales return record with refund_method
  INSERT INTO sales_returns (
    return_number,
    order_id,
    customer_id,
    total_amount,
    refund_method,
    status,
    reason,
    notes,
    cashier_id
  ) VALUES (
    v_return_number,
    p_order_id,
    p_customer_id,
    p_total_amount,
    p_refund_method,
    'Completed',
    p_reason,
    p_notes,
    p_cashier_id
  )
  RETURNING id INTO v_return_id;
  
  -- Process each return item
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_product_id := (v_item->>'product_id')::uuid;
    v_quantity := (v_item->>'quantity')::integer;
    v_unit_price := (v_item->>'unit_price')::numeric;
    v_line_total := (v_item->>'line_total')::numeric;
    
    -- Insert return item
    INSERT INTO sales_return_items (
      return_id,
      product_id,
      quantity,
      unit_price,
      line_total
    ) VALUES (
      v_return_id,
      v_product_id,
      v_quantity,
      v_unit_price,
      v_line_total
    );
    
    -- Update product stock (increase by returned quantity)
    UPDATE products
    SET current_stock = current_stock + v_quantity
    WHERE id = v_product_id;
    
    -- Generate movement number
    SELECT generate_movement_number() INTO v_movement_number;
    
    -- Create inventory movement record
    INSERT INTO inventory_movements (
      movement_number,
      product_id,
      movement_type,
      quantity,
      reference_type,
      reference_id,
      notes
    ) VALUES (
      v_movement_number,
      v_product_id,
      'return',
      v_quantity,
      'sales_return',
      v_return_id,
      'Stock increased due to sales return: ' || v_return_number
    );
  END LOOP;
  
  -- Return the created sales return as JSONB
  SELECT to_jsonb(sr.*) INTO v_result
  FROM sales_returns sr
  WHERE sr.id = v_return_id;
  
  RETURN v_result;
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION create_sales_return_with_inventory(uuid, uuid, numeric, text, text, text, uuid, jsonb) TO authenticated;

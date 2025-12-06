/*
# Create Sales Return RPC Function

This migration creates an RPC function to handle sales returns with proper inventory updates.

## Changes
1. Create `create_sales_return_with_inventory` RPC function
   - Creates sales return record
   - Creates return items
   - Updates product inventory (increases stock)
   - Creates inventory movement records
   - All operations in a transaction

## Function Parameters
- p_order_id: UUID of the original order
- p_customer_id: UUID of the customer (nullable)
- p_total_amount: Total refund amount
- p_reason: Reason for return
- p_notes: Additional notes (nullable)
- p_cashier_id: UUID of the cashier processing the return
- p_items: JSONB array of return items with product_id, quantity, unit_price, line_total

## Returns
- The created sales_return record with all fields
*/

-- Drop function if exists
DROP FUNCTION IF EXISTS create_sales_return_with_inventory(uuid, uuid, numeric, text, text, uuid, jsonb);

-- Create function to handle sales return with inventory updates
CREATE OR REPLACE FUNCTION create_sales_return_with_inventory(
  p_order_id uuid,
  p_customer_id uuid,
  p_total_amount numeric,
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
  -- Generate return number
  SELECT generate_return_number() INTO v_return_number;
  
  -- Create sales return record
  INSERT INTO sales_returns (
    return_number,
    order_id,
    customer_id,
    total_amount,
    status,
    reason,
    notes,
    cashier_id
  ) VALUES (
    v_return_number,
    p_order_id,
    p_customer_id,
    p_total_amount,
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
    
    -- Update product inventory (increase stock)
    UPDATE products
    SET 
      current_stock = current_stock + v_quantity,
      updated_at = now()
    WHERE id = v_product_id;
    
    -- Generate movement number
    SELECT 'MOV-' || to_char(now(), 'YYYYMMDD') || '-' || 
           LPAD((COUNT(*) + 1)::text, 5, '0')
    INTO v_movement_number
    FROM inventory_movements
    WHERE movement_number LIKE 'MOV-' || to_char(now(), 'YYYYMMDD') || '%';
    
    -- Create inventory movement record
    INSERT INTO inventory_movements (
      movement_number,
      product_id,
      movement_type,
      quantity,
      reference_type,
      reference_id,
      notes,
      created_by
    ) VALUES (
      v_movement_number,
      v_product_id,
      'return',
      v_quantity,
      'sales_return',
      v_return_id,
      'Return from order: ' || (SELECT order_number FROM orders WHERE id = p_order_id),
      p_cashier_id
    );
  END LOOP;
  
  -- Return the created sales return record
  SELECT jsonb_build_object(
    'id', id,
    'return_number', return_number,
    'order_id', order_id,
    'customer_id', customer_id,
    'total_amount', total_amount,
    'status', status,
    'reason', reason,
    'notes', notes,
    'cashier_id', cashier_id,
    'created_at', created_at,
    'updated_at', updated_at
  )
  INTO v_result
  FROM sales_returns
  WHERE id = v_return_id;
  
  RETURN v_result;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION create_sales_return_with_inventory(uuid, uuid, numeric, text, text, uuid, jsonb) TO authenticated;

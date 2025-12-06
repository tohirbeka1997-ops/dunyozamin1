/*
# Enhance receive_goods Function

## Problem
The current receive_goods function:
- Updates received_qty in purchase_order_items
- Logs inventory movements
- BUT does NOT update the purchase_order status

## Solution
Update the receive_goods function to:
1. Update received quantities
2. Log inventory movements
3. Automatically update PO status based on received quantities:
   - If all items fully received → status = 'received'
   - If some items partially received → status = 'partially_received'
   - Otherwise → keep current status

## Changes
- Drop and recreate receive_goods function with status update logic
- Add logic to check if all items are fully received
- Update purchase_orders.status accordingly
*/

-- Drop the old function
DROP FUNCTION IF EXISTS receive_goods(uuid, jsonb, date);

-- Recreate with enhanced logic
CREATE OR REPLACE FUNCTION receive_goods(
  p_po_id uuid,
  p_items jsonb,
  p_received_date date DEFAULT CURRENT_DATE
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  item jsonb;
  item_record record;
  new_received_qty numeric;
  movement_result uuid;
  v_total_items integer;
  v_fully_received_items integer;
  v_partially_received_items integer;
  v_new_status text;
BEGIN
  -- Validate PO exists and is not cancelled
  IF NOT EXISTS (
    SELECT 1 FROM purchase_orders 
    WHERE id = p_po_id AND status != 'cancelled'
  ) THEN
    RAISE EXCEPTION 'Purchase order not found or is cancelled';
  END IF;
  
  -- Process each item
  FOR item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    -- Get item details
    SELECT * INTO item_record
    FROM purchase_order_items
    WHERE id = (item->>'item_id')::uuid;
    
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Purchase order item not found: %', item->>'item_id';
    END IF;
    
    -- Calculate new received quantity
    new_received_qty := item_record.received_qty + (item->>'received_qty')::numeric;
    
    -- Validate not exceeding ordered quantity
    IF new_received_qty > item_record.ordered_qty THEN
      RAISE EXCEPTION 'Received quantity exceeds ordered quantity for item %', item_record.product_name;
    END IF;
    
    -- Update received quantity
    UPDATE purchase_order_items
    SET received_qty = new_received_qty
    WHERE id = item_record.id;
    
    -- Log inventory movement (this also updates product stock)
    SELECT log_inventory_movement(
      item_record.product_id,
      'purchase',
      (item->>'received_qty')::numeric,
      'purchase_order',
      p_po_id,
      format('Goods received from PO on %s', p_received_date),
      item->>'notes',
      auth.uid()
    ) INTO movement_result;
  END LOOP;
  
  -- Calculate status based on received quantities
  SELECT 
    COUNT(*) as total,
    COUNT(*) FILTER (WHERE received_qty >= ordered_qty) as fully_received,
    COUNT(*) FILTER (WHERE received_qty > 0 AND received_qty < ordered_qty) as partially_received
  INTO v_total_items, v_fully_received_items, v_partially_received_items
  FROM purchase_order_items
  WHERE purchase_order_id = p_po_id;
  
  -- Determine new status
  IF v_fully_received_items = v_total_items THEN
    v_new_status := 'received';
  ELSIF v_partially_received_items > 0 OR v_fully_received_items > 0 THEN
    v_new_status := 'partially_received';
  ELSE
    -- Keep current status if nothing received yet
    SELECT status INTO v_new_status FROM purchase_orders WHERE id = p_po_id;
  END IF;
  
  -- Update purchase order status
  UPDATE purchase_orders
  SET 
    status = v_new_status,
    updated_at = NOW()
  WHERE id = p_po_id;
  
  RETURN jsonb_build_object(
    'success', true,
    'message', 'Goods received successfully',
    'new_status', v_new_status,
    'total_items', v_total_items,
    'fully_received', v_fully_received_items,
    'partially_received', v_partially_received_items
  );
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION receive_goods TO authenticated;

-- Add comment
COMMENT ON FUNCTION receive_goods IS 'Receives goods for a purchase order, updates inventory, logs movements, and automatically updates PO status based on received quantities.';

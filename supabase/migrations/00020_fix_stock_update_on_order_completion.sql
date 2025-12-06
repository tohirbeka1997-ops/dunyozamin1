/*
# Fix Stock Update on Order Completion

## Problem
When orders are completed in the POS Terminal, product stock (current_stock) is not being decreased.
The complete_pos_order RPC function validates stock availability but never actually updates the stock quantity.

## Solution
Update the complete_pos_order RPC function to:
1. Decrease product stock by the sold quantity for each order item
2. Create inventory movement records for each sale
3. Keep all operations in a single transaction for data integrity

## Changes
1. After inserting order items, add logic to:
   - UPDATE products SET current_stock = current_stock - quantity
   - INSERT INTO inventory_movements with movement_type = 'sale'
2. Generate unique movement numbers for each inventory movement
3. Link movements to the order via reference_type = 'order' and reference_id = order_id

## Database Operations
- For each order item:
  - Decrease: products.current_stock -= quantity
  - Create: inventory_movements record with negative quantity (sale)
  
## Transaction Safety
All operations (order creation, stock updates, inventory movements) happen in a single transaction.
If any part fails, the entire transaction is rolled back.
*/

-- Drop the old function
DROP FUNCTION IF EXISTS complete_pos_order(JSONB, JSONB, JSONB);

-- Recreate the function WITH stock updates
CREATE OR REPLACE FUNCTION complete_pos_order(
  p_order JSONB,
  p_items JSONB,
  p_payments JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_order_id uuid;
  v_order_number text;
  v_item JSONB;
  v_payment JSONB;
  v_product_stock numeric;
  v_product_name text;
  v_allow_negative text;
  v_movement_number text;
  v_product_id uuid;
  v_quantity numeric;
BEGIN
  -- Validate inputs
  IF p_order IS NULL OR p_items IS NULL OR p_payments IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Invalid input: order, items, and payments are required'
    );
  END IF;
  
  -- Validate cart has items
  IF jsonb_array_length(p_items) = 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Cart is empty. Please add items before completing the order.'
    );
  END IF;
  
  -- Validate total amount
  IF (p_order->>'total_amount')::numeric <= 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Order total must be greater than zero'
    );
  END IF;
  
  -- Check negative stock setting
  v_allow_negative := COALESCE(
    (SELECT value::text FROM settings WHERE category = 'inventory' AND key = 'allow_negative_stock'),
    '"block"'
  );
  
  -- Validate stock availability for each item
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    SELECT current_stock, name INTO v_product_stock, v_product_name
    FROM products
    WHERE id = (v_item->>'product_id')::uuid;
    
    IF NOT FOUND THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', format('Product not found: %s', v_item->>'product_id')
      );
    END IF;
    
    -- Check stock availability
    IF v_product_stock < (v_item->>'quantity')::numeric THEN
      IF v_allow_negative = '"block"' THEN
        RETURN jsonb_build_object(
          'success', false,
          'error', format('Insufficient stock for %s. Available: %s, Required: %s',
            v_product_name, v_product_stock, v_item->>'quantity')
        );
      END IF;
    END IF;
  END LOOP;
  
  -- Insert order (ONLY valid columns)
  INSERT INTO orders (
    order_number,
    customer_id,
    cashier_id,
    shift_id,
    subtotal,
    discount_amount,
    discount_percent,
    tax_amount,
    total_amount,
    paid_amount,
    change_amount,
    status,
    payment_status,
    notes
  ) VALUES (
    p_order->>'order_number',
    NULLIF(p_order->>'customer_id', '')::uuid,
    (p_order->>'cashier_id')::uuid,
    NULLIF(p_order->>'shift_id', '')::uuid,
    (p_order->>'subtotal')::numeric,
    (p_order->>'discount_amount')::numeric,
    (p_order->>'discount_percent')::numeric,
    COALESCE((p_order->>'tax_amount')::numeric, 0),
    (p_order->>'total_amount')::numeric,
    (p_order->>'paid_amount')::numeric,
    (p_order->>'change_amount')::numeric,
    COALESCE(p_order->>'status', 'completed'),
    COALESCE(p_order->>'payment_status', 'paid'),
    p_order->>'notes'
  )
  RETURNING id, order_number INTO v_order_id, v_order_number;
  
  -- Insert order items AND update stock
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_product_id := (v_item->>'product_id')::uuid;
    v_quantity := (v_item->>'quantity')::numeric;
    
    -- Insert order item
    INSERT INTO order_items (
      order_id,
      product_id,
      product_name,
      quantity,
      unit_price,
      subtotal,
      discount_amount,
      total
    ) VALUES (
      v_order_id,
      v_product_id,
      v_item->>'product_name',
      v_quantity,
      (v_item->>'unit_price')::numeric,
      (v_item->>'subtotal')::numeric,
      COALESCE((v_item->>'discount_amount')::numeric, 0),
      (v_item->>'total')::numeric
    );
    
    -- ✅ UPDATE STOCK: Decrease product stock by sold quantity
    UPDATE products
    SET current_stock = current_stock - v_quantity,
        updated_at = now()
    WHERE id = v_product_id;
    
    -- ✅ CREATE INVENTORY MOVEMENT: Record the sale
    SELECT generate_movement_number() INTO v_movement_number;
    
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
      'sale',
      -v_quantity,  -- Negative quantity for sales (stock decrease)
      'order',
      v_order_id,
      format('Stock decreased due to sale: Order %s', v_order_number),
      (p_order->>'cashier_id')::uuid
    );
  END LOOP;
  
  -- Insert payments
  FOR v_payment IN SELECT * FROM jsonb_array_elements(p_payments)
  LOOP
    INSERT INTO payments (
      order_id,
      payment_number,
      payment_method,
      amount,
      reference_number,
      notes
    ) VALUES (
      v_order_id,
      v_payment->>'payment_number',
      v_payment->>'payment_method',
      (v_payment->>'amount')::numeric,
      v_payment->>'reference_number',
      v_payment->>'notes'
    );
  END LOOP;
  
  -- Return success
  RETURN jsonb_build_object(
    'success', true,
    'order_id', v_order_id,
    'order_number', v_order_number,
    'message', 'Order completed successfully. Stock updated.'
  );
  
EXCEPTION
  WHEN OTHERS THEN
    -- Return error details
    RETURN jsonb_build_object(
      'success', false,
      'error', SQLERRM,
      'detail', SQLSTATE
    );
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION complete_pos_order TO authenticated;

-- Add comment
COMMENT ON FUNCTION complete_pos_order IS 'Atomically completes a POS order with items and payments. Validates stock, creates all related records, updates product stock, and logs inventory movements in a single transaction.';

/*
# Update Complete Order RPC - Remove returned_amount and return_status

## Overview
This migration updates the complete_pos_order RPC function to remove references to
returned_amount and return_status fields that don't exist in the orders table.

## Changes
- Remove returned_amount from INSERT statement
- Remove return_status from INSERT statement
- Only insert columns that actually exist in the orders table

## Valid Columns in orders table:
- order_number
- customer_id
- cashier_id
- shift_id
- subtotal
- discount_amount
- discount_percent
- tax_amount
- total_amount
- paid_amount
- change_amount
- status
- payment_status
- notes
- created_at (auto-generated)
*/

-- Drop the old function
DROP FUNCTION IF EXISTS complete_pos_order(JSONB, JSONB, JSONB);

-- Recreate the function without returned_amount and return_status
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
  
  -- Insert order items
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
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
      (v_item->>'product_id')::uuid,
      v_item->>'product_name',
      (v_item->>'quantity')::numeric,
      (v_item->>'unit_price')::numeric,
      (v_item->>'subtotal')::numeric,
      COALESCE((v_item->>'discount_amount')::numeric, 0),
      (v_item->>'total')::numeric
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
    'message', 'Order completed successfully'
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
COMMENT ON FUNCTION complete_pos_order IS 'Atomically completes a POS order with items and payments. Validates stock and creates all related records in a single transaction. Updated to match actual orders table schema.';
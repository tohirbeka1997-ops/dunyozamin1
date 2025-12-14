/*
# Fix complete_pos_order RPC - Add store_id and location_id

## Problem
The complete_pos_order RPC function was missing store_id and location_id in the INSERT statement,
causing "Shift does not have a store_id" errors when creating orders.

The orders table requires store_id (NOT NULL constraint), but the RPC function was not including it.

## Solution
1. Add store_id and location_id to the INSERT statement
2. Validate that store_id is provided in the order payload
3. Get store_id from shift if not provided directly (for backward compatibility)

## Changes
- Add store_id and location_id columns to INSERT
- Add validation to ensure store_id exists
- Get store_id from shift if missing from order payload
*/

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
  v_credit_amount numeric;
  v_total_amount numeric;
  v_paid_amount numeric;
  v_customer_id uuid;
  v_customer customers%ROWTYPE;
  v_new_balance numeric;
  v_payment_status text;
  v_store_id uuid;
  v_location_id uuid;
  v_shift_id uuid;
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
  
  -- Extract key values
  v_total_amount := (p_order->>'total_amount')::numeric;
  v_credit_amount := COALESCE((p_order->>'credit_amount')::numeric, 0);
  v_paid_amount := COALESCE((p_order->>'paid_amount')::numeric, 0);
  v_customer_id := NULLIF(p_order->>'customer_id', '')::uuid;
  v_shift_id := NULLIF(p_order->>'shift_id', '')::uuid;
  
  -- CRITICAL: Get store_id from order payload (REQUIRED)
  v_store_id := NULLIF(p_order->>'store_id', '')::uuid;
  
  -- If store_id not in order payload, try to get it from shift (backward compatibility)
  IF v_store_id IS NULL AND v_shift_id IS NOT NULL THEN
    SELECT store_id INTO v_store_id
    FROM shifts
    WHERE id = v_shift_id;
    
    IF v_store_id IS NULL THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'Shift does not have a store_id. Please close and reopen the shift.'
      );
    END IF;
  END IF;
  
  -- Validate store_id exists (REQUIRED - orders table has NOT NULL constraint)
  IF v_store_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'store_id is required but was not provided in order payload and could not be retrieved from shift.'
    );
  END IF;
  
  -- Get location_id from order payload (optional)
  v_location_id := NULLIF(p_order->>'location_id', '')::uuid;
  
  -- Validate total amount
  IF v_total_amount <= 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Order total must be greater than zero'
    );
  END IF;
  
  -- Validate credit amount
  IF v_credit_amount < 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Credit amount cannot be negative'
    );
  END IF;
  
  IF v_credit_amount > v_total_amount THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Credit amount cannot exceed order total'
    );
  END IF;
  
  -- If credit is used, validate customer and credit limit
  IF v_credit_amount > 0 THEN
    IF v_customer_id IS NULL THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'Credit sales require a registered customer'
      );
    END IF;
    
    -- Get customer details
    SELECT * INTO v_customer
    FROM customers
    WHERE id = v_customer_id AND status = 'active';
    
    IF NOT FOUND THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'Customer not found or inactive'
      );
    END IF;
    
    -- Check credit limit if set
    IF v_customer.credit_limit > 0 THEN
      v_new_balance := v_customer.balance + v_credit_amount;
      IF v_new_balance > v_customer.credit_limit THEN
        RETURN jsonb_build_object(
          'success', false,
          'error', format('Credit limit exceeded. Limit: %s, Current balance: %s, Credit amount: %s, New balance would be: %s',
            v_customer.credit_limit, v_customer.balance, v_credit_amount, v_new_balance)
        );
      END IF;
    END IF;
  END IF;
  
  -- Determine payment status
  IF v_credit_amount = v_total_amount THEN
    v_payment_status := 'on_credit';
  ELSIF v_credit_amount = 0 THEN
    v_payment_status := 'paid';
  ELSE
    v_payment_status := 'partially_paid';
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
  
  -- Insert order with store_id and location_id (CRITICAL FIX)
  INSERT INTO orders (
    store_id,           -- REQUIRED - added
    location_id,        -- Optional - added
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
    credit_amount,
    change_amount,
    status,
    payment_status,
    notes
  ) VALUES (
    v_store_id,         -- REQUIRED - from order payload or shift
    v_location_id,      -- Optional - from order payload
    p_order->>'order_number',
    v_customer_id,
    (p_order->>'cashier_id')::uuid,
    v_shift_id,
    (p_order->>'subtotal')::numeric,
    (p_order->>'discount_amount')::numeric,
    (p_order->>'discount_percent')::numeric,
    COALESCE((p_order->>'tax_amount')::numeric, 0),
    v_total_amount,
    v_paid_amount,
    v_credit_amount,
    COALESCE((p_order->>'change_amount')::numeric, 0),
    COALESCE(p_order->>'status', 'completed'),
    v_payment_status,
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
  
  -- Insert payments (only for non-credit portion)
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
  
  -- Update customer balance if credit is used
  IF v_credit_amount > 0 AND v_customer_id IS NOT NULL THEN
    UPDATE customers
    SET balance = balance + v_credit_amount,
        total_sales = total_sales + v_total_amount,
        total_orders = total_orders + 1,
        last_order_date = now(),
        updated_at = now()
    WHERE id = v_customer_id;
  END IF;
  
  -- Return success
  RETURN jsonb_build_object(
    'success', true,
    'order_id', v_order_id,
    'order_number', v_order_number,
    'payment_status', v_payment_status,
    'credit_amount', v_credit_amount,
    'paid_amount', v_paid_amount,
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

-- Add comment
COMMENT ON FUNCTION complete_pos_order IS 'Atomically completes a POS order with support for partial credit payments. Validates stock, credit limits, and creates all related records in a single transaction. Now includes store_id and location_id support.';


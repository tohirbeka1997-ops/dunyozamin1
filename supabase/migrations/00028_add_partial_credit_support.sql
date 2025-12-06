/*
# Partial Credit Payment Support

## Plain English Explanation
This migration enhances the POS system to support PARTIAL CREDIT + PARTIAL PAYMENT scenarios.
Previously, orders could only be:
- Fully paid (payment_status = 'paid')
- Fully on credit (payment_status = 'on_credit')

Now, orders can also be:
- Partially paid with credit + other payment methods (payment_status = 'partially_paid')

Example: Customer buys 1,000,000 UZS worth of goods
- Uses 600,000 UZS credit (added to their balance)
- Pays 400,000 UZS with cash/card/QR
- Order is marked as 'partially_paid'

## Changes

### 1. Payment Status Constraint Update
- Add 'partially_paid' to the allowed payment_status values
- Old: ('pending', 'partial', 'paid', 'on_credit')
- New: ('pending', 'partial', 'paid', 'on_credit', 'partially_paid')

### 2. Enhanced complete_pos_order RPC Function
- Add support for credit_amount parameter
- Automatically determine payment_status based on credit_amount:
  * If credit_amount = total_amount → 'on_credit'
  * If credit_amount = 0 → 'paid'
  * If 0 < credit_amount < total_amount → 'partially_paid'
- Update customer balance when credit is used
- Maintain atomic transaction safety

## Business Rules
1. Credit amount cannot exceed order total
2. Credit amount cannot exceed customer's available credit limit
3. Customer balance is updated immediately when order is completed
4. Stock is deducted regardless of payment method
5. All operations are atomic (all succeed or all fail)

## Security
- RPC function uses SECURITY DEFINER for transaction safety
- All validations performed before any data changes
- Customer credit limit enforced at database level
*/

-- Drop existing constraint and add new one with 'partially_paid'
ALTER TABLE orders
DROP CONSTRAINT IF EXISTS orders_payment_status_check;

ALTER TABLE orders
ADD CONSTRAINT orders_payment_status_check
CHECK (payment_status IN ('pending', 'partial', 'paid', 'on_credit', 'partially_paid'));

-- Update the complete_pos_order function to support partial credit
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
  
  -- Insert order
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
    credit_amount,
    change_amount,
    status,
    payment_status,
    notes
  ) VALUES (
    p_order->>'order_number',
    v_customer_id,
    (p_order->>'cashier_id')::uuid,
    NULLIF(p_order->>'shift_id', '')::uuid,
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
COMMENT ON FUNCTION complete_pos_order IS 'Atomically completes a POS order with support for partial credit payments. Validates stock, credit limits, and creates all related records in a single transaction.';

-- Add index for partially_paid orders
CREATE INDEX IF NOT EXISTS idx_orders_partially_paid ON orders(payment_status) WHERE payment_status = 'partially_paid';

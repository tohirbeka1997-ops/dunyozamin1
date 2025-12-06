/*
# Customer Credit / Debt Support

## Plain English Explanation
This migration adds comprehensive support for selling on credit to customers.
It allows the POS system to:
- Track customer debt balances
- Set credit limits per customer
- Record credit sales separately from cash sales
- Log payment history when customers pay off their debt
- Maintain transaction safety with atomic operations

## Table Changes

### orders table - New Column:
- `credit_amount` (numeric, default 0): Amount sold on credit (added to customer balance)

### customer_payments table - New Table:
Payment history for tracking when customers pay off their debt.
- `id` (uuid, primary key)
- `payment_number` (text, unique): Format CP-YYYY-######
- `customer_id` (uuid, references customers, not null)
- `amount` (numeric, not null): Payment amount (must be > 0)
- `payment_method` (text, not null): 'cash', 'card', or 'qr'
- `reference_number` (text): Optional reference (check number, transaction ID)
- `notes` (text): Optional payment notes
- `received_by` (uuid, references profiles): Staff who received payment
- `created_at` (timestamptz, default now())

## Payment Status Updates
- Extended payment_status to support 'on_credit' value
- 'on_credit': Order completed but not paid (added to customer balance)
- 'paid': Order fully paid
- 'partial': Order partially paid (for future use)

## RPC Functions

### create_credit_order
Creates an order on credit with atomic transaction safety.
- Validates customer exists and is active
- Checks credit limit if set
- Creates order with payment_status = 'on_credit'
- Updates customer balance
- Updates inventory
- Returns order details or error

### receive_customer_payment
Records a payment from customer to reduce their debt.
- Validates payment amount > 0
- Validates payment doesn't exceed current balance
- Creates customer_payment record
- Updates customer balance
- Returns new balance or error

## Security
- RLS disabled for flexibility (as per existing pattern)
- RPC functions use SECURITY DEFINER for transaction safety
- All balance updates are atomic
- Validation prevents negative balances and over-limit sales

## Notes
- Customer balance is the single source of truth
- Positive balance = customer owes the store
- Credit sales only allowed for registered customers (not walk-in)
- Payment history is for audit and reporting only
*/

-- Add credit_amount column to orders table
ALTER TABLE orders
ADD COLUMN IF NOT EXISTS credit_amount numeric DEFAULT 0 CHECK (credit_amount >= 0);

-- Create customer_payments table
CREATE TABLE IF NOT EXISTS customer_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_number text UNIQUE NOT NULL,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  amount numeric NOT NULL CHECK (amount > 0),
  payment_method text NOT NULL CHECK (payment_method IN ('cash', 'card', 'qr')),
  reference_number text,
  notes text,
  received_by uuid REFERENCES profiles(id),
  created_at timestamptz DEFAULT now()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_customer_payments_customer_id ON customer_payments(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_payments_created_at ON customer_payments(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_credit_amount ON orders(credit_amount) WHERE credit_amount > 0;
CREATE INDEX IF NOT EXISTS idx_orders_payment_status ON orders(payment_status);

-- Function to generate customer payment number
CREATE OR REPLACE FUNCTION generate_customer_payment_number()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  year_part text;
  sequence_num integer;
  new_number text;
BEGIN
  year_part := TO_CHAR(CURRENT_DATE, 'YYYY');
  
  SELECT COALESCE(MAX(
    CAST(
      SUBSTRING(payment_number FROM 'CP-' || year_part || '-(\d+)')
      AS integer
    )
  ), 0) + 1
  INTO sequence_num
  FROM customer_payments
  WHERE payment_number LIKE 'CP-' || year_part || '-%';
  
  new_number := 'CP-' || year_part || '-' || LPAD(sequence_num::text, 6, '0');
  
  RETURN new_number;
END;
$$;

-- RPC function to create a credit order
CREATE OR REPLACE FUNCTION create_credit_order(
  p_customer_id uuid,
  p_cashier_id uuid,
  p_shift_id uuid,
  p_items jsonb,
  p_subtotal numeric,
  p_discount_amount numeric,
  p_discount_percent numeric,
  p_tax_amount numeric,
  p_total_amount numeric,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_order_id uuid;
  v_order_number text;
  v_customer customers%ROWTYPE;
  v_item jsonb;
  v_product_id uuid;
  v_quantity numeric;
  v_current_stock numeric;
  v_new_balance numeric;
BEGIN
  -- Validate customer exists and is active
  SELECT * INTO v_customer
  FROM customers
  WHERE id = p_customer_id AND status = 'active';
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Customer not found or inactive'
    );
  END IF;
  
  -- Check credit limit if set
  IF v_customer.credit_limit > 0 THEN
    v_new_balance := v_customer.balance + p_total_amount;
    IF v_new_balance > v_customer.credit_limit THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'Credit limit exceeded. Limit: ' || v_customer.credit_limit || ', New balance would be: ' || v_new_balance
      );
    END IF;
  END IF;
  
  -- Generate order number
  v_order_number := 'POS-' || TO_CHAR(CURRENT_DATE, 'YYYY') || '-' || 
    LPAD(
      (COALESCE(
        (SELECT MAX(CAST(SUBSTRING(order_number FROM 'POS-\d{4}-(\d+)') AS integer))
         FROM orders
         WHERE order_number LIKE 'POS-' || TO_CHAR(CURRENT_DATE, 'YYYY') || '-%'),
        0
      ) + 1)::text,
      6, '0'
    );
  
  -- Create order
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
    v_order_number,
    p_customer_id,
    p_cashier_id,
    p_shift_id,
    p_subtotal,
    p_discount_amount,
    p_discount_percent,
    p_tax_amount,
    p_total_amount,
    0, -- paid_amount
    p_total_amount, -- credit_amount
    0, -- change_amount
    'completed',
    'on_credit',
    p_notes
  ) RETURNING id INTO v_order_id;
  
  -- Insert order items and update stock
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_product_id := (v_item->>'product_id')::uuid;
    v_quantity := (v_item->>'quantity')::numeric;
    
    -- Check stock availability
    SELECT current_stock INTO v_current_stock
    FROM products
    WHERE id = v_product_id;
    
    IF v_current_stock < v_quantity THEN
      RAISE EXCEPTION 'Insufficient stock for product %', v_product_id;
    END IF;
    
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
    
    -- Update product stock
    UPDATE products
    SET current_stock = current_stock - v_quantity,
        updated_at = now()
    WHERE id = v_product_id;
    
    -- Create inventory movement
    INSERT INTO inventory_movements (
      movement_number,
      product_id,
      movement_type,
      quantity,
      before_quantity,
      after_quantity,
      reference_type,
      reference_id,
      reason,
      created_by
    ) VALUES (
      'INV-' || TO_CHAR(now(), 'YYYYMMDD-HH24MISS') || '-' || substr(gen_random_uuid()::text, 1, 8),
      v_product_id,
      'sale',
      -v_quantity,
      v_current_stock,
      v_current_stock - v_quantity,
      'order',
      v_order_id,
      'Credit sale - Order ' || v_order_number,
      p_cashier_id
    );
  END LOOP;
  
  -- Update customer balance
  UPDATE customers
  SET balance = balance + p_total_amount,
      total_sales = total_sales + p_total_amount,
      total_orders = total_orders + 1,
      last_order_date = now(),
      updated_at = now()
  WHERE id = p_customer_id;
  
  -- Return success with order details
  RETURN jsonb_build_object(
    'success', true,
    'order_id', v_order_id,
    'order_number', v_order_number,
    'new_balance', v_customer.balance + p_total_amount
  );
END;
$$;

-- RPC function to receive customer payment
CREATE OR REPLACE FUNCTION receive_customer_payment(
  p_customer_id uuid,
  p_amount numeric,
  p_payment_method text,
  p_reference_number text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_received_by uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_customer customers%ROWTYPE;
  v_payment_number text;
  v_new_balance numeric;
BEGIN
  -- Validate customer exists
  SELECT * INTO v_customer
  FROM customers
  WHERE id = p_customer_id;
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Customer not found'
    );
  END IF;
  
  -- Validate amount
  IF p_amount <= 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Payment amount must be greater than zero'
    );
  END IF;
  
  -- Validate payment doesn't exceed balance
  IF p_amount > v_customer.balance THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Payment amount (' || p_amount || ') exceeds customer balance (' || v_customer.balance || ')'
    );
  END IF;
  
  -- Generate payment number
  v_payment_number := generate_customer_payment_number();
  
  -- Create payment record
  INSERT INTO customer_payments (
    payment_number,
    customer_id,
    amount,
    payment_method,
    reference_number,
    notes,
    received_by
  ) VALUES (
    v_payment_number,
    p_customer_id,
    p_amount,
    p_payment_method,
    p_reference_number,
    p_notes,
    p_received_by
  );
  
  -- Update customer balance
  v_new_balance := v_customer.balance - p_amount;
  
  UPDATE customers
  SET balance = v_new_balance,
      updated_at = now()
  WHERE id = p_customer_id;
  
  -- Return success with new balance
  RETURN jsonb_build_object(
    'success', true,
    'payment_number', v_payment_number,
    'old_balance', v_customer.balance,
    'new_balance', v_new_balance
  );
END;
$$;

-- Update existing orders to have credit_amount = 0 if null
UPDATE orders SET credit_amount = 0 WHERE credit_amount IS NULL;

-- Comment on new column
COMMENT ON COLUMN orders.credit_amount IS 'Amount sold on credit (added to customer balance)';
COMMENT ON TABLE customer_payments IS 'Payment history for customer debt payments';

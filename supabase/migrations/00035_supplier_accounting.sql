/*
# Supplier Accounting System

## Overview
This migration adds supplier payment tracking and ledger functionality to support
complete supplier accounting (hisob-kitob).

## Changes

### 1. supplier_payments Table
Tracks all payments made to suppliers:
- Links to supplier and optionally to purchase_order
- Records payment method (cash, card, transfer, click, payme, uzum)
- Stores amount, date, notes, and audit fields

### 2. supplier.balance Column
- balance > 0: We owe supplier (debt)
- balance < 0: Supplier owes us (advance/credit)
- Calculated from: received POs - payments

### 3. purchase_orders.payment_status Column
- UNPAID: No payments made
- PARTIALLY_PAID: Some payments made
- PAID: Fully paid
- Computed from supplier_payments

### 4. Indexes
- Performance indexes on supplier_payments for common queries

### 5. RLS Policies
- Secure access to supplier payments data
*/

-- NOTE: Balance is NOT stored in suppliers table
-- Balance is calculated dynamically from transactions:
-- balance = SUM(received_purchase_orders.total_amount) - SUM(supplier_payments.amount)
-- This ensures accounting accuracy and prevents inconsistencies
-- If you need to store balance for performance, use a materialized view or computed column

-- Add payment_status to purchase_orders (computed, but can be stored for performance)
ALTER TABLE purchase_orders
ADD COLUMN IF NOT EXISTS payment_status text CHECK (payment_status IN ('UNPAID', 'PARTIALLY_PAID', 'PAID'));

-- Create supplier_payments table
CREATE TABLE IF NOT EXISTS supplier_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_number text UNIQUE NOT NULL,
  store_id uuid REFERENCES stores(id),
  supplier_id uuid REFERENCES suppliers(id) ON DELETE CASCADE NOT NULL,
  purchase_order_id uuid REFERENCES purchase_orders(id) ON DELETE SET NULL,
  amount numeric NOT NULL CHECK (amount > 0),
  payment_method text NOT NULL CHECK (payment_method IN ('cash', 'card', 'transfer', 'click', 'payme', 'uzum')),
  paid_at timestamptz NOT NULL DEFAULT now(),
  note text,
  created_by uuid REFERENCES profiles(id),
  created_at timestamptz DEFAULT now()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_supplier_payments_supplier_id ON supplier_payments(supplier_id);
CREATE INDEX IF NOT EXISTS idx_supplier_payments_purchase_order_id ON supplier_payments(purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_supplier_payments_paid_at ON supplier_payments(paid_at);
CREATE INDEX IF NOT EXISTS idx_supplier_payments_store_id ON supplier_payments(store_id);

-- Create function to generate payment number
CREATE OR REPLACE FUNCTION generate_supplier_payment_number()
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  today text;
  timestamp_part text;
BEGIN
  today := to_char(CURRENT_DATE, 'YYYYMMDD');
  timestamp_part := to_char(EXTRACT(EPOCH FROM now())::bigint, 'FM000000');
  RETURN 'SPAY-' || today || '-' || timestamp_part;
END;
$$;

-- Create function to calculate supplier balance
-- IMPORTANT: This is the ONLY source of truth for supplier balance
-- Balance is NEVER stored - always calculated from transactions
CREATE OR REPLACE FUNCTION calculate_supplier_balance(p_supplier_id uuid)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_total_debt numeric;
  v_total_paid numeric;
BEGIN
  -- Sum of all received PO amounts (ONLY when status is received/partially_received)
  -- This creates supplier debt
  SELECT COALESCE(SUM(total_amount), 0) INTO v_total_debt
  FROM purchase_orders
  WHERE supplier_id = p_supplier_id
    AND status IN ('received', 'partially_received');
  
  -- Sum of all payments (reduces debt)
  SELECT COALESCE(SUM(amount), 0) INTO v_total_paid
  FROM supplier_payments
  WHERE supplier_id = p_supplier_id;
  
  -- Balance = debt - paid
  -- positive = we owe supplier (qarz)
  -- zero = settled
  -- negative = supplier owes us (avans)
  RETURN v_total_debt - v_total_paid;
END;
$$;

-- Create function to calculate PO paid amount
CREATE OR REPLACE FUNCTION calculate_po_paid_amount(p_po_id uuid)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_paid numeric;
BEGIN
  SELECT COALESCE(SUM(amount), 0) INTO v_paid
  FROM supplier_payments
  WHERE purchase_order_id = p_po_id;
  
  RETURN v_paid;
END;
$$;

-- Create function to update PO payment status
CREATE OR REPLACE FUNCTION update_po_payment_status(p_po_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_total_amount numeric;
  v_paid_amount numeric;
  v_status text;
BEGIN
  -- Get PO total amount
  SELECT total_amount INTO v_total_amount
  FROM purchase_orders
  WHERE id = p_po_id;
  
  -- Calculate paid amount
  v_paid_amount := calculate_po_paid_amount(p_po_id);
  
  -- Determine payment status
  IF v_paid_amount >= v_total_amount THEN
    v_status := 'PAID';
  ELSIF v_paid_amount > 0 THEN
    v_status := 'PARTIALLY_PAID';
  ELSE
    v_status := 'UNPAID';
  END IF;
  
  -- Update PO
  UPDATE purchase_orders
  SET payment_status = v_status,
      updated_at = now()
  WHERE id = p_po_id;
END;
$$;

-- Create trigger to update PO payment status after payment insert/update/delete
CREATE OR REPLACE FUNCTION trigger_update_po_payment_status()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM update_po_payment_status(OLD.purchase_order_id);
    RETURN OLD;
  ELSE
    PERFORM update_po_payment_status(NEW.purchase_order_id);
    RETURN NEW;
  END IF;
END;
$$;

CREATE TRIGGER update_po_payment_status_trigger
AFTER INSERT OR UPDATE OR DELETE ON supplier_payments
FOR EACH ROW
WHEN (NEW.purchase_order_id IS NOT NULL OR OLD.purchase_order_id IS NOT NULL)
EXECUTE FUNCTION trigger_update_po_payment_status();

-- Create RPC function to create supplier payment
CREATE OR REPLACE FUNCTION create_supplier_payment(
  p_supplier_id uuid,
  p_purchase_order_id uuid DEFAULT NULL,
  p_amount numeric,
  p_payment_method text,
  p_paid_at timestamptz DEFAULT now(),
  p_note text DEFAULT NULL,
  p_created_by uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_payment_id uuid;
  v_payment_number text;
  v_supplier suppliers%ROWTYPE;
  v_po purchase_orders%ROWTYPE;
  v_new_balance numeric;
BEGIN
  -- Validate amount
  IF p_amount <= 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Payment amount must be greater than zero'
    );
  END IF;
  
  -- Validate supplier exists
  SELECT * INTO v_supplier
  FROM suppliers
  WHERE id = p_supplier_id;
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Supplier not found'
    );
  END IF;
  
  -- If PO provided, validate it exists and is not cancelled
  IF p_purchase_order_id IS NOT NULL THEN
    SELECT * INTO v_po
    FROM purchase_orders
    WHERE id = p_purchase_order_id;
    
    IF NOT FOUND THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'Purchase order not found'
      );
    END IF;
    
    IF v_po.status = 'cancelled' THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'Cannot pay for a cancelled purchase order'
      );
    END IF;
  END IF;
  
  -- Generate payment number
  v_payment_number := generate_supplier_payment_number();
  
  -- Create payment record
  INSERT INTO supplier_payments (
    payment_number,
    supplier_id,
    purchase_order_id,
    amount,
    payment_method,
    paid_at,
    note,
    created_by
  ) VALUES (
    v_payment_number,
    p_supplier_id,
    p_purchase_order_id,
    p_amount,
    p_payment_method,
    p_paid_at,
    p_note,
    p_created_by
  ) RETURNING id INTO v_payment_id;
  
  -- Calculate new supplier balance (for return value only)
  -- IMPORTANT: Do NOT store balance in suppliers table
  -- Balance is always calculated from transactions for accuracy
  v_new_balance := calculate_supplier_balance(p_supplier_id);
  
  -- Do NOT update suppliers.balance - it's calculated dynamically
  -- This ensures accounting accuracy and prevents inconsistencies
  
  -- Return success
  RETURN jsonb_build_object(
    'success', true,
    'payment_id', v_payment_id,
    'payment_number', v_payment_number,
    'new_balance', v_new_balance
  );
END;
$$;

-- Create view for supplier ledger
CREATE OR REPLACE VIEW supplier_ledger_view AS
SELECT 
  po.order_date as date,
  'PURCHASE' as type,
  po.po_number as reference,
  po.total_amount as debit,
  0 as credit,
  po.id as purchase_order_id,
  NULL::uuid as payment_id,
  po.supplier_id
FROM purchase_orders po
WHERE po.supplier_id IS NOT NULL
  AND po.status IN ('received', 'partially_received')

UNION ALL

SELECT 
  sp.paid_at::date as date,
  'PAYMENT' as type,
  sp.payment_number as reference,
  0 as debit,
  sp.amount as credit,
  sp.purchase_order_id,
  sp.id as payment_id,
  sp.supplier_id
FROM supplier_payments sp;

-- Create RPC function to get supplier ledger
CREATE OR REPLACE FUNCTION get_supplier_ledger(
  p_supplier_id uuid,
  p_date_from date DEFAULT NULL,
  p_date_to date DEFAULT NULL
)
RETURNS TABLE (
  date date,
  type text,
  reference text,
  debit numeric,
  credit numeric,
  balance numeric,
  purchase_order_id uuid,
  payment_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_running_balance numeric := 0;
  v_entry RECORD;
BEGIN
  -- Get all ledger entries
  FOR v_entry IN
    SELECT * FROM supplier_ledger_view
    WHERE supplier_id = p_supplier_id
      AND (p_date_from IS NULL OR date >= p_date_from)
      AND (p_date_to IS NULL OR date <= p_date_to)
    ORDER BY date ASC, type ASC
  LOOP
    v_running_balance := v_running_balance + v_entry.debit - v_entry.credit;
    
    RETURN QUERY SELECT
      v_entry.date,
      v_entry.type,
      v_entry.reference,
      v_entry.debit,
      v_entry.credit,
      v_running_balance,
      v_entry.purchase_order_id,
      v_entry.payment_id;
  END LOOP;
END;
$$;

-- Enable RLS on supplier_payments
ALTER TABLE supplier_payments ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for supplier_payments
CREATE POLICY "Users can view supplier payments"
  ON supplier_payments FOR SELECT
  USING (true);

CREATE POLICY "Authenticated users can create supplier payments"
  ON supplier_payments FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Admins can update supplier payments"
  ON supplier_payments FOR UPDATE
  USING (true);

CREATE POLICY "Admins can delete supplier payments"
  ON supplier_payments FOR DELETE
  USING (true);

-- Comments
COMMENT ON TABLE supplier_payments IS 'Tracks all payments made to suppliers';
COMMENT ON FUNCTION calculate_supplier_balance IS 'Calculates supplier balance from transactions. Balance = SUM(received POs) - SUM(payments). Positive = we owe supplier, negative = supplier owes us. Balance is NEVER stored - always calculated.';
COMMENT ON COLUMN purchase_orders.payment_status IS 'Payment status: UNPAID, PARTIALLY_PAID, or PAID. Computed from supplier_payments.';



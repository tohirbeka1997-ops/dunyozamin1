/*
# Enhance Purchase Orders Module

## Overview
This migration enhances the purchase_orders and purchase_order_items tables to support
a complete purchase order workflow with receiving, partial receiving, and status tracking.

## Changes

### 1. Enhanced purchase_orders Table
- Added `order_date` (date when PO was created)
- Added `expected_date` (expected delivery date)
- Added `reference` (supplier invoice/reference number)
- Added `discount` (optional discount amount)
- Added `tax` (optional tax amount)
- Added `subtotal` (amount before discount and tax)
- Added `approved_by` (user who approved the PO)
- Added `approved_at` (timestamp of approval)
- Added `created_by` (user who created the PO)
- Updated `status` enum to include: draft, approved, partially_received, received, cancelled
- Made `supplier_id` nullable (can use supplier_name text instead)
- Added `supplier_name` (text field for supplier name)

### 2. Enhanced purchase_order_items Table
- Added `ordered_qty` (quantity ordered)
- Added `received_qty` (quantity received so far)
- Added `unit_cost` (purchase price per unit)
- Renamed `quantity` to `ordered_qty`
- Renamed `unit_price` to `unit_cost`
- Renamed `total` to `line_total`

### 3. Auto-number Generation
- Created function `generate_po_number()` for PO-YYYYMMDD-##### format

### 4. Indexes
- Added indexes for performance optimization

### 5. RLS Policies
- Enabled RLS on both tables
- Created policies for authenticated users

## Notes
- All existing data will be migrated
- Status transitions: draft → approved → partially_received → received
- Draft/Approved can be cancelled if nothing received yet
*/

-- Drop existing status check constraint
ALTER TABLE purchase_orders DROP CONSTRAINT IF EXISTS purchase_orders_status_check;

-- Add new columns to purchase_orders
ALTER TABLE purchase_orders 
  ADD COLUMN IF NOT EXISTS order_date date DEFAULT CURRENT_DATE NOT NULL,
  ADD COLUMN IF NOT EXISTS expected_date date,
  ADD COLUMN IF NOT EXISTS reference text,
  ADD COLUMN IF NOT EXISTS discount numeric DEFAULT 0 CHECK (discount >= 0),
  ADD COLUMN IF NOT EXISTS tax numeric DEFAULT 0 CHECK (tax >= 0),
  ADD COLUMN IF NOT EXISTS subtotal numeric DEFAULT 0 CHECK (subtotal >= 0),
  ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS supplier_name text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- Make supplier_id nullable
ALTER TABLE purchase_orders ALTER COLUMN supplier_id DROP NOT NULL;

-- Update status column with new enum values
ALTER TABLE purchase_orders 
  ADD CONSTRAINT purchase_orders_status_check 
  CHECK (status IN ('draft', 'approved', 'partially_received', 'received', 'cancelled'));

-- Update existing records to have valid status
UPDATE purchase_orders SET status = 'received' WHERE status = 'completed';
UPDATE purchase_orders SET status = 'draft' WHERE status = 'pending';

-- Add new columns to purchase_order_items
ALTER TABLE purchase_order_items
  ADD COLUMN IF NOT EXISTS ordered_qty numeric,
  ADD COLUMN IF NOT EXISTS received_qty numeric DEFAULT 0 CHECK (received_qty >= 0),
  ADD COLUMN IF NOT EXISTS unit_cost numeric,
  ADD COLUMN IF NOT EXISTS line_total numeric;

-- Migrate existing data
UPDATE purchase_order_items 
SET 
  ordered_qty = COALESCE(quantity, 0),
  unit_cost = COALESCE(unit_price, 0),
  line_total = COALESCE(total, 0)
WHERE ordered_qty IS NULL;

-- Make new columns NOT NULL after migration
ALTER TABLE purchase_order_items 
  ALTER COLUMN ordered_qty SET NOT NULL,
  ALTER COLUMN received_qty SET NOT NULL,
  ALTER COLUMN unit_cost SET NOT NULL,
  ALTER COLUMN line_total SET NOT NULL;

-- Add constraints
ALTER TABLE purchase_order_items
  ADD CONSTRAINT check_ordered_qty_positive CHECK (ordered_qty > 0),
  ADD CONSTRAINT check_unit_cost_non_negative CHECK (unit_cost >= 0),
  ADD CONSTRAINT check_line_total_non_negative CHECK (line_total >= 0),
  ADD CONSTRAINT check_received_qty_not_exceed CHECK (received_qty <= ordered_qty);

-- Create function to generate PO number
CREATE OR REPLACE FUNCTION generate_po_number()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  today_str text;
  next_num integer;
  new_po_number text;
BEGIN
  today_str := TO_CHAR(CURRENT_DATE, 'YYYYMMDD');
  
  SELECT COALESCE(MAX(
    CAST(
      SUBSTRING(po_number FROM 'PO-\d{8}-(\d{5})') AS integer
    )
  ), 0) + 1
  INTO next_num
  FROM purchase_orders
  WHERE po_number LIKE 'PO-' || today_str || '-%';
  
  new_po_number := 'PO-' || today_str || '-' || LPAD(next_num::text, 5, '0');
  
  RETURN new_po_number;
END;
$$;

-- Create function to update PO status based on received quantities
CREATE OR REPLACE FUNCTION update_po_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  total_items integer;
  fully_received_items integer;
  partially_received_items integer;
  new_status text;
BEGIN
  -- Count items
  SELECT 
    COUNT(*),
    COUNT(*) FILTER (WHERE received_qty >= ordered_qty),
    COUNT(*) FILTER (WHERE received_qty > 0 AND received_qty < ordered_qty)
  INTO total_items, fully_received_items, partially_received_items
  FROM purchase_order_items
  WHERE purchase_order_id = NEW.purchase_order_id;
  
  -- Determine new status
  IF fully_received_items = total_items THEN
    new_status := 'received';
  ELSIF partially_received_items > 0 OR fully_received_items > 0 THEN
    new_status := 'partially_received';
  ELSE
    -- Keep current status if nothing received
    SELECT status INTO new_status FROM purchase_orders WHERE id = NEW.purchase_order_id;
  END IF;
  
  -- Update PO status
  UPDATE purchase_orders
  SET 
    status = new_status,
    updated_at = now()
  WHERE id = NEW.purchase_order_id;
  
  RETURN NEW;
END;
$$;

-- Create trigger to auto-update PO status
DROP TRIGGER IF EXISTS trigger_update_po_status ON purchase_order_items;
CREATE TRIGGER trigger_update_po_status
  AFTER INSERT OR UPDATE OF received_qty ON purchase_order_items
  FOR EACH ROW
  EXECUTE FUNCTION update_po_status();

-- Create function to receive goods
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
  movement_result jsonb;
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
    
    -- Log inventory movement
    SELECT log_inventory_movement(
      item_record.product_id,
      'purchase',
      (item->>'received_qty')::numeric,
      'purchase_order',
      p_po_id::text,
      'Goods received from PO',
      item->>'notes',
      auth.uid()
    ) INTO movement_result;
  END LOOP;
  
  RETURN jsonb_build_object(
    'success', true,
    'message', 'Goods received successfully'
  );
END;
$$;

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_purchase_orders_status ON purchase_orders(status);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_order_date ON purchase_orders(order_date);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_supplier ON purchase_orders(supplier_id);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_created_by ON purchase_orders(created_by);
CREATE INDEX IF NOT EXISTS idx_purchase_order_items_po ON purchase_order_items(purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_purchase_order_items_product ON purchase_order_items(product_id);

-- Enable RLS
ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_order_items ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for purchase_orders
CREATE POLICY "Anyone can view purchase orders" ON purchase_orders
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins and managers can create purchase orders" ON purchase_orders
  FOR INSERT TO authenticated 
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE id = auth.uid() 
      AND role IN ('admin', 'manager')
    )
  );

CREATE POLICY "Admins and managers can update purchase orders" ON purchase_orders
  FOR UPDATE TO authenticated 
  USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE id = auth.uid() 
      AND role IN ('admin', 'manager')
    )
  );

CREATE POLICY "Admins can delete purchase orders" ON purchase_orders
  FOR DELETE TO authenticated 
  USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE id = auth.uid() 
      AND role = 'admin'
    )
  );

-- Create RLS policies for purchase_order_items
CREATE POLICY "Anyone can view purchase order items" ON purchase_order_items
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins and managers can manage purchase order items" ON purchase_order_items
  FOR ALL TO authenticated 
  USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE id = auth.uid() 
      AND role IN ('admin', 'manager')
    )
  );

-- Update timestamp trigger
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_purchase_orders_updated_at ON purchase_orders;
CREATE TRIGGER trigger_purchase_orders_updated_at
  BEFORE UPDATE ON purchase_orders
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

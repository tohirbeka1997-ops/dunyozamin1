/*
# Enhance Inventory Movements Table

## Plain English Explanation
This migration enhances the inventory_movements table to support comprehensive audit trail
and inventory tracking including:
- Before and after quantity tracking
- Reason codes for adjustments
- Better reference tracking
- Automatic movement number generation

## Table Changes

### inventory_movements table - New Columns:
- `before_quantity` (numeric): Stock quantity before movement
- `after_quantity` (numeric): Stock quantity after movement
- `reason` (text): Reason for adjustment (damaged, lost, correction, etc.)

## Functions Created:
- `generate_movement_number()`: Auto-generate movement numbers (MOV-YYYYMMDD-#####)
- `log_inventory_movement()`: Helper function to create movement records
- `update_product_stock_on_movement()`: Trigger to update product stock

## Triggers Created:
- Auto-generate movement numbers on insert
- Update product current_stock when movement is created

## Security:
- RLS enabled on inventory_movements table
- Public can view movements
- Only authenticated users can create movements
- Only admins can delete movements

## Notes:
- Movement types: purchase, sale, return, adjustment, audit
- Positive quantity = stock increase
- Negative quantity = stock decrease
- All movements are logged with user and timestamp
*/

-- Add new columns to inventory_movements table
ALTER TABLE inventory_movements
ADD COLUMN IF NOT EXISTS before_quantity numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS after_quantity numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS reason text;

-- Create function to generate movement numbers
CREATE OR REPLACE FUNCTION generate_movement_number()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  today_date text;
  next_num integer;
  new_number text;
BEGIN
  today_date := TO_CHAR(NOW(), 'YYYYMMDD');
  
  SELECT COALESCE(MAX(
    CAST(
      SUBSTRING(movement_number FROM 'MOV-[0-9]{8}-([0-9]{5})') AS INTEGER
    )
  ), 0) + 1
  INTO next_num
  FROM inventory_movements
  WHERE movement_number LIKE 'MOV-' || today_date || '-%';
  
  new_number := 'MOV-' || today_date || '-' || LPAD(next_num::text, 5, '0');
  
  RETURN new_number;
END;
$$;

-- Create trigger to auto-generate movement numbers
CREATE OR REPLACE FUNCTION set_movement_number()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.movement_number IS NULL OR NEW.movement_number = '' THEN
    NEW.movement_number := generate_movement_number();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_movement_number_trigger ON inventory_movements;
CREATE TRIGGER set_movement_number_trigger
BEFORE INSERT ON inventory_movements
FOR EACH ROW
EXECUTE FUNCTION set_movement_number();

-- Create helper function to log inventory movements
CREATE OR REPLACE FUNCTION log_inventory_movement(
  p_product_id uuid,
  p_movement_type text,
  p_quantity numeric,
  p_reference_type text DEFAULT NULL,
  p_reference_id uuid DEFAULT NULL,
  p_reason text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_created_by uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_before_quantity numeric;
  v_after_quantity numeric;
  v_movement_id uuid;
BEGIN
  -- Get current stock
  SELECT current_stock INTO v_before_quantity
  FROM products
  WHERE id = p_product_id;
  
  -- Calculate after quantity
  v_after_quantity := v_before_quantity + p_quantity;
  
  -- Validate stock cannot go negative
  IF v_after_quantity < 0 THEN
    RAISE EXCEPTION 'Insufficient stock. Current: %, Requested: %', v_before_quantity, ABS(p_quantity);
  END IF;
  
  -- Create movement record
  INSERT INTO inventory_movements (
    product_id,
    movement_type,
    quantity,
    before_quantity,
    after_quantity,
    reference_type,
    reference_id,
    reason,
    notes,
    created_by
  ) VALUES (
    p_product_id,
    p_movement_type,
    p_quantity,
    v_before_quantity,
    v_after_quantity,
    p_reference_type,
    p_reference_id,
    p_reason,
    p_notes,
    COALESCE(p_created_by, auth.uid())
  )
  RETURNING id INTO v_movement_id;
  
  -- Update product stock
  UPDATE products
  SET current_stock = v_after_quantity,
      updated_at = NOW()
  WHERE id = p_product_id;
  
  RETURN v_movement_id;
END;
$$;

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_inventory_movements_product_id ON inventory_movements(product_id);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_movement_type ON inventory_movements(movement_type);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_created_at ON inventory_movements(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_reference ON inventory_movements(reference_type, reference_id);

-- Enable RLS
ALTER TABLE inventory_movements ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Anyone can view inventory movements"
  ON inventory_movements FOR SELECT
  USING (true);

CREATE POLICY "Authenticated users can create movements"
  ON inventory_movements FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Only admins can delete movements"
  ON inventory_movements FOR DELETE
  TO authenticated
  USING (is_admin(auth.uid()));

-- Update existing movements with before/after quantities
DO $$
DECLARE
  movement_record RECORD;
  running_stock numeric;
BEGIN
  FOR movement_record IN 
    SELECT id, product_id, quantity, created_at
    FROM inventory_movements
    ORDER BY product_id, created_at
  LOOP
    -- Get stock before this movement
    SELECT COALESCE(
      (SELECT after_quantity 
       FROM inventory_movements 
       WHERE product_id = movement_record.product_id 
         AND created_at < movement_record.created_at
       ORDER BY created_at DESC
       LIMIT 1),
      0
    ) INTO running_stock;
    
    -- Update movement with before/after quantities
    UPDATE inventory_movements
    SET before_quantity = running_stock,
        after_quantity = running_stock + movement_record.quantity
    WHERE id = movement_record.id;
  END LOOP;
END;
$$;

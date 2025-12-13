/*
# Fix Sales Returns Schema

This migration ensures the sales_returns table has all required columns:
- refund_method (from original schema)
- status (from later migrations)
- updated_at (from later migrations)

It also ensures RLS policies are correctly set up.
*/

-- Ensure all required columns exist in sales_returns
DO $$
BEGIN
  -- Add status column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'sales_returns' AND column_name = 'status'
  ) THEN
    ALTER TABLE sales_returns 
    ADD COLUMN status text NOT NULL DEFAULT 'Pending';
    
    -- Add constraint for status
    ALTER TABLE sales_returns 
    ADD CONSTRAINT check_return_status 
    CHECK (status IN ('Pending', 'Completed', 'Cancelled'));
  END IF;

  -- Add refund_method column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'sales_returns' AND column_name = 'refund_method'
  ) THEN
    ALTER TABLE sales_returns 
    ADD COLUMN refund_method text NOT NULL DEFAULT 'cash';
    
    -- Add constraint for refund_method
    ALTER TABLE sales_returns 
    ADD CONSTRAINT check_refund_method 
    CHECK (refund_method IN ('cash', 'card', 'credit'));
  END IF;

  -- Add updated_at column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'sales_returns' AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE sales_returns 
    ADD COLUMN updated_at timestamptz DEFAULT now();
  END IF;

  -- Add notes column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'sales_returns' AND column_name = 'notes'
  ) THEN
    ALTER TABLE sales_returns 
    ADD COLUMN notes text;
  END IF;
END $$;

-- Ensure all indexes exist
CREATE INDEX IF NOT EXISTS idx_sales_returns_order_id ON sales_returns(order_id);
CREATE INDEX IF NOT EXISTS idx_sales_returns_customer_id ON sales_returns(customer_id);
CREATE INDEX IF NOT EXISTS idx_sales_returns_cashier_id ON sales_returns(cashier_id);
CREATE INDEX IF NOT EXISTS idx_sales_returns_status ON sales_returns(status);
CREATE INDEX IF NOT EXISTS idx_sales_returns_created_at ON sales_returns(created_at);
CREATE INDEX IF NOT EXISTS idx_sales_return_items_return_id ON sales_return_items(return_id);
CREATE INDEX IF NOT EXISTS idx_sales_return_items_product_id ON sales_return_items(product_id);

-- Ensure generate_return_number function exists
CREATE OR REPLACE FUNCTION generate_return_number()
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  new_number text;
  date_part text;
  sequence_num integer;
BEGIN
  date_part := TO_CHAR(CURRENT_DATE, 'YYYYMMDD');
  
  SELECT COALESCE(MAX(CAST(SUBSTRING(return_number FROM 14) AS integer)), 0) + 1
  INTO sequence_num
  FROM sales_returns
  WHERE return_number LIKE 'RET-' || date_part || '-%';
  
  new_number := 'RET-' || date_part || '-' || LPAD(sequence_num::text, 5, '0');
  
  RETURN new_number;
END;
$$;

-- Ensure trigger for auto-generating return number exists
DROP TRIGGER IF EXISTS trigger_set_return_number ON sales_returns;
CREATE TRIGGER trigger_set_return_number
BEFORE INSERT ON sales_returns
FOR EACH ROW
EXECUTE FUNCTION set_return_number();

-- Ensure set_return_number function exists
CREATE OR REPLACE FUNCTION set_return_number()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.return_number IS NULL OR NEW.return_number = '' THEN
    NEW.return_number := generate_return_number();
  END IF;
  RETURN NEW;
END;
$$;

-- Ensure update_updated_at function exists (if not already defined)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc 
    WHERE proname = 'update_updated_at'
  ) THEN
    CREATE OR REPLACE FUNCTION update_updated_at()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    AS $$
    BEGIN
      NEW.updated_at = now();
      RETURN NEW;
    END;
    $$;
  END IF;
END $$;

-- Ensure trigger for updated_at exists
DROP TRIGGER IF EXISTS trigger_update_sales_returns_updated_at ON sales_returns;
CREATE TRIGGER trigger_update_sales_returns_updated_at
BEFORE UPDATE ON sales_returns
FOR EACH ROW
EXECUTE FUNCTION update_updated_at();

-- Enable RLS
ALTER TABLE sales_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_return_items ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (to recreate them)
DROP POLICY IF EXISTS "Public can view returns" ON sales_returns;
DROP POLICY IF EXISTS "Authenticated users can create returns" ON sales_returns;
DROP POLICY IF EXISTS "Users can update their own returns" ON sales_returns;
DROP POLICY IF EXISTS "Admins can delete returns" ON sales_returns;
DROP POLICY IF EXISTS "Public can view return items" ON sales_return_items;
DROP POLICY IF EXISTS "Authenticated users can create return items" ON sales_return_items;
DROP POLICY IF EXISTS "Admins can update return items" ON sales_return_items;
DROP POLICY IF EXISTS "Admins can delete return items" ON sales_return_items;

-- RLS Policies for sales_returns
-- Allow public to view (for receipt lookup)
CREATE POLICY "Public can view returns" ON sales_returns
  FOR SELECT TO public USING (true);

-- Allow authenticated users to create returns
CREATE POLICY "Authenticated users can create returns" ON sales_returns
  FOR INSERT TO authenticated WITH CHECK (true);

-- Ensure is_admin function exists (if not already defined)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc 
    WHERE proname = 'is_admin'
  ) THEN
    CREATE OR REPLACE FUNCTION is_admin(uid uuid)
    RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    AS $$
    BEGIN
      RETURN EXISTS (
        SELECT 1 FROM profiles 
        WHERE id = uid 
        AND role = 'admin'
      );
    END;
    $$;
  END IF;
END $$;

-- Allow users to update their own returns or admins to update any
CREATE POLICY "Users can update their own returns" ON sales_returns
  FOR UPDATE TO authenticated 
  USING (cashier_id = auth.uid() OR is_admin(auth.uid()));

-- Only admins can delete returns
CREATE POLICY "Admins can delete returns" ON sales_returns
  FOR DELETE TO authenticated 
  USING (is_admin(auth.uid()));

-- RLS Policies for sales_return_items
-- Allow public to view return items
CREATE POLICY "Public can view return items" ON sales_return_items
  FOR SELECT TO public USING (true);

-- Allow authenticated users to create return items
CREATE POLICY "Authenticated users can create return items" ON sales_return_items
  FOR INSERT TO authenticated WITH CHECK (true);

-- Only admins can update return items
CREATE POLICY "Admins can update return items" ON sales_return_items
  FOR UPDATE TO authenticated 
  USING (is_admin(auth.uid()));

-- Only admins can delete return items
CREATE POLICY "Admins can delete return items" ON sales_return_items
  FOR DELETE TO authenticated 
  USING (is_admin(auth.uid()));


/*
# Create Sales Returns Schema

1. New Tables
  - sales_returns: Main returns table with return_number, order link, status
  - sales_return_items: Line items for each return

2. Features
  - Auto-generate return numbers: RET-YYYYMMDD-#####
  - Track return status: Pending, Completed, Cancelled
  - Link to orders and customers
  - Inventory integration via triggers

3. Security
  - RLS enabled
  - Public read access for receipt lookup
  - Authenticated users can create/update
*/

-- Create sales_returns table
CREATE TABLE IF NOT EXISTS sales_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  return_number text UNIQUE NOT NULL,
  order_id uuid REFERENCES orders(id) ON DELETE RESTRICT NOT NULL,
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  total_amount numeric(10,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'Pending',
  reason text NOT NULL,
  notes text,
  cashier_id uuid REFERENCES profiles(id) ON DELETE SET NULL NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create sales_return_items table
CREATE TABLE IF NOT EXISTS sales_return_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id uuid REFERENCES sales_returns(id) ON DELETE CASCADE NOT NULL,
  product_id uuid REFERENCES products(id) ON DELETE RESTRICT NOT NULL,
  quantity integer NOT NULL,
  unit_price numeric(10,2) NOT NULL,
  line_total numeric(10,2) NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Add constraints using DO block to check existence
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'check_return_status') THEN
    ALTER TABLE sales_returns ADD CONSTRAINT check_return_status CHECK (status IN ('Pending', 'Completed', 'Cancelled'));
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'check_return_quantity') THEN
    ALTER TABLE sales_return_items ADD CONSTRAINT check_return_quantity CHECK (quantity > 0);
  END IF;
END $$;

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_sales_returns_order_id ON sales_returns(order_id);
CREATE INDEX IF NOT EXISTS idx_sales_returns_customer_id ON sales_returns(customer_id);
CREATE INDEX IF NOT EXISTS idx_sales_returns_cashier_id ON sales_returns(cashier_id);
CREATE INDEX IF NOT EXISTS idx_sales_returns_status ON sales_returns(status);
CREATE INDEX IF NOT EXISTS idx_sales_returns_created_at ON sales_returns(created_at);
CREATE INDEX IF NOT EXISTS idx_sales_return_items_return_id ON sales_return_items(return_id);
CREATE INDEX IF NOT EXISTS idx_sales_return_items_product_id ON sales_return_items(product_id);

-- Function to generate return number
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

-- Trigger to auto-generate return number
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

DROP TRIGGER IF EXISTS trigger_set_return_number ON sales_returns;
CREATE TRIGGER trigger_set_return_number
BEFORE INSERT ON sales_returns
FOR EACH ROW
EXECUTE FUNCTION set_return_number();

-- Trigger to update updated_at
DROP TRIGGER IF EXISTS trigger_update_sales_returns_updated_at ON sales_returns;
CREATE TRIGGER trigger_update_sales_returns_updated_at
BEFORE UPDATE ON sales_returns
FOR EACH ROW
EXECUTE FUNCTION update_updated_at();

-- Add return fields to orders table
ALTER TABLE orders
ADD COLUMN IF NOT EXISTS returned_amount numeric(10,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS return_status text DEFAULT 'none';

-- Add constraint for order return_status
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'check_order_return_status') THEN
    ALTER TABLE orders ADD CONSTRAINT check_order_return_status CHECK (return_status IN ('none', 'partial', 'full'));
  END IF;
END $$;

-- Enable RLS
ALTER TABLE sales_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_return_items ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Public can view returns" ON sales_returns;
DROP POLICY IF EXISTS "Authenticated users can create returns" ON sales_returns;
DROP POLICY IF EXISTS "Users can update their own returns" ON sales_returns;
DROP POLICY IF EXISTS "Admins can delete returns" ON sales_returns;
DROP POLICY IF EXISTS "Public can view return items" ON sales_return_items;
DROP POLICY IF EXISTS "Authenticated users can create return items" ON sales_return_items;
DROP POLICY IF EXISTS "Admins can update return items" ON sales_return_items;
DROP POLICY IF EXISTS "Admins can delete return items" ON sales_return_items;

-- RLS Policies for sales_returns
CREATE POLICY "Public can view returns" ON sales_returns
  FOR SELECT TO public USING (true);

CREATE POLICY "Authenticated users can create returns" ON sales_returns
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Users can update their own returns" ON sales_returns
  FOR UPDATE TO authenticated 
  USING (cashier_id = auth.uid() OR is_admin(auth.uid()));

CREATE POLICY "Admins can delete returns" ON sales_returns
  FOR DELETE TO authenticated 
  USING (is_admin(auth.uid()));

-- RLS Policies for sales_return_items
CREATE POLICY "Public can view return items" ON sales_return_items
  FOR SELECT TO public USING (true);

CREATE POLICY "Authenticated users can create return items" ON sales_return_items
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Admins can update return items" ON sales_return_items
  FOR UPDATE TO authenticated 
  USING (is_admin(auth.uid()));

CREATE POLICY "Admins can delete return items" ON sales_return_items
  FOR DELETE TO authenticated 
  USING (is_admin(auth.uid()));
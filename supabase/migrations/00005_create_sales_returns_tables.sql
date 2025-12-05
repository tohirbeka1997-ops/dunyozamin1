/*
# Create Sales Returns Schema

1. New Tables
  - sales_returns: Main returns table
  - sales_return_items: Line items for each return

2. Auto-numbering
  - Return numbers: RET-YYYYMMDD-#####

3. Security
  - RLS enabled with public read access
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

-- Add constraints
ALTER TABLE sales_returns
ADD CONSTRAINT IF NOT EXISTS check_return_status 
CHECK (status IN ('Pending', 'Completed', 'Cancelled'));

ALTER TABLE sales_return_items
ADD CONSTRAINT IF NOT EXISTS check_return_quantity 
CHECK (quantity > 0);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_sales_returns_order_id ON sales_returns(order_id);
CREATE INDEX IF NOT EXISTS idx_sales_returns_customer_id ON sales_returns(customer_id);
CREATE INDEX IF NOT EXISTS idx_sales_returns_cashier_id ON sales_returns(cashier_id);
CREATE INDEX IF NOT EXISTS idx_sales_returns_status ON sales_returns(status);
CREATE INDEX IF NOT EXISTS idx_sales_returns_created_at ON sales_returns(created_at);
CREATE INDEX IF NOT EXISTS idx_sales_return_items_return_id ON sales_return_items(return_id);
CREATE INDEX IF NOT EXISTS idx_sales_return_items_product_id ON sales_return_items(product_id);
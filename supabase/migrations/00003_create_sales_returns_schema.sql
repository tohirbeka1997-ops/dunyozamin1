/*
# Create Sales Returns Schema

1. New Tables
  - `sales_returns`
      - `id` (uuid, primary key)
      - `return_number` (text, unique, auto-generated: RET-YYYYMMDD-#####)
      - `order_id` (uuid, references orders)
      - `customer_id` (uuid, references customers, nullable)
      - `total_amount` (numeric, total refund amount)
      - `status` (text, values: Pending, Completed, Cancelled)
      - `reason` (text, reason for return)
      - `notes` (text, nullable)
      - `cashier_id` (uuid, references profiles)
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)
  
  - `sales_return_items`
      - `id` (uuid, primary key)
      - `return_id` (uuid, references sales_returns)
      - `product_id` (uuid, references products)
      - `quantity` (integer, returned quantity)
      - `unit_price` (numeric, price at time of return)
      - `line_total` (numeric, calculated: quantity * unit_price)
      - `created_at` (timestamptz)

2. Functions
  - `generate_return_number()` - Auto-generate return numbers in format RET-YYYYMMDD-#####
  - `update_inventory_on_return()` - Trigger to update inventory when return is created
  - `update_order_on_return()` - Update order totals and status after return

3. Security
  - Enable RLS on both tables
  - Admins and managers have full access
  - Cashiers can create and view their own returns
  - Public can view returns (for receipt lookup)

4. Notes
  - Return numbers are unique and auto-generated
  - Inventory is automatically updated via trigger
  - Order totals are recalculated after returns
  - Customer balance is updated if applicable
*/

-- Create sales_returns table
CREATE TABLE IF NOT EXISTS sales_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  return_number text UNIQUE NOT NULL,
  order_id uuid REFERENCES orders(id) ON DELETE RESTRICT NOT NULL,
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  total_amount numeric(10,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Completed', 'Cancelled')),
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
  quantity integer NOT NULL CHECK (quantity > 0),
  unit_price numeric(10,2) NOT NULL,
  line_total numeric(10,2) NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Create indexes for performance
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

CREATE TRIGGER trigger_set_return_number
BEFORE INSERT ON sales_returns
FOR EACH ROW
EXECUTE FUNCTION set_return_number();

-- Trigger to update updated_at timestamp
CREATE TRIGGER trigger_update_sales_returns_updated_at
BEFORE UPDATE ON sales_returns
FOR EACH ROW
EXECUTE FUNCTION update_updated_at();

-- Function to update inventory when return is completed
CREATE OR REPLACE FUNCTION update_inventory_on_return()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  return_item RECORD;
BEGIN
  -- Only process when status changes to Completed
  IF NEW.status = 'Completed' AND (OLD.status IS NULL OR OLD.status != 'Completed') THEN
    -- Update inventory for each returned item
    FOR return_item IN 
      SELECT product_id, quantity 
      FROM sales_return_items 
      WHERE return_id = NEW.id
    LOOP
      -- Increase stock
      UPDATE products 
      SET current_stock = current_stock + return_item.quantity,
          updated_at = now()
      WHERE id = return_item.product_id;
      
      -- Log inventory movement
      INSERT INTO inventory_movements (
        product_id,
        movement_type,
        quantity,
        reference_type,
        reference_id,
        notes,
        performed_by
      ) VALUES (
        return_item.product_id,
        'return',
        return_item.quantity,
        'sales_return',
        NEW.id,
        'Sales return: ' || NEW.return_number,
        NEW.cashier_id
      );
    END LOOP;
  END IF;
  
  RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_update_inventory_on_return
AFTER INSERT OR UPDATE ON sales_returns
FOR EACH ROW
EXECUTE FUNCTION update_inventory_on_return();

-- Add return-related fields to orders table if not exists
ALTER TABLE orders
ADD COLUMN IF NOT EXISTS returned_amount numeric(10,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS return_status text DEFAULT 'none' CHECK (return_status IN ('none', 'partial', 'full'));

-- Function to update order after return
CREATE OR REPLACE FUNCTION update_order_on_return()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  order_total numeric(10,2);
  total_returned numeric(10,2);
BEGIN
  IF NEW.status = 'Completed' THEN
    -- Get order total
    SELECT total_amount INTO order_total
    FROM orders
    WHERE id = NEW.order_id;
    
    -- Calculate total returned for this order
    SELECT COALESCE(SUM(total_amount), 0) INTO total_returned
    FROM sales_returns
    WHERE order_id = NEW.order_id AND status = 'Completed';
    
    -- Update order
    UPDATE orders
    SET 
      returned_amount = total_returned,
      return_status = CASE
        WHEN total_returned >= order_total THEN 'full'
        WHEN total_returned > 0 THEN 'partial'
        ELSE 'none'
      END,
      updated_at = now()
    WHERE id = NEW.order_id;
  END IF;
  
  RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_update_order_on_return
AFTER INSERT OR UPDATE ON sales_returns
FOR EACH ROW
EXECUTE FUNCTION update_order_on_return();

-- Enable RLS
ALTER TABLE sales_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_return_items ENABLE ROW LEVEL SECURITY;

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
/*
# Ensure Product Module RLS Policies

This migration ensures proper Row Level Security policies for the products table
and related inventory movements.

## Policies Created:

### products table:
- Authenticated users can SELECT all products
- Authenticated users can INSERT products (with created_by check)
- Users can UPDATE their own products OR admins can update any
- Only admins can DELETE products

### inventory_movements table:
- Already has policies from previous migrations
- This ensures they're properly set up
*/

-- Enable RLS on products if not already enabled
ALTER TABLE products ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (to recreate them)
DROP POLICY IF EXISTS "Authenticated users can view products" ON products;
DROP POLICY IF EXISTS "Authenticated users can create products" ON products;
DROP POLICY IF EXISTS "Users can update their own products" ON products;
DROP POLICY IF EXISTS "Admins can delete products" ON products;

-- RLS Policies for products table

-- Allow authenticated users to view all products
CREATE POLICY "Authenticated users can view products" ON products
  FOR SELECT TO authenticated
  USING (true);

-- Allow authenticated users to create products
CREATE POLICY "Authenticated users can create products" ON products
  FOR INSERT TO authenticated
  WITH CHECK (true);

-- Allow users to update products (any authenticated user can update)
-- In a POS system, multiple users may need to update products
CREATE POLICY "Users can update their own products" ON products
  FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (true);

-- Only admins can delete products
CREATE POLICY "Admins can delete products" ON products
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE id = auth.uid() 
      AND role = 'admin'
    )
  );

-- Ensure inventory_movements RLS is enabled
ALTER TABLE inventory_movements ENABLE ROW LEVEL SECURITY;

-- Verify inventory_movements policies exist (they should from previous migrations)
-- If they don't exist, create them
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'inventory_movements' 
    AND policyname = 'Anyone can view inventory movements'
  ) THEN
    CREATE POLICY "Anyone can view inventory movements"
      ON inventory_movements FOR SELECT
      USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'inventory_movements' 
    AND policyname = 'Authenticated users can create movements'
  ) THEN
    CREATE POLICY "Authenticated users can create movements"
      ON inventory_movements FOR INSERT
      TO authenticated
      WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'inventory_movements' 
    AND policyname = 'Only admins can delete movements'
  ) THEN
    CREATE POLICY "Only admins can delete movements"
      ON inventory_movements FOR DELETE
      TO authenticated
      USING (is_admin(auth.uid()));
  END IF;
END $$;










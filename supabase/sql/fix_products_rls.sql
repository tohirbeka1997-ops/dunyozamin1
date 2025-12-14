/**
 * Fix Products RLS Policy
 * 
 * This allows authenticated users to read products without requiring store membership.
 * This is a temporary fix - in production, you may want to restrict by store_id.
 */

-- Enable RLS if not already enabled
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'products') THEN
    ALTER TABLE products ENABLE ROW LEVEL SECURITY;
    
    -- Drop existing SELECT policy if it exists
    DROP POLICY IF EXISTS "Allow authenticated read products" ON products;
    DROP POLICY IF EXISTS "Members can read products in their stores" ON products;
    
    -- Create simple policy: authenticated users can read all products
    CREATE POLICY "Allow authenticated read products"
      ON products FOR SELECT
      TO authenticated
      USING (true);
  END IF;
END $$;



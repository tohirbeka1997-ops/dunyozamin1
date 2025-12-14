-- ============================================================================
-- Products Table Migration
-- Based on frontend ProductForm.tsx, Product type, and createProduct API
-- ============================================================================

-- Create products table if it doesn't exist
CREATE TABLE IF NOT EXISTS public.products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku TEXT NOT NULL,
  barcode TEXT,
  name TEXT NOT NULL,
  description TEXT,
  category_id UUID,
  unit TEXT NOT NULL DEFAULT 'pcs',
  purchase_price NUMERIC(18, 2) NOT NULL DEFAULT 0,
  sale_price NUMERIC(18, 2) NOT NULL DEFAULT 0,
  current_stock NUMERIC(18, 3) NOT NULL DEFAULT 0,
  min_stock_level NUMERIC(18, 3) NOT NULL DEFAULT 0,
  image_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  store_id UUID,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create unique index on sku (required, unique)
CREATE UNIQUE INDEX IF NOT EXISTS products_sku_unique ON public.products(sku);

-- Create index on category_id for faster joins
CREATE INDEX IF NOT EXISTS products_category_id_idx ON public.products(category_id) WHERE category_id IS NOT NULL;

-- Create index on store_id for multi-store filtering
CREATE INDEX IF NOT EXISTS products_store_id_idx ON public.products(store_id) WHERE store_id IS NOT NULL;

-- Create index on is_active for filtering active products
CREATE INDEX IF NOT EXISTS products_is_active_idx ON public.products(is_active);

-- Create index on name for search
CREATE INDEX IF NOT EXISTS products_name_idx ON public.products(name);

-- Create index on barcode for barcode lookups (if barcode exists)
CREATE INDEX IF NOT EXISTS products_barcode_idx ON public.products(barcode) WHERE barcode IS NOT NULL;

-- Add foreign key to categories table (if exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'categories') THEN
    ALTER TABLE public.products
    ADD CONSTRAINT products_category_id_fkey
    FOREIGN KEY (category_id)
    REFERENCES public.categories(id)
    ON DELETE SET NULL;
  END IF;
END $$;

-- Add foreign key to auth.users for created_by
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'auth' AND table_name = 'users') THEN
    ALTER TABLE public.products
    ADD CONSTRAINT products_created_by_fkey
    FOREIGN KEY (created_by)
    REFERENCES auth.users(id)
    ON DELETE SET NULL;
  END IF;
END $$;

-- Create trigger function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_products_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically update updated_at
DROP TRIGGER IF EXISTS products_updated_at_trigger ON public.products;
CREATE TRIGGER products_updated_at_trigger
  BEFORE UPDATE ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION update_products_updated_at();

-- ============================================================================
-- Row Level Security (RLS) - Development Policies
-- ============================================================================

-- Enable RLS
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

-- Drop existing policies for idempotency
DROP POLICY IF EXISTS "Allow anon read products" ON public.products;
DROP POLICY IF EXISTS "Allow anon insert products" ON public.products;
DROP POLICY IF EXISTS "Allow anon update products" ON public.products;
DROP POLICY IF EXISTS "Allow anon delete products" ON public.products;
DROP POLICY IF EXISTS "Allow authenticated read products" ON public.products;
DROP POLICY IF EXISTS "Allow authenticated insert products" ON public.products;
DROP POLICY IF EXISTS "Allow authenticated update products" ON public.products;
DROP POLICY IF EXISTS "Allow authenticated delete products" ON public.products;

-- Anon policies (for development - allow all operations)
CREATE POLICY "Allow anon read products"
  ON public.products FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Allow anon insert products"
  ON public.products FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "Allow anon update products"
  ON public.products FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow anon delete products"
  ON public.products FOR DELETE
  TO anon
  USING (true);

-- Authenticated policies (for development - allow all operations)
CREATE POLICY "Allow authenticated read products"
  ON public.products FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Allow authenticated insert products"
  ON public.products FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Allow authenticated update products"
  ON public.products FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow authenticated delete products"
  ON public.products FOR DELETE
  TO authenticated
  USING (true);

-- Notify PostgREST to reload schema
NOTIFY pgrst, 'reload schema';



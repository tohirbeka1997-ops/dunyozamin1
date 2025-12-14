-- 1. Verify and Fix 'products' table schema
CREATE TABLE IF NOT EXISTS public.products (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  name text NOT NULL,
  description text,
  sku text,
  barcode text,
  category_id uuid REFERENCES public.categories(id),
  unit text DEFAULT 'pcs',
  purchase_price numeric DEFAULT 0,
  sale_price numeric DEFAULT 0,
  current_stock numeric DEFAULT 0,
  min_stock_level numeric DEFAULT 0,
  image_url text,
  is_active boolean DEFAULT true,
  store_id uuid -- Added store_id column (Nullable as requested)
);

-- Add store_id if it doesn't exist (idempotent)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'products' AND column_name = 'store_id') THEN
        ALTER TABLE public.products ADD COLUMN store_id uuid;
    END IF;
END $$;

-- Ensure SKU is unique
ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_sku_key;
ALTER TABLE public.products ADD CONSTRAINT products_sku_key UNIQUE (sku);

-- 2. Enable Row Level Security (RLS)
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

-- 3. Create RLS Policies

-- Drop existing policies to avoid conflicts
DROP POLICY IF EXISTS "Enable all modifications for authenticated users" ON public.products;
DROP POLICY IF EXISTS "Enable all modifications for anon users" ON public.products;
DROP POLICY IF EXISTS "Enable read access for all users" ON public.products;

-- Allow ALL operations for authenticated users
CREATE POLICY "Enable all modifications for authenticated users" ON public.products
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

-- Allow ALL operations for anonymous users (DEV MODE)
CREATE POLICY "Enable all modifications for anon users" ON public.products
FOR ALL
TO anon
USING (true)
WITH CHECK (true);

-- Allow SELECT for everyone (if not covered above)
CREATE POLICY "Enable read access for all users" ON public.products
FOR SELECT
TO public
USING (true);

-- 4. Reload PostgREST Schema Cache
NOTIFY pgrst, 'reload';

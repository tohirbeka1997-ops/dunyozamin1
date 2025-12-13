-- ============================================================================
-- COMPLETE PRODUCT MODULE SCHEMA FOR SUPABASE POS
-- ============================================================================
-- This migration creates the full Product Module schema including:
-- - categories, units, products, inventory_movements tables
-- - product_current_stock view
-- - generate_sku() RPC function
-- - RLS policies
-- - Seed data
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. CATEGORIES TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_categories_active_sort_name 
ON public.categories(is_active, sort_order, name);

-- ============================================================================
-- 2. UNITS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_units_code ON public.units(code);

-- ============================================================================
-- 3. PRODUCTS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  sku text NOT NULL UNIQUE,
  barcode text UNIQUE,
  description text,
  category_id uuid REFERENCES public.categories(id) ON DELETE SET NULL,
  unit_id uuid REFERENCES public.units(id) ON DELETE SET NULL,
  purchase_price numeric(12,2) NOT NULL DEFAULT 0,
  sale_price numeric(12,2) NOT NULL DEFAULT 0,
  min_stock_level numeric(12,2),
  image_url text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at timestamptz,
  updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  CONSTRAINT check_purchase_price_positive CHECK (purchase_price >= 0),
  CONSTRAINT check_sale_price_positive CHECK (sale_price >= 0),
  CONSTRAINT check_sale_price_gte_purchase_price CHECK (sale_price >= purchase_price)
);

CREATE INDEX IF NOT EXISTS idx_products_is_active_name 
ON public.products(is_active, name);

CREATE INDEX IF NOT EXISTS idx_products_category_id 
ON public.products(category_id) WHERE category_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_products_sku ON public.products(sku);

-- ============================================================================
-- 4. INVENTORY_MOVEMENTS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.inventory_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  quantity numeric(14,3) NOT NULL,
  movement_type text NOT NULL,
  reference_type text,
  reference_id uuid,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_inventory_movements_product_id 
ON public.inventory_movements(product_id);

CREATE INDEX IF NOT EXISTS idx_inventory_movements_created_at_desc 
ON public.inventory_movements(created_at DESC);

-- ============================================================================
-- 5. PRODUCT_CURRENT_STOCK VIEW
-- ============================================================================

CREATE OR REPLACE VIEW public.product_current_stock AS
SELECT
  m.product_id,
  COALESCE(SUM(m.quantity), 0) AS current_stock,
  MAX(m.created_at) AS last_movement_at
FROM public.inventory_movements m
GROUP BY m.product_id;

-- ============================================================================
-- 6. RPC FUNCTION: generate_sku()
-- ============================================================================

CREATE OR REPLACE FUNCTION public.generate_sku()
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  candidate text;
  date_str text;
  base_num integer;
  i integer := 0;
BEGIN
  date_str := TO_CHAR(now(), 'YYYYMMDD');
  
  -- Get base number from count
  SELECT COALESCE(MAX(CAST(SUBSTRING(sku FROM 14) AS integer)), 0) + 1
  INTO base_num
  FROM public.products
  WHERE sku LIKE 'SKU-' || date_str || '-%';
  
  -- Generate candidate and check for uniqueness
  LOOP
    candidate := 'SKU-' || date_str || '-' || LPAD((base_num + i)::text, 4, '0');
    
    -- Check if SKU already exists
    IF NOT EXISTS (SELECT 1 FROM public.products WHERE sku = candidate) THEN
      RETURN candidate;
    END IF;
    
    i := i + 1;
    
    -- Safety: prevent infinite loop (max 10000 attempts)
    IF i > 10000 THEN
      RAISE EXCEPTION 'Unable to generate unique SKU after 10000 attempts';
    END IF;
  END LOOP;
END;
$$;

-- ============================================================================
-- 7. ROW LEVEL SECURITY POLICIES
-- ============================================================================

-- Enable RLS
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.units ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_movements ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "categories_select" ON public.categories;
DROP POLICY IF EXISTS "categories_insert" ON public.categories;
DROP POLICY IF EXISTS "categories_update" ON public.categories;
DROP POLICY IF EXISTS "units_select" ON public.units;
DROP POLICY IF EXISTS "units_insert" ON public.units;
DROP POLICY IF EXISTS "units_update" ON public.units;
DROP POLICY IF EXISTS "products_select" ON public.products;
DROP POLICY IF EXISTS "products_insert" ON public.products;
DROP POLICY IF EXISTS "products_update" ON public.products;
DROP POLICY IF EXISTS "inventory_movements_select" ON public.inventory_movements;
DROP POLICY IF EXISTS "inventory_movements_insert" ON public.inventory_movements;

-- Categories policies
CREATE POLICY "categories_select" ON public.categories
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "categories_insert" ON public.categories
  FOR INSERT TO authenticated 
  WITH CHECK (true);

CREATE POLICY "categories_update" ON public.categories
  FOR UPDATE TO authenticated 
  USING (true) WITH CHECK (true);

-- Units policies
CREATE POLICY "units_select" ON public.units
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "units_insert" ON public.units
  FOR INSERT TO authenticated 
  WITH CHECK (true);

CREATE POLICY "units_update" ON public.units
  FOR UPDATE TO authenticated 
  USING (true) WITH CHECK (true);

-- Products policies
CREATE POLICY "products_select" ON public.products
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "products_insert" ON public.products
  FOR INSERT TO authenticated 
  WITH CHECK (
    -- Set created_by to auth.uid() if column is null
    created_by IS NULL OR created_by = auth.uid()
  );

CREATE POLICY "products_update" ON public.products
  FOR UPDATE TO authenticated 
  USING (true) 
  WITH CHECK (true);
  -- Note: All authenticated users can update products
  -- For stricter control, use: USING (created_by = auth.uid())

-- Inventory movements policies
CREATE POLICY "inventory_movements_select" ON public.inventory_movements
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "inventory_movements_insert" ON public.inventory_movements
  FOR INSERT TO authenticated 
  WITH CHECK (true);

-- ============================================================================
-- 8. SEED DATA
-- ============================================================================

-- Seed units (only if table is empty)
INSERT INTO public.units (code, name)
SELECT * FROM (VALUES
  ('pcs', 'Dona'),
  ('kg', 'Kilogram'),
  ('l', 'Litr')
) AS v(code, name)
WHERE NOT EXISTS (SELECT 1 FROM public.units WHERE units.code = v.code);

-- Seed categories (only if table is empty)
INSERT INTO public.categories (name, description, is_active, sort_order)
SELECT * FROM (VALUES
  ('Kategoriya yo''q', 'Default category', true, 0),
  ('Oziq-ovqat', 'Oziq-ovqat mahsulotlari', true, 1),
  ('Ichimliklar', 'Ichimliklar', true, 2)
) AS v(name, description, is_active, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM public.categories WHERE categories.name = v.name);

-- ============================================================================
-- 9. GRANT PERMISSIONS
-- ============================================================================

GRANT EXECUTE ON FUNCTION public.generate_sku() TO authenticated;
GRANT SELECT ON public.product_current_stock TO authenticated;

COMMIT;

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================









-- ============================================================================
-- FIX PRODUCTS TABLE RLS POLICIES
-- ============================================================================
-- This script fixes RLS policies on products table to allow authenticated
-- users full access (SELECT, INSERT, UPDATE, DELETE)
-- ============================================================================

BEGIN;

-- Drop all existing RLS policies on products table
DROP POLICY IF EXISTS "products_select" ON public.products;
DROP POLICY IF EXISTS "products_insert" ON public.products;
DROP POLICY IF EXISTS "products_update" ON public.products;
DROP POLICY IF EXISTS "products_delete" ON public.products;
DROP POLICY IF EXISTS "Authenticated users can view products" ON public.products;
DROP POLICY IF EXISTS "Authenticated users can create products" ON public.products;
DROP POLICY IF EXISTS "Authenticated users can update products" ON public.products;
DROP POLICY IF EXISTS "Admins can delete products" ON public.products;
DROP POLICY IF EXISTS "Users can update their own products" ON public.products;
DROP POLICY IF EXISTS "Public can view products" ON public.products;

-- Enable Row Level Security on products table
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

-- Create SELECT policy: Allow all authenticated users to view products
CREATE POLICY "products_select" ON public.products
  FOR SELECT TO authenticated
  USING (true);

-- Create INSERT policy: Allow all authenticated users to create products
CREATE POLICY "products_insert" ON public.products
  FOR INSERT TO authenticated
  WITH CHECK (true);

-- Create UPDATE policy: Allow all authenticated users to update products
CREATE POLICY "products_update" ON public.products
  FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (true);

-- Create DELETE policy: Allow all authenticated users to delete products
CREATE POLICY "products_delete" ON public.products
  FOR DELETE TO authenticated
  USING (true);

COMMIT;

-- ============================================================================
-- RLS POLICIES FIXED
-- ============================================================================









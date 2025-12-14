-- Fix RLS SELECT policies for Products to stop infinite loading
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

-- Drop existing SELECT policies to ensure a clean slate
DROP POLICY IF EXISTS "Enable read access for all users" ON public.products;
DROP POLICY IF EXISTS "Enable all modifications for authenticated users" ON public.products;
DROP POLICY IF EXISTS "Enable all modifications for anon users" ON public.products;

-- Create a permissive SELECT policy for dev mode (Anon + Authenticated)
CREATE POLICY "Enable read access for all users" ON public.products
FOR SELECT
TO public
USING (true);

-- Re-apply full access policies for Auth/Anon (idempotent-ish relative to previous scripts, but safe to re-run)
CREATE POLICY "Enable all modifications for authenticated users" ON public.products
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

CREATE POLICY "Enable all modifications for anon users" ON public.products
FOR ALL
TO anon
USING (true)
WITH CHECK (true);

-- Reload Schema Cache
NOTIFY pgrst, 'reload schema';

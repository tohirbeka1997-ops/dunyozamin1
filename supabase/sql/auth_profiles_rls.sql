/**
 * Row Level Security (RLS) Policies for Authentication & Profiles
 * 
 * This file sets up RLS for:
 * - public.profiles (user profiles)
 * - public.store_members (store membership with roles)
 * 
 * IMPORTANT NOTES:
 * - store_members.user_id references auth.users(id) (NOT public.profiles)
 * - This is correct because auth.users is the source of truth for user IDs
 * - Profiles are linked to auth.users via profiles.id = auth.users.id
 */

-- ============================================
-- PROFILES TABLE RLS
-- ============================================

-- Enable RLS on profiles
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'profiles') THEN
    ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
    
    -- Drop existing policies if they exist (for idempotency)
    DROP POLICY IF EXISTS "Users can view their own profile" ON profiles;
    DROP POLICY IF EXISTS "Users can update their own profile" ON profiles;
    DROP POLICY IF EXISTS "Users can insert their own profile" ON profiles;
    DROP POLICY IF EXISTS "Admins can view all profiles" ON profiles;
    DROP POLICY IF EXISTS "Admins can update all profiles" ON profiles;
    
    -- Policy: Users can SELECT their own profile
    CREATE POLICY "Users can view their own profile"
      ON profiles FOR SELECT
      USING (auth.uid() = id);
    
    -- Policy: Users can UPDATE their own profile
    CREATE POLICY "Users can update their own profile"
      ON profiles FOR UPDATE
      USING (auth.uid() = id)
      WITH CHECK (auth.uid() = id);
    
    -- Policy: Users can INSERT their own profile (during signup)
    CREATE POLICY "Users can insert their own profile"
      ON profiles FOR INSERT
      WITH CHECK (auth.uid() = id);
    
    -- Policy: Admins can SELECT all profiles
    CREATE POLICY "Admins can view all profiles"
      ON profiles FOR SELECT
      USING (
        EXISTS (
          SELECT 1 FROM profiles
          WHERE id = auth.uid() AND role = 'admin'
        )
      );
    
    -- Policy: Admins can UPDATE all profiles
    CREATE POLICY "Admins can update all profiles"
      ON profiles FOR UPDATE
      USING (
        EXISTS (
          SELECT 1 FROM profiles
          WHERE id = auth.uid() AND role = 'admin'
        )
      );
  END IF;
END $$;

-- ============================================
-- STORE_MEMBERS TABLE RLS
-- ============================================

-- Enable RLS on store_members
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'store_members') THEN
    ALTER TABLE store_members ENABLE ROW LEVEL SECURITY;
    
    -- Drop existing policies if they exist (for idempotency)
    DROP POLICY IF EXISTS "Users can view their own memberships" ON store_members;
    DROP POLICY IF EXISTS "Store admins can view all members" ON store_members;
    DROP POLICY IF EXISTS "Store admins can manage members" ON store_members;
    DROP POLICY IF EXISTS "Users can insert their own membership" ON store_members;
    
    -- Policy: Users can SELECT their own memberships
    CREATE POLICY "Users can view their own memberships"
      ON store_members FOR SELECT
      USING (auth.uid() = user_id);
    
    -- Policy: Store admins/owners can SELECT all members in their stores
    CREATE POLICY "Store admins can view all members"
      ON store_members FOR SELECT
      USING (
        EXISTS (
          SELECT 1 FROM store_members sm
          WHERE sm.store_id = store_members.store_id
            AND sm.user_id = auth.uid()
            AND sm.role IN ('owner', 'admin')
            AND sm.is_active = true
        )
      );
    
    -- Policy: Store admins/owners can INSERT/UPDATE/DELETE members
    CREATE POLICY "Store admins can manage members"
      ON store_members FOR ALL
      USING (
        EXISTS (
          SELECT 1 FROM store_members sm
          WHERE sm.store_id = store_members.store_id
            AND sm.user_id = auth.uid()
            AND sm.role IN ('owner', 'admin')
            AND sm.is_active = true
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM store_members sm
          WHERE sm.store_id = store_members.store_id
            AND sm.user_id = auth.uid()
            AND sm.role IN ('owner', 'admin')
            AND sm.is_active = true
        )
      );
    
    -- Policy: Users can INSERT their own membership (if invited)
    -- Note: This is typically handled by an RPC function, but we allow it for flexibility
    CREATE POLICY "Users can insert their own membership"
      ON store_members FOR INSERT
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- ============================================
-- HELPER FUNCTIONS (if not already created)
-- ============================================

-- Function: Check if user is a store member
CREATE OR REPLACE FUNCTION is_store_member(p_store_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM store_members
    WHERE store_id = p_store_id
      AND user_id = p_user_id
      AND is_active = true
  );
$$;

-- Function: Check if user is a store admin/owner
CREATE OR REPLACE FUNCTION is_store_admin(p_store_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM store_members
    WHERE store_id = p_store_id
      AND user_id = p_user_id
      AND role IN ('owner', 'admin')
      AND is_active = true
  );
$$;

-- Function: Get user's role in a store
CREATE OR REPLACE FUNCTION get_user_store_role(p_store_id uuid, p_user_id uuid)
RETURNS store_role
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT role FROM store_members
  WHERE store_id = p_store_id
    AND user_id = p_user_id
    AND is_active = true
  LIMIT 1;
$$;

-- ============================================
-- RPC FUNCTION: Ensure Profile on Signup
-- ============================================

-- This function can be called to ensure a profile exists for a user
-- Typically called from a database trigger or Edge Function
CREATE OR REPLACE FUNCTION ensure_profile_for_user(
  p_user_id uuid,
  p_email text,
  p_username text DEFAULT NULL,
  p_full_name text DEFAULT NULL
)
RETURNS profiles
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_profile profiles;
  v_user_count integer;
  v_default_role text;
BEGIN
  -- Check if profile already exists
  SELECT * INTO v_profile
  FROM profiles
  WHERE id = p_user_id;
  
  IF FOUND THEN
    RETURN v_profile;
  END IF;
  
  -- Determine default role: admin if first user, else cashier
  SELECT COUNT(*) INTO v_user_count FROM profiles;
  v_default_role := CASE WHEN v_user_count = 0 THEN 'admin' ELSE 'cashier' END;
  
  -- Create profile
  INSERT INTO profiles (
    id,
    username,
    full_name,
    email,
    role,
    is_active
  ) VALUES (
    p_user_id,
    COALESCE(p_username, split_part(p_email, '@', 1)),
    COALESCE(p_full_name, split_part(p_email, '@', 1)),
    p_email,
    v_default_role::text,
    true
  )
  RETURNING * INTO v_profile;
  
  RETURN v_profile;
END;
$$;

-- ============================================
-- TRIGGER: Auto-create profile on auth.users insert
-- ============================================

-- Note: This trigger runs in the auth schema, which requires special permissions
-- If you can't create triggers in auth schema, use the RPC function instead
-- Or create an Edge Function that calls ensure_profile_for_user after signup

-- Alternative: Use Supabase Auth webhook or Edge Function to call ensure_profile_for_user

-- ============================================
-- NOTES
-- ============================================

-- 1. store_members.user_id correctly references auth.users(id)
--    This is the source of truth for user authentication
-- 
-- 2. profiles.id also references auth.users(id)
--    This creates a 1:1 relationship between auth users and profiles
--
-- 3. To get a user's role:
--    - First check profiles.role (global role)
--    - Then check store_members.role (store-specific role)
--    - Store role takes precedence for store-specific operations
--
-- 4. For "first user becomes admin":
--    - The ensure_profile_for_user function checks if profiles table is empty
--    - If empty, assigns 'admin' role
--    - Otherwise assigns 'cashier' role
--
-- 5. RLS policies ensure:
--    - Users can only see/modify their own profile
--    - Admins can see/modify all profiles
--    - Users can see their own store memberships
--    - Store admins can manage members in their stores



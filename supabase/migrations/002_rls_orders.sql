-- ============================================================================
-- RLS Policies for Orders, Order Items, and Payments
-- Based on profiles.role (admin, cashier) instead of store_members
-- ============================================================================

-- Helper function to check if user has admin or cashier role
CREATE OR REPLACE FUNCTION has_pos_role(p_user_id uuid, p_allowed_roles text[])
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM profiles
    WHERE id = p_user_id
      AND role = ANY(p_allowed_roles)
      AND is_active = true
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Helper function to check if user is admin
CREATE OR REPLACE FUNCTION is_admin(p_user_id uuid)
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM profiles
    WHERE id = p_user_id
      AND role = 'admin'
      AND is_active = true
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- ORDERS TABLE RLS POLICIES
-- ============================================================================

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'orders') THEN
    -- Enable RLS
    ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

    -- Drop existing policies for idempotency
    DROP POLICY IF EXISTS "Members can read orders in their stores" ON orders;
    DROP POLICY IF EXISTS "Cashiers can create orders" ON orders;
    DROP POLICY IF EXISTS "Store managers can update orders" ON orders;
    DROP POLICY IF EXISTS "Admin and cashier can read orders" ON orders;
    DROP POLICY IF EXISTS "Admin and cashier can insert orders" ON orders;
    DROP POLICY IF EXISTS "Admin and cashier can update orders" ON orders;
    DROP POLICY IF EXISTS "Admin can delete orders" ON orders;

    -- SELECT: Allow authenticated users with admin or cashier role
    CREATE POLICY "Admin and cashier can read orders"
      ON orders FOR SELECT
      TO authenticated
      USING (
        has_pos_role(auth.uid(), ARRAY['admin', 'cashier'])
      );

    -- INSERT: Allow authenticated users with admin or cashier role
    CREATE POLICY "Admin and cashier can insert orders"
      ON orders FOR INSERT
      TO authenticated
      WITH CHECK (
        has_pos_role(auth.uid(), ARRAY['admin', 'cashier'])
      );

    -- UPDATE: Allow authenticated users with admin or cashier role
    CREATE POLICY "Admin and cashier can update orders"
      ON orders FOR UPDATE
      TO authenticated
      USING (
        has_pos_role(auth.uid(), ARRAY['admin', 'cashier'])
      )
      WITH CHECK (
        has_pos_role(auth.uid(), ARRAY['admin', 'cashier'])
      );

    -- DELETE: Allow only admin
    CREATE POLICY "Admin can delete orders"
      ON orders FOR DELETE
      TO authenticated
      USING (
        is_admin(auth.uid())
      );
  END IF;
END $$;

-- ============================================================================
-- ORDER_ITEMS TABLE RLS POLICIES
-- ============================================================================

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'order_items') THEN
    -- Enable RLS
    ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;

    -- Drop existing policies for idempotency
    DROP POLICY IF EXISTS "Members can read order items" ON order_items;
    DROP POLICY IF EXISTS "Admin and cashier can read order items" ON order_items;
    DROP POLICY IF EXISTS "Admin and cashier can insert order items" ON order_items;
    DROP POLICY IF EXISTS "Admin and cashier can update order items" ON order_items;
    DROP POLICY IF EXISTS "Admin can delete order items" ON order_items;

    -- SELECT: Allow authenticated users with admin or cashier role
    CREATE POLICY "Admin and cashier can read order items"
      ON order_items FOR SELECT
      TO authenticated
      USING (
        has_pos_role(auth.uid(), ARRAY['admin', 'cashier'])
      );

    -- INSERT: Allow authenticated users with admin or cashier role
    CREATE POLICY "Admin and cashier can insert order items"
      ON order_items FOR INSERT
      TO authenticated
      WITH CHECK (
        has_pos_role(auth.uid(), ARRAY['admin', 'cashier'])
      );

    -- UPDATE: Allow authenticated users with admin or cashier role
    CREATE POLICY "Admin and cashier can update order items"
      ON order_items FOR UPDATE
      TO authenticated
      USING (
        has_pos_role(auth.uid(), ARRAY['admin', 'cashier'])
      )
      WITH CHECK (
        has_pos_role(auth.uid(), ARRAY['admin', 'cashier'])
      );

    -- DELETE: Allow only admin
    CREATE POLICY "Admin can delete order items"
      ON order_items FOR DELETE
      TO authenticated
      USING (
        is_admin(auth.uid())
      );
  END IF;
END $$;

-- ============================================================================
-- PAYMENTS TABLE RLS POLICIES
-- ============================================================================

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'payments') THEN
    -- Enable RLS
    ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

    -- Drop existing policies for idempotency
    DROP POLICY IF EXISTS "Members can read payments" ON payments;
    DROP POLICY IF EXISTS "Admin and cashier can read payments" ON payments;
    DROP POLICY IF EXISTS "Admin and cashier can insert payments" ON payments;
    DROP POLICY IF EXISTS "Admin and cashier can update payments" ON payments;
    DROP POLICY IF EXISTS "Admin can delete payments" ON payments;

    -- SELECT: Allow authenticated users with admin or cashier role
    CREATE POLICY "Admin and cashier can read payments"
      ON payments FOR SELECT
      TO authenticated
      USING (
        has_pos_role(auth.uid(), ARRAY['admin', 'cashier'])
      );

    -- INSERT: Allow authenticated users with admin or cashier role
    CREATE POLICY "Admin and cashier can insert payments"
      ON payments FOR INSERT
      TO authenticated
      WITH CHECK (
        has_pos_role(auth.uid(), ARRAY['admin', 'cashier'])
      );

    -- UPDATE: Allow authenticated users with admin or cashier role
    CREATE POLICY "Admin and cashier can update payments"
      ON payments FOR UPDATE
      TO authenticated
      USING (
        has_pos_role(auth.uid(), ARRAY['admin', 'cashier'])
      )
      WITH CHECK (
        has_pos_role(auth.uid(), ARRAY['admin', 'cashier'])
      );

    -- DELETE: Allow only admin
    CREATE POLICY "Admin can delete payments"
      ON payments FOR DELETE
      TO authenticated
      USING (
        is_admin(auth.uid())
      );
  END IF;
END $$;

-- Notify PostgREST to reload schema
NOTIFY pgrst, 'reload schema';



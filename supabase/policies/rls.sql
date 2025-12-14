CREATE OR REPLACE FUNCTION is_store_member(p_store_id uuid, p_user_id uuid)
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM store_members
    WHERE store_id = p_store_id
      AND user_id = p_user_id
      AND is_active = true
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION is_store_admin(p_store_id uuid, p_user_id uuid)
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM store_members
    WHERE store_id = p_store_id
      AND user_id = p_user_id
      AND is_active = true
      AND role IN ('owner', 'admin')
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION is_store_manager_or_above(p_store_id uuid, p_user_id uuid)
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM store_members
    WHERE store_id = p_store_id
      AND user_id = p_user_id
      AND is_active = true
      AND role IN ('owner', 'admin', 'manager')
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION get_user_stores(p_user_id uuid)
RETURNS uuid[] AS $$
BEGIN
  RETURN ARRAY(
    SELECT store_id
    FROM store_members
    WHERE user_id = p_user_id
      AND is_active = true
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'stores') THEN
    ALTER TABLE stores ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'locations') THEN
    ALTER TABLE locations ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'store_members') THEN
    ALTER TABLE store_members ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'profiles') THEN
    ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'categories') THEN
    ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'products') THEN
    ALTER TABLE products ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'inventory_balances') THEN
    ALTER TABLE inventory_balances ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'inventory_movements') THEN
    ALTER TABLE inventory_movements ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'customers') THEN
    ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'customer_payments') THEN
    ALTER TABLE customer_payments ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'suppliers') THEN
    ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'supplier_payments') THEN
    ALTER TABLE supplier_payments ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'shifts') THEN
    ALTER TABLE shifts ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'orders') THEN
    ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'order_items') THEN
    ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'payments') THEN
    ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'sales_returns') THEN
    ALTER TABLE sales_returns ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'sales_return_items') THEN
    ALTER TABLE sales_return_items ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'purchase_orders') THEN
    ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'purchase_order_items') THEN
    ALTER TABLE purchase_order_items ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'purchase_returns') THEN
    ALTER TABLE purchase_returns ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'purchase_return_items') THEN
    ALTER TABLE purchase_return_items ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'expenses') THEN
    ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'money_ledger') THEN
    ALTER TABLE money_ledger ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'ledger_entries') THEN
    ALTER TABLE ledger_entries ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'held_orders') THEN
    ALTER TABLE held_orders ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'settings') THEN
    ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'employee_sessions') THEN
    ALTER TABLE employee_sessions ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'employee_activity_logs') THEN
    ALTER TABLE employee_activity_logs ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'stores') THEN
    DROP POLICY IF EXISTS "Members can read their stores" ON stores;
    CREATE POLICY "Members can read their stores"
      ON stores FOR SELECT
      USING (is_store_member(id, auth.uid()));
    
    DROP POLICY IF EXISTS "Admins can create stores" ON stores;
    CREATE POLICY "Admins can create stores"
      ON stores FOR INSERT
      WITH CHECK (
        auth.uid() IS NOT NULL
        AND (SELECT role FROM profiles WHERE id = auth.uid()) = 'admin'
      );
    
    DROP POLICY IF EXISTS "Store admins can update their stores" ON stores;
    CREATE POLICY "Store admins can update their stores"
      ON stores FOR UPDATE
      USING (is_store_admin(id, auth.uid()))
      WITH CHECK (is_store_admin(id, auth.uid()));
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'locations') THEN
    DROP POLICY IF EXISTS "Members can read locations in their stores" ON locations;
    CREATE POLICY "Members can read locations in their stores"
      ON locations FOR SELECT
      USING (is_store_member(store_id, auth.uid()));
    
    DROP POLICY IF EXISTS "Store admins can manage locations" ON locations;
    CREATE POLICY "Store admins can manage locations"
      ON locations FOR ALL
      USING (is_store_admin(store_id, auth.uid()))
      WITH CHECK (is_store_admin(store_id, auth.uid()));
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'store_members') THEN
    DROP POLICY IF EXISTS "Members can read store members" ON store_members;
    CREATE POLICY "Members can read store members"
      ON store_members FOR SELECT
      USING (is_store_member(store_id, auth.uid()));
    
    DROP POLICY IF EXISTS "Store admins can manage members" ON store_members;
    CREATE POLICY "Store admins can manage members"
      ON store_members FOR ALL
      USING (is_store_admin(store_id, auth.uid()))
      WITH CHECK (is_store_admin(store_id, auth.uid()));
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'profiles') THEN
    DROP POLICY IF EXISTS "Users can read profiles" ON profiles;
    CREATE POLICY "Users can read profiles"
      ON profiles FOR SELECT
      TO authenticated
      USING (true);
    
    DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
    CREATE POLICY "Users can update own profile"
      ON profiles FOR UPDATE
      USING (id = auth.uid())
      WITH CHECK (id = auth.uid());
    
    DROP POLICY IF EXISTS "Admins can manage profiles" ON profiles;
    CREATE POLICY "Admins can manage profiles"
      ON profiles FOR ALL
      USING (
        (SELECT role FROM profiles WHERE id = auth.uid()) = 'admin'
      )
      WITH CHECK (
        (SELECT role FROM profiles WHERE id = auth.uid()) = 'admin'
      );
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'categories') THEN
    DROP POLICY IF EXISTS "Authenticated users can read categories" ON categories;
    CREATE POLICY "Authenticated users can read categories"
      ON categories FOR SELECT
      TO authenticated
      USING (true);
    
    DROP POLICY IF EXISTS "Managers can manage categories" ON categories;
    CREATE POLICY "Managers can manage categories"
      ON categories FOR ALL
      TO authenticated
      USING (
        (SELECT role FROM profiles WHERE id = auth.uid()) IN ('admin', 'manager')
      )
      WITH CHECK (
        (SELECT role FROM profiles WHERE id = auth.uid()) IN ('admin', 'manager')
      );
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'products') THEN
    DROP POLICY IF EXISTS "Members can read products in their stores" ON products;
    CREATE POLICY "Members can read products in their stores"
      ON products FOR SELECT
      USING (is_store_member(store_id, auth.uid()));
    
    DROP POLICY IF EXISTS "Store managers can insert products" ON products;
    CREATE POLICY "Store managers can insert products"
      ON products FOR INSERT
      WITH CHECK (
        is_store_member(store_id, auth.uid())
        AND is_store_manager_or_above(store_id, auth.uid())
      );
    
    DROP POLICY IF EXISTS "Store managers can update products" ON products;
    CREATE POLICY "Store managers can update products"
      ON products FOR UPDATE
      USING (
        is_store_member(store_id, auth.uid())
        AND is_store_manager_or_above(store_id, auth.uid())
      )
      WITH CHECK (
        is_store_member(store_id, auth.uid())
        AND is_store_manager_or_above(store_id, auth.uid())
      );
    
    DROP POLICY IF EXISTS "Store admins can delete products" ON products;
    CREATE POLICY "Store admins can delete products"
      ON products FOR DELETE
      USING (is_store_admin(store_id, auth.uid()));
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'inventory_balances') THEN
    DROP POLICY IF EXISTS "Members can read inventory in their stores" ON inventory_balances;
    CREATE POLICY "Members can read inventory in their stores"
      ON inventory_balances FOR SELECT
      USING (
        EXISTS (
          SELECT 1 FROM products p
          WHERE p.id = inventory_balances.product_id
            AND is_store_member(p.store_id, auth.uid())
        )
      );
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'inventory_movements') THEN
    DROP POLICY IF EXISTS "Members can read inventory movements in their stores" ON inventory_movements;
    CREATE POLICY "Members can read inventory movements in their stores"
      ON inventory_movements FOR SELECT
      USING (
        EXISTS (
          SELECT 1 FROM products p
          WHERE p.id = inventory_movements.product_id
            AND is_store_member(p.store_id, auth.uid())
        )
      );
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'customers') THEN
    DROP POLICY IF EXISTS "Members can read customers in their stores" ON customers;
    CREATE POLICY "Members can read customers in their stores"
      ON customers FOR SELECT
      USING (is_store_member(store_id, auth.uid()));
    
    DROP POLICY IF EXISTS "Members can insert customers" ON customers;
    CREATE POLICY "Members can insert customers"
      ON customers FOR INSERT
      WITH CHECK (is_store_member(store_id, auth.uid()));
    
    DROP POLICY IF EXISTS "Store managers can update customers" ON customers;
    CREATE POLICY "Store managers can update customers"
      ON customers FOR UPDATE
      USING (is_store_manager_or_above(store_id, auth.uid()))
      WITH CHECK (is_store_manager_or_above(store_id, auth.uid()));
    
    DROP POLICY IF EXISTS "Store admins can delete customers" ON customers;
    CREATE POLICY "Store admins can delete customers"
      ON customers FOR DELETE
      USING (is_store_admin(store_id, auth.uid()));
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'customer_payments') THEN
    DROP POLICY IF EXISTS "Members can read customer payments in their stores" ON customer_payments;
    CREATE POLICY "Members can read customer payments in their stores"
      ON customer_payments FOR SELECT
      USING (is_store_member(store_id, auth.uid()));
    
    DROP POLICY IF EXISTS "Store managers can manage customer payments" ON customer_payments;
    CREATE POLICY "Store managers can manage customer payments"
      ON customer_payments FOR ALL
      USING (is_store_manager_or_above(store_id, auth.uid()))
      WITH CHECK (is_store_manager_or_above(store_id, auth.uid()));
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'suppliers') THEN
    DROP POLICY IF EXISTS "Members can read suppliers in their stores" ON suppliers;
    CREATE POLICY "Members can read suppliers in their stores"
      ON suppliers FOR SELECT
      USING (is_store_member(store_id, auth.uid()));
    
    DROP POLICY IF EXISTS "Store managers can manage suppliers" ON suppliers;
    CREATE POLICY "Store managers can manage suppliers"
      ON suppliers FOR ALL
      USING (is_store_manager_or_above(store_id, auth.uid()))
      WITH CHECK (is_store_manager_or_above(store_id, auth.uid()));
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'supplier_payments') THEN
    DROP POLICY IF EXISTS "Members can read supplier payments in their stores" ON supplier_payments;
    CREATE POLICY "Members can read supplier payments in their stores"
      ON supplier_payments FOR SELECT
      USING (is_store_member(store_id, auth.uid()));
    
    DROP POLICY IF EXISTS "Store managers can manage supplier payments" ON supplier_payments;
    CREATE POLICY "Store managers can manage supplier payments"
      ON supplier_payments FOR ALL
      USING (is_store_manager_or_above(store_id, auth.uid()))
      WITH CHECK (is_store_manager_or_above(store_id, auth.uid()));
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'shifts') THEN
    DROP POLICY IF EXISTS "Members can read shifts in their stores" ON shifts;
    CREATE POLICY "Members can read shifts in their stores"
      ON shifts FOR SELECT
      USING (is_store_member(store_id, auth.uid()));
    
    DROP POLICY IF EXISTS "Cashiers can open shifts" ON shifts;
    CREATE POLICY "Cashiers can open shifts"
      ON shifts FOR INSERT
      WITH CHECK (
        is_store_member(store_id, auth.uid())
        AND cashier_id = auth.uid()
      );
    
    DROP POLICY IF EXISTS "Cashiers can close their own shifts" ON shifts;
    CREATE POLICY "Cashiers can close their own shifts"
      ON shifts FOR UPDATE
      USING (
        is_store_member(store_id, auth.uid())
        AND cashier_id = auth.uid()
      )
      WITH CHECK (
        is_store_member(store_id, auth.uid())
        AND cashier_id = auth.uid()
      );
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'orders') THEN
    DROP POLICY IF EXISTS "Members can read orders in their stores" ON orders;
    CREATE POLICY "Members can read orders in their stores"
      ON orders FOR SELECT
      USING (is_store_member(store_id, auth.uid()));
    
    DROP POLICY IF EXISTS "Cashiers can create orders" ON orders;
    CREATE POLICY "Cashiers can create orders"
      ON orders FOR INSERT
      WITH CHECK (
        is_store_member(store_id, auth.uid())
        AND cashier_id = auth.uid()
      );
    
    DROP POLICY IF EXISTS "Store managers can update orders" ON orders;
    CREATE POLICY "Store managers can update orders"
      ON orders FOR UPDATE
      USING (is_store_manager_or_above(store_id, auth.uid()))
      WITH CHECK (is_store_manager_or_above(store_id, auth.uid()));
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'order_items') THEN
    DROP POLICY IF EXISTS "Members can read order items" ON order_items;
    CREATE POLICY "Members can read order items"
      ON order_items FOR SELECT
      USING (
        EXISTS (
          SELECT 1 FROM orders o
          WHERE o.id = order_items.order_id
            AND is_store_member(o.store_id, auth.uid())
        )
      );
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'payments') THEN
    DROP POLICY IF EXISTS "Members can read payments" ON payments;
    CREATE POLICY "Members can read payments"
      ON payments FOR SELECT
      USING (
        EXISTS (
          SELECT 1 FROM orders o
          WHERE o.id = payments.order_id
            AND is_store_member(o.store_id, auth.uid())
        )
      );
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'sales_returns') THEN
    DROP POLICY IF EXISTS "Members can read sales returns in their stores" ON sales_returns;
    CREATE POLICY "Members can read sales returns in their stores"
      ON sales_returns FOR SELECT
      USING (is_store_member(store_id, auth.uid()));
    
    DROP POLICY IF EXISTS "Cashiers can create sales returns" ON sales_returns;
    CREATE POLICY "Cashiers can create sales returns"
      ON sales_returns FOR INSERT
      WITH CHECK (
        is_store_member(store_id, auth.uid())
        AND cashier_id = auth.uid()
      );
    
    DROP POLICY IF EXISTS "Store managers can update sales returns" ON sales_returns;
    CREATE POLICY "Store managers can update sales returns"
      ON sales_returns FOR UPDATE
      USING (is_store_manager_or_above(store_id, auth.uid()))
      WITH CHECK (is_store_manager_or_above(store_id, auth.uid()));
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'sales_return_items') THEN
    DROP POLICY IF EXISTS "Members can read sales return items" ON sales_return_items;
    CREATE POLICY "Members can read sales return items"
      ON sales_return_items FOR SELECT
      USING (
        EXISTS (
          SELECT 1 FROM sales_returns sr
          WHERE sr.id = sales_return_items.return_id
            AND is_store_member(sr.store_id, auth.uid())
        )
      );
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'purchase_orders') THEN
    DROP POLICY IF EXISTS "Members can read purchase orders in their stores" ON purchase_orders;
    CREATE POLICY "Members can read purchase orders in their stores"
      ON purchase_orders FOR SELECT
      USING (is_store_member(store_id, auth.uid()));
    
    DROP POLICY IF EXISTS "Store managers can manage purchase orders" ON purchase_orders;
    CREATE POLICY "Store managers can manage purchase orders"
      ON purchase_orders FOR ALL
      USING (is_store_manager_or_above(store_id, auth.uid()))
      WITH CHECK (is_store_manager_or_above(store_id, auth.uid()));
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'purchase_order_items') THEN
    DROP POLICY IF EXISTS "Members can read purchase order items" ON purchase_order_items;
    CREATE POLICY "Members can read purchase order items"
      ON purchase_order_items FOR SELECT
      USING (
        EXISTS (
          SELECT 1 FROM purchase_orders po
          WHERE po.id = purchase_order_items.purchase_order_id
            AND is_store_member(po.store_id, auth.uid())
        )
      );
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'purchase_returns') THEN
    DROP POLICY IF EXISTS "Members can read purchase returns in their stores" ON purchase_returns;
    CREATE POLICY "Members can read purchase returns in their stores"
      ON purchase_returns FOR SELECT
      USING (is_store_member(store_id, auth.uid()));
    
    DROP POLICY IF EXISTS "Store managers can manage purchase returns" ON purchase_returns;
    CREATE POLICY "Store managers can manage purchase returns"
      ON purchase_returns FOR ALL
      USING (is_store_manager_or_above(store_id, auth.uid()))
      WITH CHECK (is_store_manager_or_above(store_id, auth.uid()));
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'expenses') THEN
    DROP POLICY IF EXISTS "Members can read expenses in their stores" ON expenses;
    CREATE POLICY "Members can read expenses in their stores"
      ON expenses FOR SELECT
      USING (is_store_member(store_id, auth.uid()));
    
    DROP POLICY IF EXISTS "Store managers can manage expenses" ON expenses;
    CREATE POLICY "Store managers can manage expenses"
      ON expenses FOR ALL
      USING (is_store_manager_or_above(store_id, auth.uid()))
      WITH CHECK (is_store_manager_or_above(store_id, auth.uid()));
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'money_ledger') THEN
    DROP POLICY IF EXISTS "Members can read ledger in their stores" ON money_ledger;
    CREATE POLICY "Members can read ledger in their stores"
      ON money_ledger FOR SELECT
      USING (is_store_member(store_id, auth.uid()));
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'ledger_entries') THEN
    DROP POLICY IF EXISTS "Members can read ledger entries in their stores" ON ledger_entries;
    CREATE POLICY "Members can read ledger entries in their stores"
      ON ledger_entries FOR SELECT
      USING (is_store_member(store_id, auth.uid()));
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'held_orders') THEN
    DROP POLICY IF EXISTS "Members can read held orders in their stores" ON held_orders;
    CREATE POLICY "Members can read held orders in their stores"
      ON held_orders FOR SELECT
      USING (is_store_member(store_id, auth.uid()));
    
    DROP POLICY IF EXISTS "Cashiers can manage held orders" ON held_orders;
    CREATE POLICY "Cashiers can manage held orders"
      ON held_orders FOR ALL
      USING (
        is_store_member(store_id, auth.uid())
        AND cashier_id = auth.uid()
      )
      WITH CHECK (
        is_store_member(store_id, auth.uid())
        AND cashier_id = auth.uid()
      );
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'settings') THEN
    DROP POLICY IF EXISTS "Members can read settings in their stores" ON settings;
    CREATE POLICY "Members can read settings in their stores"
      ON settings FOR SELECT
      USING (
        store_id IS NULL
        OR is_store_member(store_id, auth.uid())
      );
    
    DROP POLICY IF EXISTS "Store admins can manage store settings" ON settings;
    CREATE POLICY "Store admins can manage store settings"
      ON settings FOR ALL
      USING (
        store_id IS NULL AND (SELECT role FROM profiles WHERE id = auth.uid()) = 'admin'
        OR (store_id IS NOT NULL AND is_store_admin(store_id, auth.uid()))
      )
      WITH CHECK (
        store_id IS NULL AND (SELECT role FROM profiles WHERE id = auth.uid()) = 'admin'
        OR (store_id IS NOT NULL AND is_store_admin(store_id, auth.uid()))
      );
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'employee_sessions') THEN
    DROP POLICY IF EXISTS "Members can read sessions in their stores" ON employee_sessions;
    CREATE POLICY "Members can read sessions in their stores"
      ON employee_sessions FOR SELECT
      USING (
        store_id IS NULL
        OR is_store_member(store_id, auth.uid())
      );
    
    DROP POLICY IF EXISTS "Users can read own sessions" ON employee_sessions;
    CREATE POLICY "Users can read own sessions"
      ON employee_sessions FOR SELECT
      USING (employee_id = auth.uid());
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'employee_activity_logs') THEN
    DROP POLICY IF EXISTS "Members can read activity logs in their stores" ON employee_activity_logs;
    CREATE POLICY "Members can read activity logs in their stores"
      ON employee_activity_logs FOR SELECT
      USING (
        store_id IS NULL
        OR is_store_member(store_id, auth.uid())
      );
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION is_store_member(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION is_store_admin(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION is_store_manager_or_above(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_stores(uuid) TO authenticated;

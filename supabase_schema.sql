-- Supabase Schema for POS Application
-- Based on src/types/database.ts

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ==============================================================================
-- 1. ENUMS (Implicitly handled via Check Constraints for simplicity and portability)
-- ==============================================================================

-- ==============================================================================
-- 2. TABLES (DDL)
-- ==============================================================================

-- 2.1 PROFILES (Extends auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    username TEXT NOT NULL,
    full_name TEXT,
    phone TEXT,
    email TEXT,
    role TEXT CHECK (role IN ('admin', 'manager', 'cashier')) NOT NULL DEFAULT 'cashier',
    is_active BOOLEAN DEFAULT true,
    last_login TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE
);

-- 2.2 CATEGORIES
CREATE TABLE IF NOT EXISTS public.categories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    description TEXT,
    color TEXT,
    icon TEXT,
    parent_id UUID REFERENCES public.categories(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- 2.3 SUPPLIERS
CREATE TABLE IF NOT EXISTS public.suppliers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    contact_person TEXT,
    phone TEXT,
    email TEXT,
    address TEXT,
    note TEXT,
    status TEXT CHECK (status IN ('active', 'inactive')) DEFAULT 'active',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE
    -- Note: balance is calculated dynamically
);

-- 2.4 PRODUCTS
CREATE TABLE IF NOT EXISTS public.products (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sku TEXT UNIQUE NOT NULL,
    barcode TEXT,
    name TEXT NOT NULL,
    description TEXT,
    category_id UUID REFERENCES public.categories(id) ON DELETE SET NULL,
    unit TEXT DEFAULT 'pcs',
    purchase_price NUMERIC DEFAULT 0,
    sale_price NUMERIC DEFAULT 0,
    current_stock NUMERIC DEFAULT 0,
    min_stock_level NUMERIC DEFAULT 0,
    image_url TEXT,
    is_active BOOLEAN DEFAULT true,
    store_id UUID, -- Nullable as per recent changes
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- 2.5 CUSTOMERS
CREATE TABLE IF NOT EXISTS public.customers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    phone TEXT,
    email TEXT,
    address TEXT,
    type TEXT CHECK (type IN ('individual', 'company')) DEFAULT 'individual',
    company_name TEXT,
    tax_number TEXT,
    credit_limit NUMERIC DEFAULT 0,
    allow_debt BOOLEAN DEFAULT false,
    balance NUMERIC DEFAULT 0, -- Cached balance often needed for customers
    total_sales NUMERIC DEFAULT 0,
    total_orders INTEGER DEFAULT 0,
    last_order_date TIMESTAMP WITH TIME ZONE,
    status TEXT CHECK (status IN ('active', 'inactive')) DEFAULT 'active',
    notes TEXT,
    bonus_points NUMERIC DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- 2.6 PURCHASE ORDERS
CREATE TABLE IF NOT EXISTS public.purchase_orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    po_number TEXT UNIQUE NOT NULL,
    supplier_id UUID REFERENCES public.suppliers(id),
    supplier_name TEXT, -- Cached for ease
    order_date TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    expected_date TIMESTAMP WITH TIME ZONE,
    reference TEXT,
    subtotal NUMERIC DEFAULT 0,
    discount NUMERIC DEFAULT 0,
    tax NUMERIC DEFAULT 0,
    total_amount NUMERIC DEFAULT 0,
    status TEXT CHECK (status IN ('draft', 'approved', 'partially_received', 'received', 'cancelled')) DEFAULT 'draft',
    invoice_number TEXT,
    received_by UUID REFERENCES public.profiles(id),
    created_by UUID REFERENCES public.profiles(id),
    approved_by UUID REFERENCES public.profiles(id),
    approved_at TIMESTAMP WITH TIME ZONE,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- 2.7 PURCHASE ORDER ITEMS
CREATE TABLE IF NOT EXISTS public.purchase_order_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    purchase_order_id UUID REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
    product_id UUID REFERENCES public.products(id),
    product_name TEXT,
    ordered_qty NUMERIC NOT NULL,
    received_qty NUMERIC DEFAULT 0,
    unit_cost NUMERIC DEFAULT 0,
    line_total NUMERIC DEFAULT 0
);

-- 2.8 SUPPLIER PAYMENTS
CREATE TABLE IF NOT EXISTS public.supplier_payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    payment_number TEXT UNIQUE NOT NULL,
    supplier_id UUID REFERENCES public.suppliers(id),
    purchase_order_id UUID REFERENCES public.purchase_orders(id),
    amount NUMERIC NOT NULL,
    payment_method TEXT CHECK (payment_method IN ('cash', 'card', 'transfer', 'click', 'payme', 'uzum')),
    paid_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    note TEXT,
    created_by UUID REFERENCES public.profiles(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2.9 SHIFTS
CREATE TABLE IF NOT EXISTS public.shifts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shift_number TEXT NOT NULL,
    cashier_id UUID REFERENCES public.profiles(id) NOT NULL,
    opened_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    closed_at TIMESTAMP WITH TIME ZONE,
    opening_cash NUMERIC DEFAULT 0,
    closing_cash NUMERIC,
    expected_cash NUMERIC,
    cash_difference NUMERIC,
    status TEXT CHECK (status IN ('open', 'closed')) DEFAULT 'open',
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- 2.10 ORDERS
CREATE TABLE IF NOT EXISTS public.orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_number TEXT UNIQUE NOT NULL,
    customer_id UUID REFERENCES public.customers(id),
    cashier_id UUID REFERENCES public.profiles(id),
    shift_id UUID REFERENCES public.shifts(id),
    subtotal NUMERIC DEFAULT 0,
    discount_amount NUMERIC DEFAULT 0,
    discount_percent NUMERIC DEFAULT 0,
    tax_amount NUMERIC DEFAULT 0,
    total_amount NUMERIC DEFAULT 0,
    paid_amount NUMERIC DEFAULT 0,
    credit_amount NUMERIC DEFAULT 0, -- Debt
    change_amount NUMERIC DEFAULT 0,
    status TEXT CHECK (status IN ('hold', 'completed', 'returned')) DEFAULT 'completed',
    payment_status TEXT CHECK (payment_status IN ('pending', 'partial', 'paid', 'on_credit', 'partially_paid')),
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2.11 ORDER ITEMS
CREATE TABLE IF NOT EXISTS public.order_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id UUID REFERENCES public.orders(id) ON DELETE CASCADE,
    product_id UUID REFERENCES public.products(id),
    product_name TEXT,
    quantity NUMERIC NOT NULL,
    unit_price NUMERIC NOT NULL,
    subtotal NUMERIC NOT NULL,
    discount_amount NUMERIC DEFAULT 0,
    total NUMERIC NOT NULL
);

-- 2.12 PAYMENTS (Order Payments)
CREATE TABLE IF NOT EXISTS public.payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    payment_number TEXT,
    order_id UUID REFERENCES public.orders(id) ON DELETE CASCADE,
    payment_method TEXT CHECK (payment_method IN ('cash', 'card', 'terminal', 'qr', 'mixed', 'credit')),
    amount NUMERIC NOT NULL,
    reference_number TEXT,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2.13 CUSTOMER PAYMENTS (Debt repayment)
CREATE TABLE IF NOT EXISTS public.customer_payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    payment_number TEXT,
    customer_id UUID REFERENCES public.customers(id),
    amount NUMERIC NOT NULL,
    payment_method TEXT CHECK (payment_method IN ('cash', 'card', 'qr')),
    reference_number TEXT,
    notes TEXT,
    received_by UUID REFERENCES public.profiles(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2.14 SALES RETURNS
CREATE TABLE IF NOT EXISTS public.sales_returns (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    return_number TEXT UNIQUE NOT NULL,
    order_id UUID REFERENCES public.orders(id),
    customer_id UUID REFERENCES public.customers(id),
    cashier_id UUID REFERENCES public.profiles(id),
    total_amount NUMERIC NOT NULL,
    refund_method TEXT CHECK (refund_method IN ('cash', 'card', 'credit')),
    status TEXT DEFAULT 'completed',
    reason TEXT,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- 2.15 SALES RETURN ITEMS
CREATE TABLE IF NOT EXISTS public.sales_return_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    return_id UUID REFERENCES public.sales_returns(id) ON DELETE CASCADE,
    product_id UUID REFERENCES public.products(id),
    quantity NUMERIC NOT NULL,
    unit_price NUMERIC NOT NULL,
    line_total NUMERIC NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- 2.16 INVENTORY MOVEMENTS
CREATE TABLE IF NOT EXISTS public.inventory_movements (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    movement_number TEXT,
    product_id UUID REFERENCES public.products(id),
    movement_type TEXT CHECK (movement_type IN ('purchase', 'sale', 'return', 'adjustment', 'audit')),
    quantity NUMERIC NOT NULL, -- + for in, - for out usually, but here schema implies absolute val?
    before_quantity NUMERIC,
    after_quantity NUMERIC,
    reference_type TEXT, -- 'order', 'purchase_order', etc.
    reference_id UUID, -- Polymorphic relation
    reason TEXT,
    notes TEXT,
    created_by UUID REFERENCES public.profiles(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2.17 EXPENSES
CREATE TABLE IF NOT EXISTS public.expenses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    expense_number TEXT,
    expense_date TIMESTAMP WITH TIME ZONE,
    category TEXT,
    amount NUMERIC NOT NULL,
    payment_method TEXT,
    note TEXT,
    employee_id UUID REFERENCES public.profiles(id),
    created_by UUID REFERENCES public.profiles(id),
    status TEXT CHECK (status IN ('approved', 'pending')) DEFAULT 'pending',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- 2.18 SETTINGS
CREATE TABLE IF NOT EXISTS public.settings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    category TEXT NOT NULL,
    key TEXT NOT NULL,
    value JSONB, -- Store strictly typed config as JSON
    description TEXT,
    updated_by UUID REFERENCES public.profiles(id),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(category, key)
);

-- 2.19 EMPLOYEE SESSIONS
CREATE TABLE IF NOT EXISTS public.employee_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    employee_id UUID REFERENCES public.profiles(id),
    login_time TIMESTAMP WITH TIME ZONE,
    logout_time TIMESTAMP WITH TIME ZONE,
    duration TEXT,
    ip_address TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2.20 EMPLOYEE ACTIVITY LOGS
CREATE TABLE IF NOT EXISTS public.employee_activity_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    employee_id UUID REFERENCES public.profiles(id),
    action_type TEXT,
    description TEXT,
    document_id UUID,
    document_type TEXT,
    ip_address TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2.21 HELD ORDERS (Sync held orders to DB)
CREATE TABLE IF NOT EXISTS public.held_orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    held_number TEXT,
    cashier_id UUID REFERENCES public.profiles(id),
    shift_id UUID REFERENCES public.shifts(id),
    customer_id UUID REFERENCES public.customers(id),
    customer_name TEXT,
    items JSONB, -- Store array of cart items as JSONB for simplicity since it's temporary
    discount JSONB,
    note TEXT,
    status TEXT CHECK (status IN ('HELD', 'RESTORED', 'CANCELLED')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE
);

-- ==============================================================================
-- 3. ROW LEVEL SECURITY (RLS)
-- ==============================================================================

-- Helper for common policies
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_return_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_activity_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.held_orders ENABLE ROW LEVEL SECURITY;

-- DROP ALL EXISTING POLICIES to avoid duplicates or conflicts
DO $$ 
DECLARE 
    r RECORD; 
BEGIN 
    FOR r IN (SELECT tablename, policyname FROM pg_policies WHERE schemaname = 'public') LOOP 
        EXECUTE 'DROP POLICY IF EXISTS "' || r.policyname || '" ON public.' || r.tablename; 
    END LOOP; 
END $$;

-- Create policies (Permissive for Authenticated, Strict for Anon usually, but here just Auth)
-- READ: All authenticated users can read most things
CREATE POLICY "Allow read access for authenticated users" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow read access for authenticated users" ON public.categories FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow read access for authenticated users" ON public.suppliers FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow read access for authenticated users" ON public.products FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow read access for authenticated users" ON public.customers FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow read access for authenticated users" ON public.purchase_orders FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow read access for authenticated users" ON public.purchase_order_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow read access for authenticated users" ON public.supplier_payments FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow read access for authenticated users" ON public.shifts FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow read access for authenticated users" ON public.orders FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow read access for authenticated users" ON public.order_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow read access for authenticated users" ON public.payments FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow read access for authenticated users" ON public.customer_payments FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow read access for authenticated users" ON public.sales_returns FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow read access for authenticated users" ON public.sales_return_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow read access for authenticated users" ON public.inventory_movements FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow read access for authenticated users" ON public.expenses FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow read access for authenticated users" ON public.settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow read access for authenticated users" ON public.employee_sessions FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow read access for authenticated users" ON public.employee_activity_logs FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow read access for authenticated users" ON public.held_orders FOR SELECT TO authenticated USING (true);

-- WRITE: Allow authenticated users to insert/update (Simplification: Assuming granular roles handled in app logic or strict RLS later if needed)
-- For now, giving full write access to authenticated users to ensure app works.
CREATE POLICY "Allow write access for authenticated users" ON public.profiles FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow write access for authenticated users" ON public.categories FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow write access for authenticated users" ON public.suppliers FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow write access for authenticated users" ON public.products FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow write access for authenticated users" ON public.customers FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow write access for authenticated users" ON public.purchase_orders FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow write access for authenticated users" ON public.purchase_order_items FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow write access for authenticated users" ON public.supplier_payments FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow write access for authenticated users" ON public.shifts FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow write access for authenticated users" ON public.orders FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow write access for authenticated users" ON public.order_items FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow write access for authenticated users" ON public.payments FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow write access for authenticated users" ON public.customer_payments FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow write access for authenticated users" ON public.sales_returns FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow write access for authenticated users" ON public.sales_return_items FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow write access for authenticated users" ON public.inventory_movements FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow write access for authenticated users" ON public.expenses FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow write access for authenticated users" ON public.settings FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow write access for authenticated users" ON public.employee_sessions FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow write access for authenticated users" ON public.employee_activity_logs FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow write access for authenticated users" ON public.held_orders FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ==============================================================================
-- 4. INDICES
-- ==============================================================================

CREATE INDEX IF NOT EXISTS idx_products_category_id ON public.products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_barcode ON public.products(barcode);
CREATE INDEX IF NOT EXISTS idx_products_sku ON public.products(sku);
CREATE INDEX IF NOT EXISTS idx_orders_customer_id ON public.orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON public.orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_supplier_id ON public.purchase_orders(supplier_id);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_product_id ON public.inventory_movements(product_id);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_reference ON public.inventory_movements(reference_id);
CREATE INDEX IF NOT EXISTS idx_sales_returns_order_id ON public.sales_returns(order_id);

-- ==============================================================================
-- 5. TRIGGERS (Optional but useful)
-- ==============================================================================

-- Function to handle new user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, username, role, email)
  VALUES (new.id, new.email, 'cashier', new.email);
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger for new user
-- DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
-- CREATE TRIGGER on_auth_user_created
--   AFTER INSERT ON auth.users
--   FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- Force Schema Cache Reload
NOTIFY pgrst, 'reload schema';

/*
================================================================================
COMPLETE DATABASE SCHEMA FOR POS SYSTEM
================================================================================

This SQL script creates all necessary tables for a POS system based on
POSTerminal.tsx requirements including:
- Products with inventory tracking
- Customers with credit/debt management
- Orders and order items
- Payments with multiple payment methods
- Shifts for cashier management
- Categories for product organization

Payment Methods Supported:
- 'cash' (Cash)
- 'card' (Card)
- 'qr' (QR Payment)
- 'credit' / 'Nasiya' (Credit Sale)
- 'mixed' (Mixed Payment)
- 'terminal' (Terminal)
- 'other' (Other)

================================================================================
*/

-- ============================================================================
-- 1. ENUMS
-- ============================================================================

CREATE TYPE IF NOT EXISTS user_role AS ENUM ('admin', 'manager', 'cashier');

-- ============================================================================
-- 2. PROFILES TABLE (Required for cashier_id in orders)
-- ============================================================================

CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username text UNIQUE NOT NULL,
  full_name text,
  role user_role DEFAULT 'cashier'::user_role NOT NULL,
  is_active boolean DEFAULT true,
  phone text,
  email text,
  last_login timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- ============================================================================
-- 3. CATEGORIES TABLE (Required for products)
-- ============================================================================

CREATE TABLE IF NOT EXISTS categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE NOT NULL,
  description text,
  color text,
  icon text,
  parent_id uuid REFERENCES categories(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

-- ============================================================================
-- 4. PRODUCTS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku text UNIQUE NOT NULL,
  barcode text UNIQUE,
  name text NOT NULL,
  description text,
  category_id uuid REFERENCES categories(id) ON DELETE SET NULL,
  unit text DEFAULT 'pcs',
  purchase_price numeric NOT NULL CHECK (purchase_price >= 0),
  sale_price numeric NOT NULL CHECK (sale_price >= 0),
  current_stock numeric DEFAULT 0 CHECK (current_stock >= 0),
  min_stock_level numeric DEFAULT 0 CHECK (min_stock_level >= 0),
  image_url text,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- ============================================================================
-- 5. CUSTOMERS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  phone text UNIQUE,
  email text,
  address text,
  type text DEFAULT 'individual' CHECK (type IN ('individual', 'company')),
  company_name text,
  tax_number text UNIQUE,
  credit_limit numeric DEFAULT 0 CHECK (credit_limit >= 0),
  allow_debt boolean DEFAULT false,
  balance numeric DEFAULT 0,
  total_sales numeric DEFAULT 0 CHECK (total_sales >= 0),
  total_orders integer DEFAULT 0 CHECK (total_orders >= 0),
  last_order_date timestamptz,
  status text DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  notes text,
  bonus_points numeric DEFAULT 0 CHECK (bonus_points >= 0),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- ============================================================================
-- 6. SHIFTS TABLE (Required for orders)
-- ============================================================================

CREATE TABLE IF NOT EXISTS shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_number text UNIQUE NOT NULL,
  cashier_id uuid REFERENCES profiles(id) NOT NULL,
  opened_at timestamptz NOT NULL,
  closed_at timestamptz,
  opening_cash numeric NOT NULL CHECK (opening_cash >= 0),
  closing_cash numeric CHECK (closing_cash >= 0),
  expected_cash numeric CHECK (expected_cash >= 0),
  cash_difference numeric,
  status text DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  notes text,
  created_at timestamptz DEFAULT now()
);

-- ============================================================================
-- 7. ORDERS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number text UNIQUE NOT NULL,
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  cashier_id uuid REFERENCES profiles(id) NOT NULL,
  shift_id uuid REFERENCES shifts(id) ON DELETE SET NULL,
  subtotal numeric NOT NULL CHECK (subtotal >= 0),
  discount_amount numeric DEFAULT 0 CHECK (discount_amount >= 0),
  discount_percent numeric DEFAULT 0 CHECK (discount_percent >= 0 AND discount_percent <= 100),
  tax_amount numeric DEFAULT 0 CHECK (tax_amount >= 0),
  total_amount numeric NOT NULL CHECK (total_amount >= 0),
  paid_amount numeric DEFAULT 0 CHECK (paid_amount >= 0),
  credit_amount numeric DEFAULT 0 CHECK (credit_amount >= 0),
  change_amount numeric DEFAULT 0 CHECK (change_amount >= 0),
  status text DEFAULT 'completed' CHECK (status IN ('hold', 'completed', 'returned')),
  payment_status text DEFAULT 'paid' CHECK (payment_status IN ('pending', 'partial', 'paid', 'on_credit', 'partially_paid')),
  notes text,
  created_at timestamptz DEFAULT now()
);

-- ============================================================================
-- 8. ORDER_ITEMS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid REFERENCES orders(id) ON DELETE CASCADE NOT NULL,
  product_id uuid REFERENCES products(id) NOT NULL,
  product_name text NOT NULL,
  quantity numeric NOT NULL CHECK (quantity > 0),
  unit_price numeric NOT NULL CHECK (unit_price >= 0),
  subtotal numeric NOT NULL CHECK (subtotal >= 0),
  discount_amount numeric DEFAULT 0 CHECK (discount_amount >= 0),
  total numeric NOT NULL CHECK (total >= 0),
  created_at timestamptz DEFAULT now()
);

-- ============================================================================
-- 9. PAYMENTS TABLE (CRUCIAL FIX: Payment Method Constraint)
-- ============================================================================

CREATE TABLE IF NOT EXISTS payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_number text UNIQUE NOT NULL,
  order_id uuid REFERENCES orders(id) ON DELETE CASCADE NOT NULL,
  payment_method text NOT NULL,
  amount numeric NOT NULL CHECK (amount >= 0),
  reference_number text,
  notes text,
  created_at timestamptz DEFAULT now()
);

-- Add CHECK constraint for payment_method to allow all required values
ALTER TABLE payments 
DROP CONSTRAINT IF EXISTS payments_payment_method_check;

ALTER TABLE payments 
ADD CONSTRAINT payments_payment_method_check 
CHECK (payment_method IN (
  'cash',      -- Cash payment
  'card',      -- Card payment
  'qr',        -- QR payment
  'credit',    -- Credit sale (Nasiya)
  'Nasiya',    -- Credit sale (Uzbek)
  'mixed',     -- Mixed payment methods
  'terminal',  -- Terminal payment
  'other'      -- Other payment method
));

-- ============================================================================
-- 10. CUSTOMER_PAYMENTS TABLE (For debt repayment)
-- ============================================================================

CREATE TABLE IF NOT EXISTS customer_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_number text UNIQUE NOT NULL,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  amount numeric NOT NULL CHECK (amount > 0),
  payment_method text NOT NULL CHECK (payment_method IN ('cash', 'card', 'qr')),
  reference_number text,
  notes text,
  received_by uuid REFERENCES profiles(id),
  created_at timestamptz DEFAULT now()
);

-- ============================================================================
-- 11. INDEXES FOR PERFORMANCE
-- ============================================================================

-- Products indexes
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode) WHERE barcode IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
CREATE INDEX IF NOT EXISTS idx_products_stock ON products(current_stock);
CREATE INDEX IF NOT EXISTS idx_products_active ON products(is_active);

-- Customers indexes
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone) WHERE phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_customers_status ON customers(status);
CREATE INDEX IF NOT EXISTS idx_customers_balance ON customers(balance);

-- Orders indexes
CREATE INDEX IF NOT EXISTS idx_orders_cashier ON orders(cashier_id);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_shift ON orders(shift_id) WHERE shift_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_payment_status ON orders(payment_status);
CREATE INDEX IF NOT EXISTS idx_orders_order_number ON orders(order_number);

-- Order items indexes
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product ON order_items(product_id);

-- Payments indexes
CREATE INDEX IF NOT EXISTS idx_payments_order ON payments(order_id);
CREATE INDEX IF NOT EXISTS idx_payments_method ON payments(payment_method);
CREATE INDEX IF NOT EXISTS idx_payments_created ON payments(created_at DESC);

-- Customer payments indexes
CREATE INDEX IF NOT EXISTS idx_customer_payments_customer ON customer_payments(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_payments_created ON customer_payments(created_at DESC);

-- Shifts indexes
CREATE INDEX IF NOT EXISTS idx_shifts_cashier ON shifts(cashier_id);
CREATE INDEX IF NOT EXISTS idx_shifts_status ON shifts(status);
CREATE INDEX IF NOT EXISTS idx_shifts_opened ON shifts(opened_at DESC);

-- ============================================================================
-- 12. HELPER FUNCTIONS
-- ============================================================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for products updated_at
DROP TRIGGER IF EXISTS update_products_updated_at ON products;
CREATE TRIGGER update_products_updated_at
  BEFORE UPDATE ON products
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Trigger for customers updated_at
DROP TRIGGER IF EXISTS update_customers_updated_at ON customers;
CREATE TRIGGER update_customers_updated_at
  BEFORE UPDATE ON customers
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Trigger for profiles updated_at
DROP TRIGGER IF EXISTS update_profiles_updated_at ON profiles;
CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- 13. COMMENTS FOR DOCUMENTATION
-- ============================================================================

COMMENT ON TABLE products IS 'Product catalog with inventory tracking';
COMMENT ON TABLE customers IS 'Customer management with credit/debt tracking';
COMMENT ON TABLE orders IS 'Sales orders/receipts';
COMMENT ON TABLE order_items IS 'Line items for each order';
COMMENT ON TABLE payments IS 'Payment records for orders (supports split payments and credit)';
COMMENT ON TABLE customer_payments IS 'Payment history for customer debt payments';
COMMENT ON TABLE shifts IS 'Cashier shift tracking';
COMMENT ON TABLE categories IS 'Product categories for organization';
COMMENT ON TABLE profiles IS 'User profiles with role-based access control';

COMMENT ON COLUMN products.current_stock IS 'Current available stock quantity';
COMMENT ON COLUMN products.min_stock_level IS 'Minimum stock level for low stock alerts';
COMMENT ON COLUMN customers.balance IS 'Current balance (positive = customer owes store, negative = store owes customer)';
COMMENT ON COLUMN customers.credit_limit IS 'Maximum allowed debt (0 = no limit)';
COMMENT ON COLUMN customers.allow_debt IS 'Whether customer can purchase on credit';
COMMENT ON COLUMN orders.credit_amount IS 'Amount sold on credit (added to customer balance)';
COMMENT ON COLUMN orders.payment_status IS 'Payment status: pending, partial, paid, on_credit, partially_paid';
COMMENT ON COLUMN payments.payment_method IS 'Payment method: cash, card, qr, credit/Nasiya, mixed, terminal, other';

-- ============================================================================
-- COMPLETION MESSAGE
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '========================================';
  RAISE NOTICE 'DATABASE SCHEMA CREATED SUCCESSFULLY';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Tables created:';
  RAISE NOTICE '  - profiles';
  RAISE NOTICE '  - categories';
  RAISE NOTICE '  - products';
  RAISE NOTICE '  - customers';
  RAISE NOTICE '  - shifts';
  RAISE NOTICE '  - orders';
  RAISE NOTICE '  - order_items';
  RAISE NOTICE '  - payments (with payment_method constraint)';
  RAISE NOTICE '  - customer_payments';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Payment methods supported:';
  RAISE NOTICE '  - cash, card, qr, credit, Nasiya, mixed, terminal, other';
  RAISE NOTICE '========================================';
END $$;


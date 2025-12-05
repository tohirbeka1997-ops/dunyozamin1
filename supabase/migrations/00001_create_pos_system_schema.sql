/*
# POS System Database Schema

## 1. Overview
This migration creates the complete database structure for a professional POS (Point of Sale) system.
It includes user management, product catalog, inventory tracking, sales orders, customer management,
and comprehensive reporting capabilities.

## 2. Tables

### 2.1 profiles
User profiles with role-based access control.
- `id` (uuid, primary key, references auth.users)
- `username` (text, unique, not null)
- `full_name` (text)
- `role` (user_role enum: 'admin', 'manager', 'cashier', default: 'cashier')
- `is_active` (boolean, default: true)
- `created_at` (timestamptz, default: now())

### 2.2 categories
Product categories for organization.
- `id` (uuid, primary key)
- `name` (text, unique, not null)
- `description` (text)
- `created_at` (timestamptz, default: now())

### 2.3 suppliers
Suppliers for purchase orders.
- `id` (uuid, primary key)
- `name` (text, not null)
- `contact_person` (text)
- `phone` (text)
- `email` (text)
- `address` (text)
- `created_at` (timestamptz, default: now())

### 2.4 products
Product catalog with inventory tracking.
- `id` (uuid, primary key)
- `sku` (text, unique, not null) - Auto-generated format: SKU-YYYYMMDD-####
- `barcode` (text, unique)
- `name` (text, not null)
- `description` (text)
- `category_id` (uuid, references categories)
- `unit` (text, default: 'pcs') - Unit of measurement
- `purchase_price` (numeric, not null)
- `sale_price` (numeric, not null)
- `current_stock` (numeric, default: 0)
- `min_stock_level` (numeric, default: 0)
- `image_url` (text)
- `is_active` (boolean, default: true)
- `created_at` (timestamptz, default: now())
- `updated_at` (timestamptz, default: now())

### 2.5 customers
Customer management with bonus and debt tracking.
- `id` (uuid, primary key)
- `name` (text, not null)
- `phone` (text, unique)
- `email` (text)
- `address` (text)
- `bonus_points` (numeric, default: 0)
- `debt_balance` (numeric, default: 0)
- `created_at` (timestamptz, default: now())

### 2.6 shifts
Cashier shift tracking for Z/X reports.
- `id` (uuid, primary key)
- `shift_number` (text, unique, not null) - Format: SHIFT-YYYY-#####
- `cashier_id` (uuid, references profiles, not null)
- `opened_at` (timestamptz, not null)
- `closed_at` (timestamptz)
- `opening_cash` (numeric, not null)
- `closing_cash` (numeric)
- `expected_cash` (numeric)
- `cash_difference` (numeric)
- `status` (text, default: 'open') - open, closed
- `notes` (text)

### 2.7 orders
Sales orders/receipts.
- `id` (uuid, primary key)
- `order_number` (text, unique, not null) - Format: POS-YYYY-######
- `customer_id` (uuid, references customers)
- `cashier_id` (uuid, references profiles, not null)
- `shift_id` (uuid, references shifts)
- `subtotal` (numeric, not null)
- `discount_amount` (numeric, default: 0)
- `discount_percent` (numeric, default: 0)
- `tax_amount` (numeric, default: 0)
- `total_amount` (numeric, not null)
- `paid_amount` (numeric, default: 0)
- `change_amount` (numeric, default: 0)
- `status` (text, default: 'completed') - hold, completed, returned
- `payment_status` (text, default: 'paid') - pending, partial, paid
- `notes` (text)
- `created_at` (timestamptz, default: now())

### 2.8 order_items
Line items for each order.
- `id` (uuid, primary key)
- `order_id` (uuid, references orders, not null)
- `product_id` (uuid, references products, not null)
- `product_name` (text, not null) - Snapshot of product name
- `quantity` (numeric, not null)
- `unit_price` (numeric, not null)
- `subtotal` (numeric, not null)
- `discount_amount` (numeric, default: 0)
- `total` (numeric, not null)

### 2.9 payments
Payment records for orders (supports split payments).
- `id` (uuid, primary key)
- `payment_number` (text, unique, not null) - Format: PAY-YYYY-######
- `order_id` (uuid, references orders, not null)
- `payment_method` (text, not null) - cash, card, terminal, qr, mixed
- `amount` (numeric, not null)
- `reference_number` (text) - For card/terminal transactions
- `notes` (text)
- `created_at` (timestamptz, default: now())

### 2.10 sales_returns
Sales return records.
- `id` (uuid, primary key)
- `return_number` (text, unique, not null) - Format: RET-YYYY-#####
- `order_id` (uuid, references orders, not null)
- `customer_id` (uuid, references customers)
- `cashier_id` (uuid, references profiles, not null)
- `total_amount` (numeric, not null)
- `refund_method` (text, not null) - cash, card, credit
- `reason` (text)
- `created_at` (timestamptz, default: now())

### 2.11 sales_return_items
Line items for sales returns.
- `id` (uuid, primary key)
- `return_id` (uuid, references sales_returns, not null)
- `product_id` (uuid, references products, not null)
- `product_name` (text, not null)
- `quantity` (numeric, not null)
- `unit_price` (numeric, not null)
- `total` (numeric, not null)

### 2.12 inventory_movements
Track all inventory changes.
- `id` (uuid, primary key)
- `movement_number` (text, unique, not null) - Format: INV-YYYY-######
- `product_id` (uuid, references products, not null)
- `movement_type` (text, not null) - purchase, sale, return, adjustment, audit
- `quantity` (numeric, not null) - Positive for increase, negative for decrease
- `reference_type` (text) - order, return, purchase_order, audit
- `reference_id` (uuid) - ID of related record
- `notes` (text)
- `created_by` (uuid, references profiles)
- `created_at` (timestamptz, default: now())

### 2.13 purchase_orders
Purchase orders for receiving goods.
- `id` (uuid, primary key)
- `po_number` (text, unique, not null) - Format: PRC-YYYY-#####
- `supplier_id` (uuid, references suppliers, not null)
- `total_amount` (numeric, not null)
- `status` (text, default: 'completed') - pending, completed
- `invoice_number` (text)
- `received_by` (uuid, references profiles, not null)
- `notes` (text)
- `created_at` (timestamptz, default: now())

### 2.14 purchase_order_items
Line items for purchase orders.
- `id` (uuid, primary key)
- `purchase_order_id` (uuid, references purchase_orders, not null)
- `product_id` (uuid, references products, not null)
- `product_name` (text, not null)
- `quantity` (numeric, not null)
- `unit_price` (numeric, not null)
- `total` (numeric, not null)

## 3. Security
- RLS is disabled on all tables for maximum flexibility
- Access control is managed through application-level role checks
- Admin users have full access to all features
- Managers can perform most operations except user management
- Cashiers have limited access to POS terminal and basic operations

## 4. Helper Functions
- `is_admin(uid uuid)` - Check if user is admin
- `is_manager_or_above(uid uuid)` - Check if user is manager or admin
- `generate_order_number()` - Generate unique order numbers
- `generate_sku()` - Generate unique SKU codes
- `update_product_stock()` - Trigger to update stock on inventory movements

## 5. Notes
- First registered user automatically becomes admin
- All monetary values use numeric type for precision
- Timestamps use timestamptz for timezone awareness
- Unique constraints ensure data integrity
- Foreign keys maintain referential integrity
*/

-- Create ENUM types
CREATE TYPE user_role AS ENUM ('admin', 'manager', 'cashier');

-- Create profiles table
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username text UNIQUE NOT NULL,
  full_name text,
  role user_role DEFAULT 'cashier'::user_role NOT NULL,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- Create categories table
CREATE TABLE IF NOT EXISTS categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE NOT NULL,
  description text,
  created_at timestamptz DEFAULT now()
);

-- Create suppliers table
CREATE TABLE IF NOT EXISTS suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  contact_person text,
  phone text,
  email text,
  address text,
  created_at timestamptz DEFAULT now()
);

-- Create products table
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

-- Create customers table
CREATE TABLE IF NOT EXISTS customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  phone text UNIQUE,
  email text,
  address text,
  bonus_points numeric DEFAULT 0 CHECK (bonus_points >= 0),
  debt_balance numeric DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- Create shifts table
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
  notes text
);

-- Create orders table
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
  change_amount numeric DEFAULT 0 CHECK (change_amount >= 0),
  status text DEFAULT 'completed' CHECK (status IN ('hold', 'completed', 'returned')),
  payment_status text DEFAULT 'paid' CHECK (payment_status IN ('pending', 'partial', 'paid')),
  notes text,
  created_at timestamptz DEFAULT now()
);

-- Create order_items table
CREATE TABLE IF NOT EXISTS order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid REFERENCES orders(id) ON DELETE CASCADE NOT NULL,
  product_id uuid REFERENCES products(id) NOT NULL,
  product_name text NOT NULL,
  quantity numeric NOT NULL CHECK (quantity > 0),
  unit_price numeric NOT NULL CHECK (unit_price >= 0),
  subtotal numeric NOT NULL CHECK (subtotal >= 0),
  discount_amount numeric DEFAULT 0 CHECK (discount_amount >= 0),
  total numeric NOT NULL CHECK (total >= 0)
);

-- Create payments table
CREATE TABLE IF NOT EXISTS payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_number text UNIQUE NOT NULL,
  order_id uuid REFERENCES orders(id) ON DELETE CASCADE NOT NULL,
  payment_method text NOT NULL CHECK (payment_method IN ('cash', 'card', 'terminal', 'qr', 'mixed')),
  amount numeric NOT NULL CHECK (amount >= 0),
  reference_number text,
  notes text,
  created_at timestamptz DEFAULT now()
);

-- Create sales_returns table
CREATE TABLE IF NOT EXISTS sales_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  return_number text UNIQUE NOT NULL,
  order_id uuid REFERENCES orders(id) NOT NULL,
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  cashier_id uuid REFERENCES profiles(id) NOT NULL,
  total_amount numeric NOT NULL CHECK (total_amount >= 0),
  refund_method text NOT NULL CHECK (refund_method IN ('cash', 'card', 'credit')),
  reason text,
  created_at timestamptz DEFAULT now()
);

-- Create sales_return_items table
CREATE TABLE IF NOT EXISTS sales_return_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id uuid REFERENCES sales_returns(id) ON DELETE CASCADE NOT NULL,
  product_id uuid REFERENCES products(id) NOT NULL,
  product_name text NOT NULL,
  quantity numeric NOT NULL CHECK (quantity > 0),
  unit_price numeric NOT NULL CHECK (unit_price >= 0),
  total numeric NOT NULL CHECK (total >= 0)
);

-- Create inventory_movements table
CREATE TABLE IF NOT EXISTS inventory_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  movement_number text UNIQUE NOT NULL,
  product_id uuid REFERENCES products(id) ON DELETE CASCADE NOT NULL,
  movement_type text NOT NULL CHECK (movement_type IN ('purchase', 'sale', 'return', 'adjustment', 'audit')),
  quantity numeric NOT NULL,
  reference_type text,
  reference_id uuid,
  notes text,
  created_by uuid REFERENCES profiles(id),
  created_at timestamptz DEFAULT now()
);

-- Create purchase_orders table
CREATE TABLE IF NOT EXISTS purchase_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  po_number text UNIQUE NOT NULL,
  supplier_id uuid REFERENCES suppliers(id) NOT NULL,
  total_amount numeric NOT NULL CHECK (total_amount >= 0),
  status text DEFAULT 'completed' CHECK (status IN ('pending', 'completed')),
  invoice_number text,
  received_by uuid REFERENCES profiles(id) NOT NULL,
  notes text,
  created_at timestamptz DEFAULT now()
);

-- Create purchase_order_items table
CREATE TABLE IF NOT EXISTS purchase_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id uuid REFERENCES purchase_orders(id) ON DELETE CASCADE NOT NULL,
  product_id uuid REFERENCES products(id) NOT NULL,
  product_name text NOT NULL,
  quantity numeric NOT NULL CHECK (quantity > 0),
  unit_price numeric NOT NULL CHECK (unit_price >= 0),
  total numeric NOT NULL CHECK (total >= 0)
);

-- Create indexes for better query performance
CREATE INDEX idx_products_category ON products(category_id);
CREATE INDEX idx_products_barcode ON products(barcode);
CREATE INDEX idx_products_sku ON products(sku);
CREATE INDEX idx_products_stock ON products(current_stock);
CREATE INDEX idx_orders_cashier ON orders(cashier_id);
CREATE INDEX idx_orders_customer ON orders(customer_id);
CREATE INDEX idx_orders_created ON orders(created_at DESC);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_order_items_order ON order_items(order_id);
CREATE INDEX idx_order_items_product ON order_items(product_id);
CREATE INDEX idx_payments_order ON payments(order_id);
CREATE INDEX idx_inventory_movements_product ON inventory_movements(product_id);
CREATE INDEX idx_inventory_movements_created ON inventory_movements(created_at DESC);
CREATE INDEX idx_shifts_cashier ON shifts(cashier_id);
CREATE INDEX idx_shifts_status ON shifts(status);

-- Helper function to check if user is admin
CREATE OR REPLACE FUNCTION is_admin(uid uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = uid AND role = 'admin'::user_role
  );
$$;

-- Helper function to check if user is manager or above
CREATE OR REPLACE FUNCTION is_manager_or_above(uid uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = uid AND role IN ('admin'::user_role, 'manager'::user_role)
  );
$$;

-- Function to generate order number
CREATE OR REPLACE FUNCTION generate_order_number()
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  next_num integer;
  year_str text;
BEGIN
  year_str := to_char(now(), 'YYYY');
  SELECT COALESCE(MAX(CAST(SUBSTRING(order_number FROM 10) AS integer)), 0) + 1
  INTO next_num
  FROM orders
  WHERE order_number LIKE 'POS-' || year_str || '-%';
  
  RETURN 'POS-' || year_str || '-' || LPAD(next_num::text, 6, '0');
END;
$$;

-- Function to generate SKU
CREATE OR REPLACE FUNCTION generate_sku()
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  next_num integer;
  date_str text;
BEGIN
  date_str := to_char(now(), 'YYYYMMDD');
  SELECT COALESCE(MAX(CAST(SUBSTRING(sku FROM 14) AS integer)), 0) + 1
  INTO next_num
  FROM products
  WHERE sku LIKE 'SKU-' || date_str || '-%';
  
  RETURN 'SKU-' || date_str || '-' || LPAD(next_num::text, 4, '0');
END;
$$;

-- Function to generate payment number
CREATE OR REPLACE FUNCTION generate_payment_number()
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  next_num integer;
  year_str text;
BEGIN
  year_str := to_char(now(), 'YYYY');
  SELECT COALESCE(MAX(CAST(SUBSTRING(payment_number FROM 10) AS integer)), 0) + 1
  INTO next_num
  FROM payments
  WHERE payment_number LIKE 'PAY-' || year_str || '-%';
  
  RETURN 'PAY-' || year_str || '-' || LPAD(next_num::text, 6, '0');
END;
$$;

-- Function to generate return number
CREATE OR REPLACE FUNCTION generate_return_number()
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  next_num integer;
  year_str text;
BEGIN
  year_str := to_char(now(), 'YYYY');
  SELECT COALESCE(MAX(CAST(SUBSTRING(return_number FROM 10) AS integer)), 0) + 1
  INTO next_num
  FROM sales_returns
  WHERE return_number LIKE 'RET-' || year_str || '-%';
  
  RETURN 'RET-' || year_str || '-' || LPAD(next_num::text, 5, '0');
END;
$$;

-- Function to generate PO number
CREATE OR REPLACE FUNCTION generate_po_number()
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  next_num integer;
  year_str text;
BEGIN
  year_str := to_char(now(), 'YYYY');
  SELECT COALESCE(MAX(CAST(SUBSTRING(po_number FROM 10) AS integer)), 0) + 1
  INTO next_num
  FROM purchase_orders
  WHERE po_number LIKE 'PRC-' || year_str || '-%';
  
  RETURN 'PRC-' || year_str || '-' || LPAD(next_num::text, 5, '0');
END;
$$;

-- Function to generate shift number
CREATE OR REPLACE FUNCTION generate_shift_number()
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  next_num integer;
  year_str text;
BEGIN
  year_str := to_char(now(), 'YYYY');
  SELECT COALESCE(MAX(CAST(SUBSTRING(shift_number FROM 12) AS integer)), 0) + 1
  INTO next_num
  FROM shifts
  WHERE shift_number LIKE 'SHIFT-' || year_str || '-%';
  
  RETURN 'SHIFT-' || year_str || '-' || LPAD(next_num::text, 5, '0');
END;
$$;

-- Function to generate inventory movement number
CREATE OR REPLACE FUNCTION generate_movement_number()
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  next_num integer;
  year_str text;
BEGIN
  year_str := to_char(now(), 'YYYY');
  SELECT COALESCE(MAX(CAST(SUBSTRING(movement_number FROM 10) AS integer)), 0) + 1
  INTO next_num
  FROM inventory_movements
  WHERE movement_number LIKE 'INV-' || year_str || '-%';
  
  RETURN 'INV-' || year_str || '-' || LPAD(next_num::text, 6, '0');
END;
$$;

-- Trigger function to update product stock on inventory movements
CREATE OR REPLACE FUNCTION update_product_stock()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE products
  SET current_stock = current_stock + NEW.quantity,
      updated_at = now()
  WHERE id = NEW.product_id;
  
  RETURN NEW;
END;
$$;

-- Create trigger for inventory movements
DROP TRIGGER IF EXISTS trigger_update_product_stock ON inventory_movements;
CREATE TRIGGER trigger_update_product_stock
  AFTER INSERT ON inventory_movements
  FOR EACH ROW
  EXECUTE FUNCTION update_product_stock();

-- Trigger function to update products updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Create trigger for products
DROP TRIGGER IF EXISTS trigger_products_updated_at ON products;
CREATE TRIGGER trigger_products_updated_at
  BEFORE UPDATE ON products
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- Authentication trigger function
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  user_count int;
BEGIN
  SELECT COUNT(*) INTO user_count FROM profiles;
  
  INSERT INTO profiles (id, username, role)
  VALUES (
    NEW.id,
    SPLIT_PART(NEW.email, '@', 1),
    CASE WHEN user_count = 0 THEN 'admin'::user_role ELSE 'cashier'::user_role END
  );
  
  RETURN NEW;
END;
$$;

-- Create authentication trigger
DROP TRIGGER IF EXISTS on_auth_user_confirmed ON auth.users;
CREATE TRIGGER on_auth_user_confirmed
  AFTER UPDATE ON auth.users
  FOR EACH ROW
  WHEN (OLD.confirmed_at IS NULL AND NEW.confirmed_at IS NOT NULL)
  EXECUTE FUNCTION handle_new_user();
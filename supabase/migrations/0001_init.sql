CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

DO $$ BEGIN
  CREATE TYPE store_role AS ENUM ('owner', 'admin', 'manager', 'cashier');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE order_status AS ENUM ('hold', 'completed', 'returned', 'cancelled');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE payment_status AS ENUM ('pending', 'partial', 'paid', 'on_credit', 'partially_paid');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE payment_method AS ENUM ('cash', 'card', 'terminal', 'qr', 'mixed', 'credit');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE refund_method AS ENUM ('cash', 'card', 'credit');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE movement_type AS ENUM ('purchase', 'sale', 'return', 'adjustment', 'audit', 'sale_return_in', 'purchase_return_out');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE shift_status AS ENUM ('open', 'closed');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE purchase_order_status AS ENUM ('draft', 'approved', 'partially_received', 'received', 'cancelled');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE customer_type AS ENUM ('individual', 'company');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE supplier_payment_method AS ENUM ('cash', 'card', 'transfer', 'click', 'payme', 'uzum');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE expense_category AS ENUM ('Ijara', 'Oylik maosh', 'Kommunal', 'Transport', 'Soliq', 'Marketing', 'Boshqa');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE expense_payment_method AS ENUM ('cash', 'card', 'bank_transfer', 'other');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE expense_status AS ENUM ('approved', 'pending');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS stores (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name text NOT NULL,
  legal_name text,
  address_country text,
  address_city text,
  address_street text,
  phone text,
  email text,
  website text,
  tax_id text,
  logo_url text,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS store_members (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role store_role NOT NULL DEFAULT 'cashier',
  is_active boolean DEFAULT true,
  joined_at timestamptz DEFAULT now(),
  UNIQUE(store_id, user_id)
);

CREATE TABLE IF NOT EXISTS locations (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  name text NOT NULL,
  address text,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'profiles') THEN
    CREATE TABLE profiles (
      id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
      username text UNIQUE NOT NULL,
      full_name text,
      phone text,
      email text,
      role text DEFAULT 'cashier',
      is_active boolean DEFAULT true,
      last_login timestamptz,
      created_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now()
    );
  ELSE
    ALTER TABLE profiles ADD COLUMN IF NOT EXISTS username text;
    ALTER TABLE profiles ADD COLUMN IF NOT EXISTS full_name text;
    ALTER TABLE profiles ADD COLUMN IF NOT EXISTS phone text;
    ALTER TABLE profiles ADD COLUMN IF NOT EXISTS email text;
    ALTER TABLE profiles ADD COLUMN IF NOT EXISTS role text DEFAULT 'cashier';
    ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true;
    ALTER TABLE profiles ADD COLUMN IF NOT EXISTS last_login timestamptz;
    ALTER TABLE profiles ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
    ALTER TABLE profiles ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'categories') THEN
    CREATE TABLE categories (
      id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
      store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      name text NOT NULL,
      description text,
      color text,
      icon text,
      parent_id uuid REFERENCES categories(id) ON DELETE SET NULL,
      created_at timestamptz DEFAULT now(),
      UNIQUE(store_id, name)
    );
  ELSE
    ALTER TABLE categories ADD COLUMN IF NOT EXISTS store_id uuid REFERENCES stores(id) ON DELETE CASCADE;
    ALTER TABLE categories ADD COLUMN IF NOT EXISTS description text;
    ALTER TABLE categories ADD COLUMN IF NOT EXISTS color text;
    ALTER TABLE categories ADD COLUMN IF NOT EXISTS icon text;
    ALTER TABLE categories ADD COLUMN IF NOT EXISTS parent_id uuid REFERENCES categories(id) ON DELETE SET NULL;
    ALTER TABLE categories ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS products (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  sku text NOT NULL,
  barcode text,
  name text NOT NULL,
  description text,
  category_id uuid REFERENCES categories(id) ON DELETE SET NULL,
  unit text DEFAULT 'pcs',
  purchase_price numeric(18,2) NOT NULL DEFAULT 0,
  sale_price numeric(18,2) NOT NULL DEFAULT 0,
  min_stock_level numeric(18,3) DEFAULT 0,
  image_url text,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(store_id, sku)
);

CREATE TABLE IF NOT EXISTS inventory_movements (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  location_id uuid REFERENCES locations(id) ON DELETE SET NULL,
  movement_number text NOT NULL,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  movement_type movement_type NOT NULL,
  quantity numeric(18,3) NOT NULL,
  before_quantity numeric(18,3) NOT NULL,
  after_quantity numeric(18,3) NOT NULL,
  reference_type text,
  reference_id uuid,
  reason text,
  notes text,
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(store_id, movement_number)
);

CREATE TABLE IF NOT EXISTS inventory_balances (
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  quantity numeric(18,3) NOT NULL DEFAULT 0,
  last_movement_at timestamptz,
  PRIMARY KEY (store_id, product_id, location_id)
);

CREATE TABLE IF NOT EXISTS customers (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  name text NOT NULL,
  phone text,
  email text,
  address text,
  type customer_type DEFAULT 'individual',
  company_name text,
  tax_number text,
  credit_limit numeric(18,2) DEFAULT 0,
  allow_debt boolean DEFAULT false,
  balance numeric(18,2) DEFAULT 0,
  total_sales numeric(18,2) DEFAULT 0,
  total_orders integer DEFAULT 0,
  last_order_date timestamptz,
  status text DEFAULT 'active',
  notes text,
  bonus_points numeric(18,2) DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS customer_payments (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  payment_number text NOT NULL,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  amount numeric(18,2) NOT NULL,
  payment_method payment_method NOT NULL,
  reference_number text,
  notes text,
  received_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(store_id, payment_number)
);

CREATE TABLE IF NOT EXISTS suppliers (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  name text NOT NULL,
  contact_person text,
  phone text,
  email text,
  address text,
  note text,
  status text DEFAULT 'active',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS supplier_payments (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  payment_number text NOT NULL,
  supplier_id uuid NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  purchase_order_id uuid,
  amount numeric(18,2) NOT NULL,
  payment_method supplier_payment_method NOT NULL,
  paid_at timestamptz NOT NULL,
  note text,
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(store_id, payment_number)
);

CREATE TABLE IF NOT EXISTS shifts (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  location_id uuid REFERENCES locations(id) ON DELETE SET NULL,
  shift_number text NOT NULL,
  cashier_id uuid NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  opened_at timestamptz NOT NULL,
  closed_at timestamptz,
  opening_cash numeric(18,2) NOT NULL DEFAULT 0,
  closing_cash numeric(18,2),
  expected_cash numeric(18,2),
  cash_difference numeric(18,2),
  status shift_status DEFAULT 'open',
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(store_id, shift_number)
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'orders') THEN
    CREATE TABLE orders (
      id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
      store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      location_id uuid REFERENCES locations(id) ON DELETE SET NULL,
      order_number text NOT NULL,
      customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
      cashier_id uuid NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
      shift_id uuid REFERENCES shifts(id) ON DELETE SET NULL,
      subtotal numeric(18,2) NOT NULL DEFAULT 0,
      discount_amount numeric(18,2) DEFAULT 0,
      discount_percent numeric(18,2) DEFAULT 0,
      tax_amount numeric(18,2) DEFAULT 0,
      total_amount numeric(18,2) NOT NULL,
      paid_amount numeric(18,2) DEFAULT 0,
      credit_amount numeric(18,2) DEFAULT 0,
      change_amount numeric(18,2) DEFAULT 0,
      status order_status DEFAULT 'completed',
      payment_status payment_status DEFAULT 'paid',
      notes text,
      created_at timestamptz DEFAULT now(),
      UNIQUE(store_id, order_number)
    );
  ELSE
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS store_id uuid REFERENCES stores(id) ON DELETE CASCADE;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES locations(id) ON DELETE SET NULL;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_number text;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES customers(id) ON DELETE SET NULL;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS cashier_id uuid REFERENCES profiles(id) ON DELETE RESTRICT;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS shift_id uuid REFERENCES shifts(id) ON DELETE SET NULL;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS subtotal numeric(18,2) DEFAULT 0;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_amount numeric(18,2) DEFAULT 0;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_percent numeric(18,2) DEFAULT 0;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS tax_amount numeric(18,2) DEFAULT 0;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS total_amount numeric(18,2);
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS paid_amount numeric(18,2) DEFAULT 0;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS credit_amount numeric(18,2) DEFAULT 0;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS change_amount numeric(18,2) DEFAULT 0;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS status order_status DEFAULT 'completed';
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_status payment_status DEFAULT 'paid';
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS notes text;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'order_items') THEN
    CREATE TABLE order_items (
      id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
      order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      product_id uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
      product_name text NOT NULL,
      quantity numeric(18,3) NOT NULL,
      unit_price numeric(18,2) NOT NULL,
      subtotal numeric(18,2) NOT NULL,
      discount_amount numeric(18,2) DEFAULT 0,
      total numeric(18,2) NOT NULL
    );
  ELSE
    ALTER TABLE order_items ADD COLUMN IF NOT EXISTS order_id uuid REFERENCES orders(id) ON DELETE CASCADE;
    ALTER TABLE order_items ADD COLUMN IF NOT EXISTS product_id uuid REFERENCES products(id) ON DELETE RESTRICT;
    ALTER TABLE order_items ADD COLUMN IF NOT EXISTS product_name text;
    ALTER TABLE order_items ADD COLUMN IF NOT EXISTS quantity numeric(18,3);
    ALTER TABLE order_items ADD COLUMN IF NOT EXISTS unit_price numeric(18,2);
    ALTER TABLE order_items ADD COLUMN IF NOT EXISTS subtotal numeric(18,2);
    ALTER TABLE order_items ADD COLUMN IF NOT EXISTS discount_amount numeric(18,2) DEFAULT 0;
    ALTER TABLE order_items ADD COLUMN IF NOT EXISTS total numeric(18,2);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS payments (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  payment_number text NOT NULL,
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  payment_method payment_method NOT NULL,
  amount numeric(18,2) NOT NULL,
  reference_number text,
  notes text,
  created_at timestamptz DEFAULT now(),
  UNIQUE(store_id, payment_number)
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'sales_returns') THEN
    CREATE TABLE sales_returns (
      id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
      store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      location_id uuid REFERENCES locations(id) ON DELETE SET NULL,
      return_number text NOT NULL,
      order_id uuid NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
      customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
      cashier_id uuid NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
      total_amount numeric(18,2) NOT NULL,
      refund_method refund_method NOT NULL,
      status text DEFAULT 'completed',
      reason text NOT NULL,
      notes text,
      created_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now(),
      UNIQUE(store_id, return_number)
    );
  ELSE
    ALTER TABLE sales_returns ADD COLUMN IF NOT EXISTS store_id uuid REFERENCES stores(id) ON DELETE CASCADE;
    ALTER TABLE sales_returns ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES locations(id) ON DELETE SET NULL;
    ALTER TABLE sales_returns ADD COLUMN IF NOT EXISTS return_number text;
    ALTER TABLE sales_returns ADD COLUMN IF NOT EXISTS order_id uuid REFERENCES orders(id) ON DELETE RESTRICT;
    ALTER TABLE sales_returns ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES customers(id) ON DELETE SET NULL;
    ALTER TABLE sales_returns ADD COLUMN IF NOT EXISTS cashier_id uuid REFERENCES profiles(id) ON DELETE RESTRICT;
    ALTER TABLE sales_returns ADD COLUMN IF NOT EXISTS total_amount numeric(18,2);
    ALTER TABLE sales_returns ADD COLUMN IF NOT EXISTS refund_method refund_method;
    ALTER TABLE sales_returns ADD COLUMN IF NOT EXISTS status text DEFAULT 'completed';
    ALTER TABLE sales_returns ADD COLUMN IF NOT EXISTS reason text;
    ALTER TABLE sales_returns ADD COLUMN IF NOT EXISTS notes text;
    ALTER TABLE sales_returns ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
    ALTER TABLE sales_returns ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'sales_return_items') THEN
    CREATE TABLE sales_return_items (
      id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
      return_id uuid NOT NULL REFERENCES sales_returns(id) ON DELETE CASCADE,
      product_id uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
      quantity numeric(18,3) NOT NULL,
      unit_price numeric(18,2) NOT NULL,
      line_total numeric(18,2) NOT NULL,
      created_at timestamptz DEFAULT now()
    );
  ELSE
    ALTER TABLE sales_return_items ADD COLUMN IF NOT EXISTS return_id uuid REFERENCES sales_returns(id) ON DELETE CASCADE;
    ALTER TABLE sales_return_items ADD COLUMN IF NOT EXISTS product_id uuid REFERENCES products(id) ON DELETE RESTRICT;
    ALTER TABLE sales_return_items ADD COLUMN IF NOT EXISTS quantity numeric(18,3);
    ALTER TABLE sales_return_items ADD COLUMN IF NOT EXISTS unit_price numeric(18,2);
    ALTER TABLE sales_return_items ADD COLUMN IF NOT EXISTS line_total numeric(18,2);
    ALTER TABLE sales_return_items ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'purchase_orders') THEN
    CREATE TABLE purchase_orders (
      id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
      store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      location_id uuid REFERENCES locations(id) ON DELETE SET NULL,
      po_number text NOT NULL,
      supplier_id uuid REFERENCES suppliers(id) ON DELETE SET NULL,
      supplier_name text,
      order_date date NOT NULL,
      expected_date date,
      reference text,
      subtotal numeric(18,2) NOT NULL DEFAULT 0,
      discount numeric(18,2) DEFAULT 0,
      tax numeric(18,2) DEFAULT 0,
      total_amount numeric(18,2) NOT NULL,
      status purchase_order_status DEFAULT 'draft',
      invoice_number text,
      received_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
      created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
      approved_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
      approved_at timestamptz,
      notes text,
      created_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now(),
      UNIQUE(store_id, po_number)
    );
  ELSE
    ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS store_id uuid REFERENCES stores(id) ON DELETE CASCADE;
    ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES locations(id) ON DELETE SET NULL;
    ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS po_number text;
    ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS supplier_id uuid REFERENCES suppliers(id) ON DELETE SET NULL;
    ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS supplier_name text;
    ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS order_date date;
    ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS expected_date date;
    ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS reference text;
    ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS subtotal numeric(18,2) DEFAULT 0;
    ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS discount numeric(18,2) DEFAULT 0;
    ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS tax numeric(18,2) DEFAULT 0;
    ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS total_amount numeric(18,2);
    ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS status purchase_order_status DEFAULT 'draft';
    ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS invoice_number text;
    ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS received_by uuid REFERENCES profiles(id) ON DELETE SET NULL;
    ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES profiles(id) ON DELETE SET NULL;
    ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES profiles(id) ON DELETE SET NULL;
    ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS approved_at timestamptz;
    ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS notes text;
    ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
    ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'purchase_order_items') THEN
    CREATE TABLE purchase_order_items (
      id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
      purchase_order_id uuid NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
      product_id uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
      product_name text NOT NULL,
      ordered_qty numeric(18,3) NOT NULL,
      received_qty numeric(18,3) DEFAULT 0,
      unit_cost numeric(18,2) NOT NULL,
      line_total numeric(18,2) NOT NULL
    );
  ELSE
    ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS purchase_order_id uuid REFERENCES purchase_orders(id) ON DELETE CASCADE;
    ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS product_id uuid REFERENCES products(id) ON DELETE RESTRICT;
    ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS product_name text;
    ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS ordered_qty numeric(18,3);
    ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS received_qty numeric(18,3) DEFAULT 0;
    ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS unit_cost numeric(18,2);
    ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS line_total numeric(18,2);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS purchase_returns (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  location_id uuid REFERENCES locations(id) ON DELETE SET NULL,
  return_number text NOT NULL,
  purchase_order_id uuid NOT NULL REFERENCES purchase_orders(id) ON DELETE RESTRICT,
  supplier_id uuid REFERENCES suppliers(id) ON DELETE SET NULL,
  total_amount numeric(18,2) NOT NULL,
  reason text NOT NULL,
  notes text,
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(store_id, return_number)
);

CREATE TABLE IF NOT EXISTS purchase_return_items (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  return_id uuid NOT NULL REFERENCES purchase_returns(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  quantity numeric(18,3) NOT NULL,
  unit_cost numeric(18,2) NOT NULL,
  line_total numeric(18,2) NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS expenses (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  expense_number text NOT NULL,
  expense_date date NOT NULL,
  category expense_category NOT NULL,
  amount numeric(18,2) NOT NULL,
  payment_method expense_payment_method NOT NULL,
  note text,
  employee_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  status expense_status DEFAULT 'pending',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(store_id, expense_number)
);

CREATE TABLE IF NOT EXISTS held_orders (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  location_id uuid REFERENCES locations(id) ON DELETE SET NULL,
  held_number text NOT NULL,
  cashier_id uuid NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  shift_id uuid REFERENCES shifts(id) ON DELETE SET NULL,
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  customer_name text,
  items jsonb NOT NULL,
  discount jsonb,
  note text,
  status text DEFAULT 'HELD',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(store_id, held_number)
);

CREATE TABLE IF NOT EXISTS settings (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id uuid REFERENCES stores(id) ON DELETE CASCADE,
  category text NOT NULL,
  key text NOT NULL,
  value jsonb NOT NULL,
  description text,
  updated_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  updated_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  UNIQUE(store_id, category, key)
);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  entry_date timestamptz NOT NULL DEFAULT now(),
  entry_type text NOT NULL,
  reference_type text,
  reference_id uuid,
  debit numeric(18,2) DEFAULT 0,
  credit numeric(18,2) DEFAULT 0,
  balance numeric(18,2),
  description text,
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'fk_supplier_payments_purchase_order'
  ) THEN
    ALTER TABLE supplier_payments
      ADD CONSTRAINT fk_supplier_payments_purchase_order
      FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_store_members_store_id ON store_members(store_id);
CREATE INDEX IF NOT EXISTS idx_store_members_user_id ON store_members(user_id);
CREATE INDEX IF NOT EXISTS idx_store_members_role ON store_members(role);
CREATE INDEX IF NOT EXISTS idx_locations_store_id ON locations(store_id);
CREATE INDEX IF NOT EXISTS idx_categories_store_id ON categories(store_id);
CREATE INDEX IF NOT EXISTS idx_categories_parent_id ON categories(parent_id);
CREATE INDEX IF NOT EXISTS idx_products_store_id ON products(store_id);
CREATE INDEX IF NOT EXISTS idx_products_category_id ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_sku ON products(store_id, sku);
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_barcode_unique ON products(store_id, barcode) WHERE barcode IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_products_name_trgm ON products USING gin(name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_store_id ON inventory_movements(store_id);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_product_id ON inventory_movements(product_id);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_reference ON inventory_movements(reference_type, reference_id);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_created_at ON inventory_movements(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_balances_store_product ON inventory_balances(store_id, product_id);
CREATE INDEX IF NOT EXISTS idx_inventory_balances_location ON inventory_balances(location_id);
CREATE INDEX IF NOT EXISTS idx_customers_store_id ON customers(store_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_phone_unique ON customers(store_id, phone) WHERE phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_customers_name_trgm ON customers USING gin(name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_suppliers_store_id ON suppliers(store_id);
CREATE INDEX IF NOT EXISTS idx_suppliers_name_trgm ON suppliers USING gin(name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_shifts_store_id ON shifts(store_id);
CREATE INDEX IF NOT EXISTS idx_shifts_cashier_id ON shifts(cashier_id);
CREATE INDEX IF NOT EXISTS idx_shifts_status ON shifts(status);
CREATE INDEX IF NOT EXISTS idx_shifts_opened_at ON shifts(opened_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_store_id ON orders(store_id);
CREATE INDEX IF NOT EXISTS idx_orders_customer_id ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_cashier_id ON orders(cashier_id);
CREATE INDEX IF NOT EXISTS idx_orders_shift_id ON orders(shift_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_order_number ON orders(store_id, order_number);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product_id ON order_items(product_id);
CREATE INDEX IF NOT EXISTS idx_payments_store_id ON payments(store_id);
CREATE INDEX IF NOT EXISTS idx_payments_order_id ON payments(order_id);
CREATE INDEX IF NOT EXISTS idx_payments_created_at ON payments(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_returns_store_id ON sales_returns(store_id);
CREATE INDEX IF NOT EXISTS idx_sales_returns_order_id ON sales_returns(order_id);
CREATE INDEX IF NOT EXISTS idx_sales_returns_customer_id ON sales_returns(customer_id);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_store_id ON purchase_orders(store_id);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_supplier_id ON purchase_orders(supplier_id);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_status ON purchase_orders(status);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_order_date ON purchase_orders(order_date DESC);
CREATE INDEX IF NOT EXISTS idx_ledger_store_id ON ledger_entries(store_id);
CREATE INDEX IF NOT EXISTS idx_ledger_entry_date ON ledger_entries(entry_date DESC);
CREATE INDEX IF NOT EXISTS idx_ledger_reference ON ledger_entries(reference_type, reference_id);

CREATE OR REPLACE FUNCTION update_inventory_balance()
RETURNS TRIGGER AS $$
DECLARE
  v_location_id uuid;
BEGIN
  v_location_id := COALESCE(NEW.location_id, (SELECT id FROM locations WHERE store_id = NEW.store_id LIMIT 1));
  IF v_location_id IS NULL THEN
    RAISE EXCEPTION 'location_id is required for inventory movements. Create a location for store % first.', NEW.store_id;
  END IF;
  INSERT INTO inventory_balances (store_id, location_id, product_id, quantity, last_movement_at)
  VALUES (NEW.store_id, v_location_id, NEW.product_id, NEW.after_quantity, NEW.created_at)
  ON CONFLICT (store_id, product_id, location_id)
  DO UPDATE SET quantity = NEW.after_quantity, last_movement_at = NEW.created_at;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_inventory_balance ON inventory_movements;
CREATE TRIGGER trigger_update_inventory_balance
  AFTER INSERT ON inventory_movements
  FOR EACH ROW
  EXECUTE FUNCTION update_inventory_balance();

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_profiles_updated_at ON profiles;
CREATE TRIGGER trigger_profiles_updated_at BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at();
DROP TRIGGER IF EXISTS trigger_stores_updated_at ON stores;
CREATE TRIGGER trigger_stores_updated_at BEFORE UPDATE ON stores FOR EACH ROW EXECUTE FUNCTION update_updated_at();
DROP TRIGGER IF EXISTS trigger_locations_updated_at ON locations;
CREATE TRIGGER trigger_locations_updated_at BEFORE UPDATE ON locations FOR EACH ROW EXECUTE FUNCTION update_updated_at();
DROP TRIGGER IF EXISTS trigger_products_updated_at ON products;
CREATE TRIGGER trigger_products_updated_at BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION update_updated_at();
DROP TRIGGER IF EXISTS trigger_customers_updated_at ON customers;
CREATE TRIGGER trigger_customers_updated_at BEFORE UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION update_updated_at();
DROP TRIGGER IF EXISTS trigger_suppliers_updated_at ON suppliers;
CREATE TRIGGER trigger_suppliers_updated_at BEFORE UPDATE ON suppliers FOR EACH ROW EXECUTE FUNCTION update_updated_at();
DROP TRIGGER IF EXISTS trigger_shifts_updated_at ON shifts;
CREATE TRIGGER trigger_shifts_updated_at BEFORE UPDATE ON shifts FOR EACH ROW EXECUTE FUNCTION update_updated_at();
DROP TRIGGER IF EXISTS trigger_purchase_orders_updated_at ON purchase_orders;
CREATE TRIGGER trigger_purchase_orders_updated_at BEFORE UPDATE ON purchase_orders FOR EACH ROW EXECUTE FUNCTION update_updated_at();
DROP TRIGGER IF EXISTS trigger_sales_returns_updated_at ON sales_returns;
CREATE TRIGGER trigger_sales_returns_updated_at BEFORE UPDATE ON sales_returns FOR EACH ROW EXECUTE FUNCTION update_updated_at();
DROP TRIGGER IF EXISTS trigger_expenses_updated_at ON expenses;
CREATE TRIGGER trigger_expenses_updated_at BEFORE UPDATE ON expenses FOR EACH ROW EXECUTE FUNCTION update_updated_at();
DROP TRIGGER IF EXISTS trigger_held_orders_updated_at ON held_orders;
CREATE TRIGGER trigger_held_orders_updated_at BEFORE UPDATE ON held_orders FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE OR REPLACE FUNCTION get_public_table_names()
RETURNS text[] AS $$
DECLARE
  table_names text[];
BEGIN
  SELECT array_agg(tablename::text)
  INTO table_names
  FROM pg_tables
  WHERE schemaname = 'public'
    AND tablename NOT IN ('_prisma_migrations', 'supabase_migrations', 'schema_migrations');
  RETURN COALESCE(table_names, ARRAY[]::text[]);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION execute_sql(sql_query text)
RETURNS void AS $$
BEGIN
  EXECUTE sql_query;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

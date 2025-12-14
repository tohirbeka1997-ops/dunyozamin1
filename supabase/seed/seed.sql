INSERT INTO stores (
  id, name, legal_name, address_country, address_city, address_street,
  phone, email, is_active
) VALUES (
  '00000000-0000-0000-0000-000000000001'::uuid,
  'Demo Store',
  'Demo Store LLC',
  'Uzbekistan',
  'Tashkent',
  'Amir Temur Avenue 1',
  '+998901234567',
  'demo@store.uz',
  true
) ON CONFLICT DO NOTHING;

INSERT INTO locations (
  id, store_id, name, is_active
) VALUES (
  '00000000-0000-0000-0000-000000000002'::uuid,
  '00000000-0000-0000-0000-000000000001'::uuid,
  'Main Location',
  true
) ON CONFLICT DO NOTHING;

DO $$
DECLARE
  v_admin_user_id uuid;
  v_store_id uuid := '00000000-0000-0000-0000-000000000001'::uuid;
BEGIN
  SELECT id INTO v_admin_user_id
  FROM auth.users
  WHERE email = 'admin@store.uz'
  LIMIT 1;
  
  IF v_admin_user_id IS NOT NULL THEN
    INSERT INTO profiles (
      id, username, full_name, email, role, is_active
    ) VALUES (
      v_admin_user_id,
      'admin',
      'Admin User',
      'admin@store.uz',
      'admin',
      true
    ) ON CONFLICT (id) DO UPDATE SET
      username = EXCLUDED.username,
      full_name = EXCLUDED.full_name,
      email = EXCLUDED.email,
      role = EXCLUDED.role;
    
    INSERT INTO store_members (
      store_id, user_id, role, is_active
    ) VALUES (
      v_store_id,
      v_admin_user_id,
      'owner',
      true
    ) ON CONFLICT (store_id, user_id) DO UPDATE SET
      role = EXCLUDED.role,
      is_active = EXCLUDED.is_active;
  END IF;
END $$;

INSERT INTO categories (
  id, store_id, name, description, color, icon
) VALUES
  (
    '00000000-0000-0000-0000-000000000010'::uuid,
    '00000000-0000-0000-0000-000000000001'::uuid,
    'Ichimliklar',
    'Sovuq va issiq ichimliklar',
    '#3B82F6',
    'cup'
  ),
  (
    '00000000-0000-0000-0000-000000000011'::uuid,
    '00000000-0000-0000-0000-000000000001'::uuid,
    'Oziq-ovqat',
    'Non, shirinliklar, mahsulotlar',
    '#10B981',
    'shopping-bag'
  ),
  (
    '00000000-0000-0000-0000-000000000012'::uuid,
    '00000000-0000-0000-0000-000000000001'::uuid,
    'Maishiy kimyoviy moddalar',
    'Yuvish vositalari, tozalash moddalari',
    '#8B5CF6',
    'sparkles'
  ),
  (
    '00000000-0000-0000-0000-000000000013'::uuid,
    '00000000-0000-0000-0000-000000000001'::uuid,
    'Boshqa',
    'Boshqa mahsulotlar',
    '#6B7280',
    'package'
  )
ON CONFLICT DO NOTHING;

INSERT INTO products (
  id, store_id, sku, barcode, name, description, category_id, unit,
  purchase_price, sale_price, min_stock_level, is_active
) VALUES
  (
    '00000000-0000-0000-0000-000000000100'::uuid,
    '00000000-0000-0000-0000-000000000001'::uuid,
    'SKU-2024-000001',
    '1234567890123',
    'Coca-Cola 0.5L',
    'Sovuq ichimlik',
    '00000000-0000-0000-0000-000000000010'::uuid,
    'pcs',
    3000.00,
    5000.00,
    10,
    true
  ),
  (
    '00000000-0000-0000-0000-000000000101'::uuid,
    '00000000-0000-0000-0000-000000000001'::uuid,
    'SKU-2024-000002',
    '1234567890124',
    'Pepsi 0.5L',
    'Sovuq ichimlik',
    '00000000-0000-0000-0000-000000000010'::uuid,
    'pcs',
    2800.00,
    4800.00,
    10,
    true
  ),
  (
    '00000000-0000-0000-0000-000000000102'::uuid,
    '00000000-0000-0000-0000-000000000001'::uuid,
    'SKU-2024-000003',
    '1234567890125',
    'Non',
    'Taza non',
    '00000000-0000-0000-0000-000000000011'::uuid,
    'pcs',
    2000.00,
    3000.00,
    20,
    true
  ),
  (
    '00000000-0000-0000-0000-000000000103'::uuid,
    '00000000-0000-0000-0000-000000000001'::uuid,
    'SKU-2024-000004',
    '1234567890126',
    'Sut 1L',
    'Taza sut',
    '00000000-0000-0000-0000-000000000011'::uuid,
    'pcs',
    8000.00,
    12000.00,
    15,
    true
  ),
  (
    '00000000-0000-0000-0000-000000000104'::uuid,
    '00000000-0000-0000-0000-000000000001'::uuid,
    'SKU-2024-000005',
    '1234567890127',
    'Tuxum 10 dona',
    'Tuxum',
    '00000000-0000-0000-0000-000000000011'::uuid,
    'pcs',
    12000.00,
    15000.00,
    10,
    true
  ),
  (
    '00000000-0000-0000-0000-000000000105'::uuid,
    '00000000-0000-0000-0000-000000000001'::uuid,
    'SKU-2024-000006',
    '1234567890128',
    'Yuvish kukuni 1kg',
    'Maishiy kimyoviy modda',
    '00000000-0000-0000-0000-000000000012'::uuid,
    'pcs',
    15000.00,
    20000.00,
    5,
    true
  )
ON CONFLICT DO NOTHING;

DO $$
DECLARE
  v_admin_user_id uuid;
  v_store_id uuid := '00000000-0000-0000-0000-000000000001'::uuid;
  v_location_id uuid := '00000000-0000-0000-0000-000000000002'::uuid;
BEGIN
  SELECT id INTO v_admin_user_id
  FROM auth.users
  WHERE email = 'admin@store.uz'
  LIMIT 1;
  
  INSERT INTO inventory_movements (
    store_id, location_id, movement_number, product_id, movement_type,
    quantity, before_quantity, after_quantity,
    reference_type, reason, created_by
  )
  SELECT
    p.store_id,
    v_location_id,
    'INV-' || to_char(now(), 'YYYY') || '-' || lpad((ROW_NUMBER() OVER (ORDER BY p.id))::text, 6, '0'),
    p.id,
    'adjustment',
    50,
    0,
    50,
    'audit',
    'Initial stock setup',
    v_admin_user_id
  FROM products p
  WHERE p.store_id = v_store_id
    AND NOT EXISTS (
      SELECT 1 FROM inventory_movements im
      WHERE im.product_id = p.id
        AND im.store_id = p.store_id
        AND im.reference_type = 'audit'
        AND im.reason = 'Initial stock setup'
    );
END $$;

INSERT INTO customers (
  id, store_id, name, phone, email, type, credit_limit, allow_debt, status
) VALUES (
  '00000000-0000-0000-0000-000000000200'::uuid,
  '00000000-0000-0000-0000-000000000001'::uuid,
  'Demo Mijoz',
  '+998901111111',
  'customer@example.uz',
  'individual',
  100000.00,
  true,
  'active'
) ON CONFLICT DO NOTHING;

INSERT INTO suppliers (
  id, store_id, name, contact_person, phone, email, status
) VALUES (
  '00000000-0000-0000-0000-000000000300'::uuid,
  '00000000-0000-0000-0000-000000000001'::uuid,
  'Demo Yetkazib Beruvchi',
  'John Doe',
  '+998902222222',
  'supplier@example.uz',
  'active'
) ON CONFLICT DO NOTHING;

INSERT INTO settings (
  store_id, category, key, value, description
) VALUES
  (
    '00000000-0000-0000-0000-000000000001'::uuid,
    'inventory',
    'allow_negative_stock',
    '"block"',
    'Block sales if stock is insufficient'
  ),
  (
    '00000000-0000-0000-0000-000000000001'::uuid,
    'inventory',
    'default_min_stock',
    '10',
    'Default minimum stock level'
  ),
  (
    '00000000-0000-0000-0000-000000000001'::uuid,
    'pos',
    'enable_hold_order',
    'true',
    'Enable hold order feature'
  ),
  (
    '00000000-0000-0000-0000-000000000001'::uuid,
    'pos',
    'enable_mixed_payment',
    'true',
    'Enable mixed payment methods'
  ),
  (
    '00000000-0000-0000-0000-000000000001'::uuid,
    'pos',
    'require_customer_for_credit',
    'true',
    'Require customer selection for credit sales'
  )
ON CONFLICT (store_id, category, key) DO NOTHING;

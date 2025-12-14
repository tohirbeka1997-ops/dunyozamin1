# How to Apply Supabase Migrations

## Overview
This guide explains how to apply the POS system database schema to your Supabase project.

## Files Structure
```
supabase/
├── migrations/
│   └── 0001_init.sql          # Main schema (tables, enums, indexes, triggers)
├── policies/
│   └── rls.sql                # Row-Level Security policies
├── functions/
│   └── rpc.sql                # RPC functions (complete_sale, receive_purchase, etc.)
└── seed/
    └── seed.sql               # Demo data (store, products, categories)
```

## Step-by-Step Instructions

### Option 1: Using Supabase SQL Editor (Recommended for Initial Setup)

1. **Open Supabase Dashboard**
   - Go to your Supabase project dashboard
   - Navigate to **SQL Editor**

2. **Apply Main Migration**
   - Open `supabase/migrations/0001_init.sql`
   - Copy the entire contents
   - Paste into SQL Editor
   - Click **Run** (or press Ctrl+Enter)
   - Verify no errors

3. **Apply RLS Policies**
   - Open `supabase/policies/rls.sql`
   - Copy the entire contents
   - Paste into SQL Editor
   - Click **Run**
   - Verify no errors

4. **Apply RPC Functions**
   - Open `supabase/functions/rpc.sql`
   - Copy the entire contents
   - Paste into SQL Editor
   - Click **Run**
   - Verify no errors

5. **Create Admin User (Auth)**
   - Go to **Authentication** → **Users**
   - Click **Add User** → **Create new user**
   - Enter email and password
   - Note the **User UID** (you'll need this for seed data)

6. **Apply Seed Data**
   - Open `supabase/seed/seed.sql`
   - **IMPORTANT**: Replace all instances of `'00000000-0000-0000-0000-000000000000'::uuid` with your actual admin user's UID
   - Copy the modified contents
   - Paste into SQL Editor
   - Click **Run**
   - Verify no errors

### Option 2: Using Supabase CLI (For Production)

1. **Install Supabase CLI**
   ```bash
   npm install -g supabase
   ```

2. **Link Your Project**
   ```bash
   supabase link --project-ref your-project-ref
   ```

3. **Apply Migrations**
   ```bash
   # Apply main migration
   supabase db push

   # Or apply specific files
   supabase db execute -f supabase/migrations/0001_init.sql
   supabase db execute -f supabase/policies/rls.sql
   supabase db execute -f supabase/functions/rpc.sql
   ```

4. **Apply Seed Data**
   ```bash
   # Edit seed.sql first to replace auth.uid placeholder
   supabase db execute -f supabase/seed/seed.sql
   ```

## Verification

After applying all migrations, verify the setup:

1. **Check Tables**
   ```sql
   SELECT table_name 
   FROM information_schema.tables 
   WHERE table_schema = 'public' 
   ORDER BY table_name;
   ```

2. **Check RLS is Enabled**
   ```sql
   SELECT tablename, rowsecurity 
   FROM pg_tables 
   WHERE schemaname = 'public' 
   AND tablename IN ('stores', 'products', 'orders');
   ```

3. **Check RPC Functions**
   ```sql
   SELECT routine_name 
   FROM information_schema.routines 
   WHERE routine_schema = 'public' 
   AND routine_type = 'FUNCTION'
   ORDER BY routine_name;
   ```

4. **Test Store Creation**
   ```sql
   SELECT * FROM stores;
   ```

5. **Test Products**
   ```sql
   SELECT * FROM products LIMIT 5;
   ```

## Important Notes

### Multi-Store Support
- All business tables include `store_id`
- Users must be added to `store_members` table to access store data
- RLS policies enforce store-level data isolation

### Inventory Management
- Stock is **always** calculated from `inventory_movements`
- `inventory_balances` is a materialized view updated via triggers
- Never update `products.current_stock` directly (it doesn't exist in this schema)

### RPC Functions
- All critical operations use RPC functions:
  - `rpc_complete_sale()` - Complete POS sale
  - `rpc_receive_purchase()` - Receive goods from purchase order
  - `rpc_return_sale()` - Process sales return
- Functions validate permissions, stock, and shift status
- Functions run in transactions (atomic operations)

### Shift Management
- Sales require an open shift (if `location_id` is provided)
- Shifts are store and location specific
- Cashiers can only manage their own shifts

### Customer/Supplier Balances
- Customer `balance` is calculated: `SUM(orders.total_amount) - SUM(customer_payments.amount)`
- Supplier balance is calculated: `SUM(received_purchase_orders.total_amount) - SUM(supplier_payments.amount)`
- Balances are updated via triggers and RPC functions

## Troubleshooting

### Error: "permission denied for table"
- **Solution**: Ensure RLS policies are applied correctly
- Check that user is a member of the store via `store_members` table

### Error: "function does not exist"
- **Solution**: Ensure `supabase/functions/rpc.sql` was applied
- Verify functions exist: `SELECT routine_name FROM information_schema.routines WHERE routine_schema = 'public';`

### Error: "relation does not exist"
- **Solution**: Ensure `supabase/migrations/0001_init.sql` was applied
- Check tables exist: `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';`

### Stock Not Updating
- **Solution**: Ensure inventory movements are created via RPC functions
- Check `inventory_movements` table for entries
- Verify triggers are active: `SELECT * FROM pg_trigger WHERE tgname = 'trigger_update_inventory_balance';`

## Next Steps

1. **Update Frontend**
   - Ensure frontend uses `store_id` in all queries
   - Update API calls to use RPC functions for sales/purchases
   - Add store selection UI if multi-store

2. **Configure Settings**
   - Update `settings` table with your preferences
   - Configure inventory settings (allow negative stock, etc.)

3. **Add More Users**
   - Create users in Supabase Auth
   - Add them to `store_members` table with appropriate roles

4. **Import Products**
   - Use Supabase dashboard or API to import your product catalog
   - Set initial stock via inventory movements

## Support

For issues or questions:
1. Check Supabase logs in Dashboard → Logs
2. Verify RLS policies are correct
3. Ensure all migrations were applied in order
4. Check that user has proper store membership



# Clean Database Instructions

## 🔍 Problem Identified

You are seeing demo/test products in your Supabase database:
- Product names: "22222222", "teww", "asfsdf", "vxcv", "daasda", "3431", "admin", "asd", "olma"
- SKUs: "SKU-20251208-0009", "SKU-20251208-0008", "SKU-20251208-0007", etc.

## ✅ Codebase Status

**GOOD NEWS:** The codebase is completely clean. These products are NOT defined in:
- ❌ No TypeScript/JavaScript arrays
- ❌ No JSON files
- ❌ No seed scripts
- ❌ No localStorage
- ❌ No hardcoded data

**The data exists ONLY in your Supabase database.**

## 🗑️ Solution: Delete from Database

Since the data is in the database, you need to run SQL commands to delete it.

### Quick Method: Run the SQL Script

I've created a ready-to-use SQL script: **`DELETE_ALL_DEMO_DATA.sql`**

### How to Run:

#### Option 1: Supabase Dashboard (Easiest)
1. Open your Supabase project dashboard
2. Click **"SQL Editor"** in the left sidebar
3. Click **"New Query"**
4. Open the file `DELETE_ALL_DEMO_DATA.sql` in this project
5. Copy the entire contents
6. Paste into the SQL Editor
7. Click **"Run"** (or press `Ctrl+Enter`)
8. Confirm the deletion

#### Option 2: Supabase CLI
```bash
supabase db execute --file DELETE_ALL_DEMO_DATA.sql
```

#### Option 3: Direct SQL (if you have psql access)
```bash
psql -h your-db-host -U postgres -d postgres -f DELETE_ALL_DEMO_DATA.sql
```

### What Gets Deleted:

✅ **All Products** (including "22222222", "teww", "asfsdf", "olma", etc.)  
✅ **All Customers**  
✅ **All Orders** and order items  
✅ **All Sales Returns**  
✅ **All Inventory Movements** (stock history)  
✅ **All Purchase Orders**  
✅ **All Payments**  
✅ **All Held Orders**  
✅ **All Shifts**  
✅ **All Suppliers**  
✅ **All Employee Sessions/Logs**  

### What Gets Preserved:

✅ **User Profiles** (your login accounts)  
✅ **Settings Table** (system configuration)  
✅ **Database Schema** (tables, functions, triggers)  
✅ **Categories** (optional - can be deleted too if needed)  

## 🔄 Alternative: Use TRUNCATE (Faster)

If you want a faster method that also resets auto-increment counters:

```sql
-- Faster method using TRUNCATE (resets sequences too)
TRUNCATE TABLE 
  order_items,
  payments,
  orders,
  sales_return_items,
  sales_returns,
  customer_payments,
  inventory_movements,
  purchase_order_items,
  purchase_orders,
  held_orders,
  shifts,
  employee_activity_logs,
  employee_sessions,
  products,
  customers,
  suppliers
RESTART IDENTITY CASCADE;
```

**Note:** `CASCADE` automatically deletes related rows in child tables.

## ✅ Verification

After running the script, verify the deletion:

```sql
-- Check counts (all should be 0)
SELECT 
  (SELECT COUNT(*) FROM products) as products,
  (SELECT COUNT(*) FROM customers) as customers,
  (SELECT COUNT(*) FROM orders) as orders,
  (SELECT COUNT(*) FROM inventory_movements) as movements;
```

Expected result:
```
products | customers | orders | movements
---------+-----------+--------+-----------
    0    |     0     |   0    |     0
```

## 🎯 After Cleanup

Once the database is clean:

1. ✅ Refresh your `/products` page - should show "No products found"
2. ✅ Refresh `/customers` page - should show "No customers found"
3. ✅ Refresh `/orders` page - should show "No orders found"
4. ✅ POS Terminal cart should be empty
5. ✅ Dashboard should show 0 for all metrics

## 📝 Next Steps

After cleanup:
1. Start adding real products through the UI (`/products/new`)
2. Add real customers through the UI (`/customers/new`)
3. Create real orders through POS Terminal
4. All new data will be stored in Supabase

---

**File Created:** `DELETE_ALL_DEMO_DATA.sql`  
**Status:** Ready to run  
**Risk Level:** ⚠️ HIGH - Irreversible deletion of all data



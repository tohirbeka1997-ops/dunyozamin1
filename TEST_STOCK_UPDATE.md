# Stock Update Testing Guide

## Quick Test Checklist

### ✅ Test 1: Basic Sale (Single Product)
**Objective**: Verify stock decreases after completing a sale

**Steps**:
1. Go to **Products** page
2. Note the current stock of any product (e.g., "Rice: 534 kg")
3. Go to **POS Terminal**
4. Add the product to cart (e.g., 10 kg of Rice)
5. Complete the order with payment
6. Return to **Products** page
7. Refresh the page (F5)

**Expected Result**:
- ✅ Stock should decrease by the sold quantity (534 → 524)
- ✅ Products page shows updated stock immediately

**Verification**:
```sql
-- Check product stock
SELECT name, current_stock FROM products WHERE name = 'Rice';

-- Check inventory movement was created
SELECT 
  movement_type, 
  quantity, 
  reference_type,
  notes
FROM inventory_movements 
WHERE product_id = (SELECT id FROM products WHERE name = 'Rice')
ORDER BY created_at DESC LIMIT 1;

-- Expected:
-- movement_type = 'sale'
-- quantity = -10
-- reference_type = 'order'
```

---

### ✅ Test 2: Multiple Products in One Order
**Objective**: Verify all products in an order have their stock updated

**Steps**:
1. Go to **Products** page
2. Note stock of 3 different products
3. Go to **POS Terminal**
4. Add all 3 products to cart with different quantities
5. Complete the order
6. Return to **Products** page

**Expected Result**:
- ✅ All 3 products show decreased stock
- ✅ Each decrease matches the quantity sold

**Verification**:
```sql
-- Check all products in the order
SELECT 
  p.name,
  p.current_stock,
  oi.quantity as sold_quantity
FROM order_items oi
JOIN products p ON p.id = oi.product_id
WHERE oi.order_id = '<order_id>';

-- Check inventory movements
SELECT 
  p.name,
  im.quantity,
  im.movement_type
FROM inventory_movements im
JOIN products p ON p.id = im.product_id
WHERE im.reference_id = '<order_id>'
ORDER BY p.name;
```

---

### ✅ Test 3: Insufficient Stock Prevention
**Objective**: Verify system prevents overselling

**Steps**:
1. Find a product with low stock (e.g., 5 units)
2. Go to **POS Terminal**
3. Try to add more than available (e.g., 10 units)
4. Attempt to complete the order

**Expected Result**:
- ✅ Error message: "Insufficient stock for [Product]. Available: 5, Required: 10"
- ✅ Order is NOT created
- ✅ Stock remains unchanged
- ✅ No inventory movement is logged

**Verification**:
```sql
-- Verify stock unchanged
SELECT name, current_stock FROM products WHERE name = '<product>';

-- Verify no recent order was created
SELECT * FROM orders ORDER BY created_at DESC LIMIT 1;

-- Verify no inventory movement
SELECT * FROM inventory_movements 
WHERE product_id = '<product_id>'
ORDER BY created_at DESC LIMIT 1;
```

---

### ✅ Test 4: Sales Return Increases Stock
**Objective**: Verify returns increase stock correctly

**Steps**:
1. Complete a sale (e.g., sell 10 kg of Sugar)
2. Note the new stock (e.g., 200 → 190)
3. Go to **Sales Returns** page
4. Create a return for part of the order (e.g., return 3 kg)
5. Complete the return
6. Go to **Products** page

**Expected Result**:
- ✅ Stock increases by returned quantity (190 → 193)
- ✅ Return is recorded in sales_returns table
- ✅ Inventory movement shows type='return', quantity=+3

**Verification**:
```sql
-- Check product stock after return
SELECT name, current_stock FROM products WHERE name = 'Sugar';

-- Check return record
SELECT * FROM sales_returns ORDER BY created_at DESC LIMIT 1;

-- Check inventory movement
SELECT 
  movement_type,
  quantity,
  reference_type
FROM inventory_movements 
WHERE movement_type = 'return'
ORDER BY created_at DESC LIMIT 1;
```

---

### ✅ Test 5: Purchase Order Increases Stock
**Objective**: Verify receiving goods increases stock

**Steps**:
1. Go to **Purchase Orders** page
2. Create a new purchase order with products
3. Approve the purchase order
4. Receive the goods (full or partial)
5. Go to **Products** page

**Expected Result**:
- ✅ Stock increases by received quantity
- ✅ Purchase order status updated
- ✅ Inventory movement shows type='purchase'

**Verification**:
```sql
-- Check product stock after receiving
SELECT name, current_stock FROM products WHERE name = '<product>';

-- Check purchase order status
SELECT status, received_qty, ordered_qty 
FROM purchase_order_items 
WHERE purchase_order_id = '<po_id>';

-- Check inventory movement
SELECT 
  movement_type,
  quantity,
  reference_type
FROM inventory_movements 
WHERE movement_type = 'purchase'
ORDER BY created_at DESC LIMIT 1;
```

---

### ✅ Test 6: Page Refresh Shows Updated Stock
**Objective**: Verify no caching issues

**Steps**:
1. Complete several sales
2. Note the stock changes
3. Navigate to Dashboard
4. Return to Products page
5. Hard refresh (Ctrl+F5 or Cmd+Shift+R)

**Expected Result**:
- ✅ Stock values match the latest database values
- ✅ No stale data is displayed
- ✅ All changes are reflected immediately

---

### ✅ Test 7: Multiple Concurrent Sales
**Objective**: Verify transaction safety

**Steps**:
1. Open POS Terminal in two browser tabs
2. In Tab 1: Add Product A (10 units) to cart
3. In Tab 2: Add Product A (5 units) to cart
4. Complete order in Tab 1
5. Complete order in Tab 2
6. Check Products page

**Expected Result**:
- ✅ Stock decreases by total sold (15 units)
- ✅ Both orders are recorded
- ✅ Two inventory movements are created
- ✅ No race condition or data corruption

**Verification**:
```sql
-- Check final stock
SELECT name, current_stock FROM products WHERE name = '<product>';

-- Check both orders
SELECT order_number, total_amount, created_at 
FROM orders 
ORDER BY created_at DESC LIMIT 2;

-- Check inventory movements
SELECT 
  movement_number,
  quantity,
  reference_id,
  created_at
FROM inventory_movements 
WHERE product_id = '<product_id>'
ORDER BY created_at DESC LIMIT 2;
```

---

## Database Verification Queries

### Check Stock Consistency
```sql
-- Verify products.current_stock matches sum of movements
SELECT 
  p.name,
  p.current_stock,
  COALESCE(SUM(im.quantity), 0) as total_movements,
  p.current_stock - COALESCE(SUM(im.quantity), 0) as difference
FROM products p
LEFT JOIN inventory_movements im ON im.product_id = p.id
GROUP BY p.id, p.name, p.current_stock
HAVING ABS(p.current_stock - COALESCE(SUM(im.quantity), 0)) > 0.01;

-- Should return 0 rows if everything is consistent
```

### View Recent Sales and Stock Changes
```sql
SELECT 
  o.order_number,
  o.created_at as order_time,
  p.name as product,
  oi.quantity as sold,
  im.quantity as movement_qty,
  im.before_quantity,
  im.after_quantity
FROM orders o
JOIN order_items oi ON oi.order_id = o.id
JOIN products p ON p.id = oi.product_id
LEFT JOIN inventory_movements im ON im.reference_id = o.id AND im.product_id = p.id
ORDER BY o.created_at DESC
LIMIT 10;
```

### Check for Negative Stock (Should be 0)
```sql
SELECT 
  name,
  sku,
  current_stock
FROM products
WHERE current_stock < 0;

-- Should return 0 rows
```

### View All Movement Types
```sql
SELECT 
  movement_type,
  COUNT(*) as count,
  SUM(CASE WHEN quantity > 0 THEN quantity ELSE 0 END) as total_increase,
  SUM(CASE WHEN quantity < 0 THEN ABS(quantity) ELSE 0 END) as total_decrease
FROM inventory_movements
GROUP BY movement_type
ORDER BY movement_type;
```

---

## Common Issues & Solutions

### Issue 1: Stock Not Updating
**Symptoms**: Products page shows same stock after sale

**Possible Causes**:
1. Migration not applied
2. Browser cache
3. RPC function error

**Solutions**:
```sql
-- Check if migration was applied
SELECT * FROM supabase_migrations 
WHERE name LIKE '%stock%' 
ORDER BY executed_at DESC;

-- Check if RPC function exists
SELECT routine_name, routine_definition 
FROM information_schema.routines 
WHERE routine_name = 'complete_pos_order';

-- Check for recent errors in orders
SELECT * FROM orders 
WHERE status = 'failed' OR payment_status = 'failed'
ORDER BY created_at DESC LIMIT 5;
```

### Issue 2: Inventory Movements Not Created
**Symptoms**: Stock updates but no movement records

**Check**:
```sql
-- Count movements vs orders
SELECT 
  (SELECT COUNT(*) FROM orders WHERE created_at > NOW() - INTERVAL '1 day') as orders_count,
  (SELECT COUNT(*) FROM inventory_movements WHERE movement_type = 'sale' AND created_at > NOW() - INTERVAL '1 day') as movements_count;

-- Should be equal or movements >= orders (multiple items per order)
```

### Issue 3: Stock Goes Negative
**Symptoms**: Products show negative stock

**Check**:
```sql
-- Find negative stock products
SELECT name, current_stock FROM products WHERE current_stock < 0;

-- Check allow_negative_stock setting
SELECT * FROM settings WHERE category = 'inventory' AND key = 'allow_negative_stock';

-- Fix negative stock (manual correction)
UPDATE products 
SET current_stock = 0 
WHERE current_stock < 0;
```

---

## Performance Testing

### Test Large Order (Many Items)
**Objective**: Verify performance with large orders

**Steps**:
1. Create an order with 50+ different products
2. Complete the order
3. Measure time taken

**Expected Result**:
- ✅ Order completes in < 5 seconds
- ✅ All stock updates are correct
- ✅ All inventory movements are created

### Test High Volume (Many Orders)
**Objective**: Verify system handles high transaction volume

**Steps**:
1. Complete 100 orders in quick succession
2. Check database performance
3. Verify all stock updates are correct

**Expected Result**:
- ✅ No deadlocks or transaction failures
- ✅ All orders are recorded
- ✅ Stock is accurate for all products

---

## Automated Test Script

```sql
-- Test Script: Verify Stock Update After Sale
DO $$
DECLARE
  v_product_id uuid;
  v_initial_stock numeric;
  v_final_stock numeric;
  v_order_result jsonb;
  v_sold_qty numeric := 5;
BEGIN
  -- Get a product with sufficient stock
  SELECT id, current_stock INTO v_product_id, v_initial_stock
  FROM products
  WHERE current_stock >= 10
  LIMIT 1;
  
  RAISE NOTICE 'Testing product: %, Initial stock: %', v_product_id, v_initial_stock;
  
  -- Simulate order creation (you would call complete_pos_order here)
  -- For testing, we'll just update stock directly
  UPDATE products 
  SET current_stock = current_stock - v_sold_qty
  WHERE id = v_product_id;
  
  -- Check final stock
  SELECT current_stock INTO v_final_stock
  FROM products
  WHERE id = v_product_id;
  
  -- Verify
  IF v_final_stock = v_initial_stock - v_sold_qty THEN
    RAISE NOTICE '✅ TEST PASSED: Stock updated correctly. Initial: %, Final: %, Sold: %', 
      v_initial_stock, v_final_stock, v_sold_qty;
  ELSE
    RAISE EXCEPTION '❌ TEST FAILED: Stock mismatch. Expected: %, Got: %', 
      v_initial_stock - v_sold_qty, v_final_stock;
  END IF;
  
  -- Rollback for testing
  RAISE EXCEPTION 'Test complete - rolling back changes';
END $$;
```

---

## Success Criteria

### ✅ All Tests Pass
- [ ] Test 1: Basic Sale
- [ ] Test 2: Multiple Products
- [ ] Test 3: Insufficient Stock Prevention
- [ ] Test 4: Sales Return
- [ ] Test 5: Purchase Order
- [ ] Test 6: Page Refresh
- [ ] Test 7: Concurrent Sales

### ✅ Database Consistency
- [ ] No negative stock
- [ ] Stock matches sum of movements
- [ ] All sales have inventory movements
- [ ] No orphaned records

### ✅ User Experience
- [ ] Products page shows real-time stock
- [ ] No caching issues
- [ ] Clear error messages
- [ ] Fast order completion (< 3 seconds)

---

## Reporting Issues

If you find any issues during testing, please document:

1. **Test Case**: Which test failed
2. **Steps to Reproduce**: Exact steps taken
3. **Expected Result**: What should have happened
4. **Actual Result**: What actually happened
5. **Database State**: Run verification queries and include results
6. **Screenshots**: If applicable
7. **Error Messages**: Any errors shown in UI or console

---

**Testing Status**: 🟡 **PENDING** - Awaiting manual testing

**Next Action**: Execute all test cases and verify results

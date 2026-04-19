# Stock Update Testing Guide - SQLite/Electron

This document provides step-by-step manual testing procedures to verify stock updates work correctly after migrating from Supabase to SQLite.

## Prerequisites

1. **Electron app is running** (`npm run electron:dev`)
2. **Database is initialized** (migrations run, seed data loaded)
3. **Test products exist** with stock tracking enabled
4. **At least one warehouse** configured (default warehouse preferred)
5. **Test user** with appropriate permissions

## Pre-Test Database Verification

Before running tests, verify the database state:

```bash
# Run verification queries
sqlite3 <path-to-userData>/pos.db < electron/db/verify_stock.sql
```

Expected results:
- All checks should pass (0 rows returned for consistency checks)
- No negative stock when `allow_negative_stock = 0`

## Test Cases

### Test 1: Single Product Sale Decreases Stock

**Objective**: Verify that completing a sale order for a single product correctly decreases stock.

**Steps**:

1. **Record initial stock**:
   - Navigate to Products page
   - Note the `current_stock` value for test product (e.g., Product A)
   - Record: Initial Stock = X

2. **Create and complete a sale**:
   - Navigate to POS Terminal
   - Add Product A to cart (quantity: 1)
   - Complete payment (any method)
   - Note the order number

3. **Verify stock decreased**:
   - Navigate back to Products page
   - Refresh if needed (should auto-refresh via `productUpdateEmitter`)
   - Verify `current_stock` for Product A is now X - 1

4. **Database verification**:
   ```sql
   -- Check stock_balances updated
   SELECT product_id, warehouse_id, quantity 
   FROM stock_balances 
   WHERE product_id = '<product-a-id>';
   
   -- Check stock_moves created
   SELECT * FROM stock_moves 
   WHERE product_id = '<product-a-id>' 
   AND reference_type = 'order' 
   AND reference_id = '<order-id>';
   ```

**Expected Results**:
- ✅ Stock decreased by sale quantity
- ✅ `stock_moves` record created with `move_type = 'sale'`, `quantity` = -1
- ✅ `reference_type = 'order'`, `reference_id` = order ID
- ✅ Products page shows updated stock

---

### Test 2: Multi-Product Order Decreases Stock

**Objective**: Verify that completing an order with multiple products correctly decreases stock for all items.

**Steps**:

1. **Record initial stock**:
   - Navigate to Products page
   - Note stock for multiple products (e.g., Product A: X, Product B: Y, Product C: Z)

2. **Create multi-item order**:
   - Navigate to POS Terminal
   - Add Product A (quantity: 2)
   - Add Product B (quantity: 1)
   - Add Product C (quantity: 3)
   - Complete payment

3. **Verify all stocks decreased**:
   - Navigate to Products page
   - Verify:
     - Product A: X - 2
     - Product B: Y - 1
     - Product C: Z - 3

4. **Database verification**:
   ```sql
   -- Check all stock moves created
   SELECT 
     sm.product_id,
     p.name as product_name,
     sm.quantity as qty_change,
     sm.before_quantity,
     sm.after_quantity,
     sm.reference_id as order_id
   FROM stock_moves sm
   JOIN products p ON sm.product_id = p.id
   WHERE sm.reference_type = 'order'
   AND sm.reference_id = '<order-id>'
   ORDER BY p.name;
   ```

**Expected Results**:
- ✅ All products' stock decreased correctly
- ✅ Multiple `stock_moves` records created (one per product)
- ✅ All movements linked to same order ID
- ✅ `before_quantity` and `after_quantity` are correct

---

### Test 3: Insufficient Stock Prevention

**Objective**: Verify that orders cannot be completed when stock is insufficient (when negative stock is disabled).

**Prerequisites**:
- Ensure `allow_negative_stock` setting is `0` (disabled)
- Product has limited stock (e.g., 5 units)

**Steps**:

1. **Set up test scenario**:
   - Check current stock for test product (e.g., Product A: 5 units)
   - Verify setting: Settings → `allow_negative_stock` = `0`

2. **Attempt to sell more than available**:
   - Navigate to POS Terminal
   - Add Product A to cart with quantity: 10 (exceeds available stock)
   - Attempt to complete payment

3. **Verify error handling**:
   - ✅ Error message displayed: "Insufficient stock for [Product Name]. Available: 5, Requested: 10"
   - ✅ Order is NOT created
   - ✅ Stock remains unchanged (still 5 units)

4. **Database verification**:
   ```sql
   -- Verify no order created (should return 0 rows if order ID was captured)
   SELECT * FROM orders WHERE id = '<attempted-order-id>';
   
   -- Verify no stock_moves created
   SELECT * FROM stock_moves WHERE reference_id = '<attempted-order-id>';
   
   -- Verify stock unchanged
   SELECT quantity FROM stock_balances 
   WHERE product_id = '<product-id>';
   ```

**Expected Results**:
- ✅ Error with `INSUFFICIENT_STOCK` code
- ✅ No order record created
- ✅ No stock_moves records created
- ✅ Stock balance unchanged
- ✅ User can retry with correct quantity

---

### Test 4: Returns Increase Stock

**Objective**: Verify that creating a sales return correctly increases stock for returned items.

**Prerequisites**:
- Have a completed order with items to return

**Steps**:

1. **Record initial stock**:
   - Note current stock for product to be returned (e.g., Product A: X)

2. **Create return**:
   - Navigate to Sales Returns page
   - Create new return
   - Select the order from Test 1 or Test 2
   - Select items to return (e.g., Product A, quantity: 1)
   - Enter return reason
   - Complete return

3. **Verify stock increased**:
   - Navigate to Products page
   - Verify Product A stock is now X + 1

4. **Database verification**:
   ```sql
   -- Check stock_moves created (positive quantity)
   SELECT 
     sm.product_id,
     p.name as product_name,
     sm.quantity as qty_change,
     sm.move_type,
     sm.before_quantity,
     sm.after_quantity
   FROM stock_moves sm
   JOIN products p ON sm.product_id = p.id
   WHERE sm.reference_type = 'return'
   AND sm.reference_id = '<return-id>';
   
   -- Verify stock_balances updated
   SELECT quantity FROM stock_balances 
   WHERE product_id = '<product-id>';
   ```

**Expected Results**:
- ✅ Stock increased by return quantity
- ✅ `stock_moves` record created with `move_type = 'return'`, `quantity` = +1
- ✅ `reference_type = 'return'`, `reference_id` = return ID
- ✅ Products page shows updated stock

---

### Test 5: Purchase Receipt Increases Stock

**Objective**: Verify that receiving goods from a purchase order correctly increases stock.

**Prerequisites**:
- Have a purchase order created (status: pending or partially_received)

**Steps**:

1. **Record initial stock**:
   - Note current stock for products in purchase order (e.g., Product A: X)

2. **Receive goods**:
   - Navigate to Purchase Orders page
   - Open purchase order detail
   - Click "Receive Goods" or equivalent
   - Enter received quantities (e.g., Product A: 10 units)
   - Complete receipt

3. **Verify stock increased**:
   - Navigate to Products page
   - Verify Product A stock is now X + 10

4. **Database verification**:
   ```sql
   -- Check stock_moves created (positive quantity)
   SELECT 
     sm.product_id,
     p.name as product_name,
     sm.quantity as qty_change,
     sm.move_type,
     sm.before_quantity,
     sm.after_quantity,
     sm.reference_id as purchase_order_id
   FROM stock_moves sm
   JOIN products p ON sm.product_id = p.id
   WHERE sm.reference_type = 'purchase_order'
   AND sm.reference_id = '<purchase-order-id>';
   
   -- Verify stock_balances updated
   SELECT quantity FROM stock_balances 
   WHERE product_id = '<product-id>';
   ```

**Expected Results**:
- ✅ Stock increased by received quantity
- ✅ `stock_moves` record created with `move_type = 'purchase'`, `quantity` = +10
- ✅ `reference_type = 'purchase_order'`, `reference_id` = PO ID
- ✅ Products page shows updated stock

---

### Test 6: UI Refresh Shows Updated Stock

**Objective**: Verify that Products page automatically updates after stock-affecting operations.

**Steps**:

1. **Open Products page**:
   - Navigate to Products page
   - Note current stock for test product (e.g., Product A: X)
   - Keep page open

2. **Perform stock-affecting operation** (in another tab or after navigation):
   - Complete a sale (decreases stock)
   - OR create a return (increases stock)
   - OR receive goods (increases stock)

3. **Verify auto-refresh**:
   - Return to Products page
   - ✅ Stock should be updated automatically (via `productUpdateEmitter`)
   - ✅ No manual refresh needed

**Alternative test** (if auto-refresh doesn't work):
- Refresh Products page manually (F5 or refresh button)
- ✅ Stock should show updated value

**Expected Results**:
- ✅ Products page shows updated stock (automatic or after refresh)
- ✅ Stock values match database state
- ✅ No stale data displayed

---

### Test 7: Concurrent Sales Test (No Oversell)

**Objective**: Verify that simultaneous sales of the same product don't result in overselling (concurrency safety).

**Prerequisites**:
- Product with limited stock (e.g., Product A: 10 units)
- Two browser windows/tabs or two Electron windows

**Steps**:

1. **Set up concurrent scenarios**:
   - Product A has 10 units in stock
   - Open two POS Terminal windows (Window A and Window B)

2. **Simultaneously attempt sales**:
   - **Window A**: Add Product A (quantity: 8) → Complete payment
   - **Window B**: Add Product A (quantity: 5) → Complete payment
   - Try to complete both as close to simultaneously as possible

3. **Verify only one succeeds**:
   - ✅ One order should complete successfully
   - ✅ The other should fail with "Insufficient stock" error (after first order completes)
   - ✅ Final stock should be: 10 - 8 = 2 (or 10 - 5 = 5, depending on which completed first)

4. **Database verification**:
   ```sql
   -- Check final stock
   SELECT quantity FROM stock_balances 
   WHERE product_id = '<product-id>';
   
   -- Check all stock_moves for the product
   SELECT 
     sm.id,
     sm.quantity,
     sm.before_quantity,
     sm.after_quantity,
     sm.reference_id as order_id,
     o.order_number,
     sm.created_at
   FROM stock_moves sm
   LEFT JOIN orders o ON sm.reference_id = o.id
   WHERE sm.product_id = '<product-id>'
   AND sm.reference_type = 'order'
   ORDER BY sm.created_at DESC
   LIMIT 5;
   ```

**Expected Results**:
- ✅ Transaction safety: Only one order completes
- ✅ No overselling: Stock cannot go negative
- ✅ Proper error handling: Second order fails with clear error
- ✅ Database integrity: Stock balances match sum of movements
- ✅ Concurrency safety: WAL mode + transactions prevent race conditions

---

## Post-Test Database Verification

After all tests, run consistency checks:

```bash
# Run all verification queries
sqlite3 <path-to-userData>/pos.db < electron/db/verify_stock.sql
```

Expected results:
- ✅ All consistency checks pass (0 rows for inconsistencies)
- ✅ No negative stock (when negative stock disabled)
- ✅ All sales have corresponding movements
- ✅ Stock balances match sum of movements

---

## Common Issues and Troubleshooting

### Issue: Stock not updating in UI

**Solution**:
- Check if `productUpdateEmitter.emit()` is called after operations
- Verify `useProducts` hook is subscribed to emitter
- Manually refresh Products page
- Check browser console for errors

### Issue: "Insufficient stock" error even when stock exists

**Possible causes**:
- Concurrent sale completed between check and order completion
- Warehouse mismatch (product stock in different warehouse)
- `track_stock` flag disabled for product

**Solution**:
- Verify warehouse_id matches
- Check product's `track_stock` setting
- Verify stock_balances record exists for product+warehouse

### Issue: Stock inconsistencies in database

**Solution**:
- Run verification queries from `verify_stock.sql`
- Check for missing stock_moves records
- Verify all operations use transactions
- Check for manual database modifications

### Issue: Concurrent test fails (both orders complete)

**Possible causes**:
- Transactions not properly isolated
- WAL mode not enabled
- Missing busy_timeout setting

**Solution**:
- Verify database pragmas: `journal_mode = WAL`, `busy_timeout = 5000`
- Check that all operations use `db.transaction()`
- Verify better-sqlite3 version supports WAL mode

---

## Test Results Template

Use this template to document test results:

```
## Test Results - [Date]

| Test # | Test Name | Status | Notes |
|--------|-----------|--------|-------|
| 1 | Single Product Sale | ✅ PASS / ❌ FAIL | |
| 2 | Multi-Product Order | ✅ PASS / ❌ FAIL | |
| 3 | Insufficient Stock Prevention | ✅ PASS / ❌ FAIL | |
| 4 | Returns Increase Stock | ✅ PASS / ❌ FAIL | |
| 5 | Purchase Receipt Increases Stock | ✅ PASS / ❌ FAIL | |
| 6 | UI Refresh Shows Updated Stock | ✅ PASS / ❌ FAIL | |
| 7 | Concurrent Sales Test | ✅ PASS / ❌ FAIL | |

**Database Consistency Checks**:
- ✅ All checks passed / ❌ Issues found (see details below)

**Issues Found**:
[Describe any issues encountered]

**Environment**:
- Electron version: [version]
- Database path: [path]
- Test user: [user]
- Test date: [date]
```

---

## Notes

- Always verify database state after each test
- Keep Products page open during tests to observe real-time updates
- Use test products with easily identifiable names (e.g., "TEST-Product-A")
- Clean up test data after testing if needed
- Document any deviations from expected behavior





















































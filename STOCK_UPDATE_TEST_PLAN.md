# Stock Update Fix - Test Plan (SQLite/Electron)

## Test Environment Setup

1. **Database**: SQLite with WAL mode enabled
2. **Backend**: Electron main process (better-sqlite3)
3. **Frontend**: React app using IPC communication

## Test Cases

### Test 1: Stock Decreases on Order Completion ✅

**Objective:** Verify stock decreases when order is completed

**Steps:**
1. Note initial stock for a product (e.g., Product A has 100 units)
2. Create an order with Product A, quantity 5
3. Complete the order via POS terminal
4. Check stock balance - should be 95 units
5. Check inventory movements - should have one OUT movement for 5 units

**Expected Result:**
- Stock decreased from 100 to 95
- Movement record created with `move_type='sale'`, `quantity=-5`
- Order status is 'completed'

**Backend Verification:**
```sql
-- Check stock balance
SELECT quantity FROM stock_balances WHERE product_id = ? AND warehouse_id = ?;

-- Check movements
SELECT * FROM stock_moves WHERE product_id = ? AND reference_type = 'order' ORDER BY created_at DESC LIMIT 1;
```

---

### Test 2: Multiple Products in One Order ✅

**Objective:** Verify all products' stocks decrease correctly

**Steps:**
1. Note initial stocks: Product A = 100, Product B = 50, Product C = 75
2. Create order with:
   - Product A: quantity 10
   - Product B: quantity 5
   - Product C: quantity 3
3. Complete order
4. Check stocks

**Expected Result:**
- Product A: 100 → 90
- Product B: 50 → 45
- Product C: 75 → 72
- Three movement records created

---

### Test 3: Insufficient Stock Prevention ✅

**Objective:** Verify orders cannot be completed if stock is insufficient

**Steps:**
1. Ensure Product A has stock of 10 units
2. Try to create order with Product A, quantity 15
3. Complete order

**Expected Result:**
- Error thrown: "Insufficient stock for [Product Name]. Available: 10, Requested: 15"
- Order not created (transaction rolled back)
- Stock remains 10 units
- No movement records created

**Backend Verification:**
- Check error message includes product name and quantities
- Verify transaction rollback (no order in database)

---

### Test 4: Sales Return Increases Stock ✅

**Objective:** Verify stock increases when return is created

**Steps:**
1. Complete an order: Product A, quantity 5 (stock becomes 95)
2. Create return for the same order, returning 3 units of Product A
3. Check stock balance

**Expected Result:**
- Stock increased from 95 to 98
- Movement record created with `move_type='return'`, `quantity=3`
- Return status is 'completed'

**Backend Verification:**
```sql
-- Check stock balance
SELECT quantity FROM stock_balances WHERE product_id = ?;

-- Check return movement
SELECT * FROM stock_moves WHERE move_type = 'return' ORDER BY created_at DESC LIMIT 1;
```

---

### Test 5: Purchase Receipt Increases Stock ✅

**Objective:** Verify stock increases when goods are received

**Steps:**
1. Create purchase order: Product A, ordered_qty 20
2. Receive goods: quantity 20
3. Check stock balance

**Expected Result:**
- Stock increased by 20 units
- Movement record created with `move_type='purchase'`, `quantity=20`
- PO status is 'received'

**Backend Verification:**
```sql
-- Check stock balance
SELECT quantity FROM stock_balances WHERE product_id = ?;

-- Check purchase movement
SELECT * FROM stock_moves WHERE move_type = 'purchase' ORDER BY created_at DESC LIMIT 1;
```

---

### Test 6: Partial Purchase Receipt ✅

**Objective:** Verify partial receiving increases stock correctly

**Steps:**
1. Create purchase order: Product A, ordered_qty 20
2. Receive goods: quantity 10 (partial)
3. Check stock and PO status
4. Receive remaining 10
5. Check stock and PO status

**Expected Result:**
- First receipt: Stock increased by 10, PO status 'partially_received'
- Second receipt: Stock increased by another 10, PO status 'received'
- Total stock increase: 20 units
- Two movement records created

---

### Test 7: Transaction Safety (Error Handling) ✅

**Objective:** Verify transaction rollback on error

**Steps:**
1. Create order with multiple products
2. Ensure one product has insufficient stock
3. Try to complete order

**Expected Result:**
- Transaction rolls back completely
- No order created
- No stock changes
- No movements logged
- Error returned to frontend

---

### Test 8: UI Reflects Updates After Refresh ✅

**Objective:** Verify frontend shows updated stock after operations

**Steps:**
1. Complete an order (stock decreases)
2. Navigate to Products page
3. Check product stock displayed
4. Hard refresh (Ctrl+F5)
5. Check stock again

**Expected Result:**
- Stock shown is correct (decreased)
- After refresh, stock still correct
- Product update emitter triggered

**Frontend Verification:**
- Check React Query cache invalidation
- Verify `productUpdateEmitter.emit()` called
- Check network/devtools for IPC calls

---

### Test 9: Concurrent Sales (Race Condition Prevention) ✅

**Objective:** Verify concurrent orders don't cause stock inconsistencies

**Steps:**
1. Set Product A stock to 100
2. Simultaneously create two orders:
   - Order 1: Product A, quantity 60
   - Order 2: Product A, quantity 50
3. Complete both orders at the same time (or quickly in succession)
4. Check final stock

**Expected Result:**
- One order succeeds, one fails with insufficient stock
- Final stock is 40 (100 - 60) or 50 (100 - 50), NOT negative
- No race condition occurred

**Backend Verification:**
- Check that transactions are properly serialized
- Verify only one order completed
- Check stock is not negative

**Note:** This test verifies that SQLite WAL mode + transactions prevent race conditions. With better-sqlite3, write transactions are serialized, so this should work correctly.

---

### Test 10: Negative Stock Setting ✅

**Objective:** Verify `allow_negative_stock` setting works

**Steps:**
1. Set `allow_negative_stock = 1` in settings
2. Set Product A stock to 10
3. Create order with Product A, quantity 20
4. Complete order
5. Check stock (should be -10)
6. Set `allow_negative_stock = 0`
7. Try to create another order with Product A, quantity 5
8. Should fail

**Expected Result:**
- When allowed: Stock goes negative (-10)
- When not allowed: Order fails with insufficient stock error

---

### Test 11: Inventory Movement Logging Completeness ✅

**Objective:** Verify all stock changes create movement records

**Steps:**
1. Complete multiple operations:
   - Sale (order)
   - Return
   - Purchase receipt
   - Stock adjustment
2. Check stock_moves table

**Expected Result:**
- Each operation creates exactly one movement record per product
- Movement records have correct:
  - `move_type` (sale/return/purchase/adjustment)
  - `quantity` (positive/negative)
  - `before_quantity` and `after_quantity`
  - `reference_type` and `reference_id`
  - `reason`

**Backend Verification:**
```sql
-- Get all movements for a product
SELECT 
  move_type,
  quantity,
  before_quantity,
  after_quantity,
  reference_type,
  reference_id,
  reason,
  created_at
FROM stock_moves
WHERE product_id = ?
ORDER BY created_at DESC;
```

---

### Test 12: Stock Adjustment ✅

**Objective:** Verify stock adjustments work correctly

**Steps:**
1. Set Product A stock to 100
2. Create adjustment: increase by 20
3. Check stock (should be 120)
4. Create adjustment: decrease by 10
5. Check stock (should be 110)

**Expected Result:**
- Adjustments update stock correctly
- Movement records created for each adjustment
- Adjustment document created

---

## Performance Tests

### Test 13: Order Completion Performance ✅

**Objective:** Verify order completion time is acceptable

**Steps:**
1. Create order with 10 products
2. Measure time from `completePOSOrder` call to response
3. Repeat 10 times

**Expected Result:**
- Average completion time < 1 second
- No timeouts or deadlocks

---

## Database Verification Queries

### Check Stock Consistency
```sql
-- Compare stock_balances with sum of movements
SELECT 
  sb.product_id,
  sb.warehouse_id,
  sb.quantity as balance_quantity,
  COALESCE(SUM(sm.quantity), 0) as calculated_from_movements,
  (sb.quantity - COALESCE(SUM(sm.quantity), 0)) as difference
FROM stock_balances sb
LEFT JOIN stock_moves sm ON sm.product_id = sb.product_id AND sm.warehouse_id = sb.warehouse_id
GROUP BY sb.product_id, sb.warehouse_id
HAVING difference != 0;
-- Should return 0 rows (no discrepancies)
```

### Check for Negative Stock (when not allowed)
```sql
SELECT * FROM stock_balances 
WHERE quantity < 0 
AND product_id IN (
  SELECT id FROM products WHERE track_stock = 1
);
-- Should return 0 rows when allow_negative_stock = 0
```

### Verify All Sales Have Movements
```sql
-- Find orders without corresponding movements
SELECT o.id, o.order_number
FROM orders o
INNER JOIN order_items oi ON oi.order_id = o.id
INNER JOIN products p ON p.id = oi.product_id
WHERE o.status = 'completed'
AND p.track_stock = 1
AND NOT EXISTS (
  SELECT 1 FROM stock_moves sm
  WHERE sm.reference_type = 'order'
  AND sm.reference_id = o.id
  AND sm.product_id = oi.product_id
);
-- Should return 0 rows
```

---

## Test Execution Checklist

- [ ] Test 1: Stock decreases on order completion
- [ ] Test 2: Multiple products in one order
- [ ] Test 3: Insufficient stock prevention
- [ ] Test 4: Sales return increases stock
- [ ] Test 5: Purchase receipt increases stock
- [ ] Test 6: Partial purchase receipt
- [ ] Test 7: Transaction safety
- [ ] Test 8: UI reflects updates
- [ ] Test 9: Concurrent sales
- [ ] Test 10: Negative stock setting
- [ ] Test 11: Inventory movement logging
- [ ] Test 12: Stock adjustment
- [ ] Test 13: Performance

---

## Test Results Template

| Test | Status | Notes | Date |
|------|--------|-------|------|
| 1 | ⏳ Pending | | |
| 2 | ⏳ Pending | | |
| 3 | ⏳ Pending | | |
| ... | | | |

---

## Success Criteria

All tests must pass with:
- ✅ Correct stock updates
- ✅ Movement records created
- ✅ No negative stock (when not allowed)
- ✅ Transaction safety maintained
- ✅ No race conditions
- ✅ UI updates correctly





















































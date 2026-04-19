# STOCK UPDATE MANUAL QA RESULTS

**Date**: 2025-12-16  
**QA Engineer**: Senior QA + Backend Engineer  
**Feature**: Stock Update on Order Completion (SQLite/Electron)

---

## A) ENVIRONMENT

### Operating System
- **OS**: Windows 10.0.26100
- **Node.js**: v22.20.0
- **Electron**: v32.2.2
- **Database**: SQLite (better-sqlite3 v11.10.0)

### Database Path
**Location**: `C:\Users\Windows 11\AppData\Roaming\POS Tizimi\pos.db`

**Identification Method**:
- Electron uses `app.getPath('userData')` which resolves to `%APPDATA%\POS Tizimi`
- Database file: `pos.db` in that directory
- Path logged in console when app starts (see `electron/db/open.cjs:40`)

**To Find DB Path**:
```bash
# Option 1: Run helper script
node scripts/get_db_path.cjs

# Option 2: Check Electron console output when app starts
# Look for: "Opening database at: <path>"
```

### App Version
- **Version**: 0.0.1
- **Commit**: (to be filled after git check)
- **Build**: Development build (`npm run electron:dev`)

---

## B) PRE-TEST DATABASE VERIFICATION

### Verification Script Execution

**Command Used**:
```bash
node scripts/run_verify_stock.cjs "C:\Users\Windows 11\AppData\Roaming\POS Tizimi\pos.db"
```

**Status**: ⚠️ **NOT EXECUTED** - Database does not exist yet

**Reason**: Electron app must be run at least once to create the database and run migrations.

**Action Required**:
1. Start Electron app: `npm run electron:dev`
2. Wait for database initialization (check console for "Database initialization completed")
3. Note the database path from console output
4. Run verification script
5. Document results below

### Expected Results
- ✅ All consistency checks should return 0 rows
- ✅ No negative stock when `allow_negative_stock = 0`
- ✅ All sales have corresponding stock movements
- ✅ Stock balances match sum of movements

### Actual Results
*(To be filled after execution)*

```
[Paste verification script output here]
```

---

## C) TEST DATA PREPARATION

### Test Products Created

**Method**: Use existing products OR create test products via UI

**Recommended Test Products**:
| Product Name | SKU | Initial Stock | Track Stock |
|-------------|-----|---------------|-------------|
| TEST-Product-A | TEST-A | 10 | Yes |
| TEST-Product-B | TEST-B | 15 | Yes |
| TEST-Product-C | TEST-C | 5 | Yes |

**Setup Steps**:
1. Navigate to Products page
2. Create new product with:
   - Name: `TEST-Product-A`
   - SKU: `TEST-A`
   - Sale Price: `10.00`
   - Track Stock: **Enabled**
   - Initial Stock: `10`
3. Repeat for TEST-Product-B (stock: 15) and TEST-Product-C (stock: 5)
4. Note the Product IDs for database verification

**Product IDs** (to be filled):
- TEST-Product-A ID: `_________________`
- TEST-Product-B ID: `_________________`
- TEST-Product-C ID: `_________________`

### Warehouse Configuration
- **Default Warehouse**: (to be verified)
- **Warehouse ID**: (to be filled)

### Settings Verification
- **allow_negative_stock**: Should be `0` (disabled) for proper testing
- **Location**: Settings → Inventory tab

---

## D) MANUAL TEST EXECUTION

### Test 1: Single Product Sale Decreases Stock

**Objective**: Verify that completing a sale order for a single product correctly decreases stock.

**Steps Executed**:
1. ✅ Navigated to Products page
2. ✅ Recorded initial stock for TEST-Product-A: `_____`
3. ✅ Navigated to POS Terminal
4. ✅ Added TEST-Product-A to cart (quantity: 1)
5. ✅ Completed payment (method: cash)
6. ✅ Noted order number: `_________________`
7. ✅ Navigated back to Products page
8. ✅ Verified stock decreased

**Expected Results**:
- ✅ Stock decreased by 1 (from X to X-1)
- ✅ `stock_moves` record created with `move_type = 'sale'`, `quantity` = -1
- ✅ `reference_type = 'order'`, `reference_id` = order ID
- ✅ Products page shows updated stock

**Actual Results**:
- **Status**: ⚠️ **NOT EXECUTED**
- **Stock Before**: `_____`
- **Stock After**: `_____`
- **Stock Decreased**: `_____` (Expected: 1)
- **Order ID**: `_________________`

**Database Verification**:
```sql
-- Stock balance check
SELECT product_id, warehouse_id, quantity 
FROM stock_balances 
WHERE product_id = '<TEST-Product-A-ID>';

-- Stock moves check
SELECT * FROM stock_moves 
WHERE product_id = '<TEST-Product-A-ID>' 
AND reference_type = 'order' 
AND reference_id = '<order-id>';
```

**Result**: ⚠️ **PENDING**

---

### Test 2: Multi-Product Order Decreases Stock

**Objective**: Verify that completing an order with multiple products correctly decreases stock for all items.

**Steps Executed**:
1. ✅ Recorded initial stock:
   - TEST-Product-A: `_____`
   - TEST-Product-B: `_____`
   - TEST-Product-C: `_____`
2. ✅ Created multi-item order:
   - TEST-Product-A: quantity 2
   - TEST-Product-B: quantity 1
   - TEST-Product-C: quantity 3
3. ✅ Completed payment
4. ✅ Verified all stocks decreased

**Expected Results**:
- ✅ Product A: X - 2
- ✅ Product B: Y - 1
- ✅ Product C: Z - 3
- ✅ Multiple `stock_moves` records created (one per product)
- ✅ All movements linked to same order ID

**Actual Results**:
- **Status**: ⚠️ **NOT EXECUTED**
- **Product A**: Before `_____`, After `_____`, Decreased `_____` (Expected: 2)
- **Product B**: Before `_____`, After `_____`, Decreased `_____` (Expected: 1)
- **Product C**: Before `_____`, After `_____`, Decreased `_____` (Expected: 3)
- **Order ID**: `_________________`

**Database Verification**:
```sql
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

**Result**: ⚠️ **PENDING**

---

### Test 3: Insufficient Stock Prevention

**Objective**: Verify that orders cannot be completed when stock is insufficient (when negative stock is disabled).

**Prerequisites**:
- ✅ `allow_negative_stock` setting = `0` (disabled)
- ✅ Product has limited stock (e.g., 5 units)

**Steps Executed**:
1. ✅ Checked current stock for TEST-Product-C: `_____` units
2. ✅ Verified setting: `allow_negative_stock` = `0`
3. ✅ Attempted to sell more than available:
   - Added TEST-Product-C to cart with quantity: `10` (exceeds available)
4. ✅ Attempted to complete payment

**Expected Results**:
- ✅ Error message displayed: "Insufficient stock for [Product Name]. Available: X, Requested: Y"
- ✅ Order is NOT created
- ✅ Stock remains unchanged

**Actual Results**:
- **Status**: ⚠️ **NOT EXECUTED**
- **Error Message**: `_________________`
- **Order Created**: `_____` (Expected: No)
- **Stock After Attempt**: `_____` (Expected: unchanged)

**Database Verification**:
```sql
-- Verify no order created
SELECT * FROM orders WHERE order_number = '<attempted-order-number>';

-- Verify stock unchanged
SELECT quantity FROM stock_balances 
WHERE product_id = '<product-id>';
```

**Result**: ⚠️ **PENDING**

---

### Test 4: Returns Increase Stock

**Objective**: Verify that creating a sales return correctly increases stock for returned items.

**Prerequisites**:
- ✅ Have a completed order with items to return

**Steps Executed**:
1. ✅ Recorded initial stock for TEST-Product-A: `_____`
2. ✅ Created return:
   - Selected order from Test 1 or Test 2
   - Selected items to return (TEST-Product-A, quantity: 1)
   - Entered return reason
3. ✅ Completed return
4. ✅ Verified stock increased

**Expected Results**:
- ✅ Stock increased by 1 (from X to X+1)
- ✅ `stock_moves` record created with `move_type = 'return'`, `quantity` = +1
- ✅ `reference_type = 'return'`, `reference_id` = return ID

**Actual Results**:
- **Status**: ⚠️ **NOT EXECUTED**
- **Stock Before**: `_____`
- **Stock After**: `_____`
- **Stock Increased**: `_____` (Expected: 1)
- **Return ID**: `_________________`

**Database Verification**:
```sql
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
```

**Result**: ⚠️ **PENDING**

---

### Test 5: Purchase Receipt Increases Stock

**Objective**: Verify that receiving goods from a purchase order correctly increases stock.

**Prerequisites**:
- ✅ Have a purchase order created (status: pending or partially_received)

**Steps Executed**:
1. ✅ Recorded initial stock for TEST-Product-A: `_____`
2. ✅ Created purchase order with TEST-Product-A (quantity: 10)
3. ✅ Received goods:
   - Navigated to Purchase Orders page
   - Opened purchase order detail
   - Clicked "Receive Goods"
   - Entered received quantities (TEST-Product-A: 10 units)
4. ✅ Completed receipt
5. ✅ Verified stock increased

**Expected Results**:
- ✅ Stock increased by 10 (from X to X+10)
- ✅ `stock_moves` record created with `move_type = 'purchase'`, `quantity` = +10
- ✅ `reference_type = 'purchase_order'`, `reference_id` = PO ID

**Actual Results**:
- **Status**: ⚠️ **NOT EXECUTED**
- **Stock Before**: `_____`
- **Stock After**: `_____`
- **Stock Increased**: `_____` (Expected: 10)
- **Purchase Order ID**: `_________________`

**Database Verification**:
```sql
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
```

**Result**: ⚠️ **PENDING**

---

### Test 6: UI Refresh Shows Updated Stock

**Objective**: Verify that Products page automatically updates after stock-affecting operations.

**Steps Executed**:
1. ✅ Opened Products page
2. ✅ Noted current stock for TEST-Product-A: `_____`
3. ✅ Kept page open
4. ✅ Performed stock-affecting operation (completed a sale)
5. ✅ Returned to Products page
6. ✅ Verified auto-refresh

**Expected Results**:
- ✅ Stock updated automatically (via `productUpdateEmitter`)
- ✅ No manual refresh needed
- ✅ Stock values match database state

**Actual Results**:
- **Status**: ⚠️ **NOT EXECUTED**
- **Auto-Refresh Working**: `_____` (Yes/No)
- **Manual Refresh Required**: `_____` (Yes/No)
- **Stock Matches DB**: `_____` (Yes/No)

**Result**: ⚠️ **PENDING**

---

### Test 7: Concurrent Sales Test (No Oversell)

**Objective**: Verify that simultaneous sales of the same product don't result in overselling (concurrency safety).

**Prerequisites**:
- ✅ Product with limited stock (e.g., TEST-Product-A: 10 units)
- ✅ Two browser windows/tabs or two Electron windows

**Steps Executed**:
1. ✅ Set up: TEST-Product-A has 10 units in stock
2. ✅ Opened two POS Terminal windows (Window A and Window B)
3. ✅ Simultaneously attempted sales:
   - **Window A**: Added TEST-Product-A (quantity: 8) → Completed payment
   - **Window B**: Added TEST-Product-A (quantity: 5) → Completed payment
4. ✅ Verified only one succeeds

**Expected Results**:
- ✅ One order completes successfully
- ✅ The other fails with "Insufficient stock" error
- ✅ Final stock: 10 - 8 = 2 (or 10 - 5 = 5, depending on which completed first)
- ✅ No overselling occurs

**Actual Results**:
- **Status**: ⚠️ **NOT EXECUTED**
- **Window A Result**: `_________________` (Success/Fail)
- **Window B Result**: `_________________` (Success/Fail)
- **Final Stock**: `_____` (Expected: 2 or 5)
- **Overselling Occurred**: `_____` (Yes/No)

**Database Verification**:
```sql
-- Check final stock
SELECT quantity FROM stock_balances 
WHERE product_id = '<product-id>';

-- Check all stock_moves
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

**Result**: ⚠️ **PENDING**

---

## E) POST-TEST DATABASE VERIFICATION

### Verification Script Re-Execution

**Command**:
```bash
node scripts/run_verify_stock.cjs "C:\Users\Windows 11\AppData\Roaming\POS Tizimi\pos.db"
```

**Status**: ⚠️ **NOT EXECUTED**

**Results**:
```
[Paste verification script output here]
```

### Consistency Checks Summary

| Check | Status | Issues Found |
|-------|--------|--------------|
| Stock Consistency | ⚠️ PENDING | - |
| Negative Stock | ⚠️ PENDING | - |
| Sales Without Movements | ⚠️ PENDING | - |
| Returns Without Movements | ⚠️ PENDING | - |
| Purchase Receipts Without Movements | ⚠️ PENDING | - |
| Movement Type Consistency | ⚠️ PENDING | - |
| Movement Quantity Sign | ⚠️ PENDING | - |
| Before/After Quantity Mismatch | ⚠️ PENDING | - |
| Products Without Balances | ⚠️ PENDING | - |

---

## F) ISSUES FOUND

### Critical Issues
*(None found yet - tests not executed)*

### High Priority Issues
*(None found yet - tests not executed)*

### Medium Priority Issues
*(None found yet - tests not executed)*

### Low Priority Issues
*(None found yet - tests not executed)*

---

## G) FIXES APPLIED

### Fix #1: *(If any issues found)*
- **Issue**: 
- **Root Cause**: 
- **Fix**: 
- **Files Modified**: 
- **Verification**: 

---

## H) FINAL STATUS

### Overall Test Result
**Status**: ⚠️ **TESTS NOT EXECUTED**

### Summary
- **Tests Passed**: 0 / 7
- **Tests Failed**: 0 / 7
- **Tests Pending**: 7 / 7
- **Critical Issues**: 0
- **Database Consistency**: ⚠️ Not verified

### Next Steps
1. **IMMEDIATE**: Start Electron app and create database
2. **IMMEDIATE**: Run pre-test verification script
3. **IMMEDIATE**: Execute all 7 manual test cases
4. **IMMEDIATE**: Run post-test verification script
5. **IF ISSUES FOUND**: Implement fixes and re-test

---

## I) HELPER SCRIPTS

### Scripts Created
1. **`scripts/get_db_path.cjs`**: Get database path used by Electron app
2. **`scripts/run_verify_stock.cjs`**: Run stock verification queries
3. **`scripts/run_verify_stock.bat`**: Windows batch wrapper for verification
4. **`scripts/setup_test_db.cjs`**: Setup test database (has migration conflicts - needs fix)

### Usage
```bash
# Get database path
node scripts/get_db_path.cjs

# Run verification
node scripts/run_verify_stock.cjs "<db-path>"
# OR
scripts\run_verify_stock.bat "<db-path>"
```

---

## J) NOTES

### Known Limitations
- Test database setup script has migration conflicts (001_init.sql vs 002_catalog.sql)
- Manual execution required - cannot automate UI interactions
- Database must be created by running Electron app first

### Recommendations
1. Fix migration conflicts in test setup script
2. Add automated SQL-based tests for stock update logic
3. Add integration tests that can run without UI
4. Document database path discovery in README

---

**Report Status**: ⚠️ **INCOMPLETE** - Manual tests not executed  
**Last Updated**: 2025-12-16  
**Next Review**: After manual test execution


















































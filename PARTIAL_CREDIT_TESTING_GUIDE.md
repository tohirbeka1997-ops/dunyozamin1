# Partial Credit Payment - Testing Guide

## Pre-Testing Setup

### 1. Create Test Customer
1. Go to **Customers** page
2. Click "Add Customer"
3. Fill in details:
   - Name: "Test Customer - Partial Credit"
   - Phone: "998901234567"
   - Credit Limit: 1,000,000 UZS
   - Allow Debt: Yes
   - Status: Active
4. Save customer

### 2. Verify Products Available
1. Go to **Products** page
2. Ensure at least 3 products with stock > 0
3. Note product prices for calculations

### 3. Open Cashier Shift
1. Go to **POS Terminal**
2. Click "Open Shift"
3. Enter opening cash: 100,000 UZS
4. Confirm shift is open

## Test Scenarios

### Test 1: Full Credit Sale (Existing Feature - Regression Test)

**Objective:** Verify existing full credit functionality still works

**Steps:**
1. Add products to cart (Total: 500,000 UZS)
2. Select "Test Customer - Partial Credit"
3. Click "Process Payment" (F2)
4. Go to **Credit** tab
5. Leave credit amount field **empty**
6. Verify display shows:
   - Current Balance: 0 UZS
   - Order Total: 500,000 UZS
   - Credit Amount: 500,000 UZS (auto-filled)
   - New Balance: 500,000 UZS
7. Click "Sell on Credit"

**Expected Result:**
- ✅ Success toast: "Credit Sale Completed"
- ✅ Order number displayed
- ✅ New balance shown: 500,000 UZS
- ✅ Cart cleared
- ✅ Dialog closed
- ✅ Customer balance updated in database

**Verification:**
- Go to Customers page → Find customer → Balance should be 500,000 UZS

---

### Test 2: Partial Credit + Cash

**Objective:** Test partial credit with cash payment for remaining amount

**Setup:** Customer balance is now 500,000 UZS from Test 1

**Steps:**
1. Add products to cart (Total: 800,000 UZS)
2. Select "Test Customer - Partial Credit"
3. Click "Process Payment" (F2)
4. Go to **Credit** tab
5. Enter credit amount: **300000**
6. Verify display shows:
   - Current Balance: 500,000 UZS
   - Order Total: 800,000 UZS
   - Credit Amount: 300,000 UZS
   - **Remaining to Pay: 500,000 UZS** (highlighted)
   - New Balance: 800,000 UZS
7. Click "Continue with Partial Credit"
8. Verify toast: "Partial Credit Confirmed. Please collect remaining 500,000 UZS"
9. Dialog should **stay open**
10. Go to **Cash** tab
11. Enter cash received: **500000**
12. Verify change: 0 UZS
13. Click "Complete Payment"

**Expected Result:**
- ✅ Success toast: "Order Completed. 300,000 UZS on credit, 500,000 UZS paid"
- ✅ Order number displayed
- ✅ Cart cleared
- ✅ Dialog closed
- ✅ Customer balance updated to 800,000 UZS

**Verification:**
- Go to Customers page → Balance should be 800,000 UZS
- Go to Orders page → Find order → Payment Status should be "Partially Paid"
- Check order details → Credit Amount: 300,000, Paid Amount: 500,000

---

### Test 3: Partial Credit + Card

**Objective:** Test partial credit with card payment

**Setup:** Customer balance is now 800,000 UZS

**Steps:**
1. Add products to cart (Total: 600,000 UZS)
2. Select "Test Customer - Partial Credit"
3. Click "Process Payment" (F2)
4. Go to **Credit** tab
5. Enter credit amount: **200000**
6. Verify remaining to pay: 400,000 UZS
7. Click "Continue with Partial Credit"
8. Go to **Card** tab
9. Verify amount to charge: 400,000 UZS
10. Click "Complete Payment"

**Expected Result:**
- ✅ Success toast with credit and paid amounts
- ✅ Customer balance updated to 1,000,000 UZS
- ✅ Order payment status: "Partially Paid"

---

### Test 4: Partial Credit + QR Payment

**Objective:** Test partial credit with QR payment

**Setup:** Customer balance is now 1,000,000 UZS

**Steps:**
1. Add products to cart (Total: 500,000 UZS)
2. Select "Test Customer - Partial Credit"
3. Click "Process Payment" (F2)
4. Go to **Credit** tab
5. Enter credit amount: **250000**
6. Click "Continue with Partial Credit"
7. Go to **QR Pay** tab
8. Verify amount: 250,000 UZS
9. Click "Complete Payment"

**Expected Result:**
- ✅ Success toast
- ✅ Customer balance: 1,250,000 UZS
- ✅ Payment status: "Partially Paid"

---

### Test 5: Partial Credit + Mixed Payment

**Objective:** Test partial credit with multiple payment methods

**Setup:** Customer balance is now 1,250,000 UZS

**Steps:**
1. Add products to cart (Total: 1,000,000 UZS)
2. Select "Test Customer - Partial Credit"
3. Click "Process Payment" (F2)
4. Go to **Credit** tab
5. Enter credit amount: **400000**
6. Verify remaining: 600,000 UZS
7. Click "Continue with Partial Credit"
8. Go to **Mixed** tab
9. Add payment: Cash - 300,000 UZS
10. Add payment: Card - 300,000 UZS
11. Verify total paid: 600,000 UZS
12. Click "Complete Mixed Payment"

**Expected Result:**
- ✅ Success toast
- ✅ Customer balance: 1,650,000 UZS
- ✅ Payment status: "Partially Paid"
- ✅ Two payment records created (cash + card)

---

### Test 6: Credit Limit Enforcement

**Objective:** Verify credit limit is enforced

**Setup:** Customer balance is 1,650,000 UZS, Credit Limit is 1,000,000 UZS

**Steps:**
1. Add products to cart (Total: 500,000 UZS)
2. Select "Test Customer - Partial Credit"
3. Click "Process Payment" (F2)
4. Go to **Credit** tab
5. Observe:
   - Current Balance: 1,650,000 UZS
   - Credit Limit: 1,000,000 UZS
   - **Available Credit: 0 UZS** (limit already exceeded)
6. Try to enter credit amount: **100000**

**Expected Result:**
- ❌ Input should be blocked or button disabled
- ⚠️ Warning message: "Credit Limit Exceeded"
- ❌ Cannot complete credit sale
- ✅ Must use full payment (Cash/Card/QR)

**Alternative:** Reduce credit amount to 0 and pay full amount with cash

---

### Test 7: Maximum Credit Usage

**Objective:** Test using maximum available credit

**Setup:** 
1. Go to Customers page
2. Edit "Test Customer - Partial Credit"
3. Set Credit Limit: 2,000,000 UZS
4. Save

**Steps:**
1. Add products to cart (Total: 800,000 UZS)
2. Select "Test Customer - Partial Credit"
3. Click "Process Payment" (F2)
4. Go to **Credit** tab
5. Observe:
   - Current Balance: 1,650,000 UZS
   - Credit Limit: 2,000,000 UZS
   - **Available Credit: 350,000 UZS** (2,000,000 - 1,650,000)
   - Max credit for this order: 350,000 UZS (limited by available credit)
6. Enter credit amount: **350000**
7. Verify remaining: 450,000 UZS
8. Click "Continue with Partial Credit"
9. Pay remaining 450,000 UZS with cash

**Expected Result:**
- ✅ Order completed
- ✅ Customer balance: 2,000,000 UZS (exactly at limit)
- ✅ Next order will require full payment (no credit available)

---

### Test 8: Validation - Negative Credit Amount

**Objective:** Verify negative amounts are rejected

**Steps:**
1. Add products to cart
2. Select customer
3. Go to Credit tab
4. Try to enter: **-100000**

**Expected Result:**
- ❌ Input should prevent negative values
- ❌ Or show validation error

---

### Test 9: Validation - Credit Exceeds Order Total

**Objective:** Verify credit cannot exceed order total

**Steps:**
1. Add products to cart (Total: 300,000 UZS)
2. Select customer with high credit limit
3. Go to Credit tab
4. Try to enter: **500000** (more than order total)

**Expected Result:**
- ❌ Input should be blocked at 300,000 UZS
- ❌ Or show validation error

---

### Test 10: No Customer Selected

**Objective:** Verify credit requires customer selection

**Steps:**
1. Add products to cart
2. Leave customer as "Walk-in Customer"
3. Click "Process Payment"
4. Try to go to **Credit** tab

**Expected Result:**
- ❌ Credit tab should be disabled
- ⚠️ Message: "Credit sales are only available for registered customers"

---

### Test 11: Inactive Customer

**Objective:** Verify inactive customers cannot use credit

**Setup:**
1. Go to Customers page
2. Edit "Test Customer - Partial Credit"
3. Set Status: Inactive
4. Save

**Steps:**
1. Add products to cart
2. Select "Test Customer - Partial Credit"
3. Click "Process Payment"
4. Go to Credit tab

**Expected Result:**
- ❌ Button should be disabled
- ⚠️ Message: "Customer account is inactive"

**Cleanup:** Reactivate customer after test

---

### Test 12: Stock Deduction

**Objective:** Verify stock is deducted correctly for partial credit orders

**Steps:**
1. Note current stock of a product (e.g., Product A: 50 units)
2. Add 5 units of Product A to cart
3. Complete order with partial credit
4. Go to Products page
5. Check stock of Product A

**Expected Result:**
- ✅ Stock should be 45 units (50 - 5)
- ✅ Stock deducted regardless of payment method

---

### Test 13: Change Calculation with Partial Credit

**Objective:** Verify change is calculated correctly

**Steps:**
1. Add products to cart (Total: 500,000 UZS)
2. Select customer
3. Use 200,000 UZS credit
4. Remaining: 300,000 UZS
5. Pay with cash: 400,000 UZS

**Expected Result:**
- ✅ Change: 100,000 UZS
- ✅ Success message shows change amount

---

### Test 14: Cancel Partial Credit

**Objective:** Verify user can cancel partial credit and use different payment

**Steps:**
1. Add products to cart
2. Select customer
3. Go to Credit tab
4. Enter partial credit amount
5. Click "Continue with Partial Credit"
6. Press **ESC** to close dialog
7. Reopen payment dialog
8. Go to **Cash** tab
9. Pay full amount with cash (no credit)

**Expected Result:**
- ✅ Previous credit selection is cleared
- ✅ Can complete order without credit
- ✅ Customer balance unchanged

---

### Test 15: Multiple Partial Credit Orders

**Objective:** Verify multiple partial credit orders accumulate balance correctly

**Steps:**
1. Complete 3 orders with partial credit:
   - Order 1: 500,000 total, 200,000 credit
   - Order 2: 600,000 total, 300,000 credit
   - Order 3: 400,000 total, 150,000 credit
2. Check customer balance after each order

**Expected Result:**
- ✅ After Order 1: Balance = Previous + 200,000
- ✅ After Order 2: Balance = Previous + 300,000
- ✅ After Order 3: Balance = Previous + 150,000
- ✅ Total credit used: 650,000 UZS

---

## Regression Tests

### Existing Features to Verify

1. **Full Cash Payment** - Should work unchanged
2. **Full Card Payment** - Should work unchanged
3. **Full QR Payment** - Should work unchanged
4. **Mixed Payment (no credit)** - Should work unchanged
5. **Full Credit Sale** - Should work unchanged
6. **Hold Orders** - Should work with partial credit
7. **Product Search** - Should work unchanged
8. **Cart Management** - Should work unchanged
9. **Discounts** - Should work with partial credit
10. **Shift Management** - Should work unchanged

---

## Performance Tests

### Test 16: Large Order with Partial Credit

**Steps:**
1. Add 20+ products to cart
2. Use partial credit
3. Complete order

**Expected Result:**
- ✅ Order completes within 3 seconds
- ✅ No UI lag or freezing

---

### Test 17: Rapid Order Creation

**Steps:**
1. Complete 10 orders in quick succession
2. Alternate between full credit, partial credit, and full payment

**Expected Result:**
- ✅ All orders complete successfully
- ✅ Customer balance accurate
- ✅ No race conditions or errors

---

## Edge Cases

### Test 18: Zero Credit Amount

**Steps:**
1. Go to Credit tab
2. Enter credit amount: **0**
3. Complete payment

**Expected Result:**
- ✅ Should behave like regular payment (no credit)
- ✅ Payment status: "Paid"
- ✅ Customer balance unchanged

---

### Test 19: Credit Amount = Order Total

**Steps:**
1. Go to Credit tab
2. Enter credit amount equal to order total
3. Complete

**Expected Result:**
- ✅ Should behave like full credit sale
- ✅ Payment status: "On Credit"
- ✅ No additional payment required

---

### Test 20: Decimal Amounts

**Steps:**
1. Add products with decimal prices (e.g., 123.45 UZS)
2. Use partial credit with decimals (e.g., 50.50 UZS)
3. Complete order

**Expected Result:**
- ✅ Calculations accurate to 2 decimal places
- ✅ No rounding errors

---

## Reporting Tests

### Test 21: Daily Sales Report

**Steps:**
1. Complete several partial credit orders
2. Go to Reports → Daily Sales Report
3. Check totals

**Expected Result:**
- ✅ Total sales includes both credit and paid amounts
- ✅ Credit amount tracked separately
- ✅ Paid amount tracked separately

---

### Test 22: Customer Sales Report

**Steps:**
1. Go to Reports → Customer Sales Report
2. Find test customer

**Expected Result:**
- ✅ Total sales accurate
- ✅ Credit balance shown
- ✅ Payment history visible

---

### Test 23: Payment Method Breakdown

**Steps:**
1. Go to Reports → Payment Method Breakdown
2. Check credit category

**Expected Result:**
- ✅ Credit tracked as separate payment method
- ✅ Partial credit orders counted correctly

---

## Database Verification

### Test 24: Database Integrity

**Steps:**
1. Complete partial credit order
2. Check database tables:
   - `orders` table
   - `payments` table
   - `customers` table

**Expected Result:**
```sql
-- orders table
SELECT 
  order_number,
  total_amount,
  paid_amount,
  credit_amount,
  payment_status
FROM orders
WHERE order_number = 'POS-2025-XXXXXX';

-- Should show:
-- total_amount = paid_amount + credit_amount
-- payment_status = 'partially_paid'

-- customers table
SELECT balance FROM customers WHERE id = '<customer_id>';
-- Balance should match sum of all credit amounts

-- payments table
SELECT SUM(amount) FROM payments WHERE order_id = '<order_id>';
-- Should equal paid_amount (not include credit_amount)
```

---

## Test Summary Checklist

- [ ] Test 1: Full Credit Sale (Regression)
- [ ] Test 2: Partial Credit + Cash
- [ ] Test 3: Partial Credit + Card
- [ ] Test 4: Partial Credit + QR
- [ ] Test 5: Partial Credit + Mixed
- [ ] Test 6: Credit Limit Enforcement
- [ ] Test 7: Maximum Credit Usage
- [ ] Test 8: Negative Amount Validation
- [ ] Test 9: Exceeds Total Validation
- [ ] Test 10: No Customer Selected
- [ ] Test 11: Inactive Customer
- [ ] Test 12: Stock Deduction
- [ ] Test 13: Change Calculation
- [ ] Test 14: Cancel Partial Credit
- [ ] Test 15: Multiple Orders
- [ ] Test 16: Large Order Performance
- [ ] Test 17: Rapid Orders
- [ ] Test 18: Zero Credit Amount
- [ ] Test 19: Credit = Total
- [ ] Test 20: Decimal Amounts
- [ ] Test 21: Daily Sales Report
- [ ] Test 22: Customer Sales Report
- [ ] Test 23: Payment Method Breakdown
- [ ] Test 24: Database Integrity

---

## Bug Reporting Template

If you find a bug, report it with:

```
**Bug Title:** [Short description]

**Test Case:** Test #X - [Test name]

**Steps to Reproduce:**
1. [Step 1]
2. [Step 2]
3. [Step 3]

**Expected Result:**
[What should happen]

**Actual Result:**
[What actually happened]

**Screenshots:**
[If applicable]

**Environment:**
- Browser: [Chrome/Firefox/Safari]
- Date: [YYYY-MM-DD]
- User: [Cashier name]

**Additional Notes:**
[Any other relevant information]
```

---

## Post-Testing Cleanup

After completing all tests:

1. **Reset Test Customer Balance**
   - Go to Customers page
   - Edit test customer
   - Manually adjust balance to 0 (or delete and recreate)

2. **Close Cashier Shift**
   - Go to POS Terminal
   - Click "Close Shift"
   - Verify cash counts

3. **Review Test Orders**
   - Go to Orders page
   - Review all test orders
   - Verify payment statuses are correct

4. **Check Reports**
   - Verify all reports show correct data
   - Export reports for record keeping

5. **Document Results**
   - Mark all tests as passed/failed
   - Report any bugs found
   - Provide feedback for improvements

---

**Testing Status:** ⏳ Ready for Testing  
**Last Updated:** 2025-12-06  
**Version:** 1.0

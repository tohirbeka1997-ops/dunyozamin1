# POS System Testing Checklist

## Date: 2025-12-05

This document provides a comprehensive testing checklist for the POS System after all critical fixes have been applied.

---

## Pre-Testing Setup

### 1. Database State
- [ ] Supabase project is initialized
- [ ] All migrations are applied (00001 through 00015)
- [ ] Test data is loaded (optional)

### 2. Application State
- [ ] Application builds without errors (`npm run lint`)
- [ ] No TypeScript compilation errors
- [ ] All dependencies installed

### 3. User Accounts
- [ ] Admin account exists
- [ ] Manager account exists
- [ ] Cashier account exists

---

## Critical Path Testing

### Fix #1: Authentication Flow

#### Test 1.1: Login
- [ ] Navigate to login page
- [ ] Enter valid credentials
- [ ] Click "Login"
- [ ] **Expected**: Redirected to dashboard
- [ ] **Expected**: No "useAuth must be used within an AuthProvider" error

#### Test 1.2: Protected Routes
- [ ] Logout
- [ ] Try to access `/dashboard` directly
- [ ] **Expected**: Redirected to login page
- [ ] Login again
- [ ] **Expected**: Can access dashboard

#### Test 1.3: Role-Based Access
- [ ] Login as Cashier
- [ ] Try to access `/settings`
- [ ] **Expected**: Redirected to dashboard (no permission)
- [ ] Login as Admin
- [ ] Access `/settings`
- [ ] **Expected**: Can access settings page

---

### Fix #2: Dashboard Loading

#### Test 2.1: Dashboard with Empty Database
- [ ] Clear all orders, products, customers (optional)
- [ ] Navigate to dashboard
- [ ] **Expected**: Dashboard loads without crashing
- [ ] **Expected**: All metrics show 0 or empty state
- [ ] **Expected**: No error toasts appear

#### Test 2.2: Dashboard with Data
- [ ] Add some products
- [ ] Create some orders
- [ ] Navigate to dashboard
- [ ] **Expected**: Dashboard shows correct metrics
- [ ] **Expected**: Charts render properly
- [ ] **Expected**: Low stock products appear if applicable

#### Test 2.3: Dashboard Error Handling
- [ ] Disconnect internet (simulate network error)
- [ ] Refresh dashboard
- [ ] **Expected**: Dashboard shows loading state
- [ ] **Expected**: Individual metrics show error state
- [ ] **Expected**: No complete page crash
- [ ] Reconnect internet
- [ ] **Expected**: Data loads successfully

---

### Fix #3: POS Terminal Payment Flow

#### Test 3.1: Open Shift
- [ ] Navigate to POS Terminal
- [ ] **Expected**: "Open Shift" dialog appears
- [ ] Enter opening cash amount (e.g., 100,000)
- [ ] Click "Open Shift"
- [ ] **Expected**: Shift opens successfully
- [ ] **Expected**: Can now add products to cart

#### Test 3.2: Cash Payment
- [ ] Add products to cart (total: 50,000 UZS)
- [ ] Click "Process Payment"
- [ ] Select "Cash" tab
- [ ] Enter cash received: 100,000
- [ ] **Expected**: Change shows 50,000 (green)
- [ ] Click "Complete Payment"
- [ ] **Expected**: Success toast with order number and change
- [ ] **Expected**: Cart clears automatically
- [ ] **Expected**: Order appears in Orders list

#### Test 3.3: Card Payment
- [ ] Add products to cart (total: 75,000 UZS)
- [ ] Click "Process Payment"
- [ ] Select "Card" tab
- [ ] Click "Process Card Payment"
- [ ] **Expected**: Success toast with order number
- [ ] **Expected**: Cart clears automatically
- [ ] **Expected**: Order appears in Orders list

#### Test 3.4: QR Payment
- [ ] Add products to cart (total: 60,000 UZS)
- [ ] Click "Process Payment"
- [ ] Select "QR Pay" tab
- [ ] Click "Process QR Payment"
- [ ] **Expected**: Success toast with order number
- [ ] **Expected**: Cart clears automatically
- [ ] **Expected**: Order appears in Orders list

#### Test 3.5: Mixed Payment
- [ ] Add products to cart (total: 100,000 UZS)
- [ ] Click "Process Payment"
- [ ] Select "Mixed" tab
- [ ] Click "Add Cash" (adds 50,000)
- [ ] Click "Add Card" (adds 50,000)
- [ ] **Expected**: Remaining shows 0
- [ ] Click "Complete Payment"
- [ ] **Expected**: Success toast with order number
- [ ] **Expected**: Cart clears automatically
- [ ] **Expected**: Order appears in Orders list

#### Test 3.6: Insufficient Cash Error
- [ ] Add products to cart (total: 100,000 UZS)
- [ ] Click "Process Payment"
- [ ] Select "Cash" tab
- [ ] Enter cash received: 50,000
- [ ] **Expected**: Change shows -50,000 (red)
- [ ] **Expected**: "Complete Payment" button is disabled
- [ ] Enter cash received: 100,000
- [ ] **Expected**: Button becomes enabled

#### Test 3.7: Insufficient Stock Error
- [ ] Find a product with low stock (e.g., 5 units)
- [ ] Add 10 units to cart
- [ ] Click "Process Payment"
- [ ] Select "Cash" tab
- [ ] Enter sufficient cash
- [ ] Click "Complete Payment"
- [ ] **Expected**: Error toast: "Insufficient stock for [Product]. Available: 5, Required: 10"
- [ ] **Expected**: Dialog stays open
- [ ] **Expected**: Cart is NOT cleared

#### Test 3.8: Empty Cart Error
- [ ] Clear all items from cart
- [ ] Click "Process Payment"
- [ ] **Expected**: Error toast: "Cart is empty. Please add items before completing the order."

#### Test 3.9: No Active Shift Error
- [ ] Close current shift
- [ ] Try to add products to cart
- [ ] **Expected**: Error toast: "Please open a shift first"

---

### Fix #4: Database Schema Validation

#### Test 4.1: Order Creation (Database Check)
- [ ] Create an order via POS Terminal
- [ ] Check database orders table
- [ ] **Expected**: Order record exists
- [ ] **Expected**: No `returned_amount` column
- [ ] **Expected**: No `return_status` column
- [ ] **Expected**: All other columns populated correctly

#### Test 4.2: Order Detail Page
- [ ] Navigate to Orders list
- [ ] Click on an order
- [ ] **Expected**: Order detail page loads
- [ ] **Expected**: All order information displays correctly
- [ ] **Expected**: No TypeScript errors in console

#### Test 4.3: Return Detail Page
- [ ] Create a sales return
- [ ] Navigate to Returns list
- [ ] Click on a return
- [ ] **Expected**: Return detail page loads
- [ ] **Expected**: "Return Amount" shows correct value
- [ ] **Expected**: "Net Total" calculates correctly
- [ ] **Expected**: No TypeScript errors in console

---

## Integration Testing

### Inventory Integration
- [ ] Create order with product A (quantity: 5)
- [ ] Check product A stock before order
- [ ] Complete order
- [ ] Check product A stock after order
- [ ] **Expected**: Stock decreased by 5

### Customer Statistics Integration
- [ ] Note customer's total_spent and total_orders
- [ ] Create order for that customer (amount: 50,000)
- [ ] Check customer statistics
- [ ] **Expected**: total_spent increased by 50,000
- [ ] **Expected**: total_orders increased by 1

### Employee Performance Integration
- [ ] Note cashier's total_sales and total_orders
- [ ] Create order as that cashier (amount: 75,000)
- [ ] Check cashier statistics
- [ ] **Expected**: total_sales increased by 75,000
- [ ] **Expected**: total_orders increased by 1

### Payment Records Integration
- [ ] Create order with mixed payment (cash + card)
- [ ] Navigate to Payments list
- [ ] **Expected**: Two payment records exist for the order
- [ ] **Expected**: Payment amounts sum to order total

---

## Edge Cases

### Edge Case 1: Overpayment with Cash
- [ ] Add products to cart (total: 50,000)
- [ ] Enter cash received: 100,000
- [ ] Complete payment
- [ ] **Expected**: Change is 50,000
- [ ] **Expected**: Order paid_amount is 100,000
- [ ] **Expected**: Order change_amount is 50,000

### Edge Case 2: Exact Payment
- [ ] Add products to cart (total: 50,000)
- [ ] Enter cash received: 50,000
- [ ] Complete payment
- [ ] **Expected**: Change is 0
- [ ] **Expected**: Order paid_amount is 50,000
- [ ] **Expected**: Order change_amount is 0

### Edge Case 3: Mixed Payment with Overpayment
- [ ] Add products to cart (total: 100,000)
- [ ] Add cash: 60,000
- [ ] Add card: 50,000
- [ ] **Expected**: Total paid is 110,000
- [ ] **Expected**: Change is 10,000
- [ ] Complete payment
- [ ] **Expected**: Success with change amount

### Edge Case 4: Discount Application
- [ ] Add products to cart (subtotal: 100,000)
- [ ] Apply 10% discount
- [ ] **Expected**: Total is 90,000
- [ ] Complete payment
- [ ] **Expected**: Order discount_percent is 10
- [ ] **Expected**: Order discount_amount is 10,000
- [ ] **Expected**: Order total_amount is 90,000

### Edge Case 5: Customer Selection
- [ ] Add products to cart
- [ ] Select a customer
- [ ] Complete payment
- [ ] **Expected**: Order customer_id is set
- [ ] **Expected**: Customer statistics updated

### Edge Case 6: Walk-in Customer
- [ ] Add products to cart
- [ ] Leave customer as "Walk-in Customer"
- [ ] Complete payment
- [ ] **Expected**: Order customer_id is null
- [ ] **Expected**: Order completes successfully

---

## Performance Testing

### Performance 1: Large Cart
- [ ] Add 20+ different products to cart
- [ ] **Expected**: Cart renders smoothly
- [ ] Complete payment
- [ ] **Expected**: Order creation completes in < 3 seconds

### Performance 2: Multiple Orders
- [ ] Create 10 orders in quick succession
- [ ] **Expected**: All orders complete successfully
- [ ] **Expected**: No database conflicts
- [ ] **Expected**: Order numbers are sequential

### Performance 3: Dashboard with Large Dataset
- [ ] Create 100+ orders
- [ ] Navigate to dashboard
- [ ] **Expected**: Dashboard loads in < 5 seconds
- [ ] **Expected**: Charts render correctly

---

## Browser Compatibility

### Browser 1: Chrome
- [ ] Test all critical paths in Chrome
- [ ] **Expected**: All features work

### Browser 2: Firefox
- [ ] Test all critical paths in Firefox
- [ ] **Expected**: All features work

### Browser 3: Safari
- [ ] Test all critical paths in Safari
- [ ] **Expected**: All features work

### Browser 4: Edge
- [ ] Test all critical paths in Edge
- [ ] **Expected**: All features work

---

## Mobile Responsiveness

### Mobile 1: Portrait Mode
- [ ] Test POS Terminal on mobile (portrait)
- [ ] **Expected**: UI is usable
- [ ] **Expected**: Buttons are touch-friendly

### Mobile 2: Landscape Mode
- [ ] Test POS Terminal on mobile (landscape)
- [ ] **Expected**: UI adapts properly
- [ ] **Expected**: All features accessible

---

## Security Testing

### Security 1: Unauthorized Access
- [ ] Logout
- [ ] Try to access `/api/orders` directly
- [ ] **Expected**: Redirected to login or 401 error

### Security 2: Role Restrictions
- [ ] Login as Cashier
- [ ] Try to access admin-only features
- [ ] **Expected**: Access denied

### Security 3: SQL Injection
- [ ] Try to inject SQL in product search
- [ ] **Expected**: No SQL errors
- [ ] **Expected**: Input is sanitized

---

## Regression Testing

### Regression 1: Previous Features Still Work
- [ ] Products CRUD operations
- [ ] Categories CRUD operations
- [ ] Customers CRUD operations
- [ ] Sales Returns creation
- [ ] Reports generation
- [ ] Settings updates

### Regression 2: Navigation
- [ ] Test all navigation links
- [ ] **Expected**: All pages load correctly
- [ ] **Expected**: No broken links

---

## Final Validation

### Code Quality
- [x] TypeScript compilation: **NO ERRORS**
- [x] Lint check: **PASSED** (106 files)
- [x] No console errors on page load
- [x] No console warnings (except expected ones)

### Documentation
- [x] All fixes documented
- [x] User guides created
- [x] API documentation updated
- [x] Database schema documented

### Deployment Readiness
- [ ] All critical tests passed
- [ ] No blocking issues
- [ ] Performance acceptable
- [ ] Security validated

---

## Test Results Summary

### Critical Fixes Status
- [ ] Fix #1 (AuthProvider): **PASSED** / FAILED
- [ ] Fix #2 (Dashboard): **PASSED** / FAILED
- [ ] Fix #3 (POS Payment): **PASSED** / FAILED
- [ ] Fix #4 (Database Schema): **PASSED** / FAILED

### Overall Status
- [ ] **READY FOR PRODUCTION**
- [ ] **NEEDS FIXES** (list issues below)

### Issues Found
1. _[List any issues found during testing]_
2. _[...]_

### Notes
_[Add any additional notes or observations]_

---

## Sign-Off

**Tested By**: _______________  
**Date**: _______________  
**Status**: ☐ Approved  ☐ Rejected  
**Comments**: _______________

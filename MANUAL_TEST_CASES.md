# POS Tizimi - Manual Test Cases

## Test Case Format
- **ID**: Unique test case identifier
- **Module**: Feature/component being tested
- **Priority**: 🔴 Critical | 🟡 High | 🟢 Medium
- **Preconditions**: Required setup before test
- **Steps**: Detailed test steps
- **Expected Result**: What should happen
- **Status**: ✅ Pass | ❌ Fail | ⏸️ Pending

---

## Module 1: POS Terminal

### TC-POS-001: Open Shift
- **ID**: TC-POS-001
- **Module**: POS Terminal → Shift Management
- **Priority**: 🔴 Critical
- **Preconditions**: 
  - User logged in as Cashier or Admin
  - No active shift exists
- **Steps**:
  1. Navigate to POS Terminal
  2. Click "Open Shift" button
  3. Enter opening cash amount (e.g., 100000 UZS)
  4. Click "Confirm"
- **Expected Result**:
  - Shift opens successfully
  - "Open Shift" button changes to "Close Shift"
  - Opening cash amount displayed
  - Toast message: "Shift opened successfully"
- **Status**: ⏸️ Pending

### TC-POS-002: Add Product to Cart
- **ID**: TC-POS-002
- **Module**: POS Terminal → Cart
- **Priority**: 🔴 Critical
- **Preconditions**: 
  - Shift is open
  - Products exist in database
- **Steps**:
  1. Navigate to POS Terminal
  2. Click on a product in the product grid
  3. Verify product appears in cart
- **Expected Result**:
  - Product added to cart with quantity 1
  - Subtotal updates correctly
  - Cart shows product name, quantity, price, total
- **Status**: ⏸️ Pending

### TC-POS-003: Update Cart Quantity
- **ID**: TC-POS-003
- **Module**: POS Terminal → Cart
- **Priority**: 🔴 Critical
- **Preconditions**: 
  - Shift is open
  - Product in cart
- **Steps**:
  1. Navigate to POS Terminal
  2. Click quantity input for a cart item
  3. Enter new quantity (e.g., 5)
  4. Press Enter or click outside
- **Expected Result**:
  - Quantity updates
  - Line total recalculates (quantity × price)
  - Subtotal updates
  - Total updates
- **Status**: ⏸️ Pending

### TC-POS-004: Apply Line-Level Discount
- **ID**: TC-POS-004
- **Module**: POS Terminal → Discounts
- **Priority**: 🟡 High
- **Preconditions**: 
  - Shift is open
  - Product in cart with line total 10000 UZS
- **Steps**:
  1. Click discount button (Tag icon) on cart item
  2. Enter discount amount: 1000 UZS
  3. Click "Apply"
- **Expected Result**:
  - Line discount applied (1000 UZS)
  - Line total decreases to 9000 UZS
  - Order total decreases by 1000 UZS
  - Discount shown in red
- **Status**: ⏸️ Pending

### TC-POS-005: Apply Global Discount (Amount)
- **ID**: TC-POS-005
- **Module**: POS Terminal → Discounts
- **Priority**: 🟡 High
- **Preconditions**: 
  - Shift is open
  - Products in cart, subtotal = 50000 UZS
- **Steps**:
  1. Click "Chegirma" (Discount) button
  2. Select "Summa" (Amount)
  3. Enter 5000 UZS
  4. Click "Apply"
- **Expected Result**:
  - Global discount of 5000 UZS applied
  - Total decreases to 45000 UZS
  - Discount shown in order summary
- **Status**: ⏸️ Pending

### TC-POS-006: Apply Global Discount (Percentage)
- **ID**: TC-POS-006
- **Module**: POS Terminal → Discounts
- **Priority**: 🟡 High
- **Preconditions**: 
  - Shift is open
  - Products in cart, subtotal = 100000 UZS
- **Steps**:
  1. Click "Chegirma" (Discount) button
  2. Select "Foiz" (Percentage)
  3. Enter 10%
  4. Click "Apply"
- **Expected Result**:
  - Global discount of 10% = 10000 UZS applied
  - Total decreases to 90000 UZS
  - Discount shown in order summary
- **Status**: ⏸️ Pending

### TC-POS-007: Complete Sale with Cash Payment
- **ID**: TC-POS-007
- **Module**: POS Terminal → Payment
- **Priority**: 🔴 Critical
- **Preconditions**: 
  - Shift is open
  - Products in cart, total = 50000 UZS
- **Steps**:
  1. Click "To'lov" (Payment) button
  2. Select "Naqd" (Cash)
  3. Enter cash received: 60000 UZS
  4. Click "Complete Payment"
- **Expected Result**:
  - Order created successfully
  - Change calculated: 10000 UZS
  - Receipt generated
  - Cart cleared
  - Stock decreased for sold products
  - Success toast shown
- **Status**: ⏸️ Pending

### TC-POS-008: Complete Sale with Mixed Payment
- **ID**: TC-POS-008
- **Module**: POS Terminal → Payment
- **Priority**: 🔴 Critical
- **Preconditions**: 
  - Shift is open
  - Products in cart, total = 100000 UZS
- **Steps**:
  1. Click "To'lov" (Payment) button
  2. Select "Aralash" (Mixed)
  3. Add Cash: 50000 UZS
  4. Add Card: 50000 UZS
  5. Click "Complete Payment"
- **Expected Result**:
  - Order created with mixed payment
  - Both payments recorded
  - Receipt shows payment breakdown
  - Cart cleared
  - Stock decreased
- **Status**: ⏸️ Pending

### TC-POS-009: Credit Sale (Full Credit)
- **ID**: TC-POS-009
- **Module**: POS Terminal → Credit Sales
- **Priority**: 🔴 Critical
- **Preconditions**: 
  - Shift is open
  - Customer exists
  - Products in cart, total = 75000 UZS
- **Steps**:
  1. Select customer from customer selector
  2. Click "Credit Sale" button
  3. Confirm credit sale
- **Expected Result**:
  - Order created with credit payment
  - Customer balance increased by 75000 UZS
  - Order status: "On Credit"
  - Customer detail page shows updated balance
  - Stock decreased
- **Status**: ⏸️ Pending

### TC-POS-010: Partial Credit Sale
- **ID**: TC-POS-010
- **Module**: POS Terminal → Credit Sales
- **Priority**: 🔴 Critical
- **Preconditions**: 
  - Shift is open
  - Customer exists
  - Products in cart, total = 100000 UZS
- **Steps**:
  1. Select customer
  2. Click "To'lov" (Payment)
  3. Select "Aralash" (Mixed)
  4. Add Cash: 30000 UZS
  5. Enter Credit: 70000 UZS
  6. Click "Complete Payment"
- **Expected Result**:
  - Order created with mixed payment
  - Customer balance increased by 70000 UZS (credit portion)
  - Order shows: 30000 UZS paid, 70000 UZS on credit
  - Stock decreased
- **Status**: ⏸️ Pending

### TC-POS-011: Hold Order
- **ID**: TC-POS-011
- **Module**: POS Terminal → Hold Orders
- **Priority**: 🟡 High
- **Preconditions**: 
  - Shift is open
  - Products in cart
- **Steps**:
  1. Add products to cart
  2. Click "Buyurtmani saqlash" (Hold Order) button
  3. Enter order name (optional)
  4. Click "Save"
- **Expected Result**:
  - Order saved as "waiting"
  - Cart cleared
  - Toast: "Order held successfully"
  - Order appears in "Waiting Orders" list
- **Status**: ⏸️ Pending

### TC-POS-012: Restore Held Order
- **ID**: TC-POS-012
- **Module**: POS Terminal → Hold Orders
- **Priority**: 🟡 High
- **Preconditions**: 
  - Shift is open
  - Held order exists
- **Steps**:
  1. Click "Waiting Orders" button
  2. Select a held order
  3. Click "Restore" or "Continue"
- **Expected Result**:
  - Cart populated with held order items
  - Quantities and discounts restored
  - Can proceed to payment
- **Status**: ⏸️ Pending

### TC-POS-013: Stock Validation Before Sale
- **ID**: TC-POS-013
- **Module**: POS Terminal → Stock Validation
- **Priority**: 🔴 Critical
- **Preconditions**: 
  - Shift is open
  - Product with stock = 5
- **Steps**:
  1. Add product to cart
  2. Set quantity to 10 (more than stock)
  3. Click "To'lov" (Payment)
  4. Try to complete payment
- **Expected Result**:
  - Error toast: "Not enough stock for [product name]"
  - Payment blocked
  - Order not created
  - Stock unchanged
- **Status**: ⏸️ Pending

---

## Module 2: Sales & Returns

### TC-RET-001: Create Sales Return - Cash Refund
- **ID**: TC-RET-001
- **Module**: Sales Returns
- **Priority**: 🔴 Critical
- **Preconditions**: 
  - Completed order exists
  - User has access to Sales Returns
- **Steps**:
  1. Navigate to "Sotuv qaytariqlari" (Sales Returns)
  2. Click "New Sales Return"
  3. Search and select an order
  4. Select items to return
  5. Set return quantities
  6. Select reason: "Damaged Product"
  7. Select refund method: "Naqd" (Cash)
  8. Click "Qaytarishni yuborish" (Submit Return)
- **Expected Result**:
  - Return created with status "Completed"
  - Return number generated (RET-YYYYMMDD-XXXXXX)
  - Product stock increased
  - Return appears in Sales Returns list
  - Success toast shown
- **Status**: ⏸️ Pending

### TC-RET-002: Create Sales Return - Store Credit
- **ID**: TC-RET-002
- **Module**: Sales Returns → Store Credit
- **Priority**: 🔴 Critical
- **Preconditions**: 
  - Completed order exists with customer
  - Customer balance = 50000 UZS
  - Return amount = 20000 UZS
- **Steps**:
  1. Navigate to Sales Returns
  2. Create new return for order with customer
  3. Select items to return
  4. Select refund method: "Do'kon krediti" (Store Credit)
  5. Submit return
- **Expected Result**:
  - Return created successfully
  - Return status: "Completed"
  - Customer balance decreased to 30000 UZS
  - Product stock increased
  - Customer detail page shows updated balance
- **Status**: ⏸️ Pending

### TC-RET-003: Store Credit Requires Customer - Validation
- **ID**: TC-RET-003
- **Module**: Sales Returns → Validation
- **Priority**: 🔴 Critical
- **Preconditions**: 
  - Completed order exists with "Walk-in Customer" (no real customer)
- **Steps**:
  1. Navigate to Sales Returns
  2. Create new return for walk-in customer order
  3. Select items to return
  4. Select refund method: "Do'kon krediti" (Store Credit)
  5. Try to submit
- **Expected Result**:
  - Error toast: "Do'kon krediti uchun mijoz tanlanishi kerak."
  - Return not created
  - Form remains on same step
- **Status**: ⏸️ Pending

### TC-RET-004: Return Status is Completed Immediately
- **ID**: TC-RET-004
- **Module**: Sales Returns → Status
- **Priority**: 🟡 High
- **Preconditions**: 
  - Completed order exists
- **Steps**:
  1. Create and submit a sales return
  2. Navigate to Sales Returns list
  3. Verify return status
- **Expected Result**:
  - Return status is "Completed" (not "Pending")
  - "Completed" counter increases
  - Return cannot be edited (status is Completed)
- **Status**: ⏸️ Pending

---

## Module 3: Products & Inventory

### TC-INV-001: Products Page Shows Accurate Stock
- **ID**: TC-INV-001
- **Module**: Products → Stock Display
- **Priority**: 🔴 Critical
- **Preconditions**: 
  - Product exists with initial stock
  - Sales and purchases have occurred
- **Steps**:
  1. Navigate to "Mahsulotlar" (Products)
  2. Verify "Omborda" (Stock) column
  3. Note current stock value
  4. Complete a sale with this product
  5. Refresh Products page
- **Expected Result**:
  - Stock value decreases by sold quantity
  - Stock shows calculated value from inventory movements
  - Stock updates in real-time after mutations
- **Status**: ⏸️ Pending

### TC-INV-002: Purchase Order Increases Stock
- **ID**: TC-INV-002
- **Module**: Purchase Orders → Stock Update
- **Priority**: 🔴 Critical
- **Preconditions**: 
  - Supplier exists
  - Product exists with stock = 10
- **Steps**:
  1. Navigate to "Xarid buyurtmalari" (Purchase Orders)
  2. Create new purchase order
  3. Add product with quantity = 20
  4. Click "Save & Mark as Received"
  5. Navigate to Products page
- **Expected Result**:
  1. Purchase order created with status "received"
  2. Product stock increases to 30 (10 + 20)
  3. Inventory movement created (type: purchase, quantity: +20)
  4. Products page shows updated stock
- **Status**: ⏸️ Pending

### TC-INV-003: Sale Decreases Stock
- **ID**: TC-INV-003
- **Module**: POS Terminal → Stock Update
- **Priority**: 🔴 Critical
- **Preconditions**: 
  - Shift is open
  - Product exists with stock = 50
- **Steps**:
  1. Complete a sale with product, quantity = 10
  2. Navigate to Products page
  3. Verify stock
- **Expected Result**:
  1. Stock decreases to 40 (50 - 10)
  2. Inventory movement created (type: sale, quantity: -10)
  3. Products page shows updated stock immediately
- **Status**: ⏸️ Pending

### TC-INV-004: Return Increases Stock
- **ID**: TC-INV-004
- **Module**: Sales Returns → Stock Update
- **Priority**: 🔴 Critical
- **Preconditions**: 
  - Completed sale exists
  - Product stock = 40 (after sale)
- **Steps**:
  1. Create sales return for the sale
  2. Return quantity = 5
  3. Submit return
  4. Navigate to Products page
- **Expected Result**:
  1. Stock increases to 45 (40 + 5)
  2. Inventory movement created (type: return, quantity: +5)
  3. Products page shows updated stock
- **Status**: ⏸️ Pending

### TC-INV-005: Stock Adjustment
- **ID**: TC-INV-005
- **Module**: Inventory → Stock Adjustment
- **Priority**: 🟡 High
- **Preconditions**: 
  - Product exists with stock = 100
- **Steps**:
  1. Navigate to Inventory page
  2. Select product
  3. Click "Adjust Stock"
  4. Select type: "Increase"
  5. Enter quantity: 10
  6. Enter reason: "Correction"
  7. Submit
- **Expected Result**:
  1. Stock increases to 110
  2. Inventory movement created (type: adjustment, quantity: +10)
  3. Movement shows in inventory movements history
- **Status**: ⏸️ Pending

---

## Module 4: Customers & Credit

### TC-CUST-001: Create Customer
- **ID**: TC-CUST-001
- **Module**: Customers → CRUD
- **Priority**: 🟡 High
- **Preconditions**: 
  - User has access to Customers
- **Steps**:
  1. Navigate to "Mijozlar" (Customers)
  2. Click "Add Customer"
  3. Fill required fields (name, phone)
  4. Click "Save"
- **Expected Result**:
  1. Customer created successfully
  2. Customer appears in Customers list
  3. Customer balance = 0
  4. Success toast shown
- **Status**: ⏸️ Pending

### TC-CUST-002: Credit Sale Updates Customer Balance
- **ID**: TC-CUST-002
- **Module**: Customers → Balance
- **Priority**: 🔴 Critical
- **Preconditions**: 
  - Customer exists with balance = 0
  - Shift is open
- **Steps**:
  1. Complete credit sale to customer, amount = 50000 UZS
  2. Navigate to Customers page
  3. View customer detail
- **Expected Result**:
  1. Customer balance = 50000 UZS
  2. Balance badge shows "Qarz" (Debt)
  3. Customer detail page shows balance
  4. Order history shows the credit sale
- **Status**: ⏸️ Pending

### TC-CUST-003: Store Credit Refund Decreases Balance
- **ID**: TC-CUST-003
- **Module**: Customers → Balance
- **Priority**: 🔴 Critical
- **Preconditions**: 
  - Customer exists with balance = 50000 UZS
  - Completed sale exists
- **Steps**:
  1. Create sales return for customer's order
  2. Select "Do'kon krediti" refund method
  3. Return amount = 20000 UZS
  4. Submit return
  5. Navigate to Customers page
- **Expected Result**:
  1. Customer balance decreases to 30000 UZS
  2. Balance badge updated
  3. Customer detail page shows updated balance
- **Status**: ⏸️ Pending

---

## Module 5: Reports

### TC-REP-001: Daily Sales Report
- **ID**: TC-REP-001
- **Module**: Reports → Daily Sales
- **Priority**: 🟡 High
- **Preconditions**: 
  - Sales exist for today
  - User has access to Reports
- **Steps**:
  1. Navigate to "Hisobotlar" (Reports)
  2. Click "Kunlik sotuvlar" (Daily Sales)
  3. Verify data displays
  4. Change date range
  5. Verify filtered results
- **Expected Result**:
  1. Report page loads correctly
  2. Sales data displayed
  3. Totals calculated correctly
  4. Date filter works
  5. Charts render (if applicable)
- **Status**: ⏸️ Pending

### TC-REP-002: Stock Levels Report
- **ID**: TC-REP-002
- **Module**: Reports → Stock Levels
- **Priority**: 🟡 High
- **Preconditions**: 
  - Products exist with various stock levels
- **Steps**:
  1. Navigate to Reports
  2. Click "Ombordagi qoldiq" (Stock Levels)
  3. Verify stock values
- **Expected Result**:
  1. All products listed with current stock
  2. Stock values match Products page
  3. Low stock warnings shown
  4. Filters work (category, stock status)
- **Status**: ⏸️ Pending

### TC-REP-003: Customer Sales Report
- **ID**: TC-REP-003
- **Module**: Reports → Customer Sales
- **Priority**: 🟢 Medium
- **Preconditions**: 
  - Customer exists with sales
- **Steps**:
  1. Navigate to Reports
  2. Click "Mijozlar bo'yicha sotuvlar" (Customer Sales)
  3. Select customer
  4. Select date range
- **Expected Result**:
  1. Customer's sales listed
  2. Total sales calculated correctly
  3. Date filter works
  4. Export option available
- **Status**: ⏸️ Pending

---

## Module 6: Settings

### TC-SET-001: Company Profile Settings
- **ID**: TC-SET-001
- **Module**: Settings → Company
- **Priority**: 🟡 High
- **Preconditions**: 
  - User logged in as Admin
- **Steps**:
  1. Navigate to "Sozlamalar" (Settings)
  2. Click "Kompaniya" (Company) tab
  3. Update company name
  4. Update address
  5. Click "Save"
- **Expected Result**:
  1. Settings saved successfully
  2. Success toast shown
  3. Settings persist after page refresh
  4. Receipt header shows updated company name
- **Status**: ⏸️ Pending

### TC-SET-002: POS Terminal Settings
- **ID**: TC-SET-002
- **Module**: Settings → POS Terminal
- **Priority**: 🟡 High
- **Preconditions**: 
  - User logged in as Admin
- **Steps**:
  1. Navigate to Settings
  2. Click "POS Terminal" tab
  3. Toggle "Enable Hold Orders"
  4. Toggle "Low Stock Warning"
  5. Click "Save"
- **Expected Result**:
  1. Settings saved
  2. Hold orders feature enabled/disabled
  3. Low stock warnings work accordingly
- **Status**: ⏸️ Pending

### TC-SET-003: Receipt Settings
- **ID**: TC-SET-003
- **Module**: Settings → Receipt
- **Priority**: 🟢 Medium
- **Preconditions**: 
  - User logged in as Admin
- **Steps**:
  1. Navigate to Settings
  2. Click "Chek" (Receipt) tab
  3. Update header text
  4. Update footer text
  5. Click "Save"
  6. Generate test receipt
- **Expected Result**:
  1. Settings saved
  2. Receipt shows updated header/footer
  3. Custom text appears on printed receipts
- **Status**: ⏸️ Pending

---

## Test Execution Log

### Test Run: [Date]
- **Tester**: [Name]
- **Environment**: [Dev/Staging/Prod]
- **Build Version**: [Version]

### Results Summary
- Total Test Cases: 30+
- Passed: 0
- Failed: 0
- Pending: 30+

---

## Notes
- All test cases should be executed before each release
- Critical test cases (🔴) must pass before deployment
- Update status after each test execution
- Document any bugs found during testing







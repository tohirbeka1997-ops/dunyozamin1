# POS System Requirements Document (Updated Version - Purchase Orders Module Fixed)

## 1. System Name
POS System (Point of Sale Management System)

## 2. System Description
A fully functional POS system for professional retail points with complete inventory control, financial reporting, and employee activity tracking. The system operates on a centralized database and ensures real-time synchronization across all modules.

## 3. Global System Synchronization Rules
\n### 3.1 Centralized Database
The system stores all data in a single centralized database:\n- Products\n- Inventory\n- Sales / Orders
- Returns\n- Customers
- Suppliers
- Purchase Orders
- Employees
- Settings
- Audit Logs
- Held Orders

All modules read from and update the same unified data source.

### 3.2 Cross-Module Integration Rules

#### 3.2.1 Products↔ Inventory
- When a product is created, an inventory record is automatically created
- Updating product stock triggers low-stock warnings and dashboard updates
- Deleting a product is prevented if it has been used in orders

#### 3.2.2 Orders (Sales) ↔ Inventory
**When an order is completed:**
- Reduce stock based on sold quantity
- Log stock change in Inventory Movement Log
- Update dashboard statistics
- Update customer purchase history
- Update employee performance statistics
- Create payment record (summary)\n
**When an order is cancelled:**
- Restore stock\n- Mark order as voided in activity log
\n#### 3.2.3 Sales Returns ↔ Inventory
**When a return is processed:**
- Return products to stock
- Add entry to movement log (Return)\n- Reduce customer total spending
- Reduce employee performance metrics
- Update dashboard indicators

#### 3.2.4 Purchase Orders ↔ Inventory\n**When a purchase order is received:**
- Increase stock\n- Add entry to movement log (Purchase Receipt)
- Update inventory valuation
- Update dashboard and reports
\n**When a purchase order is cancelled:**
- No stock should be added
- Log the cancellation\n
#### 3.2.5 Customers ↔ Orders↔ Returns
Each customer should have:\n- Total number of purchases
- Total amount spent
- Remaining balance (if credit sales are allowed)
- List of orders\n- List of returns
- Data used in reports and dashboard

Deleting a customer is prevented if orders exist (soft delete only).

#### 3.2.6 Employees ↔ POS Terminal ↔ Orders
Each order should store:
- Cashier ID
- Terminal session\n- Timestamp
\nThe Employees module automatically receives:\n- Number of sales
- Sales amount
- Processed returns
- Errors (cancelled orders)\n- Login sessions

POS Terminal should log:
- Shift start/end\n- Session time
- Cash drawer operations linked to employee

#### 3.2.7 Settings ↔ Entire System
Settings module should directly affect module operations:
\n**POS Terminal:**
- Payment methods
- Mixed payment rules
- Auto logout\n- Receipt printing settings
- Negative stock rules
- Default tax rate
- Enable/disable Hold Order feature

**Inventory:**
- Minimum stock threshold
- Stock adjustment restrictions
\n**Orders:**
- Number format
- Tax inclusive/exclusive setting
\n**UI:**
- Language\n- Currency
- Number formatting
\nAll changes should be updated immediately system-wide.

### 3.3 Dashboard Synchronization
Dashboard should always show REAL-TIME metrics:
- Today's sales
- Today's orders
- Low-stock products
- Active customers
- Best-selling products
- Employee performance warnings
- Pending purchase orders
- Number of held orders

All calculations should be automatically recalculated after:\n- New order\n- Return\n- Inventory adjustment
- Purchase receipt
- New product added
- Settings updated

### 3.4 Reports Module Synchronization
Reports should receive real-time data from:
- Orders (sales)
- Inventory movements\n- Customers
- Purchase orders
- Employees
- Payment system
- Settings (for tax calculation, currency, language)

Each report should be correctly updated when related modules change.

### 3.5 Data Validation Rules Across Modules

**Orders:**
- Cannot sell products not in stock if settingsdo not allow\n- Cannot complete order without payment
\n**Inventory:**
- Manual adjustments require reason
- Cannot adjust below zero if restricted

**Customers:**
- Phone and email must be unique
\n**Employees:**
- Cannot delete last Admin account

**Purchase Orders:**
- Receipt cannot exceed ordered quantity
\n### 3.6 System-Wide Audit Logging
Every critical operation should write logs:
- Product create/edit/delete
- Order create, cancel\n- Return processing
- Inventory adjustments
- Customer updates
- Employee actions
- System settings changes
- Held orders save/restore/cancel

**Log format:**
- user_id
- action\n- module
- document_id
- details
- timestamp
- ip_address
\n### 3.7 Performance and Optimization Rules
- Use indexing for SKU, order numbers, customer names
- Cache dashboard data for fast loading
- Recalculate heavy reports in background if needed
\n### 3.8 Permissions and Access Control
\n**Admin:**
- Full access to all modules and settings
\n**Manager:**
- No access to:\n  - System settings
  - Employee management
  - Numbering and security settings
\n**Cashier:**
- Can only:\n  - Open POS Terminal
  - Create orders
  - Create returns
  - View products and customers
  - Save and restore held orders
- Cannot edit or delete core records

### 3.9 UI/UX Synchronization Rules
- Consistent layout across all modules
- Standard button positions (Save, Cancel, Edit)\n- Unified status indicators system-wide:\n  - Green = Completed
  - Yellow = Pending
  - Red = Cancelled / Low Stock
- Confirmation dialogs for all destructive actions

## 4. Main Functional Modules

### 4.1 Dashboard (Analytics)
- Real-time sales metrics
- Daily/weekly/monthly statistics
- Quick metrics panel
- Automatically updated metrics from all modules
- Held orders count indicator

### 4.2 POS Terminal (Cashier Window)
\n#### 4.2.1 Core Functions
- Add products via barcode scanner
- Search and select by categories
- Multiple payment methods:\n  - Cash
  - Bank card
  - Terminal
  - QR payment
  - Mixed payment (e.g., 50% card + 50% cash)
- Real-time product price modification (manager only)
- Automatic refund amount calculation
- Auto-generate receipt number (Format: POS-YYYYMMDD-#####)
- Quick Actions panel:\n  - Process payment
  - Hold order
  - View waiting orders
  - Return receipt
  - Select customer
- Offline mode capability
- Filter products by category buttons
- Colored category badges and icons
- Most-sold categories shown at top
- Select or quick-create customer (name + phone)
- Credit sales capability (if customer allowed)
- Employee login/logout system
- Shift start/end tracking
- Cashier-specific restrictions\n- Real-time read payment methods and rules from Settings module
- Each transaction automatically updates inventory, customer, and employee modules

#### 4.2.2 Hold Order (Save Order to Waiting List) Feature

**Business Scenario:**
- Customer comes to cashier, some products scanned and added to cart
- Customer asks cashier to wait while they get additional items or check something
- Cashier needs to save current cart as'held order' and continue serving other customers
- Later, when customer returns, cashier restores held order and completes payment

**Functional Requirements:**
\n**1. POS Terminal New Actions:**
- Add **'Hold Order'** button next to 'Process Payment' button
- Add **'Waiting Orders'** menu/button in top-right or POS Terminal header
\n**2. Hold Order Behavior:**
- When cashier clicks **'Hold Order'** button:
  - If cart is empty → show warning and do nothing
  - Otherwise:\n    - Open small dialog/modal:\n      - Fields:\n        - Optional'Customer name / label' (e.g., 'Person in green shirt', 'Tohirbek', 'Table3')
        - Optional note\n    - Save current cart state as **held order** without payment
    - Clear current cart on terminal (so cashier can serve next customer)
- Held order should not affect inventory or reports yet (stock not reduced, sales total not counted)

**3. Data Model:**
- Create or use `pending_orders` or `held_orders` table:\n  - id (primary key)
  - items (JSON array: product_id, name, unit_price, quantity, line_discount, etc.)
  - customer_name (nullable)
  - note (nullable)
  - created_at\n  - status ('HELD' | 'RESTORED' | 'CANCELLED')\n- Do not add to main `orders` table at this stage. Real order is created only after payment\n
**4. Waiting Orders List:**
- 'Waiting Orders' button opens modal or side panel:\n  - For each held order, show:
    - Short label: customer_name or generated name ('Order #3')
    - Time (how long ago saved)
    - Total amount preview (sum of line_subtotals)
  - Actions for each item:
    - **Restore** (Load this order into current cart)
    - **Cancel** (Delete held order if not needed)
- Support multiple held orders at once
\n**5. Restore Behavior:**
- When cashier clicks **Restore** on a held order:
  - If current cart is not empty, ask for confirmation:\n    - 'Current cart has items. Replace them with held order?'
    - Options:
      - Replace current cart\n      - Cancel\n  - After confirmation:\n    - Load held order items into shopping cart (with quantities and line discounts)
    - Load optional customer name into 'Customer' field (if linked)\n    - Delete or mark this held order as RESTORED in `pending_orders`
  - After restored, cashier can process payment via'Process Payment' as usual

**6. Cancel Behavior:**
- When cancelling a held order:
  - Show confirmation: 'Delete this held order? This cannot be undone.'
  - On confirm, delete or mark as CANCELLED in `pending_orders`
  - Should not affect inventory or reports
\n**7. UI/UX Details:**
- 'Hold Order' button style:
  - Secondary button, e.g., outlined, left of 'Process Payment'
- 'Waiting Orders' button:\n  - Icon (e.g., clock or pause) + badge with count of held orders
- Clear toast messages:\n  - Save success: 'Order moved to waiting list.'
  - Restore success: 'Held order restored to cart.'
  - Cancel: 'Held order deleted.'
\n**8. Validation:**
- Do not allow `Hold` if cart is empty
- On restore, recheck product availability:\n  - If some products deleted from catalog or stock drastically changed, handle gracefully:\n    - If product missing → show message and skip that item
    - If quantity > current max stock (if you enforce stock) → trim to available and show warning
\n**9. TypeScript and State:**
- Add types for `HeldOrder` / `PendingOrder`
- Implement hooks or state management for:\n  - `heldOrders` list
  - `saveHeldOrder`, `restoreHeldOrder`, `cancelHeldOrder`
- Ensure functions are type-safe and handle async errors (Supabase or API errors)

**Delivery:**
- Fully working'Hold / Waiting Order' system:\n  - Cashier can save current cart to waiting list
  - View all held orders in list
  - Restore any held order to cart and complete payment
  - Cancel held orders when not needed
- No impact on Inventory or Reports until payment is completed and real `order` is created

#### 4.2.3 Shopping Cart - With Per-Product Discount

**Cart Structure:**
\nEach cart item contains:
- Product name
- SKU / Barcode
- Unit price (unit_price)
- Quantity (quantity)
- Line discount (lineDiscountAmount)
- Line subtotal (line_subtotal = unit_price × quantity)
- Line total (line_total = line_subtotal - lineDiscountAmount)
\n**Per-Product Discount UI:**
\n1. **Discount control for each cart row:**
   - Each product row shows a small discount field
   - Default value: 0 (no discount)
   - Format: amount display (e.g., 5000 UZS)
   - With discount icon or'Discount' label
\n2. **Entering discount:**
   - When user clicks discount field, inline input or popover opens
   - User can enter discount value\n   - First version: amount format only\n   - Future: toggle between percentage (%) and amount\n
**Calculation Rules:**
\n```\nlet unit_price = product price
let qty = quantity
let line_subtotal = unit_price × qty\nlet line_discount = discount for product (amount, >= 0)
let line_total = line_subtotal - line_discount
```

**Constraints:**
- line_discount cannot be negative
- line_discount cannot exceed line_subtotal
- If user enters value greater than line_subtotal:\n  - Value is set equal to line_subtotal
  - Show small warning or toast
- All numbers should be handled as number type (not string)

**When quantity changes:**
- Existing line_discount is preserved
- But if new line_subtotal < existing line_discount:
  - line_discount is automatically set equal to new line_subtotal
\n**Order Summary Integration:**
\n1. **Subtotal:**
   - Sum of all line_subtotal values (before discounts)
   - Formula: sum(unit_price × quantity) for all rows

2. **Total Discount:**
   - Global order discount + sum of all line discounts
   - Formula: global_order_discount + sum(lineDiscountAmount)\n
3. **Total Amount:**
   - Subtotal - total discount
   - Formula: Subtotal - Total Discount

4. **Payment Modal:**
   - Uses final Total Amount
\n**Real-time Updates:**
- Updating line discount immediately recalculates:\n  - That row's line_total
  - Order Summary's Subtotal, Discount, and Total
- All calculations are automatic and real-time

**Tax Integration:**
- For now, line discounts are applied before tax\n- Tax logic can be updated later\n
**TypeScript Structure:**

```typescript\ninterface CartItem {
  id: string;
  productId: string;
  productName: string;
  sku: string;
  unitPrice: number;
  quantity: number;
  lineDiscountAmount: number; // default 0
  lineSubtotal: number; // unitPrice × quantity
  lineTotal: number; // lineSubtotal - lineDiscountAmount
}\n```

**Error Handling:**
- No runtime errors when cart is empty or discount fields are cleared
- If user clears discount field and leaves it empty, treat as 0
- All inputs are validated\n- Clear error messages for invalid values

**Delivery Requirements:**
- POS Terminal cart has editable discount for each product
- Order Summary and payment flow fully synchronized with line discounts and global discount
- All calculations are accurate and real-time
- UI is intuitive and touch-screen friendly

### 4.3 Products Catalog (Products Module)

#### 4.3.1 Products List Page
**Table/Grid view with columns:**
- Product image
- Product name
- SKU / Barcode
- Category
- Unit of measure (piece, kg, liter, pack, etc.)
- Purchase price
- Sale price
- Current stock
- Status (Active / Inactive)
- Actions (View, Edit, Delete)

**Features:**
- Search: by name, SKU, barcode\n- Filters:\n  - Category filter
  - Status filter
  - Low stock filter
- Pagination\n- Bulk import via Excel
- Bulk export via Excel
- 'Add Product' button
\n**Stock status colors:**
- Green → Stock sufficient
- Yellow → Low stock\n- Red → Out of stock\n
**Integration Rules:**
- When product is created, inventory record is automatically created
- When deleting product, check if used in orders\n- Stock changes reflect real-time in dashboard and reports

#### 4.3.2 Add / Edit Product Form
**General Information:**
- Product name (required)
- SKU (auto-generate + editable)
  - Format: SKU-000123
- Barcode (optional, scanner compatible)
- Category (dropdown)
- Unit of measure (piece, kg, liter, pack, etc.)
- Status (Active / Inactive)
\n**Pricing:**
- Purchase price\n- Sale price
- Profit percentage calculator
- Auto-calculate percentage when prices change
- Tax rate (optional)
\n**Inventory Settings:**
- Initial stock (allowed only on creation)
- Minimum stock warning level
- Track inventory ON/OFF
  - If OFF → product is sold but inventory is not reduced
\n**Images:**
- Upload product image (1-3 images recommended)
\n#### 4.3.3 Product Detail Page
**Top Section:**
- Image\n- Product name
- SKU / Barcode
- Category
- Current stock
- Status badge
- Sale price
- Purchase price
- Profit percentage\n\n**Activity Tabs:**
\n**1) Inventory Movements**
- All stock history:\n  - Purchase orders (incoming stock)
  - Sales (outgoing stock)
  - Returns\n  - Inventory adjustments
  - Transfers
- Columns:
  - Date
  - Type
  - Quantity (+ or –)
  - User
  - Related document number
\n**2) Sales History**
- Order ID
- Customer (optional)
- Quantity sold
- Total amount
- Profit
\n**3) Purchase History**
- Supplier
- Quantity purchased
- Price
- Document number
\n#### 4.3.4 Inventory Integration (Mandatory)
- When sale occurs → stock decreases\n- When return occurs → stock increases
- When purchase order is received → stock increases
- When inventory adjustment occurs → logs are updated
- All changes sync real-time to dashboard and reports

#### 4.3.5 Barcode System Integration
- Barcode auto-generate OR manual entry
- Barcode scanner should immediately find and add product in POS Terminal
- Create printable barcode labels (optional)

#### 4.3.6 Category Integration
- Category dropdown selection
- Filter by category
- Category colored tags (optional)

#### 4.3.7 Data Validation
- Product name required
- Warning if sale price is lower than purchase price
- SKU must be unique
- Barcode must be unique
- Initial stock cannot be negative
- Prices must be numeric values
- On delete → warning if product has sales history

#### 4.3.8 Additional Features (Optional but Recommended)
- Favorite products (star badge for POS quick access)
- Multi-store inventory sync
- Variants (size/color)
- Bundled products
- Expiration date tracking (for pharmacy/food)\n- FIFO/LIFO cost calculation (for ERP-level inventory)

### 4.4 Categories (Categories Module)

#### 4.4.1 Categories List Page
**Page Title:** Categories
\n**Table Columns:**
- Name – Category name
- Description – Optional short description
- Products Count – Number of products (recommended)\n- Created Date – Creation date
- Actions – View / Edit / Delete

**Features:**
- Search by name
- Sorting (A–Z, Z–A, newest, oldest)
- Pagination
- '+ Add Category' button
- On delete → if category has products, show warning
- Colored tag badges (optional)

#### 4.4.2 Add Category Form
**Form Fields:**
- Category Name (required)
- Description (optional)
- Color Tag (optional; for POS Terminal UI grouping)
- Icon (optional; emoji or SVG)
- Parent Category (optional → for subcategories)
\n**Validation:**
- Name required
- Must be unique
- If parent category selected → prevent circular parent/child relationships
\n**Buttons:**
- Save\n- Cancel
\n#### 4.4.3 Edit Category Page
Identical to creation form but pre-filled.\n
**Additional Features:**
- Show count of attached products
- On delete attempt:\n  - If no products → allow delete
  - If products exist → show modal:\n    - 'This category contains X products. Move them to another category before deleting.'
\n#### 4.4.4 Category Detail Page (Recommended)
**Display:**
- Name
- Description
- Created at
- Color tag
- Icon
- Parent category
- Products count
\n**Tabs:**
\n**1) Products in this Category**
- Table:\n  - Product name
  - SKU / Barcode
  - Price
  - Stock
  - Status
  - 'Open product' action (go to product detail)

**2) Activity Log**
- Created\n- Updated
- Deleted
- Products added/removed
- (For audit trail)

#### 4.4.5 Products Module Integration
Categories must be fully integrated with Products:\n- Category dropdown in product create/edit\n- Filter by category in products list
- Cannot delete category if it has products
- Category color tags shown in products list
- POS Terminal should support category-based navigation
- Example: buttons like 'Drinks', 'Snacks', 'Fruits', 'Pharmacy'

#### 4.4.6 POS Terminal Integration
POS Terminal should show:
- Category buttons\n- Products filtered by category
- Colors/icons for quick recognition
- Smart sorting: most-sold categories shown at top
\n#### 4.4.7 UI / UX Requirements
- Clean table view\n- Minimalist modern cards
- Consistent spacing with other modules
- Mobile-friendly side panel interaction
- Use colored tags for visual grouping
- Icons optional (but highly recommended for POS tablets)

#### 4.4.8 Security and Permissions
Role-based access:
- Admin and Manager: Create, edit, delete categories
- Cashier: View categories only (no edit)\n\n#### 4.4.9 Technical Requirements
**Category Table Structure:**
- id\n- name
- description\n- color\n- icon
- parent_id (nullable)
- created_at
- updated_at\n\n**Relationships:**
- One-to-many with Products
- Self-referencing parent-child categories
- Auto-sync with Inventory and POS Terminal

### 4.5 Inventory Management Module

#### 4.5.1 Inventory List Page
**Page Title:** Inventory

**Table Columns:**
- product_name – Product name
- SKU / Barcode – Product identifier
- category – Category\n- stock_quantity – Current stock quantity
- unit – Unit of measure
- cost_price – Purchase price
- inventory_value – Inventory value (stock × cost_price)
- status – In Stock / Low Stock / Out of Stock
- actions – View detail / Adjust stock\n
**Features:**
- Search: by product name or SKU
- Filters:\n  - Category\n  - Stock status (All / Low Stock / Out of Stock)
- Sorting:\n  - Name\n  - Stock quantity\n  - Inventory value
- Pagination\n- Export to Excel / PDF
\n**Stock status colors:**
- Green → In stock (sufficient stock)
- Yellow → Low stock\n- Red → Out of stock\n
**Real-time Synchronization:**
- All stock changes immediately reflect in dashboard and reports
- Low stock warnings automatically updated
\n#### 4.5.2 Inventory Detail Page
Open product-specific inventory information.

**Header Info:**
- Product image
- Product name
- SKU / Barcode
- Category
- Current stock\n- Minimum stock warning level
- Purchase price and sale price
- Inventory value

**Tabs:**

**Tab 1 — Stock Movements (Movement History)**
Complete audit trail of inventory changes.

**Columns:**
- Date and time
- Movement type:\n  - Purchase Received (+) – Purchase received
  - Sale (-) – Sale\n  - Sales Return (+) – Sales return
  - Purchase Return (-) – Purchase return
  - Inventory Adjustment (+/-) – Inventory adjustment
  - Stock Transfer (+/-) – Stock transfer\n- Quantity (with + or -)
- User
- Related document (Order #, Return #, Purchase Order #, Adjustment #)

**Movement row color logic:**
- Positive (+) → Green
- Negative (–) → Red
\n**Tab 2 — Purchase History**
**Columns:**
- Purchase order number
- Supplier
- Date
- Quantity received
- Price
- Total cost
\n**Tab 3 — Sales History**
**Columns:**
- Order number
- Customer
- Date
- Quantity sold
- Revenue
- Profit (sale price – purchase price × quantity)

#### 4.5.3 Stock Adjustment Module
**Button:** Adjust Stock

**Form Fields:**
- Adjustment type:\n  - Increase\n  - Decrease
- Quantity\n- Reason:\n  - Damaged
  - Lost
  - Correction
  - Inventory count difference
- Notes (optional)

**Validation:**
- Cannot decrease below zero
- Adjustment must be logged
\n**After Confirmation:**
- Movement added to Movement History
- Product stock updated
- Reports updated real-time
- Dashboard metrics automatically updated

#### 4.5.4 Real-Time Inventory Update Logic
Implement strict inventory logic:
\n**When sale occurs:**
```\nstock -= sold_quantity
movement: type = 'Sale', quantity = -X
update dashboard metrics
update reports
```
\n**When sales return occurs:**
```
stock += returned_quantity
movement: type = 'Sales Return', quantity = +X
update dashboard metrics\nupdate customer stats
update employee stats
```

**When purchase order is received:**\n```
stock += received_quantity
movement: type = 'Purchase Received', quantity = +X
update inventory valuation
update dashboard\n```

**When purchase is returned to supplier:**
```
stock -= returned_quantity
movement: type = 'Purchase Return', quantity = -X
```

**When stock is adjusted:**
```
stock += adjustment_quantity (positive or negative)
movement: type = 'Adjustment'\nlog user, reason, timestamp
```

All movements should be permanently stored for audit trail.

#### 4.5.5 Low Stock Alerts
**Automatic Detection:**
```
if stock_quantity <= minimal_stock:\n    show'Low Stock' badge
    add to dashboard alerts
    notify relevant users
```

**Add Global Alert Panel:**
- Show list of low-stock products
- Ability to export this list
- POS terminal should also highlight low-stock products (optional)

#### 4.5.6 Integration (MANDATORY)
\n**Products Integration:**
Products table should include:
- minimal_stock\n- track_inventory flag
- cost_price
\nInventory module always syncs with product data.

**Orders Integration:**
- When order is created → stock decreases
- When order is cancelled → stock is restored
- Partial returns adjust stock only for returned products
- All changes reflect real-time in dashboard\n
**Sales Returns Integration:**
- Returns increase stock
- Dashboard and reports automatically updated
\n**Purchase Orders Integration:**
- PO receipt increases stock
- PO return decreases stock
\n**Reports Integration:**
Inventory feeds data to:
- Inventory Valuation Report
- Stock Movement Report
- Profit & Loss report (cost-based calculation)
- Low-stock report

#### 4.5.7 Audit Trail Requirements
Each inventory operation should store:
- User\n- Timestamp
- Previous quantity
- New quantity
- Difference
- Related document

This ensures full traceability.\n
#### 4.5.8 UI/UX Requirements
- Clean modern table\n- Status badges\n- Quick filters
- Responsive layout
- Fast loading even with 10,000+ products
- Smooth navigation between Inventory → product → movements
\n#### 4.5.9 Permissions\n**Admin / Manager:**
- Full access\n- Adjust stock
- Delete adjustments (if allowed)

**Cashier:**
- View only
- No adjustment rights

#### 4.5.10 Technical Requirements
**Inventory Table Structure:**
- id
- product_id
- stock_quantity
- minimal_stock
- cost_price
- inventory_value (calculated)
- last_updated
- created_at
- updated_at

**Inventory Movements Table Structure:**
- id
- product_id
- movement_type (Sale, Purchase Received, Sales Return, Purchase Return, Adjustment, Transfer)
- quantity (positive or negative)
- before_quantity
- after_quantity
- user_id
- related_document_type\n- related_document_id\n- notes
- created_at
\n**Relationships:**
- One-to-one with Products
- One-to-many with Movements
- Auto-sync with Orders, Returns, Purchase Orders\n\n### 4.6 Orders / Receipts (Orders Module)

#### 4.6.1 Orders List Page
**Page Title:** Orders

**Table Columns:**
- order_number – Order / Receipt number (e.g., POS-20251205-00042)
- date_time – Date and time\n- cashier – Cashier / employee
- customer_name – Customer (optional, can be 'Walk-in')
- total_amount – Order total
- payment_status – Paid / Partially Paid / Unpaid
- payment_methods – Icons or text (Cash, Card, QR, Mixed)
- status – Completed / Cancelled / Returned
- actions – View, Print, Return (Sales Return)\n\n**Filters:**
- Date range (today, this week, custom)
- Cashier\n- Payment status
- Status (Completed, Cancelled, Returned)
- Payment method
- Search by order number or customer name

**Features:**
- Pagination
- Export to Excel and PDF
- Top summary metrics for selected period:\n  - total_sales_amount – Total sales amount
  - total_orders_count – Total orders count
  - average_order_value – Average order value
\n#### 4.6.2 Order Detail Page
When user clicks order row, Order Detail page or side panel opens.

**Header Block:**
- Order number
- Date and time
- POS terminal name (if multiple terminals)
- Cashier\n- Customer (with link to customer profile)
- Status badge
- Payment status badge
\n**Products Table:**
**Columns:**
- Product name
- SKU / Barcode
- Quantity
- Unit price
- Line discount (lineDiscountAmount)
- Line total\n\n**Summary Block:**
- Subtotal
- Total line discounts
- Order discount
- Total discounts (Line Discounts + Order Discount)
- Tax (if used)
- Grand total
- Amount paid
- Remaining balance (if any)

**Payments Block (Integrated with Payments Module):**
List of payments for this order:\n- Date and time
- Amount
- Method (Cash, Card, QR, Mixed)
- Reference (terminal transaction, receipt number)\n\n**Related Returns (Sales Returns):**
List of returns linked to this order:
- Return number
- Date\n- Returned amount
- Status
\n**Actions:**
- Print receipt (PDF or printer)
- Create sales return (open Sales Return form pre-filled from this order)
- Reprint / send receipt via email/WhatsApp (optional)
- Cancel order (manager only; who and when should be logged)

#### 4.6.3 Order Creation and Source
Orders are not manually created here – they come from POS Terminal:\n- Each completed sale in POS terminal automatically creates Order record
- If order is saved as'held' or 'parked', status = Pending
- When payment is completed, status = Completed
- If order is cancelled from POS, status = Voided and inventory is restored

#### 4.6.4 Integrations (Mandatory)
\n**Inventory Integration:**
- When order is Completed → stock decreases by products\n- When order is Refunded via Sales Return → stock increases\n- All changes sync real-time to dashboard and reports

**Payments Integration:**
- Each payment belongs to an order
- Payment status is calculated:\n  - Paid: total payments >= order total
  - Partially paid: total payments >0 and < order total
  - Unpaid: total payments = 0\n
**Customers Integration:**
- If customer is selected in POS, they should be shown in Orders list and detail
- Customer balances (debt, loyalty) should be updated when order is created/paid/returned
- When credit sale occurs, customer balance increases
- When payment is received, customer balance decreases
- Customer statistics updated real-time

**Sales Returns Integration:**
- From Order Detail page, user can create Sales Return record
- Order page should show list of related returns
- Order status updates based on returns:\n  - If all products returned →'Refunded'
  - If partially returned → 'Partially Refunded'
  - If no returns → stays'Completed'

**Employees Integration:**
- Each order stores cashier ID
- Employee performance statistics automatically updated
- Cancelled orders affect employee error rate

**Dashboard Integration:**
- Each new order immediately updates dashboard metrics
- Today's sales, order count, average value calculated real-time
\n#### 4.6.5Validation and Security
Only users with Manager or Admin role can:
- Cancel orders\n- Delete orders (if allowed at all)
\nChanges to orders (cancel, return) should be logged:\n- who, when, what changed
\n#### 4.6.6 UI/UX Requirements
- Clean, fast table view
- Sticky filters panel at top
- Status and payment_status with colored badges:\n  - Completed – green
  - Pending – blue
  - Voided – grey
  - Refunded – dark yellow
  - Partially Refunded – light yellow
- Mobile/Tablet friendly (but optimized for desktop)
\n### 4.7 Sales Returns Module

#### 4.7.1 Sales Returns List Page
**Page Title:** Sales Returns

**Table Columns:**
- return_number – Return number (RET-YYYYMMDD-#####)
- order_number – Original sales order number
- customer_name – Customer name
- date_time – Date and time
- returned_amount – Returned amount
- status – Pending, Completed, Cancelled\n- cashier – Cashier\n- actions – View, Print, Cancel\n
**Features:**
- Search by return number or order number
- Filters:
  - Date range
  - Customer
  - Cashier
  - Status\n- Pagination
- Export to Excel and PDF
- '+ New Sales Return' button

#### 4.7.2 Create Sales Return Page
This page allows returning products from an existing order.

**Step 1 — Select Order**
User can:\n- Search by order number\n- Scan receipt barcode (optional)
- Select from recent orders
\nAfter selection, show:
- Order number
- Customer\n- Cashier
- Date\n- Total amount
\n**Step 2 — Products to Return Table**
Auto-load all order products into table:\n\n**Columns:**
- Product name
- SKU\n- Quantity sold
- Return quantity (editable)
- Unit price
- Line total (auto-calculate)

**Validation:**
- Return quantity cannot exceed sold quantity
- If return quantity = 0 → skip product
\n**Auto-calculations:**
- line_total = unit_price × return_quantity
\n**Step 3 — Summary Block**
Show:
- Returned products subtotal
- Taxes (if used)
- Total return amount
- Customer's new balance (if customer exists)

**Step 4 — Additional Fields**
- Return reason (select: damaged, wrong product, customer dissatisfaction, etc.)
- Notes (optional)
\n**Step 5 — Actions**
- Submit return → inventory increases, order updated
- Cancel\n- Optional: Print return receipt\n
#### 4.7.3 Sales Return Detail Page
Detail view should show:
\n**Overview:**
- Return number
- Related order number
- Customer
- Cashier
- Date and time
- Status badge
- Return reason
- Notes

**Products Table:**
- Product\n- SKU
- Quantity returned
- Price
- Line total
\n**Financial Summary:**
- Total returned amount
- Order's previous total
- Order's new total
- Customer's updated balance

**Actions:**
- Print return receipt\n- Export to PDF
- Cancel return (only if inventory not yet restored)

#### 4.7.4 Inventory Integration (Mandatory)
Implement correct stock logic:

**When return is created:**
- inventory_stock += returned_quantity
- Dashboard and reports automatically updated

**Log Movement:**
Each return creates inventory record:
- type: 'Sales Return'
- product_id\n- quantity (+)
- related_return_number
- date\n- performed_by (user)
\n#### 4.7.5 Orders Integration\n**Order detail should show list of related returns**\n
**Order total should be updated after return:**
- updated_order_total = original_total - returned_amount

**Order Status:**
- If all products returned → 'Refunded'\n- If partially returned → 'Partially Refunded'
- If no returns → stays 'Completed'

#### 4.7.6 Payments Integration
If return amount should be refunded:

**System should show suggested refund amount**

Cashier selects refund method:
- Cash
- Card
- Customer account balance

**Refund should create:**
- payment_type: Refund
- amount: returned_amount
- method: selected method
\n#### 4.7.7 Customers Integration
If customer is linked:\n
**Customer balance increases by returned amount (if balance refund type)**

**Customer profile shows:**
- Related returns\n- Returned products
- Return history
\n**Customer statistics automatically updated:**
- Total purchases amount decreases
- Returns count increases
\n#### 4.7.8 Reports Integration
Sales Returns should appear in:
\n**Sales Reports:**
- Total returned amount
- Net sales\n- Return percentage
\n**Inventory Reports:**
- Returned products
- Adjustments from returns
\n**Employee Reports:**
- Returns processed by cashier
\n#### 4.7.9 UI/UX Requirements
- Clean table view
- Large inputs for quick POS workflow
- Clear warnings and validation messages
- Status color codes:\n  - Pending → Blue
  - Completed → Green
  - Cancelled → Red
\n#### 4.7.10 Numbering Policy (Mandatory)
**Return Numbering:**
- Format: RET-YYYYMMDD-#####
- Example: RET-20251205-00023

**Order-based link ensures traceability**
\n#### 4.7.11 Delete and Cancel Restrictions
- Only Manager and Admin can cancel or delete returns
- Cannot cancel return if inventory already updated
- All changes logged to audit log

#### 4.7.12 Audit Trail\nFor each return, log:
- Who created\n- When created
- From which order
- Which products returned
- How much amount returned
- Which method used for refund
- Who cancelled (if cancelled)

### 4.8 Payments\n- Multiple payment methods\n- Partial payment capability
- Terminal integration
- Advance payment (for debtor customers)
- Payment details: number, date, amount, type, note
- Refund payments\n- Customer balance integration
- Real-time read payment methods from Settings module
- Each payment linked to order and customer
- Payments auto-sync to dashboard and reports

### 4.9 Purchase Orders Module (FIXED AND FULLY IMPLEMENTED)

#### 4.9.1 Routing and Navigation
\n**Routes:**
- `/purchase-orders` → Purchase orders list page
- `/purchase-orders/new` → Create new purchase order\n- `/purchase-orders/:id` → View purchase order detail
- `/purchase-orders/:id/edit` → Edit existing purchase order
\n**Navigation Fix:**
- The'New Purchase Order' button on the list page now correctly navigates to `/purchase-orders/new` instead of redirecting to Dashboard.\n- All routes are wrapped inside the authenticated layout with proper `useAuth` / `AuthProvider` configuration (no undefined context errors).

#### 4.9.2 Purchase Order Data Model

**Database Tables:**
\n**`purchase_orders` table:**
- id (primary key)
- po_number (format: PO-YYYYMMDD-#####, e.g., PO-20251206-00015)
- supplier_id (foreign key to suppliers table)
- status (Draft / Pending / Received / Cancelled)
- order_date (date)
- expected_date (date, optional)
- total_cost (numeric)\n- notes (text, optional)
- created_by (user_id)
- created_at (timestamp)
- updated_at (timestamp)
\n**`purchase_order_items` table:**
- id (primary key)
- purchase_order_id (foreign key)\n- product_id (foreign key)
- quantity (numeric, > 0)
- unit_cost (numeric, >= 0)
- line_total (calculated: quantity × unit_cost)
\n**`inventory_movements` table (existing, reused):**
- product_id\n- quantity_change (positive for purchases)\n- movement_type = 'purchase'\n- reference_id = purchase_order_id
- created_at\n
**`suppliers` table (existing, reused):**
- Used for supplier dropdown in PO creation.\n
**TypeScript Interfaces:**
\n```typescript
interface PurchaseOrder {
  id: string;\n  po_number: string;\n  supplier_id: string;\n  supplier?: Supplier; // joined data
  status: 'Draft' | 'Pending' | 'Received' | 'Cancelled';
  order_date: string;
  expected_date?: string;
  total_cost: number;
  notes?: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}
\ninterface PurchaseOrderItem {
  id: string;\n  purchase_order_id: string;
  product_id: string;
  product?: Product; // joined data
  quantity: number;
  unit_cost: number;
  line_total: number;
}
```

#### 4.9.3 UI / UX – Purchase Order Creation Flow

**Page: `/purchase-orders/new`**\n
Implement a single-page or multi-step form:

**Section 1: Basic Info**
- **Supplier** (required, dropdown from `suppliers` table)
- **Order Date** (required, default: today)
- **Expected Date** (optional)\n- **Status** (Draft / Pending, default: Draft)
- **Notes** (optional, textarea)

**Validation:**
- Supplier is required.\n- Order date is required.
\n**Section 2: Add Products**
- **Product Search Input** (by name, SKU, or barcode)\n- **Line Items Table:**
  - Columns:\n    - Product name
    - SKU
    - Quantity (editable, numeric input, must be > 0)
    - Unit cost (editable, numeric input, must be >= 0; default = product.purchase_price)
    - Line total (calculated: quantity × unit_cost, read-only)
  - Actions:\n    - Add row (+ button)
    - Remove row (trash icon)

**Validation:**
- At least one product is required.
- Quantity must be > 0.
- Unit cost must be >= 0.
\n**Section 3: Review & Save**
- **Summary Display:**
  - Supplier name
  - Order date and expected date
  - List of items with quantities and costs
  - **Total Cost** (sum of all line_total values)
\n**Actions:**
- **'Save as Draft'** button:\n  - Insert records into `purchase_orders` and `purchase_order_items`.\n  - Do **not** affect product stock.
  - Status ='Draft'.
  - Show success toast: 'Purchase order created as draft.'
  - Navigate to `/purchase-orders/:id` (detail page).

- **'Save & Mark as Received'** button:
  - Insert records into `purchase_orders` and `purchase_order_items`.\n  - **Immediately mark as Received** (see business logic below).
  - Show success toast: 'Purchase order created and marked as received. Stock updated.'
  - Navigate to `/purchase-orders/:id` (detail page).

#### 4.9.4 Business Logic & Inventory Integration

**When a Purchase Order is saved as Draft:**
- Insert records into `purchase_orders` and `purchase_order_items`.
- Do **not** affect product stock.
- Status = 'Draft'.\n\n**When a Purchase Order is marked as Received:**
(Either directly when creating via'Save & Mark as Received', or later from detail page via 'Mark as Received' button)
\n- Update `purchase_orders.status` to 'Received'.
- For each item in `purchase_order_items`:
  - **Increase product stock:**
    ```sql
    UPDATE products
    SET stock = stock + quantity\n    WHERE id = product_id;
    ```
  - **Insert inventory movement record:**
    ```sql
    INSERT INTO inventory_movements (
      product_id,\n      quantity_change,
      movement_type,
      reference_id,
      created_at
    ) VALUES (
      product_id,
      +quantity,
      'purchase',\n      purchase_order_id,
      NOW()
    );
    ```
\n**Transaction Requirement:**
- All stock updates and inventory movement inserts must be wrapped in a **single database transaction** or **RPC function** to ensure data consistency.
- If any part fails, the entire operation should **roll back**.

**Example Supabase RPC Function (Pseudocode):**
\n```sql
CREATE OR REPLACE FUNCTION mark_purchase_order_as_received(po_id UUID)
RETURNS VOID AS $$
BEGIN
  -- Update PO status\n  UPDATE purchase_orders SET status = 'Received' WHERE id = po_id;
\n  -- For each item, update stock and log movement
  FOR item IN SELECT * FROM purchase_order_items WHERE purchase_order_id = po_id LOOP
    UPDATE products SET stock = stock + item.quantity WHERE id = item.product_id;
    INSERT INTO inventory_movements (product_id, quantity_change, movement_type, reference_id, created_at)\n    VALUES (item.product_id, item.quantity, 'purchase', po_id, NOW());
  END LOOP;
END;
$$ LANGUAGE plpgsql;\n```

**Frontend Call:**
\n```typescript
const { error } = await supabase.rpc('mark_purchase_order_as_received', { po_id: purchaseOrderId });
if (error) {
  toast.error('Failed to mark purchase order as received.');
} else {
  toast.success('Purchase order marked as received. Stock updated.');
}
```

#### 4.9.5 Purchase Orders List Page

**Page: `/purchase-orders`**\n
**Features:**
- **Filters:**
  - Search by PO number or supplier name
  - Filter by status (All / Draft / Pending / Received / Cancelled)
  - Date range filter (order_date)
\n**Table Columns:**
- **PO Number** (e.g., PO-20251206-00015)
- **Supplier** (supplier name)
- **Order Date** (formatted date)
- **Status** (colored badge):
  - Draft → Grey
  - Pending → Yellow
  - Received → Green
  - Cancelled → Red
- **Total Cost** (formatted currency)
- **Actions:**
  - **View** (eye icon) → navigate to `/purchase-orders/:id`
  - **Edit** (pencil icon) → navigate to `/purchase-orders/:id/edit` (only for Draft or Pending)\n  - **Mark as Received** (check icon) → call RPC function to mark as received (only for Pending)
  - **Cancel** (optional, does not change stock if not yet received)

**Pagination:**
- Implement pagination for large datasets.
\n**Export:**
- Export to Excel / PDF (optional).

#### 4.9.6 Detail Page and Actions

**Page: `/purchase-orders/:id`**\n
**Header Section:**
- PO Number
- Supplier name
- Order Date
- Expected Date (if any)
- Status badge
- Total Cost
- Notes (if any)
- Created by (user name)
- Created at (timestamp)\n
**Items Table:**
- Columns:
  - Product name\n  - SKU
  - Quantity
  - Unit cost
  - Line total\n\n**Actions (based on status):**
\n- **If status is 'Pending':**
  - **'Mark as Received'** button:\n    - Call RPC function to update stock and log movements.\n    - Show success toast: 'Purchase order marked as received. Stock updated.'
    - Refresh page to show updated status.
\n- **If status is 'Draft':**
  - **'Edit'** button → navigate to `/purchase-orders/:id/edit`.\n\n- **If status is 'Received' or 'Cancelled':**\n  - Read-only view (no edit or mark as received).

**Optional:**
- **'Print'** button → generate PDF of purchase order.
- **'Cancel'** button (only for Draft or Pending, does not affect stock if not yet received).

#### 4.9.7 Edit Page

**Page: `/purchase-orders/:id/edit`**

- Pre-fill form with existing PO data.
- Allow editing:\n  - Supplier\n  - Order Date
  - Expected Date
  - Status (Draft / Pending)
  - Notes
  - Line items (add/remove/edit quantities and unit costs)

**Validation:**
- Same as creation form.

**Actions:**
- **'Save Changes'** button:\n  - Update `purchase_orders` and `purchase_order_items` records.
  - Do **not** affect stock (unless status is changed to 'Received').
  - Show success toast: 'Purchase order updated.'
  - Navigate back to `/purchase-orders/:id`.

- **'Cancel'** button → navigate back without saving.

**Restriction:**
- Cannot edit if status is 'Received' or 'Cancelled'.
\n#### 4.9.8 Validation, Types, and Error Handling

**TypeScript Types:**
- Update all TypeScript interfaces for `PurchaseOrder`, `PurchaseOrderItem`, and related Supabase types.

**Validation:**
- Required fields: Supplier, Order Date, at least one product.
- Quantity must be > 0.
- Unit cost must be >= 0.
- Show user-friendly error messages for invalid inputs.

**Error Handling:**
- Handle Supabase errors gracefully.
- Show toast notifications for:\n  - Success: 'Purchase order created', 'Purchase order updated', 'Stock updated successfully'
  - Error: 'Failed to create purchase order', 'Failed to update stock'\n
**Navigation:**
- Ensure no unexpected redirects to Dashboard.
- All navigation should be intentional and correct.

#### 4.9.9 Testing Scenarios

1. **Create a Draft PO with2 products:**
   - Save as Draft.\n   - Verify: PO created, no stock changes.
\n2. **Edit Draft PO:**
   - Change quantity of one product.
   - Save.
   - Verify: PO updated, still no stock changes.

3. **Mark PO as Received:**
   - Click 'Mark as Received' button.
   - Verify:\n     - `products.stock` increases correctly for each item.
     - `inventory_movements` records are created.
     - Status changes to 'Received'.

4. **Create PO and immediately'Save & Mark as Received':**\n   - One-step creation & stock update.
   - Verify: PO created with status 'Received', stock updated.

5. **Refresh Products page:**
   - Verify: Stock column reflects new quantities.

6. **Navigate from'New Purchase Order' button:**
   - Verify: Always opens `/purchase-orders/new`, not Dashboard.

7. **Attempt to edit'Received' PO:**\n   - Verify: Edit button is disabled or not shown.

8. **Cancel a Draft PO:**
   - Verify: Status changes to 'Cancelled', no stock changes.

#### 4.9.10 Integration with Other Modules

**Inventory Module:**
- Each PO receipt increases stock and logs movement.
- Inventory movements table shows 'purchase' type entries.

**Products Module:**
- Product selector in PO creation uses products table.
- Unit cost defaults to product.purchase_price.

**Suppliers Module:**\n- Supplier dropdown in PO creation uses suppliers table.

**Reports Module:**
- Purchase Orders data feeds into:\n  - Purchase history by product
  - Supplier performance reports
  - Inventory valuation and cost analysis

**Dashboard:**
- Pending purchase orders count shown on dashboard.
- Real-time updates when PO is created or received.

#### 4.9.11 Permissions and Security

**Admin / Manager:**
- Create, edit, approve, receive, cancel POs.
\n**Cashier / Employee:**
- View only, optionally create drafts.

**Audit Logging:**
- All status changes and receipt operations logged:\n  - user, timestamp, old status, new status
\n#### 4.9.12 UI / UX Requirements

- Clean, card-based layout.
- Sticky header with key PO info.
- Products table with inline editing.
- Colored status badges:\n  - Draft – Grey
  - Pending – Yellow
  - Received – Green
  - Cancelled – Red
- Optimized for desktop (POS backoffice), tablet-friendly.\n\n#### 4.9.13Numbering Policy

**PO Number Auto-generation:**
- Format: PO-YYYYMMDD-#####
- Example: PO-20251206-00015

**Order-based link ensures traceability.**

#### 4.9.14 Technical Requirements

**Purchase Orders Table Structure:**
- id\n- po_number
- supplier_id
- status\n- order_date
- expected_date
- total_cost
- notes
- created_by
- created_at
- updated_at\n
**Purchase Order Items Table Structure:**
- id
- purchase_order_id
- product_id\n- quantity
- unit_cost
- line_total\n\n**Relationships:**
- Many-to-many with Products (via PO Items)
- One-to-many with Inventory Movements
- Many-to-one with Suppliers (if exists)

#### 4.9.15 Final Objective

- **'New Purchase Order' button opens a functional purchase order creation flow.**
- **Purchase Orders module supports full lifecycle: list, create, edit, receive.**
- **Product stock and inventory movements stay fully synchronized with purchase operations.**
- **No unexpected redirects to Dashboard.**
- **All routes and navigation work correctly.**
- **Data consistency ensured via database transactions.**
\n### 4.10 Inventory Count\n- Select warehouse\n- Enter actual quantity
- Compare with system quantity
- Auto-calculate difference and confirm
- Write to inventory movement\n- Inventory count number format: INV-YYYY-#####
- All changes sync real-time to dashboard and reports
- Full audit trail preserved\n
### 4.11 Customers Module
\n#### 4.11.1 Customers List Page
**Page Title:** Customers

**Table Columns:**
- name – Full name or company name
- phone – Primary phone\n- type – Individual / Company
- total_sales – Total purchases amount
- balance – Current balance (positive = customer debt, negative = store debt/refund)
- last_order_date – Last purchase date
- status – Active / Inactive
- actions – View / Edit / Delete\n
**Features:**
- Search by name / phone
- Filters:\n  - Type (Individual / Company)
  - Status (Active / Inactive)
  - Balance (In Debt / No Debt)
- Sorting:
  - Total sales\n  - Last order date
  - Name A–Z / Z–A
- Export to Excel / PDF
- '+ Add Customer' button

#### 4.11.2 Add / Edit Customer Form
**Basic Info:**
- name (required)
- type – Individual / Company
- phone (required, with formatting + validation)
- email (optional)
- address (optional)
\n**Company Section (visible only when type = Company):**
- company_name (if different from main name)
- tax_number / VAT / INN (optional but unique if set)
\n**Financial Settings:**
- credit_limit (optional)
- allow_debt (yes/no)
- initial_balance (default0; only on creation)

**Other:**
- notes – free text\n- status – Active / Inactive
\n**Validation:**
- Name and phone required\n- Phone unique (no duplicates)
- Tax number unique\n- Initial balance numeric
- Credit limit numeric

**Buttons:** Save, Cancel\n
#### 4.11.3 Customer Detail Page
**Layout:** header with general info + tabs.\n
**Header Block:**
- Name + type badge
- Phone, email\n- Address
- Status\n- Credit limit
- Current balance (with color):\n  - Red → customer owes store (positive balance)
  - Green → store owes customer/refund/advance payment (negative)\n  - Grey → zero balance

**Key Metrics (cards):**
- Total sales amount
- Number of orders
- Average order value
- Total returns amount
- Last order date
\n**Tab1 — Orders**
Table:\n- Order number
- Date
- Total amount
- Amount paid
- Status
- Actions → go to order detail

**Tab 2 — Payments**
Table:
- Date
- Amount
- Direction (Payment from customer / Refund to customer)\n- Method (Cash / Card / Transfer / Other)
- Related order (if any)
\nBalance calculated automatically based on orders + payments.

**Tab 3 — Returns**
Table:
- Return number
- Date
- Returned amount
- Related order\n- Status
\n**Tab 4 — Notes / Activity Log**
- Manual notes
- System events:\n  - Customer created/updated
  - Credit limit change
  - Balance adjustments
\n#### 4.11.4 POS Terminal Integration
From POS Terminal, cashier can:
- Select existing customer
- Quick-create customer (name + phone only)
\nAfter sale:
- Order linked to customer
- Balance updated if:\n  - Credit sale
  - Overpayment / advance payment
- Customer statistics updated real-time

#### 4.11.5 Balance and Debt Logic (Mandatory)
**Balance Formula:**
Balance = (Total orders for customer – Total payments from customer + Store refunds)\n
**Balance Interpretation:**
- If balance > 0 → customer debt
- If balance < 0 → store owes (advance payment or refund)
\n**Show Warning When:**
- New sale would exceed credit_limit
- Customer has allow_debt = false and cashier tries credit sale
\n#### 4.11.6 Reports Integration
Customers module feeds data to reports:
- Top customers by sales
- Most indebted customers
- Customer activity by period

#### 4.11.7 Permissions and Security
**Admin/Manager:** full access (add, edit, delete, adjust balance)
**Cashier:** view + create + edit basic fields, no delete, no direct balance edit
\n**Delete customer only allowed if:**
- No related orders, payments, or returns
- Otherwise → mark as Inactive instead of physical delete

#### 4.11.8 UI/UX Requirements
- Clean, modern table view
- Sticky search and filters panel
- Colored badges for status and balance
- Responsive layout (desktop optimized, tablet-friendly)
- Fast navigation between customer → orders → payments and back
\n#### 4.11.9 Technical Requirements
**Customers Table Structure:**
- id
- name
- type (individual/company)
- phone
- email
- address
- company_name
- tax_number
- credit_limit
- allow_debt
- initial_balance
- current_balance (calculated)
- notes
- status
- created_at
- updated_at

**Relationships:**
- One-to-many with Orders
- One-to-many with Payments
- One-to-many with Returns
- Auto-calculate balance\n
### 4.12 Employees and Roles Module

#### 4.12.1 Employees Main Page
**Page Title:** Employees

**Table Columns:**
- Name – Full name
- Role – Admin / Manager / Cashier\n- Phone – Phone number
- Email – Email address
- Status – Active / Disabled
- Last login – Last login time
- Actions – View, Edit, Deactivate

**Features:**
- Search by name, phone, or email
- Filters:
  - Role (Admin / Manager / Cashier)
  - Status (Active / Disabled)
- Pagination
- '+ Add Employee' button
\n#### 4.12.2 Add Employee Form
**Form Fields:**
- Full name (required)
- Role: Admin / Manager / Cashier (required)
- Phone number (required, validate +998 format)
- Email (optional but validated)
- Login username (required, unique)
- Password + Confirm Password\n- Status (Active / Disabled)
\n**Validation:**
- Username must be unique
- Phone must match local format
- Password length >= 6
- Changing role to Admin requires confirmation modal

**After Submit:**
- Create employee user record
- Auto-assign permissions\n\n#### 4.12.3 Edit Employee Page
**Editable Fields:**
- Name
- Role (Admin can only demote/promote managers/cashiers)
- Phone
- Email
- Status toggle
\n**Non-editable:**
- Username
- Created date
\n**Additional Actions:**
- Reset password
- Disable employee (soft delete)
- Force logout (clear active session)

#### 4.12.4 Employee Detail Page\n**Sections:**
\n**A) Profile Overview**
- Name
- Role badge
- Contact info
- Current status
- Last login
- Account created date

**B) Performance Dashboard**
- Total sales completed
- Total revenue generated
- Average order amount
- Total returns processed
- Net profit from sales
- Productivity index (AI calculated)

**Charts:**
- Daily sales chart
- Transactions count chart
- Hourly activity heatmap
\n**C) Time Tracking**
List of all login/logout:\n- Login time
- Logout time
- Session duration
- IP address

**D) Activity Log**
Audit trail:
- Created orders
- Edited orders
- Cancellations
- Returns
- Inventory adjustments
- Price changes
- Held orders saved/restored

Each entry includes:\n- Timestamp
- Action\n- Affected document ID
- Description

#### 4.12.5 POS Terminal Integration
POS Terminal supports employee-based logic:
\n**Login System:**
- Login via username/password
- Session tracking
- Employee shift start/end\n- Auto shift reports
- Cash drawer open/close records linked to employee

**Cashier Restrictions:**
- Cannot edit products
- Cannot edit settings
- Cannot delete orders
- Cannot change prices
\n**Manager:**
- Can approve discounts
- Can override low-stock sales
- Can approve returns
\n**Admin:**
- Full access\n\n#### 4.12.6Permissions & Security Layer
**Role-based Access:**
\n**Admin:**
- Full system access
- Create/edit/delete employees
- View all reports
- Change system settings

**Manager:**
- View/edit most resources
- Cannot delete employees
- Cannot change system settings
- Can approve critical actions

**Cashier:**
- Limited access
- Can create sales, returns\n- Cannot view financial reports
- Cannot edit inventory

**Backend Checks:**
- Protected employee records (cannot delete last admin)
- Strong password validation
- Account lockout after 5 failed login attempts
\n#### 4.12.7 Employee Activity Analytics
System calculates:
- Employee performance score\n- Profit contribution
- Transaction accuracy
- Error rate (cancelled/voided orders)
- Average checkout time
- Peak working hours

**Visualization:**
- Line charts\n- Bar charts
- Pie charts
\n#### 4.12.8 Export & Reporting
Export capability:
- Employees list (Excel/PDF)
- Time logs\n- Cashier performance reports
- Employee activity logs

#### 4.12.9 Technical Requirements
**Database Fields:**
- id\n- full_name
- role
- phone
- email
- username
- password_hash
- status
- last_login
- created_at
- updated_at

**Audit Log Table:**
- employee_id
- action_type
- description
- document_id
- timestamp
- ip_address
\n**Time Tracking Table:**
- employee_id\n- login_time
- logout_time
- duration
- ip_address

#### 4.12.10 UI/UX Requirements
- Clean professional layout
- Consistent color scheme
- Responsive design
- Mobile-friendly version
- Sticky table header
- Loading states and skeletons
- Empty state placeholders
- Fast navigation between employee → orders → activity and back

#### 4.12.11 Permissions\n**Admin:**
- Full access to all employee operations
- Change roles\n- Delete employees
\n**Manager:**
- View employees
- Create/edit cashiers
- No delete rights

**Cashier:**
- View own profile only
- No edit rights
\n### 4.13 Reports Module

#### 4.13.1 Reports Main Page
**Page Title:** Reports\n
**Page Sections (card view with icons):**
- Sales Reports
- Inventory Reports
- Purchase Reports
- Employee Reports
- Financial Reports
- Export Center

#### 4.13.2 Sales Reports
\n**4.13.2.1 Daily Sales Report**
\n**Table Columns:**
- Invoice number
- Date/time
- Cashier\n- Payment type (Cash / Card / Mixed)
- Total sale\n- Profit
- Status (Completed / Returned / Cancelled)
\n**Filters:**
- Date range\n- Cashier\n- Payment type
- Status

**Summary Metrics:**
- Total sales\n- Total profit
- Total returns
- Average order value\n\n**Export:**
- Excel and PDF\n\n**Real-time Synchronization:**
- All metrics automatically updated from orders and returns modules
\n**4.13.2.2 Product Sales Report**

**Table Columns:**
- Product name
- SKU
- Category
- Quantity sold
- Revenue
- Profit
\n**Features:**
- Top10 best-selling products
- Slow-moving products
- Profit margin indicators (green/red)
\n**Filters:**
- Date range
- Category
- SKU
\n**4.13.2.3 Customer Sales Report**

**Table Columns:**
- Customer\n- Total purchases
- Number of orders
- Average order value
- Outstanding balance

**Filters:**
- Customer name
- Date\n\n#### 4.13.3 Inventory Reports

**4.13.3.1 Stock Levels Report**

**Table Columns:**
- Product name
- SKU
- Current stock
- Minimum stock
- Stock status (Low / OK / Out of stock)

**Features:**
- Auto color indicators\n- Excel and PDF export
\n**4.13.3.2 Inventory Movement Report**

**Table Columns:**
- Date
- Product
- Type (Sale, Purchase, Adjustment, Return)
- Quantity change (+/-)
- Referencedocument (Order ID / Purchase Order ID)
- Performed by user

**Filters:**
- Date range
- Type
- Product

**4.13.3.3 Valuation Report**

**Table Columns:**
- Product
- SKU
- Cost price
- Quantity
- Total value (qty × price)
\n**Summary Metrics:**
- Total inventory value
- Total units in stock
\n#### 4.13.4 Purchase Reports

**4.13.4.1 Purchase Order Summary**

**Table Columns:**
- PO number
- Supplier
- Total ordered amount
- Total received amount
- Status\n- Date

**4.13.4.2 Supplier Performance Report**

**Table Columns:**
- Supplier\n- Total purchases
- On-time delivery rate
- Number of purchase orders
- Returns from supplier
- Average cost savings

#### 4.13.5 Employee Reports

**4.13.5.1 Cashier Performance**

**Table Columns:**
- Employee
- Number of sales
- Total sales amount
- Total profit
- Mistakes / voided orders
- Working hours (optional)

**4.13.5.2 Login Activity Log**

**Table Columns:**
- Employee
- Login time
- Logout time
- Duration\n- IP address

#### 4.13.6 Financial Reports

**4.13.6.1 Profit & Loss Report**

**Sections:**
- Gross sales
- Discounts (line and order discounts)
- Net sales
- Cost of goods sold - COGS
- Gross profit
- Returns\n- Final profit

**Time Periods:**
- Daily
- Weekly
- Monthly
- Custom date\n
**4.13.6.2 Payment Method Breakdown**

**Chart:**
- Cash %
- Card %
- Mixed payments %
\n**Table:**
- Payment type
- Number of transactions
- Total amount\n\n#### 4.13.7 Dashboard Analytics (Optional Add-on)

**Visual Charts:**
- Sales chart by date
- Profit chart\n- Top products\n- Stock alerts
- Purchase trends

**Chart Types:**
- Bar chart
- Line chart
- Pie chart
\n**Usage:**
- Recharts library\n- Responsive UI
\n#### 4.13.8 Export Center

**Export support for each report:**
- Excel
- PDF
- CSV
\n#### 4.13.9 Filters and Search (Global Logic)

**Each report should support:**
- Global quick search
- Date range picker
- Multi-select filters
- Pagination
- Sorting
\n#### 4.13.10 Permissions\n
**Admin:**
- Access to all reports
\n**Manager:**
- Access to sales, inventory, financial reports

**Cashier:**
- Access to personal performance report only

**Audit Logging:**
- View exports
- Create reports
\n#### 4.13.11 UI Requirements

- Clean professional layout
- Consistent color scheme
- Responsive design
- Mobile-friendly version
- Sticky table header
- Loading states and skeletons
- Empty state placeholders
\n#### 4.13.12 Real-time Synchronization
- All reports receive real-time data from related modules
- Any change (order, return, inventory adjustment) automatically updates reports
- Dashboard metrics constantly synchronized

### 4.14 Settings Module

#### 4.14.1 Settings Main Page Layout
**Page Title:** Settings

**Page Structure:**
Left or top tabs/sections navigation, right side forms.\n
**Sections (Tabs):**
1. Company Profile
2. POS Terminal Settings
3. Payments & Taxes
4. Receipts & Printing
5. Inventory Settings
6. Numbering & IDs
7. User & Security
8. Localization
9. Backup & Data Management (optional)
\n#### 4.14.2 Company Profile

**Fields:**
- Company name (required)
- Legal name (optional)
- Logo upload\n- Address (country, city, street)
- Phone number
- Email
- Website (optional)
- Tax ID / INN / VAT number (optional)
\n**Validation:**
- Required fields cannot be empty
- Email formatting\n- Phone format (e.g., +998 XX XXX XX XX)
\n**Usage:**
Company info used in:\n- Receipts
- Invoices\n- Reports
\n#### 4.14.3 POS Terminal Settings
\n**Global parameters for POS front:**
- Default POS mode: Retail / Restaurant (enum only, for future)\n- Enable'Hold Order' feature (on/off)
- Enable 'Mixed Payment' (on/off)
- Enable 'Per-Product Discount' (on/off)\n- Require customer selection for credit sales (on/off)
- Automatically log out cashier after X minutes of inactivity
- Show low-stock warning in POS (on/off)
- Quick access buttons limit (e.g., 8 / 12 / 16 products on main screen)

**These settings affect POS Terminal behavior real-time.**

#### 4.14.4 Payments & Taxes

**Payment Methods**\n\n**Configurable List:**
- Default methods: Cash, Card, QR, Bank transfer
- Capabilities:\n  - Enable/disable methods
  - Change labels (e.g., 'Terminal' instead of 'Card')
  - Add custom method (e.g., 'Debt', 'Wallet')

**Taxes**

- Enable tax system (on/off)
- Default tax rate (%)
- Tax inclusive / exclusive option
- Per-product tax override allowed (on/off)
\n**Validation:**
- Percentage must be 0 to 100
\n**Real-time Synchronization:**
- Payment methods changes immediately sync to POS Terminal and orders module
- Tax settings automatically applied to all price calculations

#### 4.14.5 Receipts & Printing

**Parameters for receipt templates:**
\n- Toggle: Auto print receipt after each sale (on/off)
- Receipt header text (multi-line; e.g., 'Thank you for shopping')
- Receipt footer text (return policy, contact info)
- Show company logo on receipt (on/off)
- Show cashier name (on/off)
- Show customer name (on/off)
- Show product SKU (on/off)
- Show line discounts on receipt (on/off)
- Default receipt size: 58mm / 80mm
- Test print button (placeholder)

**These settings should be reused in print logic.**

#### 4.14.6 Inventory Settings

**Global inventory behavior:**
\n- Enable inventory tracking (on/off)\n- Default minimal stock level for new products
- Allow selling when stock is zero or negative:\n  - Option: Block sale, Allow with warning, Allow without warning
- Automatic cost calculation mode (for profit reports):
  - Latest purchase price
  - Average cost (future-ready)
- Automatic stock adjustment approval required (yes/no)
\n**Real-time Synchronization:**
- Inventory settings changes immediately applied to POS Terminal and Inventory module
\n#### 4.14.7 Numbering & IDs\n
**Settings for auto-generated numbers:**

**Fields:**
- Order number prefix (default: POS-)
- Order number format: POS-YYYYMMDD-#####
- Return number prefix (default: RET-)
- Purchase order prefix (default: PO-)
- Movement/adjustment prefix (optional)
\n**AI should support:**
- View next sequence number for eachdocument type
- Reset sequences (with confirmation modal)
\n**All IDs must remain unique.**

#### 4.14.8 User & Security\n
**Security Parameters:**

- Minimum password length (default6)
- Require strong password (letters + numbers) (on/off)
- Max failed login attempts before lock (e.g., 5)
- Session timeout (minutes)\n- Allow multiple active sessions per user (yes/no)
\n**Role Management (brief description, no full CRUD here):**
- Show list of roles (Admin, Manager, Cashier) with brief description
- Link or info that roles are managed in Employees module
\n**Audit:**
- Switch'Enable activity logging' (on/off) — if enabled, log critical actions (orders, returns, inventory adjustments).

#### 4.14.9 Localization\n
**Fields:**
\n- Default language (e.g., Uzbek, Russian, English)
- Additional interface languages (for future use)
- Default currency (UZS, USD, etc.)
- Currency symbol position:\n  - Before amount (₩10000)\n  - After amount (10000 ₩)
- Thousand separator and decimal separator options

**These settings control formatting across all modules.**

#### 4.14.10 Backup & Data Management (Optional but Recommended)

**Settings:**

- Allow export of:\n  - Products\n  - Customers
  - Orders
  - Inventory movements
-'Download full backup' button (placeholder)
- Info text about where backups are stored
\n#### 4.14.11 Permissions & Access

**Only Admin role can view and modify Settings page.**

**Manager and Cashier cannot access this page.**

**Each save operation should:**
- Validate fields
- Show success or error toast
- Write to audit log:\n  - user, time, which section changed
\n#### 4.14.12 UI/UX Requirements

- Clean card-based layout for each section
- Left side panel or tabs for navigation between sections
- Save / Cancel buttons fixed at bottom of viewport
- Confirmation dialog when leaving page with unsaved changes
- Clear tooltips explaining risky parameters (e.g., 'Allow negative stock')
- Fully responsive (desktop priority, tablet-friendly)\n\n#### 4.14.13 Final AI Requirements

**AI should create fully functional Settings module:**
\n- Store configuration in central settings table / config store
- Apply these settings real-time in:\n  - POS Terminal
  - Orders\n  - Sales Returns
  - Inventory\n  - Purchase Orders
  - Reports
  - Employees
- Allow Admin to securely view and update configuration with validation and audit logging
- Use consistent UI with rest of POS system
- All changes sync immediately system-wide

## 5. Professional Features
- Hold order (temporarily save receipt) - NEW
- Split payment (multiple payment types)\n- Quick add product\n- Z-report and X-report\n- Cash drawer open/close
- Shift-based accounting
- Device binding\n- Full Sales Returns system
- Full Customers system (balance, debt, credit limit)
- Full Inventory Management system (real-time tracking, movements, adjustments, alerts)
- Full Purchase Orders system (create, approve, receive, inventory integration) - FIXED
- Auto-sync with inventory\n- Audit trail and logs
- Full Reports Module (Sales, Inventory, Purchase, Employee, Financial analytics)
- Full Employees Module (create, edit, role-based permissions, performance analysis, time tracking, audit logs, POS integration)
- Full Settings Module (Company Profile, POS Terminal, Payments & Taxes, Receipts, Inventory, Numbering, User & Security, Localization, Backup)\n- Real-time global synchronization across all modules
- Per-Product Discount\n\n## 6. Technical Requirements

### 6.1 UI/UX Requirements
- Minimalist and smooth design
- Fast performance (caching and optimization)
- Adapted for tablets and cashier monitors
- Large buttons for touch screen
- Offline mode and data sync
- Dark and light mode\n- Optimized for desktop and POS displays
- Collapsible side panels
- Admin-level features hidden from cashiers
- Fast rendering even with10,000+ products
- Consistent UI/UX across all modules
- Standard status colors and badges
\n### 6.2 Security\n- JWT or Session authentication
- Role-based access control (RBAC)
- Offline data encryption
- Logs by cashier: who did what\n- Audit trail for returns\n- Delete and cancel restrictions
- Customer data security
- Employee data security
- Strong password policy
- Session management
- IP tracking\n- Prevent deleting last admin account
- Audit logging for all critical actions

### 6.3 Integrations
- Fiscal printer\n- Barcode scanner
- QR Pay (Click/Payme)
- Inventory API
- Bank terminal
- Full integration with Sales Returns
- Full integration with Customers
- Full integration with Inventory Management
- Full integration with Purchase Orders - FIXED
- Full integration with Reports Module
- Full integration with Employees Module
- Full integration with Settings Module
- All modules sync real-time via centralized database

### 6.4 Database Architecture
- Centralized single database
- All modules read from and write to same data source
- Real-time synchronization across all modules
- Indexing for critical fields (SKU, order numbers, customer names)
- Optimized queries and caching
- Audit trail for all critical actions
- Held Orders table (pending_orders / held_orders)
\n### 6.5 Performance and Optimization
- Cache dashboard data for fast loading
- Calculate heavy reports in background
- Fast performance even with 10,000+ records
- Real-time updates with minimal latency
- Optimized database queries
\n## 7. System Numbering Policy
- Receipt / Order: POS-YYYYMMDD-#####
  - Example: POS-20251205-00042
- Return: RET-YYYYMMDD-#####
  - Example: RET-20251205-00023
- Purchase Order: PO-YYYYMMDD-#####
  - Example: PO-20251206-00015
- Inventory Count: INV-YYYY-#####
- SKU: SKU-000123\n
## 8. Module Integration and Synchronization
Products, Categories, Inventory Management, Orders, Sales Returns, Purchase Orders, Customers, Employees, Reports, and Settings modules are fully integrated and real-time synchronized with:\n- POS Terminal
- Inventory\n- Purchase Orders - FIXED
- Sales\n- Reports
- Payments\n- Employees
- Settings
- Dashboard
- Held Orders

**Synchronization Rules:**
- All operations are fully synchronized and auditable
- Any change (order, return, inventory adjustment, settings update) immediately reflects in all related modules
- Dashboard metrics updated real-time automatically
- Reports always show latest data\n- Customer and employee statistics calculated automatically
- Inventory stock updated after each transaction
- Settings changes immediately affect system behavior
- Held ordersdo not affect inventory or reports (only after payment is completed)

## 9. Design Style\n- Modern and professional appearance, suitable for business environment
- Primary colors: blue (#2563EB) and grey (#64748B) tones, white background (#FFFFFF)
- Card-style layout, each module in separate card
- Soft shadows (shadow-sm) and 8px border-radius
- Icons: modern line icons from Lucide or Heroicons library
- Tables: zebra-striped style with hover effect
- Buttons: filled (primary) and outlined (secondary) variants, minimum 44px height for touch screen
- Responsive grid layout: 3-4 columns for desktop, 2 columns for tablet\n- Category colored tags and icons shown in POS Terminal and products list
- Status color codes:\n  - Completed / Paid / In Stock / Received → Green
  - Pending / Low Stock / Approved / Held → Yellow or Blue
  - Cancelled / Voided / Out of Stock → Red
  - Refunded → Dark Yellow
  - Partially Refunded / Partially Paid / Partially Received → Light Yellow
  - Draft → Grey
- Customer balance color codes:
  - Red → customer owes (positive balance)
  - Green → store owes/advance payment (negative balance)
  - Grey → zero balance
- Inventory movements color codes:
  - Positive (+) → Green
  - Negative (–) → Red
- Recharts library for charts
- Professional data visualization in Reports pages
- Colored indicators for Employee performance
- Left side panel or tabs navigation in Settings page, forms on right
- Consistent design language across all modules

## 10. Final Delivery Requirements

AI should create a POS system with:
\n✔ Fully integrated\n✔ Real-time synchronized
✔ Secure with role-based access
✔ Compliant with all business rules
✔ Professional-grade architecture
✔ Production-ready\n✔ Centralized database
✔ Auto-sync across all modules
✔ Full audit trail and logging
✔ Optimized performance
✔ Consistent UI/UX across all modules
✔ Full POS Terminal with Per-Product Discount feature
✔ **Full POS Terminal with Hold Order (Save Order to Waiting List) feature** - NEW
✔ **Fully functional and fixed Purchase Orders module** - FIXED
\n---

## Summary of Purchase Orders Module Fix

**Problem Solved:**
- 'New Purchase Order' button now correctly navigates to `/purchase-orders/new` instead of redirecting to Dashboard.\n- Purchase Orders module is now fully functional with complete lifecycle: list, create, edit, receive.\n- Product stock and inventory movements are fully synchronized with purchase operations.
\n**Key Implementations:**
1. **Routing:** Proper routes created for list, create, detail, and edit pages.\n2. **Data Model:** Database tables for `purchase_orders`, `purchase_order_items`, and integration with `inventory_movements`.
3. **UI/UX:** Multi-step or single-page form for PO creation with product search, line items table, and summary.
4. **Business Logic:** Draft POsdo not affect stock; marking as Received increases stock and logs movements via database transaction.
5. **Integration:** Full integration with Inventory, Products, Suppliers, Reports, and Dashboard modules.
6. **Validation:** Type-safe TypeScript interfaces, user-friendly error messages, and proper validation.
7. **Testing:** Comprehensive testing scenarios to ensure correct functionality.
8. **Permissions:** Role-based access control for Admin, Manager, and Cashier.\n9. **UI/UX:** Clean, card-based layout with colored status badges and optimized for desktop.\n10. **Numbering:** Auto-generated PO numbers in format PO-YYYYMMDD-#####.

**Final Objective Achieved:**
- Purchase Orders module is now fully operational and integrated with the rest of the POS system.
- All navigation, data flow, and inventory synchronization work correctly.
- No unexpected redirects or errors.
- Production-ready implementation.

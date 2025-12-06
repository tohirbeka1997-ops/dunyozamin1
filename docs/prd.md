# POS System Requirements Document (Updated Version - Partial Credit Payment Support Added)

## 1. System Name
POS System (Point of Sale Management System)

## 2. System Description
A fully functional POS system for professional retail points with complete inventory control, financial reporting, employee activity tracking, supplier management, and **customer credit/debt management with partial credit payment support**. The system operates on a centralized database and ensures real-time synchronization across all modules. This version includes a premium-grade POS Terminal interface optimized for high-volume retail environments and a comprehensive customer credit/debt tracking system with flexible payment options.

## 3. Global System Synchronization Rules

### 3.1 Centralized Database
The system stores all data in a single centralized database:\n- Products\n- Inventory\n- Sales / Orders
- Returns\n- Customers
- Suppliers
- Purchase Orders
- Employees
- Settings
- Audit Logs
- Held Orders
- **Customer Payments (for debt tracking)**

All modules read from and update the same unified data source.

### 3.2 Cross-Module Integration Rules

#### 3.2.1 Products↔ Inventory
- When a product is created, an inventory record is automatically created
- Updating product stock triggers low-stock warnings and dashboard updates
- Deleting a product is prevented if it has been used in orders
\n#### 3.2.2 Orders (Sales) ↔ Inventory
**When an order is completed:**
- Reduce stock based on sold quantity
- Log stock change in Inventory Movement Log
- Update dashboard statistics
- Update customer purchase history
- **Update customer balance if order includes credit amount**
- Update employee performance statistics
- Create payment record (summary)\n
**When an order is cancelled:**
- Restore stock\n- **Restore customer balance if order included credit amount**
- Mark order as voided in activity log
\n#### 3.2.3 Sales Returns↔ Inventory ↔ Customers
**When a return is processed:**
- Return products to stock
- Add entry to movement log (Return)\n- Reduce customer total spending
- **Reduce customer balance if original order included credit amount**
- Reduce employee performance metrics
- Update dashboard indicators

#### 3.2.4 Purchase Orders ↔ Inventory ↔ Suppliers
**When a purchase order is received:**
- Increase stock\n- Add entry to movement log (Purchase Receipt)
- Update inventory valuation
- Update dashboard and reports
- Link to supplier record

**When a purchase order is cancelled:**
- No stock should be added
- Log the cancellation\n- Maintain supplier relationship record

#### 3.2.5 Customers ↔ Orders ↔ Returns↔ Payments
Each customer should have:\n- Total number of purchases
- Total amount spent
- **Current balance (debtowed to store)**
- **Credit limit (optional)**
- **Payment history**
- List of orders\n- List of returns
- Data used in reports and dashboard

Deleting a customer is prevented if orders exist (soft delete only).

#### 3.2.6 Suppliers ↔ Purchase Orders\nEach supplier should have:
- Total number of purchase orders
- Total purchase amount
- List of purchase orders
- Contact information
- Status (Active / Inactive)
- Data used in reports and dashboard
\nDeleting a supplier is prevented if purchase orders exist (soft delete only).

#### 3.2.7 Employees ↔ POS Terminal ↔ Orders\nEach order should store:
- Cashier ID
- Terminal session\n- Timestamp
\nThe Employees module automatically receives:\n- Number of sales
- Sales amount
- Processed returns
- Errors (cancelled orders)\n- Login sessions

POS Terminal should log:
- Shift start/end\n- Session time
- Cash drawer operations linked to employee

#### 3.2.8 Settings ↔ Entire System
Settings module should directly affect module operations:
\n**POS Terminal:**
- Payment methods\n- Mixed payment rules
- Auto logout\n- Receipt printing settings
- Negative stock rules
- Default tax rate
- Enable/disable Hold Order feature
- Enable/disable Per-Product Discount
- Enable/disable Mixed Payment\n- Quick access buttons limit
- **Enable/disable Credit Sales**
- **Default credit limit**
- **Enable/disable Partial Credit Payment**
\n**Inventory:**
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
- Sales for selected date range
- Orders count for selected date range
- Low-stock products
- Active customers for selected date range
- Active suppliers
- Best-selling products
- Employee performance warnings
- Pending purchase orders
- Number of held orders
- Average order value
- Items sold\n- Returns count and amount
- **Total customer debt**
- **Top debtors (optional)**
\nAll calculations should be automatically recalculated after:\n- New order\n- Return\n- Inventory adjustment
- Purchase receipt
- New product added
- New supplier added
- Settings updated
- Date range selection changed
- **Customer payment received**
- **Credit sale created (full or partial)**
\n### 3.4 Reports Module Synchronization
Reports should receive real-time data from:\n- Orders (sales)
- Inventory movements
- Customers
- Suppliers
- Purchase orders
- Employees
- Payment system
- Settings (for tax calculation, currency, language)
- **Customer payments and debt tracking**

Each report should be correctly updated when related modules change.

### 3.5 Data Validation Rules Across Modules

**Orders:**
- Cannot sell products not in stock if settingsdo not allow\n- Cannot complete order without payment **OR valid credit sale (full or partial)**
- **Credit sales require non-walk-in customer selection**
- **Credit amount must not exceed customer available credit (credit_limit - balance)**
- **Partial credit payment: credit_amount + paid_amount must equal total_amount**

**Inventory:**
- Manual adjustments require reason\n- Cannot adjust below zero if restricted
\n**Customers:**
- Phone and email must be unique
- **Balance must be numeric**
- **Credit limit must be numeric and >= 0**
- **Payment amount must be > 0 and <= current balance (configurable)**

**Suppliers:**
- Name is required
- Email must be valid format if provided
- Cannot delete if linked to purchase orders

**Employees:**
- Cannot delete last Admin account
\n**Purchase Orders:**
- Receipt cannot exceed ordered quantity
- Supplier must be selected
\n### 3.6 System-Wide Audit Logging
Every critical operation should write logs:
- Product create/edit/delete
- Order create, cancel\n- Return processing
- Inventory adjustments
- Customer updates
- Supplier create/edit/delete
- Employee actions
- System settings changes
- Held orders save/restore/cancel
- **Customer payment received**
- **Credit sale created (full or partial)**
- **Customer balance adjustments**
\n**Log format:**
- user_id
- action\n- module
- document_id
- details
- timestamp
- ip_address
\n### 3.7 Performance and Optimization Rules
- Use indexing for SKU, order numbers, customer names, supplier names
- Cache dashboard data for fast loading
- Recalculate heavy reports in background if needed
- **Index customer balance field for fast debt queries**
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
  - **Process credit sales (full or partial, if enabled in settings)**
  - **Receive customer payments (if enabled)**
- Cannot edit or delete core records

### 3.9 UI/UX Synchronization Rules
- Consistent layout across all modules
- Standard button positions (Save, Cancel, Edit)\n- Unified status indicators system-wide:\n  - Green = Completed / Active / Paid
  - Yellow = Pending / Low Stock\n  - Red = Cancelled / Low Stock / Inactive / **Debt Exceeded**
  - Blue = On Credit / Partially Paid
- Confirmation dialogs for all destructive actions
\n## 4. Main Functional Modules

### 4.1 Dashboard (Analytics) - ENHANCED VERSION

#### 4.1.1 Dashboard Layout Structure

**Page Title:** Dashboard

**Top Section:**
- Page title on left
- Date range selector on right with presets:\n  - Today\n  - Yesterday
  - Last 7 Days
  - This Month
  - Custom Range (date picker)
\n**Content Structure:**
1. KPI Cards Section (2 rows)
2. Quick Actions Row
3. Charts & Analytics Section
\n#### 4.1.2 KPI Cards - Row 1 (Existing, Enhanced)

**Card 1: Total Sales**
- Main value: Total sales amount for selected date range
- Label: 'Total Sales'
- Secondary text: 'for selected period' (static placeholder)
- Icon: Dollar sign or currency icon
- Color accent: Blue\n\n**Card 2: Total Orders**
- Main value: Number of completed orders for selected date range
- Label: 'Total Orders'
- Secondary text: 'completed orders' (static placeholder)
- Icon: Shopping bag icon
- Color accent: Green\n
**Card 3: Low Stock Items**
- Main value: Count of products below minimum stock threshold
- Label: 'Low Stock Items'
- Secondary text: 'need restock'\n- Icon: Alert triangle icon
- Color accent: Yellow/Orange

**Card 4: Active Customers**
- Main value: Number of customers with at least 1 order in selected date range
- Label: 'Active Customers'
- Secondary text: 'in this period'\n- Icon: Users icon
- Color accent: Purple

#### 4.1.3 KPI Cards - Row 2 (Enhanced with Debt Tracking)

**Card 5: Average Order Value**
- Main value: Total sales / Number of orders (0if no orders)
- Label: 'Average Order Value'
- Secondary text: 'per transaction'\n- Icon: Calculator or trending up icon
- Color accent: Teal
- Formula: `total_sales / order_count` (handle division by zero)

**Card 6: Items Sold**
- Main value: Sum of quantities of all sold line items in selected range
- Label: 'Items Sold'
- Secondary text: 'total units'\n- Icon: Package icon
- Color accent: Indigo

**Card 7: Returns**
- Main value: Number of sales returns in selected range
- Secondary value: Total refunded amount
- Label: 'Returns'
- Secondary text: 'X returns / Y amount refunded'
- Icon: Rotate CCW icon
- Color accent: Red

**Card 8: Total Customer Debt (NEW)**
- Main value: Sum of all positive customer balances
- Label: 'Total Customer Debt'
- Secondary text: 'outstanding balance'
- Icon: Credit card or alert icon
- Color accent: Orange/Red
- Formula: `SUM(balance) WHERE balance > 0 FROM customers`

#### 4.1.4 Quick Actions Row (Existing, Keep)\n
**4Action Buttons:**
1. Open POS Terminal → navigate to `/pos`
2. Manage Products → navigate to `/products`
3. View Orders → navigate to `/orders`\n4. View Reports → navigate to `/reports`

**Button Style:**
- Large, touch-friendly buttons
- Icon + text label
- Primary blue color
- Consistent spacing
\n#### 4.1.5 Charts & Analytics Section (Enhanced)

**Section Title:** Analytics Overview

**Chart 1: Sales Over Time**
\n**Type:** Line chart or bar chart
\n**Data:**
- X axis: Days in selected date range
- Y axis: Total sales amount per day
- Tooltip on hover: Date + total sales for that day
\n**Implementation:**
- Query: Aggregate orders by date (order_date), sum total_amount where status = 'Completed'
- Filter by selected date range
- Group by day\n- Sort by date ascending
\n**Empty State:**
- If no sales data: Show message 'No sales in this period'
\n**Chart 2: Top5 Products**

**Type:** Horizontal bar chart or ranked list

**Data:**
- Show top 5 products by total sales amount in selected range
- For each product display:
  - Product name
  - Quantity sold (sum of line item quantities)
  - Total sales amount (sum of line totals)
\n**Implementation:**
- Query: Join order_items with orders and products\n- Filter by date range and order status = 'Completed'
- Group by product_id
- Sum quantity and line_total
- Order by total sales amount descending
- Limit 5\n
**Empty State:**
- If fewer than 5 products: Show only existing ones
- If no products sold: Show message 'No products sold in this period'

**Chart 3: Top 5 Debtors (NEW, Optional)**

**Type:** Horizontal bar chart or ranked list\n
**Data:**
- Show top 5 customers by outstanding balance\n- For each customer display:
  - Customer name
  - Current balance\n  - Credit limit (if set)
\n**Implementation:**
- Query: SELECT name, balance, credit_limit FROM customers WHERE balance > 0 ORDER BY balance DESC LIMIT 5
\n**Empty State:**
- If no customers with debt: Show message 'No outstanding customer debt'
\n#### 4.1.6 Data Sources & Queries

**All metrics must:**
- Filter by selected date range (order_date or created_at)
- Filter by completed orders only (status = 'Completed') where appropriate
- Handle empty databases gracefully (return 0 instead of errors)
- Use aggregated queries (no N+1 queries)

**Suggested RPC Functions or SQL Views (Read-Only):**
\n**1. get_dashboard_kpis(start_date, end_date)**\n- Returns JSON object with:
  - total_sales
  - total_orders
  - low_stock_count
  - active_customers\n  - average_order_value
  - items_sold\n  - returns_count
  - returns_amount
  - pending_purchase_orders
  - **total_customer_debt**
\n**2. get_sales_over_time(start_date, end_date)**
- Returns array of objects:\n  - date\n  - total_sales\n\n**3. get_top_products(start_date, end_date, limit)**
- Returns array of objects:
  - product_id
  - product_name
  - quantity_sold
  - total_sales

**4. get_top_debtors(limit) (NEW)**
- Returns array of objects:
  - customer_id
  - customer_name\n  - balance
  - credit_limit

**Database Tables Used (Read-Only):**
- orders (order_date, total_amount, status, payment_status)
- order_items (quantity, line_total, product_id)\n- products (name, stock, minimal_stock)
- customers (id, name, balance, credit_limit)
- sales_returns (created_at, returned_amount, status)
- purchase_orders (status)\n- **customer_payments (amount, created_at)**

**No database schema changes required for dashboard.**

#### 4.1.7 Loading, Error & Empty States

**Loading State:**
- Show skeleton placeholders on KPI cards (grey animated boxes)
- Show skeleton placeholders on charts (grey rectangles)
- Keep layout structure visible during loading

**Error State:**
- If a query fails, show non-blocking error message at bottom of dashboard:\n  - 'Failed to load analytics. Please try again.'
  - Red background, white text, dismissible
- Keep other successful widgets visible
- Do not crash the entire dashboard

**Empty State:**
- If no data for selected range:\n  - KPI cards show '0' or 'N/A'
  - Charts show 'No data available for this period'
- Handle division by zero gracefully (Average Order Value = 0 if no orders)

#### 4.1.8 Responsive Layout

**Desktop (1440px and above):**
- KPI cards: 4 cards per row (2 rows = 8 cards total)
- Quick actions: 4 buttons in a row\n- Charts: 2-3 charts side by side
\n**Tablet (1024px - 1439px):**
- KPI cards: 2 cards per row (4 rows = 8 cards total)
- Quick actions: 2 buttons per row (2 rows)\n- Charts: Stacked vertically (100% width each)

**Mobile (below 1024px):**
- KPI cards: 1 card per row (8 rows)\n- Quick actions: 1 button per row (4 rows)
- Charts: Stacked vertically (100% width each)

#### 4.1.9 UI/UX Requirements

**Design Consistency:**
- White background cards with soft shadows (shadow-sm)
- 8px border-radius on cards
- Blue primary color (#2563EB) for accents
- Grey secondary color (#64748B) for labels
- Large, bold numbers for main values (text-3xl or text-4xl)
- Small labels (text-sm, text-gray-600)
- Icons from Lucide or Heroicons library
- Consistent spacing (gap-4or gap-6)
\n**Date Range Selector:**
- Dropdown or button group for presets
- Date picker modal for custom range\n- Clear visual indication of selected range
- Apply button to confirm custom range

**Charts:**
- Use existing chart library in project (avoid adding heavy dependencies)
- Clean, minimal design\n- Tooltips on hover
- Responsive sizing
- Color palette consistent with dashboard theme

#### 4.1.10 Performance & Code Quality

**TypeScript:**
- All code in TypeScript
- Proper type definitions for KPI data, chart data, date range
- Follow existing patterns in project
\n**Queries:**
- Use aggregated queries (GROUP BY, SUM, COUNT)
- Avoid N+1 queries (no looping over rows on client)
- Use indexes on date fields for fast filtering
- **Index customer balance field for fast debt calculations**

**Reuse Existing Code:**
- Reuse auth hooks (useAuth)\n- Reuse layout components\n- Reuse card components
- Do NOT touch authentication or routing logic

**Caching:**
- Cache dashboard data for fast loading
- Invalidate cache when date range changes
- Refresh data automatically when new orders/returns are created (optional)

#### 4.1.11 Integration with Other Modules

**Dashboard must NOT break:**
- POS Terminal selling flow
- Product stock updates after sales and purchase orders
- Sales Returns module
- Purchase Orders module
- All other existing modules
- **Customer credit/debt tracking**

**Dashboard must work:**
- On empty database (no crashes, just show0 values)
- With large datasets (10,000+ orders)\n- With slow network (show loading states)
\n#### 4.1.12 Testing Scenarios

1. **Open Dashboard with empty database:**
   - Verify: All KPI cards show 0 or N/A
   - Verify: Charts show 'No data' messages
   - Verify: No errors in console

2. **Select'Today' date range:**
   - Verify: Only today's orders are counted
   - Verify: Charts show today's data only
\n3. **Select 'Last 7 Days' date range:**
   - Verify: Orders from last 7 days are counted
   - Verify: Sales Over Time chart shows 7days

4. **Select custom date range (e.g., Jan 1 - Jan 31):**
   - Verify: Only orders in that range are counted
   - Verify: Charts reflect selected range

5. **Create a new order in POS Terminal:**
   - Verify: Dashboard metrics update (if auto-refresh enabled)
   - Verify: Sales Over Time chart updates

6. **Process a sales return:**
   - Verify: Returns card updates
   - Verify: Total Sales decreases (if return affects selected range)

7. **Mark a purchase order as Received:**
   - Verify: Pending Purchase Orders count decreases
\n8. **Simulate query failure:**
   - Verify: Error message appears at bottom
   - Verify: Other widgets remain visible

9. **Test on tablet (1024px width):**
   - Verify: Layout adjusts to 2 cards per row
   - Verify: Charts stack vertically

10. **Test loading state:**
    - Verify: Skeleton placeholders appear while data loads
    - Verify: Smooth transition to actual data

11. **Create credit sale (full or partial):**
    - Verify: Total Customer Debt card updates
    - Verify: Dashboard reflects new debt amount

12. **Receive customer payment:**
    - Verify: Total Customer Debt card decreases
    - Verify: Dashboard updates in real-time

#### 4.1.13 Final Delivery Requirements

**AI should create:**
\n✔ Enhanced Dashboard page with date range selector
✔ 8 KPI cards (4 existing + 4 new including Total Customer Debt) connected to date range\n✔ 2-3 charts (Sales Over Time + Top 5 Products + Top 5 Debtors)\n✔ Read-only RPC functions or SQL views for aggregated data
✔ Loading, error, and empty states
✔ Responsive layout for desktop and tablet
✔ TypeScript code following existing patterns
✔ No database schema changes\n✔ No breaking changes to other modules
✔ Works on empty database without errors
\n**SUMMARY.txt should include:**
- List of new metrics and charts added
- List of queries or RPC endpoints created/updated
- Any limitations or next steps for future improvements
\n### 4.2 POS Terminal (Premium Retail-Grade Interface with Partial Credit Payment Support) - UPGRADED VERSION

#### 4.2.1 Core Functions (Existing - Keep Working)
- Add products via barcode scanner
- Search and select by categories
- Multiple payment methods:\n  - Cash
  - Bank card
  - Terminal\n  - QR payment
  - Mixed payment (e.g., 50% card + 50% cash)
  - **Credit sale (full or partial)**
- Real-time product price modification (manager only)
- Automatic refund amount calculation
- Auto-generate receipt number (Format: POS-YYYYMMDD-#####)
- Quick Actions panel:\n  - Process payment
  - Hold order
  - View waiting orders
  - Return receipt
  - Select customer
  - **Receive customer payment**
- Offline mode capability
- Filter products by category buttons
- Colored category badges and icons
- Most-sold categories shown at top
- Select or quick-create customer (name + phone)
- **Credit sales capability (full or partial, if customer allowed)**
- Employee login/logout system
- Shift start/end tracking
- Cashier-specific restrictions\n- Real-time read payment methods and rules from Settings module
- Each transaction automatically updates inventory, customer, and employee modules
- **Each credit sale (full or partial) automatically updates customer balance**
\n#### 4.2.2 NEW FEATURE1: Quick Category Tabs

**Location:** Above or under the product search input

**Implementation:**
- Horizontal list of category pills:\n  - Example: `All · Fruits · Drinks · Bakery · Sweets · Tobacco · Other`
- When a tab is selected, product search results are filtered by that category
- The'All' tab shows everything
- On mobile/tablet, the pills should be scrollable horizontally
- Use Tailwind and shadcn/ui components consistent with the current design

**Visual Design:**
- Active tab: blue background (#2563EB), white text\n- Inactive tabs: grey background, dark text
- Smooth transition on hover and click
- Touch-friendly size (minimum 44px height)
\n**Technical Requirements:**
- Load categories from existing `categories` table
- Filter products in real-time based on selected category
- Preserve search query when switching categories
- Default to 'All' on page load
\n#### 4.2.3 NEW FEATURE 2: Favorites / Hot Products Panel

**Location:** Under the search bar

**Implementation:**\n- Optional'Favorite Products' grid
- Each product shown as a big button (card) with:
  - Name
  - Short label (e.g., 'Best Seller')
  - Price
- One click adds the product to the cart with quantity = 1
- Support for at least 8 favorite products
\n**Keyboard Shortcuts:**
- ALT+1, ALT+2, … ALT+8add the corresponding favorite product if available
\n**Configuration:**
- Favorites can be hardcoded for now or loaded from a simple config\n- No need for complex settings UI in this iteration
- Future enhancement: allow admin to configure favorites in Settings module

**Visual Design:**
- Grid layout: 4 columns on desktop, 2 columns on tablet
- Large touch-friendly cards (minimum 120px height)
- Product image (if available)\n- Clear price display
- Hover effect and active state

**Technical Requirements:**
- Load favorite products from a simple JSON config or database field
- Add to cart with quantity = 1 on click
- Show toast notification: 'Product added to cart'
- Handle out-of-stock products gracefully (disable button, show badge)

#### 4.2.4 NEW FEATURE 3: On-screen Numpad for Quantity & Line Discount

**Trigger:**
- When the user clicks the quantity field in the cart row
- When the user clicks the Line Discount input\n\n**Implementation:**
- Open a small modal or popover with a numeric keypad (0–9, Clear, Apply)
- Support both keyboard typing and clicking the numpad
\n**Validation:**
- Quantity must be > 0 and <= max allowed by stock
- Discount must be >= 0 and <= line total
- Show clear error messages for invalid inputs
\n**Visual Design:**
- Clean, modern numpad layout
- Large touch-friendly buttons (minimum 60px × 60px)
- Current value displayed at top of popover
- 'Clear' button to reset to 0
- 'Apply' button to confirm and close popover
-'Cancel' or ESC to close without applying

**Technical Requirements:**
- Reusable numpad component
- Handle both mouse clicks and keyboard input
- Update cart state in real-time on'Apply'\n- Close popover on ESC or outside click
\n#### 4.2.5 NEW FEATURE 4: Improved Per-Line Discount UX

**Current State:**
- Per-line discount already exists (amount in UZS)
\n**Improvements:**
\n**A) Discount Popover Enhancement**
- On each cart line:\n  - Show a small'Discount' chip/button (already exists, reuse it)
  - When clicked, show a popover with:
    - Input for discount amount in UZS
    - Quick buttons: `5%`, `10%`, `15%` (apply percent of line price automatically)
    - 'Clear' button to reset to 0
\n**B) Visual Feedback**
- Under the product name in the cart row, show a small grey text:\n  - Example: `Discount: 1500UZS (10%)` if discount is applied
- Update both line total and order summary in real-time
\n**Calculation Logic:**
- Quick buttons calculate percentage of line subtotal (unit_price × quantity)
- Example: If line subtotal = 15000 UZS, clicking '10%' sets discount = 1500 UZS\n- Manual input allows any amount (validated: >= 0 and <= line subtotal)
\n**Visual Design:**
- Popover positioned near the discount button
- Clean layout with clear labels
- Quick buttons in a row (pill-shaped, blue on hover)
- Input field with UZS suffix
- Real-time preview of line total after discount

**Technical Requirements:**
- Reuse existing per-line discount logic
- Add quick percentage buttons
- Update cart state in real-time
- Show discount summary under product name
- Validate discount amount (cannot exceed line subtotal)

#### 4.2.6 NEW FEATURE 5: Mixed Payments UX (Cash + Card Split)

**Current State:**
- Mixed payment already supported in backend

**Improvements:**

**Rework'Process Payment' Modal:**
- Clearly support mixed payments:\n  - Cash Amount (input field)
  - Card Amount (input field)
  - QR Pay (optional, input field)
  - **Credit Amount (input field, only if customer selected)**
- Show:\n  - Subtotal
  - Discounts (line discounts + order discount)
  - Final Total
  - Paid (sum of all payment methods)
  - Change (if cash > due)
\n**Validation Rules:**
- If total > 0, the sum of all payment amounts must equal the total (within a small epsilon for decimals)
- If validation fails, show a clear error message and disable the 'Complete Payment' button
- Example error: 'Payment amountsdo not match order total. Please adjust.'
- **Credit sales require non-walk-in customer selection**
- **Credit amount cannot exceed customer available credit (credit_limit - balance)**

**Visual Design:**
- Clean, card-based layout
- Payment method inputs in a column
- Real-time calculation of 'Paid' and 'Change'\n- Color-coded validation:\n  - Green border if valid
  - Red border if invalid
- Large'Complete Payment' button at bottom (disabled if invalid)

**Technical Requirements:**
- Keep all existing backend logic\n- Only adjust the frontend to send correctly structured data
- Validate payment amounts before submission
- Show clear error messages\n- Handle edge cases (e.g., overpayment, underpayment)
- **Handle credit sales (full or partial) with customer balance updates**

#### 4.2.7 NEW FEATURE 6: Keyboard Shortcuts\n
**Global Shortcuts (within POS Terminal):**
\n**ENTER:**
- If search input is focused and there is at least one result, add the first result to the cart
\n**F2:**
- Open Process Payment modal (if cart is not empty)
\n**F3:**
- Hold current order (equivalent to Hold Order button)

**ESC:**
- Close any open modal/popover
- If none are open, clear the search input

**UP/DOWN arrows:**
- Move selection between cart rows

**PLUS/MINUS on numpad:**
- Increase/decrease quantity for the currently selected row

**ALT+1to ALT+8:**
- Add corresponding favorite product to cart

**Implementation Notes:**
- Use `useEffect` with event listeners for keyboard events
- Prevent default browser behavior where necessary
- Ensure shortcuts don't interfere with input fields (e.g., typing in search)\n- Show keyboard shortcuts help tooltip or modal (optional)

**Visual Feedback:**
- Highlight selected cart row with a subtle border or background color
- Show toast notification when shortcut is used (optional)
\n#### 4.2.8 NEW FEATURE 7: Advanced Hold / Waiting Orders

**Current State:**
- Basic Hold Order functionality exists

**Improvements:**

**7.1 Hold Order Naming**
- When user clicks 'Hold Order':
  - Open a small modal:\n    - Field: 'Hold Name' (optional)
    - Example placeholder: 'Customer with blue jacket', 'Family of 3'
  - If empty, auto-generate a code: `HOLD-YYYYMMDD-####`
\n**7.2 Waiting Orders Side Panel**
- Clicking on the 'Waiting Orders' toggle in the Order Summary opens a side drawer (right side)
- The drawer lists all held orders with:
  - Hold name or auto-code
  - Time since hold (e.g., '12min ago')
  - Order total
- Actions for each row:
  - 'Resume' – load order back into the Terminal, remove from holds list
  - 'Rename' – edit hold name
  - 'Cancel' – delete hold and discard the cart
\n**7.3 Visual Priority**
- If hold age > 15 minutes, highlight row with a yellow background or icon
- If hold age > 30 minutes, use a red border/icon
- Ensure this is only a visual indicator; business logic remains unchanged

**Visual Design:**
- Side drawer slides in from right
- Clean list layout with clear actions
- Color-coded priority indicators
- Touch-friendly buttons
- Smooth animations\n
**Technical Requirements:**\n- Store hold name in `held_orders` table
- Calculate time since hold in real-time
- Update visual indicators based on age
- Handle resume, rename, and cancel actions
- Sync with existing Hold Order logic

#### 4.2.9 NEW FEATURE 8: Customer Info Badge in Order Summary

**Implementation:**
- When a customer is selected (not Walk-in):
  - Show a small badge next to the customer dropdown:\n    - Examples: `VIP`, `Debt: 150000 UZS`, `New`, **`Credit Available: 500000 UZS`**\n- On hover or click, show a small tooltip/popover with:
  - Phone\n  - Email (if available)
  - Short notes (if available)
  - **Current balance**
  - **Credit limit (if set)**
  - **Available credit (credit_limit - balance)**
\n**Badge Logic:**
- VIP: if customer has total purchases > threshold (e.g., 5000000 UZS)
- **Debt: if customer balance > 0 (show amount in red)**
- New: if customer created within last 30 days
- **Credit Available: if credit_limit is set and balance< credit_limit (show available amount in green)**
- **Credit Exceeded: if balance >= credit_limit (show in red, block credit sales)**

**Visual Design:**
- Small pill-shaped badge\n- Color-coded:\n  - VIP: gold/yellow
  - Debt: red
  - New: green\n  - **Credit Available: green**
  - **Credit Exceeded: red**
- Tooltip/popover with clean layout
\n**Technical Requirements:**
- Load customer data from `customers` table
- Calculate badge status based on customer fields
- Show tooltip on hover or click
- Handle missing data gracefully
- **Real-time update when customer balance changes**

#### 4.2.10 NEW FEATURE 9: Quick Customer Create (inside POS Terminal)

**Implementation:**
- Next to the customer dropdown, add a small '+' icon
- Clicking it opens a minimal'New Customer' modal with fields:
  - Name (required)
  - Phone (+998 mask formatting)
  - Notes (optional)
  - **Credit Limit (optional, numeric)**
- On'Create':
  - Save the customer using the existing Customers backend\n  - Automatically select this new customer in the Order Summary dropdown
- Handle backend errors with toasts and inline messages

**Visual Design:**
- Small, centered modal
- Clean form layout
- Large'Create' button\n- 'Cancel' button to close without saving
\n**Technical Requirements:**
- Reuse existing customer creation logic\n- Validate phone format (+998 XX XXX XX XX)
- Show success toast: 'Customer created and selected'
- Show error toast if creation fails
- Auto-select new customer in dropdown
- **Initialize balance to 0**

#### 4.2.11 NEW FEATURE 10: Improved Notifications (Toasts)

**Success Notifications:**
- On successful payment:
  - Show a green toast like:\n    - 'Order POS-2025-0007 completed successfully. Change: 3000 UZS.'
- **On successful full credit sale:**
  - Show a blue toast like:
    - 'Order POS-2025-0007 created ON CREDIT. New customer balance: 1250000 UZS.'
- **On successful partial credit sale:**
  - Show a blue toast like:
    - 'Order POS-2025-0007 created with PARTIAL CREDIT (500000 UZS). Paid: 750000 UZS. New customer balance: 1750000 UZS.'
\n**Error Notifications:**
- Show a red toast with a clear reason, for example:
  - 'Cannot process empty cart.'
  - 'Insufficient stock for product: Olma.'
  - 'Payment amounts do not match order total.'
- **'Credit sales are only available for saved customers.'**
  - **'Credit limit exceeded for this customer.'**
  - **'Customer is not allowed to purchase on credit.'**
  - **'Credit amount cannot exceed available credit.'**

**Implementation:**
- Use a consistent toast component already used in other modules, or create one consistent with the design system
- Position: top-right corner\n- Auto-dismiss after 5 seconds (success) or 10 seconds (error)
- Allow manual dismiss with X button
\n**Visual Design:**
- Clean, modern toast design
- Color-coded:\n  - Green for success
  - Red for error
  - Blue for info/credit sales
- Icon + message + dismiss button
\n#### 4.2.12 NEW FEATURE 11: Credit Sales Support with Partial Credit Payment (CORE FEATURE - ENHANCED)

**Business Scenario:**
- Customer comes to cashier, products scanned and added to cart
- Customer requests to purchase on credit (full or partial)
- Cashier selects customer and processes credit sale
- **Customer can pay part of the order now and put the rest on credit**
- Customer balance increases by credit amount only
- Later, customer returns to pay off debt

**Functional Requirements:**
\n**1. Customer Selection Requirement**
- Credit sales are **only allowed when a specific customer is selected** in the 'Customer (Optional)' dropdown
- If `Walk-in Customer` is selected:\n  - Disable credit option in payment modal
  - Show tooltip: 'Credit sales are only available for saved customers.'
\n**2. Process Payment Modal - Credit Sale Option with Partial Payment Support (ENHANCED)**
\nIn the existing'Process Payment' modal:
\n- Keep the current behavior for normal payments (Cash, Card, QR, Mixed)
- Add a **clearly separated Credit tab or section**:\n  - Tab/Section: `Credit`
  - **Input field:'Credit Amount (UZS)'**
    - **Default value: full order total**
    - **Max value: min(orderTotal, customer.credit_limit - customer.balance)**
    - **Editable by cashier**
  - **Real-time display:**
    - **'Current Balance: X UZS'**
    - **'Credit Amount: Y UZS'**
    - **'New Balance: X + Y UZS'**
- **'Remaining to Pay: orderTotal - creditAmount UZS'**
\n**Case A: Full Credit Sale**
\n- User enters credit amount = order total
- Validation:\n  - Cart must not be empty
  - A non-walk-in customer must be selected
  - If `credit_limit` is set and `customer.balance + credit_amount > credit_limit`, show a blocking error:\n    - 'Credit limit exceeded for this customer.'
  - If customer has `allow_debt = false` (optional field), show error:
    - 'Customer is not allowed to purchase on credit.'\n- On confirm:
  - Create order with:\n    - `payment_status = 'ON_CREDIT'`
    - `paid_amount = 0`
    - `credit_amount = order_total`
  - Adjust stock as for a normal sale
  - Update customer:\n    - `balance = balance + order_total`
  - Log transaction in audit log
- Show a success toast:\n  - 'Order POS-XXXX-YYYY created ON CREDIT. New customer balance: 1250000 UZS.'

**Case B: Partial Credit + Partial Payment (NEW - ENHANCED)**

- User enters credit amount < order total (e.g., 500000 UZS out of 1250000 UZS total)
- **Remaining amount (orderTotal - creditAmount) must be paid via Cash/Card/QR**
- **UI automatically shows:**
  - **'Credit Amount: 500000 UZS'**
  - **'Remaining to Pay: 750000 UZS'**
  - **Cash/Card/QR input fields become active**
- Validation:
  - Cart must not be empty
  - A non-walk-in customer must be selected
  - `credit_amount` must be >= 0 and <= min(orderTotal, customer.credit_limit - customer.balance)
  - `paid_amount` (sum of Cash + Card + QR) must equal (orderTotal - credit_amount)
  - If validation fails, show error:\n    - 'Payment amounts do not match order total. Please adjust.'
    - 'Credit amount cannot exceed available credit.'
- On confirm:
  - Create order with:
    - `payment_status = 'PARTIALLY_PAID'`
    - `paid_amount = orderTotal - credit_amount`
    - `credit_amount = credit_amount`
  - Adjust stock as for a normal sale\n  - Update customer:
    - `balance = balance + credit_amount`
  - Log transaction in audit log
- Show a success toast:
  - 'Order POS-XXXX-YYYY created with PARTIAL CREDIT (500000 UZS). Paid: 750000 UZS. New customer balance: 1750000 UZS.'

**Case C: Zero Credit (Full Payment)**

- User enters credit amount = 0
- All payment must be via Cash/Card/QR
- On confirm:
  - Create order with:
    - `payment_status = 'PAID'`\n    - `paid_amount = order_total`
    - `credit_amount = 0`\n  - Customer balance unchanged
\n**3. UI Indicators in POS Terminal**
\n- In the Order Summary panel:
  - When credit amount is entered, show a badge like:
    - `Credit: 500000 UZS will be added to customer balance`
    - `Remaining to Pay: 750000 UZS`
- If customer already has a positive balance:\n  - Show a small grey text:\n    - `Current debt: 850000 UZS`
- If `balance + credit_amount` exceeds `credit_limit`, show it in red\n- Show available credit:\n  - `Available credit: 500000 UZS` (credit_limit - balance)
\n**4. Credit Sale Validation Rules (ENHANCED)**

- Cannot create credit sale if:
  - No customer selected (Walk-in)
  - Customer is inactive\n  - `credit_amount > (credit_limit - balance)` (if credit_limit is set)
  - `allow_debt = false` (if this field exists)
  - `credit_amount < 0` or `credit_amount > order_total`
  - `paid_amount + credit_amount != order_total`
- Show clear error messages for each validation failure

**5. Database Integration (ENHANCED)**

**Orders Table Updates:**
- Ensure `orders` table has:
  - `payment_status` enum or text: `PAID`, `ON_CREDIT`, `PARTIALLY_PAID`
  - `paid_amount` (numeric, default 0)
  - `credit_amount` (numeric, default 0)
\n**Database Constraint Update:**
- **Replace existing constraint with:**
  ```sql
  ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_payment_status_check;
  ALTER TABLE orders ADD CONSTRAINT orders_payment_status_check \n    CHECK (payment_status IN ('PAID', 'ON_CREDIT', 'PARTIALLY_PAID'));
  ```
\n**Customers Table Updates:**
- Ensure `customers` table has:
  - `balance` (numeric, default 0, NOT NULL) – current outstanding debt
  - `credit_limit` (numeric, nullable, default NULL) – optional per-customer maximum allowed debt
  - `allow_debt` (boolean, default true, optional) – whether customer can purchase on credit

**Transaction Safety:**
- All credit sale operations must run in a single database transaction:\n  - Create order
  - Update stock
  - Update customer balance\n  - Log audit trail
- If any part fails, entire operation should roll back

**Example Supabase RPC Function (Pseudocode - ENHANCED):**

```sql
CREATE OR REPLACE FUNCTION create_credit_sale(
  order_data JSON,
  customer_id UUID,
  credit_amount NUMERIC,
  paid_amount NUMERIC\n)\nRETURNS UUID AS $$
DECLARE\n  order_id UUID;\n  payment_status TEXT;
BEGIN
  -- Determine payment status
  IF credit_amount = order_data->>'total_amount' THEN
    payment_status := 'ON_CREDIT';
  ELSIF credit_amount =0 THEN
    payment_status := 'PAID';
  ELSE
    payment_status := 'PARTIALLY_PAID';
  END IF;
\n  -- Create order
  INSERT INTO orders (
    ..., 
    payment_status, \n    paid_amount, 
    credit_amount
  ) VALUES (
    ..., \n    payment_status, 
    paid_amount, 
    credit_amount
  ) RETURNING id INTO order_id;
  
  -- Update stock for each item
  FOR item IN SELECT * FROM order_items WHERE order_id = order_id LOOP
    UPDATE products SET stock = stock - item.quantity WHERE id = item.product_id;
  END LOOP;

  -- Update customer balance (only by credit amount)
  UPDATE customers SET balance = balance + credit_amount WHERE id = customer_id;
  \n  -- Log audit trail
  INSERT INTO audit_logs(...) VALUES (...);
  
  RETURN order_id;
END;
$$ LANGUAGE plpgsql;\n```

**Frontend Call (ENHANCED):**

```typescript
const { data, error } = await supabase.rpc('create_credit_sale', {
  order_data: orderData,
  customer_id: customerId,
  credit_amount: creditAmount,
  paid_amount: paidAmount
});

if (error) {
  toast.error('Failed to create credit sale.');
} else {
  if (creditAmount === orderTotal) {
    toast.success(`Order ${orderNumber} created ON CREDIT. New customer balance: ${newBalance} UZS.`);
  } else if (creditAmount > 0) {
    toast.success(`Order ${orderNumber} created with PARTIAL CREDIT (${creditAmount} UZS). Paid: ${paidAmount} UZS. New customer balance: ${newBalance} UZS.`);
  } else {
    toast.success(`Order ${orderNumber} completed successfully.`);
  }
}\n```

**6. Sales Returns Integration**

- When a credited order item is returned:
  - Increase stock (as normal)
  - **Reduce customer balance by (returned_amount × credit_amount / order_total)**
  - Update order status\n  - Log audit trail
\n**Example:**
- Original order: 1000000 UZS total,500000 UZS on credit, 500000 UZS paid
- Customer balance: +500000 UZS
- Return: 200000 UZS\n- Credit portion of return: 200000 × (500000 / 1000000) = 100000 UZS
- New customer balance: +400000 UZS
\n**7. TypeScript Types (ENHANCED)**

```typescript
interface Order {
  id: string;\n  order_number: string;
  customer_id?: string;
  payment_status: 'PAID' | 'ON_CREDIT' | 'PARTIALLY_PAID';
  paid_amount: number;
  credit_amount: number;
  total_amount: number;
  // ... other fields
}
\ninterface Customer {
  id: string;
  name: string;
  phone: string;\n  balance: number; // positive = customer owes store
  credit_limit?: number;
  allow_debt: boolean;
  // ... other fields
}

interface CreditPaymentData {
  creditAmount: number;
  paidAmount: number;
  paymentMethods: {
    cash?: number;
    card?: number;
    qr?: number;
  };
}\n```

**8. Testing Scenarios (ENHANCED)**

1. **Create full credit sale:**
   - Select customer
   - Add products to cart (total: 1000000 UZS)
   - Enter credit amount: 1000000 UZS
   - Click 'Complete Payment'
   - Verify: Order created with payment_status = 'ON_CREDIT'\n   - Verify: Customer balance increased by 1000000 UZS
   - Verify: Stock decreased\n\n2. **Create partial credit sale:**
   - Select customer\n   - Add products to cart (total: 1000000 UZS)
   - Enter credit amount: 500000 UZS
   - Enter cash amount: 500000 UZS
   - Click 'Complete Payment'
   - Verify: Order created with payment_status = 'PARTIALLY_PAID'\n   - Verify: paid_amount = 500000 UZS, credit_amount = 500000 UZS
   - Verify: Customer balance increased by 500000 UZS only
   - Verify: Stock decreased

3. **Attempt credit sale with Walk-in customer:**
   - Select 'Walk-in Customer'\n   - Add products to cart\n   - Verify: Credit option is disabled
   - Verify: Tooltip shows error message
\n4. **Attempt credit sale exceeding credit limit:**
   - Select customer with credit_limit = 1000000 UZS
   - Customer balance = 800000 UZS
   - Add products totaling 300000 UZS
   - Enter credit amount: 300000 UZS
   - Click 'Complete Payment'
   - Verify: Error message: 'Credit limit exceeded for this customer.'

5. **Attempt partial credit with invalid payment amounts:**
   - Select customer\n   - Add products to cart (total: 1000000 UZS)
   - Enter credit amount: 500000 UZS
   - Enter cash amount: 400000 UZS (incorrect)\n   - Click 'Complete Payment'
   - Verify: Error message: 'Payment amounts do not match order total. Please adjust.'\n
6. **Return partially credited order item:**
   - Process return for partially credited order
   - Verify: Customer balance decreased by proportional credit amount
   - Verify: Stock increased

7. **View customer balance in POS Terminal:**
   - Select customer with positive balance
   - Verify: Badge shows 'Debt: X UZS' in red
   - Verify: Tooltip shows current balance, credit limit, and available credit

8. **Edit credit amount in payment modal:**
   - Select customer\n   - Add products to cart (total: 1000000 UZS)
   - Enter credit amount: 1000000 UZS
   - Verify: 'Remaining to Pay' shows 0 UZS
   - Change credit amount to 500000 UZS
   - Verify: 'Remaining to Pay' shows 500000 UZS
   - Verify: Cash/Card/QR fields become active

9. **Test credit amount validation:**
   - Select customer with credit_limit = 1000000 UZS, balance = 600000 UZS
   - Add products to cart (total: 500000 UZS)
   - Enter credit amount: 500000 UZS
   - Verify: Error message: 'Credit amount cannot exceed available credit (400000 UZS).'

10. **Test zero credit amount:**
    - Select customer\n    - Add products to cart (total: 1000000 UZS)
    - Enter credit amount: 0 UZS
    - Enter cash amount: 1000000 UZS
    - Click 'Complete Payment'\n    - Verify: Order created with payment_status = 'PAID'
    - Verify: Customer balance unchanged

####4.2.13 Hold Order (Save Order to Waiting List) Feature (Existing - Enhanced)

**Business Scenario:**
- Customer comes to cashier, some products scanned and added to cart
- Customer asks cashier to wait while they get additional items or check something
- Cashier needs to save current cart as'held order' and continue serving other customers
- Later, when customer returns, cashier restores held order and completes payment

**Functional Requirements:**
\n**1. POS Terminal New Actions:**
- Add 'Hold Order' button next to 'Process Payment' button
- Add 'Waiting Orders' menu/button in top-right or POS Terminal header
\n**2. Hold Order Behavior:**
- When cashier clicks 'Hold Order' button:
  - If cart is empty → show warning and do nothing
  - Otherwise:\n    - Open small dialog/modal:\n      - Fields:\n        - Optional'Customer name / label' (e.g., 'Person in green shirt', 'Tohirbek', 'Table 3')
        - Optional note\n    - Save current cart state as held order without payment
    - Clear current cart on terminal (so cashier can serve next customer)
- Held order should not affect inventory or reports yet (stock not reduced, sales total not counted)

**3. Data Model:**
- Create or use `pending_orders` or `held_orders` table:\n  - id (primary key)
  - items (JSON array: product_id, name, unit_price, quantity, line_discount, etc.)
  - customer_name (nullable)
  - note (nullable)
  - created_at\n  - status ('HELD' | 'RESTORED' | 'CANCELLED')
- Do not add to main `orders` table at this stage. Real order is created only after payment\n
**4. Waiting Orders List:**
- 'Waiting Orders' button opens modal or side panel:\n  - For each held order, show:
    - Short label: customer_name or generated name ('Order #3')
    - Time (how long ago saved)
    - Total amount preview (sum of line_subtotals)
  - Actions for each item:
    - Restore (Load this order into current cart)
    - Cancel (Delete held order if not needed)
- Support multiple held orders at once
\n**5. Restore Behavior:**
- When cashier clicks Restore on a held order:
  - If current cart is not empty, ask for confirmation:\n    - 'Current cart has items. Replace them with held order?'
    - Options:
      - Replace current cart\n      - Cancel\n  - After confirmation:\n    - Load held order items into shopping cart (with quantities and line discounts)
    - Load optional customer name into'Customer' field (if linked)\n    - Delete or mark this held order as RESTORED in `pending_orders`
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

**8. Validation:**
- Do not allow Hold if cart is empty
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

#### 4.2.14 Shopping Cart - With Per-Product Discount (Existing - Enhanced)

**Cart Structure:**
\nEach cart item contains:
- Product name
- SKU / Barcode
- Unit price (unit_price)\n- Quantity (quantity)
- Line discount (lineDiscountAmount)
- Line subtotal (line_subtotal = unit_price × quantity)
- Line total (line_total = line_subtotal - lineDiscountAmount)
\n**Per-Product Discount UI:**
\n1. **Discount control for each cart row:**
   - Each product row shows a small discount field
   - Default value: 0 (no discount)\n   - Format: amount display (e.g., 5000 UZS)
   - With discount icon or'Discount' label
\n2. **Entering discount:**
   - When user clicks discount field, inline input or popover opens
   - User can enter discount value\n   - First version: amount format only\n   - Future: toggle between percentage (%) and amount\n
**Calculation Rules:**
\n```\nlet unit_price = product price\nlet qty = quantity
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
- But if new line_subtotal < existing line_discount:\n  - line_discount is automatically set equal to new line_subtotal
\n**Order Summary Integration:**
\n1. **Subtotal:**
   - Sum of all line_subtotal values (before discounts)
   - Formula: sum(unit_price × quantity) for all rows
\n2. **Total Discount:**
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

#### 4.2.15 UX & Design Requirements (Premium Upgrade)

**Layout:**
- Keep the existing blue color theme and card layout
- Layout must be responsive:\n  - Desktop: 2-column layout (Cart left, Summary right)
  - Tablet: stacked but still usable with touch
- Do not clutter the interface: advanced features should appear in modals/popovers, not all at once

**Visual Enhancements:**
- Large, touch-friendly buttons (minimum 44px height)
- Clear visual hierarchy\n- Smooth animations and transitions
- Color-coded status indicators\n- Consistent spacing and padding
- Modern, clean design
- **Credit sale indicators clearly visible**
- **Customer debt warnings prominently displayed**
- **Partial credit payment UI clearly separated**

**Performance:**
- Fast rendering even with 100+ products in search results
- Smooth scrolling and interactions
- Optimized for tablets and POS displays
\n#### 4.2.16 Technical Requirements (Premium Upgrade)
\n**TypeScript:**
- Respect existing TypeScript types and Supabase schema
- Add new types for favorite products, held orders, keyboard shortcuts, **credit sales (full and partial), customer payments**
- Follow existing patterns in project\n
**Do NOT Break:**
- Stock synchronization\n- Orders creation
- Returns\n- Purchase Orders integration
- Dashboard metrics
- Existing backend logic for orders, stock, payments, and returns
- Existing routes and navigation
- Authentication and authorization logic

**Code Quality:**
- Write clean, well-structured React components
- Reuse shadcn/ui where possible
- Add basic unit tests or integration checks for the most critical flows if the project already uses tests
- Follow existing code style and conventions

**Focus:**
- Focus only on the POS Terminal page UI/UX and small frontend-only enhancements that integrate with the current backend
- **Implement credit sales (full and partial) with proper transaction safety**
\n#### 4.2.17 Summary of New Features

**Implemented in POS Terminal:**

1. **Quick Category Tabs** – Filter products by category with horizontal pills
2. **Favorites / Hot Products Panel** – Quick access to 8 favorite products with keyboard shortcuts (ALT+1to ALT+8)
3. **On-screen Numpad** – For quantity and line discount input
4. **Improved Per-Line Discount UX** – Quick percentage buttons (5%, 10%, 15%) and visual feedback
5. **Mixed Payments UX** – Clear split payment interface with validation
6. **Keyboard Shortcuts** – ENTER, F2, F3, ESC, UP/DOWN, PLUS/MINUS, ALT+1-8
7. **Advanced Hold / Waiting Orders** – Named holds, side panel, visual priority indicators
8. **Customer Info Badge** – VIP, Debt, New, **Credit Available, Credit Exceeded** badges with tooltip
9. **Quick Customer Create** – '+' button next to customer dropdown
10. **Improved Notifications** – Clear success and error toasts
11. **Credit Sales Support with Partial Credit Payment (ENHANCED)** – Full and partial credit sale capability with customer balance tracking
\n**All existing features preserved and working:**
- Product search and barcode scanning
- Shopping cart with quantity controls
- Per-line discounts\n- Order-level discount\n- Hold Orders
- Process Payment
- Customer selection
- Full integration with Products, Orders, Inventory, Customers, Dashboard

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
- Yellow → Low stock\n- Red → Out of stock
\n**Integration Rules:**
- When product is created, inventory record is automatically created
- When deleting product, check if used in orders\n- Stock changes reflect real-time in dashboard and reports
\n#### 4.3.2 Add / Edit Product Form
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

**Inventory Settings:**
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
  - Type\n  - Quantity (+ or –)
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

**Validation:**
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
- Products count\n\n**Tabs:**
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
- Example: buttons like'Drinks', 'Snacks', 'Fruits', 'Pharmacy'

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
\n#### 4.4.8 Security and Permissions
Role-based access:
- Admin and Manager: Create, edit, delete categories
- Cashier: View categories only (no edit)\n\n#### 4.4.9 Technical Requirements
**Category Table Structure:**
- id\n- name
- description\n- color\n- icon
- parent_id (nullable)
- created_at
- updated_at
\n**Relationships:**
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
- Sorting:\n  - Name\n  - Stock quantity
  - Inventory value
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
- User\n- Related document (Order #, Return #, Purchase Order #, Adjustment #)

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
```\nstock -= sold_quantity\nmovement: type = 'Sale', quantity = -X
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
- product_id\n- stock_quantity
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
- related_document_type
- related_document_id
- notes
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
- payment_status – **Paid / On Credit / Partially Paid / Unpaid**
- payment_methods – Icons or text (Cash, Card, QR, Mixed, **Credit**)
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
  - **total_credit_sales – Total credit sales amount**
\n#### 4.6.2 Order Detail Page
When user clicks order row, Order Detail page or side panel opens.

**Header Block:**
- Order number
- Date and time
- POS terminal name (if multiple terminals)
- Cashier\n- Customer (with link to customer profile)
- Status badge
- **Payment status badge (Paid / On Credit / Partially Paid)**
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
- Order discount\n- Total discounts (Line Discounts + Order Discount)
- Tax (if used)
- Grand total
- **Amount paid**
- **Credit amount**
- **Remaining balance (if any)**

**Payments Block (Integrated with Payments Module):**
List of payments for this order:\n- Date and time
- Amount
- Method (Cash, Card, QR, Mixed, **Credit**)
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
- **When credit sale is created (full or partial), payment_status = 'ON_CREDIT' or 'PARTIALLY_PAID'**
- If order is cancelled from POS, status = Voided and inventory is restored

#### 4.6.4 Integrations (Mandatory)
\n**Inventory Integration:**
- When order is Completed → stock decreases by products\n- When order is Refunded via Sales Return → stock increases\n- All changes sync real-time to dashboard and reports

**Payments Integration:**
- Each payment belongs to an order
- Payment status is calculated:\n  - Paid: total payments >= order total
  - Partially paid: total payments >0 and < order total
  - Unpaid: total payments = 0\n  - **On Credit: credit_amount > 0 and paid_amount = 0**
  - **Partially Paid: credit_amount > 0 and paid_amount > 0**

**Customers Integration:**
- If customer is selected in POS, they should be shown in Orders list and detail
- Customer balances (debt, loyalty) should be updated when order is created/paid/returned
- **When credit sale occurs (full or partial), customer balance increases by credit_amount**
- When payment is received, customer balance decreases\n- Customer statistics updated real-time

**Sales Returns Integration:**
- From Order Detail page, user can create Sales Return record
- Order page should show list of related returns
- Order status updates based on returns:\n  - If all products returned →'Refunded'
  - If partially returned → 'Partially Refunded'
  - If no returns → stays'Completed'
- **If credited order is returned, customer balance decreases proportionally**
\n**Employees Integration:**
- Each order stores cashier ID
- Employee performance statistics automatically updated
- Cancelled orders affect employee error rate

**Dashboard Integration:**
- Each new order immediately updates dashboard metrics
- Today's sales, order count, average value calculated real-time
- **Credit sales tracked separately**

#### 4.6.5 Validation and Security
Only users with Manager or Admin role can:
- Cancel orders
- Delete orders (if allowed at all)
\nChanges to orders (cancel, return) should be logged:\n- who, when, what changed
\n#### 4.6.6 UI/UX Requirements
- Clean, fast table view
- Sticky filters panel at top
- Status and payment_status with colored badges:\n  - Completed – green
  - Pending – blue
  - Voided – grey
  - Refunded – dark yellow
  - Partially Refunded – light yellow
  - **On Credit – blue**
  - **Paid – green**
  - **Partially Paid – light blue**
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
  - Date range\n  - Customer
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
- **Payment status (if order was on credit or partially paid)**
\n**Step 2 — Products to Return Table**
Auto-load all order products into table:\n\n**Columns:**
- Product name
- SKU\n- Quantity sold
- Return quantity (editable)
- Unit price
- Line total (auto-calculate)
\n**Validation:**
- Return quantity cannot exceed sold quantity
- If return quantity = 0 → skip product
\n**Auto-calculations:**
- line_total = unit_price × return_quantity
\n**Step 3 — Summary Block**
Show:
- Returned products subtotal
- Taxes (if used)
- Total return amount
- **Customer's new balance (if customer exists and order included credit)**

**Step 4 — Additional Fields**
- Return reason (select: damaged, wrong product, customer dissatisfaction, etc.)
- Notes (optional)
\n**Step 5 — Actions**
- Submit return → inventory increases, order updated, **customer balance decreased proportionally (if order included credit)**
- Cancel\n- Optional: Print return receipt\n
#### 4.7.3 Sales Return Detail Page
Detail view should show:
\n**Overview:**
- Return number
- Related order number
- Customer\n- Cashier
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
- **Customer's updated balance (if applicable)**

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
- product_id\n- quantity (+)\n- related_return_number
- date\n- performed_by (user)
\n#### 4.7.5 Orders Integration\n**Order detail should show list of related returns**

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
- **Customer account balance (reduce debt)**

**Refund should create:**
- payment_type: Refund
- amount: returned_amount
- method: selected method
\n#### 4.7.7 Customers Integration
If customer is linked:\n
**Customer balance decreases by proportional credit amount (if original order included credit)**

**Formula:**
- credit_portion_of_return = returned_amount × (order.credit_amount / order.total_amount)
- customer.balance -= credit_portion_of_return

**Customer profile shows:**
- Related returns\n- Returned products
- Return history
\n**Customer statistics automatically updated:**
- Total purchases amount decreases
- Returns count increases
- **Balance decreases proportionally (if order included credit)**\n
#### 4.7.8 Reports Integration
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
\n#### 4.7.10Numbering Policy (Mandatory)
**Return Numbering:**
- Format: RET-YYYYMMDD-#####
- Example: RET-20251205-00023

**Order-based link ensures traceability**

#### 4.7.11 Delete and Cancel Restrictions
- Only Manager and Admin can cancel or delete returns
- Cannot cancel return if inventory already updated
- All changes logged to audit log

#### 4.7.12 Audit Trail
For each return, log:
- Who created\n- When created
- From which order
- Which products returned
- How much amount returned
- Which method used for refund
- Who cancelled (if cancelled)
- **Customer balance adjustment (if applicable)**

### 4.8 Payments\n- Multiple payment methods\n- Partial payment capability
- Terminal integration
- Advance payment (for debtor customers)
- Payment details: number, date, amount, type, note
- Refund payments\n- **Customer balance integration**
- **Credit sales tracking (full and partial)**
- Real-time read payment methods from Settings module
- Each payment linked to order and customer
- Payments auto-sync to dashboard and reports

### 4.9 Suppliers Module

#### 4.9.1 Routing and Navigation
\n**Routes:**
- `/suppliers` → Supplier list page
- `/suppliers/new` → Create new supplier\n- `/suppliers/:id` → Supplier detail page
- `/suppliers/:id/edit` → Edit supplier
\n**Navigation:**
- Add 'Suppliers' to sidebar menu with icon (similar style to Customers)
- Routes wrapped inside authenticated layout with proper `useAuth` / `AuthProvider` configuration
- Same navigation guard as other modules

#### 4.9.2 Database Schema

**Table: `suppliers`**
\n**Fields:**
- id (UUID, primary key)
- name (required, text)
- phone (optional, text)
- email (optional, text, validated format)
- address (optional, text)
- note (optional, text)
- status ('Active' | 'Inactive', default: 'Active')
- created_at (timestamp)
- updated_at (timestamp)

**TypeScript Interface:**
\n```typescript
interface Supplier {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  note?: string;
  status: 'Active' | 'Inactive';
  created_at: string;
  updated_at: string;
}
```
\n**Relationships:**
- One-to-many with Purchase Orders (via `purchase_orders.supplier_id`)
\n#### 4.9.3 Suppliers List Page

**Page: `/suppliers`**

**Page Title:** Suppliers

**Table Columns:**
- Name – Supplier name
- Phone – Phone number
- Email – Email address
- Status – Active / Inactive (colored badge)
- Created Date – Creation date
- Actions – View / Edit / Delete

**Features:**
- Search by name, phone, email
- Filter by status (All / Active / Inactive)
- Pagination
- Export to Excel / PDF (optional)
- '+ Add Supplier' button

**Actions:**
- **View** (eye icon) → navigate to `/suppliers/:id`
- **Edit** (pencil icon) → navigate to `/suppliers/:id/edit`
- **Delete** (trash icon) → only allowed if supplier has no purchase orders
  - Show confirmation dialog:'Delete this supplier? This cannot be undone.'
  - If supplier has purchase orders → show error: 'Cannot delete supplier with existing purchase orders. Please remove or reassign purchase orders first.'

**Status Badge Colors:**
- Active → Green\n- Inactive → Red
\n#### 4.9.4 Create Supplier Page

**Page: `/suppliers/new`**\n
**Page Title:** Add New Supplier

**Form Fields:**
- Supplier Name (required, text input)
- Phone (optional, text input with phone format validation)
- Email (optional, text input with email format validation)
- Address (optional, textarea)
- Notes (optional, textarea)
- Status (Active / Inactive, default: Active, toggle or dropdown)
\n**Validation:**
- Name must not be empty
- Email must be valid format if provided
- Phone format validation (optional but recommended)
- Clean error messages displayed under each field

**Buttons:**
- **Save** → Insert supplier into database, show success toast: 'Supplier successfully created', navigate to `/suppliers/:id`
- **Cancel** → Navigate back to `/suppliers` without saving

**Error Handling:**
- Handle Supabase errors gracefully
- Show toast notification for errors: 'Failed to create supplier'\n\n#### 4.9.5 Edit Supplier Page

**Page: `/suppliers/:id/edit`**

**Page Title:** Edit Supplier
\n**Form Fields:**
- Pre-fill form with existing supplier data
- Same fields as Create Supplier page
\n**Validation:**
- Same as Create Supplier page

**Buttons:**
- **Save Changes** → Update supplier record, show success toast: 'Supplier updated', navigate to `/suppliers/:id`\n- **Cancel** → Navigate back to `/suppliers/:id` without saving

**Error Handling:**
- Handle Supabase errors gracefully
- Show toast notification for errors: 'Failed to update supplier'
\n#### 4.9.6Supplier Detail Page

**Page: `/suppliers/:id`**

**Page Title:** Supplier Detail

**Header Section:**
- Supplier name
- Status badge (Active / Inactive)
- Phone\n- Email
- Address\n- Notes
- Created date
- Updated date

**Actions:**
- **Edit** button → navigate to `/suppliers/:id/edit`
- **Delete** button → only allowed if supplier has no purchase orders
  - Show confirmation dialog\n  - If supplier has purchase orders → show error message\n
**Purchase Orders Section:**
\n**Section Title:** Purchase Orders from this Supplier

**Table Columns:**
- PO Number (e.g., PO-20251206-00015)
- Order Date (formatted date)
- Status (colored badge: Draft / Pending / Received / Cancelled)
- Total Cost (formatted currency)
- Actions – View (eye icon) → navigate to `/purchase-orders/:id`

**Features:**
- Pagination
- Filter by status (optional)
- Sort by date (optional)
\n**Empty State:**
- If no purchase orders → show message: 'No purchase orders from this supplier yet.'

#### 4.9.7 Purchase Orders Integration

**A) Supplier Dropdown in PO Creation & Editing**

**Location:** `/purchase-orders/new` and `/purchase-orders/:id/edit`

**Implementation:**
- Add 'Supplier' field (required, dropdown)
- Load suppliers from `suppliers` table
- Only show Active suppliers
- Sort suppliers alphabetically by name
- Dropdown should support search/filter (autosuggest)

**Validation:**
- Supplier is required before saving PO
- Show error message: 'Please select a supplier'

**B) Add New Supplier Modal**

**Location:** Inside PO creation/editing page

**Implementation:**\n- Add '+ Add Supplier' button next to supplier dropdown
- When clicked, open modal with supplier creation form
- Modal form fields:\n  - Supplier Name (required)
  - Phone (optional)\n  - Email (optional)
  - Address (optional)
  - Notes (optional)
  - Status (default: Active)
- After save:\n  - Insert supplier into database
  - Close modal
  - Autofill supplier dropdown with newly created supplier
  - Show success toast: 'Supplier created and selected'

**C) Autosuggest Search**

**Implementation:**
- When typing in supplier dropdown, show matching suppliers from database
- If no match found → show option: 'Create new supplier: [typed name]'
- Clicking this option opens'Add New Supplier' modal with name pre-filled
\n**D) Supplier Display in PO Detail Page**

**Location:** `/purchase-orders/:id`

**Implementation:**\n- Show supplier information in header section:\n  - Supplier name (clickable link → navigate to `/suppliers/:id`)\n  - Phone
  - Email
  - Address
- Clicking supplier name opens supplier detail page

**E) Database Relationship**

**Update `purchase_orders` table:**
- Add `supplier_id` field (UUID, foreign key to `suppliers.id`, required)
\n**Update TypeScript Interface:**

```typescript
interface PurchaseOrder {
  id: string;
  po_number: string;
  supplier_id: string; // required
  supplier?: Supplier; // joined data
  status: 'Draft' | 'Pending' | 'Received' | 'Cancelled';\n  order_date: string;
  expected_date?: string;
  total_cost: number;
  notes?: string;\n  created_by: string;
  created_at: string;
  updated_at: string;
}
```

#### 4.9.8 UI/UX Requirements

**Design Consistency:**
- Keep design consistent with POS theme:\n  - Blue accents (#2563EB)
  - Clean table layout
  - Card-based layout for forms
  - 12–14px typography hierarchy
  - Form labels with * for required fields
  - Error messages displayed under inputs
  - Toast notifications for actions

**Responsive Layout:**
- Single-column form layout for mobile
- Two-column layout for desktop
- Table view optimized for desktop, card view for mobile (optional)

**Status Badge Colors:**
- Active → Green
- Inactive → Red\n
**Modal Design:**
- Clean, centered modal for'Add New Supplier'\n- Overlay background with blur effect
- Close button (X) in top-right corner\n- Form fields same as main supplier creation page

#### 4.9.9 Validation and Error Handling

**Input Validation:**
- Name is required (cannot be empty)
- Email must be valid format if provided
- Phone format validation (optional but recommended)
- All validation at UI + API + DB level

**Error Messages:**
- Display clear, user-friendly error messages under each field
- Example: 'Supplier name is required', 'Invalid email format'
\n**Toast Notifications:**
- Success: 'Supplier successfully created', 'Supplier updated', 'Supplier deleted'
- Error: 'Failed to create supplier', 'Failed to update supplier', 'Cannot delete supplier with existing purchase orders'

**Delete Restrictions:**
- Cannot delete supplier if linked to purchase orders
- Show error message: 'Cannot delete supplier with existing purchase orders. Please remove or reassign purchase orders first.'
\n#### 4.9.10 Permissions and Security

**Admin / Manager:**
- Create, edit, delete suppliers
- Full access to all supplier operations
\n**Cashier / Employee:**
- View suppliers only (optional)
- No create/edit/delete rights

**Audit Logging:**
- Log all supplier operations:\n  - user_id
  - action (create / update / delete)
  - supplier_id
  - timestamp
  - ip_address
\n#### 4.9.11 Technical Requirements

**Database Table Structure:**
\n**`suppliers` table:**\n- id (UUID, primary key)
- name (text, required)
- phone (text, optional)
- email (text, optional)
- address (text, optional)
- note (text, optional)
- status ('Active' | 'Inactive', default: 'Active')
- created_at (timestamp)
- updated_at (timestamp)

**Relationships:**
- One-to-many with `purchase_orders` (via `purchase_orders.supplier_id`)\n
**TypeScript Types:**
- Full TypeScript typing for all supplier-related interfaces
- Update Supabase types accordingly

**API / RPC Functions:**
- CRUD operations for suppliers (create, read, update, delete)\n- Validation at API level
- Error handling with proper HTTP status codes

#### 4.9.12 Testing Scenarios

1. **Create a new supplier:**
   - Fill in all fields
   - Save\n   - Verify: Supplier created, success toast shown, navigated to supplier detail page

2. **Edit existing supplier:**
   - Change name and phone
   - Save
   - Verify: Supplier updated, success toast shown\n
3. **Delete supplier with no purchase orders:**
   - Click delete button
   - Confirm deletion
   - Verify: Supplier deleted, success toast shown

4. **Attempt to delete supplier with purchase orders:**
   - Click delete button
   - Verify: Error message shown, supplier not deleted

5. **Create PO with existing supplier:**
   - Select supplier from dropdown
   - Save PO
   - Verify: PO created with supplier linked\n
6. **Create PO with new supplier via modal:**
   - Click '+ Add Supplier' button
   - Fill in supplier form in modal
   - Save\n   - Verify: Supplier created, modal closed, supplier autofilled in dropdown, PO can be saved

7. **View supplier detail page:**
   - Navigate to supplier detail\n   - Verify: All supplier info displayed, list of purchase orders shown

8. **Click supplier name in PO detail page:**
   - Navigate to PO detail
   - Click supplier name
   - Verify: Navigated to supplier detail page\n
9. **Search suppliers in list page:**
   - Type supplier name in search box
   - Verify: Matching suppliers displayed\n
10. **Filter suppliers by status:**
    - Select'Active' or 'Inactive' filter
    - Verify: Only suppliers with selected status displayed

#### 4.9.13 Integration with Other Modules

**Purchase Orders Module:**
- Supplier dropdown in PO creation/editing
- Supplier information displayed in PO detail page
- Supplier name clickable link to supplier detail page
- '+ Add Supplier' modal in PO creation/editing

**Reports Module:**
- Supplier performance reports (optional):\n  - Total purchase orders by supplier
  - Total purchase amount by supplier
  - On-time delivery rate (future enhancement)

**Dashboard:**
- Active suppliers count (optional)
- Top suppliers by purchase volume (optional)

#### 4.9.14 Final Delivery Requirements

**AI should create a fully functional Suppliers module:**
\n✔ Complete CRUD operations (Create, Read, Update, Delete)\n✔ Supplier list page with search, filter, pagination
✔ Supplier detail page with purchase orders list
✔ Create and edit supplier pages with validation
✔ Full integration with Purchase Orders module:\n  - Supplier dropdown in PO creation/editing
  - '+ Add Supplier' modal\n  - Autosuggest search
  - Supplier detail link in PO detail page
✔ Database table and relationships
✔ TypeScript types and interfaces
✔ Error handling and validation
✔ Toast notifications\n✔ Permissions and security
✔ Audit logging
✔ Consistent UI/UX with POS theme
✔ Responsive design
✔ No navigation bugs
✔ Production-ready implementation

### 4.10 Purchase Orders Module (FULLY INTEGRATED WITH SUPPLIERS)

#### 4.10.1 Routing and Navigation

**Routes:**
- `/purchase-orders` → Purchase orders list page
- `/purchase-orders/new` → Create new purchase order
- `/purchase-orders/:id` → View purchase order detail
- `/purchase-orders/:id/edit` → Edit existing purchase order

**Navigation Fix:**
- The'New Purchase Order' button on the list page now correctly navigates to `/purchase-orders/new` instead of redirecting to Dashboard.\n- All routes are wrapped inside the authenticated layout with proper `useAuth` / `AuthProvider` configuration (no undefined context errors).

#### 4.10.2 Purchase Order Data Model

**Database Tables:**
\n**`purchase_orders` table:**
- id (primary key)
- po_number (format: PO-YYYYMMDD-#####, e.g., PO-20251206-00015)
- **supplier_id (foreign key to suppliers table, required)**
- status (Draft / Pending / Received / Cancelled)
- order_date (date)
- expected_date (date, optional)
- total_cost (numeric)
- notes (text, optional)
- created_by (user_id)
- created_at (timestamp)
- updated_at (timestamp)

**`purchase_order_items` table:**
- id (primary key)\n- purchase_order_id (foreign key)\n- product_id (foreign key)
- quantity (numeric, > 0)
- unit_cost (numeric, >= 0)
- line_total (calculated: quantity × unit_cost)
\n**`inventory_movements` table (existing, reused):**
- product_id\n- quantity_change (positive for purchases)\n- movement_type = 'purchase'\n- reference_id = purchase_order_id
- created_at\n\n**`suppliers` table (integrated):**
- Used for supplier dropdown in PO creation.\n\n**TypeScript Interfaces:**
\n```typescript
interface PurchaseOrder {
  id: string;
  po_number: string;
  supplier_id: string; // required
  supplier?: Supplier; // joined data\n  status: 'Draft' | 'Pending' | 'Received' | 'Cancelled';
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

#### 4.10.3 UI / UX – Purchase Order Creation Flow

**Page: `/purchase-orders/new`**

Implement a single-page or multi-step form:\n\n**Section 1: Basic Info**
- **Supplier** (required, dropdown from `suppliers` table with autosuggest search)
  - Only show Active suppliers
  - Sort alphabetically
  - **'+ Add Supplier' button** → opens modal to create new supplier
- **Order Date** (required, default: today)
- **Expected Date** (optional)\n- **Status** (Draft / Pending, default: Draft)
- **Notes** (optional, textarea)

**Validation:**
- Supplier is required.\n- Order date is required.
\n**Section 2: Add Products**
- **Product Search Input** (by name, SKU, or barcode)
- **Line Items Table:**
  - Columns:\n    - Product name
    - SKU
    - Quantity (editable, numeric input, must be > 0)
    - Unit cost (editable, numeric input, must be >= 0; default = product.purchase_price)
    - Line total (calculated: quantity × unit_cost, read-only)
  - Actions:\n    - Add row (+ button)
    - Remove row (trash icon)
\n**Validation:**
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

#### 4.10.4 Business Logic & Inventory Integration

**When a Purchase Order is saved as Draft:**
- Insert records into `purchase_orders` and `purchase_order_items`.\n- Do **not** affect product stock.
- Status = 'Draft'.\n\n**When a Purchase Order is marked as Received:**
(Either directly when creating via'Save & Mark as Received', or later from detail page via 'Mark as Received' button)
\n- Update `purchase_orders.status` to 'Received'.
- For each item in `purchase_order_items`:
  - **Increase product stock:**
    ```sql
    UPDATE products
    SET stock = stock + quantity
    WHERE id = product_id;
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
CREATE OR REPLACE FUNCTION mark_purchase_order_as_received(po_id UUID)\nRETURNS VOID AS $$
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

#### 4.10.5 Purchase Orders List Page

**Page: `/purchase-orders`**\n
**Features:**
- **Filters:**
  - Search by PO number or supplier name
  - Filter by status (All / Draft / Pending / Received / Cancelled)
  - Date range filter (order_date)
\n**Table Columns:**
- **PO Number** (e.g., PO-20251206-00015)
- **Supplier** (supplier name, clickable link → navigate to `/suppliers/:id`)
- **Order Date** (formatted date)
- **Status** (colored badge):\n  - Draft → Grey
  - Pending → Yellow
  - Received → Green
  - Cancelled → Red
- **Total Cost** (formatted currency)
- **Actions:**
  - **View** (eye icon) → navigate to `/purchase-orders/:id`
  - **Edit** (pencil icon) → navigate to `/purchase-orders/:id/edit` (only for Draft or Pending)\n  - **Mark as Received** (check icon) → call RPC function to mark as received (only for Pending)
  - **Cancel** (optional, does not change stock if not yet received)

**Pagination:**
- Implement pagination for large datasets.\n\n**Export:**
- Export to Excel / PDF (optional).

#### 4.10.6 Detail Page and Actions

**Page: `/purchase-orders/:id`**\n
**Header Section:**
- PO Number
- **Supplier name (clickable link → navigate to `/suppliers/:id`)**
- **Supplier phone**
- **Supplier email**
- **Supplier address**
- Order Date
- Expected Date (if any)
- Status badge
- Total Cost
- Notes (if any)
- Created by (user name)
- Created at (timestamp)\n
**Items Table:**
- Columns:
  - Product name
  - SKU\n  - Quantity
  - Unit cost
  - Line total
\n**Actions (based on status):**
\n- **If status is 'Pending':**
  - **'Mark as Received'** button:\n    - Call RPC function to update stock and log movements.\n    - Show success toast: 'Purchase order marked as received. Stock updated.'
    - Refresh page to show updated status.
\n- **If status is 'Draft':**
  - **'Edit'** button → navigate to `/purchase-orders/:id/edit`.\n\n- **If status is 'Received' or 'Cancelled':**\n  - Read-only view (no edit or mark as received).

**Optional:**
- **'Print'** button → generate PDF of purchase order.
- **'Cancel'** button (only for Draft or Pending, does not affect stock if not yet received).

#### 4.10.7 Edit Page

**Page: `/purchase-orders/:id/edit`**

- Pre-fill form with existing PO data.
- Allow editing:\n  - **Supplier** (dropdown with autosuggest, '+ Add Supplier' button)
  - Order Date\n  - Expected Date
  - Status (Draft / Pending)\n  - Notes
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
\n#### 4.10.8Validation, Types, and Error Handling

**TypeScript Types:**
- Update all TypeScript interfaces for `PurchaseOrder`, `PurchaseOrderItem`, and related Supabase types.

**Validation:**
- Required fields: Supplier, Order Date, at least one product.
- Quantity must be > 0.
- Unit cost must be >= 0.\n- Show user-friendly error messages for invalid inputs.

**Error Handling:**
- Handle Supabase errors gracefully.
- Show toast notifications for:\n  - Success: 'Purchase order created', 'Purchase order updated', 'Stock updated successfully'
  - Error: 'Failed to create purchase order', 'Failed to update stock'\n\n**Navigation:**
- Ensure no unexpected redirects to Dashboard.
- All navigation should be intentional and correct.

#### 4.10.9 Testing Scenarios

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

9. **Create PO with new supplier via modal:**
   - Click '+ Add Supplier' button.
   - Fill in supplier form in modal.
   - Save.
   - Verify: Supplier created, modal closed, supplier autofilled in dropdown, PO can be saved.

10. **Click supplier name in PO detail page:**
    - Navigate to PO detail.\n    - Click supplier name.
    - Verify: Navigated to supplier detail page.

#### 4.10.10 Integration with Other Modules

**Inventory Module:**
- Each PO receipt increases stock and logs movement.
- Inventory movements table shows 'purchase' type entries.

**Products Module:**
- Product selector in PO creation uses products table.
- Unit cost defaults to product.purchase_price.

**Suppliers Module:**\n- Supplier dropdown in PO creation uses suppliers table.
- '+ Add Supplier' modal in PO creation/editing.
- Supplier detail page shows list of purchase orders.
- Supplier name in PO detail page is clickable link to supplier detail.

**Reports Module:**
- Purchase Orders data feeds into:\n  - Purchase history by product
  - Supplier performance reports
  - Inventory valuation and cost analysis

**Dashboard:**
- Pending purchase orders count shown on dashboard.
- Real-time updates when PO is created or received.
\n#### 4.10.11 Permissions and Security

**Admin / Manager:**
- Create, edit, approve, receive, cancel POs.
\n**Cashier / Employee:**
- View only, optionally create drafts.

**Audit Logging:**
- All status changes and receipt operations logged:\n  - user, timestamp, old status, new status
\n#### 4.10.12 UI / UX Requirements

- Clean, card-based layout.
- Sticky header with key PO info.
- Products table with inline editing.
- Colored status badges:\n  - Draft – Grey
  - Pending – Yellow
  - Received – Green
  - Cancelled – Red
- Optimized for desktop (POS backoffice), tablet-friendly.\n\n#### 4.10.13 Numbering Policy

**PO Number Auto-generation:**
- Format: PO-YYYYMMDD-#####
- Example: PO-20251206-00015
\n**Order-based link ensures traceability.**

#### 4.10.14 Technical Requirements

**Purchase Orders Table Structure:**
- id\n- po_number
- **supplier_id (foreign key to suppliers.id, required)**
- status\n- order_date
- expected_date
- total_cost
- notes
- created_by
- created_at
- updated_at

**Purchase Order Items Table Structure:**
- id
- purchase_order_id\n- product_id\n- quantity
- unit_cost
- line_total\n\n**Relationships:**
- Many-to-many with Products (via PO Items)
- One-to-many with Inventory Movements
- **Many-to-one with Suppliers (via supplier_id)**

#### 4.10.15 Final Objective

- **'New Purchase Order' button opens a functional purchase order creation flow.**
- **Purchase Orders module supports full lifecycle: list, create, edit, receive.**
- **Product stock and inventory movements stay fully synchronized with purchase operations.**
- **No unexpected redirects to Dashboard.**
- **All routes and navigation work correctly.**
- **Data consistency ensured via database transactions.**
- **Full integration with Suppliers module:**
  - Supplier dropdown with autosuggest
  - '+ Add Supplier' modal
  - Supplier detail link in PO detail page
  - Supplier information displayed in PO detail

### 4.11 Inventory Count\n- Select warehouse\n- Enter actual quantity
- Compare with system quantity
- Auto-calculate difference and confirm
- Write to inventory movement\n- Inventory count number format: INV-YYYY-#####
- All changes sync real-time to dashboard and reports
- Full audit trail preserved\n
### 4.12 Customers Module (Enhanced with Credit/Debt Management and Partial Credit Payment Support)

#### 4.12.1 Customers List Page
**Page Title:** Customers

**Table Columns:**
- name – Full name or company name
- phone – Primary phone\n- type – Individual / Company
- total_sales – Total purchases amount
- **balance – Current balance (positive = customer debt, negative = store debt/refund)**
- last_order_date – Last purchase date
- status – Active / Inactive
- actions – View / Edit / Delete / **Receive Payment**

**Features:**
- Search by name / phone
- Filters:\n  - Type (Individual / Company)
  - Status (Active / Inactive)
  - **Balance (In Debt / No Debt / Credit Available)**
- Sorting:\n  - Total sales\n  - Last order date
  - Name A–Z / Z–A
  - **Balance (highest to lowest)**
- Export to Excel / PDF
- '+ Add Customer' button
\n**Balance Display:**
- **Positive balance (customer owes store):** Red or orange badge
- **Zero balance:** Grey badge
- **Negative balance (store owes customer):** Green badge

#### 4.12.2 Add / Edit Customer Form
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
- **credit_limit (optional, numeric, >= 0)**
- **allow_debt (yes/no, default: yes)**\n- initial_balance (default0; only on creation)
\n**Other:**
- notes – free text\n- status – Active / Inactive
\n**Validation:**
- Name and phone required\n- Phone unique (no duplicates)
- Tax number unique\n- Initial balance numeric
- **Credit limit numeric and >= 0**
- **Balance must be numeric**
\n**Buttons:** Save, Cancel\n
#### 4.12.3 Customer Detail Page
**Layout:** header with general info + tabs.\n
**Header Block:**
- Name + type badge
- Phone, email\n- Address\n- Status\n- **Credit limit**
- **Current balance (with color):**
  - **Red → customer owes store (positive balance)**
  - **Green → store owes customer/refund/advance payment (negative)**
  - **Grey → zero balance**
- **Available credit (credit_limit - balance, if credit_limit is set)**
\n**Key Metrics (cards):**
- Total sales amount
- Number of orders
- Average order value
- Total returns amount
- Last order date
- **Total credit sales amount**
- **Total payments received**
\n**Tab1 — Orders**
Table:\n- Order number
- Date
- Total amount
- Amount paid
- **Credit amount**
- **Payment status (Paid / On Credit / Partially Paid)**
- Status\n- Actions → go to order detail

**Tab 2 — Payments (NEW)**
Table:
- Date
- Amount
- Direction (Payment from customer / Refund to customer)\n- Method (Cash / Card / Transfer / Other)
- Related order (if any)
- Notes
- Actions → View receipt (optional)

**Balance calculated automatically based on orders + payments.**

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
  - **Credit sales created (full or partial)**
  - **Payments received**
\n#### 4.12.4 NEW FEATURE: Receive Payment (Pay off debt)

**Access:**
- From Customer detail page: button `Receive Payment`
- From Customers list page: action button for each customer
- Optionally from POS Terminal (button near customer dropdown)

**Modal or Page Fields:**
- Amount (required, numeric > 0, cannot exceed current balance if you choose to restrict)\n- Payment method: Cash / Card / QR / Bank Transfer\n- Optional note
- Optional reference number
\n**Validation:**
- Amount must be > 0
- Amount cannot exceed current balance (configurable)
- Payment method is required
\n**On Submit (Transaction-Safe):**
- Insert a record into `customer_payments` table:\n  - customer_id\n  - amount
  - method
  - note
  - created_at
  - created_by (user_id)
- Decrease `customer.balance` by `amount`:\n  ```sql
  UPDATE customers
  SET balance = balance - amount\n  WHERE id = customer_id;
  ```
- Log transaction in audit log
- Show success toast:\n  - 'Payment of300000 UZS received from Customer X. New balance: 950000 UZS.'
\n**Do NOT alter past paid orders; debt is tracked at customer level.**

**Transaction Safety:**
- All operations must run in a single database transaction
- If any part fails, entire operation should roll back
\n**Example Supabase RPC Function (Pseudocode):**
\n```sql
CREATE OR REPLACE FUNCTION receive_customer_payment(
  customer_id UUID,
  amount NUMERIC,\n  method TEXT,
  note TEXT\n)\nRETURNS VOID AS $$
BEGIN
  -- Insert payment record
  INSERT INTO customer_payments (customer_id, amount, method, note, created_at)\n  VALUES (customer_id, amount, method, note, NOW());
  
  -- Update customer balance
  UPDATE customers SET balance = balance - amount WHERE id = customer_id;
  
  -- Log audit trail
  INSERT INTO audit_logs(...) VALUES (...);
END;
$$ LANGUAGE plpgsql;\n```

**Frontend Call:**
\n```typescript
const { error } = await supabase.rpc('receive_customer_payment', {\n  customer_id: customerId,
  amount: paymentAmount,
  method: paymentMethod,
  note: paymentNote
});\n\nif (error) {
  toast.error('Failed to receive payment.');
} else {
  toast.success(`Payment of ${paymentAmount} UZS received. New balance: ${newBalance} UZS.`);\n}
```

#### 4.12.5 POS Terminal Integration
From POS Terminal, cashier can:
- Select existing customer
- Quick-create customer (name + phone + **credit limit**)
\nAfter sale:
- Order linked to customer
- **Balance updated if credit sale (full or partial)**
- Customer statistics updated real-time

#### 4.12.6 Balance and Debt Logic (Mandatory)
**Balance Formula:**
Balance = (Total credit amount from all orders – Total payments from customer + Store refunds)\n
**Balance Interpretation:**
- If balance > 0 → customer debt
- If balance < 0 → store owes (advance payment or refund)
\n**Show Warning When:**
- New sale would exceed credit_limit
- Customer has allow_debt = false and cashier tries credit sale
\n#### 4.12.7 Reports Integration
Customers module feeds data to reports:
- Top customers by sales\n- Most indebted customers
- Customer activity by period
- **Credit sales report**
- **Customer payments report**

#### 4.12.8 Permissions and Security
**Admin/Manager:** full access (add, edit, delete, adjust balance, receive payments)
**Cashier:** view + create + edit basic fields, no delete, no direct balance edit, **can receive payments (if enabled)**
\n**Delete customer only allowed if:**
- No related orders, payments, or returns
- Otherwise → mark as Inactive instead of physical delete

#### 4.12.9 UI/UX Requirements
- Clean, modern table view
- Sticky search and filters panel
- Colored badges for status and balance
- Responsive layout (desktop optimized, tablet-friendly)
- Fast navigation between customer → orders → payments and back
- **Clear visual indicators for debt status**
- **Prominent'Receive Payment' button**
\n#### 4.12.10 Technical Requirements
**Customers Table Structure:**
- id\n- name
- type (individual/company)
- phone
- email
- address
- company_name\n- tax_number
- **credit_limit (numeric, nullable, >= 0)**
- **allow_debt (boolean, default true)**
- initial_balance\n- **current_balance (numeric, default 0, NOT NULL)**
- notes
- status
- created_at
- updated_at
\n**Customer Payments Table Structure (NEW):**
- id (primary key)
- customer_id (foreign key to customers.id)
- amount (numeric, > 0)
- method (text: Cash / Card / QR / Bank Transfer)
- note (text, optional)
- reference_number (text, optional)
- created_at (timestamp)
- created_by (user_id)
\n**Relationships:**
- One-to-many with Orders\n- **One-to-many with Customer Payments**
- One-to-many with Returns
- Auto-calculate balance
\n#### 4.12.11 Testing Scenarios

1. **Create full credit sale:**
   - Select customer
   - Create order on credit (full amount)
   - Verify: Customer balance increased by full amount
\n2. **Create partial credit sale:**
   - Select customer\n   - Create order with partial credit (e.g., 500000 UZS credit, 500000 UZS paid)
   - Verify: Customer balance increased by credit amount only (500000 UZS)

3. **Receive payment:**
   - Open'Receive Payment' modal
   - Enter amount and method
   - Submit\n   - Verify: Customer balance decreased\n   - Verify: Payment record created

4. **View customer balance in detail page:**
   - Navigate to customer detail
   - Verify: Balance displayed with correct color
   - Verify: Available credit calculated correctly

5. **Attempt credit sale exceeding limit:**
   - Select customer with credit_limit = 1000000 UZS
   - Customer balance = 800000 UZS
   - Add products totaling 300000 UZS
   - Attempt credit sale\n   - Verify: Error message:'Credit limit exceeded for this customer.'

6. **Return partially credited order:**
   - Process return for partially credited order
   - Verify: Customer balance decreased by proportional credit amount

7. **View customer payments history:**
   - Navigate to customer detail → Payments tab
   - Verify: All payments listed with correct amounts and methods

### 4.13 Employees and Roles Module

#### 4.13.1 Employees Main Page
**Page Title:** Employees

**Table Columns:**
- Name – Full name\n- Role – Admin / Manager / Cashier\n- Phone – Phone number
- Email – Email address
- Status – Active / Disabled
- Last login – Last login time
- Actions – View, Edit, Deactivate\n
**Features:**
- Search by name, phone, or email
- Filters:
  - Role (Admin / Manager / Cashier)
  - Status (Active / Disabled)
- Pagination
- '+ Add Employee' button
\n#### 4.13.2 Add Employee Form
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
- Auto-assign permissions
\n#### 4.13.3 Edit Employee Page
**Editable Fields:**
- Name\n- Role (Admin can only demote/promote managers/cashiers)
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

#### 4.13.4 Employee Detail Page
**Sections:**
\n**A) Profile Overview**
- Name
- Role badge
- Contact info
- Current status
- Last login
- Account created date
\n**B) Performance Dashboard**
- Total sales completed
- Total revenue generated
- Average order amount
- Total returns processed
- Net profit from sales
- **Total credit sales processed (full and partial)**
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
\n**D) Activity Log**
Audit trail:
- Created orders
- Edited orders
- Cancellations
- Returns
- Inventory adjustments
- Price changes
- Held orders saved/restored
- **Credit sales created (full and partial)**
- **Customer payments received**

Each entry includes:
- Timestamp
- Action\n- Affected document ID
- Description
\n#### 4.13.5 POS Terminal Integration
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
- **Can process credit sales (full or partial, if enabled in settings)**
- **Can receive customer payments (if enabled)**
\n**Manager:**
- Can approve discounts
- Can override low-stock sales
- Can approve returns
\n**Admin:**
- Full access\n\n#### 4.13.6 Permissions & Security Layer
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
- Can create sales, returns\n- **Can process credit sales (full or partial, if enabled)**
- **Can receive customer payments (if enabled)**
- Cannot view financial reports
- Cannot edit inventory

**Backend Checks:**
- Protected employee records (cannot delete last admin)
- Strong password validation
- Account lockout after 5 failed login attempts
\n#### 4.13.7 Employee Activity Analytics
System calculates:
- Employee performance score\n- Profit contribution
- Transaction accuracy
- Error rate (cancelled/voided orders)
- Average checkout time
- Peak working hours
- **Credit sales processed (full and partial)**
- **Customer payments received**
\n**Visualization:**
- Line charts\n- Bar charts
- Pie charts
\n#### 4.13.8 Export & Reporting
Export capability:
- Employees list (Excel/PDF)
- Time logs\n- Cashier performance reports
- Employee activity logs
\n#### 4.13.9 Technical Requirements
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
- employee_id\n- action_type
- description
- document_id
- timestamp
- ip_address
\n**Time Tracking Table:**
- employee_id\n- login_time
- logout_time
- duration
- ip_address

#### 4.13.10 UI/UX Requirements
- Clean professional layout
- Consistent color scheme
- Responsive design
- Mobile-friendly version
- Sticky table header
- Loading states and skeletons
- Empty state placeholders
- Fast navigation between employee → orders → activity and back
\n#### 4.13.11 Permissions\n**Admin:**
- Full access to all employee operations
- Change roles\n- Delete employees
\n**Manager:**
- View employees
- Create/edit cashiers
- No delete rights

**Cashier:**
- View own profile only
- No edit rights
\n### 4.14 Reports Module (Enhanced with Credit/Debt Tracking and Partial Credit Payment Support)

#### 4.14.1 Reports Main Page\n**Page Title:** Reports

**Page Sections (card view with icons):**
- Sales Reports
- Inventory Reports
- Purchase Reports
- Supplier Reports
- Employee Reports
- Financial Reports
- **Customer Debt Reports (NEW)**
- Export Center

#### 4.14.2 Sales Reports
\n**4.14.2.1 Daily Sales Report**
\n**Table Columns:**
- Invoice number
- Date/time
- Cashier\n- Payment type (Cash / Card / Mixed / **Credit / Partial Credit**)
- Total sale\n- Profit
- Status (Completed / Returned / Cancelled)
- **Payment status (Paid / On Credit / Partially Paid)**
\n**Filters:**
- Date range
- Cashier
- Payment type
- Status
- **Payment status**

**Summary Metrics:**
- Total sales
- Total profit
- Total returns
- Average order value
- **Total credit sales (full credit)**
- **Total partial credit sales**
- **Total cash sales**
\n**Export:**
- Excel and PDF\n\n**Real-time Synchronization:**
- All metrics automatically updated from orders and returns modules
\n**4.14.2.2 Product Sales Report**

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
\n**4.14.2.3 Customer Sales Report**

**Table Columns:**
- Customer\n- Total purchases
- Number of orders
- Average order value
- **Outstanding balance**
- **Total credit sales (full and partial)**
- **Total payments received**

**Filters:**
- Customer name
- Date\n- **Balance status (In Debt / No Debt)**

#### 4.14.3 Inventory Reports

**4.14.3.1 Stock Levels Report**

**Table Columns:**
- Product name
- SKU
- Current stock
- Minimum stock
- Stock status (Low / OK / Out of stock)
\n**Features:**
- Auto color indicators
- Excel and PDF export
\n**4.14.3.2 Inventory Movement Report**

**Table Columns:**
- Date
- Product\n- Type (Sale, Purchase, Adjustment, Return)
- Quantity change (+/-)
- Referencedocument (Order ID / Purchase Order ID)
- Performed by user

**Filters:**
- Date range
- Type
- Product

**4.14.3.3 Valuation Report**

**Table Columns:**
- Product
- SKU
- Cost price
- Quantity
- Total value (qty × price)
\n**Summary Metrics:**
- Total inventory value
- Total units in stock
\n#### 4.14.4 Purchase Reports

**4.14.4.1 Purchase Order Summary**

**Table Columns:**
- PO number
- Supplier
- Total ordered amount
- Total received amount
- Status\n- Date

**4.14.4.2 Supplier Performance Report**

**Table Columns:**
- Supplier\n- Total purchases
- On-time delivery rate
- Number of purchase orders
- Returns from supplier
- Average cost savings

#### 4.14.5 Supplier Reports

**4.14.5.1 Supplier List Report**

**Table Columns:**
- Supplier name
- Total purchase orders
- Total purchase amount
- Last purchase date
- Status (Active / Inactive)

**Filters:**
- Status\n- Date range

**Export:**
- Excel and PDF\n
**4.14.5.2 Supplier Performance Report**
\n**Table Columns:**
- Supplier name
- Total purchase orders
- Total purchase amount
- Average order value
- On-time delivery rate (optional)
- Number of returns to supplier (optional)

**Filters:**
- Date range
- Supplier name

**Export:**
- Excel and PDF\n
#### 4.14.6 Employee Reports
\n**4.14.6.1 Cashier Performance**

**Table Columns:**
- Employee\n- Number of sales
- Total sales amount
- Total profit
- Mistakes / voided orders
- Working hours (optional)
- **Total credit sales processed (full and partial)**
- **Total customer payments received**

**4.14.6.2 Login Activity Log**

**Table Columns:**
- Employee
- Login time
- Logout time
- Duration\n- IP address

#### 4.14.7 Financial Reports

**4.14.7.1 Profit & Loss Report**

**Sections:**
- Gross sales
- Discounts (line and order discounts)
- Net sales
- Cost of goods sold - COGS
- Gross profit
- Returns\n- **Credit sales (full and partial, tracked separately)**
- Final profit

**Time Periods:**
- Daily
- Weekly
- Monthly
- Custom date\n
**4.14.7.2 Payment Method Breakdown**

**Chart:**
- Cash %
- Card %
- Mixed payments %
- **Credit (full) %**
- **Partial Credit %**

**Table:**
- Payment type
- Number of transactions
- Total amount
\n#### 4.14.8 Customer Debt Reports (NEW - ENHANCED)

**4.14.8.1 Outstanding Debt Report**

**Table Columns:**
- Customer name
- Phone\n- Current balance
- Credit limit
- Available credit
- Last order date
- Last payment date
- Days since last payment
\n**Filters:**
- Balance range (e.g., > 500000 UZS)
- Days since last payment (e.g., > 30 days)
- Customer name

**Summary Metrics:**
- Total outstanding debt
- Number of customers with debt
- Average debt per customer
- Total overdue debt (optional)

**Export:**\n- Excel and PDF
\n**4.14.8.2 Customer Payments Report**

**Table Columns:**
- Date
- Customer name
- Amount\n- Payment method
- Reference number
- Notes
- Processed by (employee)\n
**Filters:**\n- Date range
- Customer name
- Payment method
- Employee\n
**Summary Metrics:**
- Total payments received
- Number of payments\n- Average payment amount
\n**Export:**
- Excel and PDF

**4.14.8.3 Credit Sales Report (ENHANCED)**

**Table Columns:**
- Order number
- Date
- Customer name
- Total amount
- Credit amount
- Paid amount
- Payment status (On Credit / Partially Paid)
- Days since order

**Filters:**
- Date range
- Customer name
- Payment status
\n**Summary Metrics:**
- Total credit sales (full credit)
- Total partial credit sales\n- Number of credit orders
- Average credit amount\n
**Export:**
- Excel and PDF

#### 4.14.9 Dashboard Analytics (Optional Add-on)

**Visual Charts:**
- Sales chart by date
- Profit chart\n- Top products\n- Stock alerts
- Purchase trends
- **Customer debt trends**
- **Payment collection trends**

**Chart Types:**
- Bar chart
- Line chart
- Pie chart\n\n**Usage:**
- Recharts library
- Responsive UI
\n#### 4.14.10 Export Center

**Export support for each report:**
- Excel
- PDF
- CSV
\n#### 4.14.11 Filters and Search (Global Logic)

**Each report should support:**
- Global quick search
- Date range picker
- Multi-select filters
- Pagination
- Sorting
\n#### 4.14.12 Permissions\n
**Admin:**
- Access to all reports
\n**Manager:**
- Access to sales, inventory, financial reports
- **Access to customer debt reports**

**Cashier:**
- Access to personal performance report only

**Audit Logging:**
- View exports
- Create reports
\n#### 4.14.13 UI Requirements

- Clean professional layout
- Consistent color scheme\n- Responsive design
- Mobile-friendly version
- Sticky table header
- Loading states and skeletons
- Empty state placeholders
\n#### 4.14.14 Real-time Synchronization
- All reports receive real-time data from related modules
- Any change (order, return, inventory adjustment, **credit sale (full or partial), customer payment**) automatically updates reports
- Dashboard metrics constantly synchronized

### 4.15 Settings Module (Enhanced with Credit Sales Settings and Partial Credit Payment Support)

#### 4.15.1 Settings Main Page Layout
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
9. **Credit Sales Settings (ENHANCED)**
10. Backup & Data Management (optional)

#### 4.15.2 Company Profile

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
- Invoices
- Reports
\n#### 4.15.3 POS Terminal Settings
\n**Global parameters for POS front:**
- Default POS mode: Retail / Restaurant (enum only, for future)\n- Enable'Hold Order' feature (on/off)
- Enable 'Mixed Payment' (on/off)
- Enable 'Per-Product Discount' (on/off)\n- **Enable 'Credit Sales' (on/off)**
- **Enable 'Partial Credit Payment' (on/off)**
- Require customer selection for credit sales (on/off)
- Automatically log out cashier after X minutes of inactivity
- Show low-stock warning in POS (on/off)
- Quick access buttons limit (e.g., 8 / 12 / 16 products on main screen)

**These settings affect POS Terminal behavior real-time.**

#### 4.15.4 Payments & Taxes

**Payment Methods**\n\n**Configurable List:**
- Default methods: Cash, Card, QR, Bank transfer, **Credit**
- Capabilities:\n  - Enable/disable methods
  - Change labels (e.g., 'Terminal' instead of 'Card')
  - Add custom method (e.g., 'Debt', 'Wallet')
\n**Taxes**
\n- Enable tax system (on/off)
- Default tax rate (%)
- Tax inclusive / exclusive option
- Per-product tax override allowed (on/off)
\n**Validation:**
- Percentage must be 0 to 100
\n**Real-time Synchronization:**
- Payment methods changes immediately sync to POS Terminal and orders module
- Tax settings automatically applied to all price calculations

#### 4.15.5 Receipts & Printing

**Parameters for receipt templates:**
\n- Toggle: Auto print receipt after each sale (on/off)
- Receipt header text (multi-line; e.g., 'Thank you for shopping')
- Receipt footer text (return policy, contact info)\n- Show company logo on receipt (on/off)
- Show cashier name (on/off)
- Show customer name (on/off)
- Show product SKU (on/off)
- Show line discounts on receipt (on/off)
- **Show payment status on receipt (on/off)**
- Default receipt size: 58mm / 80mm
- Test print button (placeholder)

**These settings should be reused in print logic.**

#### 4.15.6 Inventory Settings

**Global inventory behavior:**
\n- Enable inventory tracking (on/off)\n- Default minimal stock level for new products
- Allow selling when stock is zero or negative:\n  - Option: Block sale, Allow with warning, Allow without warning
- Automatic cost calculation mode (for profit reports):
  - Latest purchase price
  - Average cost (future-ready)
- Automatic stock adjustment approval required (yes/no)
\n**Real-time Synchronization:**
- Inventory settings changes immediately applied to POS Terminal and Inventory module
\n#### 4.15.7 Numbering & IDs\n
**Settings for auto-generated numbers:**
\n**Fields:**
- Order number prefix (default: POS-)
- Order number format: POS-YYYYMMDD-#####
- Return number prefix (default: RET-)
- Purchase order prefix (default: PO-)
- Movement/adjustment prefix (optional)
\n**AI should support:**
- View next sequence number for eachdocument type
- Reset sequences (with confirmation modal)
\n**All IDs must remain unique.**

#### 4.15.8 User & Security\n
**Security Parameters:**

- Minimum password length (default6)
- Require strong password (letters + numbers) (on/off)
- Max failed login attempts before lock (e.g., 5)
- Session timeout (minutes)\n- Allow multiple active sessions per user (yes/no)
\n**Role Management (brief description, no full CRUD here):**
- Show list of roles (Admin, Manager, Cashier) with brief description
- Link or info that roles are managed in Employees module
\n**Audit:**
- Switch'Enable activity logging' (on/off) — if enabled, log critical actions (orders, returns, inventory adjustments, **credit sales (full and partial), customer payments**).
\n#### 4.15.9 Localization

**Fields:**
\n- Default language (e.g., Uzbek, Russian, English)
- Additional interface languages (for future use)
- Default currency (UZS, USD, etc.)
- Currency symbol position:\n  - Before amount (₩10000)\n  - After amount (10000 ₩)
- Thousand separator and decimal separator options
\n**These settings control formatting across all modules.**

#### 4.15.10 Credit Sales Settings (ENHANCED)
\n**Global Credit Sales Parameters:**

- **Enable credit sales system-wide (on/off)**
- **Enable partial credit payment (on/off)**
- **Default credit limit for new customers (numeric, optional)**
- **Require customer selection for credit sales (on/off, default: on)**
- **Allow cashiers to process credit sales (on/off)**
- **Allow cashiers to receive customer payments (on/off)**
- **Show customer debt warnings in POS (on/off)**\n- **Block credit sales when limit exceeded (on/off, default: on)**
- **Send debt reminder notifications (on/off, future feature)**
- **Debt reminder threshold (days, e.g., 30 days)**
\n**Validation:**
- Default credit limit must be >= 0
- Debt reminder threshold must be > 0

**Real-time Synchronization:**
- Credit sales settings changes immediately applied to POS Terminal and Customers module
\n#### 4.15.11 Backup & Data Management (Optional but Recommended)

**Settings:**

- Allow export of:\n  - Products
  - Customers
  - Suppliers
  - Orders
  - Inventory movements
  - **Customer payments**
- 'Download full backup' button (placeholder)
- Info text about where backups are stored

#### 4.15.12 Permissions & Access

**Only Admin role can view and modify Settings page.**

**Manager and Cashier cannot access this page.**

**Each save operation should:**
- Validate fields
- Show success or error toast
- Write to audit log:\n  - user, time, which section changed
\n#### 4.15.13 UI/UX Requirements

- Clean card-based layout for each section
- Left side panel or tabs for navigation between sections
- Save / Cancel buttons fixed at bottom of viewport
- Confirmation dialog when leaving page with unsaved changes
- Clear tooltips explaining risky parameters (e.g., 'Allow negative stock', **'Block credit sales when limit exceeded'**)
- Fully responsive (desktop priority, tablet-friendly)\n\n#### 4.15.14 Final AI Requirements

**AI should create fully functional Settings module:**
\n- Store configuration in central settings table / config store
- Apply these settings real-time in:\n  - POS Terminal
  - Orders\n  - Sales Returns
  - Inventory\n  - Purchase Orders
  - Reports
  - Employees
  - **Customers (credit sales with partial payment support)**
- Allow Admin to securely view and update configuration with validation and audit logging
- Use consistent UI with rest of POS system
- All changes sync immediately system-wide

## 5. Professional Features\n- Hold order (temporarily save receipt)
- Split payment (multiple payment types)
- Quick add product\n- Z-report and X-report
- Cash drawer open/close
- Shift-based accounting
- Device binding\n- Full Sales Returns system
- Full Customers system (balance, debt, credit limit, **credit sales (full and partial), customer payments**)
- Full Inventory Management system (real-time tracking, movements, adjustments, alerts)
- Full Purchase Orders system (create, approve, receive, inventory integration)
- Full Suppliers system (create, edit, view, integrate with Purchase Orders)
- Auto-sync with inventory\n- Audit trail and logs
- Full Reports Module (Sales, Inventory, Purchase, Supplier, Employee, Financial analytics, **Customer Debt Reports with partial credit tracking**)
- Full Employees Module (create, edit, role-based permissions, performance analysis, time tracking, audit logs, POS integration)
- Full Settings Module (Company Profile, POS Terminal, Payments & Taxes, Receipts, Inventory, Numbering, User & Security, Localization, **Credit Sales Settings with partial payment support**, Backup)\n- Real-time global synchronization across all modules
- Per-Product Discount\n- Enhanced Dashboard with date range selector, KPI cards, and analytics charts
- **Premium POS Terminal with:**
  - Quick Category Tabs
  - Favorites / Hot Products Panel
  - On-screen Numpad
  - Improved Per-Line Discount UX
  - Mixed Payments UX
  - Keyboard Shortcuts
  - Advanced Hold / Waiting Orders
  - Customer Info Badge
  - Quick Customer Create
  - Improved Notifications
  - **Credit Sales Support with Partial Credit Payment**
- **Customer Credit/Debt Management:**
  - Track customer balances
  - Credit limit enforcement
  - Customer payment processing
  - Debt reports and analytics
  - **Partial credit payment support**
\n## 6. Technical Requirements

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
- **Premium POS Terminal:**
  - Touch-friendly interface
  - Keyboard-friendly shortcuts
  - Smooth animations and transitions
  - Clear visual hierarchy
  - Responsive layout for desktop and tablet
- **Credit Sales UI:**
  - Clear debt indicators
  - Prominent payment buttons
  - Color-coded balance displays
  - **Partial credit payment UI clearly separated**

### 6.2 Security\n- JWT or Session authentication
- Role-based access control (RBAC)
- Offline data encryption
- Logs by cashier: who did what\n- Audit trail for returns\n- Delete and cancel restrictions
- Customer data security
- Supplier data security
- Employee data security
- Strong password policy
- Session management
- IP tracking\n- Prevent deleting last admin account
- Audit logging for all critical actions
- **Credit sales transaction logging (full and partial)**
- **Customer payment audit trail**

### 6.3 Integrations
- Fiscal printer\n- Barcode scanner
- QR Pay (Click/Payme)
- Inventory API
- Bank terminal\n- Full integration with Sales Returns
- Full integration with Customers
- Full integration with Inventory Management
- Full integration with Purchase Orders
- Full integration with Suppliers
- Full integration with Reports Module
- Full integration with Employees Module
- Full integration with Settings Module
- **Full integration with Customer Credit/Debt Management (including partial credit payment)**
- All modules sync real-time via centralized database
\n### 6.4 Database Architecture
- Centralized single database
- All modules read from and write to same data source
- Real-time synchronization across all modules
- Indexing for critical fields (SKU, order numbers, customer names, supplier names, **customer balance**)
- Optimized queries and caching
- Audit trail for all critical actions
- Held Orders table (pending_orders / held_orders)
- Suppliers table\n- **Customer Payments table**
- **Enhanced Customers table with balance and credit_limit fields**
- **Enhanced Orders table with payment_status, paid_amount, credit_amount fields**
- **Database constraint updated to support PARTIALLY_PAID status**

### 6.5 Performance and Optimization
- Cache dashboard data for fast loading
- Calculate heavy reports in background
- Fast performance even with 10,000+ records
- Real-time updates with minimal latency
- Optimized database queries
- **Index customer balance field for fast debt queries**
- **Premium POS Terminal:**
  - Fast rendering of product search results
  - Smooth scrolling and interactions
  - Optimized for high-volume retail environments
\n## 7. System Numbering Policy
- Receipt / Order: POS-YYYYMMDD-#####
  - Example: POS-20251205-00042
- Return: RET-YYYYMMDD-#####
  - Example: RET-20251205-00023
- Purchase Order: PO-YYYYMMDD-#####
  - Example: PO-20251206-00015
- Inventory Count: INV-YYYY-#####
- SKU: SKU-000123\n- Hold Order: HOLD-YYYYMMDD-####
\n## 8. Module Integration and Synchronization
Products, Categories, Inventory Management, Orders, Sales Returns, Purchase Orders, Suppliers, Customers, Employees, Reports, and Settings modules are fully integrated and real-time synchronized with:\n- POS Terminal
- Inventory\n- Purchase Orders
- Suppliers
- Sales\n- Reports
- Payments\n- Employees
- Settings
- Dashboard
- Held Orders
- **Customer Credit/Debt Management (including partial credit payment)**

**Synchronization Rules:**
- All operations are fully synchronized and auditable
- Any change (order, return, inventory adjustment, settings update, supplier update, **credit sale (full or partial), customer payment**) immediately reflects in all related modules
- Dashboard metrics updated real-time automatically
- Reports always show latest data
- Customer and employee statistics calculated automatically
- Supplier statistics calculated automatically
- Inventory stock updated after each transaction
- Settings changes immediately affect system behavior
- Held ordersdo not affect inventory or reports (only after payment is completed)
- **Customer balances updated after each credit sale (full or partial) and payment**

## 9. Design Style\n- Modern and professional appearance, suitable for business environment
- Primary colors: blue (#2563EB) and grey (#64748B) tones, white background (#FFFFFF)
- Card-style layout, each module in separate card
- Soft shadows (shadow-sm) and 8px border-radius
- Icons: modern line icons from Lucide or Heroicons library
- Tables: zebra-striped style with hover effect
- Buttons: filled (primary) and outlined (secondary) variants, minimum 44px height for touch screen
- Responsive grid layout: 3-4 columns for desktop, 2 columns for tablet\n- Category colored tags and icons shown in POS Terminal and products list
- Status color codes:\n  - Completed / Paid / In Stock / Received / Active → Green
  - Pending / Low Stock / Approved / Held → Yellow or Blue
  - Cancelled / Voided / Out of Stock / Inactive → Red
  - Refunded → Dark Yellow
  - Partially Refunded / Partially Paid / Partially Received → Light Yellow
  - Draft → Grey
  - **On Credit → Blue**
- Customer balance color codes:
  - **Red → customer owes (positive balance)**
  - **Green → store owes/advance payment (negative balance)**
  - **Grey → zero balance**
- Inventory movements color codes:
  - Positive (+) → Green
  - Negative (–) → Red
- Recharts library for charts
- Professional data visualization in Reports pages
- Colored indicators for Employee performance
- Left side panel or tabs navigation in Settings page, forms on right
- Consistent design language across all modules
- **Premium POS Terminal:**
  - Large, touch-friendly buttons
  - Clear visual hierarchy
  - Smooth animations and transitions
  - Color-coded status indicators
  - Modern, clean design
\n## 10. Final Delivery Requirements

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
✔ Full POS Terminal with Hold Order (Save Order to Waiting List) feature
✔ Fully functional and fixed Purchase Orders module
✔ Fully functional Suppliers module integrated with Purchase Orders
✔ Enhanced Dashboard with professional analytics, date range selector, KPI cards, and charts
✔ **Premium POS Terminal with:**
  - Quick Category Tabs
  - Favorites / Hot Products Panel (8 favorites with ALT+1-8 shortcuts)
  - On-screen Numpad for Quantity & Line Discount
  - Improved Per-Line Discount UX (quick percentage buttons: 5%, 10%, 15%)
  - Mixed Payments UX (Cash + Card split with validation)
  - Keyboard Shortcuts (ENTER, F2, F3, ESC, UP/DOWN, PLUS/MINUS, ALT+1-8)
  - Advanced Hold / Waiting Orders (named holds, side panel, visual priority)
  - Customer Info Badge (VIP, Debt, New, Credit Available, Credit Exceeded badges with tooltip)
  - Quick Customer Create ('+' button next to customer dropdown)
  - Improved Notifications (clear success and error toasts)
  - **Credit Sales Support with Partial Credit Payment (full and partial credit sale capability with customer balance tracking)**
✔ **Customer Credit/Debt Management:**
  - Track customer balances
  - Credit limit enforcement
  - Customer payment processing
  - Debt reports and analytics
  - **Partial credit payment support**
  - Full integration with POS Terminal, Orders, Returns, Reports, Dashboard\n\n---

## Summary of Partial Credit Payment Feature Enhancement

**New Features Implemented:**
\n1. **Partial Credit Payment in POS Terminal:**
   - Credit Amount input field in payment modal
   - Default value: full order total
   - Max value: min(orderTotal, customer.credit_limit - customer.balance)
   - Editable by cashier
   - Real-time display of:\n     - Current Balance
     - Credit Amount
     - New Balance\n     - Remaining to Pay
   - Automatic activation of Cash/Card/QR fields when credit amount< order total
\n2. **Payment Status Logic:**
   - **PAID:** credit_amount = 0, paid_amount = order_total
   - **ON_CREDIT:** credit_amount = order_total, paid_amount = 0
   - **PARTIALLY_PAID:** 0 < credit_amount < order_total, paid_amount = order_total - credit_amount
\n3. **Database Updates:**
   - Updated `orders` table constraint to support 'PARTIALLY_PAID' status
   - Enhanced RPC function to handle partial credit payment logic
\n4. **Customer Balance Calculation:**
   - Balance increases only by credit_amount (not full order total)
   - Partial payment amount does not affect customer balance
\n5. **Sales Returns Integration:**
   - Proportional credit amount calculation for returns
   - Formula: credit_portion_of_return = returned_amount × (order.credit_amount / order.total_amount)
   - Customer balance decreased by proportional credit amount only

6. **UI/UX Enhancements:**
   - Clear visual separation of credit and payment sections
   - Real-time validation and error messages
   - Color-coded balance displays
   - Enhanced toast notifications for partial credit sales
\n7. **Reports Integration:**
   - Enhanced Credit Sales Report with paid_amount column
   - Separate tracking of full credit vs partial credit sales
   - Updated summary metrics to distinguish between full and partial credit\n
8. **Settings Integration:**
   - New setting: Enable/disable partial credit payment
   - Real-time sync with POS Terminal
\n**Database Changes:**
\n- **orders table:**
  - payment_status constraint updated: CHECK (payment_status IN ('PAID', 'ON_CREDIT', 'PARTIALLY_PAID'))
\n**Technical Implementation:**

- Transaction-safe operations (RPC functions)
- Real-time synchronization across all modules
- Audit trail for all partial credit sales and payments
- Validation at UI, API, and database levels
- Error handling with clear user messages
- TypeScript types for all new interfaces

**Testing Checklist:**

1. Create full credit sale\n2. Create partial credit sale (e.g., 50% credit, 50% cash)
3. Create zero credit sale (full payment)
4. Receive customer payment
5. View customer balance in POS Terminal
6. Attempt credit sale exceeding limit
7. Attempt partial credit with invalid payment amounts
8. Return partially credited order
9. View customer payments history
10. View debt reports
11. Test transaction rollback on error
12. Test permissions (cashier vs admin)
13. Test real-time dashboard updates
14. Edit credit amount in payment modal
15. Test credit amount validation
\n**Delivery Summary:**

When implementation is complete, provide:
- List of database migrations created
- List of RPC functions created/updated
- List of components created/modified
- How to use the new partial credit payment features
- Any new environment variables or configs (if added)
- Testing checklist for new features
- Known limitations or next steps for future improvements

---
\n**Note:** This updated requirements document includes all existing POS system features plus the enhanced Customer Credit/Debt Management feature with partial credit payment support. All modules are fully integrated and synchronized in real-time. The system is production-ready and follows best practices for security, performance, and user experience.
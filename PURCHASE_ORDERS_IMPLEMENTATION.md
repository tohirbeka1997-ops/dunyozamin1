# Purchase Orders Module - Complete Implementation

## Summary

The Purchase Orders module has been fully implemented with complete CRUD functionality, inventory integration, and proper routing.

## Problem Fixed

**Original Issue**: Clicking "New Purchase Order" button redirected to Dashboard instead of opening a creation form.

**Root Cause**: Missing routes for `/purchase-orders/new`, `/purchase-orders/:id`, and `/purchase-orders/:id/edit`.

**Solution**: Created complete Purchase Order workflow with proper routing, forms, and inventory integration.

---

## Implementation Details

### 1. New Pages Created

#### A. PurchaseOrderForm.tsx (`/src/pages/PurchaseOrderForm.tsx`)
**Purpose**: Create and edit purchase orders

**Features**:
- Multi-section form with validation
- Supplier selection (from existing suppliers or manual entry)
- Product search and selection
- Dynamic line items with quantity and unit cost editing
- Real-time subtotal calculation
- Two save options:
  - "Save as Draft" - Creates PO without affecting stock
  - "Save & Mark as Received" - Creates PO and immediately updates stock
- Edit mode for existing draft/approved POs
- Read-only mode for received POs

**Form Fields**:
- Supplier (dropdown or manual entry) *
- Order Date (default: today) *
- Expected Date (optional)
- Status (Draft/Approved)
- Notes (optional)
- Products table with:
  - Product name
  - Quantity (editable)
  - Unit cost (editable, defaults to purchase_price)
  - Line total (auto-calculated)

**Validation**:
- Supplier required
- Order date required
- At least one product required
- Quantity must be > 0
- Unit cost must be ≥ 0

#### B. PurchaseOrderDetail.tsx (`/src/pages/PurchaseOrderDetail.tsx`)
**Purpose**: View purchase order details and perform actions

**Features**:
- Display complete PO information
- Show all line items with ordered vs received quantities
- Status-based actions:
  - **Draft/Approved**: Edit button, Cancel button
  - **Approved/Partially Received**: Receive Goods button
  - **Received**: Read-only view
- Receive Goods dialog with confirmation
- Cancel Order dialog with confirmation
- Order summary with totals

**Information Displayed**:
- PO Number
- Status (with colored badges)
- Supplier
- Order Date / Expected Date
- Reference
- Created By / Created At
- Notes
- Items table (product, ordered qty, received qty, unit cost, line total)
- Order summary (subtotal, discount, tax, total)
- Statistics (total items, total ordered qty, total received qty)

### 2. Routes Added

Updated `/src/routes.tsx` with:

```typescript
{
  name: 'New Purchase Order',
  path: '/purchase-orders/new',
  element: <PurchaseOrderForm />,
  visible: false,
  requireAuth: true,
  allowedRoles: ['admin', 'manager'],
},
{
  name: 'Edit Purchase Order',
  path: '/purchase-orders/:id/edit',
  element: <PurchaseOrderForm />,
  visible: false,
  requireAuth: true,
  allowedRoles: ['admin', 'manager'],
},
{
  name: 'Purchase Order Detail',
  path: '/purchase-orders/:id',
  element: <PurchaseOrderDetail />,
  visible: false,
  requireAuth: true,
  allowedRoles: ['admin', 'manager'],
},
```

### 3. Database Enhancements

#### Migration: 00021_enhance_receive_goods_function.sql

**Problem**: The `receive_goods` RPC function updated stock but didn't update PO status.

**Solution**: Enhanced the function to automatically update PO status based on received quantities:
- If all items fully received → status = 'received'
- If some items partially received → status = 'partially_received'
- Otherwise → keep current status

**Function Signature**:
```sql
receive_goods(
  p_po_id uuid,
  p_items jsonb,
  p_received_date date DEFAULT CURRENT_DATE
)
```

**What it does**:
1. Validates PO exists and is not cancelled
2. For each item:
   - Updates `received_qty` in `purchase_order_items`
   - Calls `log_inventory_movement` to update product stock
   - Creates inventory movement record
3. Calculates new PO status based on received quantities
4. Updates `purchase_orders.status`
5. Returns success with statistics

**Returns**:
```json
{
  "success": true,
  "message": "Goods received successfully",
  "new_status": "received",
  "total_items": 3,
  "fully_received": 3,
  "partially_received": 0
}
```

---

## Complete Workflow

### Workflow 1: Create Draft PO

1. Navigate to `/purchase-orders`
2. Click "New Purchase Order"
3. Fill in supplier, dates, notes
4. Add products using search
5. Adjust quantities and unit costs
6. Click "Save as Draft"
7. PO created with status = 'draft'
8. **Stock NOT affected**
9. Redirects to `/purchase-orders`

### Workflow 2: Create and Immediately Receive

1. Navigate to `/purchase-orders`
2. Click "New Purchase Order"
3. Fill in supplier, dates, notes
4. Add products using search
5. Adjust quantities and unit costs
6. Click "Save & Mark as Received"
7. PO created with status = 'received'
8. **Stock INCREASED for all products**
9. **Inventory movements logged**
10. Redirects to `/purchase-orders`

### Workflow 3: Edit Draft PO

1. Navigate to `/purchase-orders`
2. Find draft PO, click Edit icon
3. Modify supplier, dates, products, quantities
4. Click "Update Purchase Order"
5. PO updated
6. **Stock still NOT affected** (remains draft)
7. Redirects to `/purchase-orders`

### Workflow 4: Receive Goods for Approved PO

1. Navigate to `/purchase-orders`
2. Find approved PO, click View icon
3. Click "Receive Goods" button
4. Confirm in dialog
5. `receive_goods` RPC called
6. **Stock INCREASED for all items**
7. **Inventory movements logged**
8. **PO status updated to 'received'**
9. Success toast shown
10. Detail page refreshed

### Workflow 5: Cancel PO

1. Navigate to `/purchase-orders`
2. Find draft/approved PO, click View icon
3. Click "Cancel" button
4. Confirm in dialog
5. PO status updated to 'cancelled'
6. **No stock changes** (only if not yet received)
7. Success toast shown
8. Detail page refreshed

---

## Stock Synchronization

### When Stock is Updated

**Scenario 1: Save & Mark as Received (Create)**
```
1. Create PO with items
2. Fetch created PO to get item IDs
3. Call receive_goods RPC
4. For each item:
   - log_inventory_movement(product_id, 'purchase', +quantity)
   - UPDATE products SET current_stock = current_stock + quantity
   - INSERT INTO inventory_movements (type='purchase', qty=+X)
5. Update PO status to 'received'
```

**Scenario 2: Receive Goods (Detail Page)**
```
1. User clicks "Receive Goods"
2. Call receive_goods RPC with item IDs
3. For each item:
   - Calculate remaining qty = ordered_qty - received_qty
   - log_inventory_movement(product_id, 'purchase', +remaining_qty)
   - UPDATE products SET current_stock = current_stock + remaining_qty
   - INSERT INTO inventory_movements (type='purchase', qty=+X)
4. Update PO status based on received quantities
```

### When Stock is NOT Updated

- **Save as Draft**: PO created, no stock changes
- **Edit Draft**: PO updated, no stock changes
- **Cancel PO**: Status changed, no stock changes (unless already received)

---

## Data Flow

### Create Purchase Order

```
User Input (Form)
    ↓
Generate PO Number (RPC: generate_po_number)
    ↓
Create PO Record (INSERT INTO purchase_orders)
    ↓
Create PO Items (INSERT INTO purchase_order_items)
    ↓
If "Mark as Received":
    ↓
Fetch PO with Item IDs
    ↓
Call receive_goods RPC
    ↓
Update Stock & Log Movements
    ↓
Update PO Status
    ↓
Navigate to List Page
```

### Receive Goods

```
User Clicks "Receive Goods"
    ↓
Show Confirmation Dialog
    ↓
User Confirms
    ↓
Call receive_goods RPC
    ↓
For Each Item:
    - Update received_qty
    - Call log_inventory_movement
        - UPDATE products.current_stock
        - INSERT inventory_movements
    ↓
Calculate New Status
    ↓
Update PO Status
    ↓
Return Success
    ↓
Show Toast & Refresh Page
```

---

## API Functions Used

### From `/src/db/api.ts`

1. **getSuppliers()** - Fetch all suppliers for dropdown
2. **getProducts(includeInactive)** - Fetch products for search
3. **getPurchaseOrderById(id)** - Fetch PO details
4. **generatePONumber()** - Generate unique PO number (PRC-YYYY-#####)
5. **createPurchaseOrder(data, items)** - Create new PO
6. **updatePurchaseOrder(id, data, items)** - Update existing PO
7. **receiveGoods(poId, items, date)** - Receive goods and update stock

### RPC Functions

1. **generate_po_number()** - Returns next PO number
2. **receive_goods(p_po_id, p_items, p_received_date)** - Receives goods, updates stock, logs movements, updates status
3. **log_inventory_movement(...)** - Updates product stock and creates movement record

---

## UI/UX Features

### Purchase Order List Page

**Filters**:
- Search by PO number or supplier name
- Filter by status (All, Draft, Approved, Partially Received, Received, Cancelled)
- Filter by supplier
- Date range filter (from/to)

**Columns**:
- PO Number
- Supplier
- Order Date
- Expected Date
- Total Amount
- Received Amount
- Status (colored badges)
- Created By
- Actions (View, Edit, Receive, Cancel)

**Status Badges**:
- Draft: Grey
- Approved: Blue
- Partially Received: Yellow
- Received: Green
- Cancelled: Red

### Purchase Order Form

**Layout**:
- Left column (2/3 width):
  - Basic Information card
  - Products card with search and table
- Right column (1/3 width):
  - Order Summary card with totals
  - Action buttons
  - Help text

**Product Search**:
- Real-time search by name, SKU, or barcode
- Shows product name, SKU, current stock, unit
- Click to add to order
- Prevents duplicate products

**Line Items Table**:
- Editable quantity (number input)
- Editable unit cost (number input)
- Auto-calculated line total
- Remove button for each item
- Real-time subtotal update

### Purchase Order Detail

**Layout**:
- Left column (2/3 width):
  - Order Information card
  - Order Items table
- Right column (1/3 width):
  - Order Summary card
  - Statistics

**Actions**:
- Edit (only for draft/approved)
- Receive Goods (only for approved/partially_received)
- Cancel (only for draft/approved)

**Dialogs**:
- Receive Goods confirmation with item list
- Cancel Order confirmation

---

## Validation & Error Handling

### Form Validation

**Required Fields**:
- Supplier (either from dropdown or manual entry)
- Order Date
- At least one product

**Business Rules**:
- Quantity must be > 0
- Unit cost must be ≥ 0
- Cannot receive more than ordered quantity
- Cannot edit received POs
- Cannot receive cancelled POs

### Error Messages

**User-Friendly Toasts**:
- "Please select or enter a supplier"
- "Please select an order date"
- "Please add at least one product"
- "Quantity must be greater than 0"
- "Unit cost cannot be negative"
- "Product already added"
- "Failed to load data"
- "Failed to save purchase order"
- "Failed to receive goods"

### Success Messages

- "Purchase order created successfully"
- "Purchase order updated successfully"
- "Stock updated successfully"
- "Goods received successfully. Stock has been updated."
- "Purchase order cancelled"

---

## Testing Scenarios

### Test 1: Create Draft PO
**Steps**:
1. Go to `/purchase-orders`
2. Click "New Purchase Order"
3. Select supplier "ABC Supplier"
4. Add 2 products: Rice (10 kg), Sugar (5 kg)
5. Click "Save as Draft"

**Expected**:
- ✅ PO created with status = 'draft'
- ✅ PO number generated (PRC-2025-00001)
- ✅ Products page: Stock unchanged
- ✅ Redirected to `/purchase-orders`
- ✅ New PO visible in list

**Verification**:
```sql
SELECT * FROM purchase_orders WHERE po_number = 'PRC-2025-00001';
-- status should be 'draft'

SELECT * FROM purchase_order_items WHERE purchase_order_id = '<po_id>';
-- should have 2 items, received_qty = 0

SELECT current_stock FROM products WHERE name IN ('Rice', 'Sugar');
-- stock should be unchanged
```

### Test 2: Create and Immediately Receive
**Steps**:
1. Go to `/purchase-orders`
2. Click "New Purchase Order"
3. Select supplier "XYZ Supplier"
4. Add product: Oil (20 L)
5. Click "Save & Mark as Received"

**Expected**:
- ✅ PO created with status = 'received'
- ✅ Products page: Oil stock increased by 20
- ✅ Inventory movements: 1 new record (type='purchase', qty=+20)
- ✅ Toast: "Stock updated successfully"

**Verification**:
```sql
SELECT * FROM purchase_orders WHERE po_number = 'PRC-2025-00002';
-- status should be 'received'

SELECT current_stock FROM products WHERE name = 'Oil';
-- stock should be increased by 20

SELECT * FROM inventory_movements 
WHERE product_id = (SELECT id FROM products WHERE name = 'Oil')
ORDER BY created_at DESC LIMIT 1;
-- movement_type = 'purchase', quantity = 20
```

### Test 3: Edit Draft PO
**Steps**:
1. Find draft PO from Test 1
2. Click Edit icon
3. Change Rice quantity from 10 to 15
4. Add new product: Salt (3 kg)
5. Click "Update Purchase Order"

**Expected**:
- ✅ PO updated with new quantities
- ✅ 3 items now (Rice, Sugar, Salt)
- ✅ Status still 'draft'
- ✅ Stock still unchanged

**Verification**:
```sql
SELECT * FROM purchase_order_items WHERE purchase_order_id = '<po_id>';
-- should have 3 items
-- Rice ordered_qty = 15
-- All received_qty = 0

SELECT current_stock FROM products WHERE name IN ('Rice', 'Sugar', 'Salt');
-- all stock unchanged
```

### Test 4: Receive Goods
**Steps**:
1. Update PO from Test 3 to status = 'approved' (via database or UI)
2. Go to PO detail page
3. Click "Receive Goods"
4. Confirm in dialog

**Expected**:
- ✅ PO status updated to 'received'
- ✅ All items: received_qty = ordered_qty
- ✅ Products page: Stock increased for all 3 products
- ✅ Inventory movements: 3 new records
- ✅ Toast: "Goods received successfully"

**Verification**:
```sql
SELECT * FROM purchase_orders WHERE id = '<po_id>';
-- status = 'received'

SELECT * FROM purchase_order_items WHERE purchase_order_id = '<po_id>';
-- Rice: received_qty = 15
-- Sugar: received_qty = 5
-- Salt: received_qty = 3

SELECT name, current_stock FROM products WHERE name IN ('Rice', 'Sugar', 'Salt');
-- Rice: +15
-- Sugar: +5
-- Salt: +3

SELECT COUNT(*) FROM inventory_movements 
WHERE reference_type = 'purchase_order' AND reference_id = '<po_id>';
-- should be 3
```

### Test 5: Cancel PO
**Steps**:
1. Create new draft PO
2. Go to detail page
3. Click "Cancel"
4. Confirm in dialog

**Expected**:
- ✅ PO status updated to 'cancelled'
- ✅ Stock unchanged
- ✅ Cannot edit or receive
- ✅ Toast: "Purchase order cancelled"

**Verification**:
```sql
SELECT status FROM purchase_orders WHERE id = '<po_id>';
-- status = 'cancelled'

-- Stock should be unchanged
```

### Test 6: Navigation
**Steps**:
1. Go to `/purchase-orders`
2. Click "New Purchase Order"
3. Verify URL is `/purchase-orders/new`
4. Click Back button
5. Verify URL is `/purchase-orders`
6. Click View icon on any PO
7. Verify URL is `/purchase-orders/<id>`
8. Click Edit button
9. Verify URL is `/purchase-orders/<id>/edit`

**Expected**:
- ✅ All routes work correctly
- ✅ No redirect to Dashboard
- ✅ Back button works
- ✅ Breadcrumbs correct

### Test 7: Validation
**Steps**:
1. Go to `/purchase-orders/new`
2. Try to save without supplier
3. Try to save without products
4. Add product with quantity = 0
5. Add product with unit cost = -10

**Expected**:
- ✅ Error: "Please select or enter a supplier"
- ✅ Error: "Please add at least one product"
- ✅ Error: "Quantity must be greater than 0"
- ✅ Error: "Unit cost cannot be negative"
- ✅ Form not submitted

### Test 8: Permissions
**Steps**:
1. Login as 'cashier' role
2. Try to access `/purchase-orders`

**Expected**:
- ✅ Access denied (only admin/manager allowed)
- ✅ Redirected to Dashboard or Login

---

## Files Modified/Created

### Created Files
1. `/src/pages/PurchaseOrderForm.tsx` (650 lines)
2. `/src/pages/PurchaseOrderDetail.tsx` (450 lines)
3. `/supabase/migrations/00021_enhance_receive_goods_function.sql`
4. `/PURCHASE_ORDERS_IMPLEMENTATION.md` (this file)

### Modified Files
1. `/src/routes.tsx` - Added 3 new routes
2. `/src/pages/PurchaseOrders.tsx` - Already had correct navigation (no changes needed)

---

## Database Schema

### purchase_orders Table
```sql
CREATE TABLE purchase_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  po_number text UNIQUE NOT NULL,
  supplier_id uuid REFERENCES suppliers(id),
  supplier_name text,
  order_date date NOT NULL,
  expected_date date,
  reference text,
  subtotal numeric DEFAULT 0,
  discount numeric DEFAULT 0,
  tax numeric DEFAULT 0,
  total_amount numeric DEFAULT 0,
  status text NOT NULL CHECK (status IN ('draft', 'approved', 'partially_received', 'received', 'cancelled')),
  invoice_number text,
  received_by uuid REFERENCES profiles(id),
  created_by uuid REFERENCES profiles(id),
  approved_by uuid REFERENCES profiles(id),
  approved_at timestamptz,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
```

### purchase_order_items Table
```sql
CREATE TABLE purchase_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id uuid REFERENCES purchase_orders(id) ON DELETE CASCADE,
  product_id uuid REFERENCES products(id),
  product_name text NOT NULL,
  ordered_qty numeric NOT NULL,
  received_qty numeric DEFAULT 0,
  unit_cost numeric NOT NULL,
  line_total numeric NOT NULL,
  created_at timestamptz DEFAULT now()
);
```

### inventory_movements Table (Existing)
```sql
CREATE TABLE inventory_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  movement_number text UNIQUE NOT NULL,
  product_id uuid REFERENCES products(id),
  movement_type text NOT NULL CHECK (movement_type IN ('purchase', 'sale', 'return', 'adjustment', 'audit')),
  quantity numeric NOT NULL,
  before_quantity numeric,
  after_quantity numeric,
  reference_type text,
  reference_id uuid,
  notes text,
  created_by uuid REFERENCES profiles(id),
  created_at timestamptz DEFAULT now()
);
```

---

## Status Transitions

```
draft
  ↓ (approve)
approved
  ↓ (receive partial)
partially_received
  ↓ (receive remaining)
received

Any of (draft, approved) can transition to:
  → cancelled
```

**Rules**:
- Draft → Approved: Manual status change
- Approved → Partially Received: Automatic when some items received
- Partially Received → Received: Automatic when all items received
- Approved → Received: Automatic when all items received at once
- Draft/Approved → Cancelled: Manual cancellation

---

## Success Criteria

### ✅ All Implemented
- [x] "New Purchase Order" button opens form (not Dashboard)
- [x] Create new purchase orders with products
- [x] Edit draft/approved purchase orders
- [x] View purchase order details
- [x] Receive goods and update stock
- [x] Cancel purchase orders
- [x] Stock synchronization with inventory
- [x] Inventory movements logging
- [x] Automatic PO status updates
- [x] Form validation
- [x] Error handling
- [x] Success notifications
- [x] TypeScript type safety
- [x] Responsive UI
- [x] Role-based access control

### ✅ Navigation Fixed
- [x] `/purchase-orders` → List page
- [x] `/purchase-orders/new` → Create form
- [x] `/purchase-orders/:id` → Detail page
- [x] `/purchase-orders/:id/edit` → Edit form
- [x] All routes properly authenticated
- [x] No unexpected redirects to Dashboard

### ✅ Stock Integration
- [x] Draft POs don't affect stock
- [x] Received POs increase stock
- [x] Inventory movements logged
- [x] Products page shows updated stock
- [x] Transaction safety (all-or-nothing)

---

## Next Steps (Optional Enhancements)

### Future Improvements
1. **Partial Receiving**: Allow receiving specific quantities per item (not just all or nothing)
2. **Approval Workflow**: Add approval step with notifications
3. **PDF Export**: Generate PDF purchase orders
4. **Email Integration**: Send POs to suppliers via email
5. **Supplier Portal**: Allow suppliers to view and confirm POs
6. **Recurring POs**: Create recurring purchase orders
7. **Price History**: Track unit cost changes over time
8. **Supplier Performance**: Track delivery times and quality
9. **Budget Tracking**: Set and monitor purchasing budgets
10. **Multi-location**: Support multiple warehouses/locations

---

## Conclusion

The Purchase Orders module is now **fully functional** with:
- ✅ Complete CRUD operations
- ✅ Proper routing (no Dashboard redirects)
- ✅ Stock synchronization
- ✅ Inventory movement logging
- ✅ Automatic status updates
- ✅ Form validation
- ✅ Error handling
- ✅ User-friendly UI
- ✅ TypeScript type safety
- ✅ Role-based access control

**Status**: ✅ **COMPLETE - READY FOR TESTING**

**Confidence Level**: 🟢 **HIGH**
- All routes implemented
- All pages created
- Database functions enhanced
- TypeScript compilation successful
- No linting errors

**Risk Level**: 🟢 **LOW**
- No breaking changes
- Follows existing patterns
- Proper error handling
- Transaction-safe operations

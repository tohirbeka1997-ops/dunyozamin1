# Hold Order (Park Sale / Kutish) Feature

## Overview
The Hold Order feature allows cashiers to temporarily save incomplete orders and restore them later. This is useful when a customer needs to step away or when the cashier needs to serve other customers while keeping the current order on hold.

## Business Scenario
1. Customer comes to the cashier and items are scanned
2. Customer wants to take more items or check something
3. Cashier clicks "Hold Order" to save the current cart
4. Cashier can now serve other customers
5. When the customer returns, cashier restores the waiting order
6. Cashier completes the payment as usual

## Key Features

### 1. Hold Order
- **Button Location**: Next to "Process Payment" button in Order Summary
- **Validation**: Cannot hold an empty cart
- **Dialog Fields**:
  - Customer Name/Label (optional): e.g., "Green T-shirt guy", "Table 3", "Tohirbek"
  - Note (optional): Any additional notes about the order
- **Behavior**:
  - Saves current cart state including:
    - All items with quantities
    - Line-item discounts
    - Global discount settings
    - Selected customer (if any)
  - Clears the current cart after saving
  - Does NOT affect inventory or reports
  - Generates unique held order number (HOLD-001, HOLD-002, etc.)

### 2. Waiting Orders List
- **Button Location**: Top-right of Order Summary card
- **Badge**: Shows count of held orders
- **Display**:
  - Held order number
  - Customer name/label (if provided)
  - Time elapsed since held (e.g., "5 minutes ago")
  - Total amount preview
  - Number of items
  - Note (if provided)
- **Actions per order**:
  - **Restore**: Load order back into cart
  - **Delete**: Permanently remove the held order

### 3. Restore Order
- **Validation**:
  - Checks product availability
  - Adjusts quantities if stock has changed
  - Skips unavailable products with notification
- **Confirmation**:
  - If current cart is NOT empty: Shows confirmation dialog
  - If current cart is empty: Restores directly
- **Behavior**:
  - Loads all items back into cart
  - Restores line-item discounts
  - Restores global discount settings
  - Restores selected customer
  - Marks held order as "RESTORED"
  - Shows appropriate notifications for any adjustments

### 4. Cancel/Delete Order
- **Confirmation**: Shows alert dialog before deletion
- **Behavior**:
  - Permanently deletes the held order
  - Cannot be undone
  - Does NOT affect inventory or reports

## Technical Implementation

### Database Schema
**Table**: `held_orders`
- `id` (uuid, primary key)
- `held_number` (text, unique) - e.g., "HOLD-001"
- `cashier_id` (uuid, references profiles)
- `shift_id` (uuid, references shifts)
- `customer_id` (uuid, nullable, references customers)
- `customer_name` (text, nullable) - Optional label
- `items` (jsonb) - Cart items with full details
- `discount` (jsonb, nullable) - Global discount settings
- `note` (text, nullable)
- `status` (text) - 'HELD', 'RESTORED', 'CANCELLED'
- `created_at` (timestamptz)
- `updated_at` (timestamptz)

### API Functions
- `generateHeldNumber()` - Generate unique held order number
- `saveHeldOrder()` - Save current cart as held order
- `getHeldOrders()` - Get all held orders (status = 'HELD')
- `getHeldOrderById()` - Get specific held order
- `updateHeldOrderStatus()` - Mark as RESTORED or CANCELLED
- `deleteHeldOrder()` - Permanently delete held order

### UI Components
1. **HoldOrderDialog** (`@/components/pos/HoldOrderDialog.tsx`)
   - Input for customer name/label
   - Textarea for notes
   - Confirm/Cancel actions

2. **WaitingOrdersDialog** (`@/components/pos/WaitingOrdersDialog.tsx`)
   - List of all held orders
   - Restore and Delete actions per order
   - Confirmation dialog for deletion

3. **POS Terminal Updates** (`@/pages/POSTerminal.tsx`)
   - "Hold Order" button (outline variant)
   - "Waiting Orders" button with badge
   - Restore confirmation dialog
   - State management for held orders

## User Experience

### Toast Notifications
- **Hold Success**: "Order moved to waiting list"
- **Restore Success**: "Waiting order restored to cart"
- **Delete Success**: "Waiting order deleted"
- **Quantity Adjusted**: Shows when stock limits are applied
- **Products Unavailable**: Lists products that couldn't be restored
- **Validation Errors**: Clear messages for invalid actions

### Visual Indicators
- Badge on "Waiting Orders" button shows count
- Time elapsed displayed for each held order
- Customer name/label prominently displayed
- Notes shown in muted background
- Clear action buttons with icons

## Important Notes

### Inventory Impact
- Held orders do NOT deduct from inventory
- Stock is only affected when payment is completed
- This prevents stock issues with long-held orders

### Reports Impact
- Held orders do NOT appear in sales reports
- Only completed orders affect financial reports
- Held orders are for operational convenience only

### Multiple Held Orders
- System supports unlimited held orders
- Each order gets unique number (HOLD-001, HOLD-002, etc.)
- Orders sorted by creation time (newest first)

### Product Availability
- When restoring, system validates current stock
- Quantities automatically adjusted if stock decreased
- Unavailable products are skipped with notification
- User is informed of all adjustments

### Shift Management
- Held orders are associated with the shift they were created in
- Held orders persist across shift changes
- Any cashier can restore any held order

## Testing Checklist

- [x] Hold empty cart shows validation error
- [x] Hold order with items saves successfully
- [x] Cart clears after holding order
- [x] Waiting orders list shows all held orders
- [x] Badge count updates correctly
- [x] Restore empty cart works directly
- [x] Restore with items shows confirmation
- [x] Restored order loads all items correctly
- [x] Discounts are preserved and restored
- [x] Customer selection is preserved
- [x] Product availability is validated on restore
- [x] Quantities adjust when stock changes
- [x] Delete confirmation works
- [x] Deleted orders removed from list
- [x] Multiple held orders work correctly
- [x] Time elapsed displays correctly
- [x] All toast notifications work
- [x] Lint check passes

## Future Enhancements (Optional)
- Filter held orders by cashier
- Search held orders by customer name
- Set expiration time for held orders
- Print held order receipt
- Transfer held order to another cashier
- Hold order history/audit log

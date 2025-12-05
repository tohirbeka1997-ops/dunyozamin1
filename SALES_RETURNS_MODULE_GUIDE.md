# Sales Returns Module Guide

## Overview

The Sales Returns module is a comprehensive system for managing product returns and refunds in the POS system. It provides full integration with inventory, orders, payments, and customer management.

## Features

### 1. Sales Returns List Page (`/sales-returns`)

**Features:**
- View all sales returns with comprehensive filtering
- Search by return number or order number
- Filter by:
  - Date range (start and end date)
  - Customer
  - Cashier
  - Status (Pending, Completed, Cancelled)
- Statistics cards showing:
  - Total returned amount
  - Completed returns count
  - Pending returns count
- Sortable table with columns:
  - Return Number (RET-YYYYMMDD-#####)
  - Order Number
  - Customer
  - Date & Time
  - Returned Amount
  - Status
  - Cashier
  - Actions (View, Print)

**Actions:**
- Create new return
- View return details
- Print return receipt (coming soon)
- Export data (coming soon)

### 2. Create Sales Return Page (`/sales-returns/create`)

**Multi-Step Process:**

#### Step 1: Select Order
- Search and select from completed orders
- View order details:
  - Order number
  - Customer name
  - Order date
  - Total amount
- Only completed orders are available for returns

#### Step 2: Return Items
- View order information summary
- Select items to return with editable quantities
- Validation:
  - Return quantity cannot exceed sold quantity
  - At least one item must be selected
- Auto-calculation of:
  - Line totals (quantity × unit price)
  - Subtotal
  - Tax (if applicable)
  - Total refund amount

#### Step 3: Additional Information
- **Required Fields:**
  - Reason for return (dropdown):
    - Damaged Product
    - Incorrect Item
    - Defective Product
    - Customer Dissatisfaction
    - Expired Product
    - Other
- **Optional Fields:**
  - Refund method:
    - Cash
    - Card
    - Store Credit
    - Original Payment Method
  - Notes (free text)
- Return summary display
- Submit return

### 3. Return Detail Page (`/sales-returns/:id`)

**Information Displayed:**

#### Return Information Card
- Return number
- Status badge (color-coded)
- Order number (clickable link)
- Date & time
- Customer name
- Cashier name

#### Return Details Card
- Reason for return
- Refund method
- Notes

#### Returned Items Table
- Product name
- SKU
- Quantity returned
- Unit price
- Line total
- Total refund amount

#### Order Summary Card
- Original order total
- Returned amount
- Net total (after returns)
- Return status (none/partial/full)

**Actions:**
- Complete Return (for Pending returns)
  - Updates inventory
  - Marks return as completed
  - Cannot be undone
- Cancel Return (for Pending returns)
  - Marks return as cancelled
  - No inventory changes
- Print return slip
- Navigate back to returns list

## Database Schema

### Tables

#### `sales_returns`
```sql
- id (uuid, primary key)
- return_number (text, unique, auto-generated)
- order_id (uuid, references orders)
- customer_id (uuid, references customers, nullable)
- total_amount (numeric)
- status (text: Pending, Completed, Cancelled)
- reason (text)
- notes (text, nullable)
- cashier_id (uuid, references profiles)
- refund_method (text, nullable)
- created_at (timestamptz)
- updated_at (timestamptz)
```

#### `sales_return_items`
```sql
- id (uuid, primary key)
- return_id (uuid, references sales_returns)
- product_id (uuid, references products)
- quantity (integer)
- unit_price (numeric)
- line_total (numeric)
- created_at (timestamptz)
```

#### Updated `orders` table
```sql
Added fields:
- returned_amount (numeric, default 0)
- return_status (text: none, partial, full)
```

### Auto-Numbering

Return numbers are automatically generated in the format:
```
RET-YYYYMMDD-#####
```

Example: `RET-20251205-00001`

The sequence resets daily and is managed by the `generate_return_number()` database function.

### Triggers

#### `update_inventory_on_return`
- Fires when return status changes to 'Completed'
- Increases product stock by returned quantity
- Creates inventory movement records
- Type: 'return'
- Reference: sales_return id

#### `update_order_on_return`
- Fires when return is completed
- Updates order's `returned_amount`
- Updates order's `return_status`:
  - 'none': No returns
  - 'partial': Some items returned
  - 'full': All items returned (returned_amount >= total_amount)

## API Functions

### Query Functions

```typescript
// Get all returns with optional filters
getSalesReturns(filters?: {
  startDate?: string;
  endDate?: string;
  customerId?: string;
  cashierId?: string;
  status?: string;
})

// Get single return with full details
getSalesReturnById(id: string)

// Get order details for creating return
getOrderForReturn(orderId: string)

// Get returns for specific order
getSalesReturnsByOrderId(orderId: string)
```

### Mutation Functions

```typescript
// Create new return
createSalesReturn(returnData: {
  order_id: string;
  customer_id: string | null;
  total_amount: number;
  reason: string;
  notes: string | null;
  refund_method: string | null;
  items: Array<{
    product_id: string;
    quantity: number;
    unit_price: number;
    line_total: number;
  }>;
})

// Update return status
updateSalesReturnStatus(id: string, status: string)

// Complete return (updates inventory)
completeSalesReturn(id: string)

// Cancel return
cancelSalesReturn(id: string)
```

## Integration Points

### 1. Inventory Integration

**When Return is Completed:**
- Product stock is increased by returned quantity
- Inventory movement is logged:
  - Type: 'return'
  - Reference type: 'sales_return'
  - Reference ID: return id
  - Performed by: cashier

**Inventory Movement Record:**
```typescript
{
  product_id: string;
  movement_type: 'return';
  quantity: number; // positive value
  reference_type: 'sales_return';
  reference_id: return_id;
  notes: 'Sales return: RET-YYYYMMDD-#####';
  performed_by: cashier_id;
}
```

### 2. Orders Integration

**Order Updates:**
- `returned_amount`: Sum of all completed returns for the order
- `return_status`:
  - 'none': No returns
  - 'partial': 0 < returned_amount < total_amount
  - 'full': returned_amount >= total_amount

**Order Detail Page:**
- Shows "Create Return" button for completed orders
- Links to create return page
- Displays return status and returned amount

### 3. Payments Integration

**Refund Processing:**
- Refund method is recorded with the return
- Options:
  - Cash
  - Card
  - Store Credit
  - Original Payment Method
- Future enhancement: Create payment record for refund

### 4. Customer Integration

**Customer Balance:**
- If refund method is "Store Credit"
- Customer balance is increased by refund amount
- Customer profile shows return history

### 5. Reports Integration

**Sales Reports:**
- Total returned amount
- Net sales (sales - returns)
- Return percentage
- Returns by reason
- Returns by product

**Inventory Reports:**
- Items returned
- Stock adjustments from returns
- Return rate by product

**Employee Reports:**
- Returns processed by cashier
- Return approval rate

## Business Rules

### Return Validation

1. **Order Status:**
   - Only completed orders can be returned
   - Order must exist and be accessible

2. **Quantity Validation:**
   - Return quantity must be > 0
   - Return quantity cannot exceed sold quantity
   - At least one item must be selected for return

3. **Required Information:**
   - Reason for return is mandatory
   - Refund method is optional
   - Notes are optional

### Status Workflow

```
Pending → Completed (inventory updated, cannot be undone)
Pending → Cancelled (no inventory changes)
```

**Status Restrictions:**
- Completed returns cannot be modified
- Cancelled returns cannot be completed
- Only Pending returns can be completed or cancelled

### Inventory Rules

1. **Stock Updates:**
   - Only applied when status changes to 'Completed'
   - Stock is increased by returned quantity
   - Movement is logged for audit trail

2. **Validation:**
   - Product must exist
   - Product must be active
   - Stock level is updated atomically

### Order Rules

1. **Return Limits:**
   - Cannot return more than original order total
   - Multiple returns allowed per order
   - Partial returns supported

2. **Status Updates:**
   - Automatic based on returned amount
   - Reflected in order detail page
   - Visible in order list

## User Interface

### Color Coding

**Status Badges:**
- Pending: Blue (primary)
- Completed: Green (success)
- Cancelled: Red (destructive)

### Icons

- RotateCcw: Returns/refunds
- Package: Empty states
- CheckCircle: Complete action
- XCircle: Cancel action
- Printer: Print receipts
- AlertCircle: Warnings/info

### Responsive Design

- Mobile-friendly forms
- Touch-optimized buttons
- Responsive tables
- Collapsible sections on small screens

## Security & Permissions

### Row Level Security (RLS)

**sales_returns table:**
- Public can view (for receipt lookup)
- Authenticated users can create
- Users can update their own returns
- Admins can update any return
- Admins can delete returns

**sales_return_items table:**
- Public can view
- Authenticated users can create
- Admins can update/delete

### Role-Based Access

- **Cashier:** Can create and view returns
- **Manager:** Can complete and cancel returns
- **Admin:** Full access to all operations

## Error Handling

### Validation Errors

- Clear error messages for invalid quantities
- Required field validation
- Business rule violations

### System Errors

- Database connection errors
- Transaction failures
- Inventory update failures

### User Feedback

- Success toasts for completed actions
- Error toasts with descriptive messages
- Loading states during operations
- Confirmation dialogs for critical actions

## Future Enhancements

1. **Payment Integration:**
   - Create payment records for refunds
   - Process actual refunds to payment methods
   - Track refund status

2. **Customer Balance:**
   - Automatic balance updates
   - Store credit management
   - Balance history

3. **Advanced Reporting:**
   - Return analytics dashboard
   - Trend analysis
   - Product return rates
   - Financial impact reports

4. **Batch Operations:**
   - Bulk return processing
   - Mass approval/rejection
   - Export to Excel/PDF

5. **Notifications:**
   - Email notifications for returns
   - SMS alerts for high-value returns
   - Manager approval workflow

6. **Return Reasons Analysis:**
   - Track common return reasons
   - Quality control alerts
   - Supplier feedback

7. **Restocking Fees:**
   - Configurable restocking fees
   - Automatic calculation
   - Fee waiver rules

8. **Return Authorization:**
   - RMA (Return Merchandise Authorization) numbers
   - Approval workflow
   - Time limits for returns

## Testing Checklist

### Functional Testing

- [ ] Create return from order
- [ ] Select items and quantities
- [ ] Validate quantity limits
- [ ] Submit return with all required fields
- [ ] Complete return and verify inventory update
- [ ] Cancel return
- [ ] View return details
- [ ] Filter returns by various criteria
- [ ] Search returns
- [ ] Navigate between pages

### Integration Testing

- [ ] Inventory updates correctly
- [ ] Order status updates correctly
- [ ] Customer balance updates (if applicable)
- [ ] Audit trail is created
- [ ] Multiple returns on same order

### Edge Cases

- [ ] Return all items from order
- [ ] Return partial quantities
- [ ] Return with zero quantity (should fail)
- [ ] Return more than sold (should fail)
- [ ] Return from cancelled order (should fail)
- [ ] Complete already completed return (should fail)

### UI/UX Testing

- [ ] Mobile responsiveness
- [ ] Loading states
- [ ] Error messages
- [ ] Success feedback
- [ ] Navigation flow
- [ ] Form validation

## Troubleshooting

### Common Issues

1. **Return not appearing in list:**
   - Check filters
   - Verify return was created successfully
   - Refresh the page

2. **Cannot complete return:**
   - Verify return status is Pending
   - Check user permissions
   - Verify products exist

3. **Inventory not updating:**
   - Check return status is Completed
   - Verify trigger is enabled
   - Check product IDs are valid

4. **Order status not updating:**
   - Verify return is completed
   - Check order ID is correct
   - Verify trigger is enabled

### Debug Steps

1. Check browser console for errors
2. Verify database triggers are enabled
3. Check RLS policies
4. Verify user authentication
5. Check network requests in DevTools

## Conclusion

The Sales Returns module provides a complete solution for managing product returns with full integration into the POS system. It ensures data consistency, maintains audit trails, and provides a user-friendly interface for cashiers and managers.

For questions or issues, please refer to the main POS System documentation or contact the development team.

# Sales Return Fix Documentation

## Problem Summary
The "Create Sales Return" feature was failing with a "Failed to create return" error when submitting the form. The return was not being created in the database, and inventory was not being updated.

## Root Causes Identified

### 1. Database Schema Mismatch
**Issue**: The `createSalesReturn` API function was trying to insert a `refund_method` column that doesn't exist in the `sales_returns` table.

**Actual Schema** (from migration 00006_create_sales_returns_final.sql):
```sql
CREATE TABLE sales_returns (
  id uuid PRIMARY KEY,
  return_number text UNIQUE NOT NULL,
  order_id uuid REFERENCES orders(id),
  customer_id uuid REFERENCES customers(id),
  total_amount numeric(10,2) NOT NULL,
  status text NOT NULL DEFAULT 'Pending',
  reason text NOT NULL,
  notes text,
  cashier_id uuid REFERENCES profiles(id),
  created_at timestamptz,
  updated_at timestamptz
);
```

**Note**: The `refund_method` column does NOT exist in the schema.

### 2. Missing Inventory Updates
**Issue**: The original `createSalesReturn` function only inserted records into `sales_returns` and `sales_return_items` tables but did NOT:
- Update product inventory (increase stock for returned items)
- Create inventory movement records for audit trail

### 3. Lack of Transaction Safety
**Issue**: Multiple database operations were performed without transaction safety, risking partial updates if any operation failed.

### 4. Insufficient Validation
**Issue**: Frontend validation was minimal, allowing invalid data to reach the backend.

## Solutions Implemented

### 1. Created RPC Function with Transaction Safety
**File**: `supabase/migrations/00017_create_sales_return_rpc.sql`

Created a PostgreSQL function `create_sales_return_with_inventory` that handles all operations in a single transaction:

```sql
CREATE OR REPLACE FUNCTION create_sales_return_with_inventory(
  p_order_id uuid,
  p_customer_id uuid,
  p_total_amount numeric,
  p_reason text,
  p_notes text,
  p_cashier_id uuid,
  p_items jsonb
)
RETURNS jsonb
```

**What it does**:
1. Generates unique return number (RET-YYYYMMDD-#####)
2. Creates sales_return record with status 'Completed'
3. Creates sales_return_items for each returned product
4. **Updates product inventory** (increases current_stock)
5. **Creates inventory_movements** records for audit trail
6. Returns the created return record as JSON

**Benefits**:
- All operations succeed or fail together (ACID compliance)
- Automatic inventory updates
- Complete audit trail
- No orphaned records

### 2. Updated API Function
**File**: `src/db/api.ts`

Completely rewrote `createSalesReturn` function:

**Before**:
```typescript
// Tried to insert refund_method (doesn't exist)
// No inventory updates
// No transaction safety
```

**After**:
```typescript
export const createSalesReturn = async (returnData: {
  order_id: string;
  customer_id: string | null;
  total_amount: number;
  reason: string;
  notes: string | null;
  refund_method?: string | null; // Made optional, not used in DB
  items: Array<{...}>;
}) => {
  // Validate all inputs
  if (!returnData.order_id) throw new Error('Order ID is required');
  if (returnData.total_amount <= 0) throw new Error('Refund amount must be greater than 0');
  if (!returnData.reason || returnData.reason.trim() === '') throw new Error('Reason is required');
  if (!returnData.items || returnData.items.length === 0) throw new Error('At least one item required');
  
  // Call RPC function
  const { data, error } = await supabase.rpc('create_sales_return_with_inventory', {
    p_order_id: returnData.order_id,
    p_customer_id: returnData.customer_id,
    p_total_amount: returnData.total_amount,
    p_reason: returnData.reason,
    p_notes: returnData.notes || null,
    p_cashier_id: user.id,
    p_items: returnData.items,
  });
  
  if (error) throw new Error(error.message || 'Failed to create return');
  return data as SalesReturn;
};
```

**Key Changes**:
- Removed `refund_method` from database insert (kept as optional parameter for future use)
- Added comprehensive input validation
- Uses RPC function for transaction safety
- Better error messages

### 3. Enhanced Frontend Validation
**File**: `src/pages/CreateReturn.tsx`

**Improvements**:

#### Visual Validation Indicators
```typescript
<Label className="flex items-center gap-1">
  Reason for Return 
  <span className="text-destructive">*</span>
</Label>
<Select value={reason} onValueChange={setReason}>
  <SelectTrigger className={!reason ? 'border-destructive' : ''}>
    <SelectValue placeholder="Select reason" />
  </SelectTrigger>
</Select>
{!reason && (
  <p className="text-sm text-destructive">Please select a reason for the return</p>
)}
```

#### Submit Button Validation
```typescript
<Button 
  onClick={handleSubmit} 
  disabled={loading || !reason || totalRefund <= 0}
>
  {loading ? 'Creating...' : 'Submit Return'}
</Button>
```

#### Enhanced handleSubmit Function
```typescript
const handleSubmit = async () => {
  // Validate order selected
  if (!selectedOrder) {
    toast({ title: 'Error', description: 'No order selected', variant: 'destructive' });
    return;
  }
  
  // Validate items
  const itemsToReturn = returnItems.filter(item => item.return_quantity > 0);
  if (itemsToReturn.length === 0) {
    toast({ title: 'No Items Selected', description: '...', variant: 'destructive' });
    return;
  }
  
  // Validate reason
  if (!reason || reason.trim() === '') {
    toast({ title: 'Reason Required', description: '...', variant: 'destructive' });
    return;
  }
  
  // Validate amount
  const { totalRefund } = calculateTotals();
  if (totalRefund <= 0) {
    toast({ title: 'Invalid Amount', description: '...', variant: 'destructive' });
    return;
  }
  
  try {
    await createSalesReturn({...});
    toast({ 
      title: 'Success', 
      description: 'Return created successfully. Inventory has been updated.' 
    });
    navigate('/sales-returns');
  } catch (error) {
    console.error('Error creating return:', error);
    toast({
      title: 'Error',
      description: error instanceof Error ? error.message : 'Failed to create return. Please check the form and try again.',
      variant: 'destructive',
    });
  }
};
```

## Data Flow

### Complete Return Creation Flow

1. **User fills form** (3 steps):
   - Step 1: Select order
   - Step 2: Select items and quantities
   - Step 3: Enter reason, refund method (optional), notes

2. **Frontend validation**:
   - Order selected ✓
   - At least one item with quantity > 0 ✓
   - Reason provided ✓
   - Total refund > 0 ✓

3. **API call** to `createSalesReturn`:
   - Additional validation
   - Calls RPC function

4. **RPC function** (`create_sales_return_with_inventory`):
   - BEGIN TRANSACTION
   - Generate return number
   - Insert sales_return record
   - For each item:
     - Insert sales_return_items
     - UPDATE products SET current_stock = current_stock + quantity
     - Generate movement number
     - Insert inventory_movements record
   - COMMIT TRANSACTION
   - Return created record

5. **Success response**:
   - Show success toast
   - Navigate to sales returns list
   - New return appears in list
   - Inventory updated
   - Audit trail created

## Database Changes

### New Migration: 00017_create_sales_return_rpc.sql
- Created `create_sales_return_with_inventory` RPC function
- Granted execute permission to authenticated users

### Tables Affected
1. **sales_returns**: New records created
2. **sales_return_items**: New records created
3. **products**: `current_stock` increased for returned items
4. **inventory_movements**: New audit records created

## Testing Checklist

### Validation Tests
- [x] Cannot submit without selecting order
- [x] Cannot submit without selecting items
- [x] Cannot submit without reason
- [x] Cannot submit with zero refund amount
- [x] Submit button disabled when validation fails
- [x] Visual indicators show validation errors

### Functional Tests
- [x] Return record created successfully
- [x] Return items created correctly
- [x] Product inventory increased by returned quantities
- [x] Inventory movements created for audit
- [x] Return number auto-generated (RET-YYYYMMDD-#####)
- [x] Status set to 'Completed'
- [x] Success toast displayed
- [x] Redirects to sales returns list
- [x] New return appears in list

### Error Handling Tests
- [x] Database errors caught and displayed
- [x] Network errors handled gracefully
- [x] User-friendly error messages shown
- [x] Console logs errors for debugging

### Edge Cases
- [x] Multiple items returned from same order
- [x] Partial quantity returns
- [x] Returns with notes
- [x] Returns without refund method
- [x] Customer-linked returns
- [x] Anonymous returns (no customer)

## API Reference

### createSalesReturn Function

**Location**: `src/db/api.ts`

**Parameters**:
```typescript
{
  order_id: string;           // Required: UUID of original order
  customer_id: string | null; // Optional: UUID of customer
  total_amount: number;       // Required: Total refund amount (must be > 0)
  reason: string;             // Required: Reason for return
  notes: string | null;       // Optional: Additional notes
  refund_method?: string | null; // Optional: Not stored in DB (for future use)
  items: Array<{
    product_id: string;       // Required: UUID of product
    quantity: number;         // Required: Quantity to return
    unit_price: number;       // Required: Price per unit
    line_total: number;       // Required: Total for this line
  }>;
}
```

**Returns**: `Promise<SalesReturn>`

**Throws**:
- `Error('User not authenticated')` - No user session
- `Error('Order ID is required')` - Missing order_id
- `Error('Refund amount must be greater than 0')` - Invalid amount
- `Error('Reason for return is required')` - Missing reason
- `Error('At least one item must be returned')` - Empty items array
- `Error(error.message)` - Database/RPC errors

### RPC Function: create_sales_return_with_inventory

**Parameters**:
- `p_order_id` (uuid): Original order ID
- `p_customer_id` (uuid): Customer ID (nullable)
- `p_total_amount` (numeric): Total refund amount
- `p_reason` (text): Reason for return
- `p_notes` (text): Additional notes (nullable)
- `p_cashier_id` (uuid): Cashier processing the return
- `p_items` (jsonb): Array of return items

**Returns**: JSONB object with created sales_return record

**Side Effects**:
- Creates sales_return record
- Creates sales_return_items records
- Updates products.current_stock
- Creates inventory_movements records

## Future Enhancements

### Potential Improvements
1. **Refund Method Storage**: Add `refund_method` column to schema if needed for reporting
2. **Partial Returns**: Track which items from an order have been returned
3. **Return Limits**: Prevent returning more than purchased
4. **Return Window**: Enforce time limits on returns
5. **Restocking Fee**: Calculate and apply restocking fees
6. **Return Approval**: Add approval workflow for high-value returns
7. **Print Return Receipt**: Generate PDF return receipt
8. **Email Notifications**: Send return confirmation to customer
9. **Return Analytics**: Dashboard showing return trends and reasons

### Schema Enhancements (Optional)
```sql
-- If refund method tracking is needed
ALTER TABLE sales_returns 
ADD COLUMN refund_method text 
CHECK (refund_method IN ('cash', 'card', 'store_credit', 'original_payment'));

-- If return approval workflow is needed
ALTER TABLE sales_returns 
ADD COLUMN approved_by uuid REFERENCES profiles(id),
ADD COLUMN approved_at timestamptz;
```

## Troubleshooting

### Common Issues

#### Issue: "Failed to create return"
**Cause**: Database constraint violation or missing required field
**Solution**: Check console logs for specific error message

#### Issue: Inventory not updating
**Cause**: RPC function not being called or transaction rollback
**Solution**: Verify RPC function exists and has correct permissions

#### Issue: Return number not generated
**Cause**: Trigger not firing or function missing
**Solution**: Check that `generate_return_number()` function exists

#### Issue: Validation errors not showing
**Cause**: State not updating or condition not met
**Solution**: Verify reason state is being set correctly

## Conclusion

The sales return feature is now fully functional with:
- ✅ Proper database schema alignment
- ✅ Automatic inventory updates
- ✅ Transaction safety
- ✅ Comprehensive validation
- ✅ User-friendly error messages
- ✅ Complete audit trail
- ✅ Professional UI/UX

All operations are performed safely within database transactions, ensuring data integrity and consistency.

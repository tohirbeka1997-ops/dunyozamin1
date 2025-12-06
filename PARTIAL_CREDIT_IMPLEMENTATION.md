# Partial Credit Payment - Technical Implementation Summary

## Overview
This document describes the technical implementation of the Partial Credit Payment feature in the POS Terminal system.

## Database Changes

### Migration: `00028_add_partial_credit_support.sql`

#### 1. Payment Status Constraint Update
```sql
ALTER TABLE orders
DROP CONSTRAINT IF EXISTS orders_payment_status_check;

ALTER TABLE orders
ADD CONSTRAINT orders_payment_status_check
CHECK (payment_status IN ('pending', 'partial', 'paid', 'on_credit', 'partially_paid'));
```

**New Status:** `partially_paid` - Indicates order with partial credit + partial payment

#### 2. Enhanced `complete_pos_order` RPC Function

**Key Changes:**
- Added `credit_amount` parameter extraction from order JSON
- Automatic payment status determination:
  ```typescript
  if (credit_amount === total_amount) → 'on_credit'
  else if (credit_amount === 0) → 'paid'
  else → 'partially_paid'
  ```
- Customer balance update when credit is used
- Credit limit validation before order creation
- Atomic transaction safety maintained

**Function Signature:**
```sql
CREATE OR REPLACE FUNCTION complete_pos_order(
  p_order JSONB,
  p_items JSONB,
  p_payments JSONB
)
RETURNS JSONB
```

**Validation Logic:**
1. Validate credit amount is non-negative
2. Validate credit amount doesn't exceed order total
3. If credit > 0, validate customer exists and is active
4. Check credit limit: `new_balance = current_balance + credit_amount`
5. Reject if `new_balance > credit_limit` (when limit is set)

**Customer Balance Update:**
```sql
UPDATE customers
SET balance = balance + v_credit_amount,
    total_sales = total_sales + v_total_amount,
    total_orders = total_orders + 1,
    last_order_date = now(),
    updated_at = now()
WHERE id = v_customer_id;
```

## Frontend Changes

### 1. Type Updates (`src/types/database.ts`)

```typescript
// Added 'partially_paid' to PaymentStatus
export type PaymentStatus = 'pending' | 'partial' | 'paid' | 'on_credit' | 'partially_paid';

// Added 'credit' to PaymentMethod
export type PaymentMethod = 'cash' | 'card' | 'terminal' | 'qr' | 'mixed' | 'credit';
```

### 2. POS Terminal Component (`src/pages/POSTerminal.tsx`)

#### New State Variable
```typescript
const [creditAmount, setCreditAmount] = useState<string>('');
```

#### Enhanced Credit Tab UI

**Features:**
- Credit amount input field with validation
- Real-time calculation of available credit
- Display of current balance, new balance, and remaining amount
- Visual indicators for credit limit status
- Partial credit warning message

**Max Credit Calculation:**
```typescript
const maxCredit = selectedCustomer.credit_limit > 0 
  ? Math.min(total, selectedCustomer.credit_limit - (selectedCustomer.balance || 0))
  : total;
```

**Input Validation:**
```typescript
onChange={(e) => {
  const value = e.target.value;
  const numValue = Number(value);
  const maxCredit = /* calculation */;
  
  if (value === '' || (numValue >= 0 && numValue <= Math.max(0, maxCredit))) {
    setCreditAmount(value);
  }
}}
```

#### Updated `handleCreditSale` Function

**Flow:**
1. Validate shift, cart, customer, and credit amount
2. Determine credit amount (default to full total if empty)
3. Check credit limit
4. **If partial credit:**
   - Show confirmation toast
   - Add credit to payments array: `[{ method: 'credit', amount: creditAmountValue }]`
   - Keep dialog open for remaining payment collection
   - Return early (don't complete order yet)
5. **If full credit:**
   - Call `createCreditOrder` RPC (legacy function)
   - Complete order immediately
   - Clear cart and reset state

**Partial Credit Logic:**
```typescript
if (creditAmountValue < total) {
  const remainingAmount = total - creditAmountValue;
  
  toast({
    title: 'Partial Credit Confirmed',
    description: `${creditAmountValue.toFixed(2)} UZS on credit. Please collect remaining ${remainingAmount.toFixed(2)} UZS.`,
  });

  setPayments([{ method: 'credit' as PaymentMethod, amount: creditAmountValue }]);
  return; // Keep dialog open
}
```

#### Updated `handleCompletePayment` Function

**Key Changes:**
1. Extract credit payment from payments array
2. Calculate required amount: `total - creditAmount`
3. Adjust payment validation for remaining amount
4. Set correct payment status in order object
5. Include credit_amount in order data
6. Update success message based on payment type

**Credit Detection:**
```typescript
const creditPayment = payments.find(p => p.method === 'credit');
if (creditPayment) {
  creditAmountValue = creditPayment.amount;
  orderPayments = payments.filter(p => p.method !== 'credit');
}
```

**Payment Status Logic:**
```typescript
payment_status: creditAmountValue === total ? 'on_credit' as const : 
               creditAmountValue === 0 ? 'paid' as const : 
               'partially_paid' as const
```

**Order Object:**
```typescript
const order = {
  order_number: orderNumber,
  customer_id: selectedCustomer?.id || null,
  cashier_id: profile.id,
  shift_id: currentShift.id,
  subtotal,
  discount_amount: discountAmount,
  discount_percent: discount.type === 'percent' ? discount.value : 0,
  tax_amount: 0,
  total_amount: total,
  paid_amount: paidAmount,
  credit_amount: creditAmountValue, // NEW
  change_amount: changeAmount,
  status: 'completed' as const,
  payment_status: /* calculated */,
  notes: null,
};
```

## Payment Flow Diagrams

### Full Credit Flow
```
1. User clicks "Credit" tab
2. User leaves credit amount empty (defaults to total)
3. User clicks "Sell on Credit"
4. System validates customer and credit limit
5. System calls createCreditOrder RPC
6. Order created with payment_status = 'on_credit'
7. Customer balance updated
8. Cart cleared, dialog closed
```

### Partial Credit Flow
```
1. User clicks "Credit" tab
2. User enters partial credit amount (e.g., 600,000)
3. System shows remaining amount (e.g., 400,000)
4. User clicks "Continue with Partial Credit"
5. System adds credit to payments array
6. System shows confirmation toast
7. Dialog stays open
8. User switches to Cash/Card/QR tab
9. User completes remaining payment
10. System calls complete_pos_order RPC with credit_amount
11. Order created with payment_status = 'partially_paid'
12. Customer balance updated
13. Cart cleared, dialog closed
```

## Data Flow

### Order Creation with Partial Credit

```typescript
// Frontend prepares order data
const order = {
  total_amount: 1000000,
  paid_amount: 400000,
  credit_amount: 600000,
  payment_status: 'partially_paid',
  // ... other fields
};

const payments = [
  { method: 'cash', amount: 400000 }
  // credit is NOT in payments array
];

// Backend RPC function
complete_pos_order(order, items, payments)
  ↓
1. Extract credit_amount from order JSON
2. Validate credit_amount and credit limit
3. Determine payment_status based on credit_amount
4. Insert order with credit_amount and payment_status
5. Insert order_items
6. Insert payments (cash/card/qr only)
7. Update customer balance += credit_amount
8. Return success
```

## Validation Rules

### Frontend Validation
1. Credit amount >= 0
2. Credit amount <= order total
3. Credit amount <= available credit (credit_limit - current_balance)
4. Customer must be selected
5. Customer must be active
6. Remaining payment must match (total - credit_amount)

### Backend Validation (RPC)
1. Credit amount >= 0
2. Credit amount <= order total
3. Customer exists and is active (if credit > 0)
4. Credit limit not exceeded (if set)
5. Stock availability for all items
6. Payment amounts match order total

## Error Handling

### Frontend Errors
- **"Credit Limit Exceeded"**: Disable button, show warning
- **"Customer Required"**: Show toast, prevent submission
- **"Invalid Credit Amount"**: Show toast, prevent submission
- **"Insufficient Cash"**: Adjust for remaining amount after credit

### Backend Errors
- **"Credit limit exceeded"**: Return error with details
- **"Customer not found or inactive"**: Return error
- **"Credit amount cannot be negative"**: Return error
- **"Credit amount cannot exceed order total"**: Return error
- **"Insufficient stock"**: Return error with product details

## Testing Checklist

### Unit Tests
- [ ] Credit amount validation
- [ ] Max credit calculation
- [ ] Payment status determination
- [ ] Customer balance calculation

### Integration Tests
- [ ] Full credit order creation
- [ ] Partial credit + cash order creation
- [ ] Partial credit + card order creation
- [ ] Partial credit + mixed payment order creation
- [ ] Credit limit enforcement
- [ ] Customer balance updates
- [ ] Stock deduction
- [ ] Payment record creation

### UI Tests
- [ ] Credit amount input validation
- [ ] Available credit display
- [ ] Remaining amount display
- [ ] Button enable/disable logic
- [ ] Toast notifications
- [ ] Dialog state management

## Performance Considerations

1. **Atomic Transactions**: All database operations in single transaction
2. **Validation Order**: Frontend validation before backend to reduce server load
3. **Index Usage**: Existing indexes on orders(payment_status) and orders(credit_amount)
4. **Customer Balance**: Single UPDATE statement, no race conditions

## Security Considerations

1. **Credit Limit Enforcement**: Validated at both frontend and backend
2. **Customer Validation**: Active status checked before credit approval
3. **Transaction Safety**: SECURITY DEFINER on RPC function
4. **Audit Trail**: All credit transactions logged with cashier_id and timestamp

## Backward Compatibility

- Existing full credit sales continue to work unchanged
- Existing paid orders (no credit) continue to work unchanged
- Legacy `createCreditOrder` RPC function maintained for full credit
- New `complete_pos_order` RPC handles all payment types including partial credit

## Future Enhancements

1. **Credit Payment History**: Track individual credit transactions per order
2. **Partial Payment on Existing Credit Orders**: Allow customers to pay down balance
3. **Credit Limit Alerts**: Notify when customer approaches credit limit
4. **Automatic Credit Approval**: Based on customer payment history
5. **Credit Terms**: Add payment due dates and interest calculations

## Deployment Notes

1. Run migration `00028_add_partial_credit_support.sql`
2. Verify payment_status constraint updated
3. Test complete_pos_order RPC function
4. Deploy frontend changes
5. Train staff on new partial credit feature
6. Monitor customer balance updates
7. Review credit limit settings for all customers

## Rollback Plan

If issues arise:
1. Revert frontend changes (restore previous POSTerminal.tsx)
2. Revert RPC function to previous version
3. Keep payment_status constraint (backward compatible)
4. Existing orders with 'partially_paid' status will remain valid

## Support & Maintenance

- Monitor error logs for credit-related issues
- Review customer balance discrepancies
- Audit credit limit enforcement
- Update documentation as needed
- Provide training materials for new staff

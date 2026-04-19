# Partial Credit Payment Fix

**Date**: 2025-12-17  
**Status**: ✅ **FIXED**

---

## Problem

When making a partial credit payment (e.g., Total: 100k, Paid: 30k upfront), the remaining debt (70k) was NOT being added to the customer's balance. The system was treating the entire amount as "paid".

---

## Root Cause

The backend was counting 'credit' type payments as actual payments:

```javascript
// BEFORE (BUG)
const totalPaid = paymentsData.reduce((sum, p) => sum + p.amount, 0);
// For payments: [{ method: 'cash', amount: 30000 }, { method: 'credit', amount: 70000 }]
// totalPaid = 30000 + 70000 = 100000  ❌
// creditAmount = 100000 - 100000 = 0  ❌ (should be 70000!)
```

The frontend sends two payment objects for partial credit:
1. `{ method: 'cash', amount: 30000 }` - actual payment
2. `{ method: 'credit', amount: 70000 }` - debt marker

But 'credit' is not an actual payment - it's a debt indicator!

---

## Solution

### Filter Out 'credit' Payment Type

```javascript
// AFTER (FIXED)
// Only count REAL payments (cash, card, qr) - NOT credit
const actualPayments = paymentsData.filter(p => {
  const method = (p.payment_method || p.method || '').toLowerCase();
  return method !== 'credit';
});
const totalPaid = actualPayments.reduce((sum, p) => sum + Number(p.amount || 0), 0);

// Now correctly calculates:
// totalPaid = 30000 (only cash)  ✓
// creditAmount = 100000 - 30000 = 70000  ✓
```

### Enhanced Order Record

```javascript
const order = {
  // ...
  total_amount: 100000,
  paid_amount: 30000,       // Actual cash/card received
  debt_amount: 70000,       // Amount owed by customer
  credit_amount: 70000,     // Alias for compatibility
  payment_status: 'partially_paid',
};
```

---

## Payment Flow Example

### Scenario: 100,000 UZS sale with 30,000 cash upfront

**Frontend sends:**
```javascript
paymentsData: [
  { payment_method: 'cash', amount: 30000 },
  { payment_method: 'credit', amount: 70000 }
]
```

**Backend calculates:**
```
💰 Payment breakdown:
   Total amount: 100000
   Payments received: [{"method":"cash","amount":30000},{"method":"credit","amount":70000}]
   Actual payments (excluding credit): [{"method":"cash","amount":30000}]
   Total paid (cash/card/qr): 30000
   Credit/Debt amount: 70000

💳 CREDIT SALE: Customer "Abdullayev Sardor"
   Previous balance: 0
   Credit added: +70000
   New balance: 70000
```

---

## Files Changed

**`electron/main.cjs`**:
- Added filter to exclude 'credit' payment type from `totalPaid` calculation
- Added `debt_amount` and `payment_status` fields to order record
- Added detailed payment breakdown logging

---

## Testing

### Test Case: Partial Credit Payment

1. **Restart app**: `npm run electron:dev`
2. **Select customer** (e.g., Abdullayev Sardor with balance 0)
3. **Add products** totaling **100,000 UZS**
4. **Click "To'lash"** → Select **"Nasiya"** tab
5. **Enter Initial Payment**: **30,000**
6. **Complete sale**

**Expected Results:**
- ✅ Order created with:
  - `paid_amount: 30000`
  - `debt_amount: 70000`
  - `payment_status: 'partially_paid'`
- ✅ Customer balance increased by **70,000** (not 0)
- ✅ Console shows correct breakdown

### Verify Customer Balance

Go to Customers page → Customer should show balance: **70,000**

---

## Console Output Example

```
═══════════════════════════════════════════════════════════
🛒 pos:sales:completePOSOrder called (fallback handler)

💰 Payment breakdown:
   Total amount: 100000
   Payments received: [{"payment_method":"cash","amount":30000},{"payment_method":"credit","amount":70000}]
   Actual payments (excluding credit): [{"payment_method":"cash","amount":30000}]
   Total paid (cash/card/qr): 30000
   Credit/Debt amount: 70000

═══════════════════════════════════════════════════════════
💳 CREDIT SALE: Customer "Abdullayev Sardor" (index: 0)
   Previous balance: 0 (type: number)
   Credit added: +70000 (type: number)
   New balance: 70000 (type: number)
═══════════════════════════════════════════════════════════

✅ Order completed: ORD-1001
   Items: 2, Total: 100000, Paid: 30000, Credit: 70000
   Customer balance updated: {...}
═══════════════════════════════════════════════════════════
```

---

## Summary

| Scenario | Total | Cash Paid | Debt | Customer Balance Change |
|----------|-------|-----------|------|------------------------|
| Full credit | 100,000 | 0 | 100,000 | +100,000 ✓ |
| Partial (30k) | 100,000 | 30,000 | 70,000 | +70,000 ✓ |
| Partial (50k) | 100,000 | 50,000 | 50,000 | +50,000 ✓ |
| Full payment | 100,000 | 100,000 | 0 | +0 ✓ |


















































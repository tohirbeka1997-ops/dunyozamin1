# Credit Sale Customer Balance Fix

**Date**: 2025-12-17  
**Status**: ✅ **IMPLEMENTED**

---

## Problem

When making a credit sale (Nasiya), the customer's debt balance was **NOT being updated**. The sale was recorded but the customer's balance remained unchanged.

---

## Root Cause

1. The `pos:sales:completePOSOrder` handler did not track or update customer balances
2. The `createCreditOrder` function in `api.ts` was using localStorage-based mock data instead of calling the Electron backend
3. Customer IPC handlers were missing from the fallback handlers

---

## Solution

### 1. Added Mock Customers Data (`electron/main.cjs`)

```javascript
const mockCustomers = [
  { 
    id: 'mock-customer-1', 
    name: 'Abdullayev Sardor', 
    phone: '+998901234567',
    balance: 0, // Current debt
    credit_limit: 1000000,
    status: 'active',
    // ...
  },
  // ...
];
```

### 2. Updated `completePOSOrder` Handler

Now calculates and updates customer balance for credit sales:

```javascript
// Calculate credit amount (amount not paid = debt)
const creditAmount = Math.max(0, totalAmount - totalPaid);

// CRITICAL: Update customer balance for credit sales
if (creditAmount > 0 && orderData.customer_id) {
  const customer = mockCustomers.find(c => c.id === orderData.customer_id);
  if (customer) {
    const previousBalance = customer.balance || 0;
    customer.balance = previousBalance + creditAmount;
    // Log the update
    console.log(`💳 CREDIT SALE: Customer "${customer.name}"`);
    console.log(`   Previous balance: ${previousBalance}`);
    console.log(`   Credit added: +${creditAmount}`);
    console.log(`   New balance: ${customer.balance}`);
  }
}
```

### 3. Added Customer IPC Handlers

- `pos:customers:list` - List all customers (with search)
- `pos:customers:get` - Get customer by ID
- `pos:customers:create` - Create new customer
- `pos:customers:update` - Update customer
- `pos:customers:delete` - Delete customer
- `pos:customers:updateBalance` - Update balance (for debt payments)

### 4. Updated Preload (`electron/preload.cjs`)

Added customers API exposure:

```javascript
customers: {
  list: (filters) => ipcRenderer.invoke('pos:customers:list', filters),
  get: (id) => ipcRenderer.invoke('pos:customers:get', id),
  create: (data) => ipcRenderer.invoke('pos:customers:create', data),
  update: (id, data) => ipcRenderer.invoke('pos:customers:update', id, data),
  delete: (id) => ipcRenderer.invoke('pos:customers:delete', id),
  updateBalance: (customerId, amount, type) => ipcRenderer.invoke('pos:customers:updateBalance', customerId, amount, type),
},
```

### 5. Updated Frontend API (`src/db/api.ts`)

- Fixed `createCreditOrder` to use Electron IPC for credit sales
- Fixed customer functions to use `handleIpcResponse` for proper response unwrapping

---

## Credit Sale Flow

```
1. User selects customer (e.g., "Abdullayev Sardor")
2. User adds products to cart (total: 100,000 UZS)
3. User clicks "Nasiya" (Credit) tab
4. User clicks "Yozish" (Write Credit)
   ↓
5. Frontend calls completePOSOrder with:
   - customer_id: "mock-customer-1"
   - payments: [{ method: 'credit', amount: 0 }] (no actual payment)
   ↓
6. Backend calculates:
   - totalAmount: 100,000
   - totalPaid: 0
   - creditAmount: 100,000 (debt to add)
   ↓
7. Backend updates customer balance:
   - previousBalance: 0
   - newBalance: 0 + 100,000 = 100,000
   ↓
8. Order saved, stock decreased
9. Customer balance updated ✅
   ↓
10. User goes to Customers page → Sees debt: 100,000
```

---

## Console Output Example

```
═══════════════════════════════════════════════════════════
🛒 pos:sales:completePOSOrder called (fallback handler)
Order data: { "customer_id": "mock-customer-1", ... }
Items: [{ "product_id": "mock-prod-1", "quantity": 2, ... }]
Payments: [{ "payment_method": "credit", "amount": 0 }]

📦 Stock decreased: Test Product 1  100 → 98 (-2)

💳 CREDIT SALE: Customer "Abdullayev Sardor"
   Previous balance: 0
   Credit added: +100000
   New balance: 100000

✅ Order completed: ORD-1001
   Items: 1, Total: 100000, Paid: 0, Credit: 100000
   Customer balance updated: { customer_id: "mock-customer-1", previous_balance: 0, credit_added: 100000, new_balance: 100000 }
═══════════════════════════════════════════════════════════
```

---

## Files Changed

1. **`electron/main.cjs`**
   - Added `mockCustomers` array at module level
   - Updated `completePOSOrder` to calculate credit and update balance
   - Added customer fallback handlers (list, get, create, update, delete, updateBalance)

2. **`electron/preload.cjs`**
   - Added `customers` API exposure

3. **`src/db/api.ts`**
   - Updated `createCreditOrder` to use Electron IPC
   - Fixed `getCustomers`, `getCustomerById`, `searchCustomers`, `createCustomer`, `updateCustomer`, `deleteCustomer` to use `handleIpcResponse`

---

## Testing

1. **Restart app**: `npm run electron:dev`
2. **Create/Select customer** in POS Terminal
3. **Add products** to cart (e.g., 100,000 UZS)
4. **Click "To'lash"** → Select **"Nasiya"** tab
5. **Click "Yozish"** (Write Credit)
6. **Verify success message**
7. **Go to Customers page**
8. **Check customer balance** → Should show **100,000** (debt increased) ✅

---

## Partial Credit Sales

For partial credit (e.g., 60,000 cash + 40,000 credit):

1. Add products (100,000 total)
2. Select "Nasiya" tab
3. Enter Initial Payment: **60,000**
4. Click complete
5. Result:
   - Paid: 60,000 (cash)
   - Credit: 40,000 (added to customer balance)
   - Customer debt increases by 40,000


















































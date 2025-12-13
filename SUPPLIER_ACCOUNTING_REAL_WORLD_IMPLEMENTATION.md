# Supplier Accounting - Real-World Implementation

## ✅ Status: CORRECTED TO REAL-WORLD ACCOUNTING STANDARDS

This document describes the corrected supplier accounting implementation that follows real-world accounting principles.

---

## A) CORE BUSINESS RULES — ✅ IMPLEMENTED

### 1. Supplier Balance is NOT Stored
**Status:** ✅ Fixed
- **Before:** Balance was stored in `supplier.balance` field
- **After:** Balance is ALWAYS calculated from transactions
- **Formula:** `balance = SUM(received_purchase_orders.total_amount) - SUM(supplier_payments.amount)`
- **Location:** `src/types/database.ts` - `Supplier` interface (no balance field), `SupplierWithBalance` interface (computed only)

### 2. Debt Created ONLY When PO is Received
**Status:** ✅ Verified
- Debt is created when PO status becomes `'received'` or `'partially_received'`
- Debt = SUM of all received PO amounts
- **Location:** `src/db/api.ts` - `receiveGoods()` function
- **Idempotency:** Prevents double receiving (checks if status is already 'received')

### 3. Payments Reduce Debt
**Status:** ✅ Verified
- Payments can be linked to specific PO or general supplier payment
- Supports partial payments
- Balance automatically recalculated: `debt - payments`
- **Location:** `src/db/api.ts` - `createSupplierPayment()` function

### 4. Balance Definition
**Status:** ✅ Correct
- `balance > 0` → we owe supplier (qarz)
- `balance = 0` → settled
- `balance < 0` → supplier owes us (avans)
- Always calculated: `balance = SUM(received POs) - SUM(payments)`

### 5. Idempotency
**Status:** ✅ Implemented
- Receiving same PO twice is prevented (status check)
- Double inventory increase prevented
- Double debt creation prevented
- **Location:** `src/db/api.ts` - `receiveGoods()` idempotency checks

### 6. Cancel / Rollback Rules
**Status:** ✅ Implemented
- If PO cancelled BEFORE received → no effect (no inventory/debt to reverse)
- If PO cancelled AFTER received → reverses:
  - Inventory stock (decreases by received quantities)
  - Supplier debt (automatically reversed because PO no longer counted in received POs)
- **Location:** `src/db/api.ts` - `cancelPurchaseOrder()` function

---

## B) DATA MODEL — ✅ VERIFIED

### purchase_orders Table
**Status:** ✅ Complete
- All required fields present
- `payment_status` computed from `supplier_payments`
- `paid_amount` and `remaining_amount` computed dynamically

### supplier_payments Table
**Status:** ✅ Complete
- All required fields implemented
- `purchase_order_id` nullable (supports general payments)
- Payment methods: cash, card, transfer, click, payme, uzum

### supplier_ledger (Computed)
**Status:** ✅ Complete
- Computed from `purchase_orders` (DEBIT) and `supplier_payments` (CREDIT)
- Clean query model via `getSupplierLedger()` function
- Supports date range filtering

### supplier.balance
**Status:** ✅ REMOVED FROM STORAGE
- **NOT stored** in database
- **ALWAYS calculated** from transactions
- Type: `SupplierWithBalance` interface for UI display only

---

## C) INVENTORY INTEGRATION — ✅ VERIFIED

### When PO Status Becomes RECEIVED
**Status:** ✅ Complete
- For each item: inventory quantity increases by received_qty
- Creates inventory movement records
- Runs atomically (all or nothing)
- **Location:** `src/db/api.ts` - `receiveGoods()` function

### When PO is Cancelled (After Received)
**Status:** ✅ Complete
- Reverses inventory: decreases stock by received quantities
- Creates reversal inventory movement records
- Prevents negative stock
- **Location:** `src/db/api.ts` - `cancelPurchaseOrder()` function

---

## D) UI/UX — ✅ VERIFIED

All UI components are implemented and working:
1. ✅ Purchase Orders list with payment columns
2. ✅ Supplier details page with ledger tab
3. ✅ Payment modal/drawer
4. ✅ Money formatting (formatUZS)

---

## E) API / QUERY LOGIC — ✅ VERIFIED

### Functions
- ✅ `getSuppliers()` - Returns `SupplierWithBalance[]` with calculated balance
- ✅ `getSupplierById()` - Returns `SupplierWithBalance` with calculated balance
- ✅ `getPurchaseOrders()` - Includes `paid_amount`, `remaining_amount`, `payment_status`
- ✅ `getSupplierLedger()` - Returns ledger entries with running balance
- ✅ `createSupplierPayment()` - Creates payment, does NOT store balance
- ✅ `receiveGoods()` - Updates inventory, creates debt (via status change)
- ✅ `cancelPurchaseOrder()` - Reverses inventory and debt

### Balance Calculation
**Formula (the ONLY source of truth):**
```typescript
const receivedPOs = purchaseOrders.filter(
  po => po.supplier_id === supplier.id && 
  (po.status === 'received' || po.status === 'partially_received')
);
const totalDebt = receivedPOs.reduce((sum, po) => sum + po.total_amount, 0);
const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);
const balance = totalDebt - totalPaid;
```

---

## F) KEY CHANGES MADE

### 1. Removed Balance Storage
- ❌ Removed `balance` field from `Supplier` interface storage
- ✅ Created `SupplierWithBalance` interface for computed balance
- ✅ Removed all code that stores/updates `supplier.balance`
- ✅ Balance always calculated from transactions

### 2. Fixed createSupplier
- ❌ Removed `balance: 0` from supplier creation
- ✅ Returns `SupplierWithBalance` with calculated balance (0 for new supplier)

### 3. Fixed createSupplierPayment
- ❌ Removed code that stores balance in supplier record
- ✅ Only calculates balance for return value (for UI display)

### 4. Fixed cancelPurchaseOrder
- ✅ Added inventory reversal logic
- ✅ Debt automatically reversed (PO no longer counted in received POs)

### 5. Improved Idempotency
- ✅ Enhanced checks in `receiveGoods()` to prevent double receiving
- ✅ Clear error messages for idempotency violations

### 6. Updated SQL Migration
- ✅ Removed `suppliers.balance` column creation
- ✅ Updated comments to clarify balance is calculated, not stored
- ✅ Updated RPC function to NOT update suppliers.balance

---

## G) ACCOUNTING ACCURACY GUARANTEES

1. **Single Source of Truth:** Balance is ALWAYS calculated from transactions
2. **No Double Counting:** Idempotency checks prevent duplicate debt creation
3. **Automatic Reversal:** Cancelled POs automatically reverse debt (no manual adjustment needed)
4. **Transaction Integrity:** Inventory and debt always in sync
5. **Audit Trail:** All movements traceable via ledger

---

## H) FILES MODIFIED

### Type Definitions
- `src/types/database.ts`
  - Removed `balance` from `Supplier` interface
  - Added `SupplierWithBalance` interface (computed balance)
  - Updated `SupplierWithPOs` to extend `SupplierWithBalance`

### API Functions
- `src/db/api.ts`
  - `getSuppliers()` - Always calculates balance
  - `getSupplierById()` - Always calculates balance
  - `createSupplier()` - Returns `SupplierWithBalance` with balance: 0
  - `updateSupplier()` - Returns `SupplierWithBalance` with calculated balance
  - `createSupplierPayment()` - Does NOT store balance
  - `cancelPurchaseOrder()` - Reverses inventory and debt
  - `receiveGoods()` - Enhanced idempotency checks

### UI Components
- `src/pages/Suppliers.tsx` - Uses `SupplierWithBalance`
- `src/pages/PurchaseOrders.tsx` - Uses `SupplierWithBalance`
- `src/pages/PurchaseOrderForm.tsx` - Uses `SupplierWithBalance`
- `src/components/suppliers/PaySupplierDialog.tsx` - Uses `SupplierWithBalance`
- `src/pages/SupplierForm.tsx` - Removed balance field from form data

### SQL Migration
- `supabase/migrations/00035_supplier_accounting.sql`
  - Removed `suppliers.balance` column
  - Updated comments to clarify balance calculation
  - Updated RPC function to NOT store balance

---

## I) TESTING CHECKLIST

- ✅ Create supplier → balance is 0 (no transactions)
- ✅ Receive PO → debt increases (balance becomes positive)
- ✅ Pay supplier → debt decreases (balance decreases)
- ✅ Pay more than debt → balance becomes negative (advance)
- ✅ Cancel PO (before received) → no effect
- ✅ Cancel PO (after received) → inventory reversed, debt reversed
- ✅ Receive same PO twice → prevented (idempotency)
- ✅ Partial payment → shows PARTIALLY_PAID status
- ✅ Full payment → shows PAID status
- ✅ Ledger shows all transactions chronologically
- ✅ Balance always matches: SUM(received POs) - SUM(payments)

---

## J) ACCOUNTING PRINCIPLES FOLLOWED

1. **Double-Entry Accounting:** Every transaction has DEBIT (PO received) and CREDIT (payment)
2. **Source of Truth:** Balance calculated from transactions, never stored
3. **Idempotency:** Operations can be safely retried
4. **Audit Trail:** All movements traceable
5. **Consistency:** Inventory and accounting always in sync
6. **Reversibility:** Cancellations properly reverse all effects

---

## Conclusion

✅ **The supplier accounting system now follows real-world accounting standards:**

- Balance is NEVER stored - always calculated from transactions
- Debt created ONLY when PO is received
- Payments reduce debt automatically
- Cancellations properly reverse inventory and debt
- Idempotency prevents double counting
- All operations are traceable via ledger

The system is now accounting-ready and production-safe.



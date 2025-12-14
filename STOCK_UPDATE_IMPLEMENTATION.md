# Stock Update Implementation - Products.current_stock

## Overview
Fixed the issue where `products.current_stock` was not updating when sales, purchases, returns, or adjustments occurred. The stock field now updates atomically in `mockDB.products` for all inventory operations.

## Changes Made

### 1. **completePOSOrder** - Decrease Stock on Sales

**File:** `src/db/api.ts`  
**Location:** After order items are saved (line ~1080)

**Added Logic:**
- Loops through each order item
- Finds product in `mockDB.products`
- Decreases `current_stock` by sold quantity: `product.current_stock -= item.quantity`
- Prevents negative stock: `Math.max(0, ...)`
- Updates `product.updated_at`
- Creates inventory movement record with type `'sale'` and negative quantity

**Code:**
```typescript
// Update product stock: decrease stock for each sold item
orderItems.forEach((item) => {
  const product = mockDB.products.find(p => p.id === item.product_id);
  if (product) {
    product.current_stock = Math.max(0, product.current_stock - item.quantity);
    product.updated_at = createdAt;
    // ... create movement record
  }
});
```

### 2. **createSalesReturn** - Increase Stock on Returns

**File:** `src/db/api.ts`  
**Location:** After return items are saved (line ~1435)

**Added Logic:**
- Loops through each return item
- Finds product in `mockDB.products`
- Increases `current_stock` by returned quantity: `product.current_stock += item.quantity`
- Updates `product.updated_at`
- Creates inventory movement record with type `'return'` and positive quantity

**Code:**
```typescript
// Update product stock: increase stock for each returned item (reverse of sale)
returnItems.forEach((item) => {
  const product = mockDB.products.find(p => p.id === item.product_id);
  if (product) {
    product.current_stock = product.current_stock + item.quantity;
    product.updated_at = createdAt;
    // ... create movement record
  }
});
```

### 3. **receiveGoods** - Increase Stock on Purchase Receipt

**File:** `src/db/api.ts`  
**Location:** `receiveGoods` function (line ~1212)

**Added Logic:**
- Accepts optional `product_id` in items array
- Loops through each received item
- Finds product in `mockDB.products`
- Increases `current_stock` by received quantity: `product.current_stock += item.received_qty`
- Updates `product.updated_at`
- Creates inventory movement record with type `'purchase'` and positive quantity

**Code:**
```typescript
export const receiveGoods = async (
  poId: string,
  items: Array<{
    item_id: string;
    received_qty: number;
    notes?: string;
    product_id?: string; // Optional: if provided, use it directly
  }>,
  receivedDate?: string
) => {
  // ... update stock for each item
  product.current_stock = product.current_stock + item.received_qty;
  // ... create movement record
};
```

**Also Updated:** `src/pages/PurchaseOrderForm.tsx`
- Modified `handleSave` to pass `product_id` when calling `receiveGoods`
- Uses form items directly (which have `product_id`) instead of fetching from API

### 4. **createStockAdjustment** - Already Correct ✅

**File:** `src/db/api.ts`  
**Location:** `createStockAdjustment` function (line ~511)

**Status:** Already correctly updates stock
- Updates `product.current_stock += adjustment.quantity` (handles positive/negative)
- Creates movement record

**No changes needed.**

### 5. **Products Page** - Already Correct ✅

**File:** `src/pages/Products.tsx`

**Status:** Already correctly reads from `mockDB.products`
- Uses `getProducts()` which reads from `mockDB.products`
- Displays `product.current_stock` in the "Omborda" column
- Stock status badges use `current_stock` correctly

**No changes needed.**

## Stock Update Flow

### Sales (POS Order Completion)
```
User completes sale → completePOSOrder()
  → For each order item:
    → Find product in mockDB.products
    → current_stock = current_stock - quantity (decrease)
    → Create inventory movement (type: 'sale', quantity: -X)
    → Products page automatically reflects new stock
```

### Purchase Order Receipt
```
User marks PO as received → receiveGoods()
  → For each received item:
    → Find product in mockDB.products
    → current_stock = current_stock + received_qty (increase)
    → Create inventory movement (type: 'purchase', quantity: +X)
    → Products page automatically reflects new stock
```

### Sales Return
```
User creates return → createSalesReturn()
  → For each return item:
    → Find product in mockDB.products
    → current_stock = current_stock + quantity (increase)
    → Create inventory movement (type: 'return', quantity: +X)
    → Products page automatically reflects new stock
```

### Stock Adjustment
```
User adjusts stock → createStockAdjustment()
  → Find product in mockDB.products
  → current_stock = current_stock + quantity (handles +/-)
  → Create inventory movement (type: 'adjustment', quantity: +/-X)
  → Products page automatically reflects new stock
```

## Technical Notes

### Atomic Operations
- In a real database (Supabase), these would use SQL: `UPDATE products SET current_stock = current_stock + delta WHERE id = ...`
- In mock implementation, we directly modify `mockDB.products` array in memory
- All updates happen synchronously in the same execution context

### Inventory Movements
- All stock updates also create corresponding `InventoryMovement` records
- Movement records include `before_quantity` and `after_quantity` for audit trail
- Movement types: `'sale'`, `'purchase'`, `'return'`, `'adjustment'`

### Error Handling
- If product not found: logs warning, skips stock update (doesn't fail entire operation)
- Prevents negative stock on sales: uses `Math.max(0, ...)`
- All updates include `updated_at` timestamp

## Testing Checklist

- [x] Create POS sale → Verify stock decreases in Products page
- [x] Receive purchase order → Verify stock increases in Products page
- [x] Create sales return → Verify stock increases in Products page
- [x] Create stock adjustment (increase) → Verify stock increases
- [x] Create stock adjustment (decrease) → Verify stock decreases
- [x] Verify inventory movements are created for all operations
- [x] Verify Products page displays correct `current_stock` values
- [x] Verify stock status badges (Low Stock, Out of Stock) update correctly

## Files Modified

1. ✅ `src/db/api.ts`
   - `completePOSOrder` - Added stock decrease logic
   - `createSalesReturn` - Added stock increase logic
   - `receiveGoods` - Added stock increase logic (and made functional)
   
2. ✅ `src/pages/PurchaseOrderForm.tsx`
   - `handleSave` - Updated to pass `product_id` to `receiveGoods`

## Files Verified (No Changes Needed)

1. ✅ `src/db/api.ts`
   - `createStockAdjustment` - Already correct
   
2. ✅ `src/pages/Products.tsx`
   - Already reads from `mockDB.products.current_stock` correctly

## Summary

✅ **COMPLETE** - All inventory operations now correctly update `products.current_stock`

The Products page (`/products`) "Omborda" column now reflects real-time stock changes from:
- ✅ POS sales (decrease)
- ✅ Purchase order receipts (increase)
- ✅ Sales returns (increase)
- ✅ Stock adjustments (increase/decrease)

All updates are atomic and include proper inventory movement audit records.







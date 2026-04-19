# IPC + Frontend Wiring Complete

## ✅ All Requirements Implemented

### IPC Endpoints Exposed

All required IPC endpoints are registered and working:

1. ✅ **`pos:sales:finalizeOrder`** (aliased as `posApi.sales.finalize`)
   - Handler: `electron/ipc/sales.ipc.cjs`
   - Service: `salesService.finalizeOrder()`
   - Preload: `window.posApi.sales.finalizeOrder()` and `window.posApi.sales.finalize()`

2. ✅ **`pos:sales:completePOSOrder`**
   - Handler: `electron/ipc/sales.ipc.cjs`
   - Service: `salesService.completePOSOrder()`
   - Preload: `window.posApi.sales.completePOSOrder()`

3. ✅ **`pos:returns:create`**
   - Handler: `electron/ipc/returns.ipc.cjs`
   - Service: `returnsService.createReturn()`
   - Preload: `window.posApi.returns.create()`

4. ✅ **`pos:purchases:receiveGoods`**
   - Handler: `electron/ipc/purchases.ipc.cjs`
   - Service: `purchaseService.receiveGoods()`
   - Preload: `window.posApi.purchases.receiveGoods()`

5. ✅ **`pos:products:list`**
   - Handler: `electron/ipc/products.ipc.cjs`
   - Service: `productsService.list()`
   - Preload: `window.posApi.products.list()`

### Preload Bridge (`electron/preload.cjs`)

All methods are exposed via `window.posApi`:

```javascript
window.posApi.sales.finalize(orderId, paymentData)  // Alias for finalizeOrder
window.posApi.sales.finalizeOrder(orderId, paymentData)
window.posApi.sales.completePOSOrder(orderData, itemsData, paymentsData)
window.posApi.returns.create(data)
window.posApi.purchases.receiveGoods(purchaseOrderId, receiptData)
window.posApi.products.list(filters)
```

### Frontend Adapter Updates (`src/db/api.ts`)

#### ✅ `completePOSOrder`
- Already uses IPC when in Electron
- Emits `productUpdateEmitter.emit()` after successful operation
- Maps frontend data format to backend format
- Handles errors via `handleIpcResponse()`

#### ✅ `createSalesReturn`
- **UPDATED**: Now uses IPC when in Electron
- Maps frontend return data to backend format:
  - `cashier_id` → `user_id`
  - `items[].order_item_id` or `items[].product_id` → `items[].order_item_id`
  - `reason` → `return_reason`
- Emits `productUpdateEmitter.emit()` after successful operation
- Maps backend response back to frontend format
- Falls back to mock for browser dev

#### ✅ `receiveGoods`
- **UPDATED**: Now uses IPC when in Electron
- Maps frontend receipt data to backend format:
  - `item_id` → `purchase_order_item_id`
  - `received_qty` → `quantity_received`
  - Adds `received_by` parameter (defaults to 'system')
- Emits `productUpdateEmitter.emit()` after successful operation
- Falls back to mock for browser dev

#### ✅ `getProducts`
- Already uses IPC when in Electron
- Calls `window.posApi.products.list(filters)`
- Maps backend filters to frontend filters
- Products returned from backend include stock information (via joins if needed)
- Falls back to mock for browser dev

### Product Update Emitter

The `productUpdateEmitter` is used to trigger refetch across the app:

**Location**: `src/db/api.ts`
```typescript
export const productUpdateEmitter = new ProductUpdateEmitter();
```

**Emitted after**:
- ✅ `completePOSOrder()` - Stock decreases on sale
- ✅ `createSalesReturn()` - Stock increases on return
- ✅ `receiveGoods()` - Stock increases on purchase receipt
- ✅ Product CRUD operations (create, update, delete)

**Subscribed by**:
- ✅ `useProducts` hook - Refetches products when emitter fires
- ✅ `Inventory` page - Listens for updates and refetches data
- ✅ `Products` page - Uses `useProducts` hook which auto-refetches

### Products Page Stock Updates

The Products page (`src/pages/Products.tsx`) uses the `useProducts` hook which:

1. ✅ Subscribes to `productUpdateEmitter`
2. ✅ Automatically refetches products when emitter fires
3. ✅ Products list shows updated stock after:
   - Sale finalization (stock decreases)
   - Return creation (stock increases)
   - Purchase receipt (stock increases)

**Flow**:
```
User completes order → completePOSOrder() → productUpdateEmitter.emit()
  → useProducts hook detects → refetch() → Products page updates
```

### Files Modified

1. ✅ `electron/preload.cjs`
   - Added `finalize` alias for `finalizeOrder`
   - All required methods already exposed

2. ✅ `src/db/api.ts`
   - Updated `createSalesReturn()` to use IPC
   - Updated `receiveGoods()` to use IPC
   - Both emit `productUpdateEmitter.emit()` after operations
   - Both map data formats between frontend and backend

### Data Mapping

#### Sales Return
**Frontend → Backend**:
```typescript
{
  order_id: string,
  cashier_id: string,        → user_id
  items: [{
    product_id: string,       → order_item_id (or use product_id)
    quantity: number,
    ...
  }],
  reason: string,             → return_reason
  ...
}
```

**Backend → Frontend**:
```typescript
{
  id: string,
  return_number: string,
  user_id: string,            → cashier_id
  return_reason: string,      → reason
  status: string,
  ...
}
```

#### Purchase Receipt
**Frontend → Backend**:
```typescript
{
  item_id: string,            → purchase_order_item_id
  received_qty: number,       → quantity_received
  notes?: string,
  ...
}
```

### Testing Checklist

- ✅ IPC endpoints registered
- ✅ Preload bridge exposes all methods
- ✅ Frontend adapter uses IPC for Electron
- ✅ Frontend adapter falls back to mock for browser
- ✅ `productUpdateEmitter` emitted after operations
- ✅ `useProducts` hook subscribes to emitter
- ✅ Products page shows updated stock after operations
- ✅ No UI redesign required (only data layer changes)

## Summary

All IPC endpoints are properly wired and the frontend adapter correctly:
- Uses IPC when running in Electron
- Emits product update events to trigger refetch
- Maps data formats between frontend and backend
- Falls back to mock implementation for browser dev

The Products page will automatically show updated stock after sales, returns, and purchase receipts due to the `productUpdateEmitter` → `useProducts` hook → refetch chain.





















































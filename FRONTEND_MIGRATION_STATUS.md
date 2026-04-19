# Frontend Migration Status - Supabase to window.posApi

## Overview

Migrating frontend from Supabase to `window.posApi` (Electron IPC-based SQLite backend).

## Strategy

1. **Update electron utility** - Check for `window.posApi` instead of `window.api`
2. **Create IPC response handler** - Unwrap `{ success, data/error }` format
3. **Update all API functions** - Use `window.posApi.*` with proper error handling
4. **Browser fallback** - Throw clear "Electron required" error (no mock fallback)
5. **Remove Supabase references** - Clean up env variables and imports

## Migration Progress

### ✅ Completed

- ✅ `src/utils/electron.ts` - Updated to use `window.posApi`
  - Added `requireElectron()` helper
  - Added `handleIpcResponse()` helper

- ✅ `src/db/api.ts` - Partial migration:
  - ✅ `getCategories()` - Uses `posApi.categories.list()`
  - ✅ `createCategory()` - Uses `posApi.categories.create()`
  - ✅ `updateCategory()` - Uses `posApi.categories.update()`
  - ✅ `deleteCategory()` - Uses `posApi.categories.delete()`
  - ✅ `getCategoryById()` - Uses `posApi.categories.get()`
  - ✅ `getProducts()` - Uses `posApi.products.list()`
  - ✅ `getProductById()` - Uses `posApi.products.get()`
  - ✅ `getProductByBarcode()` - Uses `posApi.products.getByBarcode()`
  - ✅ `searchProducts()` - Uses `posApi.products.list()`
  - ✅ `createProduct()` - Uses `posApi.products.create()`
  - ✅ `updateProduct()` - Uses `posApi.products.update()`
  - ✅ `deleteProduct()` - Uses `posApi.products.delete()`

### ⏳ Remaining Functions to Migrate

#### Customers (when customer service is implemented)
- `getCustomers()` - TODO: Implement customer service first
- `getCustomerById()` - TODO
- `searchCustomers()` - TODO
- `createCustomer()` - TODO
- `updateCustomer()` - TODO
- `deleteCustomer()` - TODO

#### Inventory
- `getInventory()` - Map to `posApi.inventory.getBalances()`
- `getInventoryMovements()` - Map to `posApi.inventory.getMoves()`
- `createStockAdjustment()` - Map to `posApi.inventory.adjustStock()`

#### Sales/Orders
- `completePOSOrder()` - Map to `posApi.sales.finalizeOrder()`
- `getOrders()` - Map to `posApi.sales.*` (when implemented)
- `getOrderById()` - TODO

#### Returns
- `createSalesReturn()` - Map to `posApi.returns.create()`
- `getSalesReturns()` - Map to `posApi.returns.list()`
- `getSalesReturnById()` - Map to `posApi.returns.get()`

#### Purchases
- `getPurchaseOrders()` - Map to `posApi.purchases.list()`
- `createPurchaseOrder()` - Map to `posApi.purchases.createOrder()`
- `receiveGoods()` - Map to `posApi.purchases.receiveGoods()`

#### Expenses
- `getExpenses()` - Map to `posApi.expenses.list()`
- `createExpense()` - Map to `posApi.expenses.create()`
- `updateExpense()` - Map to `posApi.expenses.update()`

#### Shifts
- `getActiveShift()` - Map to `posApi.shifts.getStatus()`
- `createShift()` - Map to `posApi.shifts.open()`
- `closeShift()` - Map to `posApi.shifts.close()`

#### Reports
- Dashboard stats - Map to `posApi.reports.*`

#### Settings
- `getSetting()` - Map to `posApi.settings.get()`
- `updateSetting()` - Map to `posApi.settings.set()`

## Browser Fallback Strategy

Instead of mock data, throw clear error:
```javascript
throw new Error('This application requires Electron to run. Please use the desktop application.');
```

This ensures:
- Users know they need Electron
- No confusing mock data
- Cleaner code (no mock maintenance)

## Error Handling

All IPC calls use `handleIpcResponse()` which:
1. Unwraps `{ success: true, data }` → returns `data`
2. Unwraps `{ success: false, error }` → throws error with `code`, `message`, `details`

## Files to Update

### Core Files
- ✅ `src/utils/electron.ts` - DONE
- ⏳ `src/db/api.ts` - IN PROGRESS (key functions done)

### Hooks (if needed)
- `src/hooks/useProducts.ts` - Check if needs updates
- `src/hooks/useCategories.ts` - Check if needs updates
- Other hooks - Review

### Pages (verify they work)
- Products page
- Categories page
- Orders page
- Customers page
- Inventory page
- Sales Returns
- Expenses
- Purchase Orders
- Suppliers
- Reports
- Employees
- Settings

## Next Steps

1. Continue migrating remaining functions in `src/db/api.ts`
2. Test each page after migration
3. Remove Supabase env variables from `.env` files
4. Remove Supabase imports/references
5. Test end-to-end in Electron






















































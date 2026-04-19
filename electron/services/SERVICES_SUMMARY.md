# Services Layer - Complete Summary

## Overview

All services are implemented in `electron/services/*Service.cjs` and follow a consistent pattern:
- Receive database instance in constructor
- Use transactions for multi-step operations
- Validate inputs and throw typed errors using `ERROR_CODES`
- All methods are synchronous (better-sqlite3 is synchronous)

## Services Implemented

### 1. CategoriesService (`categoriesService.cjs`)
- `list(filters)` - List categories with optional filters
- `getById(id)` - Get category by ID
- `create(data)` - Create category
- `update(id, data)` - Update category
- `delete(id)` - Delete category (checks for products/children)

### 2. ProductsService (`productsService.cjs`)
- `list(filters)` - List products with search, category, status, stock filters, pagination
- `getById(id)` - Get product by ID
- `getBySku(sku)` - Get product by SKU
- `getByBarcode(barcode)` - Get product by barcode
- `create(data)` - Create product (validates SKU/barcode uniqueness)
- `update(id, data)` - Update product
- `delete(id)` - Delete product (soft delete if has orders)

### 3. WarehousesService (`warehousesService.cjs`)
- `list(filters)` - List warehouses
- `getById(id)` - Get warehouse by ID
- `create(data)` - Create warehouse
- `update(id, data)` - Update warehouse
- `delete(id)` - Delete warehouse (soft delete if has stock/orders)

### 4. InventoryService (`inventoryService.cjs`)
- `getBalances(filters)` - Get stock balances with filters
- `getMoves(filters)` - Get stock movement history
- `adjustStock(adjustmentData)` - **TRANSACTIONAL** - Create adjustment and update balances
- `_updateBalance(...)` - Internal helper for stock updates

### 5. SalesService (`salesService.cjs`) - POS Terminal
- `createDraftOrder(data)` - Create draft order
- `addItem(orderId, itemData)` - Add item to order (checks stock)
- `removeItem(orderId, itemId)` - Remove item from order
- `updateItemQuantity(orderId, itemId, quantity)` - Update item quantity
- `setCustomer(orderId, customerId)` - Set customer for order
- `finalizeOrder(orderId, paymentData)` - **TRANSACTIONAL** - Finalize order:
  - Updates order status
  - Creates payments
  - Creates stock moves (OUT)
  - Updates stock balances
  - Creates receipt snapshot
  - Creates cash movements (if cash)
  - Updates customer stats

### 6. ReturnsService (`returnsService.cjs`)
- `createReturn(data)` - **TRANSACTIONAL** - Create return:
  - Validates return quantities
  - Creates return items
  - Creates stock moves (IN)
  - Updates stock balances
  - Updates customer stats
- `getById(id)` - Get return by ID
- `list(filters)` - List returns

### 7. PurchaseService (`purchaseService.cjs`)
- `createPurchaseOrder(data)` - **TRANSACTIONAL** - Create purchase order with items
- `receiveGoods(purchaseOrderId, receiptData)` - **TRANSACTIONAL** - Receive goods:
  - Validates receipt quantities
  - Updates PO item received quantities
  - Creates goods receipt and items
  - Creates stock moves (IN)
  - Updates stock balances
  - Updates PO status
- `getById(id)` - Get purchase order by ID
- `list(filters)` - List purchase orders

### 8. ExpensesService (`expensesService.cjs`)
- `listCategories(filters)` - List expense categories
- `createCategory(data)` - Create expense category
- `updateCategory(id, data)` - Update expense category
- `deleteCategory(id)` - Delete expense category
- `list(filters)` - List expenses
- `create(data)` - Create expense
- `update(id, data)` - Update expense
- `delete(id)` - Delete expense

### 9. ShiftsService (`shiftsService.cjs`)
- `openShift(data)` - Open shift for user/warehouse
- `closeShift(shiftId, data)` - **TRANSACTIONAL** - Close shift:
  - Calculates totals from orders
  - Updates shift record
  - Creates shift_totals
  - Creates cash movement
- `getById(id)` - Get shift by ID
- `getStatus(userId, warehouseId)` - Get current shift status
- `requireShift(userId, warehouseId)` - Enforce shift requirement
- `list(filters)` - List shifts

### 10. SettingsService (`settingsService.cjs`)
- `get(key)` - Get setting value (parsed by type)
- `set(key, value, type, updatedBy)` - Set setting value
- `getAll(filters)` - Get all settings (optionally filtered)
- `delete(key)` - Delete setting

### 11. AuditService (`auditService.cjs`)
- `log(data)` - Generic log action
- `logProductCreate(product, userId)` - Log product creation
- `logProductUpdate(oldProduct, newProduct, userId)` - Log product update
- `logProductDelete(product, userId)` - Log product deletion
- `logOrderFinalize(order, userId)` - Log order finalization
- `logStockAdjustment(adjustment, userId)` - Log stock adjustment
- `logReturnCreate(returnRecord, userId)` - Log return creation
- `getLogs(filters)` - Get audit log entries

### 12. ReportsService (`reportsService.cjs`)
- `getDailySales(date, warehouseId)` - Daily sales report
- `getTopProducts(filters)` - Top products by revenue
- `getStockReport(warehouseId)` - Stock levels report
- `getReturnsReport(filters)` - Returns report
- `getProfitEstimate(filters)` - Profit estimate report

## Transaction Safety

All multi-step operations use transactions:
- `InventoryService.adjustStock()` - Uses `db.transaction()`
- `SalesService.finalizeOrder()` - Uses `db.transaction()`
- `ReturnsService.createReturn()` - Uses `db.transaction()`
- `PurchaseService.createPurchaseOrder()` - Uses `db.transaction()`
- `PurchaseService.receiveGoods()` - Uses `db.transaction()`
- `ShiftsService.closeShift()` - Uses `db.transaction()`

## Error Handling

All services use `ERROR_CODES` from `electron/lib/errors.cjs`:
- `NOT_FOUND` - Resource not found
- `VALIDATION_ERROR` - Input validation failed
- `DATABASE_ERROR` - Database operation failed
- `PERMISSION_DENIED` - Operation not allowed

## Usage Example

```javascript
const { getDb } = require('./db/index.cjs');
const { createServices } = require('./services/index.cjs');

const db = getDb();
const services = createServices(db);

// Use services
const products = services.products.list({ search: 'laptop' });
const order = services.sales.createDraftOrder({
  user_id: 'user-123',
  warehouse_id: 'wh-1',
});

services.sales.addItem(order.id, {
  product_id: 'prod-123',
  quantity: 2,
  unit_price: 100,
});

const finalized = services.sales.finalizeOrder(order.id, {
  payments: [
    { payment_method: 'cash', amount: 200 },
  ],
});
```

## Service Initialization

Use `createServices(db)` from `services/index.cjs` to initialize all services with proper dependencies:
- SalesService needs InventoryService
- ReturnsService needs InventoryService
- PurchaseService needs InventoryService

Example:
```javascript
const { getDb } = require('./db/index.cjs');
const { createServices } = require('./services/index.cjs');

const db = getDb();
const services = createServices(db);
// services.sales, services.returns, services.purchases all share inventoryService
```


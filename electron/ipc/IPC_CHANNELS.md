# IPC Channels Reference

Complete list of all IPC channels and their corresponding `window.posApi` methods.

## Channel Naming Convention

All channels follow the pattern: `pos:module:action`

## Products (`pos:products:*`)

| Channel | window.posApi Method | Description |
|---------|---------------------|-------------|
| `pos:products:list` | `posApi.products.list(filters)` | List products with filters |
| `pos:products:get` | `posApi.products.get(id)` | Get product by ID |
| `pos:products:getBySku` | `posApi.products.getBySku(sku)` | Get product by SKU |
| `pos:products:getByBarcode` | `posApi.products.getByBarcode(barcode)` | Get product by barcode |
| `pos:products:create` | `posApi.products.create(data)` | Create new product |
| `pos:products:update` | `posApi.products.update(id, data)` | Update product |
| `pos:products:delete` | `posApi.products.delete(id)` | Delete product |

## Categories (`pos:categories:*`)

| Channel | window.posApi Method | Description |
|---------|---------------------|-------------|
| `pos:categories:list` | `posApi.categories.list(filters)` | List categories |
| `pos:categories:get` | `posApi.categories.get(id)` | Get category by ID |
| `pos:categories:create` | `posApi.categories.create(data)` | Create category |
| `pos:categories:update` | `posApi.categories.update(id, data)` | Update category |
| `pos:categories:delete` | `posApi.categories.delete(id)` | Delete category |

## Warehouses (`pos:warehouses:*`)

| Channel | window.posApi Method | Description |
|---------|---------------------|-------------|
| `pos:warehouses:list` | `posApi.warehouses.list(filters)` | List warehouses |
| `pos:warehouses:get` | `posApi.warehouses.get(id)` | Get warehouse by ID |
| `pos:warehouses:create` | `posApi.warehouses.create(data)` | Create warehouse |
| `pos:warehouses:update` | `posApi.warehouses.update(id, data)` | Update warehouse |
| `pos:warehouses:delete` | `posApi.warehouses.delete(id)` | Delete warehouse |

## Inventory (`pos:inventory:*`)

| Channel | window.posApi Method | Description |
|---------|---------------------|-------------|
| `pos:inventory:getBalances` | `posApi.inventory.getBalances(filters)` | Get stock balances |
| `pos:inventory:getMoves` | `posApi.inventory.getMoves(filters)` | Get stock movement history |
| `pos:inventory:adjustStock` | `posApi.inventory.adjustStock(adjustmentData)` | Adjust stock (transactional) |

## Sales (`pos:sales:*`)

| Channel | window.posApi Method | Description |
|---------|---------------------|-------------|
| `pos:sales:createDraftOrder` | `posApi.sales.createDraftOrder(data)` | Create draft order |
| `pos:sales:addItem` | `posApi.sales.addItem(orderId, itemData)` | Add item to order |
| `pos:sales:removeItem` | `posApi.sales.removeItem(orderId, itemId)` | Remove item from order |
| `pos:sales:updateItemQuantity` | `posApi.sales.updateItemQuantity(orderId, itemId, quantity)` | Update item quantity |
| `pos:sales:setCustomer` | `posApi.sales.setCustomer(orderId, customerId)` | Set customer for order |
| `pos:sales:finalizeOrder` | `posApi.sales.finalizeOrder(orderId, paymentData)` | Finalize order (transactional) |
| `pos:sales:getOrder` | `posApi.sales.getOrder(orderId)` | Get order with details |

## Returns (`pos:returns:*`)

| Channel | window.posApi Method | Description |
|---------|---------------------|-------------|
| `pos:returns:create` | `posApi.returns.create(data)` | Create return (transactional) |
| `pos:returns:get` | `posApi.returns.get(id)` | Get return by ID |
| `pos:returns:list` | `posApi.returns.list(filters)` | List returns |

## Purchases (`pos:purchases:*`)

| Channel | window.posApi Method | Description |
|---------|---------------------|-------------|
| `pos:purchases:createOrder` | `posApi.purchases.createOrder(data)` | Create purchase order (transactional) |
| `pos:purchases:receiveGoods` | `posApi.purchases.receiveGoods(purchaseOrderId, receiptData)` | Receive goods (transactional) |
| `pos:purchases:get` | `posApi.purchases.get(id)` | Get purchase order by ID |
| `pos:purchases:list` | `posApi.purchases.list(filters)` | List purchase orders |

## Expenses (`pos:expenses:*`)

| Channel | window.posApi Method | Description |
|---------|---------------------|-------------|
| `pos:expenses:listCategories` | `posApi.expenses.listCategories(filters)` | List expense categories |
| `pos:expenses:createCategory` | `posApi.expenses.createCategory(data)` | Create expense category |
| `pos:expenses:updateCategory` | `posApi.expenses.updateCategory(id, data)` | Update expense category |
| `pos:expenses:deleteCategory` | `posApi.expenses.deleteCategory(id)` | Delete expense category |
| `pos:expenses:list` | `posApi.expenses.list(filters)` | List expenses |
| `pos:expenses:create` | `posApi.expenses.create(data)` | Create expense |
| `pos:expenses:update` | `posApi.expenses.update(id, data)` | Update expense |
| `pos:expenses:delete` | `posApi.expenses.delete(id)` | Delete expense |

## Shifts (`pos:shifts:*`)

| Channel | window.posApi Method | Description |
|---------|---------------------|-------------|
| `pos:shifts:open` | `posApi.shifts.open(data)` | Open shift |
| `pos:shifts:close` | `posApi.shifts.close(shiftId, data)` | Close shift (transactional) |
| `pos:shifts:get` | `posApi.shifts.get(id)` | Get shift by ID |
| `pos:shifts:getStatus` | `posApi.shifts.getStatus(userId, warehouseId)` | Get shift status |
| `pos:shifts:require` | `posApi.shifts.require(userId, warehouseId)` | Require shift (enforce) |
| `pos:shifts:list` | `posApi.shifts.list(filters)` | List shifts |

## Reports (`pos:reports:*`)

| Channel | window.posApi Method | Description |
|---------|---------------------|-------------|
| `pos:reports:dailySales` | `posApi.reports.dailySales(date, warehouseId)` | Get daily sales report |
| `pos:reports:topProducts` | `posApi.reports.topProducts(filters)` | Get top products report |
| `pos:reports:stock` | `posApi.reports.stock(warehouseId)` | Get stock report |
| `pos:reports:returns` | `posApi.reports.returns(filters)` | Get returns report |
| `pos:reports:profit` | `posApi.reports.profit(filters)` | Get profit estimate report |

## Settings (`pos:settings:*`)

| Channel | window.posApi Method | Description |
|---------|---------------------|-------------|
| `pos:settings:get` | `posApi.settings.get(key)` | Get setting value |
| `pos:settings:set` | `posApi.settings.set(key, value, type, updatedBy)` | Set setting value |
| `pos:settings:getAll` | `posApi.settings.getAll(filters)` | Get all settings |
| `pos:settings:delete` | `posApi.settings.delete(key)` | Delete setting |

## Auth (`pos:auth:*`)

| Channel | window.posApi Method | Description |
|---------|---------------------|-------------|
| `pos:auth:login` | `posApi.auth.login(username, password)` | Login user |
| `pos:auth:getUser` | `posApi.auth.getUser(userId)` | Get user by ID |
| `pos:auth:checkPermission` | `posApi.auth.checkPermission(userId, permission)` | Check user permission |

## Print (`pos:print:*`)

| Channel | window.posApi Method | Description |
|---------|---------------------|-------------|
| `pos:print:receipt` | `posApi.print.receipt(payload)` | Print ESC/POS receipt |

## System (`pos:*`)

| Channel | window.posApi Method | Description |
|---------|---------------------|-------------|
| `pos:health` | `posApi.health()` | Health check |

## Error Handling

All IPC methods return promises that resolve with data or reject with structured errors:

```javascript
try {
  const product = await window.posApi.products.get('product-id');
  console.log(product);
} catch (error) {
  // error format: { code, message, details }
  console.error('Error:', error.code, error.message);
}
```

The `wrapHandler` utility in `electron/lib/errors.cjs` ensures all errors are structured:
- `code`: Error code (NOT_FOUND, VALIDATION_ERROR, etc.)
- `message`: Human-readable error message
- `details`: Additional error details (optional)

## Usage Example

```javascript
// In renderer process (React component)
const products = await window.posApi.products.list({ search: 'laptop', limit: 10 });

const order = await window.posApi.sales.createDraftOrder({
  user_id: 'user-123',
  warehouse_id: 'wh-1',
});

await window.posApi.sales.addItem(order.id, {
  product_id: 'prod-123',
  quantity: 2,
});

const finalized = await window.posApi.sales.finalizeOrder(order.id, {
  payments: [{ payment_method: 'cash', amount: 200 }],
});
```






















































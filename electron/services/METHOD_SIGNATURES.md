# Service Method Signatures

Complete method signatures for all services.

## CategoriesService

```javascript
list(filters?: { parent_id?: string | null, is_active?: boolean }): Category[]
getById(id: string): Category
create(data: { name: string, parent_id?: string, description?: string, color?: string, icon?: string, sort_order?: number, is_active?: boolean }): Category
update(id: string, data: Partial<Category>): Category
delete(id: string): { success: boolean }
```

## ProductsService

```javascript
list(filters?: { search?: string, category_id?: string, status?: 'active' | 'inactive', warehouse_id?: string, stock_filter?: 'low' | 'out', track_stock?: boolean, sort_by?: string, sort_order?: 'ASC' | 'DESC', limit?: number, offset?: number }): Product[]
getById(id: string): Product
getBySku(sku: string): Product
getByBarcode(barcode: string): Product
create(data: { name: string, sku: string, barcode?: string, description?: string, category_id?: string, unit_id?: string, purchase_price: number, sale_price: number, min_stock_level?: number, max_stock_level?: number, track_stock?: boolean, is_active?: boolean, image_url?: string }): Product
update(id: string, data: Partial<Product>): Product
delete(id: string): { success: boolean, softDeleted: boolean }
```

## WarehousesService

```javascript
list(filters?: { is_active?: boolean }): Warehouse[]
getById(id: string): Warehouse
create(data: { code: string, name: string, address?: string, is_active?: boolean }): Warehouse
update(id: string, data: Partial<Warehouse>): Warehouse
delete(id: string): { success: boolean, softDeleted: boolean }
```

## InventoryService

```javascript
getBalances(filters?: { product_id?: string, warehouse_id?: string, low_stock?: boolean, out_of_stock?: boolean }): StockBalance[]
getMoves(filters?: { product_id?: string, warehouse_id?: string, move_type?: string, reference_type?: string, reference_id?: string, date_from?: string, date_to?: string, limit?: number, offset?: number }): StockMove[]
adjustStock(adjustmentData: { warehouse_id: string, adjustment_type?: 'increase' | 'decrease' | 'set', reason: string, notes?: string, created_by?: string, items: Array<{ product_id: string, quantity?: number, target_quantity?: number, notes?: string }> }): InventoryAdjustment
_updateBalance(productId: string, warehouseId: string, quantityChange: number, moveType: string, referenceType: string, referenceId: string, reason: string, createdBy: string): { beforeQuantity: number, afterQuantity: number, moveId: string }
```

## SalesService

```javascript
createDraftOrder(data: { user_id: string, warehouse_id: string, customer_id?: string, shift_id?: string, notes?: string }): Order
addItem(orderId: string, itemData: { product_id: string, quantity: number, unit_price?: number, discount_amount?: number }): Order
removeItem(orderId: string, itemId: string): Order
updateItemQuantity(orderId: string, itemId: string, quantity: number): Order
setCustomer(orderId: string, customerId: string | null): Order
finalizeOrder(orderId: string, paymentData: { payments: Array<{ payment_method: string, amount: number, reference_number?: string, notes?: string }> }): Order
_recalculateOrderTotals(orderId: string): void
_getOrderWithDetails(orderId: string): Order
```

## ReturnsService

```javascript
createReturn(data: { order_id: string, return_reason: string, refund_method?: 'cash' | 'card' | 'credit', user_id?: string, notes?: string, items: Array<{ order_item_id: string, quantity: number, reason?: string }> }): SaleReturn
getById(id: string): SaleReturn
list(filters?: { order_id?: string, customer_id?: string, date_from?: string, date_to?: string, limit?: number, offset?: number }): SaleReturn[]
```

## PurchaseService

```javascript
createPurchaseOrder(data: { warehouse_id: string, supplier_id?: string, order_date?: string, expected_date?: string, reference?: string, discount?: number, tax?: number, status?: string, notes?: string, created_by?: string, items: Array<{ product_id: string, ordered_qty: number, unit_cost: number }> }): PurchaseOrder
receiveGoods(purchaseOrderId: string, receiptData: { received_by: string, received_at?: string, notes?: string, items: Array<{ purchase_order_item_id: string, quantity_received: number, notes?: string }> }): { receipt: GoodsReceipt, purchase_order: PurchaseOrder }
getById(id: string): PurchaseOrder
list(filters?: { supplier_id?: string, warehouse_id?: string, status?: string, date_from?: string, date_to?: string, limit?: number, offset?: number }): PurchaseOrder[]
```

## ExpensesService

```javascript
listCategories(filters?: { is_active?: boolean }): ExpenseCategory[]
createCategory(data: { code: string, name: string, description?: string, is_active?: boolean }): ExpenseCategory
updateCategory(id: string, data: Partial<ExpenseCategory>): ExpenseCategory
deleteCategory(id: string): { success: boolean }
list(filters?: { category_id?: string, status?: string, date_from?: string, date_to?: string, limit?: number, offset?: number }): Expense[]
create(data: { category_id: string, amount: number, payment_method?: string, expense_date: string, description: string, receipt_url?: string, vendor?: string, status?: string, notes?: string, created_by?: string }): Expense
update(id: string, data: Partial<Expense>): Expense
delete(id: string): { success: boolean }
```

## ShiftsService

```javascript
openShift(data: { user_id: string, warehouse_id: string, opening_cash?: number }): Shift
closeShift(shiftId: string, data: { closing_cash: number, notes?: string }): Shift
getById(id: string): Shift
getStatus(userId: string, warehouseId: string): { hasOpenShift: boolean, shift: Shift | null, enforceShift: boolean }
requireShift(userId: string, warehouseId: string): Shift
list(filters?: { user_id?: string, warehouse_id?: string, status?: string, date_from?: string, date_to?: string, limit?: number, offset?: number }): Shift[]
```

## SettingsService

```javascript
get(key: string): any
set(key: string, value: any, type?: 'string' | 'number' | 'boolean' | 'json', updatedBy?: string): any
getAll(filters?: { category?: string, is_public?: boolean }): Setting[]
delete(key: string): { success: boolean }
```

## AuditService

```javascript
log(data: { action: string, entity_type: string, entity_id?: string, old_values?: object, new_values?: object, user_id?: string, ip_address?: string, user_agent?: string }): { id: string, created_at: string }
logProductCreate(product: Product, userId: string): { id: string, created_at: string }
logProductUpdate(oldProduct: Product, newProduct: Product, userId: string): { id: string, created_at: string }
logProductDelete(product: Product, userId: string): { id: string, created_at: string }
logOrderFinalize(order: Order, userId: string): { id: string, created_at: string }
logStockAdjustment(adjustment: InventoryAdjustment, userId: string): { id: string, created_at: string }
logReturnCreate(returnRecord: SaleReturn, userId: string): { id: string, created_at: string }
getLogs(filters?: { user_id?: string, action?: string, entity_type?: string, entity_id?: string, date_from?: string, date_to?: string, limit?: number, offset?: number }): AuditLog[]
```

## ReportsService

```javascript
getDailySales(date: string, warehouseId?: string): DailySalesReport
getTopProducts(filters?: { date_from?: string, date_to?: string, warehouse_id?: string, limit?: number }): TopProduct[]
getStockReport(warehouseId?: string): StockReport[]
getReturnsReport(filters?: { date_from?: string, date_to?: string, warehouse_id?: string, limit?: number }): ReturnsReport[]
getProfitEstimate(filters?: { date_from?: string, date_to?: string, warehouse_id?: string }): ProfitEstimate
```






















































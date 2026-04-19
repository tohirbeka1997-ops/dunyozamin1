# window.posApi - Complete API Shape

This document shows the complete structure of `window.posApi` as exposed to the renderer process.

## API Structure

```typescript
interface Window {
  posApi: {
    // Products
    products: {
      list(filters?: ProductFilters): Promise<Response<Product[]>>;
      get(id: string): Promise<Response<Product>>;
      getBySku(sku: string): Promise<Response<Product>>;
      getByBarcode(barcode: string): Promise<Response<Product>>;
      create(data: CreateProductData): Promise<Response<Product>>;
      update(id: string, data: UpdateProductData): Promise<Response<Product>>;
      delete(id: string): Promise<Response<{ success: boolean }>>;
    };

    // Categories
    categories: {
      list(filters?: CategoryFilters): Promise<Response<Category[]>>;
      get(id: string): Promise<Response<Category>>;
      create(data: CreateCategoryData): Promise<Response<Category>>;
      update(id: string, data: UpdateCategoryData): Promise<Response<Category>>;
      delete(id: string): Promise<Response<{ success: boolean }>>;
    };

    // Warehouses
    warehouses: {
      list(filters?: WarehouseFilters): Promise<Response<Warehouse[]>>;
      get(id: string): Promise<Response<Warehouse>>;
      create(data: CreateWarehouseData): Promise<Response<Warehouse>>;
      update(id: string, data: UpdateWarehouseData): Promise<Response<Warehouse>>;
      delete(id: string): Promise<Response<{ success: boolean }>>;
    };

    // Inventory
    inventory: {
      getBalances(filters?: InventoryBalanceFilters): Promise<Response<StockBalance[]>>;
      getMoves(filters?: StockMoveFilters): Promise<Response<StockMove[]>>;
      adjustStock(adjustmentData: AdjustmentData): Promise<Response<InventoryAdjustment>>;
    };

    // Sales (POS)
    sales: {
      createDraftOrder(data: CreateOrderData): Promise<Response<Order>>;
      addItem(orderId: string, itemData: OrderItemData): Promise<Response<Order>>;
      removeItem(orderId: string, itemId: string): Promise<Response<Order>>;
      updateItemQuantity(orderId: string, itemId: string, quantity: number): Promise<Response<Order>>;
      setCustomer(orderId: string, customerId: string | null): Promise<Response<Order>>;
      finalizeOrder(orderId: string, paymentData: PaymentData): Promise<Response<Order>>;
      getOrder(orderId: string): Promise<Response<Order>>;
    };

    // Returns
    returns: {
      create(data: CreateReturnData): Promise<Response<SaleReturn>>;
      get(id: string): Promise<Response<SaleReturn>>;
      list(filters?: ReturnFilters): Promise<Response<SaleReturn[]>>;
    };

    // Purchases
    purchases: {
      createOrder(data: CreatePurchaseOrderData): Promise<Response<PurchaseOrder>>;
      receiveGoods(purchaseOrderId: string, receiptData: GoodsReceiptData): Promise<Response<{ receipt: GoodsReceipt, purchase_order: PurchaseOrder }>>;
      get(id: string): Promise<Response<PurchaseOrder>>;
      list(filters?: PurchaseOrderFilters): Promise<Response<PurchaseOrder[]>>;
    };

    // Expenses
    expenses: {
      // Categories
      listCategories(filters?: ExpenseCategoryFilters): Promise<Response<ExpenseCategory[]>>;
      createCategory(data: CreateExpenseCategoryData): Promise<Response<ExpenseCategory>>;
      updateCategory(id: string, data: UpdateExpenseCategoryData): Promise<Response<ExpenseCategory>>;
      deleteCategory(id: string): Promise<Response<{ success: boolean }>>;
      // Expenses
      list(filters?: ExpenseFilters): Promise<Response<Expense[]>>;
      create(data: CreateExpenseData): Promise<Response<Expense>>;
      update(id: string, data: UpdateExpenseData): Promise<Response<Expense>>;
      delete(id: string): Promise<Response<{ success: boolean }>>;
    };

    // Shifts
    shifts: {
      open(data: OpenShiftData): Promise<Response<Shift>>;
      close(shiftId: string, data: CloseShiftData): Promise<Response<Shift>>;
      get(id: string): Promise<Response<Shift>>;
      getStatus(userId: string, warehouseId: string): Promise<Response<{ hasOpenShift: boolean, shift: Shift | null, enforceShift: boolean }>>;
      require(userId: string, warehouseId: string): Promise<Response<Shift>>;
      list(filters?: ShiftFilters): Promise<Response<Shift[]>>;
    };

    // Reports
    reports: {
      dailySales(date: string, warehouseId?: string): Promise<Response<DailySalesReport>>;
      topProducts(filters?: ReportFilters): Promise<Response<TopProduct[]>>;
      stock(warehouseId?: string): Promise<Response<StockReport[]>>;
      returns(filters?: ReturnFilters): Promise<Response<ReturnsReport[]>>;
      profit(filters?: ReportFilters): Promise<Response<ProfitEstimate>>;
    };

    // Settings
    settings: {
      get(key: string): Promise<Response<any>>;
      set(key: string, value: any, type?: 'string' | 'number' | 'boolean' | 'json', updatedBy?: string): Promise<Response<any>>;
      getAll(filters?: SettingsFilters): Promise<Response<Setting[]>>;
      delete(key: string): Promise<Response<{ success: boolean }>>;
    };

    // Auth
    auth: {
      login(username: string, password: string): Promise<Response<User>>;
      getUser(userId: string): Promise<Response<User>>;
      checkPermission(userId: string, permission: string): Promise<Response<{ hasPermission: boolean, roles: string[] }>>;
    };

    // Health
    health(): Promise<Response<{ dbOpen: boolean }>>;

    // Print (ESC/POS)
    print: {
      receipt(payload: { lines: { text: string; align?: 'left' | 'center' | 'right'; bold?: boolean }[]; options?: any }): Promise<Response<{ success: true }>>;
    };
  };
}
```

## Response Format

All methods return a `Response<T>` object:

```typescript
type Response<T> = 
  | { success: true, data: T }
  | { success: false, error: { code: string, message: string, details?: any } };
```

## Error Codes

- `NOT_FOUND` - Resource not found
- `VALIDATION_ERROR` - Input validation failed
- `DATABASE_ERROR` - Database operation failed
- `PERMISSION_DENIED` - Operation not allowed
- `INTERNAL_ERROR` - Unexpected error

## Usage Example

```javascript
// Success case
const result = await window.posApi.products.list({ search: 'laptop' });
if (result.success) {
  const products = result.data;
  console.log('Products:', products);
} else {
  console.error('Error:', result.error.code, result.error.message);
}

// Error case
try {
  const product = await window.posApi.products.get('invalid-id');
  if (!product.success) {
    if (product.error.code === 'NOT_FOUND') {
      console.log('Product not found');
    }
  }
} catch (error) {
  console.error('Unexpected error:', error);
}
```

## Security

- ✅ `contextIsolation: true` - Renderer cannot access Node.js APIs directly
- ✅ `window.posApi` only - No raw `ipcRenderer` exposed
- ✅ All methods are validated and safe
- ✅ Errors are sanitized before being sent to renderer






















































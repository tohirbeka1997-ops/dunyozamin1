# Schema Constraints and Indexes - Detailed Notes

## Key Constraints

### 1. Product Constraints

**SKU Unique:**
```sql
products.sku UNIQUE
```
- Every product must have a unique SKU
- Used for product identification

**Barcode Unique (when not NULL):**
```sql
CREATE UNIQUE INDEX idx_products_barcode_unique ON products(barcode) WHERE barcode IS NOT NULL;
```
- Barcodes must be unique, but NULL is allowed (partial unique index)
- Supports products without barcodes

### 2. Stock Constraints

**Non-Negative Stock:**
```sql
stock_balances.quantity CHECK(quantity >= 0)
stock_moves.after_quantity CHECK(after_quantity >= 0)
inventory_adjustment_items.after_quantity CHECK(after_quantity >= 0)
```
- Prevents negative stock by default
- Can be disabled via `settings.allow_negative_stock`
- Enforced at database level for data integrity

**Stock Balance Uniqueness:**
```sql
UNIQUE(product_id, warehouse_id)
```
- One balance record per product per warehouse
- Prevents duplicate balance tracking

**Available Quantity (Generated):**
```sql
available_quantity REAL GENERATED ALWAYS AS (quantity - reserved_quantity) STORED
```
- Automatically calculated
- Stored for query performance

### 3. Order Constraints

**Order Number Unique:**
```sql
orders.order_number UNIQUE
```
- Every order has unique order number
- Used for order identification and lookup

**Payment Status:**
- Enforced via application logic
- Valid values: 'pending', 'partial', 'paid', 'on_credit'

### 4. Purchase Order Constraints

**PO Number Unique:**
```sql
purchase_orders.po_number UNIQUE
```
- Unique purchase order number

**Received Quantity:**
```sql
purchase_order_items.received_qty REAL NOT NULL DEFAULT 0
```
- Tracks how much was actually received
- Used to calculate partial receipts

## Critical Indexes

### Performance-Critical Indexes

#### Orders
```sql
idx_orders_created_at          -- Date range queries
idx_orders_customer            -- Customer order history
idx_orders_status              -- Filter by status
idx_orders_payment_status      -- Payment tracking
idx_orders_shift               -- Shift reports
```

#### Products
```sql
idx_products_sku               -- Fast SKU lookup
idx_products_barcode           -- Fast barcode lookup
idx_products_name              -- Search by name
idx_products_category          -- Filter by category
idx_products_active            -- Active products only
```

#### Stock Movements
```sql
idx_stock_moves_product        -- Product stock history
idx_stock_moves_warehouse      -- Warehouse stock history
idx_stock_moves_reference      -- Find moves by order/PO/etc
idx_stock_moves_created_at     -- Date range queries
idx_stock_moves_move_number    -- Lookup by number
```

#### Stock Balances
```sql
idx_stock_balances_product_warehouse  -- Fast current stock lookup
idx_stock_balances_product            -- All warehouses for product
idx_stock_balances_warehouse          -- All products in warehouse
```

### Foreign Key Indexes

All foreign keys have corresponding indexes for:
- Join performance
- Cascading delete/update operations
- Referential integrity checks

### Composite Indexes

**Multi-column indexes for common query patterns:**
```sql
idx_stock_balances_product_warehouse  -- (product_id, warehouse_id)
idx_orders_customer_created_at        -- Customer orders by date
idx_stock_moves_reference             -- (reference_type, reference_id)
```

## Business Logic Enforcement

### Stock Audit Trail

Every stock change must create a `stock_moves` record:
- Sales: negative quantity, reference_type='order', reference_id=order_id
- Returns: positive quantity, reference_type='return', reference_id=return_id
- Purchases: positive quantity, reference_type='purchase_order', reference_id=po_id
- Adjustments: positive/negative, reference_type='adjustment', reference_id=adjustment_id

### Stock Balance Updates

Stock balances are updated via triggers or application logic:
1. Calculate new quantity from stock_moves
2. Update stock_balances.quantity
3. Update stock_balances.last_movement_at

**Note:** SQLite doesn't support triggers in all contexts, so this should be handled in application code or via database functions.

### Order Total Calculation

Order totals are stored but should match:
```
total_amount = subtotal - discount_amount + tax_amount
```

### Payment Tracking

Multiple payments per order supported:
- Sum of payments should not exceed order.total_amount
- Enforced via application logic

## Settings-Driven Behavior

### Allow Negative Stock

```sql
settings.key = 'allow_negative_stock'
settings.value = '0' or '1'
```

When set to '1':
- CHECK constraints can be bypassed via application logic
- Stock can go negative for backorders or pre-orders

### Default Warehouse

```sql
settings.key = 'default_warehouse'
settings.value = '<warehouse_id>'
```

Used when no warehouse is specified in operations.

## Audit Trail

### Audit Log Table

Tracks important actions:
- User actions (create, update, delete)
- Login/logout events
- Configuration changes
- Stock adjustments

Fields:
- `old_values`: JSON snapshot before change
- `new_values`: JSON snapshot after change
- `entity_type`, `entity_id`: What was changed

### Stock Moves as Audit Trail

Every stock change is recorded in `stock_moves`:
- Immutable (no updates/deletes)
- Includes before/after quantities
- Links to originating transaction

## Data Types

### IDs
- All IDs: `TEXT PRIMARY KEY`
- Use UUIDs (generated via `crypto.randomUUID()` in Node.js)

### Booleans
- All booleans: `INTEGER NOT NULL DEFAULT 0`
- 0 = false, 1 = true

### Timestamps
- All timestamps: `TEXT NOT NULL DEFAULT (datetime('now'))`
- ISO 8601 format strings
- SQLite `datetime('now')` for defaults

### Money/Quantities
- All money: `REAL` (floating point)
- Quantities: `REAL` (supports fractional units like kg, L)

## Migration Safety

### Idempotent Migrations

All migrations use `IF NOT EXISTS`:
- Safe to run multiple times
- Won't fail if objects already exist

### Data Migration

No data migration in schema files:
- Seed data in separate seed files
- Schema migrations only create structure

### Index Creation

Indexes created after tables:
- Some indexes depend on table existence
- Safe to recreate if needed






















































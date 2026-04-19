# POS System - ER Summary

## Entity Relationship Overview

### Core Entities
- **users** → user_roles ← **roles**
- **sessions** (linked to users)
- **stores** (optional multi-store support)

### Catalog Entities
- **categories** (self-referencing via parent_id)
- **units**
- **products** (linked to categories, units)

### Inventory Entities
- **warehouses**
- **stock_balances** (product_id + warehouse_id unique)
- **stock_moves** (audit ledger for all stock changes)
- **inventory_adjustments** → inventory_adjustment_items

### Sales Entities
- **orders** → order_items (linked to products)
- **payments** (multiple per order)
- **receipts** (order snapshot)
- **cash_movements** (cash drawer tracking)

### Returns Entities
- **sale_returns** → sale_return_items (linked to order_items)

### Purchase Entities
- **suppliers**
- **purchase_orders** → purchase_order_items (linked to products)
- **goods_receipts** → goods_receipt_items (receiving POs)
- **supplier_payments**

### Customer Entities
- **customers**
- **customer_payments** (for credit customers)

### Expense Entities
- **expense_categories**
- **expenses**

### Shift Entities
- **shifts** (cashier shifts)
- **shift_totals** (aggregated totals)

### System Entities
- **settings** (key-value configuration)
- **audit_log** (action tracking)

## Key Relationships

### Product → Inventory Flow
```
products → stock_balances (current stock per warehouse)
products → stock_moves (history of all changes)
products → inventory_adjustments → inventory_adjustment_items
```

### Sales Flow
```
orders → order_items → products
orders → payments
orders → receipts (snapshot)
orders → cash_movements (if cash payment)
```

### Purchase Flow
```
suppliers → purchase_orders → purchase_order_items → products
purchase_orders → goods_receipts → goods_receipt_items
purchase_orders → supplier_payments
```

### Return Flow
```
orders → sale_returns → sale_return_items → order_items
```

## Business Rules Enforced

1. **Stock Cannot Go Negative**
   - `stock_balances.quantity CHECK(quantity >= 0)`
   - `stock_moves.after_quantity CHECK(after_quantity >= 0)`
   - `inventory_adjustment_items.after_quantity CHECK(after_quantity >= 0)`
   - Configurable via `settings.allow_negative_stock`

2. **Unique Constraints**
   - `products.sku UNIQUE`
   - `products.barcode UNIQUE` (when not NULL)
   - `stock_balances(product_id, warehouse_id) UNIQUE`

3. **Stock Audit Trail**
   - Every stock change must create a `stock_moves` record
   - Includes: before_quantity, after_quantity, reference_type, reference_id

4. **Order Status Flow**
   - Orders: 'hold' → 'completed' → 'cancelled'
   - Purchase Orders: 'draft' → 'approved' → 'partially_received' → 'received'

## Index Strategy

### High-Frequency Queries
- Orders by date: `idx_orders_created_at`
- Stock moves by product: `idx_stock_moves_product`
- Orders by customer: `idx_orders_customer`
- Products by SKU/barcode: `idx_products_sku`, `idx_products_barcode`

### Foreign Key Indexes
- All foreign keys have indexes for join performance
- Composite indexes for common multi-column filters

### Unique Indexes
- Business keys (order_number, po_number, sku, barcode)
- Composite unique constraints (stock_balances)

## Data Integrity

### Foreign Keys
- All foreign keys have `ON DELETE CASCADE` or `ON DELETE RESTRICT` as appropriate
- Order items cascade delete with orders
- Adjustment items cascade delete with adjustments

### Constraints
- CHECK constraints for stock >= 0
- NOT NULL on required fields
- UNIQUE constraints on business keys

### Timestamps
- All tables have `created_at` (ISO string)
- Most tables have `updated_at` (ISO string)
- `datetime('now')` for SQLite default






















































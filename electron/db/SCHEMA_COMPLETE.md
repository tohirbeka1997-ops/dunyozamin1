# Complete SQLite Schema - Migration Files

## Migration Files Overview

The schema is split into 10 logical migration files:

1. **001_core.sql** - Users, roles, sessions, stores
2. **002_catalog.sql** - Categories, units, products
3. **003_inventory.sql** - Warehouses, stock balances, stock moves, adjustments
4. **004_sales.sql** - Orders, order items, payments, receipts, cash movements
5. **005_returns.sql** - Sale returns and return items
6. **006_purchases.sql** - Suppliers, purchase orders, goods receipts, supplier payments
7. **007_expenses.sql** - Expense categories and expenses
8. **008_shifts.sql** - Shifts and shift totals
9. **009_settings.sql** - Settings and audit log
10. **010_customers.sql** - Customers and customer payments

## Table Count

- **Core**: 5 tables (stores, roles, users, user_roles, sessions)
- **Catalog**: 3 tables (categories, units, products)
- **Inventory**: 5 tables (warehouses, stock_balances, stock_moves, inventory_adjustments, inventory_adjustment_items)
- **Sales**: 5 tables (orders, order_items, payments, receipts, cash_movements)
- **Returns**: 2 tables (sale_returns, sale_return_items)
- **Purchases**: 5 tables (suppliers, purchase_orders, purchase_order_items, goods_receipts, goods_receipt_items, supplier_payments)
- **Expenses**: 2 tables (expense_categories, expenses)
- **Shifts**: 2 tables (shifts, shift_totals)
- **Settings**: 2 tables (settings, audit_log)
- **Customers**: 2 tables (customers, customer_payments)

**Total: 33 tables**

## Key Features

### 1. Stock Management
- **stock_balances**: Current stock per product per warehouse
- **stock_moves**: Complete audit trail of all stock changes
- **Non-negative stock**: Enforced via CHECK constraints (configurable)

### 2. Multi-Warehouse Support
- All inventory operations linked to warehouses
- Stock balances tracked per warehouse
- Warehouse-specific reports and operations

### 3. Complete Audit Trail
- **stock_moves**: Every stock change recorded
- **audit_log**: User actions tracked
- **receipts**: Order snapshots for printing

### 4. Flexible Payment Support
- Multiple payments per order
- Multiple payment methods (cash, card, QR, credit)
- Cash movement tracking

### 5. Purchase Management
- Purchase orders with approval workflow
- Goods receipt tracking
- Supplier payment tracking

### 6. Customer Management
- Credit customers supported
- Customer payments tracking
- Customer order history

## Usage

Migrations run automatically on app start via `electron/db/migrate.cjs`:
- Only pending migrations run
- Each migration runs in a transaction
- Tracked in `schema_migrations` table

## Documentation

- **SCHEMA_ER_SUMMARY.md** - Entity relationship overview
- **SCHEMA_CONSTRAINTS_NOTES.md** - Detailed constraints and indexes documentation

## Note on Existing Migration

There is an existing `001_init.sql` file. The new migrations are numbered:
- `001_core.sql` through `010_customers.sql`

The migration runner will execute them in alphabetical order. If you want to use the new schema, you may want to:
1. Archive or remove the old `001_init.sql`
2. Or rename it to `000_init.sql` if you want it to run first
3. Or merge its content into the new migrations

The new schema is comprehensive and replaces the old single-file migration.






















































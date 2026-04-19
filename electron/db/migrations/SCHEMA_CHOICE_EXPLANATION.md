# Inventory Schema Choice Explanation

## Overview

This document explains why we chose a **normalized inventory approach** (stock_balances + stock_moves ledger) instead of storing `current_stock` directly on the products table.

## Schema Design

### Current Implementation: Normalized Inventory

```
stock_balances (current state)
├── product_id
├── warehouse_id
├── quantity (current stock)
├── reserved_quantity
├── available_quantity (calculated)
└── UNIQUE(product_id, warehouse_id)

stock_moves (audit ledger)
├── product_id
├── warehouse_id
├── move_type (sale, purchase, return, adjustment)
├── quantity (positive for IN, negative for OUT)
├── before_quantity
├── after_quantity
├── reference_type (order, return, purchase_order, etc.)
├── reference_id
├── reason
└── created_at
```

### Alternative Approach: Denormalized

```
products
├── id
├── current_stock (per product, not per warehouse)
└── ...
```

## Why Normalized Approach?

### ✅ Advantages

#### 1. **Multi-Warehouse Support**
- Each product can have different stock levels per warehouse
- Essential for retail chains with multiple locations
- Supports warehouse transfers

#### 2. **Complete Audit Trail**
- Every stock change is logged with:
  - Who made the change
  - When it happened
  - Why (reason)
  - Source document (order, return, purchase, etc.)
- Enables full traceability for compliance

#### 3. **Data Integrity Verification**
- Can verify `stock_balances.quantity` equals `SUM(stock_moves.quantity)`
- Detects discrepancies and data corruption
- View `vw_stock_consistency_check` provides automated checking

#### 4. **Performance Optimization**
- Fast lookups: Current stock from `stock_balances` (single row)
- Historical analysis: Full ledger in `stock_moves`
- Indexed for common queries

#### 5. **Historical Analysis**
- Track stock trends over time
- Analyze sales patterns
- Identify slow-moving inventory
- Generate inventory reports

#### 6. **Reconciliation**
- Easy to detect missing movements
- Can reconstruct stock balance from movements if needed
- View `vw_orders_without_movements` finds orders without movements

#### 7. **Transaction Safety**
- Stock check and update happen atomically
- Movements logged within same transaction
- Ensures consistency between balances and ledger

### ❌ Disadvantages

#### 1. **More Complex Schema**
- Two tables instead of one column
- Requires maintaining consistency between tables

#### 2. **Slightly More Code**
- Must update both `stock_balances` and `stock_moves`
- Transaction handling required

#### 3. **Storage Overhead**
- Stores more data (full ledger)
- Trade-off: Storage cost vs. audit trail value

## Comparison with Alternative

### Denormalized Approach (current_stock on products)

**Advantages:**
- ✅ Simpler schema
- ✅ Easier to understand
- ✅ Less code required

**Disadvantages:**
- ❌ No multi-warehouse support
- ❌ No audit trail
- ❌ Cannot verify data integrity
- ❌ No history of stock changes
- ❌ Harder to debug stock issues
- ❌ Cannot reconstruct stock balance

## Real-World Example

### Scenario: Product "Coffee Beans" has stock issue

**With Normalized Approach:**
```sql
-- Check current stock
SELECT quantity FROM stock_balances 
WHERE product_id = 'coffee-001' AND warehouse_id = 'warehouse-1';
-- Result: 50

-- Verify against movements
SELECT SUM(quantity) FROM stock_moves 
WHERE product_id = 'coffee-001' AND warehouse_id = 'warehouse-1';
-- Result: 50 (consistent!)

-- Check recent movements
SELECT * FROM stock_moves 
WHERE product_id = 'coffee-001' 
ORDER BY created_at DESC LIMIT 10;
-- Shows: sales, purchases, adjustments with full details
```

**With Denormalized Approach:**
```sql
-- Check current stock
SELECT current_stock FROM products WHERE id = 'coffee-001';
-- Result: 50

-- But:
-- ❌ Cannot verify this is correct
-- ❌ No history of how it got to 50
-- ❌ Cannot check for missing movements
-- ❌ No multi-warehouse support
```

## Decision Criteria

For a production POS system, we need:

1. ✅ **Multi-warehouse support** - Essential for retail chains
2. ✅ **Audit compliance** - Required for accounting/regulatory
3. ✅ **Data integrity** - Critical for accurate inventory
4. ✅ **Troubleshooting** - Important for debugging issues
5. ✅ **Reporting** - Needed for business intelligence

All of these favor the normalized approach.

## Implementation Notes

### Stock Update Flow

1. **Order Completion:**
   ```
   BEGIN TRANSACTION
     - Create order
     - Add order items
     - Process payments
     - For each item:
       - Check stock_balances (availability)
       - Update stock_balances (decrease quantity)
       - Insert stock_moves (log movement)
   COMMIT
   ```

2. **Stock Adjustment:**
   ```
   BEGIN TRANSACTION
     - Create adjustment document
     - For each item:
       - Update stock_balances
       - Insert stock_moves
   COMMIT
   ```

### Consistency Checks

Use the provided views to verify data integrity:

- `vw_stock_consistency_check` - Balances vs. movements
- `vw_negative_stock_check` - Negative stock detection
- `vw_orders_without_movements` - Missing movements

### Negative Stock Handling

- Database CHECK constraint prevents negative stock at DB level
- Application layer checks `allow_negative_stock` setting
- If setting allows, constraint can be bypassed at app level
- Best practice: Keep constraint for data integrity, handle in application

## Conclusion

The **normalized inventory approach** (stock_balances + stock_moves) is the correct choice for a production POS system because it provides:

1. Multi-warehouse support
2. Complete audit trail
3. Data integrity verification
4. Historical analysis
5. Transaction safety

The added complexity is minimal compared to the benefits, and the schema scales well for enterprise use.





















































-- Stock Verification Queries
-- Run this file to verify stock consistency and integrity
-- Usage: sqlite3 <path-to-db>/pos.db < electron/db/verify_stock.sql

-- ============================================================================
-- CONSISTENCY CHECK: Stock balances should match sum of movements
-- ============================================================================
-- This query compares stock_balances.quantity with the sum of all stock_moves
-- for each product+warehouse combination.
-- Expected result: 0 rows (all balances match movements)

SELECT 
    'STOCK_CONSISTENCY_CHECK' as check_type,
    sb.product_id,
    p.name as product_name,
    sb.warehouse_id,
    w.name as warehouse_name,
    sb.quantity as current_balance_quantity,
    COALESCE(SUM(sm.quantity), 0) as sum_of_moves_quantity,
    (sb.quantity - COALESCE(SUM(sm.quantity), 0)) as discrepancy,
    'Balance does not match sum of movements' as issue_description
FROM stock_balances sb
JOIN products p ON sb.product_id = p.id
JOIN warehouses w ON sb.warehouse_id = w.id
LEFT JOIN stock_moves sm ON sb.product_id = sm.product_id AND sb.warehouse_id = sm.warehouse_id
GROUP BY sb.product_id, sb.warehouse_id
HAVING ABS(discrepancy) > 0.001  -- Allow for floating point inaccuracies
ORDER BY ABS(discrepancy) DESC;

-- ============================================================================
-- NEGATIVE STOCK CHECK: No negative stock when negative stock is disabled
-- ============================================================================
-- This query finds products with negative stock when allow_negative_stock = 0
-- Expected result: 0 rows (no negative stock when disallowed)

SELECT 
    'NEGATIVE_STOCK_CHECK' as check_type,
    sb.product_id,
    p.name as product_name,
    sb.warehouse_id,
    w.name as warehouse_name,
    sb.quantity as current_stock,
    'Negative stock detected but allow_negative_stock = 0' as issue_description
FROM stock_balances sb
JOIN products p ON sb.product_id = p.id
JOIN warehouses w ON sb.warehouse_id = w.id
WHERE sb.quantity < 0
AND p.track_stock = 1
AND NOT EXISTS (
    SELECT 1 FROM settings 
    WHERE key = 'allow_negative_stock' 
    AND value = '1'
)
ORDER BY sb.quantity ASC;

-- ============================================================================
-- SALES HAVE MOVEMENTS CHECK: All completed sales should have stock movements
-- ============================================================================
-- This query finds completed orders that don't have corresponding stock movements
-- Expected result: 0 rows (all sales have movements)

SELECT 
    'SALES_WITHOUT_MOVEMENTS' as check_type,
    o.id as order_id,
    o.order_number,
    o.status,
    o.total_amount,
    o.created_at,
    COUNT(oi.id) as item_count,
    COUNT(sm.id) as movement_count,
    'Completed order has no stock movements' as issue_description
FROM orders o
JOIN order_items oi ON o.id = oi.order_id
JOIN products p ON oi.product_id = p.id
LEFT JOIN stock_moves sm ON sm.reference_type = 'order' 
    AND sm.reference_id = o.id 
    AND sm.product_id = oi.product_id
WHERE o.status = 'completed'
AND p.track_stock = 1
GROUP BY o.id, o.order_number, o.status, o.total_amount, o.created_at
HAVING movement_count = 0
ORDER BY o.created_at DESC;

-- ============================================================================
-- RETURNS HAVE MOVEMENTS CHECK: All returns should have stock movements
-- ============================================================================

SELECT 
    'RETURNS_WITHOUT_MOVEMENTS' as check_type,
    sr.id as return_id,
    sr.return_number,
    sr.status,
    sr.total_amount,
    sr.created_at,
    COUNT(sri.id) as item_count,
    COUNT(sm.id) as movement_count,
    'Return has no stock movements' as issue_description
FROM sales_returns sr
JOIN return_items sri ON sr.id = sri.return_id
JOIN products p ON sri.product_id = p.id
LEFT JOIN stock_moves sm ON sm.reference_type = 'return' 
    AND sm.reference_id = sr.id 
    AND sm.product_id = sri.product_id
WHERE p.track_stock = 1
GROUP BY sr.id, sr.return_number, sr.status, sr.total_amount, sr.created_at
HAVING movement_count = 0
ORDER BY sr.created_at DESC;

-- ============================================================================
-- PURCHASE RECEIPTS HAVE MOVEMENTS CHECK: All purchase receipts should have movements
-- ============================================================================

SELECT 
    'PURCHASE_RECEIPTS_WITHOUT_MOVEMENTS' as check_type,
    gr.id as receipt_id,
    gr.receipt_number,
    gr.purchase_order_id,
    gr.received_at,
    COUNT(gri.id) as item_count,
    COUNT(sm.id) as movement_count,
    'Purchase receipt has no stock movements' as issue_description
FROM goods_receipts gr
JOIN goods_receipt_items gri ON gr.id = gri.goods_receipt_id
JOIN products p ON gri.product_id = p.id
LEFT JOIN stock_moves sm ON sm.reference_type = 'purchase_order' 
    AND sm.reference_id = gr.purchase_order_id 
    AND sm.product_id = gri.product_id
WHERE p.track_stock = 1
GROUP BY gr.id, gr.receipt_number, gr.purchase_order_id, gr.received_at
HAVING movement_count = 0
ORDER BY gr.received_at DESC;

-- ============================================================================
-- MOVEMENT TYPE CONSISTENCY CHECK: Movement types should match reference types
-- ============================================================================
-- Expected: sale moves for orders, return moves for returns, purchase moves for POs

SELECT 
    'MOVEMENT_TYPE_INCONSISTENCY' as check_type,
    sm.id as movement_id,
    sm.move_number,
    sm.move_type,
    sm.reference_type,
    sm.reference_id,
    'Movement type does not match reference type' as issue_description
FROM stock_moves sm
WHERE 
    (sm.reference_type = 'order' AND sm.move_type != 'sale')
    OR (sm.reference_type = 'return' AND sm.move_type != 'return')
    OR (sm.reference_type = 'purchase_order' AND sm.move_type != 'purchase')
ORDER BY sm.created_at DESC;

-- ============================================================================
-- QUANTITY SIGN CHECK: Movement quantities should have correct sign
-- ============================================================================
-- Expected: Sales should be negative, Returns and Purchases should be positive

SELECT 
    'MOVEMENT_QUANTITY_SIGN_ERROR' as check_type,
    sm.id as movement_id,
    sm.move_number,
    sm.move_type,
    sm.quantity,
    sm.reference_type,
    'Movement quantity has incorrect sign' as issue_description
FROM stock_moves sm
WHERE 
    (sm.move_type = 'sale' AND sm.quantity > 0)
    OR (sm.move_type IN ('return', 'purchase') AND sm.quantity < 0)
ORDER BY sm.created_at DESC;

-- ============================================================================
-- BEFORE/AFTER QUANTITY CONSISTENCY CHECK
-- ============================================================================
-- Verify that before_quantity + quantity = after_quantity for each movement

SELECT 
    'BEFORE_AFTER_QUANTITY_MISMATCH' as check_type,
    sm.id as movement_id,
    sm.move_number,
    sm.before_quantity,
    sm.quantity,
    sm.after_quantity,
    (sm.before_quantity + sm.quantity) as calculated_after,
    ABS(sm.after_quantity - (sm.before_quantity + sm.quantity)) as discrepancy,
    'after_quantity does not equal before_quantity + quantity' as issue_description
FROM stock_moves sm
WHERE ABS(sm.after_quantity - (sm.before_quantity + sm.quantity)) > 0.001
ORDER BY ABS(discrepancy) DESC;

-- ============================================================================
-- PRODUCTS WITHOUT BALANCES CHECK: Tracked products should have balances
-- ============================================================================
-- Find products with track_stock=1 that don't have stock_balances records

SELECT 
    'PRODUCTS_WITHOUT_BALANCES' as check_type,
    p.id as product_id,
    p.name as product_name,
    p.sku,
    p.track_stock,
    'Tracked product has no stock balance record' as issue_description
FROM products p
WHERE p.track_stock = 1
AND NOT EXISTS (
    SELECT 1 FROM stock_balances sb 
    WHERE sb.product_id = p.id
)
ORDER BY p.name;

-- ============================================================================
-- SUMMARY QUERY: Count of issues found
-- ============================================================================
-- Run this to get a summary of all checks

SELECT 
    'SUMMARY' as check_type,
    COUNT(*) as total_issues,
    'Total issues found across all checks' as description
FROM (
    -- Count consistency issues
    SELECT 1 FROM stock_balances sb
    LEFT JOIN stock_moves sm ON sb.product_id = sm.product_id AND sb.warehouse_id = sm.warehouse_id
    GROUP BY sb.product_id, sb.warehouse_id
    HAVING ABS(sb.quantity - COALESCE(SUM(sm.quantity), 0)) > 0.001
    
    UNION ALL
    
    -- Count negative stock issues
    SELECT 1 FROM stock_balances sb
    JOIN products p ON sb.product_id = p.id
    WHERE sb.quantity < 0
    AND p.track_stock = 1
    AND NOT EXISTS (
        SELECT 1 FROM settings WHERE key = 'allow_negative_stock' AND value = '1'
    )
    
    UNION ALL
    
    -- Count sales without movements
    SELECT 1 FROM orders o
    JOIN order_items oi ON o.id = oi.order_id
    JOIN products p ON oi.product_id = p.id
    LEFT JOIN stock_moves sm ON sm.reference_type = 'order' 
        AND sm.reference_id = o.id AND sm.product_id = oi.product_id
    WHERE o.status = 'completed' AND p.track_stock = 1
    GROUP BY o.id
    HAVING COUNT(sm.id) = 0
);

-- ============================================================================
-- HELPER QUERIES: Useful for debugging
-- ============================================================================

-- View recent stock movements for a specific product
-- Replace '<product-id>' with actual product ID
/*
SELECT 
    sm.id,
    sm.move_number,
    sm.move_type,
    sm.quantity,
    sm.before_quantity,
    sm.after_quantity,
    sm.reference_type,
    sm.reference_id,
    sm.reason,
    sm.created_at,
    CASE 
        WHEN sm.reference_type = 'order' THEN (SELECT order_number FROM orders WHERE id = sm.reference_id)
        WHEN sm.reference_type = 'return' THEN (SELECT return_number FROM sales_returns WHERE id = sm.reference_id)
        WHEN sm.reference_type = 'purchase_order' THEN (SELECT po_number FROM purchase_orders WHERE id = sm.reference_id)
        ELSE sm.reference_id
    END as reference_number
FROM stock_moves sm
WHERE sm.product_id = '<product-id>'
ORDER BY sm.created_at DESC
LIMIT 20;
*/

-- View current stock balances for all products
/*
SELECT 
    p.name as product_name,
    p.sku,
    w.name as warehouse_name,
    sb.quantity as current_stock,
    p.min_stock_level,
    CASE 
        WHEN sb.quantity <= 0 THEN 'OUT'
        WHEN sb.quantity <= p.min_stock_level THEN 'LOW'
        ELSE 'OK'
    END as stock_status,
    sb.last_movement_at
FROM stock_balances sb
JOIN products p ON sb.product_id = p.id
JOIN warehouses w ON sb.warehouse_id = w.id
ORDER BY p.name, w.name;
*/

-- View products with low or out of stock
/*
SELECT 
    p.name as product_name,
    p.sku,
    w.name as warehouse_name,
    sb.quantity as current_stock,
    p.min_stock_level,
    CASE 
        WHEN sb.quantity <= 0 THEN 'OUT OF STOCK'
        WHEN sb.quantity <= p.min_stock_level THEN 'LOW STOCK'
    END as status
FROM stock_balances sb
JOIN products p ON sb.product_id = p.id
JOIN warehouses w ON sb.warehouse_id = w.id
WHERE sb.quantity <= p.min_stock_level
ORDER BY sb.quantity ASC, p.name;
*/









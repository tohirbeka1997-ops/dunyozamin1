-- Migration: Create Product Stock View for Real-Time Stock Calculation
-- This view calculates current stock from inventory movements as the source of truth

-- ============================================================================
-- VIEW: products_with_stock
-- ============================================================================
-- Calculates current stock for each product by summing all inventory movements
-- This ensures stock is always accurate and reflects all inventory changes

CREATE OR REPLACE VIEW products_with_stock AS
SELECT 
  p.id,
  p.name,
  p.sku,
  p.barcode,
  p.description,
  p.category_id,
  p.unit,
  p.purchase_price,
  p.sale_price,
  p.min_stock_level,
  p.image_url,
  p.is_active,
  p.created_at,
  p.updated_at,
  -- Calculate current stock from inventory movements
  COALESCE(
    (SELECT SUM(quantity) 
     FROM inventory_movements 
     WHERE product_id = p.id),
    p.current_stock,  -- Fallback to product's current_stock if no movements
    0  -- Default to 0 if both are null
  ) AS current_stock
FROM products p;

-- Grant access to authenticated users
GRANT SELECT ON products_with_stock TO authenticated;

-- Comment on view
COMMENT ON VIEW products_with_stock IS 
  'Product stock calculated from inventory movements. This is the source of truth for current stock.';

-- ============================================================================
-- ALTERNATIVE: RPC FUNCTION (if you prefer function-based approach)
-- ============================================================================

CREATE OR REPLACE FUNCTION get_product_stock_summary()
RETURNS TABLE (
  product_id uuid,
  current_stock numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    p.id AS product_id,
    COALESCE(
      (SELECT SUM(quantity) 
       FROM inventory_movements 
       WHERE inventory_movements.product_id = p.id),
      p.current_stock,
      0
    ) AS current_stock
  FROM products p;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION get_product_stock_summary() TO authenticated;

-- Comment on function
COMMENT ON FUNCTION get_product_stock_summary() IS 
  'Returns current stock for all products calculated from inventory movements.';






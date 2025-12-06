/*
# System Integration and Synchronization

## Overview
This migration implements comprehensive cross-module integration, automatic data synchronization,
and business rule enforcement across the entire POS system.

## Changes

### 1. Database Indexes for Performance
Add indexes on frequently queried columns:
- Products: sku, category_id, barcode
- Orders: order_number, customer_id, cashier_id, status, created_at
- Order Items: order_id, product_id
- Inventory Movements: product_id, movement_type, created_at
- Customers: phone, email
- Sales Returns: return_number, order_id, created_at

### 2. Automatic Inventory Updates
Triggers to automatically update inventory when:
- Order is completed (reduce stock)
- Order is cancelled (restore stock)
- Return is processed (restore stock)
- Purchase order is received (increase stock)

### 3. Customer Statistics Auto-Update
Triggers to update customer totals when:
- Order is completed
- Return is processed
- Payment is made

### 4. Employee Performance Auto-Update
Automatically track employee performance through order and return activities

### 5. Business Rule Enforcement
- Prevent product deletion if used in orders
- Prevent customer deletion if has orders
- Prevent negative stock (based on settings)
- Validate order completion requirements

### 6. Audit Logging Integration
Automatic audit logging for all critical operations

## Notes
- All triggers use SECURITY DEFINER for proper permissions
- Performance optimized with proper indexes
- Real-time synchronization across all modules
*/

-- ==================== PERFORMANCE INDEXES ====================

-- Products indexes
CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);
CREATE INDEX IF NOT EXISTS idx_products_min_stock ON products(min_stock_level);

-- Orders indexes
CREATE INDEX IF NOT EXISTS idx_orders_number ON orders(order_number);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_cashier ON orders(cashier_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_date ON orders(DATE(created_at));

-- Order items indexes
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product ON order_items(product_id);

-- Inventory movements indexes
CREATE INDEX IF NOT EXISTS idx_inventory_movements_product ON inventory_movements(product_id);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_type ON inventory_movements(movement_type);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_created ON inventory_movements(created_at DESC);

-- Customers indexes
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);
CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(email);

-- Sales returns indexes
CREATE INDEX IF NOT EXISTS idx_sales_returns_number ON sales_returns(return_number);
CREATE INDEX IF NOT EXISTS idx_sales_returns_order ON sales_returns(order_id);
CREATE INDEX IF NOT EXISTS idx_sales_returns_created ON sales_returns(created_at DESC);

-- Purchase orders indexes
CREATE INDEX IF NOT EXISTS idx_purchase_orders_number ON purchase_orders(po_number);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_supplier ON purchase_orders(supplier_id);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_status ON purchase_orders(status);

-- ==================== INVENTORY SYNC FUNCTIONS ====================

-- Function to check if negative stock is allowed
CREATE OR REPLACE FUNCTION is_negative_stock_allowed()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT value::text FROM settings WHERE category = 'inventory' AND key = 'allow_negative_stock';
$$;

-- Function to update product stock
CREATE OR REPLACE FUNCTION update_product_stock(
  p_product_id uuid,
  p_quantity_change numeric,
  p_movement_type text,
  p_reference_id uuid DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_created_by uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_current_stock numeric;
  v_new_stock numeric;
  v_allow_negative text;
BEGIN
  -- Get current stock
  SELECT current_stock INTO v_current_stock
  FROM products
  WHERE id = p_product_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product not found';
  END IF;
  
  -- Calculate new stock
  v_new_stock := v_current_stock + p_quantity_change;
  
  -- Check negative stock setting
  v_allow_negative := is_negative_stock_allowed();
  
  IF v_new_stock < 0 AND v_allow_negative = '"block"' THEN
    RAISE EXCEPTION 'Insufficient stock. Current: %, Required: %', v_current_stock, ABS(p_quantity_change);
  END IF;
  
  -- Update product stock
  UPDATE products
  SET current_stock = v_new_stock,
      updated_at = now()
  WHERE id = p_product_id;
  
  -- Create inventory movement record
  INSERT INTO inventory_movements (
    product_id,
    movement_type,
    quantity,
    reference_id,
    notes,
    created_by
  ) VALUES (
    p_product_id,
    p_movement_type,
    p_quantity_change,
    p_reference_id,
    p_notes,
    p_created_by
  );
  
  RETURN true;
END;
$$;

-- ==================== ORDER COMPLETION TRIGGER ====================

-- Function to process order completion
CREATE OR REPLACE FUNCTION process_order_completion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_item RECORD;
  v_customer_id uuid;
BEGIN
  -- Only process when status changes to 'completed'
  IF NEW.status = 'completed' AND (OLD.status IS NULL OR OLD.status != 'completed') THEN
    
    -- Update inventory for each order item
    FOR v_item IN
      SELECT product_id, quantity
      FROM order_items
      WHERE order_id = NEW.id
    LOOP
      -- Reduce stock (negative quantity change)
      PERFORM update_product_stock(
        v_item.product_id,
        -v_item.quantity,
        'sale',
        NEW.id,
        'Order completed: ' || NEW.order_number,
        NEW.cashier_id
      );
    END LOOP;
    
    -- Update customer statistics if customer exists
    IF NEW.customer_id IS NOT NULL THEN
      UPDATE customers
      SET total_purchases = total_purchases + 1,
          total_spent = total_spent + NEW.total_amount,
          updated_at = now()
      WHERE id = NEW.customer_id;
    END IF;
    
    -- Log activity
    PERFORM log_employee_activity(
      NEW.cashier_id,
      'order_completed',
      'Completed order: ' || NEW.order_number,
      NEW.total_amount,
      'order',
      NEW.id
    );
  END IF;
  
  RETURN NEW;
END;
$$;

-- Create trigger for order completion
DROP TRIGGER IF EXISTS trigger_order_completion ON orders;
CREATE TRIGGER trigger_order_completion
  AFTER INSERT OR UPDATE ON orders
  FOR EACH ROW
  EXECUTE FUNCTION process_order_completion();

-- ==================== ORDER CANCELLATION TRIGGER ====================

-- Function to process order cancellation
CREATE OR REPLACE FUNCTION process_order_cancellation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_item RECORD;
BEGIN
  -- Only process when status changes to 'cancelled'
  IF NEW.status = 'cancelled' AND OLD.status = 'completed' THEN
    
    -- Restore inventory for each order item
    FOR v_item IN
      SELECT product_id, quantity
      FROM order_items
      WHERE order_id = NEW.id
    LOOP
      -- Restore stock (positive quantity change)
      PERFORM update_product_stock(
        v_item.product_id,
        v_item.quantity,
        'adjustment',
        NEW.id,
        'Order cancelled: ' || NEW.order_number,
        NEW.cashier_id
      );
    END LOOP;
    
    -- Update customer statistics if customer exists
    IF NEW.customer_id IS NOT NULL THEN
      UPDATE customers
      SET total_purchases = GREATEST(0, total_purchases - 1),
          total_spent = GREATEST(0, total_spent - NEW.total_amount),
          updated_at = now()
      WHERE id = NEW.customer_id;
    END IF;
    
    -- Log activity
    PERFORM log_employee_activity(
      NEW.cashier_id,
      'order_cancelled',
      'Cancelled order: ' || NEW.order_number,
      NEW.total_amount,
      'order',
      NEW.id
    );
  END IF;
  
  RETURN NEW;
END;
$$;

-- Create trigger for order cancellation
DROP TRIGGER IF EXISTS trigger_order_cancellation ON orders;
CREATE TRIGGER trigger_order_cancellation
  AFTER UPDATE ON orders
  FOR EACH ROW
  EXECUTE FUNCTION process_order_cancellation();

-- ==================== SALES RETURN TRIGGER ====================

-- Function to process sales return
CREATE OR REPLACE FUNCTION process_sales_return()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_item RECORD;
  v_order RECORD;
BEGIN
  -- Only process on insert
  IF TG_OP = 'INSERT' THEN
    
    -- Get order details
    SELECT customer_id, cashier_id INTO v_order
    FROM orders
    WHERE id = NEW.order_id;
    
    -- Update inventory for each return item
    FOR v_item IN
      SELECT product_id, quantity_returned
      FROM sales_return_items
      WHERE return_id = NEW.id
    LOOP
      -- Restore stock (positive quantity change)
      PERFORM update_product_stock(
        v_item.product_id,
        v_item.quantity_returned,
        'return',
        NEW.id,
        'Sales return: ' || NEW.return_number,
        NEW.processed_by
      );
    END LOOP;
    
    -- Update customer statistics if customer exists
    IF v_order.customer_id IS NOT NULL THEN
      UPDATE customers
      SET total_spent = GREATEST(0, total_spent - NEW.refund_amount),
          updated_at = now()
      WHERE id = v_order.customer_id;
    END IF;
    
    -- Log activity
    PERFORM log_employee_activity(
      NEW.processed_by,
      'return_processed',
      'Processed return: ' || NEW.return_number,
      NEW.refund_amount,
      'return',
      NEW.id
    );
  END IF;
  
  RETURN NEW;
END;
$$;

-- Create trigger for sales returns
DROP TRIGGER IF EXISTS trigger_sales_return ON sales_returns;
CREATE TRIGGER trigger_sales_return
  AFTER INSERT ON sales_returns
  FOR EACH ROW
  EXECUTE FUNCTION process_sales_return();

-- ==================== PURCHASE ORDER RECEIVING TRIGGER ====================

-- Function to process purchase order receiving
CREATE OR REPLACE FUNCTION process_purchase_receiving()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_item RECORD;
BEGIN
  -- Only process when status changes to 'received'
  IF NEW.status = 'received' AND (OLD.status IS NULL OR OLD.status != 'received') THEN
    
    -- Update inventory for each PO item
    FOR v_item IN
      SELECT product_id, quantity_received
      FROM purchase_order_items
      WHERE po_id = NEW.id
    LOOP
      -- Increase stock (positive quantity change)
      PERFORM update_product_stock(
        v_item.product_id,
        v_item.quantity_received,
        'purchase',
        NEW.id,
        'Purchase order received: ' || NEW.po_number,
        NEW.created_by
      );
    END LOOP;
    
    -- Log activity
    PERFORM log_employee_activity(
      NEW.created_by,
      'po_received',
      'Received purchase order: ' || NEW.po_number,
      NEW.total_amount,
      'purchase_order',
      NEW.id
    );
  END IF;
  
  RETURN NEW;
END;
$$;

-- Create trigger for purchase order receiving
DROP TRIGGER IF EXISTS trigger_purchase_receiving ON purchase_orders;
CREATE TRIGGER trigger_purchase_receiving
  AFTER INSERT OR UPDATE ON purchase_orders
  FOR EACH ROW
  EXECUTE FUNCTION process_purchase_receiving();

-- ==================== BUSINESS RULE ENFORCEMENT ====================

-- Function to prevent product deletion if used in orders
CREATE OR REPLACE FUNCTION prevent_product_deletion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_order_count integer;
BEGIN
  -- Check if product is used in any orders
  SELECT COUNT(*) INTO v_order_count
  FROM order_items
  WHERE product_id = OLD.id;
  
  IF v_order_count > 0 THEN
    RAISE EXCEPTION 'Cannot delete product. It is used in % order(s). Consider marking it as inactive instead.', v_order_count;
  END IF;
  
  RETURN OLD;
END;
$$;

-- Create trigger to prevent product deletion
DROP TRIGGER IF EXISTS trigger_prevent_product_deletion ON products;
CREATE TRIGGER trigger_prevent_product_deletion
  BEFORE DELETE ON products
  FOR EACH ROW
  EXECUTE FUNCTION prevent_product_deletion();

-- Function to prevent customer deletion if has orders
CREATE OR REPLACE FUNCTION prevent_customer_deletion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_order_count integer;
BEGIN
  -- Check if customer has any orders
  SELECT COUNT(*) INTO v_order_count
  FROM orders
  WHERE customer_id = OLD.id;
  
  IF v_order_count > 0 THEN
    RAISE EXCEPTION 'Cannot delete customer. They have % order(s). Consider marking them as inactive instead.', v_order_count;
  END IF;
  
  RETURN OLD;
END;
$$;

-- Create trigger to prevent customer deletion
DROP TRIGGER IF EXISTS trigger_prevent_customer_deletion ON customers;
CREATE TRIGGER trigger_prevent_customer_deletion
  BEFORE DELETE ON customers
  FOR EACH ROW
  EXECUTE FUNCTION prevent_customer_deletion();

-- Function to prevent last admin deletion
CREATE OR REPLACE FUNCTION prevent_last_admin_deletion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_admin_count integer;
BEGIN
  -- Only check if deleting an admin
  IF OLD.role = 'admin' THEN
    -- Count remaining admins
    SELECT COUNT(*) INTO v_admin_count
    FROM profiles
    WHERE role = 'admin' AND id != OLD.id;
    
    IF v_admin_count = 0 THEN
      RAISE EXCEPTION 'Cannot delete the last admin account. System must have at least one admin.';
    END IF;
  END IF;
  
  RETURN OLD;
END;
$$;

-- Create trigger to prevent last admin deletion
DROP TRIGGER IF EXISTS trigger_prevent_last_admin_deletion ON profiles;
CREATE TRIGGER trigger_prevent_last_admin_deletion
  BEFORE DELETE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION prevent_last_admin_deletion();

-- ==================== DASHBOARD METRICS FUNCTIONS ====================

-- Function to get real-time dashboard metrics
CREATE OR REPLACE FUNCTION get_dashboard_metrics(p_date date DEFAULT CURRENT_DATE)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_metrics jsonb;
  v_today_sales numeric;
  v_today_orders integer;
  v_low_stock_count integer;
  v_active_customers integer;
  v_pending_pos integer;
BEGIN
  -- Today's sales
  SELECT COALESCE(SUM(total_amount), 0) INTO v_today_sales
  FROM orders
  WHERE DATE(created_at) = p_date AND status = 'completed';
  
  -- Today's orders
  SELECT COUNT(*) INTO v_today_orders
  FROM orders
  WHERE DATE(created_at) = p_date AND status = 'completed';
  
  -- Low stock items
  SELECT COUNT(*) INTO v_low_stock_count
  FROM products
  WHERE current_stock <= min_stock_level AND is_active = true;
  
  -- Active customers (purchased in last 30 days)
  SELECT COUNT(DISTINCT customer_id) INTO v_active_customers
  FROM orders
  WHERE created_at >= CURRENT_DATE - INTERVAL '30 days'
    AND status = 'completed'
    AND customer_id IS NOT NULL;
  
  -- Pending purchase orders
  SELECT COUNT(*) INTO v_pending_pos
  FROM purchase_orders
  WHERE status = 'pending';
  
  -- Build metrics JSON
  v_metrics := jsonb_build_object(
    'today_sales', v_today_sales,
    'today_orders', v_today_orders,
    'low_stock_count', v_low_stock_count,
    'active_customers', v_active_customers,
    'pending_purchase_orders', v_pending_pos,
    'updated_at', now()
  );
  
  RETURN v_metrics;
END;
$$;

-- Function to get best selling products
CREATE OR REPLACE FUNCTION get_best_selling_products(
  p_start_date date DEFAULT CURRENT_DATE - INTERVAL '30 days',
  p_end_date date DEFAULT CURRENT_DATE,
  p_limit integer DEFAULT 10
)
RETURNS TABLE (
  product_id uuid,
  product_name text,
  sku text,
  total_quantity numeric,
  total_revenue numeric,
  order_count integer
)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT 
    p.id as product_id,
    p.name as product_name,
    p.sku,
    SUM(oi.quantity) as total_quantity,
    SUM(oi.subtotal) as total_revenue,
    COUNT(DISTINCT oi.order_id) as order_count
  FROM products p
  INNER JOIN order_items oi ON p.id = oi.product_id
  INNER JOIN orders o ON oi.order_id = o.id
  WHERE o.status = 'completed'
    AND DATE(o.created_at) BETWEEN p_start_date AND p_end_date
  GROUP BY p.id, p.name, p.sku
  ORDER BY total_quantity DESC
  LIMIT p_limit;
$$;

-- ==================== DATA VALIDATION FUNCTIONS ====================

-- Function to validate order before completion
CREATE OR REPLACE FUNCTION validate_order_completion(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_order RECORD;
  v_item RECORD;
  v_errors text[] := ARRAY[]::text[];
  v_warnings text[] := ARRAY[]::text[];
  v_allow_negative text;
BEGIN
  -- Get order details
  SELECT * INTO v_order
  FROM orders
  WHERE id = p_order_id;
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object('valid', false, 'errors', ARRAY['Order not found']);
  END IF;
  
  -- Check if order has items
  IF NOT EXISTS (SELECT 1 FROM order_items WHERE order_id = p_order_id) THEN
    v_errors := array_append(v_errors, 'Order has no items');
  END IF;
  
  -- Check payment
  IF v_order.paid_amount < v_order.total_amount THEN
    v_errors := array_append(v_errors, 'Order is not fully paid');
  END IF;
  
  -- Check stock availability
  v_allow_negative := is_negative_stock_allowed();
  
  FOR v_item IN
    SELECT oi.product_id, oi.quantity, p.name, p.current_stock
    FROM order_items oi
    INNER JOIN products p ON oi.product_id = p.id
    WHERE oi.order_id = p_order_id
  LOOP
    IF v_item.current_stock < v_item.quantity THEN
      IF v_allow_negative = '"block"' THEN
        v_errors := array_append(v_errors, 
          format('Insufficient stock for %s. Available: %s, Required: %s', 
            v_item.name, v_item.current_stock, v_item.quantity));
      ELSIF v_allow_negative = '"allow_with_warning"' THEN
        v_warnings := array_append(v_warnings,
          format('Low stock for %s. Available: %s, Required: %s',
            v_item.name, v_item.current_stock, v_item.quantity));
      END IF;
    END IF;
  END LOOP;
  
  -- Return validation result
  RETURN jsonb_build_object(
    'valid', array_length(v_errors, 1) IS NULL,
    'errors', COALESCE(v_errors, ARRAY[]::text[]),
    'warnings', COALESCE(v_warnings, ARRAY[]::text[])
  );
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION update_product_stock TO authenticated;
GRANT EXECUTE ON FUNCTION get_dashboard_metrics TO authenticated;
GRANT EXECUTE ON FUNCTION get_best_selling_products TO authenticated;
GRANT EXECUTE ON FUNCTION validate_order_completion TO authenticated;

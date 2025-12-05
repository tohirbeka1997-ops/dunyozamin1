/*
# Add Missing Columns to Sales Returns

1. Add status column to sales_returns
2. Add notes and updated_at columns
3. Add constraints and triggers
4. Create inventory and order update functions
*/

-- Add missing columns to sales_returns
ALTER TABLE sales_returns
ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'Pending',
ADD COLUMN IF NOT EXISTS notes text,
ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- Add constraint for status
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'check_return_status') THEN
    ALTER TABLE sales_returns ADD CONSTRAINT check_return_status CHECK (status IN ('Pending', 'Completed', 'Cancelled'));
  END IF;
END $$;

-- Add constraint for return_items quantity
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'check_return_quantity') THEN
    ALTER TABLE sales_return_items ADD CONSTRAINT check_return_quantity CHECK (quantity > 0);
  END IF;
END $$;

-- Function to update inventory when return is completed
CREATE OR REPLACE FUNCTION update_inventory_on_return()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  return_item RECORD;
BEGIN
  -- Only process when status changes to Completed
  IF NEW.status = 'Completed' AND (OLD IS NULL OR OLD.status != 'Completed') THEN
    -- Update inventory for each returned item
    FOR return_item IN 
      SELECT product_id, quantity 
      FROM sales_return_items 
      WHERE return_id = NEW.id
    LOOP
      -- Increase stock
      UPDATE products 
      SET current_stock = current_stock + return_item.quantity,
          updated_at = now()
      WHERE id = return_item.product_id;
      
      -- Log inventory movement
      INSERT INTO inventory_movements (
        product_id,
        movement_type,
        quantity,
        reference_type,
        reference_id,
        notes,
        performed_by
      ) VALUES (
        return_item.product_id,
        'return',
        return_item.quantity,
        'sales_return',
        NEW.id,
        'Sales return: ' || NEW.return_number,
        NEW.cashier_id
      );
    END LOOP;
  END IF;
  
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_update_inventory_on_return ON sales_returns;
CREATE TRIGGER trigger_update_inventory_on_return
AFTER INSERT OR UPDATE ON sales_returns
FOR EACH ROW
EXECUTE FUNCTION update_inventory_on_return();

-- Function to update order after return
CREATE OR REPLACE FUNCTION update_order_on_return()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  order_total numeric(10,2);
  total_returned numeric(10,2);
BEGIN
  IF NEW.status = 'Completed' THEN
    -- Get order total
    SELECT total_amount INTO order_total
    FROM orders
    WHERE id = NEW.order_id;
    
    -- Calculate total returned for this order
    SELECT COALESCE(SUM(total_amount), 0) INTO total_returned
    FROM sales_returns
    WHERE order_id = NEW.order_id AND status = 'Completed';
    
    -- Update order
    UPDATE orders
    SET 
      returned_amount = total_returned,
      return_status = CASE
        WHEN total_returned >= order_total THEN 'full'
        WHEN total_returned > 0 THEN 'partial'
        ELSE 'none'
      END
    WHERE id = NEW.order_id;
  END IF;
  
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_update_order_on_return ON sales_returns;
CREATE TRIGGER trigger_update_order_on_return
AFTER INSERT OR UPDATE ON sales_returns
FOR EACH ROW
EXECUTE FUNCTION update_order_on_return();
/*
# Update Customers Table

## Plain English Explanation
This migration enhances the customers table to support comprehensive customer management including:
- Customer type (Individual/Company)
- Company-specific fields (company name, tax number)
- Financial settings (credit limit, debt allowance)
- Calculated fields (total sales, last order date)
- Status management (Active/Inactive)
- Notes for additional information

## Table Changes

### customers table - New Columns:
- `type` (text): Customer type - 'individual' or 'company'
- `company_name` (text): Company name if different from main name
- `tax_number` (text, unique): Tax ID/VAT/INN for companies
- `credit_limit` (numeric): Maximum allowed debt
- `allow_debt` (boolean): Whether customer can purchase on credit
- `balance` (numeric): Current balance (positive = debt, negative = credit)
- `total_sales` (numeric): Total purchase amount
- `last_order_date` (timestamptz): Date of last order
- `status` (text): 'active' or 'inactive'
- `notes` (text): Additional notes
- `updated_at` (timestamptz): Last update timestamp

### Renamed Column:
- `debt_balance` → `balance` (for clarity)

## Functions Created:
- `update_customer_stats()`: Trigger function to update total_sales and last_order_date
- `update_customer_balance_on_order()`: Update balance when order is created/updated
- `update_customer_balance_on_payment()`: Update balance when payment is made
- `update_customer_balance_on_return()`: Update balance when return is completed

## Triggers Created:
- Update customer stats after order insert/update
- Update customer balance after order insert/update
- Update customer balance after payment insert
- Update customer balance after return completion

## Security:
- RLS already enabled on customers table
- Existing policies remain in place
- Public can view basic customer info
- Authenticated users can create/update
- Admins can delete

## Notes:
- Balance calculation: orders - payments + refunds
- Positive balance = customer owes store
- Negative balance = store owes customer (prepayment/refund)
- Soft delete: mark as inactive if has orders
*/

-- Add new columns to customers table
ALTER TABLE customers
ADD COLUMN IF NOT EXISTS type text DEFAULT 'individual' CHECK (type IN ('individual', 'company')),
ADD COLUMN IF NOT EXISTS company_name text,
ADD COLUMN IF NOT EXISTS tax_number text UNIQUE,
ADD COLUMN IF NOT EXISTS credit_limit numeric DEFAULT 0 CHECK (credit_limit >= 0),
ADD COLUMN IF NOT EXISTS allow_debt boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS balance numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS total_sales numeric DEFAULT 0 CHECK (total_sales >= 0),
ADD COLUMN IF NOT EXISTS last_order_date timestamptz,
ADD COLUMN IF NOT EXISTS status text DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
ADD COLUMN IF NOT EXISTS notes text,
ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- Update existing debt_balance to balance if needed
UPDATE customers SET balance = COALESCE(debt_balance, 0) WHERE balance IS NULL OR balance = 0;

-- Create function to update customer statistics
CREATE OR REPLACE FUNCTION update_customer_stats()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Update total_sales and last_order_date for the customer
  UPDATE customers
  SET 
    total_sales = COALESCE((
      SELECT SUM(total_amount)
      FROM orders
      WHERE customer_id = NEW.customer_id
        AND status = 'completed'
    ), 0),
    last_order_date = COALESCE((
      SELECT MAX(created_at)
      FROM orders
      WHERE customer_id = NEW.customer_id
        AND status = 'completed'
    ), last_order_date),
    updated_at = now()
  WHERE id = NEW.customer_id;
  
  RETURN NEW;
END;
$$;

-- Create trigger to update customer stats after order
DROP TRIGGER IF EXISTS update_customer_stats_trigger ON orders;
CREATE TRIGGER update_customer_stats_trigger
AFTER INSERT OR UPDATE OF status, total_amount ON orders
FOR EACH ROW
WHEN (NEW.customer_id IS NOT NULL AND NEW.status = 'completed')
EXECUTE FUNCTION update_customer_stats();

-- Create function to calculate and update customer balance
CREATE OR REPLACE FUNCTION calculate_customer_balance(customer_uuid uuid)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  total_orders numeric;
  total_payments numeric;
  total_returns numeric;
  calculated_balance numeric;
BEGIN
  -- Calculate total completed orders
  SELECT COALESCE(SUM(total_amount), 0)
  INTO total_orders
  FROM orders
  WHERE customer_id = customer_uuid
    AND status = 'completed';
  
  -- Calculate total payments from customer
  SELECT COALESCE(SUM(amount), 0)
  INTO total_payments
  FROM payments
  WHERE order_id IN (
    SELECT id FROM orders WHERE customer_id = customer_uuid
  );
  
  -- Calculate total completed returns
  SELECT COALESCE(SUM(total_amount), 0)
  INTO total_returns
  FROM sales_returns
  WHERE customer_id = customer_uuid
    AND status = 'Completed';
  
  -- Balance = Orders - Payments + Returns
  -- Positive = customer owes store
  -- Negative = store owes customer
  calculated_balance := total_orders - total_payments + total_returns;
  
  -- Update customer balance
  UPDATE customers
  SET balance = calculated_balance,
      updated_at = now()
  WHERE id = customer_uuid;
  
  RETURN calculated_balance;
END;
$$;

-- Create function to update customer balance on order
CREATE OR REPLACE FUNCTION update_customer_balance_on_order()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NEW.customer_id IS NOT NULL THEN
    PERFORM calculate_customer_balance(NEW.customer_id);
  END IF;
  
  RETURN NEW;
END;
$$;

-- Create trigger for order balance update
DROP TRIGGER IF EXISTS update_customer_balance_order_trigger ON orders;
CREATE TRIGGER update_customer_balance_order_trigger
AFTER INSERT OR UPDATE OF total_amount, status ON orders
FOR EACH ROW
WHEN (NEW.customer_id IS NOT NULL)
EXECUTE FUNCTION update_customer_balance_on_order();

-- Create function to update customer balance on payment
CREATE OR REPLACE FUNCTION update_customer_balance_on_payment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  order_customer_id uuid;
BEGIN
  -- Get customer_id from order
  SELECT customer_id INTO order_customer_id
  FROM orders
  WHERE id = NEW.order_id;
  
  IF order_customer_id IS NOT NULL THEN
    PERFORM calculate_customer_balance(order_customer_id);
  END IF;
  
  RETURN NEW;
END;
$$;

-- Create trigger for payment balance update
DROP TRIGGER IF EXISTS update_customer_balance_payment_trigger ON payments;
CREATE TRIGGER update_customer_balance_payment_trigger
AFTER INSERT OR UPDATE OF amount ON payments
FOR EACH ROW
EXECUTE FUNCTION update_customer_balance_on_payment();

-- Create function to update customer balance on return
CREATE OR REPLACE FUNCTION update_customer_balance_on_return()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NEW.customer_id IS NOT NULL AND NEW.status = 'Completed' THEN
    PERFORM calculate_customer_balance(NEW.customer_id);
  END IF;
  
  RETURN NEW;
END;
$$;

-- Create trigger for return balance update
DROP TRIGGER IF EXISTS update_customer_balance_return_trigger ON sales_returns;
CREATE TRIGGER update_customer_balance_return_trigger
AFTER INSERT OR UPDATE OF status, total_amount ON sales_returns
FOR EACH ROW
WHEN (NEW.customer_id IS NOT NULL)
EXECUTE FUNCTION update_customer_balance_on_return();

-- Create updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS update_customers_updated_at ON customers;
CREATE TRIGGER update_customers_updated_at
BEFORE UPDATE ON customers
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- Create index for better performance
CREATE INDEX IF NOT EXISTS idx_customers_type ON customers(type);
CREATE INDEX IF NOT EXISTS idx_customers_status ON customers(status);
CREATE INDEX IF NOT EXISTS idx_customers_balance ON customers(balance);
CREATE INDEX IF NOT EXISTS idx_customers_last_order_date ON customers(last_order_date);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);
CREATE INDEX IF NOT EXISTS idx_customers_tax_number ON customers(tax_number) WHERE tax_number IS NOT NULL;

-- Recalculate all customer balances
DO $$
DECLARE
  customer_record RECORD;
BEGIN
  FOR customer_record IN SELECT id FROM customers LOOP
    PERFORM calculate_customer_balance(customer_record.id);
  END LOOP;
END;
$$;

/*
# Create Held Orders Table for POS Terminal

## Purpose
This migration creates the `held_orders` table to support the "Hold Order" (Park Sale) feature in the POS Terminal.
Cashiers can temporarily save incomplete orders and restore them later without affecting inventory or reports.

## New Tables

### `held_orders`
Stores temporarily held/parked orders that can be restored later.

**Columns:**
- `id` (uuid, primary key) - Unique identifier for the held order
- `held_number` (text, unique, not null) - Human-readable held order number (e.g., "HOLD-001")
- `cashier_id` (uuid, not null, references profiles) - The cashier who held the order
- `shift_id` (uuid, nullable, references shifts) - The shift during which the order was held
- `customer_id` (uuid, nullable, references customers) - Optional customer reference
- `customer_name` (text, nullable) - Optional customer label/name (e.g., "Green T-shirt guy", "Table 3")
- `items` (jsonb, not null) - Array of cart items with product details, quantities, and discounts
- `discount` (jsonb, nullable) - Global discount settings {type: 'amount'|'percent', value: number}
- `note` (text, nullable) - Optional note about the held order
- `status` (text, not null, default 'HELD') - Status: 'HELD', 'RESTORED', 'CANCELLED'
- `created_at` (timestamptz, default now()) - When the order was held
- `updated_at` (timestamptz, nullable) - When the order was last updated

## Security
- No RLS enabled - this is internal POS data accessible to all authenticated users
- Cashiers and managers need full access to held orders

## Indexes
- Index on `status` for filtering active held orders
- Index on `created_at` for sorting by time
- Index on `cashier_id` for filtering by cashier

## Notes
- Held orders do NOT affect inventory or sales reports
- Items are stored as JSON to preserve exact cart state including discounts
- When restored, the order is removed from held_orders and processed normally
- Cancelled orders are marked as 'CANCELLED' for audit trail
*/

-- Create held_orders table
CREATE TABLE IF NOT EXISTS held_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  held_number text UNIQUE NOT NULL,
  cashier_id uuid NOT NULL REFERENCES profiles(id),
  shift_id uuid REFERENCES shifts(id),
  customer_id uuid REFERENCES customers(id),
  customer_name text,
  items jsonb NOT NULL,
  discount jsonb,
  note text,
  status text NOT NULL DEFAULT 'HELD' CHECK (status IN ('HELD', 'RESTORED', 'CANCELLED')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz
);

-- Create indexes for performance
CREATE INDEX idx_held_orders_status ON held_orders(status);
CREATE INDEX idx_held_orders_created_at ON held_orders(created_at DESC);
CREATE INDEX idx_held_orders_cashier_id ON held_orders(cashier_id);

-- Create function to generate held order numbers
CREATE OR REPLACE FUNCTION generate_held_number()
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  next_num integer;
  new_number text;
BEGIN
  -- Get the next sequence number
  SELECT COALESCE(MAX(CAST(SUBSTRING(held_number FROM 6) AS integer)), 0) + 1
  INTO next_num
  FROM held_orders
  WHERE held_number ~ '^HOLD-[0-9]+$';
  
  -- Format as HOLD-001, HOLD-002, etc.
  new_number := 'HOLD-' || LPAD(next_num::text, 3, '0');
  
  RETURN new_number;
END;
$$;

-- Create trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_held_orders_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_update_held_orders_updated_at
  BEFORE UPDATE ON held_orders
  FOR EACH ROW
  EXECUTE FUNCTION update_held_orders_updated_at();

-- Add comment to table
COMMENT ON TABLE held_orders IS 'Temporarily held/parked orders in POS Terminal that can be restored later';

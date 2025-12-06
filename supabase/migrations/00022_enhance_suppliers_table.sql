/*
# Enhance Suppliers Table

## Changes
1. Add missing fields to suppliers table:
   - note (text) - Additional notes about supplier
   - status (text) - Active/Inactive status
   - updated_at (timestamptz) - Track last update

2. Add indexes for performance
3. Enable RLS (Row Level Security)
4. Create policies for authenticated users

## Notes
- All existing data will be preserved
- New fields are nullable for backward compatibility
- Status defaults to 'active'
*/

-- Add new columns to suppliers table
ALTER TABLE suppliers
ADD COLUMN IF NOT EXISTS note text,
ADD COLUMN IF NOT EXISTS status text DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- Create trigger to auto-update updated_at
CREATE OR REPLACE FUNCTION update_suppliers_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS suppliers_updated_at_trigger ON suppliers;
CREATE TRIGGER suppliers_updated_at_trigger
  BEFORE UPDATE ON suppliers
  FOR EACH ROW
  EXECUTE FUNCTION update_suppliers_updated_at();

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_suppliers_name ON suppliers(name);
CREATE INDEX IF NOT EXISTS idx_suppliers_status ON suppliers(status);
CREATE INDEX IF NOT EXISTS idx_suppliers_email ON suppliers(email);
CREATE INDEX IF NOT EXISTS idx_suppliers_phone ON suppliers(phone);

-- Enable RLS
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
CREATE POLICY "Anyone can view suppliers" ON suppliers
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert suppliers" ON suppliers
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update suppliers" ON suppliers
  FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Authenticated users can delete suppliers" ON suppliers
  FOR DELETE TO authenticated USING (true);

-- Add comment
COMMENT ON TABLE suppliers IS 'Stores supplier information for purchase orders';
COMMENT ON COLUMN suppliers.status IS 'Supplier status: active or inactive';
COMMENT ON COLUMN suppliers.note IS 'Additional notes about the supplier';

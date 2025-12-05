/*
# Add Category Fields

1. Schema Changes
  - Add `color` field to categories table (text, nullable)
  - Add `icon` field to categories table (text, nullable)
  - Add `parent_id` field to categories table (uuid, nullable, self-referencing)

2. Purpose
  - Enable visual customization of categories with colors and icons
  - Support nested/hierarchical category structure
  - Improve POS Terminal UI with category grouping

3. Notes
  - parent_id references categories(id) for nested categories
  - Color field stores hex color codes (e.g., #2563EB)
  - Icon field stores emoji or icon identifiers
*/

-- Add new fields to categories table
ALTER TABLE categories
ADD COLUMN IF NOT EXISTS color text,
ADD COLUMN IF NOT EXISTS icon text,
ADD COLUMN IF NOT EXISTS parent_id uuid REFERENCES categories(id) ON DELETE SET NULL;

-- Create index for parent_id lookups
CREATE INDEX IF NOT EXISTS idx_categories_parent_id ON categories(parent_id);
-- Add retail and usta price snapshots to quote_items for display
ALTER TABLE quote_items ADD COLUMN retail_price REAL;
ALTER TABLE quote_items ADD COLUMN usta_price REAL;

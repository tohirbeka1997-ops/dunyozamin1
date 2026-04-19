-- Migration 043: Strip leading zeros from SKU numbers
-- Previously SKUs were formatted as 5-digit zero-padded numbers (e.g., 00001, 01463).
-- This migration converts them to plain numbers (e.g., 1, 1463) for easier searching.

UPDATE products
SET sku = CAST(CAST(sku AS INTEGER) AS TEXT)
WHERE sku GLOB '[0-9]*'
  AND CAST(sku AS INTEGER) > 0
  AND sku != CAST(CAST(sku AS INTEGER) AS TEXT);

-- Enforce category name uniqueness (case-insensitive).
-- Examples considered duplicates: "Milk", " milk ", and "milk".
-- For existing duplicates, auto-rename later duplicates to keep migration non-blocking.

WITH ranked AS (
  SELECT
    id,
    name,
    ROW_NUMBER() OVER (
      PARTITION BY lower(trim(name))
      ORDER BY datetime(replace(replace(created_at, 'T', ' '), 'Z', '')) ASC, id ASC
    ) AS rn
  FROM categories
  WHERE trim(name) <> ''
)
UPDATE categories
SET name = trim(name) || ' (' || substr(id, 1, 8) || ')'
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_name_unique_nocase
ON categories(lower(trim(name)));

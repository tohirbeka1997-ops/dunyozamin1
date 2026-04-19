-- Enforce single default warehouse (auto-unset others)
-- Repair: keep earliest created_at default, unset others

UPDATE warehouses
SET is_default = 0
WHERE is_default = 1
  AND id != (
    SELECT id
    FROM warehouses
    WHERE is_default = 1
    ORDER BY COALESCE(created_at, id) ASC, id ASC
    LIMIT 1
  );

CREATE TRIGGER IF NOT EXISTS trg_warehouses_single_default_insert
BEFORE INSERT ON warehouses
FOR EACH ROW
WHEN NEW.is_default = 1
BEGIN
  UPDATE warehouses SET is_default = 0 WHERE is_default = 1;
END;

CREATE TRIGGER IF NOT EXISTS trg_warehouses_single_default_update
BEFORE UPDATE OF is_default ON warehouses
FOR EACH ROW
WHEN NEW.is_default = 1
BEGIN
  UPDATE warehouses SET is_default = 0 WHERE is_default = 1 AND id != NEW.id;
END;

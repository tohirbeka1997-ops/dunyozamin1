-- Normalize legacy daily sales warehouse setting to AUTO
UPDATE settings
SET value = 'AUTO'
WHERE key = 'reports.daily_sales.warehouse_id'
  AND (value IS NULL OR value = '');

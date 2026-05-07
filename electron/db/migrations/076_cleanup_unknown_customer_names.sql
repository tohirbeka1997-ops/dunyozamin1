-- Remove placeholder name fragments created by Telegram registration fallbacks.
--
-- Conservative version: only NULL out explicit placeholder values that
-- our own code wrote during the early Telegram registration flow. We
-- intentionally do NOT replace such names with the literal 'Mijoz'
-- (Customer) any more — collapsing many distinct unknowns into one
-- string destroys CRM segmentation. The UI is responsible for showing a
-- friendly placeholder (e.g. "Yangi mijoz") when the column is NULL.

UPDATE marketplace_customers
SET first_name = NULL
WHERE first_name IN ('Nomalum', 'Noma''lum', 'Unknown', 'Номаълум', 'Неизвестно');

UPDATE marketplace_customers
SET last_name = NULL
WHERE last_name IN ('Nomalum', 'Noma''lum', 'Unknown', 'Номаълум', 'Неизвестно');

UPDATE customers
SET name = trim(replace(replace(replace(replace(name, ' Nomalum', ''), ' Noma''lum', ''), ' Unknown', ''), ' Номаълум', ''))
WHERE name LIKE '% Nomalum'
   OR name LIKE '% Noma''lum'
   OR name LIKE '% Unknown'
   OR name LIKE '% Номаълум';

-- Where the entire `name` was a placeholder, blank it instead of
-- overwriting with the generic 'Mijoz' constant. NULL/empty is a
-- recoverable signal that the row needs a real name.
UPDATE customers
SET name = ''
WHERE trim(name) IN ('Nomalum', 'Noma''lum', 'Unknown', 'Номаълум', 'Неизвестно');

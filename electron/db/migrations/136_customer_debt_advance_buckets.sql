-- Dual-bucket customer AR: debt and advance coexist (no auto-net on lend).
-- Legacy customers.balance / balance_usd remain net = advance - debt.
ALTER TABLE customers ADD COLUMN debt_uzs REAL NOT NULL DEFAULT 0;
ALTER TABLE customers ADD COLUMN advance_uzs REAL NOT NULL DEFAULT 0;
ALTER TABLE customers ADD COLUMN debt_usd REAL NOT NULL DEFAULT 0;
ALTER TABLE customers ADD COLUMN advance_usd REAL NOT NULL DEFAULT 0;

UPDATE customers SET
  advance_uzs = CASE WHEN COALESCE(balance, 0) > 0 THEN COALESCE(balance, 0) ELSE 0 END,
  debt_uzs = CASE WHEN COALESCE(balance, 0) < 0 THEN -COALESCE(balance, 0) ELSE 0 END,
  advance_usd = CASE WHEN COALESCE(balance_usd, 0) > 0 THEN COALESCE(balance_usd, 0) ELSE 0 END,
  debt_usd = CASE WHEN COALESCE(balance_usd, 0) < 0 THEN -COALESCE(balance_usd, 0) ELSE 0 END;

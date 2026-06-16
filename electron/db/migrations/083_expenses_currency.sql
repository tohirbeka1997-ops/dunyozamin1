-- Operating expenses: document currency (UZS default, USD optional)
ALTER TABLE expenses ADD COLUMN currency TEXT NOT NULL DEFAULT 'UZS';
ALTER TABLE expenses ADD COLUMN fx_rate REAL;

CREATE INDEX IF NOT EXISTS idx_expenses_currency ON expenses(currency);

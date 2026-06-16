-- POS / sales: document currency on completed orders (UZS default, USD optional)
ALTER TABLE orders ADD COLUMN currency TEXT NOT NULL DEFAULT 'UZS';
ALTER TABLE orders ADD COLUMN fx_rate REAL;
ALTER TABLE orders ADD COLUMN total_usd REAL;

CREATE INDEX IF NOT EXISTS idx_orders_currency ON orders(currency);

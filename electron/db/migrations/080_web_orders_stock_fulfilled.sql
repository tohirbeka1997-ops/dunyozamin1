-- Track when online order stock was written to inventory ledger (idempotent fulfill).
ALTER TABLE web_orders ADD COLUMN stock_fulfilled_at TEXT;

CREATE INDEX IF NOT EXISTS idx_web_orders_stock_fulfilled ON web_orders(stock_fulfilled_at);

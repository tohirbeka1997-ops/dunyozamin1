-- Track where a POS sale originated (desktop register, staff mobile app, etc.).
ALTER TABLE orders ADD COLUMN sales_channel TEXT NOT NULL DEFAULT 'pos'
  CHECK (sales_channel IN ('pos', 'staff_mobile'));

CREATE INDEX IF NOT EXISTS idx_orders_sales_channel ON orders(sales_channel);

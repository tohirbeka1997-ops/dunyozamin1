-- 128_sales_return_controls.sql
-- Sales return money-safe controls: approval, cancel metadata, attachment note, threshold setting.

ALTER TABLE sales_returns ADD COLUMN approved_by TEXT;
ALTER TABLE sales_returns ADD COLUMN approval_reason TEXT;
ALTER TABLE sales_returns ADD COLUMN method_mismatch_reason TEXT;
ALTER TABLE sales_returns ADD COLUMN original_payment_summary TEXT;
ALTER TABLE sales_returns ADD COLUMN cancelled_at TEXT;
ALTER TABLE sales_returns ADD COLUMN cancelled_by TEXT;
ALTER TABLE sales_returns ADD COLUMN cancel_reason TEXT;
ALTER TABLE sales_returns ADD COLUMN attachment_note TEXT;

INSERT OR IGNORE INTO settings (id, key, value, type, description, category, is_public) VALUES
  (lower(hex(randomblob(16))), 'returns.large_amount_threshold', '500000', 'number',
   'Large sales-return amount requiring extra note + manager approval (UZS)', 'returns', 0);

INSERT OR IGNORE INTO roles (id, code, name, description, is_active, created_at) VALUES
  ('role-manager-001', 'manager', 'Manager', 'Store manager', 1, datetime('now')),
  ('role-cashier-001', 'cashier', 'Cashier', 'POS cashier', 1, datetime('now'));

-- Cache USD paid totals on purchase orders (optional; also computed from supplier_payments)
ALTER TABLE purchase_orders ADD COLUMN paid_amount_usd REAL DEFAULT 0;

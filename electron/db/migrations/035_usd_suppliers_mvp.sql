-- ============================================================================
-- 035 - USD suppliers MVP (supplier settlement in USD, inventory cost in UZS)
--
-- Goal:
-- - Supplier debt & payments tracked in USD (for USD-settled suppliers)
-- - Purchase invoices can store a fixed FX rate snapshot (UZS per 1 USD)
-- - Inventory costing remains UZS (existing unit_cost/line_total)
--
-- Notes:
-- - This is MVP: no UZS->USD payment conversion and no exchange gain/loss yet.
-- - Existing UZS workflows should continue to work (new columns nullable/defaulted).
-- ============================================================================

-- Suppliers: settlement currency (default UZS)
ALTER TABLE suppliers ADD COLUMN settlement_currency TEXT NOT NULL DEFAULT 'UZS';

-- Purchase orders: currency + FX snapshot + total in USD (for supplier settlement)
ALTER TABLE purchase_orders ADD COLUMN currency TEXT NOT NULL DEFAULT 'UZS';
ALTER TABLE purchase_orders ADD COLUMN fx_rate REAL;      -- UZS per 1 USD (snapshot)
ALTER TABLE purchase_orders ADD COLUMN total_usd REAL;    -- supplier settlement amount

-- Purchase order items: store USD unit cost + line total (UZS remains in existing unit_cost/line_total)
ALTER TABLE purchase_order_items ADD COLUMN unit_cost_usd REAL;
ALTER TABLE purchase_order_items ADD COLUMN line_total_usd REAL;

-- Supplier payments: allow USD tracking (keep legacy amount as-is for UZS suppliers)
ALTER TABLE supplier_payments ADD COLUMN currency TEXT NOT NULL DEFAULT 'UZS';
ALTER TABLE supplier_payments ADD COLUMN amount_usd REAL;


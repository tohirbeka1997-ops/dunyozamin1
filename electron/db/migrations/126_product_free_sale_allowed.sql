-- Controlled free-sale exception for zero/negative catalog price (P0 product hardening).
-- sale_price <= 0 is sellable only when free_sale_allowed = 1 (authorized + cashier reason).
ALTER TABLE products ADD COLUMN free_sale_allowed INTEGER NOT NULL DEFAULT 0;

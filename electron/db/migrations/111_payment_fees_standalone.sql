-- Allow payment_fees rows without a POS payments FK (web Payme/Click + AR collections).
-- Rebuild is executed in migrate.cjs (drop+copy) so this file stays idempotent documentation + indexes.

CREATE INDEX IF NOT EXISTS idx_payment_fees_order_id ON payment_fees(order_id);
CREATE INDEX IF NOT EXISTS idx_payment_fees_method ON payment_fees(payment_method);
CREATE INDEX IF NOT EXISTS idx_payment_fees_created_at ON payment_fees(created_at);
CREATE INDEX IF NOT EXISTS idx_payment_fees_source ON payment_fees(source);

-- Performance: index the payment-expiry scheduler query that runs every 60s in
-- public-api (server.cjs):
--   WHERE status = 'new' AND payment_status = 'pending' AND payment_expires_at < ?
-- Also speeds up status + payment_status filtered listings.
-- payment_expires_at exists since migration 066; purely additive, no logic change.
CREATE INDEX IF NOT EXISTS idx_web_orders_status_payment_expiry
  ON web_orders(status, payment_status, payment_expires_at);

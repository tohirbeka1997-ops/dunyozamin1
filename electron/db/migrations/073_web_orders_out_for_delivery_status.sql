-- Add explicit delivery-in-progress status for Telegram marketplace orders.
-- SQLite cannot alter CHECK constraints in place, so we recreate web_orders.
--
-- The migration runner wraps this file in a transaction with
-- `PRAGMA defer_foreign_keys = 1`, which is the safe way to drop+rebuild a
-- referenced table while keeping FK integrity at COMMIT time. We deliberately
-- do NOT toggle `PRAGMA foreign_keys` here — that pragma is a no-op while a
-- transaction is open and would give a false sense of safety if executed
-- outside one.

CREATE TABLE IF NOT EXISTS web_orders_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_number TEXT NOT NULL UNIQUE,
  customer_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'paid', 'processing', 'ready', 'out_for_delivery', 'delivered', 'cancelled')),
  payment_method TEXT NOT NULL DEFAULT 'cash'
    CHECK (payment_method IN ('payme', 'click', 'cash')),
  payment_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (payment_status IN ('pending', 'paid', 'failed', 'refunded')),
  payment_id TEXT,
  total_amount INTEGER NOT NULL DEFAULT 0,
  delivery_address TEXT,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  payment_expires_at TEXT,
  payment_provider TEXT,
  FOREIGN KEY (customer_id) REFERENCES marketplace_customers(id) ON DELETE RESTRICT
);

INSERT INTO web_orders_new (
  id, order_number, customer_id, status, payment_method, payment_status, payment_id,
  total_amount, delivery_address, note, created_at, updated_at, payment_expires_at, payment_provider
)
SELECT
  id, order_number, customer_id, status, payment_method, payment_status, payment_id,
  total_amount, delivery_address, note, created_at, updated_at, payment_expires_at, payment_provider
FROM web_orders;

DROP TABLE web_orders;
ALTER TABLE web_orders_new RENAME TO web_orders;

CREATE INDEX IF NOT EXISTS idx_web_orders_customer ON web_orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_web_orders_status ON web_orders(status);
CREATE INDEX IF NOT EXISTS idx_web_orders_created ON web_orders(created_at);

DELETE FROM sqlite_sequence WHERE name = 'web_orders';
INSERT INTO sqlite_sequence(name, seq)
SELECT 'web_orders', COALESCE(MAX(id), 0) FROM web_orders;

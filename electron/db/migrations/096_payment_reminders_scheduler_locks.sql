-- Payment reminder dedup table + scheduler instance lock (public-api expire/reminder tick).
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS payment_reminders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  reminder_type TEXT NOT NULL,
  sent_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(order_id, reminder_type)
);

CREATE INDEX IF NOT EXISTS idx_payment_reminders_order ON payment_reminders(order_id);

CREATE TABLE IF NOT EXISTS scheduler_locks (
  name TEXT PRIMARY KEY,
  locked_until TEXT NOT NULL,
  locked_by TEXT
);

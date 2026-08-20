-- Purchase order payment schemes: full / partial+debt / installment schedule.
-- Supplier payment reminders (idempotent dedup). Safe to re-run.

ALTER TABLE purchase_orders ADD COLUMN payment_scheme TEXT DEFAULT 'full';
ALTER TABLE purchase_orders ADD COLUMN payment_due_date TEXT;

CREATE TABLE IF NOT EXISTS po_payment_schedule (
  id TEXT PRIMARY KEY,
  purchase_order_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  due_date TEXT NOT NULL,
  amount REAL NOT NULL DEFAULT 0,
  amount_usd REAL,
  status TEXT NOT NULL DEFAULT 'pending',
  paid_at TEXT,
  UNIQUE(purchase_order_id, seq),
  FOREIGN KEY(purchase_order_id) REFERENCES purchase_orders(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_po_payment_schedule_po ON po_payment_schedule(purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_po_payment_schedule_due ON po_payment_schedule(due_date);

CREATE TABLE IF NOT EXISTS supplier_payment_reminders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  po_id TEXT NOT NULL,
  reminder_type TEXT NOT NULL,
  channel TEXT,
  status TEXT NOT NULL DEFAULT 'sent',
  sent_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(po_id, reminder_type)
);

CREATE INDEX IF NOT EXISTS idx_supplier_payment_reminders_po ON supplier_payment_reminders(po_id);
CREATE INDEX IF NOT EXISTS idx_supplier_payment_reminders_sent_at ON supplier_payment_reminders(sent_at);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_payment_due ON purchase_orders(payment_due_date);

INSERT OR IGNORE INTO settings (id, key, value, type, description, category, is_public) VALUES
  (lower(hex(randomblob(16))), 'supplier.reminder.enabled', '1', 'boolean', 'Yetkazib beruvchi to''lov muddat eslatmalari', 'purchase', 1),
  (lower(hex(randomblob(16))), 'supplier.reminder.telegram_enabled', '1', 'boolean', 'Telegram xodimlarga eslatma', 'purchase', 1);

-- Nasiya eslatma izohi + kassir/admin uchun ichki bildirishnomalar.
-- Idempotent: safe to re-run.

ALTER TABLE orders ADD COLUMN credit_reminder_note TEXT;

CREATE TABLE IF NOT EXISTS credit_staff_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL,
  alert_type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  read_at TEXT,
  UNIQUE(order_id, alert_type)
);

CREATE INDEX IF NOT EXISTS idx_credit_staff_alerts_unread ON credit_staff_alerts(read_at);
CREATE INDEX IF NOT EXISTS idx_credit_staff_alerts_created ON credit_staff_alerts(created_at);

INSERT OR IGNORE INTO settings (id, key, value, type, description, category, is_public) VALUES
  (lower(hex(randomblob(16))), 'credit.reminder.staff_in_app_enabled', '1', 'boolean', 'Kassir/admin uchun ichki nasiya eslatmalari', 'credit', 1);

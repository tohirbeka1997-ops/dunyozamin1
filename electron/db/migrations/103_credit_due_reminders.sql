-- Credit (nasiya) due-date reminders: orders.due_date + credit_reminders dedup table.
-- Idempotent: safe to re-run.

-- Nasiya buyurtmalar uchun qarz qaytarish sanasi
ALTER TABLE orders ADD COLUMN due_date TEXT;

CREATE TABLE IF NOT EXISTS credit_reminders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL,
  reminder_type TEXT NOT NULL,
  channel TEXT,
  status TEXT NOT NULL DEFAULT 'sent',
  provider_id TEXT,
  sent_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(order_id, reminder_type)
);

CREATE INDEX IF NOT EXISTS idx_credit_reminders_order ON credit_reminders(order_id);
CREATE INDEX IF NOT EXISTS idx_credit_reminders_sent_at ON credit_reminders(sent_at);
CREATE INDEX IF NOT EXISTS idx_orders_due_date ON orders(due_date);

INSERT OR IGNORE INTO settings (id, key, value, type, description, category, is_public) VALUES
  (lower(hex(randomblob(16))), 'credit.reminder.enabled', '1', 'boolean', 'Nasiya muddat eslatmalarini yoqish', 'credit', 1),
  (lower(hex(randomblob(16))), 'credit.reminder.sms_enabled', '1', 'boolean', 'SMS eslatma kanali', 'credit', 1),
  (lower(hex(randomblob(16))), 'credit.reminder.telegram_enabled', '1', 'boolean', 'Telegram eslatma kanali', 'credit', 1),
  (lower(hex(randomblob(16))), 'credit.reminder.channel', 'telegram_first', 'string', 'Kanal: telegram_first|sms_first|both|sms_only|telegram_only', 'credit', 1),
  (lower(hex(randomblob(16))), 'credit.reminder.template', '', 'string', 'SMS shablon ({ism},{summa},{sana},{dokon_nomi})', 'credit', 1),
  (lower(hex(randomblob(16))), 'credit.reminder.daily_sms_limit', '0', 'number', 'Kunlik SMS limiti (0=env)', 'credit', 1),
  (lower(hex(randomblob(16))), 'credit.due.default_days', '7', 'number', 'Nasiya default muddat (kun)', 'credit', 1);

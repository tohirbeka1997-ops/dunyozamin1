-- Telegram business reports (Phase 1): settings + send dedup log.
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS report_notify_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_key TEXT NOT NULL,
  ref_id TEXT NOT NULL,
  sent_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(event_key, ref_id)
);

CREATE INDEX IF NOT EXISTS idx_report_notify_log_sent ON report_notify_log(sent_at);

INSERT OR IGNORE INTO settings (id, key, value, type, description, category, is_public) VALUES
  (lower(hex(randomblob(16))), 'reports.telegram.enabled', '0', 'boolean', 'Telegram biznes hisobotlari (master)', 'reports', 1),
  (lower(hex(randomblob(16))), 'reports.telegram.chat_id', '', 'string', 'Hisobotlar kanal/guruh chat_id (bo''sh = env)', 'reports', 1),
  (lower(hex(randomblob(16))), 'reports.telegram.credit_sale', '1', 'boolean', 'Nasiya sotuv real-time xabar', 'reports', 1),
  (lower(hex(randomblob(16))), 'reports.telegram.shift_closed', '1', 'boolean', 'Smena yopilishi xabari', 'reports', 1),
  (lower(hex(randomblob(16))), 'reports.telegram.daily_digest', '1', 'boolean', 'Kunlik hisobot digest', 'reports', 1),
  (lower(hex(randomblob(16))), 'reports.telegram.schedule_time', '21:00', 'string', 'Kunlik digest vaqti (HH:MM, local)', 'reports', 1),
  (lower(hex(randomblob(16))), 'reports.telegram.last_run_date', '', 'string', 'Kunlik digest oxirgi ishga tushgan sana', 'reports', 0);

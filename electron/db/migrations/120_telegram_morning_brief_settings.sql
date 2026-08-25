-- Morning "bugungi diqqat" brief — separate from evening full digest/AI (~21:00).
-- Idempotent: safe to re-run. Default enabled; time 08:00.

INSERT OR IGNORE INTO settings (id, key, value, type, description, category, is_public) VALUES
  (lower(hex(randomblob(16))), 'reports.telegram.morning_brief', '1', 'boolean',
   'Ertalab qisqa bugungi diqqat (Top 3 amal)', 'reports', 1),
  (lower(hex(randomblob(16))), 'reports.telegram.morning_brief_time', '08:00', 'string',
   'Ertalab brief vaqti (HH:MM, lokal)', 'reports', 1),
  (lower(hex(randomblob(16))), 'reports.telegram.morning_brief_last_run_date', '', 'string',
   'Ertalab brief oxirgi yuborilgan sana', 'reports', 0);

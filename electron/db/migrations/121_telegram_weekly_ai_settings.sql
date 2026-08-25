-- Weekly AI week-over-week comparison + evening daily+AI package merge.
-- Idempotent: safe to re-run.
-- weekday: 0=Yakshanba … 6=Shanba (SQLite strftime %w). Default Monday 08:00.

INSERT OR IGNORE INTO settings (id, key, value, type, description, category, is_public) VALUES
  (lower(hex(randomblob(16))), 'reports.telegram.weekly_ai', '0', 'boolean',
   'Haftalik AI taqqos (shu hafta vs o''tgan)', 'reports', 1),
  (lower(hex(randomblob(16))), 'reports.telegram.weekly_ai_time', '08:00', 'string',
   'Haftalik AI vaqti (HH:MM, lokal)', 'reports', 1),
  (lower(hex(randomblob(16))), 'reports.telegram.weekly_ai_weekday', '1', 'string',
   'Haftalik AI kuni (0=Yak … 6=Shan, 1=Dushanba)', 'reports', 1),
  (lower(hex(randomblob(16))), 'reports.telegram.weekly_ai_last_run_week', '', 'string',
   'Haftalik AI oxirgi yuborilgan hafta kaliti', 'reports', 0),
  (lower(hex(randomblob(16))), 'reports.telegram.evening_package', '0', 'boolean',
   'Kechki paket: kunlik digest + AI bitta xabarda', 'reports', 1);

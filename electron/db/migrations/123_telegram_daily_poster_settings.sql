-- Daily public marketing poster to Telegram channel (auto, no approve).
-- Idempotent: safe to re-run. Default on; time 10:00 Asia/Tashkent-local.

INSERT OR IGNORE INTO settings (id, key, value, type, description, category, is_public) VALUES
  (lower(hex(randomblob(16))), 'reports.telegram.daily_poster', '1', 'boolean',
   'Kunlik do''kon poster (Telegram marketing kanaliga avto-post)', 'reports', 1),
  (lower(hex(randomblob(16))), 'reports.telegram.daily_poster_time', '10:00', 'string',
   'Kunlik poster vaqti (HH:MM, lokal)', 'reports', 1),
  (lower(hex(randomblob(16))), 'reports.telegram.daily_poster_last_run_date', '', 'string',
   'Kunlik poster oxirgi yuborilgan sana', 'reports', 0);

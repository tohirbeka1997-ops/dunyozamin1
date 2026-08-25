-- Telegram AI store analysis (Phase 1): settings + schedule bookkeeping.
-- Idempotent: safe to re-run.

INSERT OR IGNORE INTO settings (id, key, value, type, description, category, is_public) VALUES
  (lower(hex(randomblob(16))), 'reports.telegram.ai_enabled', '0', 'boolean',
   'Kunlik AI do''kon tahlili (OpenAI)', 'reports', 1),
  (lower(hex(randomblob(16))), 'reports.telegram.ai_last_run_date', '', 'string',
   'AI tahlil oxirgi ishga tushgan sana', 'reports', 0);

-- Telegram AI marketing / assortment recommendations toggle (Phase marketing).
-- Idempotent: safe to re-run. Default on.

INSERT OR IGNORE INTO settings (id, key, value, type, description, category, is_public) VALUES
  (lower(hex(randomblob(16))), 'reports.telegram.ai_marketing', '1', 'boolean',
   'AI tahlilda marketing va assortiment tavsiyalari (ichki ma''lumot)', 'reports', 1);

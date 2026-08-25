-- Daily debt reminders for all open debtors + balance-change Telegram/SMS notify.
-- Idempotent: safe to re-run.

INSERT OR IGNORE INTO settings (id, key, value, type, description, category, is_public) VALUES
  (lower(hex(randomblob(16))), 'credit.reminder.daily_enabled', '1', 'boolean',
   'Har kuni ochiq qarzli mijozlarga eslatma (muddat oynasidan mustaqil)', 'credit', 1),
  (lower(hex(randomblob(16))), 'credit.reminder.balance_change_notify', '1', 'boolean',
   'Mijoz hisobi o''zgarganda Telegram/SMS xabar (mijoz + hisobot kanali)', 'credit', 1),
  (lower(hex(randomblob(16))), 'reports.telegram.balance_change', '1', 'boolean',
   'Hisobot kanaliga hisob o''zgarishi xabari', 'reports', 1);

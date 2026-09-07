-- Telegram staff report: real-time customer debt repayment (qarz to'lovi).
-- Idempotent: safe to re-run. Default on (same as nasiya sotuv).

INSERT OR IGNORE INTO settings (id, key, value, type, description, category, is_public) VALUES
  (lower(hex(randomblob(16))), 'reports.telegram.debt_payment', '1', 'boolean',
   'Qarz to''lovi real-time xabar (hisobot kanali)', 'reports', 1);

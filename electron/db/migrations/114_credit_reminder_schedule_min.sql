-- Credit reminder: daily schedule time + minimum debt threshold.
-- Idempotent: safe to re-run.

INSERT OR IGNORE INTO settings (id, key, value, type, description, category, is_public) VALUES
  (lower(hex(randomblob(16))), 'credit.reminder.schedule_time', '09:00', 'string', 'Kunlik eslatma vaqti (HH:MM, local)', 'credit', 1),
  (lower(hex(randomblob(16))), 'credit.reminder.min_amount', '0', 'number', 'Minimal qarz summasi (so''m); undan pastiga eslatma yuborilmaydi', 'credit', 1),
  (lower(hex(randomblob(16))), 'credit.reminder.last_run_date', '', 'string', 'Oxirgi avtomatik tick sanasi (YYYY-MM-DD)', 'credit', 0);

'use strict';

/**
 * Daily customer credit due reminders + in-app staff alerts (POS desktop / server mode).
 * Interval is frequent; runCreditReminderTick enforces schedule_time + once-per-day gate.
 */
function createCreditReminderScheduler({
  getDb,
  enabled = true,
  intervalMs = 15 * 60 * 1000,
}) {
  let timer = null;
  let startupTimer = null;

  async function tick(source = 'scheduler') {
    try {
      const db = typeof getDb === 'function' ? getDb() : null;
      if (!db) return;
      const { runCreditReminderTick } = require('../../public-api/lib/creditReminder.cjs');
      const stats = await runCreditReminderTick(db, {
        botToken: String(process.env.TELEGRAM_BOT_TOKEN || '').trim(),
        source,
      });
      if (stats?.skipped && (stats.reason === 'before_schedule' || stats.reason === 'already_ran_today')) {
        return;
      }
      if (stats?.sent > 0 || stats?.staffAlertsCreated > 0 || (stats && !stats.skipped)) {
          console.log(
          `[credit-reminder] ${source}: customerSent=${stats.sent || 0} dailySent=${stats.dailySent || 0} staffAlerts=${stats.staffAlertsCreated || 0} processed=${stats.processed || 0}${stats?.skipped ? ` skipped=${stats.reason}` : ''}`,
        );
      }
    } catch (e) {
      console.warn('[credit-reminder] tick failed:', e?.message || e);
    }
  }

  function start() {
    if (!enabled) return;
    startupTimer = setTimeout(() => void tick('startup'), 50_000);
    timer = setInterval(() => void tick('interval'), intervalMs);
  }

  function stop() {
    if (startupTimer) clearTimeout(startupTimer);
    if (timer) clearInterval(timer);
    startupTimer = null;
    timer = null;
  }

  return { start, stop, tick };
}

module.exports = { createCreditReminderScheduler };

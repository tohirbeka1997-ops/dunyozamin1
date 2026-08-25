'use strict';

/**
 * Daily supplier payment due reminders (POS desktop / server mode).
 */
function createSupplierPaymentReminderScheduler({ getDb, enabled = true, intervalMs = 24 * 60 * 60 * 1000 }) {
  let timer = null;
  let startupTimer = null;

  async function tick(source = 'scheduler') {
    try {
      const db = typeof getDb === 'function' ? getDb() : null;
      if (!db) return;
      const { runSupplierPaymentReminderTick } = require('../../public-api/lib/supplierPaymentReminder.cjs');
      const stats = await runSupplierPaymentReminderTick(db, {
        botToken: String(process.env.TELEGRAM_BOT_TOKEN || '').trim(),
        source,
      });
      if (stats?.sent > 0) {
        console.log(`[supplier-reminder] ${source}: sent=${stats.sent} processed=${stats.processed}`);
      }
    } catch (e) {
      console.warn('[supplier-reminder] tick failed:', e?.message || e);
    }
  }

  function start() {
    if (!enabled) return;
    startupTimer = setTimeout(() => void tick('startup'), 45_000);
    timer = setInterval(() => void tick('daily'), intervalMs);
  }

  function stop() {
    if (startupTimer) clearTimeout(startupTimer);
    if (timer) clearInterval(timer);
    startupTimer = null;
    timer = null;
  }

  return { start, stop, tick };
}

module.exports = { createSupplierPaymentReminderScheduler };

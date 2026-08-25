'use strict';

const { createLogger } = require('../lib/logger.cjs');

const log = createLogger('batch-reconcile');

/**
 * Periodic batch reconcile / drift alert scheduler.
 */
function createBatchReconcileScheduler({ getServices, intervalMs = 24 * 60 * 60 * 1000, enabled = true } = {}) {
  let timer = null;

  function tick(source = 'scheduler') {
    try {
      const services = typeof getServices === 'function' ? getServices() : null;
      const batches = services?.batches;
      if (!batches || typeof batches.runReconcileCheck !== 'function') return;
      const result = batches.runReconcileCheck({ source });
      if (result?.health?.drift_count > 0) {
        log.warn('Batch drift check', { source, drift_count: result.health.drift_count });
      }
    } catch (err) {
      log.error('Batch reconcile tick failed', err);
    }
  }

  return {
    start() {
      if (!enabled || timer) return;
      timer = setInterval(() => tick('daily'), intervalMs);
      if (typeof timer.unref === 'function') timer.unref();
      setTimeout(() => tick('startup'), 60_000);
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
    runNow(source = 'manual') {
      tick(source);
    },
  };
}

module.exports = { createBatchReconcileScheduler };

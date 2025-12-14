/**
 * Production-safe logger utility
 * Only logs in development, silent in production
 */

const isDevelopment = import.meta.env.DEV;

export const logger = {
  log: (...args: unknown[]) => {
    if (isDevelopment) {
      console.log(...args);
    }
  },
  error: (...args: unknown[]) => {
    // Always log errors, but in production could send to error tracking
    if (isDevelopment) {
      console.error(...args);
    } else {
      // In production, send to error tracking service
      // errorTrackingService.captureException(...args);
    }
  },
  warn: (...args: unknown[]) => {
    if (isDevelopment) {
      console.warn(...args);
    }
  },
  debug: (...args: unknown[]) => {
    if (isDevelopment) {
      console.debug(...args);
    }
  },
};

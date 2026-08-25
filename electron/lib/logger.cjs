'use strict';

/**
 * Lightweight structured logger for electron services (no extra deps).
 */
function formatMeta(meta) {
  if (meta == null) return '';
  if (meta instanceof Error) return meta.message;
  if (typeof meta === 'object') {
    try {
      return JSON.stringify(meta);
    } catch {
      return String(meta);
    }
  }
  return String(meta);
}

function write(level, component, message, meta) {
  const prefix = `[${component}]`;
  const extra = meta !== undefined ? ` ${formatMeta(meta)}` : '';
  const line = `${prefix} ${message}${extra}`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

function createLogger(component = 'pos') {
  return {
    debug: (message, meta) => write('log', component, message, meta),
    info: (message, meta) => write('log', component, message, meta),
    warn: (message, meta) => write('warn', component, message, meta),
    error: (message, meta) => write('error', component, message, meta),
  };
}

module.exports = { createLogger, logger: createLogger('pos') };

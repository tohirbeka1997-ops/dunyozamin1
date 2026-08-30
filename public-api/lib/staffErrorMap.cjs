'use strict';

const { ERROR_CODES } = require('../../electron/lib/errors.cjs');
const { logger } = require('./logger.cjs');

/**
 * Map POS service exceptions to stable staff REST JSON errors.
 * Prefer Uzbek messages for generic failures so the mobile app can show them directly.
 *
 * @param {Error & { code?: string, details?: unknown }} e
 * @param {import('express').Response} res
 * @param {{ logTag?: string }} [opts]
 */
function mapStaffServiceError(e, res, opts = {}) {
  const logTag = opts.logTag || '[staff]';
  const code = e?.code || e?.name;
  const message = e?.message || 'Request failed';

  if (code === ERROR_CODES.NOT_FOUND) {
    res.status(404).json({ error: 'not_found', message });
    return;
  }
  if (code === ERROR_CODES.VALIDATION_ERROR) {
    res.status(400).json({ error: 'validation_error', message, details: e?.details || null });
    return;
  }
  if (code === ERROR_CODES.UNPROCESSABLE_ENTITY) {
    res.status(422).json({ error: 'unprocessable_entity', message, details: e?.details || null });
    return;
  }
  if (code === ERROR_CODES.INSUFFICIENT_CASH) {
    res.status(422).json({ error: 'insufficient_cash', message, details: e?.details || null });
    return;
  }
  if (code === ERROR_CODES.SHIFT_CLOSED) {
    res.status(409).json({ error: 'shift_closed', message: message || 'Smena yopiq. Avval smena oching.' });
    return;
  }
  if (code === ERROR_CODES.RETURN_LIMIT_EXCEEDED || code === 'RETURN_LIMIT_EXCEEDED') {
    res.status(409).json({
      error: 'return_limit_exceeded',
      code: 'RETURN_LIMIT_EXCEEDED',
      message: message || 'Sotuv to‘liq qaytarilgan yoki qaytarish miqdori ruxsat etilgan limitdan oshgan.',
      details: e?.details || null,
    });
    return;
  }
  if (code === ERROR_CODES.CONFLICT || code === 'CONFLICT') {
    res.status(409).json({
      error: 'conflict',
      message,
      details: e?.details || null,
    });
    return;
  }
  if (code === ERROR_CODES.INSUFFICIENT_STOCK || code === ERROR_CODES.INSUFFICIENT_BATCH_STOCK) {
    res.status(409).json({
      error: 'insufficient_stock',
      message,
      details: e?.details || null,
      product_name: e?.details?.productName ?? null,
      requested_qty: e?.details?.requested ?? null,
      available_stock: e?.details?.available ?? null,
    });
    return;
  }
  if (code === ERROR_CODES.PERMISSION_DENIED || code === 'FORBIDDEN' || code === ERROR_CODES.FORBIDDEN) {
    res.status(403).json({ error: 'forbidden', message: message || 'Ruxsat yo‘q' });
    return;
  }
  if (code === ERROR_CODES.DB_ERROR || code === ERROR_CODES.DATABASE_ERROR) {
    res.status(500).json({
      error: 'database_error',
      message: message || 'Maʼlumotlar bazasi xatosi',
    });
    return;
  }
  if (code === ERROR_CODES.INTERNAL_ERROR) {
    res.status(500).json({ error: 'internal_error', message });
    return;
  }
  if (typeof code === 'string' && code.startsWith('SQLITE_')) {
    logger.error({ err: e, logTag }, 'sqlite error');
    res.status(500).json({
      error: 'database_error',
      message: 'Maʼlumotlar bazasi xatosi. Migratsiyalarni tekshiring (pos.db).',
    });
    return;
  }

  logger.error({ err: e, logTag }, 'unhandled staff route error');
  res.status(500).json({
    error: 'internal_error',
    message: message && message !== 'Request failed' ? message : 'Ichki xato. Qayta urinib ko‘ring.',
  });
}

module.exports = { mapStaffServiceError };

const { ERROR_CODES, createError } = require('../lib/errors.cjs');
const { randomUUID } = require('crypto');

/**
 * Exchange Rates Service
 * Stores and retrieves FX rates (e.g. USD -> UZS) by effective date.
 */
class ExchangeRatesService {
  constructor(db) {
    this.db = db;
  }

  /**
   * Upsert a rate for a given currency pair and effective date.
   * payload: { base_currency, quote_currency, rate, effective_date, source?, created_by? }
   */
  upsert(payload = {}) {
    const base = String(payload.base_currency || '').trim().toUpperCase();
    const quote = String(payload.quote_currency || '').trim().toUpperCase();
    const rate = Number(payload.rate);
    const date = String(payload.effective_date || '').trim();
    const source = payload.source ? String(payload.source).trim() : 'manual';
    const createdBy = payload.created_by || null;

    if (!base || base.length !== 3) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'base_currency is required (3-letter code)');
    }
    if (!quote || quote.length !== 3) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'quote_currency is required (3-letter code)');
    }
    if (!Number.isFinite(rate) || rate <= 0) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'rate must be a positive number');
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'effective_date must be YYYY-MM-DD');
    }

    const now = new Date().toISOString();

    // Idempotent upsert based on unique (base, quote, date)
    this.db
      .prepare(
        `
        INSERT INTO exchange_rates (id, base_currency, quote_currency, rate, effective_date, source, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(base_currency, quote_currency, effective_date)
        DO UPDATE SET
          rate = excluded.rate,
          source = excluded.source,
          created_by = excluded.created_by,
          updated_at = excluded.updated_at
      `
      )
      .run(randomUUID(), base, quote, rate, date, source, createdBy, now, now);

    return this.getLatest({ base_currency: base, quote_currency: quote, on_date: date });
  }

  /**
   * Get the latest rate for a pair on or before the given date (defaults to today).
   * filters: { base_currency, quote_currency, on_date? }
   */
  getLatest(filters = {}) {
    const base = String(filters.base_currency || '').trim().toUpperCase();
    const quote = String(filters.quote_currency || '').trim().toUpperCase();
    const onDate = filters.on_date ? String(filters.on_date).trim() : null;

    if (!base || base.length !== 3) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'base_currency is required (3-letter code)');
    }
    if (!quote || quote.length !== 3) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'quote_currency is required (3-letter code)');
    }
    if (onDate && !/^\d{4}-\d{2}-\d{2}$/.test(onDate)) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'on_date must be YYYY-MM-DD');
    }

    const params = [base, quote];
    let where = `WHERE base_currency = ? AND quote_currency = ?`;
    if (onDate) {
      where += ` AND date(effective_date) <= date(?)`;
      params.push(onDate);
    } else {
      where += ` AND date(effective_date) <= date('now')`;
    }

    const row = this.db
      .prepare(
        `
        SELECT *
        FROM exchange_rates
        ${where}
        ORDER BY date(effective_date) DESC, datetime(updated_at) DESC
        LIMIT 1
      `
      )
      .get(params);

    return row || null;
  }

  /**
   * List rates for a pair (optional date range).
   * filters: { base_currency, quote_currency, date_from?, date_to?, limit?, offset? }
   */
  list(filters = {}) {
    const base = String(filters.base_currency || '').trim().toUpperCase();
    const quote = String(filters.quote_currency || '').trim().toUpperCase();
    const dateFrom = filters.date_from ? String(filters.date_from).trim() : null;
    const dateTo = filters.date_to ? String(filters.date_to).trim() : null;
    const limit = Number.isFinite(Number(filters.limit)) ? Math.min(500, Math.max(1, Number(filters.limit))) : 100;
    const offset = Number.isFinite(Number(filters.offset)) ? Math.max(0, Number(filters.offset)) : 0;

    if (!base || base.length !== 3) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'base_currency is required (3-letter code)');
    }
    if (!quote || quote.length !== 3) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'quote_currency is required (3-letter code)');
    }
    if (dateFrom && !/^\d{4}-\d{2}-\d{2}$/.test(dateFrom)) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'date_from must be YYYY-MM-DD');
    }
    if (dateTo && !/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'date_to must be YYYY-MM-DD');
    }

    const params = [base, quote];
    let where = `WHERE base_currency = ? AND quote_currency = ?`;
    if (dateFrom) {
      where += ` AND date(effective_date) >= date(?)`;
      params.push(dateFrom);
    }
    if (dateTo) {
      where += ` AND date(effective_date) <= date(?)`;
      params.push(dateTo);
    }

    return this.db
      .prepare(
        `
        SELECT *
        FROM exchange_rates
        ${where}
        ORDER BY date(effective_date) DESC, datetime(updated_at) DESC
        LIMIT ? OFFSET ?
      `
      )
      .all([...params, limit, offset]);
  }
}

module.exports = ExchangeRatesService;


'use strict';

const { createError, ERROR_CODES } = require('../lib/errors.cjs');

function normalizeUsername(raw) {
  const txt = String(raw || '').trim().replace(/^@/, '');
  if (!txt) return null;
  if (!/^[A-Za-z0-9_]{5,32}$/.test(txt)) {
    throw createError(ERROR_CODES.VALIDATION_ERROR, 'Invalid Telegram username');
  }
  return txt;
}

function normalizeTelegramId(raw) {
  if (raw == null || String(raw).trim() === '') return null;
  const n = Number.parseInt(String(raw).trim(), 10);
  if (!Number.isFinite(n)) {
    throw createError(ERROR_CODES.VALIDATION_ERROR, 'Invalid Telegram id');
  }
  return n;
}

class CouriersService {
  constructor(db) {
    this.db = db;
  }

  ensureSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS marketplace_couriers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        telegram_id INTEGER UNIQUE,
        username TEXT COLLATE NOCASE UNIQUE,
        display_name TEXT,
        phone TEXT,
        active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_marketplace_couriers_active
        ON marketplace_couriers(active);
    `);
  }

  list(filters = {}) {
    this.ensureSchema();
    const includeInactive = !!filters.includeInactive;
    const where = includeInactive ? '1=1' : 'active = 1';
    return this.db
      .prepare(
        `
        SELECT id, telegram_id, username, display_name, phone, active, created_at, updated_at
        FROM marketplace_couriers
        WHERE ${where}
        ORDER BY active DESC, COALESCE(display_name, username, CAST(telegram_id AS TEXT)) COLLATE NOCASE ASC
      `,
      )
      .all();
  }

  upsert(payload = {}) {
    this.ensureSchema();
    const telegramId = normalizeTelegramId(payload.telegram_id ?? payload.telegramId);
    const username = normalizeUsername(payload.username);
    if (telegramId == null && !username) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Telegram id or username is required');
    }
    const displayName = String(payload.display_name ?? payload.displayName ?? '').trim() || null;
    const phone = String(payload.phone || '').trim() || null;
    const active = payload.active == null ? 1 : payload.active ? 1 : 0;

    const existing = this.db
      .prepare(
        `
        SELECT *
        FROM marketplace_couriers
        WHERE (? IS NOT NULL AND telegram_id = ?)
           OR (? IS NOT NULL AND lower(username) = lower(?))
        ORDER BY id ASC
        LIMIT 1
      `,
      )
      .get(telegramId, telegramId, username, username);

    const now = new Date().toISOString();
    if (existing?.id) {
      this.db
        .prepare(
          `
          UPDATE marketplace_couriers
          SET telegram_id = COALESCE(?, telegram_id),
              username = COALESCE(?, username),
              display_name = COALESCE(?, display_name),
              phone = COALESCE(?, phone),
              active = ?,
              updated_at = ?
          WHERE id = ?
        `,
        )
        .run(telegramId, username, displayName, phone, active, now, existing.id);
      return this.get(existing.id);
    }

    const info = this.db
      .prepare(
        `
        INSERT INTO marketplace_couriers (telegram_id, username, display_name, phone, active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      )
      .run(telegramId, username, displayName, phone, active, now, now);
    return this.get(info.lastInsertRowid);
  }

  get(id) {
    this.ensureSchema();
    const courierId = Number.parseInt(String(id), 10);
    if (!Number.isFinite(courierId)) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Invalid courier id');
    }
    return this.db
      .prepare(
        `
        SELECT id, telegram_id, username, display_name, phone, active, created_at, updated_at
        FROM marketplace_couriers
        WHERE id = ?
      `,
      )
      .get(courierId) || null;
  }

  setActive(id, active) {
    this.ensureSchema();
    const courierId = Number.parseInt(String(id), 10);
    if (!Number.isFinite(courierId)) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Invalid courier id');
    }
    this.db
      .prepare(`UPDATE marketplace_couriers SET active = ?, updated_at = ? WHERE id = ?`)
      .run(active ? 1 : 0, new Date().toISOString(), courierId);
    return this.get(courierId);
  }
}

module.exports = CouriersService;

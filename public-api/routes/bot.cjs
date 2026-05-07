'use strict';

const express = require('express');
const { randomUUID } = require('crypto');
const crypto = require('crypto');
const { ensureLoyaltySchema, getBalance, listLedger } = require('../lib/marketplaceLoyalty.cjs');
const { sendTelegramText } = require('../lib/telegramNotify.cjs');
const { allowedNextStatuses, isValidTransition, normalizeDeliveryMethod } = require('../lib/webOrderStatusFlow.cjs');

// Uzbekistan is on UTC+05:00 year-round (no DST). SQLite's `datetime()` does
// not understand IANA zones, so we use this offset for date bucketing in
// reports. Mirror the Electron-side `UZBEKISTAN_TZ_SQLITE_OFFSET` constant —
// update both if the deployment ever moves.
const UZBEKISTAN_TZ_SQLITE_OFFSET = '+5 hours';

function parseInternalSecret() {
  return String(process.env.TELEGRAM_BOT_INTERNAL_SECRET || '').trim();
}

function timingSafeStringEqual(a, b) {
  const aa = Buffer.from(String(a || ''), 'utf8');
  const bb = Buffer.from(String(b || ''), 'utf8');
  if (aa.length !== bb.length || aa.length === 0) return false;
  return crypto.timingSafeEqual(aa, bb);
}

function verifyInternalSecret(req, res, next) {
  const expected = parseInternalSecret();
  if (!expected) {
    res.status(503).json({ error: 'bot_internal_secret_missing' });
    return;
  }
  const got = String(req.headers['x-telegram-bot-secret'] || '').trim();
  if (!got || !timingSafeStringEqual(got, expected)) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  next();
}

function toTelegramId(v) {
  const n = Number.parseInt(String(v), 10);
  return Number.isFinite(n) ? n : null;
}

function parseAdminTelegramIds() {
  const raw = String(process.env.TELEGRAM_ADMIN_IDS || '').trim();
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => Number.parseInt(String(s).trim(), 10))
    .filter((n) => Number.isFinite(n));
}

function isAdminTelegramId(tgId) {
  if (tgId == null) return false;
  const ids = parseAdminTelegramIds();
  return ids.includes(Number(tgId));
}

function timingSafeHexEqual(a, b) {
  const aa = Buffer.from(String(a || ''), 'utf8');
  const bb = Buffer.from(String(b || ''), 'utf8');
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

function verifyBotAdminSignature(req, actorTelegramId, orderId, status) {
  const ts = String(req.headers['x-bot-admin-ts'] || '').trim();
  const sign = String(req.headers['x-bot-admin-sign'] || '').trim();
  if (!ts || !sign) return false;
  const tsNum = Number.parseInt(ts, 10);
  if (!Number.isFinite(tsNum)) return false;
  const driftSec = Math.abs(Math.floor(Date.now() / 1000) - tsNum);
  const maxDrift = Math.max(
    30,
    Number.parseInt(String(process.env.TELEGRAM_ADMIN_SIGN_MAX_AGE_SEC || '120'), 10) || 120,
  );
  if (driftSec > maxDrift) return false;
  const secret = String(process.env.TELEGRAM_BOT_INTERNAL_SECRET || '').trim();
  if (!secret) return false;
  const payload = `${actorTelegramId}:${orderId}:${status}:${ts}`;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return timingSafeHexEqual(expected, sign);
}

function verifyBotAdminPayloadSignature(req, actorTelegramId, action, payloadHash) {
  const ts = String(req.headers['x-bot-admin-ts'] || '').trim();
  const sign = String(req.headers['x-bot-admin-sign'] || '').trim();
  if (!ts || !sign) return false;
  const tsNum = Number.parseInt(ts, 10);
  if (!Number.isFinite(tsNum)) return false;
  const driftSec = Math.abs(Math.floor(Date.now() / 1000) - tsNum);
  const maxDrift = Math.max(
    30,
    Number.parseInt(String(process.env.TELEGRAM_ADMIN_SIGN_MAX_AGE_SEC || '120'), 10) || 120,
  );
  if (driftSec > maxDrift) return false;
  const secret = String(process.env.TELEGRAM_BOT_INTERNAL_SECRET || '').trim();
  if (!secret) return false;
  const payload = `${actorTelegramId}:${action}:${payloadHash}:${ts}`;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return timingSafeHexEqual(expected, sign);
}

function hashJsonPayload(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(payload || {})).digest('hex');
}

function normalizeCourierUsername(raw) {
  const txt = String(raw || '').trim().replace(/^@/, '');
  if (!txt) return null;
  if (!/^[A-Za-z0-9_]{5,32}$/.test(txt)) {
    const err = new Error('invalid_username');
    err.code = 'invalid_username';
    throw err;
  }
  return txt;
}

function ensureCourierSchema(db) {
  db.exec(`
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

function getActiveCourier(db, actorTelegramId, username = '') {
  ensureCourierSchema(db);
  const normalizedUsername = String(username || '').trim().replace(/^@/, '');
  const row = db
    .prepare(
      `
      SELECT id, telegram_id, username, display_name, phone, active
      FROM marketplace_couriers
      WHERE active = 1
        AND (
          (? IS NOT NULL AND telegram_id = ?)
          OR (? <> '' AND lower(username) = lower(?))
        )
      ORDER BY telegram_id IS NULL ASC, id ASC
      LIMIT 1
    `,
    )
    .get(actorTelegramId, actorTelegramId, normalizedUsername, normalizedUsername);
  if (row && actorTelegramId != null && row.telegram_id == null) {
    db.prepare(`UPDATE marketplace_couriers SET telegram_id = ?, updated_at = ? WHERE id = ?`)
      .run(actorTelegramId, new Date().toISOString(), row.id);
    return { ...row, telegram_id: actorTelegramId };
  }
  return row || null;
}

function upsertCourier(db, payload) {
  ensureCourierSchema(db);
  const telegramId = payload.telegram_id == null || String(payload.telegram_id).trim() === ''
    ? null
    : toTelegramId(payload.telegram_id);
  const username = normalizeCourierUsername(payload.username);
  if (telegramId == null && !username) {
    const err = new Error('courier_identifier_required');
    err.code = 'courier_identifier_required';
    throw err;
  }
  const displayName = String(payload.display_name || payload.displayName || '').trim() || null;
  const phone = String(payload.phone || '').trim() || null;
  const active = payload.active == null ? 1 : payload.active ? 1 : 0;
  const now = new Date().toISOString();
  const existing = db
    .prepare(
      `
      SELECT id
      FROM marketplace_couriers
      WHERE (? IS NOT NULL AND telegram_id = ?)
         OR (? IS NOT NULL AND lower(username) = lower(?))
      ORDER BY id ASC
      LIMIT 1
    `,
    )
    .get(telegramId, telegramId, username, username);
  if (existing?.id) {
    db.prepare(
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
    ).run(telegramId, username, displayName, phone, active, now, existing.id);
    return db.prepare(`SELECT * FROM marketplace_couriers WHERE id = ?`).get(existing.id);
  }
  const info = db.prepare(
    `
    INSERT INTO marketplace_couriers (telegram_id, username, display_name, phone, active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(telegramId, username, displayName, phone, active, now, now);
  return db.prepare(`SELECT * FROM marketplace_couriers WHERE id = ?`).get(info.lastInsertRowid);
}

function requireAdminPayload(req, res, action, payloadHash) {
  const actorTelegramId = toTelegramId(req.body?.actor_telegram_id ?? req.query.actor_telegram_id);
  if (actorTelegramId == null) {
    res.status(400).json({ error: 'invalid_actor_telegram_id' });
    return null;
  }
  if (!isAdminTelegramId(actorTelegramId)) {
    res.status(403).json({ error: 'forbidden' });
    return null;
  }
  if (!verifyBotAdminPayloadSignature(req, actorTelegramId, action, payloadHash)) {
    res.status(401).json({ error: 'invalid_admin_signature' });
    return null;
  }
  return actorTelegramId;
}

function normalizePhone(raw) {
  if (raw == null) return null;
  const compact = String(raw).trim().replace(/[\s()-]/g, '');
  if (!compact) return null;
  if (!/^\+?\d{9,15}$/.test(compact)) {
    const err = new Error('invalid_phone');
    err.code = 'invalid_phone';
    throw err;
  }
  return compact;
}

function hasColumn(db, tableName, columnName) {
  try {
    return db.prepare(`PRAGMA table_info(${tableName})`).all().some((c) => c.name === columnName);
  } catch {
    return false;
  }
}

function formatYmdInUzbekistan(input = new Date()) {
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tashkent',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const map = {};
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = p.value;
  }
  return `${map.year}-${map.month}-${map.day}`;
}

function tashkentDateExpr(columnExpr) {
  return `date(datetime(replace(replace(${columnExpr}, 'T', ' '), 'Z', ''), '${UZBEKISTAN_TZ_SQLITE_OFFSET}'))`;
}

function normalizeAddress(raw) {
  if (raw == null) return null;
  const txt = String(raw).trim();
  if (!txt) return null;
  if (txt.length < 3 || txt.length > 300) {
    const err = new Error('invalid_address');
    err.code = 'invalid_address';
    throw err;
  }
  return txt;
}

function toLatinName(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^(nomalum|noma'lum|unknown|неизвестно|номаълум)$/i.test(raw)) return '';
  const map = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'j', з: 'z', и: 'i', й: 'y',
    к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u',
    ф: 'f', х: 'x', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sh', ъ: '', ы: 'i', ь: '', э: 'e',
    ю: 'yu', я: 'ya', ў: "o'", қ: 'q', ғ: "g'", ҳ: 'h',
  };
  return raw
    .split('')
    .map((ch) => {
      const lower = ch.toLowerCase();
      const out = map[lower];
      if (out == null) return ch;
      return ch === lower ? out : out.charAt(0).toUpperCase() + out.slice(1);
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeName(raw, field, options = {}) {
  const txt = toLatinName(raw);
  if ((!txt && options.optional) || (txt.length === 0 && options.optional)) return '';
  if (!txt || txt.length < 2 || txt.length > 80) {
    const err = new Error(`invalid_${field}`);
    err.code = `invalid_${field}`;
    throw err;
  }
  return txt;
}

function ensureRegistrationSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS marketplace_customer_bindings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      marketplace_customer_id INTEGER NOT NULL UNIQUE,
      pos_customer_id TEXT NOT NULL,
      loyalty_card_code TEXT NOT NULL UNIQUE,
      qr_payload TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_marketplace_customer_bindings_pos
      ON marketplace_customer_bindings(pos_customer_id);
  `);
}

function generateCustomerCode(db) {
  const last = db
    .prepare(`SELECT code FROM customers WHERE code LIKE 'CUST-%' ORDER BY code DESC LIMIT 1`)
    .get();
  if (!last?.code) return 'CUST-0001';
  const n = Number.parseInt(String(last.code).replace('CUST-', ''), 10) || 0;
  return `CUST-${String(n + 1).padStart(4, '0')}`;
}

function ensurePosCustomerForMarketplace(db, profile) {
  const firstName = normalizeName(profile.first_name, 'first_name');
  const lastName = normalizeName(profile.last_name, 'last_name', { optional: true });
  const phone = normalizePhone(profile.phone);
  if (!phone) {
    const err = new Error('invalid_phone');
    err.code = 'invalid_phone';
    throw err;
  }
  const fullName = `${firstName} ${lastName}`.trim();

  const existingByPhone = db
    .prepare(`SELECT id FROM customers WHERE phone = ? ORDER BY created_at ASC LIMIT 1`)
    .get(phone);
  if (existingByPhone?.id) {
    db.prepare(
      `
      UPDATE customers
      SET name = COALESCE(NULLIF(?, ''), name),
          updated_at = datetime('now')
      WHERE id = ?
    `,
    ).run(fullName, existingByPhone.id);
    return existingByPhone.id;
  }

  const cols = db.prepare(`PRAGMA table_info(customers)`).all().map((c) => String(c.name));
  const hasBonus = cols.includes('bonus_points');
  const hasPricingTier = cols.includes('pricing_tier');
  const hasAllowDebt = cols.includes('allow_debt');
  const id = randomUUID();
  const code = generateCustomerCode(db);
  const now = new Date().toISOString();

  const columns = [
    'id', 'code', 'name', 'phone', 'type', 'status', 'created_at', 'updated_at',
  ];
  const values = [
    id, code, fullName, phone, 'individual', 'active', now, now,
  ];
  if (hasAllowDebt) {
    columns.push('allow_debt');
    values.push(0);
  }
  if (hasPricingTier) {
    columns.push('pricing_tier');
    values.push('retail');
  }
  if (hasBonus) {
    columns.push('bonus_points');
    values.push(0);
  }
  const placeholders = columns.map(() => '?').join(', ');
  db.prepare(`INSERT INTO customers (${columns.join(', ')}) VALUES (${placeholders})`).run(...values);
  return id;
}

function upsertRegistration(db, telegramId, payload) {
  ensureRegistrationSchema(db);
  const firstName = normalizeName(payload.first_name, 'first_name');
  const lastName = normalizeName(payload.last_name, 'last_name', { optional: true });
  const phone = normalizePhone(payload.phone);
  if (!phone) {
    const err = new Error('invalid_phone');
    err.code = 'invalid_phone';
    throw err;
  }

  db.prepare(
    `
    INSERT INTO marketplace_customers (telegram_id, first_name, last_name, phone, created_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(telegram_id) DO UPDATE SET
      first_name = excluded.first_name,
      last_name = excluded.last_name,
      phone = excluded.phone
  `,
  ).run(telegramId, firstName, lastName || null, phone);

  const row = db.prepare(`SELECT id FROM marketplace_customers WHERE telegram_id = ?`).get(telegramId);
  const marketplaceCustomerId = Number(row?.id || 0);
  if (!marketplaceCustomerId) {
    throw new Error('registration_failed');
  }

  const posCustomerId = ensurePosCustomerForMarketplace(db, { first_name: firstName, last_name: lastName, phone });
  const existingBinding = db
    .prepare(`SELECT loyalty_card_code, qr_payload FROM marketplace_customer_bindings WHERE marketplace_customer_id = ?`)
    .get(marketplaceCustomerId);

  if (existingBinding) {
    db.prepare(
      `
      UPDATE marketplace_customer_bindings
      SET pos_customer_id = ?
      WHERE marketplace_customer_id = ?
    `,
    ).run(posCustomerId, marketplaceCustomerId);
    return {
      marketplace_customer_id: marketplaceCustomerId,
      pos_customer_id: posCustomerId,
      loyalty_card_code: existingBinding.loyalty_card_code,
      qr_payload: existingBinding.qr_payload,
      first_name: firstName,
      last_name: lastName,
      phone,
    };
  }

  const loyaltyCardCode = `LC-${String(telegramId)}-${String(marketplaceCustomerId)}`;
  const qrPayload = `LOYALTY:${loyaltyCardCode}`;
  db.prepare(
    `
    INSERT INTO marketplace_customer_bindings (
      marketplace_customer_id, pos_customer_id, loyalty_card_code, qr_payload
    ) VALUES (?, ?, ?, ?)
  `,
  ).run(marketplaceCustomerId, posCustomerId, loyaltyCardCode, qrPayload);

  return {
    marketplace_customer_id: marketplaceCustomerId,
    pos_customer_id: posCustomerId,
    loyalty_card_code: loyaltyCardCode,
    qr_payload: qrPayload,
    first_name: firstName,
    last_name: lastName,
    phone,
  };
}

function ensureBotOpsSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS marketplace_bot_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      actor_telegram_id INTEGER NULL,
      target_telegram_id INTEGER NULL,
      payload_json TEXT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_marketplace_bot_audit_created
      ON marketplace_bot_audit(created_at DESC);
  `);
}

function writeAudit(db, eventType, actorTelegramId, targetTelegramId, payload) {
  ensureBotOpsSchema(db);
  db.prepare(
    `
      INSERT INTO marketplace_bot_audit (event_type, actor_telegram_id, target_telegram_id, payload_json)
      VALUES (?, ?, ?, ?)
    `,
  ).run(
    String(eventType || 'unknown'),
    actorTelegramId != null ? Number(actorTelegramId) : null,
    targetTelegramId != null ? Number(targetTelegramId) : null,
    payload != null ? JSON.stringify(payload) : null,
  );
}

function verifyBroadcastSecret(req, res, next) {
  const expected = String(process.env.TELEGRAM_BROADCAST_SECRET || '').trim();
  if (!expected) {
    res.status(503).json({ error: 'broadcast_secret_missing' });
    return;
  }
  const got = String(req.headers['x-telegram-broadcast-secret'] || '').trim();
  if (!got || !timingSafeStringEqual(got, expected)) {
    res.status(401).json({ error: 'broadcast_unauthorized' });
    return;
  }
  next();
}

function mountBotRoutes(dbGetter) {
  const router = express.Router();
  router.use(express.json({ limit: '64kb' }));
  router.use(verifyInternalSecret);
  // Never leak low-level error messages (SQL/table names, stack snippets)
  // to bot clients. Many handlers return `{ error: 'internal_error',
  // reason: e.message }`; this middleware strips `reason` for 5xx
  // responses while preserving the HTTP status + error code contract.
  router.use((req, res, next) => {
    const originalJson = res.json.bind(res);
    res.json = (body) => {
      try {
        if (
          res.statusCode >= 500 &&
          body &&
          typeof body === 'object' &&
          body.error === 'internal_error' &&
          Object.prototype.hasOwnProperty.call(body, 'reason')
        ) {
          const sanitized = { ...body };
          delete sanitized.reason;
          return originalJson(sanitized);
        }
      } catch {
        // fall through to the original payload
      }
      return originalJson(body);
    };
    next();
  });

  // Schemas are created once at boot rather than on every request. The
  // per-handler `ensure*Schema(db)` calls were defensive but added an
  // unnecessary `CREATE TABLE IF NOT EXISTS` round-trip to the SQLite
  // engine on the hot path. Boot-time creation also surfaces schema
  // errors at startup instead of at first traffic.
  try {
    const db = dbGetter();
    if (db) {
      ensureCourierSchema(db);
      ensureRegistrationSchema(db);
      ensureBotOpsSchema(db);
      ensureLoyaltySchema(db);
    }
  } catch (e) {
    // Don't crash mount — surface the warning and let the per-handler
    // ensure* fallbacks heal the schema if/when the DB becomes available.
    console.warn('[bot] Boot-time schema init skipped:', e?.message || e);
  }

  router.get('/orders/recent/:telegramId', (req, res) => {
    try {
      const tgId = toTelegramId(req.params.telegramId);
      if (tgId == null) {
        res.status(400).json({ error: 'invalid_telegram_id' });
        return;
      }
      const limit = Math.max(1, Math.min(20, Number.parseInt(String(req.query.limit || '10'), 10) || 10));
      const db = dbGetter();
      const rows = db
        .prepare(
          `
          SELECT wo.id, wo.order_number, wo.status, wo.payment_status, wo.total_amount, wo.created_at
          FROM web_orders wo
          INNER JOIN marketplace_customers mc ON mc.id = wo.customer_id
          WHERE mc.telegram_id = ?
          ORDER BY wo.created_at DESC
          LIMIT ?
        `,
        )
        .all(tgId, limit);
      res.json({ ok: true, rows });
    } catch (e) {
      res.status(500).json({ error: 'internal_error' });
    }
  });

  router.get('/orders/list/:telegramId', (req, res) => {
    try {
      const tgId = toTelegramId(req.params.telegramId);
      if (tgId == null) {
        res.status(400).json({ error: 'invalid_telegram_id' });
        return;
      }
      const source = String(req.query.source || 'web').toLowerCase() === 'pos' ? 'pos' : 'web';
      const page = Math.max(1, Number.parseInt(String(req.query.page || '1'), 10) || 1);
      const limit = Math.max(1, Math.min(20, Number.parseInt(String(req.query.limit || '10'), 10) || 10));
      const offset = (page - 1) * limit;

      const db = dbGetter();
      const mc = db
        .prepare(`SELECT id FROM marketplace_customers WHERE telegram_id = ?`)
        .get(tgId);
      if (!mc?.id) {
        res.status(404).json({ error: 'not_found' });
        return;
      }

      if (source === 'web') {
        const total = Number(
          db.prepare(`SELECT COUNT(*) AS n FROM web_orders WHERE customer_id = ?`).get(mc.id)?.n || 0,
        );
        const rows = db
          .prepare(
            `
            SELECT id, order_number, status, payment_status, total_amount, created_at
            FROM web_orders
            WHERE customer_id = ?
            ORDER BY created_at DESC
            LIMIT ? OFFSET ?
          `,
          )
          .all(mc.id, limit, offset);
        res.json({
          ok: true,
          source: 'web',
          rows,
          meta: { page, limit, total, total_pages: Math.max(1, Math.ceil(total / limit)) },
        });
        return;
      }

      ensureRegistrationSchema(db);
      const binding = db
        .prepare(`SELECT pos_customer_id FROM marketplace_customer_bindings WHERE marketplace_customer_id = ?`)
        .get(mc.id);
      if (!binding?.pos_customer_id) {
        res.json({
          ok: true,
          source: 'pos',
          rows: [],
          meta: { page, limit, total: 0, total_pages: 1 },
        });
        return;
      }
      const total = Number(
        db.prepare(`SELECT COUNT(*) AS n FROM orders WHERE customer_id = ?`).get(binding.pos_customer_id)?.n || 0,
      );
      const rows = db
        .prepare(
          `
          SELECT id, order_number, status, payment_status, total_amount, created_at
          FROM orders
          WHERE customer_id = ?
          ORDER BY created_at DESC
          LIMIT ? OFFSET ?
        `,
        )
        .all(binding.pos_customer_id, limit, offset);
      res.json({
        ok: true,
        source: 'pos',
        rows,
        meta: { page, limit, total, total_pages: Math.max(1, Math.ceil(total / limit)) },
      });
    } catch (e) {
      res.status(500).json({ error: 'internal_error', reason: e.message || String(e) });
    }
  });

  router.get('/registration/:telegramId', (req, res) => {
    try {
      const tgId = toTelegramId(req.params.telegramId);
      if (tgId == null) {
        res.status(400).json({ error: 'invalid_telegram_id' });
        return;
      }
      const db = dbGetter();
      ensureRegistrationSchema(db);
      const row = db
        .prepare(
          `
          SELECT mc.id, mc.first_name, mc.last_name, mc.phone, b.loyalty_card_code, b.qr_payload, b.pos_customer_id
          FROM marketplace_customers mc
          LEFT JOIN marketplace_customer_bindings b ON b.marketplace_customer_id = mc.id
          WHERE mc.telegram_id = ?
        `,
        )
        .get(tgId);
      const registered = !!(row?.first_name && row?.last_name && row?.phone && row?.loyalty_card_code);
      res.json({ ok: true, registered, profile: row || null });
    } catch (e) {
      res.status(500).json({ error: 'internal_error', reason: e.message || String(e) });
    }
  });

  router.post('/registration/:telegramId/complete', (req, res) => {
    try {
      const tgId = toTelegramId(req.params.telegramId);
      if (tgId == null) {
        res.status(400).json({ error: 'invalid_telegram_id' });
        return;
      }
      const body = req.body || {};
      const db = dbGetter();
      const result = upsertRegistration(db, tgId, {
        first_name: body.first_name,
        last_name: body.last_name,
        phone: body.phone,
      });
      writeAudit(db, 'registration_complete', tgId, tgId, {
        pos_customer_id: result.pos_customer_id,
        loyalty_card_code: result.loyalty_card_code,
      });
      res.json({ ok: true, data: result });
    } catch (e) {
      if (String(e.code || '').startsWith('invalid_')) {
        res.status(400).json({ error: e.code });
        return;
      }
      res.status(500).json({ error: 'internal_error', reason: e.message || String(e) });
    }
  });

  router.get('/orders/:telegramId/:orderId', (req, res) => {
    try {
      const tgId = toTelegramId(req.params.telegramId);
      const orderId = Number.parseInt(String(req.params.orderId), 10);
      if (tgId == null || !Number.isFinite(orderId)) {
        res.status(400).json({ error: 'invalid_params' });
        return;
      }
      const db = dbGetter();
      const hasDelivery = hasColumn(db, 'web_orders', 'delivery_method');
      const deliverySelect = hasDelivery ? 'wo.delivery_method' : "'courier' AS delivery_method";
      const order = db
        .prepare(
          `
          SELECT wo.id, wo.order_number, wo.status, wo.payment_status, wo.total_amount,
                 wo.delivery_address, wo.note, ${deliverySelect}, wo.created_at, wo.updated_at
          FROM web_orders wo
          INNER JOIN marketplace_customers mc ON mc.id = wo.customer_id
          WHERE mc.telegram_id = ? AND wo.id = ?
        `,
        )
        .get(tgId, orderId);
      if (!order) {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      const items = db
        .prepare(
          `
          SELECT id, product_id, quantity, price_at_order
          FROM web_order_items
          WHERE order_id = ?
          ORDER BY id ASC
        `,
        )
        .all(orderId);
      res.json({ ok: true, order: { ...order, items } });
    } catch (e) {
      res.status(500).json({ error: 'internal_error', reason: e.message || String(e) });
    }
  });

  router.post('/orders/:telegramId/:orderId/update', (req, res) => {
    try {
      const tgId = toTelegramId(req.params.telegramId);
      const orderId = Number.parseInt(String(req.params.orderId), 10);
      if (tgId == null || !Number.isFinite(orderId)) {
        res.status(400).json({ error: 'invalid_params' });
        return;
      }
      const db = dbGetter();
      const row = db
        .prepare(
          `
          SELECT wo.id, wo.status
          FROM web_orders wo
          INNER JOIN marketplace_customers mc ON mc.id = wo.customer_id
          WHERE mc.telegram_id = ? AND wo.id = ?
        `,
        )
        .get(tgId, orderId);
      if (!row) {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      if (String(row.status) !== 'new') {
        res.status(400).json({ error: 'cannot_edit', message: 'Only new orders can be edited' });
        return;
      }

      const body = req.body || {};
      const sets = [];
      const vals = [];
      if (Object.prototype.hasOwnProperty.call(body, 'delivery_address')) {
        const addr = normalizeAddress(body.delivery_address);
        if (!addr) {
          res.status(400).json({ error: 'invalid_address' });
          return;
        }
        sets.push('delivery_address = ?');
        vals.push(addr);
      }
      if (Object.prototype.hasOwnProperty.call(body, 'note')) {
        const note = body.note == null ? null : String(body.note).trim();
        if (note && note.length > 2000) {
          res.status(400).json({ error: 'note_too_long' });
          return;
        }
        sets.push('note = ?');
        vals.push(note || null);
      }
      if (!sets.length) {
        res.status(400).json({ error: 'no_fields' });
        return;
      }

      vals.push(new Date().toISOString(), orderId);
      db.prepare(`UPDATE web_orders SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`).run(...vals);
      writeAudit(db, 'order_update_by_customer', tgId, tgId, {
        order_id: orderId,
        fields: sets.map((s) => s.split('=')[0].trim()),
      });
      res.json({ ok: true, id: orderId });
    } catch (e) {
      if (e.code === 'invalid_address') {
        res.status(400).json({ error: 'invalid_address' });
        return;
      }
      res.status(500).json({ error: 'internal_error', reason: e.message || String(e) });
    }
  });

  router.post('/orders/:telegramId/:orderId/cancel', (req, res) => {
    try {
      const tgId = toTelegramId(req.params.telegramId);
      const orderId = Number.parseInt(String(req.params.orderId), 10);
      if (tgId == null || !Number.isFinite(orderId)) {
        res.status(400).json({ error: 'invalid_params' });
        return;
      }
      const db = dbGetter();
      const row = db
        .prepare(
          `
          SELECT wo.id, wo.status, wo.order_number
          FROM web_orders wo
          INNER JOIN marketplace_customers mc ON mc.id = wo.customer_id
          WHERE mc.telegram_id = ? AND wo.id = ?
        `,
        )
        .get(tgId, orderId);
      if (!row) {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      if (String(row.status) !== 'new') {
        res.status(400).json({ error: 'cannot_cancel', message: 'Only new orders can be cancelled' });
        return;
      }

      // status='new' is the only allowed pre-cancel state, so payment_status
      // here is always 'pending'. Flip it to 'failed' so accounting and
      // payment-provider reconciliation see the order as terminally failed
      // rather than still-pending. Without this update, expired-pending
      // sweeps and provider callbacks could still touch the row.
      db.prepare(
        `UPDATE web_orders SET status = 'cancelled', payment_status = 'failed', updated_at = ? WHERE id = ?`
      ).run(new Date().toISOString(), orderId);
      writeAudit(db, 'order_cancel_by_customer', tgId, tgId, {
        order_id: orderId,
        order_number: row.order_number,
      });
      const token = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
      if (token) {
        void sendTelegramText({
          botToken: token,
          telegramId: tgId,
          text: `Buyurtma bekor qilindi: ${row.order_number || `#${orderId}`}`,
        }).catch(() => {});
      }
      res.json({ ok: true, id: orderId, status: 'cancelled' });
    } catch (e) {
      res.status(500).json({ error: 'internal_error', reason: e.message || String(e) });
    }
  });

  router.get('/admin/summary', (req, res) => {
    try {
      const db = dbGetter();
      const payloadHash = hashJsonPayload({});
      const actorTelegramId = requireAdminPayload(req, res, 'admin_summary', payloadHash);
      if (actorTelegramId == null) return;
      const today = formatYmdInUzbekistan();
      const webCreatedDate = tashkentDateExpr('created_at');
      const statusRows = db
        .prepare(
          `
          SELECT status, COUNT(*) AS count, COALESCE(SUM(total_amount), 0) AS amount
          FROM web_orders
          WHERE ${webCreatedDate} = date(?)
          GROUP BY status
          ORDER BY status ASC
        `,
        )
        .all(today);
      const totalRow = db
        .prepare(
          `
          SELECT COUNT(*) AS count, COALESCE(SUM(total_amount), 0) AS amount
          FROM web_orders
          WHERE ${webCreatedDate} = date(?)
        `,
        )
        .get(today);
      const openRow = db
        .prepare(
          `
          SELECT COUNT(*) AS count, COALESCE(SUM(total_amount), 0) AS amount
          FROM web_orders
          WHERE status IN ('new','paid','processing','ready','out_for_delivery')
        `,
        )
        .get();
      const customersRow = db
        .prepare(`SELECT COUNT(*) AS count FROM marketplace_customers WHERE telegram_id IS NOT NULL`)
        .get();
      res.json({
        ok: true,
        date: today,
        today: {
          count: Number(totalRow?.count || 0),
          amount: Number(totalRow?.amount || 0),
          by_status: statusRows,
        },
        open: {
          count: Number(openRow?.count || 0),
          amount: Number(openRow?.amount || 0),
        },
        customers: {
          telegram_count: Number(customersRow?.count || 0),
        },
      });
    } catch (e) {
      res.status(500).json({ error: 'internal_error', reason: e.message || String(e) });
    }
  });

  router.get('/admin/orders', (req, res) => {
    try {
      const db = dbGetter();
      const status = String(req.query.status || 'new').trim().toLowerCase();
      const allowed = new Set(['new', 'paid', 'processing', 'ready', 'out_for_delivery', 'delivered', 'cancelled', 'open']);
      const safeStatus = allowed.has(status) ? status : 'new';
      const payloadHash = hashJsonPayload({ status: safeStatus });
      const actorTelegramId = requireAdminPayload(req, res, 'admin_orders', payloadHash);
      if (actorTelegramId == null) return;
      const hasDelivery = hasColumn(db, 'web_orders', 'delivery_method');
      const where =
        safeStatus === 'open'
          ? "wo.status IN ('new','paid','processing','ready','out_for_delivery')"
          : 'wo.status = ?';
      const params = safeStatus === 'open' ? [] : [safeStatus];
      const rows = db
        .prepare(
          `
          SELECT wo.id, wo.order_number, wo.status, wo.payment_method, wo.payment_status,
                 wo.total_amount, wo.delivery_address, wo.note,
                 ${hasDelivery ? 'wo.delivery_method' : "'courier' AS delivery_method"},
                 wo.created_at, wo.updated_at,
                 mc.telegram_id, mc.first_name, mc.last_name, mc.phone
          FROM web_orders wo
          LEFT JOIN marketplace_customers mc ON mc.id = wo.customer_id
          WHERE ${where}
          ORDER BY datetime(wo.created_at) ASC
          LIMIT 20
        `,
        )
        .all(...params);
      res.json({ ok: true, status: safeStatus, rows });
    } catch (e) {
      res.status(500).json({ error: 'internal_error', reason: e.message || String(e) });
    }
  });

  router.get('/admin/reports/:reportType', (req, res) => {
    try {
      const db = dbGetter();
      const reportType = String(req.params.reportType || '').trim().toLowerCase();
      const allowed = new Set(['today_sales', 'out_stock', 'low_stock', 'top_products', 'credit_sales']);
      if (!allowed.has(reportType)) {
        res.status(400).json({ error: 'invalid_report_type' });
        return;
      }
      const payloadHash = hashJsonPayload({ report_type: reportType });
      const actorTelegramId = requireAdminPayload(req, res, 'admin_report', payloadHash);
      if (actorTelegramId == null) return;
      const today = formatYmdInUzbekistan();
      const orderCreatedDate = tashkentDateExpr('o.created_at');
      const orderCreatedDateBare = tashkentDateExpr('created_at');
      const webCreatedDate = tashkentDateExpr('created_at');
      const webOrderCreatedDate = tashkentDateExpr('wo.created_at');

      if (reportType === 'today_sales') {
        const pos = db
          .prepare(
            `
            SELECT COUNT(*) AS count, COALESCE(SUM(total_amount), 0) AS amount,
                   COALESCE(SUM(paid_amount), 0) AS paid_amount,
                   COALESCE(SUM(credit_amount), 0) AS credit_amount
            FROM orders
            WHERE status = 'completed' AND ${orderCreatedDateBare} = date(?)
          `,
          )
          .get(today);
        const web = db
          .prepare(
            `
            SELECT COUNT(*) AS count, COALESCE(SUM(total_amount), 0) AS amount
            FROM web_orders
            WHERE (payment_status = 'paid' OR status IN ('paid','out_for_delivery','delivered'))
              AND status != 'cancelled'
              AND ${webCreatedDate} = date(?)
          `,
          )
          .get(today);
        const payments = db
          .prepare(
            `
            SELECT payment_status, COUNT(*) AS count, COALESCE(SUM(total_amount), 0) AS amount
            FROM orders
            WHERE status = 'completed' AND ${orderCreatedDateBare} = date(?)
            GROUP BY payment_status
            ORDER BY payment_status ASC
          `,
          )
          .all(today);
        res.json({ ok: true, report_type: reportType, date: today, pos, web, payments });
        return;
      }

      if (reportType === 'out_stock' || reportType === 'low_stock') {
        const wantsLow = reportType === 'low_stock';
        const rows = db
          .prepare(
            `
            WITH stock AS (
              SELECT product_id, SUM(quantity) AS quantity
              FROM stock_balances
              GROUP BY product_id
            )
            SELECT p.id, p.name, p.sku, COALESCE(s.quantity, COALESCE(p.current_stock, 0), 0) AS current_stock,
                   COALESCE(p.min_stock_level, 0) AS min_stock_level
            FROM products p
            LEFT JOIN stock s ON s.product_id = p.id
            WHERE p.is_active = 1
              AND p.track_stock = 1
              AND ${
                wantsLow
                  ? 'COALESCE(s.quantity, COALESCE(p.current_stock, 0), 0) > 0 AND COALESCE(s.quantity, COALESCE(p.current_stock, 0), 0) <= COALESCE(p.min_stock_level, 0)'
                  : 'COALESCE(s.quantity, COALESCE(p.current_stock, 0), 0) <= 0'
              }
            ORDER BY current_stock ASC, p.name ASC
            LIMIT 30
          `,
          )
          .all();
        res.json({ ok: true, report_type: reportType, date: today, rows });
        return;
      }

      if (reportType === 'top_products') {
        const qtyExpr = hasColumn(db, 'order_items', 'qty_base')
          ? 'COALESCE(oi.qty_base, oi.quantity, 0)'
          : 'COALESCE(oi.quantity, 0)';
        const rows = db
          .prepare(
            `
            WITH product_sales AS (
              SELECT oi.product_id,
                     COALESCE(p.name, oi.product_name, oi.product_id) AS product_name,
                     p.sku,
                     COALESCE(SUM(${qtyExpr}), 0) AS sold_qty,
                     COALESCE(SUM(COALESCE(oi.line_total, oi.quantity * oi.unit_price, 0)), 0) AS amount
              FROM order_items oi
              INNER JOIN orders o ON o.id = oi.order_id
              LEFT JOIN products p ON p.id = oi.product_id
              WHERE o.status = 'completed' AND ${orderCreatedDate} = date(?)
              GROUP BY oi.product_id

              UNION ALL

              SELECT wi.product_id,
                     COALESCE(p.name, wi.product_id) AS product_name,
                     p.sku,
                     COALESCE(SUM(wi.quantity), 0) AS sold_qty,
                     COALESCE(SUM(wi.quantity * wi.price_at_order), 0) AS amount
              FROM web_order_items wi
              INNER JOIN web_orders wo ON wo.id = wi.order_id
              LEFT JOIN products p ON p.id = wi.product_id
              WHERE wo.payment_status = 'paid'
                AND wo.status NOT IN ('cancelled','delivered')
                AND ${webOrderCreatedDate} = date(?)
              GROUP BY wi.product_id
            )
            SELECT product_id, product_name, sku,
                   SUM(sold_qty) AS sold_qty,
                   SUM(amount) AS amount
            FROM product_sales
            GROUP BY product_id
            ORDER BY sold_qty DESC, amount DESC
            LIMIT 15
          `,
          )
          .all(today, today);
        res.json({ ok: true, report_type: reportType, date: today, rows });
        return;
      }

      const rows = db
        .prepare(
          `
          SELECT o.id, o.order_number, o.total_amount, o.paid_amount, o.credit_amount,
                 o.payment_status, o.created_at, c.name AS customer_name, c.phone
          FROM orders o
          LEFT JOIN customers c ON c.id = o.customer_id
          WHERE o.status = 'completed'
            AND (o.payment_status IN ('on_credit','partially_paid') OR COALESCE(o.credit_amount, 0) > 0)
            AND ${orderCreatedDate} = date(?)
          ORDER BY datetime(o.created_at) DESC
          LIMIT 20
        `,
        )
        .all(today);
      const total = rows.reduce((sum, r) => sum + Number(r.credit_amount || 0), 0);
      res.json({ ok: true, report_type: reportType, date: today, total_credit: total, rows });
    } catch (e) {
      res.status(500).json({ error: 'internal_error', reason: e.message || String(e) });
    }
  });

  router.post('/admin/orders/:orderId/status', (req, res) => {
    try {
      const orderId = Number.parseInt(String(req.params.orderId), 10);
      if (!Number.isFinite(orderId)) {
        res.status(400).json({ error: 'invalid_order_id' });
        return;
      }
      const body = req.body || {};
      const actorTelegramId = toTelegramId(body.actor_telegram_id);
      const nextStatus = String(body.status || '').trim().toLowerCase();
      const allowed = new Set(['new', 'paid', 'processing', 'ready', 'out_for_delivery', 'delivered', 'cancelled']);
      if (!allowed.has(nextStatus)) {
        res.status(400).json({ error: 'invalid_status' });
        return;
      }
      if (!isAdminTelegramId(actorTelegramId)) {
        res.status(403).json({ error: 'forbidden' });
        return;
      }
      if (!verifyBotAdminSignature(req, actorTelegramId, orderId, nextStatus)) {
        res.status(401).json({ error: 'invalid_admin_signature' });
        return;
      }

      const db = dbGetter();
      const deliverySelect = hasColumn(db, 'web_orders', 'delivery_method')
        ? "wo.delivery_method AS delivery_method"
        : "'courier' AS delivery_method";
      const row = db
        .prepare(
          `
          SELECT wo.id, wo.status, wo.order_number, ${deliverySelect}, mc.telegram_id
          FROM web_orders wo
          LEFT JOIN marketplace_customers mc ON mc.id = wo.customer_id
          WHERE wo.id = ?
        `,
        )
        .get(orderId);
      if (!row) {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      const current = String(row.status || '').toLowerCase();
      if (current === nextStatus) {
        res.json({ ok: true, id: orderId, status: current, unchanged: true });
        return;
      }
      const transitionContext = { deliveryMethod: row.delivery_method };
      const allowedNext = allowedNextStatuses(current, transitionContext);
      if (!isValidTransition(current, nextStatus, transitionContext)) {
        res.status(400).json({
          error: 'invalid_transition',
          current_status: current,
          allowed_next: allowedNext,
        });
        return;
      }
      db.prepare(`UPDATE web_orders SET status = ?, updated_at = ? WHERE id = ?`).run(
        nextStatus,
        new Date().toISOString(),
        orderId,
      );
      writeAudit(db, 'admin_order_status_update', actorTelegramId, row.telegram_id || null, {
        order_id: orderId,
        from: current,
        to: nextStatus,
      });
      const token = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
      if (token && row?.telegram_id) {
        const { notifyOrderStatusChanged } = require('../lib/telegramNotify.cjs');
        void notifyOrderStatusChanged({
          botToken: token,
          telegramId: row.telegram_id,
          orderNumber: row.order_number,
          status: nextStatus,
          deliveryMethod: row.delivery_method,
        }).catch(() => {});
      }
      res.json({ ok: true, id: orderId, status: nextStatus });
    } catch (e) {
      res.status(500).json({ error: 'internal_error', reason: e.message || String(e) });
    }
  });

  router.get('/admin/orders/:orderId', (req, res) => {
    try {
      const orderId = Number.parseInt(String(req.params.orderId), 10);
      if (!Number.isFinite(orderId)) {
        res.status(400).json({ error: 'invalid_params' });
        return;
      }
      const payloadHash = hashJsonPayload({ order_id: orderId });
      const actorTelegramId = requireAdminPayload(req, res, 'admin_order_get', payloadHash);
      if (actorTelegramId == null) return;
      const db = dbGetter();
      const row = db
        .prepare(
          `
          SELECT wo.id, wo.order_number, wo.status, wo.payment_status, wo.total_amount,
                 ${hasColumn(db, 'web_orders', 'delivery_method') ? 'wo.delivery_method' : "'courier' AS delivery_method"},
                 wo.created_at
          FROM web_orders wo
          WHERE wo.id = ?
        `,
        )
        .get(orderId);
      if (!row) {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      const allowed_next = allowedNextStatuses(row.status, { deliveryMethod: row.delivery_method });
      res.json({ ok: true, order: row, allowed_next });
    } catch (e) {
      res.status(500).json({ error: 'internal_error', reason: e.message || String(e) });
    }
  });

  router.get('/profile/:telegramId', (req, res) => {
    try {
      const tgId = toTelegramId(req.params.telegramId);
      if (tgId == null) {
        res.status(400).json({ error: 'invalid_telegram_id' });
        return;
      }
      const db = dbGetter();
      ensureLoyaltySchema(db);
      const customer = db
        .prepare(
          `
          SELECT id, telegram_id, first_name, last_name, phone, address, created_at
          FROM marketplace_customers
          WHERE telegram_id = ?
        `,
        )
        .get(tgId);
      if (!customer) {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      const points = getBalance(db, customer.id);
      const ledger = listLedger(db, customer.id, 10);
      const nextGoalPoints = Math.ceil((points + 1) / 100) * 100;
      ensureRegistrationSchema(db);
      const binding = db
        .prepare(
          `
          SELECT pos_customer_id, loyalty_card_code, qr_payload
          FROM marketplace_customer_bindings
          WHERE marketplace_customer_id = ?
        `,
        )
        .get(customer.id);

      let posAccount = null;
      if (binding?.pos_customer_id) {
        const posRow = db
          .prepare(
            `
            SELECT id, code, name, phone, balance, status, total_sales, total_orders, last_order_date
            FROM customers
            WHERE id = ?
          `,
          )
          .get(binding.pos_customer_id);
        if (posRow) {
          const bal = Number(posRow.balance || 0);
          posAccount = {
            ...posRow,
            balance_type: bal < 0 ? 'debt' : bal > 0 ? 'credit' : 'zero',
          };
        }
      }

      const webOrdersRows = db
        .prepare(
          `
          SELECT wo.id, wo.order_number, wo.status, wo.payment_status, wo.total_amount, wo.created_at
          FROM web_orders wo
          WHERE wo.customer_id = ?
          ORDER BY wo.created_at DESC
          LIMIT 100
        `,
        )
        .all(customer.id);
      const webOrdersTotal = Number(
        db.prepare(`SELECT COUNT(*) AS n FROM web_orders WHERE customer_id = ?`).get(customer.id)?.n || 0,
      );

      let posOrdersRows = [];
      let posOrdersTotal = 0;
      if (binding?.pos_customer_id) {
        posOrdersRows = db
          .prepare(
            `
            SELECT id, order_number, status, payment_status, total_amount, created_at
            FROM orders
            WHERE customer_id = ?
            ORDER BY created_at DESC
            LIMIT 100
          `,
          )
          .all(binding.pos_customer_id);
        posOrdersTotal = Number(
          db.prepare(`SELECT COUNT(*) AS n FROM orders WHERE customer_id = ?`).get(binding.pos_customer_id)?.n || 0,
        );
      }

      res.json({
        ok: true,
        customer,
        binding: binding || null,
        pos_account: posAccount,
        loyalty: {
          points_balance: points,
          next_goal_points: nextGoalPoints,
          points_to_next_goal: Math.max(0, nextGoalPoints - points),
          ledger,
        },
        orders: {
          web: {
            total: webOrdersTotal,
            rows: webOrdersRows,
          },
          pos: {
            total: posOrdersTotal,
            rows: posOrdersRows,
          },
        },
      });
    } catch (e) {
      res.status(500).json({ error: 'internal_error', reason: e.message || String(e) });
    }
  });

  router.post('/profile/:telegramId', (req, res) => {
    try {
      const tgId = toTelegramId(req.params.telegramId);
      if (tgId == null) {
        res.status(400).json({ error: 'invalid_telegram_id' });
        return;
      }
      const db = dbGetter();
      const row = db.prepare('SELECT id FROM marketplace_customers WHERE telegram_id = ?').get(tgId);
      if (!row) {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      const body = req.body || {};
      const sets = [];
      const vals = [];
      if ('phone' in body) {
        sets.push('phone = ?');
        vals.push(normalizePhone(body.phone));
      }
      if ('address' in body) {
        sets.push('address = ?');
        vals.push(normalizeAddress(body.address));
      }
      if (sets.length) {
        vals.push(row.id);
        db.prepare(`UPDATE marketplace_customers SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
        writeAudit(db, 'profile_update', tgId, tgId, {
          fields: sets.map((s) => s.split('=')[0].trim()),
        });
      }
      res.json({ ok: true });
    } catch (e) {
      if (e.code === 'invalid_phone' || e.code === 'invalid_address') {
        res.status(400).json({ error: e.code });
        return;
      }
      res.status(500).json({ error: 'internal_error', reason: e.message || String(e) });
    }
  });

  router.get('/admin/couriers', (req, res) => {
    try {
      const db = dbGetter();
      const payloadHash = hashJsonPayload({});
      const actorTelegramId = requireAdminPayload(req, res, 'courier_list', payloadHash);
      if (actorTelegramId == null) return;
      ensureCourierSchema(db);
      const rows = db
        .prepare(
          `
          SELECT id, telegram_id, username, display_name, phone, active, created_at, updated_at
          FROM marketplace_couriers
          ORDER BY active DESC, COALESCE(display_name, username, CAST(telegram_id AS TEXT)) COLLATE NOCASE ASC
        `,
        )
        .all();
      res.json({ ok: true, rows });
    } catch (e) {
      res.status(500).json({ error: 'internal_error', reason: e.message || String(e) });
    }
  });

  router.post('/admin/couriers', (req, res) => {
    try {
      const body = req.body || {};
      const payloadHash = hashJsonPayload({
        telegram_id: body.telegram_id ?? null,
        username: body.username ?? null,
        display_name: body.display_name ?? body.displayName ?? null,
        phone: body.phone ?? null,
        active: body.active == null ? 1 : body.active ? 1 : 0,
      });
      const actorTelegramId = requireAdminPayload(req, res, 'courier_upsert', payloadHash);
      if (actorTelegramId == null) return;
      const db = dbGetter();
      const courier = upsertCourier(db, body);
      writeAudit(db, 'courier_added', actorTelegramId, courier.telegram_id || null, {
        courier_id: courier.id,
        username: courier.username || null,
        active: courier.active,
      });
      res.json({ ok: true, courier });
    } catch (e) {
      if (['invalid_username', 'courier_identifier_required'].includes(e.code)) {
        res.status(400).json({ error: e.code });
        return;
      }
      res.status(500).json({ error: 'internal_error', reason: e.message || String(e) });
    }
  });

  router.post('/admin/couriers/:courierId/active', (req, res) => {
    try {
      const courierId = Number.parseInt(String(req.params.courierId), 10);
      if (!Number.isFinite(courierId)) {
        res.status(400).json({ error: 'invalid_courier_id' });
        return;
      }
      const active = req.body?.active ? 1 : 0;
      const payloadHash = hashJsonPayload({ courier_id: courierId, active });
      const actorTelegramId = requireAdminPayload(req, res, 'courier_active', payloadHash);
      if (actorTelegramId == null) return;
      const db = dbGetter();
      ensureCourierSchema(db);
      db.prepare(`UPDATE marketplace_couriers SET active = ?, updated_at = ? WHERE id = ?`)
        .run(active, new Date().toISOString(), courierId);
      const courier = db.prepare(`SELECT * FROM marketplace_couriers WHERE id = ?`).get(courierId);
      if (!courier) {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      writeAudit(db, active ? 'courier_activated' : 'courier_deactivated', actorTelegramId, courier.telegram_id || null, {
        courier_id: courier.id,
        username: courier.username || null,
      });
      res.json({ ok: true, courier });
    } catch (e) {
      res.status(500).json({ error: 'internal_error', reason: e.message || String(e) });
    }
  });

  router.get('/courier/me', (req, res) => {
    try {
      const actorTelegramId = toTelegramId(req.query.actor_telegram_id);
      const actorUsername = String(req.query.actor_username || '').trim();
      const db = dbGetter();
      const courier = getActiveCourier(db, actorTelegramId, actorUsername);
      if (!courier) {
        res.status(403).json({ error: 'courier_forbidden' });
        return;
      }
      res.json({ ok: true, courier });
    } catch (e) {
      res.status(500).json({ error: 'internal_error', reason: e.message || String(e) });
    }
  });

  router.get('/courier/orders', (req, res) => {
    try {
      const actorTelegramId = toTelegramId(req.query.actor_telegram_id);
      const actorUsername = String(req.query.actor_username || '').trim();
      const status = String(req.query.status || 'ready').trim().toLowerCase();
      const allowed = new Set(['ready', 'out_for_delivery', 'delivered']);
      const nextStatus = allowed.has(status) ? status : 'ready';
      const db = dbGetter();
      if (!getActiveCourier(db, actorTelegramId, actorUsername)) {
        res.status(403).json({ error: 'courier_forbidden' });
        return;
      }
      const hasDelivery = hasColumn(db, 'web_orders', 'delivery_method');
      const rows = db
        .prepare(
          `
          SELECT wo.id, wo.order_number, wo.status, wo.payment_method, wo.payment_status,
                 wo.total_amount, wo.delivery_address, wo.note,
                 ${hasDelivery ? 'wo.delivery_method' : "'courier' AS delivery_method"},
                 wo.created_at, wo.updated_at,
                 mc.telegram_id, mc.first_name, mc.last_name, mc.phone
          FROM web_orders wo
          LEFT JOIN marketplace_customers mc ON mc.id = wo.customer_id
          WHERE wo.status = ?
            ${hasDelivery ? "AND wo.delivery_method = 'courier'" : ''}
          ORDER BY datetime(wo.created_at) ASC
          LIMIT 20
        `,
        )
        .all(nextStatus);
      res.json({ ok: true, status: nextStatus, rows });
    } catch (e) {
      res.status(500).json({ error: 'internal_error', reason: e.message || String(e) });
    }
  });

  router.get('/courier/orders/:orderId', (req, res) => {
    try {
      const actorTelegramId = toTelegramId(req.query.actor_telegram_id);
      const actorUsername = String(req.query.actor_username || '').trim();
      const orderId = Number.parseInt(String(req.params.orderId), 10);
      if (!Number.isFinite(orderId)) {
        res.status(400).json({ error: 'invalid_order_id' });
        return;
      }
      const db = dbGetter();
      if (!getActiveCourier(db, actorTelegramId, actorUsername)) {
        res.status(403).json({ error: 'courier_forbidden' });
        return;
      }
      const hasDelivery = hasColumn(db, 'web_orders', 'delivery_method');
      const order = db
        .prepare(
          `
          SELECT wo.id, wo.order_number, wo.status, wo.payment_method, wo.payment_status,
                 wo.total_amount, wo.delivery_address, wo.note,
                 ${hasDelivery ? 'wo.delivery_method' : "'courier' AS delivery_method"},
                 wo.created_at, wo.updated_at,
                 mc.telegram_id, mc.first_name, mc.last_name, mc.phone
          FROM web_orders wo
          LEFT JOIN marketplace_customers mc ON mc.id = wo.customer_id
          WHERE wo.id = ?
            ${hasDelivery ? "AND wo.delivery_method = 'courier'" : ''}
        `,
        )
        .get(orderId);
      if (!order) {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      const items = db
        .prepare(
          `
          SELECT wi.id, wi.product_id, wi.quantity, wi.price_at_order, p.name AS product_name, p.sku
          FROM web_order_items wi
          LEFT JOIN products p ON p.id = wi.product_id
          WHERE wi.order_id = ?
          ORDER BY wi.id ASC
        `,
        )
        .all(orderId);
      res.json({ ok: true, order, items });
    } catch (e) {
      res.status(500).json({ error: 'internal_error', reason: e.message || String(e) });
    }
  });

  router.post('/courier/orders/:orderId/status', (req, res) => {
    try {
      const orderId = Number.parseInt(String(req.params.orderId), 10);
      const nextStatus = String(req.body?.status || '').trim().toLowerCase();
      const actorTelegramId = toTelegramId(req.body?.actor_telegram_id);
      const actorUsername = String(req.body?.actor_username || '').trim();
      if (!Number.isFinite(orderId) || actorTelegramId == null) {
        res.status(400).json({ error: 'invalid_params' });
        return;
      }
      if (!['out_for_delivery', 'delivered'].includes(nextStatus)) {
        res.status(400).json({ error: 'invalid_status' });
        return;
      }
      const db = dbGetter();
      const courier = getActiveCourier(db, actorTelegramId, actorUsername);
      if (!courier) {
        res.status(403).json({ error: 'courier_forbidden' });
        return;
      }
      const deliverySelect = hasColumn(db, 'web_orders', 'delivery_method')
        ? "wo.delivery_method AS delivery_method"
        : "'courier' AS delivery_method";
      const row = db
        .prepare(
          `
          SELECT wo.id, wo.status, wo.order_number, ${deliverySelect}, mc.telegram_id
          FROM web_orders wo
          LEFT JOIN marketplace_customers mc ON mc.id = wo.customer_id
          WHERE wo.id = ?
        `,
        )
        .get(orderId);
      if (!row) {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      const current = String(row.status || '').toLowerCase();
      if (current === nextStatus) {
        res.json({ ok: true, id: orderId, status: current, unchanged: true });
        return;
      }
      const transitionContext = { deliveryMethod: row.delivery_method };
      if (normalizeDeliveryMethod(row.delivery_method) !== 'courier') {
        res.status(400).json({ error: 'not_courier_order' });
        return;
      }
      if (!isValidTransition(current, nextStatus, transitionContext)) {
        res.status(400).json({ error: 'invalid_transition', current_status: current, allowed_next: allowedNextStatuses(current, transitionContext) });
        return;
      }
      db.prepare(`UPDATE web_orders SET status = ?, updated_at = ? WHERE id = ?`).run(nextStatus, new Date().toISOString(), orderId);
      writeAudit(db, 'courier_order_status_update', actorTelegramId, row.telegram_id || null, {
        order_id: orderId,
        courier_id: courier.id,
        from: current,
        to: nextStatus,
      });
      const token = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
      if (token && row?.telegram_id) {
        const { notifyOrderStatusChanged } = require('../lib/telegramNotify.cjs');
        void notifyOrderStatusChanged({
          botToken: token,
          telegramId: row.telegram_id,
          orderNumber: row.order_number,
          status: nextStatus,
          deliveryMethod: row.delivery_method,
        }).catch(() => {});
      }
      res.json({ ok: true, id: orderId, status: nextStatus });
    } catch (e) {
      res.status(500).json({ error: 'internal_error', reason: e.message || String(e) });
    }
  });

  router.post('/broadcast', verifyBroadcastSecret, async (req, res) => {
    try {
      const body = req.body || {};
      const message = String(body.message || '').trim();
      if (!message || message.length > 1200) {
        res.status(400).json({ error: 'invalid_message' });
        return;
      }
      const limit = Math.max(1, Math.min(1000, Number.parseInt(String(body.limit || '200'), 10) || 200));
      const offset = Math.max(0, Number.parseInt(String(body.offset || '0'), 10) || 0);
      const token = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
      if (!token) {
        res.status(503).json({ error: 'bot_token_missing' });
        return;
      }
      const db = dbGetter();
      const rows = db
        .prepare(
          `
          SELECT telegram_id
          FROM marketplace_customers
          WHERE telegram_id IS NOT NULL
          ORDER BY id DESC
          LIMIT ? OFFSET ?
        `,
        )
        .all(limit, offset);

      let sent = 0;
      let failed = 0;
      for (const row of rows) {
        const out = await sendTelegramText({
          botToken: token,
          telegramId: row.telegram_id,
          text: message,
        });
        if (out.ok) sent += 1;
        else failed += 1;
      }
      writeAudit(db, 'broadcast', null, null, { limit, offset, sent, failed });
      res.json({ ok: true, total: rows.length, sent, failed });
    } catch (e) {
      res.status(500).json({ error: 'internal_error', reason: e.message || String(e) });
    }
  });

  router.get('/metrics', (req, res) => {
    try {
      const db = dbGetter();
      ensureBotOpsSchema(db);
      const byType = db
        .prepare(
          `
          SELECT event_type, COUNT(*) AS n
          FROM marketplace_bot_audit
          GROUP BY event_type
        `,
        )
        .all();
      const last24h = db
        .prepare(
          `
          SELECT COUNT(*) AS n
          FROM marketplace_bot_audit
          WHERE created_at >= datetime('now','-1 day')
        `,
        )
        .get();
      res.json({ ok: true, last24h: Number(last24h?.n || 0), by_type: byType });
    } catch (e) {
      res.status(500).json({ error: 'internal_error', reason: e.message || String(e) });
    }
  });

  return router;
}

module.exports = { mountBotRoutes };

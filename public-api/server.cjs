#!/usr/bin/env node
'use strict';

/**
 * DunyoZamin — Public API (TZ §5)
 * Base path: /v1
 *
 * ENV: .env (loyiha ildizidan) yoki muhit o'zgaruvchilari
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { randomUUID } = crypto;
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

function timingSafeStringEqual(a, b) {
  const aa = Buffer.from(String(a || ''), 'utf8');
  const bb = Buffer.from(String(b || ''), 'utf8');
  if (aa.length !== bb.length || aa.length === 0) return false;
  return crypto.timingSafeEqual(aa, bb);
}
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { getDb, resolveDbPath } = require('./lib/db.cjs');
const { mountCatalogRoutes } = require('./routes/catalog.cjs');
const { mountAuthRoutes } = require('./routes/auth.cjs');
const { mountOrdersRoutes } = require('./routes/orders.cjs');
const { mountMeRoutes } = require('./routes/me.cjs');
const { mountPaymentRoutes } = require('./routes/payment.cjs');
const { mountBotRoutes } = require('./routes/bot.cjs');
const { createBearerAuth } = require('./middleware/bearerAuth.cjs');
const { notifyOrderStatusChanged, notifyPaymentReminder } = require('./lib/telegramNotify.cjs');
const { buildPaymeCheckoutUrl, buildClickCheckoutUrl } = require('./lib/paymentLinks.cjs');

const PORT = Number.parseInt(process.env.PUBLIC_API_PORT || '3334', 10) || 3334;
const TRUST_PROXY = ['1', 'true', 'yes'].includes(String(process.env.PUBLIC_API_TRUST_PROXY || '').toLowerCase());
const PRODUCT_IMAGE_DIR = path.join(process.env.POS_DATA_DIR || path.join(__dirname, '..', 'data'), 'product-images');
const PRODUCT_IMAGE_MAX_BYTES =
  Number.parseInt(process.env.POS_PRODUCT_IMAGE_MAX_BYTES || '8000000', 10) || 8_000_000;

function parseCsv(name) {
  const raw = process.env[name];
  if (!raw || !String(raw).trim()) return [];
  return String(raw)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function buildCorsConfig() {
  const origins = parseCsv('PUBLIC_API_CORS_ORIGINS');
  const isProd = String(process.env.NODE_ENV || '').toLowerCase() === 'production';

  if (origins.length === 0) {
    if (isProd) {
      console.warn(
        '[CORS] PUBLIC_API_CORS_ORIGINS bo\'sh — production rejimida hech qanday cross-origin so\'rovga ruxsat berilmaydi.'
      );
      return {
        origin: (origin, cb) => cb(null, !origin),
        credentials: false,
      };
    }
    return { origin: true, credentials: false };
  }

  return {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      cb(null, origins.includes(origin));
    },
    credentials: true,
  };
}

function parseAuth(req) {
  const h = req.headers?.authorization;
  if (!h || !String(h).toLowerCase().startsWith('bearer ')) return '';
  return String(h).slice('bearer '.length).trim();
}

function uploadSecret() {
  return String(process.env.POS_HOST_SECRET || process.env.VITE_POS_RPC_SECRET || process.env.API_SECRET || '').trim();
}

function extFromUpload(contentType, originalName) {
  const nameExt = path.extname(String(originalName || '')).toLowerCase();
  if (['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(nameExt)) return nameExt === '.jpeg' ? '.jpg' : nameExt;
  const type = String(contentType || '').toLowerCase();
  if (type.includes('jpeg')) return '.jpg';
  if (type.includes('png')) return '.png';
  if (type.includes('webp')) return '.webp';
  if (type.includes('gif')) return '.gif';
  return '';
}

function externalBaseUrl(req) {
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  return host ? `${proto}://${host}` : '';
}

function main() {
  const app = express();
  if (TRUST_PROXY) {
    app.set('trust proxy', 1);
  }

  app.use(cors(buildCorsConfig()));

  const limiter = rateLimit({
    windowMs: Number.parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10) || 60000,
    max: Number.parseInt(process.env.RATE_LIMIT_MAX || '100', 10) || 100,
    standardHeaders: true,
    legacyHeaders: false,
  });

  // Payment provider callbacks (Payme/Click) have their own zone:
  // - Excluded from the strict global limiter so legitimate provider
  //   retries are never blocked.
  // - Still rate-limited per source IP at a generous threshold so a
  //   buggy/malicious loop can't pin the event loop or DB.
  const paymentCallbackLimiter = rateLimit({
    windowMs:
      Number.parseInt(process.env.PAYMENT_CALLBACK_WINDOW_MS || '60000', 10) || 60000,
    max: Number.parseInt(process.env.PAYMENT_CALLBACK_MAX || '600', 10) || 600,
    standardHeaders: true,
    legacyHeaders: false,
  });

  function isPaymentCallback(req) {
    const u = req.originalUrl || req.url || '';
    return u.includes('/payment/') && u.includes('callback');
  }

  app.use((req, res, next) => {
    if (isPaymentCallback(req)) {
      return paymentCallbackLimiter(req, res, next);
    }
    return limiter(req, res, next);
  });

  app.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'dunyozamin-public-api', ts: new Date().toISOString() });
  });

  app.use('/product-images', express.static(PRODUCT_IMAGE_DIR, {
    immutable: true,
    maxAge: '365d',
  }));

  app.post(
    '/uploads/product-images',
    express.raw({ type: 'image/*', limit: PRODUCT_IMAGE_MAX_BYTES }),
    (req, res) => {
      const secret = uploadSecret();
      if (!secret || !timingSafeStringEqual(parseAuth(req), secret)) {
        res.status(401).json({ ok: false, error: { code: 'AUTH_ERROR', message: 'Unauthorized' } });
        return;
      }
      const ext = extFromUpload(req.headers['content-type'], req.headers['x-file-name']);
      if (!ext) {
        res.status(400).json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'Unsupported image type' } });
        return;
      }
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        res.status(400).json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'Empty upload' } });
        return;
      }
      fs.mkdirSync(PRODUCT_IMAGE_DIR, { recursive: true });
      const fileName = `${Date.now()}-${randomUUID()}${ext}`;
      fs.writeFileSync(path.join(PRODUCT_IMAGE_DIR, fileName), req.body);
      const publicPath = `/product-images/${fileName}`;
      const baseUrl = externalBaseUrl(req);
      res.json({ ok: true, data: { fileUrl: baseUrl ? `${baseUrl}${publicPath}` : publicPath, url: publicPath } });
    },
  );

  let dbReady = false;
  try {
    getDb();
    dbReady = true;
  } catch (e) {
    console.error('[public-api] DB open failed:', e.message);
  }

  const dbGetter = () => getDb();
  const jsonBody = express.json({ limit: '512kb' });
  const bearerAuth = createBearerAuth();

  const v1 = express.Router();
  v1.use('/auth', mountAuthRoutes(dbGetter));
  v1.use('/payment', mountPaymentRoutes(dbGetter));
  v1.use('/bot', mountBotRoutes(dbGetter));
  v1.use('/me', jsonBody, bearerAuth, mountMeRoutes(dbGetter));
  v1.use('/orders', jsonBody, bearerAuth, mountOrdersRoutes(dbGetter));
  v1.use('/', mountCatalogRoutes(dbGetter));

  app.use('/v1', (req, res, next) => {
    if (!dbReady) {
      res.status(503).json({ error: 'database_unavailable', db_path: resolveDbPath() });
      return;
    }
    next();
  });
  app.use('/v1', v1);

  app.use((_req, res) => {
    res.status(404).json({ error: 'not_found' });
  });

  function startExpireScheduler() {
    if (!dbReady) return;
    try {
      const db = getDb();
      db.exec(`
        CREATE TABLE IF NOT EXISTS payment_reminders (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          order_id INTEGER NOT NULL,
          reminder_type TEXT NOT NULL,
          sent_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(order_id, reminder_type)
        );
        CREATE INDEX IF NOT EXISTS idx_payment_reminders_order ON payment_reminders(order_id);
      `);
    } catch (e) {
      console.error('[public-api] payment reminder schema init failed:', e.message || e);
    }

    function buildPaymentLink(order) {
      const returnUrl = String(process.env.PAYME_RETURN_URL || process.env.PUBLIC_APP_RETURN_URL || '').trim();
      const pm = String(order?.payment_method || '').toLowerCase();
      if (pm === 'payme' && process.env.PAYME_MERCHANT_ID) {
        return buildPaymeCheckoutUrl({
          merchantId: process.env.PAYME_MERCHANT_ID,
          orderId: order.id,
          totalSums: order.total_amount,
          returnUrl,
        });
      }
      if (pm === 'click' && process.env.CLICK_SERVICE_ID && process.env.CLICK_MERCHANT_ID) {
        return buildClickCheckoutUrl({
          serviceId: process.env.CLICK_SERVICE_ID,
          merchantId: process.env.CLICK_MERCHANT_ID,
          orderId: order.id,
          totalSums: order.total_amount,
          returnUrl,
        });
      }
      return null;
    }

    setInterval(() => {
      try {
        const db = getDb();
        const now = new Date().toISOString();
        const expiredRows = db
          .prepare(
            `
          SELECT wo.id, wo.order_number, mc.telegram_id
          FROM web_orders wo
          LEFT JOIN marketplace_customers mc ON mc.id = wo.customer_id
          WHERE wo.status = 'new' AND wo.payment_status = 'pending'
            AND wo.payment_expires_at IS NOT NULL AND wo.payment_expires_at < ?
        `,
          )
          .all(now);
        const r = db
          .prepare(
            `
          UPDATE web_orders SET status = 'cancelled', payment_status = 'failed', updated_at = ?
          WHERE status = 'new' AND payment_status = 'pending'
            AND payment_expires_at IS NOT NULL AND payment_expires_at < ?
        `,
          )
          .run(now, now);
        if (r.changes > 0) {
          console.log('[public-api] expired web_orders cancelled:', r.changes);
          const token = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
          if (token) {
            for (const row of expiredRows) {
              if (!row?.telegram_id) continue;
              void notifyOrderStatusChanged({
                botToken: token,
                telegramId: row.telegram_id,
                orderNumber: row.order_number,
                status: 'cancelled',
              }).catch(() => {});
            }
          }
        }

        const delayMin = Math.max(
          1,
          Number.parseInt(String(process.env.PAYMENT_REMINDER_DELAY_MIN || '5'), 10) || 5,
        );
        const threshold = new Date(Date.now() - delayMin * 60 * 1000).toISOString();
        const remindRows = db
          .prepare(
            `
          SELECT wo.id, wo.order_number, wo.total_amount, wo.payment_method, wo.payment_expires_at, mc.telegram_id
          FROM web_orders wo
          INNER JOIN marketplace_customers mc ON mc.id = wo.customer_id
          WHERE wo.status = 'new'
            AND wo.payment_status = 'pending'
            AND wo.payment_method IN ('payme', 'click')
            AND wo.created_at <= ?
            AND (wo.payment_expires_at IS NULL OR wo.payment_expires_at > ?)
            AND NOT EXISTS (
              SELECT 1 FROM payment_reminders pr
              WHERE pr.order_id = wo.id AND pr.reminder_type = 'pending_payment_1'
            )
          ORDER BY wo.created_at ASC
          LIMIT 20
        `,
          )
          .all(threshold, now);
        if (remindRows.length > 0) {
          const token = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
          if (token) {
            const insReminder = db.prepare(
              `INSERT OR IGNORE INTO payment_reminders (order_id, reminder_type, sent_at) VALUES (?, 'pending_payment_1', ?)`,
            );
            for (const row of remindRows) {
              if (!row?.telegram_id) continue;
              const paymentUrl = buildPaymentLink(row);
              void notifyPaymentReminder({
                botToken: token,
                telegramId: row.telegram_id,
                orderNumber: row.order_number,
                totalSums: row.total_amount,
                paymentMethod: row.payment_method,
                expiresAt: row.payment_expires_at,
                paymentUrl,
              })
                .then((out) => {
                  if (out?.ok) {
                    try {
                      insReminder.run(row.id, new Date().toISOString());
                    } catch {
                      // ignore reminder write failures
                    }
                  }
                })
                .catch(() => {});
            }
          }
        }
      } catch (e) {
        const msg = String(e.message || '');
        if (msg.includes('no such column')) return;
        if (msg.includes('no such table')) return;
        console.error('[public-api] expire scheduler', e);
      }
    }, 60_000);
  }

  const jwtOk = process.env.JWT_SECRET && String(process.env.JWT_SECRET).length >= 16;
  const botOk = process.env.TELEGRAM_BOT_TOKEN && String(process.env.TELEGRAM_BOT_TOKEN).length >= 20;
  if (!jwtOk || !botOk) {
    console.error(
      `[public-api] Mini App auth: JWT_SECRET=${jwtOk ? 'ok' : 'missing/short'} TELEGRAM_BOT_TOKEN=${botOk ? 'ok' : 'missing'} — /v1/auth/telegram xato: server_misconfigured`
    );
  }

  app.listen(PORT, () => {
    console.log(`[public-api] listening on :${PORT}`);
    console.log(`[public-api] DB: ${resolveDbPath()} (${dbReady ? 'ok' : 'MISSING'})`);
    console.log(
      `[public-api] routes: /v1/payment/*, /v1/auth/*, /v1/me, /v1/orders, /v1/products, /v1/categories`,
    );
    startExpireScheduler();
  });
}

main();

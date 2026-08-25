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
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

function timingSafeStringEqual(a, b) {
  const aa = Buffer.from(String(a || ''), 'utf8');
  const bb = Buffer.from(String(b || ''), 'utf8');
  if (aa.length !== bb.length || aa.length === 0) return false;
  return crypto.timingSafeEqual(aa, bb);
}
// Same as Electron: root `.env` then `.env.local` with override so OPENAI_* / TELEGRAM_* win
require('../electron/config/loadRootEnv.cjs').loadRootEnv();

const { getDb, resolveDbPath } = require('./lib/db.cjs');
const { assessDbPathSync, probePosServerDbPath, resolvePosHealthUrl } = require('./lib/dbPathSync.cjs');
const { mountCatalogRoutes } = require('./routes/catalog.cjs');
const { mountAuthRoutes } = require('./routes/auth.cjs');
const { mountOrdersRoutes } = require('./routes/orders.cjs');
const { mountMeRoutes } = require('./routes/me.cjs');
const { mountPaymentRoutes } = require('./routes/payment.cjs');
const { mountBotRoutes } = require('./routes/bot.cjs');
const { mountStaffRoutes } = require('./routes/staff/index.cjs');
const { mountAdminRoutes } = require('./routes/admin/index.cjs');
const { createBearerAuth } = require('./middleware/bearerAuth.cjs');
const { startStaffBot } = require('../telegram/staffBot.cjs');
const { notifyOrderStatusChanged, notifyPaymentReminder } = require('./lib/telegramNotify.cjs');
const { handleWebOrderCancelled } = require('./lib/stockDecrement.cjs');
const { buildPaymeCheckoutUrl, buildClickCheckoutUrl } = require('./lib/paymentLinks.cjs');
const { logger } = require('./lib/logger.cjs');
const { tryAcquireSchedulerLock, shouldRunScheduler } = require('./lib/schedulerLock.cjs');
const { runCreditReminderTick } = require('./lib/creditReminder.cjs');
const { runDailyDigestTick } = require('./lib/reportNotify.cjs');

const PORT = Number.parseInt(process.env.PUBLIC_API_PORT || '3334', 10) || 3334;
const TRUST_PROXY = ['1', 'true', 'yes'].includes(String(process.env.PUBLIC_API_TRUST_PROXY || '').toLowerCase());
const PRODUCT_IMAGE_DIR = path.join(process.env.POS_DATA_DIR || path.join(__dirname, '..', 'data'), 'product-images');
const PRODUCT_IMAGE_MAX_BYTES =
  Number.parseInt(process.env.POS_PRODUCT_IMAGE_MAX_BYTES || '8000000', 10) || 8_000_000;

// Staff POS web app (sales-mobile Expo web export). Served at the server root
// so the absolute asset paths in index.html (/_expo/...) resolve, and so the
// Telegram WebApp URL is simply the public origin. Override the directory with
// STAFF_WEB_DIR if the build lives elsewhere.
const STAFF_WEB_DIR = process.env.STAFF_WEB_DIR
  ? path.resolve(process.env.STAFF_WEB_DIR)
  : path.join(__dirname, '..', 'sales-mobile', 'dist');
const STAFF_WEB_INDEX = path.join(STAFF_WEB_DIR, 'index.html');
// Reserved prefixes that must NEVER be shadowed by the staff SPA fallback.
const STAFF_WEB_RESERVED = ['/v1', '/health', '/product-images', '/uploads', '/metrics'];

function parseCsv(name) {
  const raw = process.env[name];
  if (!raw || !String(raw).trim()) return [];
  return String(raw)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function isLocalhostOrigin(origin) {
  try {
    const { hostname } = new URL(origin);
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]';
  } catch {
    return false;
  }
}

/** Expo web dev-server ports (sales-mobile on :8081, legacy Metro ports). */
const EXPO_DEV_PORTS = new Set(['8081', '19000', '19006', '19002']);

function isPrivateLanHostname(hostname) {
  if (/^10\./.test(hostname)) return true;
  if (/^192\.168\./.test(hostname)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(hostname)) return true;
  if (/^169\.254\./.test(hostname)) return true;
  return false;
}

/** Dev-only: phone/tablet opens Expo web via LAN IP on a known dev port. */
function isDevExpoLanOrigin(origin) {
  try {
    const { hostname, port } = new URL(origin);
    return EXPO_DEV_PORTS.has(port) && isPrivateLanHostname(hostname);
  } catch {
    return false;
  }
}

/** Dev-only: cloudflared/ngrok quick tunnels for Telegram WebApp testing. */
function isDevTunnelOrigin(origin) {
  try {
    const { hostname, protocol } = new URL(origin);
    if (protocol !== 'https:') return false;
    return (
      hostname.endsWith('.trycloudflare.com') ||
      hostname.endsWith('.ngrok-free.app') ||
      hostname.endsWith('.ngrok-free.dev') ||
      hostname.endsWith('.ngrok.io')
    );
  } catch {
    return false;
  }
}

function buildCorsConfig() {
  const origins = parseCsv('PUBLIC_API_CORS_ORIGINS');
  const isProd = String(process.env.NODE_ENV || '').toLowerCase() === 'production';

  if (origins.length === 0) {
    if (isProd) {
      logger.warn('[CORS] PUBLIC_API_CORS_ORIGINS bo\'sh — production rejimida hech qanday cross-origin so\'rovga ruxsat berilmaydi.');
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
      if (origins.includes(origin)) return cb(null, true);
      // Dev convenience: outside production, allow localhost and LAN Expo web
      // (sales-mobile on :8081 from phone/tablet) in addition to the configured
      // production allowlist. Production stays locked to the env list.
      if (!isProd && (isLocalhostOrigin(origin) || isDevExpoLanOrigin(origin) || isDevTunnelOrigin(origin))) return cb(null, true);
      cb(null, false);
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

  // Security headers (HSTS, noSniff, frameguard, referrer-policy, etc.).
  // CSP is disabled here because the served Expo SPA / mini-app rely on inline
  // assets and a separate origin; crossOriginResourcePolicy is relaxed so the
  // mini-app on another origin can load /product-images. Tighten CSP later if
  // the served frontend is locked down.
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      crossOriginEmbedderPolicy: false,
    }),
  );

  app.use(cors(buildCorsConfig()));

  // Serve the staff POS web build (static assets) BEFORE the rate limiter so a
  // single page load (many asset requests) is not throttled. Additive: only
  // serves files that exist on disk; missing paths fall through to the API /
  // SPA fallback. index:false so the SPA fallback (which excludes reserved API
  // prefixes) controls HTML responses.
  const staffWebAvailable = fs.existsSync(STAFF_WEB_INDEX);
  if (staffWebAvailable) {
    app.use(express.static(STAFF_WEB_DIR, { index: false, maxAge: '1h' }));
  } else {
    logger.warn({ staffWebDir: STAFF_WEB_DIR }, '[public-api] staff web build not found');
  }

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

  // Brute-force protection for credentialed login endpoints. Much stricter than
  // the global limiter so password/OTP guessing is throttled per IP. Successful
  // logins are not counted (skipSuccessfulRequests) so normal users are never
  // blocked. Applies to staff/admin password login and customer telegram auth.
  const authLimiter = rateLimit({
    windowMs: Number.parseInt(process.env.AUTH_RATE_LIMIT_WINDOW_MS || '60000', 10) || 60000,
    max: Number.parseInt(process.env.AUTH_RATE_LIMIT_MAX || '10', 10) || 10,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    message: { error: 'too_many_requests', message: 'Too many login attempts, try again later' },
  });

  function isAuthLogin(req) {
    if (req.method !== 'POST') return false;
    const u = req.originalUrl || req.url || '';
    return (
      u.includes('/auth/login') ||
      u.includes('/auth/telegram') ||
      u.includes('/auth/refresh') ||
      u.includes('/auth/reset') ||
      u.endsWith('/auth')
    );
  }

  app.use((req, res, next) => {
    if (isPaymentCallback(req)) {
      return paymentCallbackLimiter(req, res, next);
    }
    if (isAuthLogin(req)) {
      return authLimiter(req, res, next);
    }
    return limiter(req, res, next);
  });

  let dbReady = false;
  let dbSyncState = { db_in_sync: false, issues: ['database not opened'] };
  const strictDbSync = ['1', 'true', 'yes'].includes(
    String(process.env.PUBLIC_API_STRICT_DB_SYNC || '').toLowerCase(),
  );
  try {
    getDb();
    dbSyncState = assessDbPathSync();
    if (!dbSyncState.db_in_sync) {
      logger.error({ dbSync: dbSyncState }, '[public-api] DB path sync check failed');
      if (strictDbSync) {
        logger.error('[public-api] PUBLIC_API_STRICT_DB_SYNC=1 — API will return 503 until DB path is fixed');
      }
    }
    dbReady = dbSyncState.db_in_sync || !strictDbSync;
  } catch (e) {
    logger.error({ err: e.message }, '[public-api] DB open failed');
  }

  app.get('/health', async (_req, res) => {
    const sync = dbReady ? assessDbPathSync() : dbSyncState;
    let posProbe = {};
    if (process.env.PUBLIC_API_HEALTH_PROBE_POS !== '0') {
      posProbe = await probePosServerDbPath(resolvePosHealthUrl()).catch((e) => ({
        pos_health_ok: false,
        pos_health_error: String(e?.message || e),
      }));
    }
    const posMismatch =
      posProbe.pos_db_match === false
        ? [`POS server db_path (${posProbe.pos_db_path}) does not match public-api (${sync.db_path})`]
        : [];
    const inSync = sync.db_in_sync && posMismatch.length === 0;
    res.status(inSync ? 200 : 503).json({
      ok: inSync,
      service: 'dunyozamin-public-api',
      ts: new Date().toISOString(),
      db_ready: dbReady,
      db_path: sync.db_path,
      expected_pos_db_path: sync.expected_pos_db_path,
      db_in_sync: inSync,
      db_sync_issues: [...(sync.issues || []), ...posMismatch],
      tenant_slug: sync.tenant_slug,
      multi_tenant: sync.multi_tenant,
      ...posProbe,
    });
  });

  app.use('/product-images', express.static(PRODUCT_IMAGE_DIR, {
    immutable: true,
    maxAge: '365d',
  }));

  app.post(
    '/uploads/product-images',
    // Client compresses to ≤1200px WebP/JPEG before upload; 8 MB cap is for raw picks only.
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

  const dbGetter = () => getDb();
  const jsonBody = express.json({ limit: '512kb' });
  const bearerAuth = createBearerAuth();

  const v1 = express.Router();
  v1.use('/auth', mountAuthRoutes(dbGetter));
  v1.use('/staff', mountStaffRoutes());
  v1.use('/admin', mountAdminRoutes(dbGetter));
  v1.use('/payment', mountPaymentRoutes(dbGetter));
  v1.use('/bot', mountBotRoutes(dbGetter));
  v1.use('/me', jsonBody, bearerAuth, mountMeRoutes(dbGetter));
  v1.use('/orders', jsonBody, bearerAuth, mountOrdersRoutes(dbGetter));
  v1.use('/', mountCatalogRoutes(dbGetter));

  app.use('/v1', (req, res, next) => {
    if (!dbReady) {
      const sync = assessDbPathSync();
      res.status(503).json({
        error: 'database_unavailable',
        db_path: resolveDbPath(),
        db_in_sync: false,
        db_sync_issues: sync.issues,
      });
      return;
    }
    next();
  });
  app.use('/v1', v1);

  // SPA fallback for the staff web app: serve index.html for HTML GET requests
  // that are not API routes, so Expo Router client-side deep links work. API
  // prefixes are explicitly excluded to preserve the JSON 404 contract.
  if (staffWebAvailable) {
    app.get('*', (req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      const p = req.path;
      if (STAFF_WEB_RESERVED.some((prefix) => p === prefix || p.startsWith(`${prefix}/`))) {
        return next();
      }
      // Serve SPA shell for navigation requests. Do not gate on Accept: text/html —
      // Telegram WebView and some proxies omit it, which returned JSON 404 for /.
      const accept = String(req.headers.accept || '');
      const wantsHtml =
        !accept ||
        accept.includes('text/html') ||
        accept.includes('application/xhtml+xml') ||
        accept === '*/*' ||
        accept.startsWith('*/*');
      if (!wantsHtml) return next();
      if (req.method === 'HEAD') {
        res.setHeader('Content-Type', 'text/html; charset=UTF-8');
        res.end();
        return;
      }
      res.sendFile(STAFF_WEB_INDEX);
    });
  }

  app.use((_req, res) => {
    res.status(404).json({ error: 'not_found' });
  });

  // Centralized error handler — never leak stack traces to clients, always
  // return a stable JSON shape, and log server-side for diagnosis.
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    const status = Number(err?.status || err?.statusCode) || 500;
    if (status >= 500) {
      logger.error({ err: err?.stack || err?.message || err }, '[public-api] unhandled error');
    }
    if (res.headersSent) return;
    res.status(status).json({
      error: status >= 500 ? 'internal_error' : err?.code || 'error',
      message: status >= 500 ? 'Internal server error' : String(err?.message || 'Error'),
    });
  });

  function startExpireScheduler() {
    if (!dbReady || !shouldRunScheduler()) return;

    const instanceId = randomUUID();
    logger.info({ instanceId }, '[public-api] payment reminder scheduler enabled');

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
        const lockOwner = tryAcquireSchedulerLock(db, { owner: instanceId });
        if (!lockOwner) return;

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
        let expiredCount = 0;
        if (expiredRows.length > 0) {
          const cancelExpired = db.transaction((rows) => {
            const upd = db.prepare(
              `
            UPDATE web_orders SET status = 'cancelled', payment_status = 'failed', updated_at = ?
            WHERE id = ? AND status = 'new' AND payment_status = 'pending'
          `,
            );
            for (const row of rows) {
              const r = upd.run(now, row.id);
              if (r.changes > 0) {
                handleWebOrderCancelled(db, row.id);
                expiredCount += 1;
              }
            }
          });
          cancelExpired(expiredRows);
        }
        if (expiredCount > 0) {
          logger.info({ expiredCount }, '[public-api] expired web_orders cancelled');
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

        void runCreditReminderTick(db, { botToken: String(process.env.TELEGRAM_BOT_TOKEN || '').trim() })
          .then((stats) => {
            if (stats?.skipped) return;
            if (stats?.sent > 0 || stats?.staffAlertsCreated > 0) {
              logger.info({ creditReminders: stats }, '[public-api] credit due reminders');
            }
          })
          .catch((e) => {
            logger.warn({ err: e?.message || e }, '[public-api] credit reminder tick');
          });

        const { runSupplierPaymentReminderTick } = require('./lib/supplierPaymentReminder.cjs');
        void runSupplierPaymentReminderTick(db, { botToken: String(process.env.TELEGRAM_BOT_TOKEN || '').trim() })
          .then((stats) => {
            if (stats?.sent > 0) {
              logger.info({ supplierReminders: stats }, '[public-api] supplier payment reminders sent');
            }
          })
          .catch((e) => {
            logger.warn({ err: e?.message || e }, '[public-api] supplier reminder tick');
          });

        void runDailyDigestTick(db, { botToken: String(process.env.TELEGRAM_BOT_TOKEN || '').trim() })
          .then((stats) => {
            if (stats?.skipped) return;
            if (stats?.sent > 0) {
              logger.info({ reportDigest: stats }, '[public-api] telegram daily digest sent');
            }
          })
          .catch((e) => {
            logger.warn({ err: e?.message || e }, '[public-api] telegram report digest tick');
          });

        try {
          require('../electron/config/loadRootEnv.cjs').loadRootEnv();
          const {
            runMorningBriefTick,
            runAiAnalysisTick,
            runWeeklyAiTick,
            resolveOpenAiConfig,
          } = require('./lib/storeAiAnalysis.cjs');
          const botToken = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
          void runMorningBriefTick(db, { botToken })
            .then((stats) => {
              if (stats?.skipped) return;
              if (stats?.sent > 0) {
                logger.info({ morningBrief: stats }, '[public-api] telegram morning brief sent');
              }
            })
            .catch((e) => {
              logger.warn({ err: e?.message || e }, '[public-api] telegram morning brief tick');
            });
          const { apiKey, model } = resolveOpenAiConfig({});
          void runAiAnalysisTick(db, {
            botToken,
            apiKey,
            model,
          })
            .then((stats) => {
              if (stats?.skipped) return;
              if (stats?.sent > 0) {
                logger.info(
                  {
                    reportAi: {
                      sent: stats.sent,
                      failed: stats.failed,
                      mode: stats.mode,
                      fallbackReason: stats.fallbackReason || null,
                      eveningPackage: Boolean(stats.eveningPackage),
                    },
                  },
                  '[public-api] telegram AI analysis sent',
                );
              }
            })
            .catch((e) => {
              logger.warn({ err: e?.message || e }, '[public-api] telegram AI analysis tick');
            });
          void runWeeklyAiTick(db, {
            botToken,
            apiKey,
            model,
          })
            .then((stats) => {
              if (stats?.skipped) return;
              if (stats?.sent > 0) {
                logger.info(
                  {
                    reportWeeklyAi: {
                      sent: stats.sent,
                      failed: stats.failed,
                      weekKey: stats.weekKey || null,
                    },
                  },
                  '[public-api] telegram weekly AI sent',
                );
              }
            })
            .catch((e) => {
              logger.warn({ err: e?.message || e }, '[public-api] telegram weekly AI tick');
            });

          const { runDailyPosterTick } = require('./lib/dailyStorePoster.cjs');
          void runDailyPosterTick(db, {})
            .then((stats) => {
              if (stats?.skipped) return;
              if (stats?.sent > 0 || !stats?.skipped) {
                logger.info(
                  {
                    dailyPoster: {
                      sent: stats.sent,
                      failed: stats.failed,
                      rubric: stats.rubric || null,
                      imageSource: stats.imageSource || null,
                      reason: stats.reason || null,
                    },
                  },
                  '[public-api] telegram daily poster',
                );
              }
            })
            .catch((e) => {
              logger.warn({ err: e?.message || e }, '[public-api] telegram daily poster tick');
            });
        } catch (e) {
          logger.warn({ err: e?.message || e }, '[public-api] telegram AI analysis require');
        }
      } catch (e) {
        const msg = String(e.message || '');
        if (msg.includes('no such column')) return;
        if (msg.includes('no such table')) return;
        logger.error({ err: e }, '[public-api] expire scheduler');
      }
    }, 60_000);
  }

  const jwtOk = process.env.JWT_SECRET && String(process.env.JWT_SECRET).length >= 16;
  const staffJwtOk =
    (process.env.STAFF_JWT_SECRET && String(process.env.STAFF_JWT_SECRET).length >= 16) || jwtOk;
  const botOk = process.env.TELEGRAM_BOT_TOKEN && String(process.env.TELEGRAM_BOT_TOKEN).length >= 20;
  if (!jwtOk || !botOk) {
    logger.error(
      { jwtOk, botOk },
      '[public-api] Mini App auth misconfigured — /v1/auth/telegram xato: server_misconfigured',
    );
  }
  if (!staffJwtOk) {
    logger.error('[public-api] Staff auth: STAFF_JWT_SECRET (or JWT_SECRET) missing/short — /v1/staff/auth/* xato');
  }

  app.listen(PORT, () => {
    logger.info({ port: PORT }, '[public-api] listening');
    logger.info(
      { dbPath: resolveDbPath(), dbReady, db_in_sync: dbSyncState.db_in_sync, issues: dbSyncState.issues },
      '[public-api] DB',
    );
    logger.info('[public-api] routes: /v1/payment/*, /v1/auth/*, /v1/staff/*, /v1/admin/*, /v1/me, /v1/orders, /v1/products, /v1/categories');
    logger.info('[public-api] staff modules: auth, orders, products, shifts, sales, customers, suppliers, purchase-orders');
    if (staffWebAvailable) {
      logger.info({ staffWebDir: STAFF_WEB_DIR }, '[public-api] staff web app served (GET /)');
    }
    startExpireScheduler();
    void Promise.resolve(startStaffBot(logger)).catch((e) => {
      logger.error({ err: e?.message || e }, '[public-api] staff bot start error');
    });
  });
}

process.on('unhandledRejection', (reason) => {
  logger.error({ reason: reason instanceof Error ? reason.stack : reason }, '[public-api] unhandledRejection');
});
process.on('uncaughtException', (err) => {
  logger.error({ err: err?.stack || err }, '[public-api] uncaughtException');
  process.exit(1);
});

main();

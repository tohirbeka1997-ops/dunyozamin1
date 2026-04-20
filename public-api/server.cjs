#!/usr/bin/env node
'use strict';

/**
 * DunyoZamin — Public API (TZ §5)
 * Base path: /v1
 *
 * ENV: .env (loyiha ildizidan) yoki muhit o'zgaruvchilari
 */

const path = require('path');
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { getDb, resolveDbPath } = require('./lib/db.cjs');
const { mountCatalogRoutes } = require('./routes/catalog.cjs');
const { mountAuthRoutes } = require('./routes/auth.cjs');
const { mountOrdersRoutes } = require('./routes/orders.cjs');
const { mountMeRoutes } = require('./routes/me.cjs');
const { mountPaymentRoutes } = require('./routes/payment.cjs');
const { createBearerAuth } = require('./middleware/bearerAuth.cjs');

const PORT = Number.parseInt(process.env.PUBLIC_API_PORT || '3334', 10) || 3334;
const TRUST_PROXY = ['1', 'true', 'yes'].includes(String(process.env.PUBLIC_API_TRUST_PROXY || '').toLowerCase());

function parseCsv(name) {
  const raw = process.env[name];
  if (!raw || !String(raw).trim()) return [];
  return String(raw)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function buildCorsOrigin() {
  const origins = parseCsv('PUBLIC_API_CORS_ORIGINS');
  if (origins.length === 0) return true;
  return function corsCheck(origin, cb) {
    if (!origin) return cb(null, true);
    cb(null, origins.includes(origin));
  };
}

function main() {
  const app = express();
  if (TRUST_PROXY) {
    app.set('trust proxy', 1);
  }

  app.use(
    cors({
      origin: buildCorsOrigin(),
      credentials: true,
    })
  );

  const limiter = rateLimit({
    windowMs: Number.parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10) || 60000,
    max: Number.parseInt(process.env.RATE_LIMIT_MAX || '100', 10) || 100,
    standardHeaders: true,
    legacyHeaders: false,
  });
  app.use((req, res, next) => {
    const u = req.originalUrl || req.url || '';
    if (u.includes('/payment/') && u.includes('callback')) return next();
    return limiter(req, res, next);
  });

  app.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'dunyozamin-public-api', ts: new Date().toISOString() });
  });

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
    setInterval(() => {
      try {
        const db = getDb();
        const now = new Date().toISOString();
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
        }
      } catch (e) {
        if (String(e.message || '').includes('no such column')) return;
        console.error('[public-api] expire scheduler', e);
      }
    }, 60_000);
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

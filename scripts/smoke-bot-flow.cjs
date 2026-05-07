'use strict';

/**
 * Smoke check for bot/public-api integration in production-like env.
 *
 * Usage:
 *   node scripts/smoke-bot-flow.cjs
 *
 * Required env:
 *   TELEGRAM_PUBLIC_API_URL
 *   TELEGRAM_BOT_INTERNAL_SECRET
 *   TELEGRAM_ADMIN_IDS (at least one id for admin endpoints)
 */

const required = [
  'TELEGRAM_PUBLIC_API_URL',
  'TELEGRAM_BOT_INTERNAL_SECRET',
  'TELEGRAM_ADMIN_IDS',
];

for (const key of required) {
  if (!String(process.env[key] || '').trim()) {
    console.error(`[smoke-bot-flow] missing env: ${key}`);
    process.exit(2);
  }
}

const base = String(process.env.TELEGRAM_PUBLIC_API_URL).replace(/\/$/, '');
const secret = String(process.env.TELEGRAM_BOT_INTERNAL_SECRET);
const adminId = Number.parseInt(String(process.env.TELEGRAM_ADMIN_IDS).split(',')[0].trim(), 10);

if (!Number.isFinite(adminId)) {
  console.error('[smoke-bot-flow] TELEGRAM_ADMIN_IDS first value must be numeric');
  process.exit(2);
}

async function call(path, opts = {}) {
  const r = await fetch(`${base}/v1/bot${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      'x-telegram-bot-secret': secret,
      ...(opts.headers || {}),
    },
  });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}

async function main() {
  // 1) Basic route reachable
  const metrics = await call('/metrics');
  if (!metrics.ok) {
    console.error('[smoke-bot-flow] /metrics failed', metrics.status, metrics.data);
    process.exit(1);
  }
  console.log('[smoke-bot-flow] /metrics ok');

  // 2) Admin endpoint auth should reject bogus signature
  const bad = await call('/admin/orders/1/status', {
    method: 'POST',
    body: JSON.stringify({ actor_telegram_id: adminId, status: 'processing' }),
  });
  if (bad.status !== 401 && bad.status !== 404) {
    console.error('[smoke-bot-flow] expected 401/404 for unsigned admin call, got', bad.status, bad.data);
    process.exit(1);
  }
  console.log('[smoke-bot-flow] unsigned admin call protected');

  console.log('[smoke-bot-flow] done');
}

main().catch((e) => {
  console.error('[smoke-bot-flow] failed:', e?.message || e);
  process.exit(1);
});

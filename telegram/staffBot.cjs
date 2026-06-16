/**
 * Staff POS Telegram bot — SEPARATE from the customer bot (telegram/bot.cjs).
 *
 * Purpose: a brand-new, independent Telegram bot whose only job is to open the
 * staff sales POS (sales-mobile Expo web build) as a Telegram Web App (Mini
 * App). It deliberately contains NO business logic — staff authenticate inside
 * the WebApp with the existing username/password staff login (JWT).
 *
 * Two ways to run:
 *   1. Standalone process:   npm run telegram:staff-bot
 *   2. Auto-started by public-api when STAFF_BOT_TOKEN is set (see
 *      public-api/server.cjs → startStaffBot()).
 *   Run only ONE of them at a time — Telegram returns 409 Conflict if the same
 *   token long-polls from two places.
 *
 * Required env:
 *   STAFF_BOT_TOKEN     — BotFather token for the NEW staff bot
 *   STAFF_WEB_APP_URL   — HTTPS URL Telegram opens (tunnel for local, nginx for
 *                         prod). Telegram WebApps REQUIRE https://.
 * Optional env:
 *   STAFF_BOT_MODE        — 'polling' (default) | 'webhook'
 *   STAFF_BOT_WEBHOOK_BASE_URL / STAFF_BOT_WEBHOOK_PATH / STAFF_BOT_WEBHOOK_SECRET / STAFF_BOT_WEBHOOK_PORT
 *   STAFF_BOT_BUTTON_TEXT — menu/button label (default "🧾 POS ochish")
 */
'use strict';

const path = require('path');
const fs = require('fs');

const root = path.resolve(__dirname, '..');
const envPath = path.join(root, '.env');
const localPath = path.join(root, '.env.local');

let envLoaded = false;
function loadStaffBotEnv() {
  if (envLoaded) return;
  envLoaded = true;
  try {
    const dotenv = require('dotenv');
    if (fs.existsSync(envPath)) dotenv.config({ path: envPath, override: false });
    if (fs.existsSync(localPath)) dotenv.config({ path: localPath, override: true });
  } catch (e) {
    console.error('[telegram:staff-bot] dotenv:', e.message);
  }
}

function readConfig() {
  const token = String(process.env.STAFF_BOT_TOKEN || '').trim();
  const webAppUrl = String(process.env.STAFF_WEB_APP_URL || '').trim();
  const mode = String(process.env.STAFF_BOT_MODE || 'polling').trim().toLowerCase();
  const buttonText = String(process.env.STAFF_BOT_BUTTON_TEXT || '🧾 POS ochish').trim();
  const webhookBase = String(process.env.STAFF_BOT_WEBHOOK_BASE_URL || '').trim();
  const webhookPath = String(process.env.STAFF_BOT_WEBHOOK_PATH || '/telegram/staff-webhook').trim();
  const webhookSecret = String(process.env.STAFF_BOT_WEBHOOK_SECRET || '').trim();
  const webhookPort = Math.max(
    1,
    Number.parseInt(String(process.env.STAFF_BOT_WEBHOOK_PORT || '8082'), 10) || 8082,
  );
  return { token, webAppUrl, mode, buttonText, webhookBase, webhookPath, webhookSecret, webhookPort };
}

/**
 * Build (but do not launch) a Telegraf staff bot. Returns null when the bot is
 * not configured so callers can treat it as a no-op.
 */
function createStaffBot(logger = console) {
  loadStaffBotEnv();
  const cfg = readConfig();

  if (!cfg.token) {
    logger.log?.('[telegram:staff-bot] STAFF_BOT_TOKEN not set — staff bot disabled (no-op).');
    return null;
  }
  if (!cfg.webAppUrl || !cfg.webAppUrl.startsWith('https://')) {
    logger.error?.(
      '[telegram:staff-bot] STAFF_WEB_APP_URL missing or not https:// — Telegram WebApps require HTTPS. Staff bot disabled.',
    );
    return null;
  }

  let Telegraf;
  let Markup;
  try {
    ({ Telegraf, Markup } = require('telegraf'));
  } catch (e) {
    logger.error?.('[telegram:staff-bot] telegraf not installed:', e.message);
    return null;
  }

  const bot = new Telegraf(cfg.token);

  const openKeyboard = () =>
    Markup.inlineKeyboard([[Markup.button.webApp(cfg.buttonText, cfg.webAppUrl)]]);

  async function sendOpen(ctx, greeting) {
    try {
      await ctx.reply(greeting, { ...openKeyboard() });
    } catch (e) {
      logger.error?.('[telegram:staff-bot] reply failed:', e?.message || String(e));
    }
  }

  bot.start((ctx) =>
    sendOpen(
      ctx,
      'DunyoZamin — Sotuvchi POS.\nKassani ochish uchun pastdagi tugmani bosing.',
    ),
  );
  bot.command('pos', (ctx) => sendOpen(ctx, 'POS oynasini ochish:'));
  bot.command('help', (ctx) =>
    sendOpen(
      ctx,
      'Bu bot faqat sotuvchi POS ilovasini ochadi.\nLogin/parol ilova ichida soʻraladi.',
    ),
  );

  bot.catch((err, ctx) => {
    logger.error?.('[telegram:staff-bot] error', err?.message || err, ctx?.update?.update_id);
  });

  return { bot, cfg };
}

/**
 * Build AND launch the staff bot. No-op (returns null) when not configured.
 * Safe to call unconditionally from public-api startup.
 */
async function startStaffBot(logger = console) {
  const built = createStaffBot(logger);
  if (!built) return null;
  const { bot, cfg } = built;

  async function afterLaunch() {
    await bot.telegram
      .setMyCommands([
        { command: 'pos', description: 'POS oynasini ochish' },
        { command: 'help', description: 'Yordam' },
      ])
      .catch(() => {});
    await bot.telegram
      .setChatMenuButton({
        menu_button: { type: 'web_app', text: cfg.buttonText, web_app: { url: cfg.webAppUrl } },
      })
      .catch(() => {});
  }

  try {
    if (cfg.mode === 'webhook' && cfg.webhookBase.startsWith('https://')) {
      const express = require('express');
      const app = express();
      app.use(express.json({ limit: '256kb' }));
      app.use(cfg.webhookPath, bot.webhookCallback(cfg.webhookPath));
      app.get('/health', (_req, res) => res.json({ ok: true, service: 'staff-bot-webhook' }));
      await new Promise((resolve, reject) => {
        const srv = app.listen(cfg.webhookPort, () => resolve(srv));
        srv.on('error', reject);
      });
      const url = `${cfg.webhookBase.replace(/\/$/, '')}${
        cfg.webhookPath.startsWith('/') ? cfg.webhookPath : `/${cfg.webhookPath}`
      }`;
      await bot.telegram.setWebhook(url, cfg.webhookSecret ? { secret_token: cfg.webhookSecret } : undefined);
      logger.log?.(`[telegram:staff-bot] webhook mode on :${cfg.webhookPort} ${cfg.webhookPath}`);
    } else {
      // Launch without awaiting the long-poll loop (launch() resolves only on
      // stop), so callers (e.g. public-api) are not blocked.
      void bot.launch({ dropPendingUpdates: true }).catch((err) => {
        const code = err?.response?.error_code;
        if (code === 409) {
          logger.error?.(
            '[telegram:staff-bot] 409 Conflict: this token is already polling elsewhere (another process/PC). Run only one.',
          );
        } else {
          logger.error?.('[telegram:staff-bot] launch failed:', err?.message || String(err));
        }
      });
      logger.log?.('[telegram:staff-bot] polling mode active');
    }
    await afterLaunch();
  } catch (e) {
    logger.error?.('[telegram:staff-bot] start failed:', e?.message || String(e));
    return null;
  }

  process.once('SIGINT', () => {
    try {
      bot.stop('SIGINT');
    } catch {
      /* ignore */
    }
  });
  process.once('SIGTERM', () => {
    try {
      bot.stop('SIGTERM');
    } catch {
      /* ignore */
    }
  });

  return bot;
}

module.exports = { createStaffBot, startStaffBot };

// Standalone: `node telegram/staffBot.cjs` (npm run telegram:staff-bot)
if (require.main === module) {
  loadStaffBotEnv();
  const cfg = readConfig();
  if (!cfg.token) {
    console.error('[telegram:staff-bot] STAFF_BOT_TOKEN .env da kerak. Toʻxtatildi.');
    process.exit(1);
  }
  if (!cfg.webAppUrl || !cfg.webAppUrl.startsWith('https://')) {
    console.error('[telegram:staff-bot] STAFF_WEB_APP_URL https:// boʻlishi shart. Toʻxtatildi.');
    process.exit(1);
  }
  startStaffBot()
    .then((bot) => {
      if (bot) console.log('[telegram:staff-bot] running — Ctrl+C bilan toʻxtating');
      else process.exit(1);
    })
    .catch((err) => {
      console.error('[telegram:staff-bot] fatal:', err?.message || String(err));
      process.exit(1);
    });
}

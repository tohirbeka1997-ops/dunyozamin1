/**
 * Telegram bot: /start → Mini App tugmasi.
 * Run: npm run telegram:bot
 * Serverda doimiy ishlatish: telegram/SERVER-UZ.md va telegram/telegram-bot.service.example
 */
const path = require('path');
const fs = require('fs');

const root = path.resolve(__dirname, '..');
const envPath = path.join(root, '.env');
const localPath = path.join(root, '.env.local');

function loadBotEnv() {
  try {
    const dotenv = require('dotenv');
    if (fs.existsSync(envPath)) {
      const r = dotenv.config({ path: envPath, override: true });
      if (r.error) console.error('[telegram:bot] .env xato:', r.error.message);
    }
    if (fs.existsSync(localPath)) {
      dotenv.config({ path: localPath, override: true });
    }
  } catch (e) {
    console.error('[telegram:bot] dotenv:', e.message);
  }
}

loadBotEnv();

// .env da "= https://" kabi bo'sh joy qolsa ham ishlasin
for (const k of [
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_WEB_APP_URL',
  'VITE_APP_PUBLIC_URL',
  'VITE_POS_RPC_URL',
]) {
  if (process.env[k]) process.env[k] = String(process.env[k]).trim();
}

const { Telegraf, Markup } = require('telegraf');
const { listRecentWebOrders } = require('./lib/publicApiDb.cjs');

const token = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
const webAppUrl = String(
  process.env.TELEGRAM_WEB_APP_URL || process.env.VITE_APP_PUBLIC_URL || '',
).trim();
const contactText = String(
  process.env.TELEGRAM_CONTACT_TEXT ||
    "Savollar uchun do'kon administratoriga yozing.",
).trim();

if (!token || !webAppUrl) {
  console.error(
    '[telegram:bot] .env da TELEGRAM_BOT_TOKEN va TELEGRAM_WEB_APP_URL yoki VITE_APP_PUBLIC_URL kerak.',
  );
  console.error('  Kutilyotgan .env:', envPath);
  console.error('  Fayl bor:', fs.existsSync(envPath));
  console.error('  token uzunligi:', token.length, '| webAppUrl uzunligi:', webAppUrl.length);
  process.exit(1);
}

if (!String(webAppUrl).startsWith('https://')) {
  console.error('[telegram:bot] Web App URL https:// bilan boshlanishi kerak');
  process.exit(1);
}

const bot = new Telegraf(token);

function formatOrdersMessage(result) {
  if (!result.ok) {
    if (result.reason === 'migrations_pending') {
      return "Onlayn buyurtmalar jadvali hali yoqilmagan (serverda migratsiya kerak).";
    }
    return `Ma'lumotlar bazasiga ulanib bo'lmadi. Keyinroq urinib ko'ring.\n(${result.reason || 'xato'})`;
  }
  if (!result.rows.length) {
    return "Hozircha onlayn buyurtmalar yo'q.";
  }
  const lines = result.rows.map((r, i) => {
    const sum = Number(r.total_amount) || 0;
    const d = r.created_at ? String(r.created_at).replace('T', ' ').slice(0, 16) : '';
    return `${i + 1}. ${r.order_number} — ${r.status} — ${sum.toLocaleString('uz-UZ')} so'm\n   ${d}`;
  });
  return "So'nggi buyurtmalar:\n\n" + lines.join('\n\n');
}

bot.start(async (ctx) => {
  const name = ctx.from?.first_name || '';
  await ctx.reply(
    `Assalomu alaykum${name ? ', ' + name : ''}!\n\nDunyoZamin onlayn do'koniga xush kelibsiz.`,
    Markup.inlineKeyboard([
      [Markup.button.webApp("🛍 Do'kon", webAppUrl)],
      [Markup.button.callback('📦 Buyurtmalarim', 'orders_recent')],
      [Markup.button.callback('📞 Bog\'lanish', 'contact_info')],
    ]),
  );
});

bot.action('orders_recent', async (ctx) => {
  await ctx.answerCbQuery();
  const tgId = ctx.from?.id;
  if (tgId == null) return;
  const msg = formatOrdersMessage(listRecentWebOrders(tgId, 5));
  await ctx.reply(msg);
});

bot.action('contact_info', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply(contactText);
});

bot.command('orders', async (ctx) => {
  const tgId = ctx.from?.id;
  if (tgId == null) return;
  await ctx.reply(formatOrdersMessage(listRecentWebOrders(tgId, 10)));
});

bot.catch((err, ctx) => {
  console.error('[telegram:bot] error', err, ctx?.update);
});

function logNetworkError(prefix, err) {
  console.error(prefix);
  console.error('  xabar:', err?.message || String(err));
  let c = err?.cause;
  let n = 0;
  while (c && n < 4) {
    console.error('  sabab:', c?.message || String(c), c?.code ? `(code: ${c.code})` : '');
    c = c.cause;
    n += 1;
  }
  if (err?.code) console.error('  errno/code:', err.code);
  console.error(
    '  Tekshiring: internet, DNS, antivirus/firewall (api.telegram.org), provayder Telegram ni bloklamayaptimi — kerak bo‘lsa VPN.',
  );
  console.error('  Qo‘lda: curl https://api.telegram.org yoki brauzerda shu manzil.');
}

bot
  .launch({ dropPendingUpdates: true })
  .then(() => {
    console.log('[telegram:bot] running — Ctrl+C bilan to‘xtating');
  })
  .catch((err) => {
    const code = err?.response?.error_code;
    if (code === 409) {
      console.error(
        '[telegram:bot] 409 Conflict: shu bot boshqa joyda ham ishlayapti (yana bir terminal, Cursor fon, yoki boshqa PC).',
      );
      console.error('  Hammasini to‘xtating: boshqa terminalda Ctrl+C, Task Manager → node.exe, keyin qayta: npm run telegram:bot');
    } else if (err?.response?.description) {
      console.error('[telegram:bot] API:', err.response.description);
    } else {
      logNetworkError('[telegram:bot] Telegram serveriga ulanib bo‘lmadi (getMe):', err);
    }
    process.exit(1);
  });

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

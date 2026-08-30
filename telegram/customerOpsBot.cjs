/**
 * Alohida mijoz hisobotlari boti.
 * Token: TELEGRAM_CUSTOMER_BOT_TOKEN (Mini App / staff / reports tokenlari EMAS).
 *
 * /start → telefon → POS mijoziga bog‘lash → keyin sotuv/to‘lov/nasiya DM.
 * Run: npm run telegram:customer-bot
 */
'use strict';

const path = require('path');
const fs = require('fs');

const root = path.resolve(__dirname, '..');
const envPath = path.join(root, '.env');
const localPath = path.join(root, '.env.local');

function loadEnv() {
  try {
    const dotenv = require('dotenv');
    if (fs.existsSync(envPath)) dotenv.config({ path: envPath, override: true });
    if (fs.existsSync(localPath)) dotenv.config({ path: localPath, override: true });
  } catch (e) {
    console.error('[telegram:customer-bot] dotenv:', e.message);
  }
}

loadEnv();

for (const k of [
  'TELEGRAM_CUSTOMER_BOT_TOKEN',
  'TELEGRAM_BOT_INTERNAL_SECRET',
  'TELEGRAM_PUBLIC_API_URL',
]) {
  if (process.env[k]) process.env[k] = String(process.env[k]).trim();
}

const token = String(process.env.TELEGRAM_CUSTOMER_BOT_TOKEN || '').trim();
const publicApiUrl = String(process.env.TELEGRAM_PUBLIC_API_URL || 'http://127.0.0.1:3334').trim();
const botInternalSecret = String(process.env.TELEGRAM_BOT_INTERNAL_SECRET || '').trim();
const storeName = String(process.env.TELEGRAM_CUSTOMER_BOT_STORE_NAME || 'DunyoZamin').trim();
const API_TIMEOUT_MS = Math.max(
  1000,
  Number.parseInt(String(process.env.TELEGRAM_BOT_API_TIMEOUT_MS || '7000'), 10) || 7000,
);

if (!token) {
  console.error('[telegram:customer-bot] TELEGRAM_CUSTOMER_BOT_TOKEN kerak (.env).');
  process.exit(1);
}
if (!botInternalSecret) {
  console.error('[telegram:customer-bot] TELEGRAM_BOT_INTERNAL_SECRET kerak (public-api bilan bir xil).');
  process.exit(1);
}

const { Telegraf, Markup } = require('telegraf');
const bot = new Telegraf(token);
const pendingPhone = new Map();

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
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

function normalizedTelegramName(from, field) {
  const cleaned = toLatinName(from?.[field]);
  if (cleaned.length >= 2 && cleaned.length <= 80) return cleaned;
  return field === 'first_name' ? 'Mijoz' : '';
}

async function callBotApi(pathname, opts = {}) {
  const url = `${publicApiUrl.replace(/\/$/, '')}/v1/bot${pathname}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      ...opts,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-telegram-bot-secret': botInternalSecret,
        ...(opts.headers || {}),
      },
    });
    const text = await r.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!r.ok) {
      const err = new Error(json?.error || json?.message || `HTTP_${r.status}`);
      err.status = r.status;
      throw err;
    }
    return json;
  } finally {
    clearTimeout(timer);
  }
}

async function getRegistrationStatus(telegramId) {
  return callBotApi(`/registration/${telegramId}`);
}

function contactKeyboard() {
  return Markup.keyboard([[Markup.button.contactRequest('📱 Telefonni yuborish')]]).resize().oneTime();
}

function doneKeyboard() {
  return Markup.removeKeyboard();
}

async function safeReplyHTML(ctx, text, extra) {
  try {
    await ctx.reply(text, { parse_mode: 'HTML', disable_web_page_preview: true, ...(extra || {}) });
  } catch (e) {
    console.error('[telegram:customer-bot] reply failed:', e?.message || String(e));
    try {
      await ctx.reply(String(text || '').replace(/<[^>]+>/g, ''), extra);
    } catch {
      /* ignore */
    }
  }
}

async function askPhone(ctx) {
  const tgId = ctx.from?.id;
  if (tgId != null) pendingPhone.set(tgId, true);
  await safeReplyHTML(
    ctx,
    `📋 <b>${esc(storeName)} — hisobotlar</b>\n\n` +
      `Doʻkonda xarid, toʻlov, nasiya yoki qaytarish boʻlsa shu yerga qisqa hisobot keladi.\n\n` +
      `Davom etish uchun <b>oʻz telefoningizni</b> yuboring:`,
    contactKeyboard(),
  );
}

bot.start(async (ctx) => {
  const name = ctx.from?.first_name || '';
  const tgId = ctx.from?.id;
  if (tgId == null) return;

  try {
    const out = await getRegistrationStatus(tgId);
    if (out?.registered) {
      pendingPhone.delete(tgId);
      await safeReplyHTML(
        ctx,
        `✅ <b>Assalomu alaykum${name ? ', ' + esc(name) : ''}!</b>\n\n` +
          `Hisobotlar ulangan.\n` +
          `Xarid / toʻlov / nasiya / qaytarish — shu chatga keladi.\n\n` +
          `Qayta bogʻlash: /link`,
        doneKeyboard(),
      );
      return;
    }
  } catch (e) {
    console.warn('[telegram:customer-bot] registration check:', e?.message || e);
  }

  await safeReplyHTML(
    ctx,
    `Assalomu alaykum${name ? ', ' + esc(name) : ''}!\n` +
      `<b>${esc(storeName)}</b> mijoz hisobotlari boti.`,
  );
  await askPhone(ctx);
});

bot.command('link', async (ctx) => {
  await askPhone(ctx);
});

bot.command('help', async (ctx) => {
  await safeReplyHTML(
    ctx,
    `<b>Yordam</b>\n` +
      `/start — ulanish holati\n` +
      `/link — telefonni qayta bogʻlash\n\n` +
      `Ulangandan keyin doʻkon operatsiyalari shu yerga keladi.`,
  );
});

bot.command('status', async (ctx) => {
  const tgId = ctx.from?.id;
  if (tgId == null) return;
  try {
    const out = await getRegistrationStatus(tgId);
    if (out?.registered) {
      await safeReplyHTML(ctx, '✅ Hisobotlar ulangan. Operatsiyalar shu chatga keladi.');
    } else {
      await safeReplyHTML(ctx, "❌ Hali ulanmagan. /link bosib telefon yuboring.");
    }
  } catch (e) {
    await safeReplyHTML(ctx, `Tekshirib boʻlmadi (${esc(e.message)}).`);
  }
});

bot.on('contact', async (ctx) => {
  const tgId = ctx.from?.id;
  if (tgId == null) return;
  const phone = ctx.message?.contact?.phone_number || null;
  const contactUserId = ctx.message?.contact?.user_id;
  if (contactUserId != null && contactUserId !== tgId) {
    await safeReplyHTML(ctx, 'Faqat oʻz telefoningizni yuboring.');
    return;
  }
  if (!phone) {
    await safeReplyHTML(ctx, 'Telefon topilmadi. Qayta urinib koʻring.');
    return;
  }

  try {
    const firstName = normalizedTelegramName(ctx.from, 'first_name');
    const lastName = normalizedTelegramName(ctx.from, 'last_name');
    const out = await callBotApi(`/registration/${tgId}/complete`, {
      method: 'POST',
      body: JSON.stringify({
        first_name: firstName,
        last_name: lastName,
        phone,
      }),
    });
    pendingPhone.delete(tgId);
    await safeReplyHTML(
      ctx,
      `✅ <b>Ulandi!</b>\n\n` +
        `Hurmatli <b>${esc(out?.data?.first_name || firstName)}</b>.\n` +
        `Endi doʻkonda sotib olsangiz, pul bersangiz yoki nasiya olsangiz — shu botga hisobot keladi.`,
      doneKeyboard(),
    );
  } catch (e) {
    await safeReplyHTML(ctx, `Ulab boʻlmadi (${esc(e.message)}). Keyinroq /link qiling.`);
  }
});

bot.on('text', async (ctx) => {
  const tgId = ctx.from?.id;
  const t = String(ctx.message?.text || '');
  if (t.startsWith('/')) return;
  if (tgId != null && pendingPhone.get(tgId)) {
    await safeReplyHTML(ctx, 'Telefonni tugma orqali yuboring: 📱 Telefonni yuborish');
  }
});

bot.catch((err, ctx) => {
  console.error('[telegram:customer-bot] error', err?.message || err, ctx?.update?.update_id);
});

async function main() {
  const me = await bot.telegram.getMe();
  const username = me?.username ? `@${me.username}` : `(id ${me?.id})`;
  console.log(`[telegram:customer-bot] getMe ok — ${username}`);
  try {
    await bot.telegram.deleteWebhook({ drop_pending_updates: false });
  } catch {
    /* ignore */
  }
  await bot.launch({ dropPendingUpdates: true });
  console.log('[telegram:customer-bot] polling — /start bilan bogʻlanish. Ctrl+C toʻxtatadi');
}

main().catch((e) => {
  console.error('[telegram:customer-bot] start failed:', e?.message || e);
  process.exit(1);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

'use strict';

const { setTimeout: sleep } = require('node:timers/promises');
const { allowedNextStatuses, normalizeDeliveryMethod, statusLabel } = require('./webOrderStatusFlow.cjs');

async function sendTelegramText({ botToken, telegramId, text, replyMarkup = null }) {
  if (!botToken || telegramId == null) return { ok: false, reason: 'no_token_or_chat' };
  const url = `https://api.telegram.org/bot${encodeURIComponent(botToken)}/sendMessage`;
  const body = {
    chat_id: telegramId,
    text,
    disable_web_page_preview: true,
  };
  if (replyMarkup && typeof replyMarkup === 'object') {
    body.reply_markup = replyMarkup;
  }
  const attempts = Math.max(1, Number.parseInt(String(process.env.TELEGRAM_NOTIFY_RETRY_COUNT || '3'), 10) || 3);
  const timeoutMs = Math.max(1000, Number.parseInt(String(process.env.TELEGRAM_NOTIFY_TIMEOUT_MS || '7000'), 10) || 7000);
  let lastReason = 'unknown_error';
  for (let i = 0; i < attempts; i += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (r.ok) return { ok: true };
      const t = await r.text();
      lastReason = t.slice(0, 200) || `HTTP_${r.status}`;
    } catch (e) {
      clearTimeout(timer);
      lastReason = e?.message || String(e);
    }
    if (i < attempts - 1) {
      // Small linear backoff to smooth Telegram transient errors.
      // eslint-disable-next-line no-await-in-loop
      await sleep(250 * (i + 1));
    }
  }
  return { ok: false, reason: lastReason };
}

/**
 * To'lov muvaffaqiyatidan keyin mijozga Telegram xabari (TZ F-12).
 */
async function notifyOrderPaid({ botToken, telegramId, orderNumber, totalSums, earnedPoints = 0, pointsBalance = null }) {
  if (!botToken || telegramId == null) return { ok: false, reason: 'no_token_or_chat' };
  let text =
    `To'lov qabul qilindi.\n` +
    `Buyurtma: ${orderNumber}\n` +
    `Summa: ${Number(totalSums).toLocaleString('uz-UZ')} so'm`;
  if (earnedPoints > 0) {
    text += `\nBonus: +${earnedPoints} ball`;
    if (pointsBalance != null) {
      text += `\nBalans: ${Number(pointsBalance)} ball`;
    }
  }
  return sendTelegramText({ botToken, telegramId, text });
}

function deliveryMethodLabel(deliveryMethod) {
  return normalizeDeliveryMethod(deliveryMethod) === 'pickup' ? "O'zi olib ketish" : 'Kuryer';
}

async function notifyOrderCreated({ botToken, telegramId, orderNumber, totalSums, paymentMethod = null, deliveryMethod = 'courier' }) {
  if (!botToken || telegramId == null) return { ok: false, reason: 'no_token_or_chat' };
  const pm = String(paymentMethod || '').trim();
  const paymentLine = pm ? `\nTo'lov usuli: ${pm}` : '';
  const text =
    `Buyurtmangiz qabul qilindi.\n` +
    `Buyurtma: ${orderNumber}\n` +
    `Summa: ${Number(totalSums).toLocaleString('uz-UZ')} so'm` +
    paymentLine +
    `\nYetkazish: ${deliveryMethodLabel(deliveryMethod)}` +
    `\nTez orada tasdiqlashimizni kuting.`;
  return sendTelegramText({ botToken, telegramId, text });
}

function parseAdminTelegramIds() {
  const raw = String(process.env.TELEGRAM_ADMIN_IDS || '').trim();
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => Number.parseInt(String(s).trim(), 10))
    .filter((n) => Number.isFinite(n));
}

async function notifyAdminsNewOrder({
  botToken,
  orderId,
  status = 'new',
  orderNumber,
  totalSums,
  paymentMethod = null,
  deliveryMethod = 'courier',
  customerName = null,
  customerPhone = null,
  items = [],
}) {
  const adminIds = parseAdminTelegramIds();
  if (!botToken || !adminIds.length) return { ok: false, sent: 0, failed: 0 };
  const lines = [
    'Yangi onlayn buyurtma!',
    `ID: #${orderId}`,
    `Buyurtma: ${orderNumber}`,
    `Summa: ${Number(totalSums).toLocaleString('uz-UZ')} so'm`,
  ];
  if (paymentMethod) lines.push(`To'lov usuli: ${paymentMethod}`);
  lines.push(`Yetkazish: ${deliveryMethodLabel(deliveryMethod)}`);
  if (customerName) lines.push(`Mijoz: ${customerName}`);
  if (customerPhone) lines.push(`Tel: ${customerPhone}`);
  if (Array.isArray(items) && items.length > 0) {
    lines.push('Mahsulotlar:');
    for (const item of items.slice(0, 8)) {
      const qty = Number(item?.quantity || 0) || 0;
      const name = String(item?.product_name || item?.product_id || '').trim() || "Noma'lum";
      lines.push(`- ${name} x${qty}`);
    }
    if (items.length > 8) {
      lines.push(`... yana ${items.length - 8} ta`);
    }
  }
  const text = lines.join('\n');
  const options = allowedNextStatuses(status, { deliveryMethod });
  const labels = {
    processing: "Yig'ilmoqda",
    ready: 'Tayyor',
    out_for_delivery: "Yo'lda",
    delivered: 'Yetkazildi',
    cancelled: 'Bekor',
  };
  const row1 = options.slice(0, 2).map((st) => ({
    text: labels[st] || st,
    callback_data: `oas:${orderId}:${st}`,
  }));
  const row2 = options.slice(2, 4).map((st) => ({
    text: labels[st] || st,
    callback_data: `oas:${orderId}:${st}`,
  }));
  const inline = [row1, row2].filter((r) => r.length > 0);
  const replyMarkup = inline.length ? { inline_keyboard: inline } : null;

  let sent = 0;
  let failed = 0;
  for (const tgId of adminIds) {
    // eslint-disable-next-line no-await-in-loop
    const out = await sendTelegramText({ botToken, telegramId: tgId, text, replyMarkup });
    if (out.ok) sent += 1;
    else failed += 1;
  }
  return { ok: failed === 0, sent, failed };
}

function parseCourierNote(note) {
  const lines = String(note || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const out = { noteLines: [], extraPhone: null, mapUrl: null, location: null };
  for (const line of lines) {
    if (/^Qo'shimcha telefon:/i.test(line)) {
      out.extraPhone = line.replace(/^Qo'shimcha telefon:\s*/i, '').trim() || null;
      continue;
    }
    if (/^Xarita:/i.test(line)) {
      out.mapUrl = line.replace(/^Xarita:\s*/i, '').trim() || null;
      continue;
    }
    if (/^Lokatsiya:/i.test(line)) {
      out.location = line.replace(/^Lokatsiya:\s*/i, '').trim() || null;
      continue;
    }
    if (/^Telefon:/i.test(line)) continue;
    out.noteLines.push(line);
  }
  return out;
}

function mapUrlFromText(...parts) {
  for (const part of parts) {
    const text = String(part || '');
    const direct = text.match(/https?:\/\/(?:www\.)?(?:google\.[^\s]+\/maps|maps\.google\.[^\s]+|yandex\.[^\s]+\/maps|2gis\.[^\s]+)[^\s)]+/i);
    if (direct) return direct[0];
    const coords = text.match(/(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)/);
    if (coords) {
      const lat = Number(coords[1]);
      const lng = Number(coords[2]);
      if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
        return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
      }
    }
  }
  return null;
}

async function notifyCourierGroupOrder({ botToken, groupId, order, items = [] }) {
  if (!botToken || !groupId || !order) return { ok: false, reason: 'no_token_or_group' };
  const note = parseCourierNote(order.note);
  const customerName = [order.first_name, order.last_name].filter(Boolean).join(' ').trim() || 'Mijoz';
  const lines = [
    'Kuryer uchun buyurtma',
    `ID: #${order.id}`,
    `Buyurtma: ${order.order_number}`,
    `Mijoz: ${customerName}`,
  ];
  if (order.phone) lines.push(`Telefon: ${order.phone}`);
  if (note.extraPhone) lines.push(`Qo'shimcha telefon: ${note.extraPhone}`);
  if (order.delivery_address) lines.push(`Manzil: ${order.delivery_address}`);
  if (note.location) lines.push(`Lokatsiya: ${note.location}`);
  const mapUrl = mapUrlFromText(note.mapUrl, note.location, order.delivery_address, order.note);
  if (mapUrl) lines.push(`Xarita: ${mapUrl}`);
  lines.push(`To'lov: ${[order.payment_method, order.payment_status].filter(Boolean).join(' / ') || '-'}`);
  lines.push(`Summa: ${Number(order.total_amount || 0).toLocaleString('uz-UZ')} so'm`);
  if (note.noteLines.length) {
    lines.push('');
    lines.push('Izoh:');
    lines.push(...note.noteLines.slice(0, 5));
  }
  lines.push('');
  lines.push('Mahsulotlar:');
  if (Array.isArray(items) && items.length > 0) {
    for (const item of items) {
      const qty = Number(item.quantity || 0) || 0;
      const price = Number(item.price_at_order || 0) || 0;
      const name = String(item.product_name || item.product_id || 'Mahsulot').trim();
      lines.push(`- ${name} x${qty} = ${(qty * price).toLocaleString('uz-UZ')} so'm`);
    }
  } else {
    lines.push('- Mahsulotlar topilmadi');
  }
  const replyMarkup = mapUrl
    ? { inline_keyboard: [[{ text: '🗺 Xaritada ochish', url: mapUrl }]] }
    : null;
  return sendTelegramText({ botToken, telegramId: groupId, text: lines.join('\n'), replyMarkup });
}

function statusMessage({ orderNumber, status, deliveryMethod = 'courier' }) {
  const method = normalizeDeliveryMethod(deliveryMethod);
  const pickup = method === 'pickup';
  const messages = {
    new:
      `Buyurtmangiz qabul qilindi.\n` +
      `Buyurtma: ${orderNumber}\n` +
      `Tez orada operator tasdiqlaydi.`,
    paid:
      `To'lov qabul qilindi.\n` +
      `Buyurtma: ${orderNumber}\n` +
      `Endi buyurtma tasdiqlanishini kuting.`,
    processing:
      `Buyurtmangiz tasdiqlandi.\n` +
      `Buyurtma: ${orderNumber}\n` +
      `Mahsulotlar omborda tayyorlanmoqda.`,
    ready: pickup
      ? `Buyurtmangiz tayyor.\nBuyurtma: ${orderNumber}\nDo'kondan olib ketishingiz mumkin.`
      : `Buyurtmangiz tayyor.\nBuyurtma: ${orderNumber}\nKuryerga topshirish uchun tayyorlanmoqda.`,
    out_for_delivery:
      `Buyurtmangiz kuryerga topshirildi.\n` +
      `Buyurtma: ${orderNumber}\n` +
      `Kuryer yo'lda, tez orada yetib boradi.`,
    delivered:
      `Buyurtmangiz yetkazildi.\n` +
      `Buyurtma: ${orderNumber}\n` +
      `Xarid uchun rahmat. Iltimos, xizmatimizni baholang.`,
    cancelled:
      `Kechirasiz, buyurtma rad etildi.\n` +
      `Buyurtma: ${orderNumber}\n` +
      `Savollar bo'lsa operator bilan bog'laning.`,
  };
  return messages[String(status || '').toLowerCase()]
    || `Buyurtma holati yangilandi.\nBuyurtma: ${orderNumber}\nHolat: ${statusLabel(status)}`;
}

async function notifyOrderStatusChanged({ botToken, telegramId, orderNumber, status, deliveryMethod = 'courier' }) {
  const text = statusMessage({ orderNumber, status, deliveryMethod });
  return sendTelegramText({ botToken, telegramId, text });
}

async function notifyPaymentReminder({
  botToken,
  telegramId,
  orderNumber,
  totalSums,
  paymentMethod = null,
  expiresAt = null,
  paymentUrl = null,
}) {
  if (!botToken || telegramId == null) return { ok: false, reason: 'no_token_or_chat' };
  const lines = [
    "To'lov hali yakunlanmadi.",
    `Buyurtma: ${orderNumber}`,
    `Summa: ${Number(totalSums || 0).toLocaleString('uz-UZ')} so'm`,
  ];
  if (paymentMethod) lines.push(`To'lov usuli: ${paymentMethod}`);
  if (expiresAt) lines.push(`Muddat: ${String(expiresAt).replace('T', ' ').slice(0, 16)}`);
  lines.push("Agar buyurtmani saqlab qolmoqchi bo'lsangiz, to'lovni yakunlang.");
  const text = lines.join('\n');
  const replyMarkup = paymentUrl
    ? {
        inline_keyboard: [[{ text: "To'lovni davom ettirish", url: String(paymentUrl) }]],
      }
    : null;
  return sendTelegramText({ botToken, telegramId, text, replyMarkup });
}

module.exports = {
  notifyOrderPaid,
  notifyOrderCreated,
  notifyOrderStatusChanged,
  notifyPaymentReminder,
  notifyAdminsNewOrder,
  notifyCourierGroupOrder,
  statusMessage,
  sendTelegramText,
};

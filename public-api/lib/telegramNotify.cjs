'use strict';

/**
 * To'lov muvaffaqiyatidan keyin mijozga Telegram xabari (TZ F-12).
 */
async function notifyOrderPaid({ botToken, telegramId, orderNumber, totalSums }) {
  if (!botToken || telegramId == null) return { ok: false, reason: 'no_token_or_chat' };
  const text =
    `To'lov qabul qilindi.\n` +
    `Buyurtma: ${orderNumber}\n` +
    `Summa: ${Number(totalSums).toLocaleString('uz-UZ')} so'm`;

  const url = `https://api.telegram.org/bot${encodeURIComponent(botToken)}/sendMessage`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: telegramId,
      text,
      disable_web_page_preview: true,
    }),
  });
  if (!r.ok) {
    const t = await r.text();
    return { ok: false, reason: t.slice(0, 200) };
  }
  return { ok: true };
}

module.exports = { notifyOrderPaid };

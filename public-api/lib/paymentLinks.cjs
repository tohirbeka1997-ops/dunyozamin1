'use strict';

/**
 * Payme (Paycom) checkout havolasi — summa Paycom qoidasiga ko'ra TIYINda (1 so'm = 100 tiyin).
 * @see https://developer.help.paycom.uz/
 */
function sumsToTiyin(sums) {
  return Math.max(0, Math.round(Number(sums) * 100));
}

function buildPaymeCheckoutUrl({
  merchantId,
  orderId,
  totalSums,
  returnUrl,
  lang = 'uz',
}) {
  if (!merchantId) return null;
  const a = sumsToTiyin(totalSums);
  const payload = {
    m: String(merchantId),
    ac: { order_id: String(orderId) },
    a: a,
    c: returnUrl || '',
    ct: 0,
    cr: returnUrl || '',
    l: lang,
  };
  const b64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
  return `https://checkout.paycom.uz/${b64}`;
}

/**
 * Click to'lov sahifasi (umumiy shakl — service_id, merchant_id, amount tiyinda).
 * @see https://docs.click.uz/
 */
function buildClickCheckoutUrl({
  serviceId,
  merchantId,
  orderId,
  totalSums,
  returnUrl,
}) {
  if (!serviceId || !merchantId) return null;
  const amountTiyin = sumsToTiyin(totalSums);
  const params = new URLSearchParams({
    service_id: String(serviceId),
    merchant_id: String(merchantId),
    amount: String(amountTiyin),
    transaction_param: String(orderId),
    return_url: returnUrl || '',
  });
  return `https://my.click.uz/services/pay?${params.toString()}`;
}

module.exports = { sumsToTiyin, buildPaymeCheckoutUrl, buildClickCheckoutUrl };

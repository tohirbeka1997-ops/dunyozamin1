/**
 * Mixed checkout helper contracts (POS TZ P0-1 / UX).
 * Run: node src/pages/__tests__/mixedCheckout.node.test.mjs
 */
import assert from 'node:assert/strict';

function roundUZS(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function buildMixedPaymentLines(parts) {
  const lines = [];
  const cash = Number(parts.cash) || 0;
  const card = Number(parts.card) || 0;
  const qr = Number(parts.qr) || 0;
  if (cash > 0.009) lines.push({ method: 'cash', amount: cash });
  if (card > 0.009) lines.push({ method: 'card', amount: card });
  if (qr > 0.009) lines.push({ method: 'qr', amount: qr });
  return lines;
}

function sumMixedPaymentLines(lines) {
  return roundUZS(lines.reduce((s, l) => s + (Number(l.amount) || 0), 0));
}

function validateMixedCheckout(opts) {
  const required = roundUZS(Math.max(0, Number(opts.requiredAmount) || 0));
  const paid = sumMixedPaymentLines(opts.lines);
  if (!opts.lines.length) {
    return { ok: false, error: 'Aralash to‘lov uchun kamida bitta to‘lov satri kerak.' };
  }
  const remaining = roundUZS(required - paid);
  const overpay = roundUZS(paid - required);
  if (remaining > 0.01) {
    return { ok: false, error: `To‘lov yetarli emas. Qolgan: ${remaining}` };
  }
  if (overpay > 0.01 && !opts.hasRegisteredCustomer) {
    return {
      ok: false,
      error: 'Ortiqcha to‘lov faqat mijoz tanlanganda avansga o‘tadi. Qaytim kiriting yoki mijoz tanlang.',
    };
  }
  return { ok: true, paid, remaining: Math.max(0, remaining), overpay: Math.max(0, overpay) };
}

const lines = buildMixedPaymentLines({ cash: 500, card: 1000 });
assert.deepEqual(lines.map((l) => l.method), ['cash', 'card']);
assert.equal(sumMixedPaymentLines(lines), 1500);

const okMix = validateMixedCheckout({
  requiredAmount: 1500,
  lines,
  hasRegisteredCustomer: false,
});
assert.equal(okMix.ok, true);

const under = validateMixedCheckout({
  requiredAmount: 1500,
  lines: buildMixedPaymentLines({ cash: 500, card: 900 }),
  hasRegisteredCustomer: false,
});
assert.equal(under.ok, false);

const overNoCustomer = validateMixedCheckout({
  requiredAmount: 1500,
  lines: buildMixedPaymentLines({ cash: 600, card: 1000 }),
  hasRegisteredCustomer: false,
});
assert.equal(overNoCustomer.ok, false);

const overWithCustomer = validateMixedCheckout({
  requiredAmount: 1500,
  lines: buildMixedPaymentLines({ cash: 600, card: 1000 }),
  hasRegisteredCustomer: true,
});
assert.equal(overWithCustomer.ok, true);
assert.equal(overWithCustomer.overpay, 100);

const empty = validateMixedCheckout({
  requiredAmount: 1500,
  lines: [],
  hasRegisteredCustomer: true,
});
assert.equal(empty.ok, false);

console.log('mixedCheckout.node.test.mjs: ok');

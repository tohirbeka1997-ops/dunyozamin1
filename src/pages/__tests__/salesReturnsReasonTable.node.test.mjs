/**
 * Mirrors sort/label helpers in src/pages/SalesReturns.tsx.
 * Run: node --test src/pages/__tests__/salesReturnsReasonTable.node.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const KNOWN_RETURN_REASON_SLUGS = new Set([
  'damaged',
  'incorrect',
  'defective',
  'dissatisfaction',
  'expired',
  'other',
  'exchange',
  'unknown',
]);

function formatReturnReasonLabel(reason, translate) {
  const raw = String(reason ?? '').trim();
  if (!raw) return translate('sales_returns.create.reasons.unknown');
  const slug = raw.toLowerCase();
  if (KNOWN_RETURN_REASON_SLUGS.has(slug)) {
    return translate(`sales_returns.create.reasons.${slug}`);
  }
  return raw;
}

function sortReasonBreakdown(rows) {
  return [...rows].sort((a, b) => {
    const byCount = Number(b.return_count || 0) - Number(a.return_count || 0);
    if (byCount !== 0) return byCount;
    return Number(b.refund_total || 0) - Number(a.refund_total || 0);
  });
}

const localesDir = join(dirname(fileURLToPath(import.meta.url)), '../../locales');
const uz = JSON.parse(readFileSync(join(localesDir, 'uz.json'), 'utf8'));
const en = JSON.parse(readFileSync(join(localesDir, 'en.json'), 'utf8'));
const ru = JSON.parse(readFileSync(join(localesDir, 'ru.json'), 'utf8'));

test('reason rows sort by count then total, highest first', () => {
  const sorted = sortReasonBreakdown([
    { reason: 'other', return_count: 6, refund_total: 4940862, orderless_count: 0 },
    { reason: 'incorrect', return_count: 30, refund_total: 4581121, orderless_count: 6 },
    { reason: 'exchange', return_count: 1, refund_total: 220000, orderless_count: 0 },
    { reason: 'damaged', return_count: 5, refund_total: 607057, orderless_count: 0 },
  ]);
  assert.deepEqual(
    sorted.map((row) => row.reason),
    ['incorrect', 'other', 'damaged', 'exchange'],
  );
});

test('exchange slug is labeled in uz/en/ru, not left as raw English', () => {
  assert.equal(uz.sales_returns.create.reasons.exchange, 'Almashuv');
  assert.equal(en.sales_returns.create.reasons.exchange, 'Exchange');
  assert.equal(ru.sales_returns.create.reasons.exchange, 'Обмен');
  assert.equal(
    formatReturnReasonLabel('exchange', (key) =>
      key.split('.').reduce((acc, part) => acc?.[part], uz),
    ),
    'Almashuv',
  );
  assert.equal(
    formatReturnReasonLabel('EXCHANGE', (key) =>
      key.split('.').reduce((acc, part) => acc?.[part], uz),
    ),
    'Almashuv',
  );
});

test('free-text reasons stay as written', () => {
  const note = 'POS buyurtma tahriri (avvalgi sotuv bekor)';
  assert.equal(
    formatReturnReasonLabel(note, () => 'should-not-use'),
    note,
  );
});

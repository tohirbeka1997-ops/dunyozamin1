'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  canonicalUnit,
  unitsEquivalent,
  isForbiddenProductName,
  parseInvoiceAiPayload,
  matchInvoiceLines,
} = require('./invoicePurchase.cjs');
const { extractInvoiceWithVision } = require('./invoiceVision.cjs');

test('units: quti is not dona', () => {
  assert.equal(canonicalUnit('dona'), 'pcs');
  assert.equal(canonicalUnit('Quti'), 'box');
  assert.equal(canonicalUnit('pachka'), 'pack');
  assert.equal(canonicalUnit('шт'), 'pcs');
  assert.equal(canonicalUnit('штука'), 'pcs');
  assert.equal(unitsEquivalent('dona', 'pcs'), true);
  assert.equal(unitsEquivalent('шт', 'pcs'), true);
  assert.equal(unitsEquivalent('штука', 'dona'), true);
  assert.equal(unitsEquivalent('quti', 'dona'), false);
  assert.equal(unitsEquivalent('metr', 'm'), true);
});

test('forbidden names', () => {
  assert.equal(isForbiddenProductName("Noma'lum"), true);
  assert.equal(isForbiddenProductName('Unknown'), true);
  assert.equal(isForbiddenProductName(''), true);
  assert.equal(isForbiddenProductName('Kabel 2x1.5'), false);
});

test('parse invoice JSON from a fenced reply', () => {
  const parsed = parseInvoiceAiPayload(
    '```json\n{"invoice_number":"A-1","currency":"UZS","lines":[{"name":"Sim","qty":"2","unit":"metr","unit_price":"1000"}]}\n```',
  );
  assert.equal(parsed.invoice_number, 'A-1');
  assert.equal(parsed.lines.length, 1);
  assert.equal(parsed.lines[0].qty, 2);
  assert.equal(parsed.lines[0].unit, 'metr');
  assert.equal(parsed.lines[0].line_total, 2000);
});

test('exact barcode preselects; fuzzy name does not', () => {
  const catalog = [
    { id: 'p1', name: 'Mis sim 2.5', sku: 'SIM25', barcode: '478001', article: 'MS-25', unit: 'm' },
    { id: 'p2', name: 'Mis sim 4.0', sku: 'SIM40', barcode: '478002', article: 'MS-40', unit: 'pcs' },
  ];
  const [exact] = matchInvoiceLines(
    [{ name: 'boshqa nom', qty: 3, unit: 'metr', unit_price: 10, barcode: '478001' }],
    catalog,
  );
  assert.equal(exact.product_id, 'p1');
  assert.equal(exact.match_kind, 'barcode');
  assert.equal(exact.units_match, true);

  const [fuzzy] = matchInvoiceLines(
    [{ name: 'Mis sim', qty: 1, unit: 'dona', unit_price: 1 }],
    catalog,
  );
  assert.equal(fuzzy.product_id, null);
  assert.equal(fuzzy.match_kind, null);
  assert.ok(fuzzy.candidates.some((row) => row.reason === 'fuzzy'));

  const [named] = matchInvoiceLines(
    [{ name: 'Mis sim 4.0', qty: 1, unit: 'dona', unit_price: 1 }],
    catalog,
  );
  assert.equal(named.product_id, 'p2');
  assert.equal(named.match_kind, 'name');
  assert.equal(named.units_match, true);
});

test('shared article is not auto-picked', () => {
  const catalog = [
    { id: 'a', name: 'Bir', sku: '1', barcode: null, article: 'ART', unit: 'pcs' },
    { id: 'b', name: 'Ikki', sku: '2', barcode: null, article: 'ART', unit: 'pcs' },
  ];
  const [line] = matchInvoiceLines([{ name: 'Boshqa', qty: 1, unit: 'dona', unit_price: 1, article: 'ART' }], catalog);
  assert.equal(line.product_id, null);
  assert.equal(line.candidates.length, 2);
});

test('vision without keys does not call the network', async () => {
  const result = await extractInvoiceWithVision(
    { buffer: Buffer.from('not-an-image'), mime: 'image/jpeg' },
    { geminiApiKey: '', openaiApiKey: '' },
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'no_api_key');
  assert.match(result.message, /GEMINI_API_KEY/);
  assert.match(result.message, /OPENAI_API_KEY/);
});

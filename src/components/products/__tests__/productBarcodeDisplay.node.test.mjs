/**
 * Products list barcode cell: primary `barcode`, then first extra code.
 * Run: node --test src/components/products/__tests__/productBarcodeDisplay.node.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

function productBarcodeOf(p) {
  const primary = String(p?.barcode ?? p?.barcode_value ?? '').trim();
  if (primary) return primary;
  const extras = [p?.barcodes, p?.alt_barcodes].find((list) => Array.isArray(list) && list.length);
  return extras ? String(extras[0] ?? '').trim() : '';
}

test('uses primary barcode when present', () => {
  assert.equal(productBarcodeOf({ barcode: '4780123456789', alt_barcodes: ['111'] }), '4780123456789');
});

test('falls back to first extra barcode', () => {
  assert.equal(productBarcodeOf({ barcode: null, barcodes: ['  3001112223334  '] }), '3001112223334');
});

test('empty barcode is blank so the table can show a dash', () => {
  assert.equal(productBarcodeOf({ barcode: '   ', alt_barcodes: [] }), '');
  assert.equal(productBarcodeOf({}), '');
});

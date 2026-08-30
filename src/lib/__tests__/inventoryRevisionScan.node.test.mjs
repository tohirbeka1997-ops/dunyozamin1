/**
 * Inventory revision scan helpers + partial search + source guards.
 * Run: node --test src/lib/__tests__/inventoryRevisionScan.node.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const require = createRequire(import.meta.url);
const {
  matchesRevisionProductSearch,
  normalizeProductSearchValue,
  revisionSearchTokens,
  isRevisionExactBarcodeQuery,
} = require(path.join(root, 'electron/lib/posHardening.cjs'));

function cleanRevisionScanCode(raw) {
  return String(raw || '')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/\s+/g, '')
    .trim();
}

test('cleanRevisionScanCode strips whitespace and control chars', () => {
  assert.equal(cleanRevisionScanCode('  4600123456789\n'), '4600123456789');
  assert.equal(cleanRevisionScanCode('\u0000SKU-1'), 'SKU-1');
});

test('isRevisionExactBarcodeQuery only full barcodes (not short names like evn)', () => {
  assert.equal(isRevisionExactBarcodeQuery('4600123456789'), true);
  assert.equal(isRevisionExactBarcodeQuery('12345678'), true);
  assert.equal(isRevisionExactBarcodeQuery('SKU-ABC'), false);
  assert.equal(isRevisionExactBarcodeQuery('evn'), false);
  assert.equal(isRevisionExactBarcodeQuery('2188'), false);
  assert.equal(isRevisionExactBarcodeQuery('a'), false);
  assert.equal(isRevisionExactBarcodeQuery('cement white'), false);
});

test('normalizeProductSearchValue strips punctuation like FE/BE TZ', () => {
  assert.equal(normalizeProductSearchValue('EVN-A/650U'), 'evna650u');
  assert.equal(normalizeProductSearchValue('evn a400'), 'evna400');
  assert.equal(normalizeProductSearchValue('EVN-A400'), 'evna400');
  assert.equal(normalizeProductSearchValue(null), '');
});

test('revisionSearchTokens splits words then normalizes', () => {
  assert.deepEqual(revisionSearchTokens('evn a400'), ['evn', 'a400']);
  assert.deepEqual(revisionSearchTokens('evna400'), ['evna400']);
  assert.deepEqual(revisionSearchTokens('  Nasos  '), ['nasos']);
});

test('matchesRevisionProductSearch: partial name, tokens, sku', () => {
  const p = {
    name: 'EVN-A/650U Nasos',
    sku: '2188',
    barcode: '4600123456789',
    article: 'ART-1',
    brand: 'EVN',
  };
  assert.equal(matchesRevisionProductSearch(p, 'evn'), true);
  assert.equal(matchesRevisionProductSearch(p, 'nasos'), true);
  assert.equal(matchesRevisionProductSearch(p, 'evn a400'), false);
  assert.equal(matchesRevisionProductSearch(p, 'evn 650'), true);
  assert.equal(matchesRevisionProductSearch({ name: 'EVN-A400' }, 'evn a400'), true);
  assert.equal(matchesRevisionProductSearch({ name: 'EVN-A400' }, 'evna400'), true);
  assert.equal(matchesRevisionProductSearch(p, '2188'), true);
  assert.equal(matchesRevisionProductSearch(p, 'e'), false);
  assert.equal(matchesRevisionProductSearch(p, 'zzz'), false);
});

test('InventoryRevisionDetail wires scan highlight and hotkeys (source guard)', () => {
  const src = readFileSync(path.join(root, 'src/pages/InventoryRevisionDetail.tsx'), 'utf8');
  assert.match(src, /scan_event_id/);
  assert.match(src, /revScanFlash/);
  assert.match(src, /F2/);
  assert.match(src, /F3/);
  assert.match(src, /F6/);
  assert.match(src, /F7/);
  assert.match(src, /locateScannedItem/);
  assert.match(src, /isRevisionExactCodeQuery/);
});

test('inventoryRevisionScan.ts exports helpers (source guard)', () => {
  const src = readFileSync(path.join(root, 'src/lib/inventoryRevisionScan.ts'), 'utf8');
  assert.match(src, /cleanRevisionScanCode/);
  assert.match(src, /createScanEventId/);
  assert.match(src, /isRevisionExactCodeQuery/);
  assert.match(src, /matchesRevisionProductSearch/);
});

test('inventoryRevisionService uses JS partial normalize search (source guard)', () => {
  const src = readFileSync(
    path.join(root, 'electron/services/inventoryRevisionService.cjs'),
    'utf8',
  );
  assert.match(src, /inventory_revision_scan_events/);
  assert.match(src, /scan_event_id/);
  assert.match(src, /next_cursor/);
  assert.match(src, /focus_item_id/);
  assert.match(src, /REVISION_BARCODE_AMBIGUOUS/);
  assert.match(src, /matchesRevisionProductSearch/);
  assert.match(src, /useJsPartialSearch/);
  assert.match(src, /isRevisionExactBarcodeQuery/);
});

test('migration 133 adds scan events and indexes (source guard)', () => {
  const src = readFileSync(
    path.join(root, 'electron/db/migrations/133_inventory_revision_scan_search.sql'),
    'utf8',
  );
  assert.match(src, /inventory_revision_scan_events/);
  assert.match(src, /idx_products_barcode_nocase/);
  assert.match(src, /idx_products_sku_nocase/);
});
